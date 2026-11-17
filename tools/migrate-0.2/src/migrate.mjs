// The migration: an MKP 0.2 bundle (IR shape 1, as `mkp build --target ir` writes it) to an MKP 0.3
// document and the 0.3 pack shims it imports. It reads only the IR. Optionally it is given the 0.2
// source, so that a definition it can't migrate is kept, commented out, beside its stand-in.

import { D, E, P, S, document, packFile, noted, expr as printExpr } from './tree.mjs';
import { readSource } from './source.mjs';
import { Migration, Unsupported, CORE_NAMES } from './context.mjs';
import { Decls } from './decls.mjs';
import { PackShim } from './packs.mjs';
import { DefWriter, fnDecls } from './view.mjs';
import { ProseWriter, fallbackBlock, docValue, inlineProse } from './prose.mjs';
import { resolve, typeOf, value, expr, scopeOf, child } from './values.mjs';

/**
 * @param bundle a 0.2 IR bundle (level "bundle")
 * @param opts { source?: string (the 0.2 .mkp.md: its comments, link definitions, YAML key order and
 *                 front matter, which the IR drops, and the source of definitions that can't migrate),
 *               packWidgets?: boolean (write each pack widget with a view where it migrates, not as an extern),
 *               htmlComments?: 'prose' | 'header' | 'inline' (an HTML comment in prose: `@//` lines in place, the default; the header; or visible text) }
 * @returns { doc, packs: Map<packName, text>, notes, counts }
 */
export function migrate(bundle, opts = {}) {
  if (bundle.ir !== 1 || bundle.level !== 'bundle') throw new Error(`expected a 0.2 bundle (ir 1, level bundle); found ir ${bundle.ir}, level ${bundle.level}`);
  const m = new Migration(bundle, opts);
  m.src = opts.source ? readSource(opts.source) : null;
  const doc = new Decls(m, '$doc');
  const counts = { blocks: 0, widgets: 0, fallbacks: 0, defs: 0, defsMigrated: 0 };

  // the document's own fns and constants (```mkp lines fn … and const …)
  const top = [];
  const topScope = scopeOf();
  for (const [name, c] of Object.entries(bundle.consts ?? {})) {
    try {
      const at = { line: c.pos?.[0], pack: '$doc', sink: doc };
      top.push(D.let(m.safe(name), typeOf(m, c.type, at).src, expr(m, c.ast, topScope, at, c.type)));
      topScope.consts.set(name, E.name(m.safe(name)));
    } catch (e) {
      if (!(e instanceof Unsupported)) throw e;
      m.todo(c.pos?.[0], `the constant ${name} was not migrated: ${e.what}`);
    }
  }
  top.push(...fnDecls(m, doc, '$doc', topScope));

  // the document's own definitions: their names first, so uses can be written in any order
  const own = Object.values(bundle.defs).filter((d) => d.pack === '$doc' && d.name !== 'document');
  const names = new Map(own.map((d) => [d.id, { name: doc.name(d.name, 'widget') }]));
  const writer = new DefWriter(m, doc, names);
  const widgets = [];
  for (const d of own) {
    counts.defs++;
    try {
      const w = writer.widget(d);
      names.get(d.id).w = w;
      widgets.push(D.widget(w));
      counts.defsMigrated++;
    } catch (e) {
      if (!(e instanceof Unsupported)) throw e;
      const si = standIn(m, doc, d, names.get(d.id).name, e.what, opts.source);
      names.get(d.id).w = si.w;
      widgets.push(si.decl);
    }
  }

  // the document's state (```state blocks, and document-level var and derived values)
  const docDef = bundle.defs['$doc:document@1'];
  const stateFields = [];
  const lets = [];
  const docScope = scopeOf();
  for (const v of docDef?.values ?? []) {
    const at = { line: v.pos?.[0], pack: '$doc', sink: doc, hint: v.name };
    try {
      if (v.k === 'state' || v.k === 'var') {
        if (!v.default) throw new Unsupported(`${v.name} has no starting value`);
        const t = typeOf(m, v.type, at);
        const init = value(m, v.default, v.type, at, docScope);
        const step = v.k === 'state' && v.args?.step && 'lit' in v.args.step ? ` step ${v.args.step.lit}` : '';
        const range = v.control === 'slider' && v.args?.min && v.args?.max ? ` ${v.args.min.lit}..${v.args.max.lit}` : '';
        stateFields.push({ name: m.safe(v.name), type: t.src + (t.src === 'number' ? range + step : ''), default: init, comments: [...(v.comment ?? []), ...(v.label ? [v.label] : [])] });
        docScope.inst.set(v.name, E.state(m.safe(v.name)));
        docScope.types.set(v.name, v.type);
      } else if (v.k === 'derived') {
        const t = typeOf(m, v.value.type, at);
        lets.push(D.let(m.safe(v.name), t.src, expr(m, v.value.ast, docScope, at, v.value.type)));
        docScope.inst.set(v.name, E.name(m.safe(v.name)));
        docScope.types.set(v.name, v.value.type);
      } else throw new Unsupported(`a document ${v.k}`);
    } catch (e) {
      if (!(e instanceof Unsupported)) throw e;
      m.todo(at.line, `the document value ${v.name} was not migrated: ${e.what}`);
    }
  }

  // the body
  const pw = new ProseWriter(m, (n) => {
    counts.blocks++;
    try {
      const out = widgetBlock(m, n, { doc, names, writer, pw, docDef, docScope });
      counts.widgets++;
      return out;
    } catch (e) {
      if (!(e instanceof Unsupported)) throw e;
      counts.fallbacks++;
      return fallbackBlock(m, n, e.what, (ns) => pw.blocks(ns));
    }
  }, m.src);
  const body = [];
  for (const n of bundle.doc.body) {
    try {
      if (n.pos) body.push(...pw.flush(n.pos[0], n));
      body.push(...pw.block(n));
    } catch (e) {
      if (!(e instanceof Unsupported)) throw e;
      counts.fallbacks++;
      body.push(...fallbackBlock(m, n, e.what, (ns) => pw.blocks(ns)));
    }
  }

  body.push(...pw.flush(Infinity, null));
  m.moved = pw.moved;

  // the header: what to finish by hand, then the declarations
  const decls = [];
  for (const p of [...m.packs.keys()].sort()) decls.push(D.import(p));
  decls.push(D.comment(header(m)));
  decls.push(...doc.decls());
  if (stateFields.length) decls.push(D.state(stateFields));
  decls.push(...top, ...lets, ...widgets);

  const front = dropStamp(m, m.src?.front ?? (Object.keys(bundle.doc.front ?? {}).length ? frontMatter(null, bundle.doc.front) : null));
  const packs = new Map([...m.packs].map(([name, shim]) => [name, packFile(name, shim.file())]));
  counts.packWidgets = [...m.packs.values()].reduce((n, s) => n + s.widgets.size, 0);
  counts.packWidgetsWritten = [...m.packs.values()].reduce((n, s) => n + s.written, 0);
  return { doc: document({ front, decls, body }), packs, notes: m.notes, counts };
}

/**
 * 0.2's stamp (mkp: and ir: lines in the front matter) says what the file was written for; in 0.3
 * the front matter is the app's, passed on untouched, so the stamp comes out. A front matter left
 * with nothing in it goes too.
 */
function dropStamp(m, front) {
  if (!front) return front;
  const lines = front.split('\n');
  const kept = lines.filter((l, i) => i === 0 || !/^(mkp|ir):\s/.test(l));
  if (kept.length !== lines.length) m.lossy(1, `0.2's stamp (${lines.filter((l) => /^(mkp|ir):\s/.test(l)).map((l) => l.trim()).join(', ')}) was taken out of the front matter: 0.3 passes front matter to the app untouched`);
  return kept.filter((l) => l.trim()).length <= 2 ? null : kept.join('\n');
}

/** The front matter as written, when the source is at hand; otherwise each key as JSON. */
function frontMatter(source, front) {
  const m = source && /^---\n[\s\S]*?\n---\n/.exec(source);
  if (m) return m[0];
  return `---\n${Object.entries(front).map(([k, v]) => `${k}: ${JSON.stringify(v)}`).join('\n')}\n---\n`;
}

function header(m) {
  const lines = ['Migrated from MKP 0.2 by tools/migrate-0.2, from the 0.2 IR. Lines below are lines of the 0.2 source.'];
  const order = { todo: 0, fallback: 1, lossy: 2, info: 3 };
  const notes = [...m.notes].sort((a, b) => order[a.kind] - order[b.kind] || (a.line ?? 0) - (b.line ?? 0));
  if (!notes.length) lines.push('Nothing to finish by hand.');
  for (const n of notes) lines.push(`${n.kind === 'todo' ? 'TODO' : n.kind === 'fallback' ? 'TODO (kept as Markdown)' : n.kind === 'lossy' ? 'CHANGED' : 'NOTE'}${n.line ? ` line ${n.line}` : ''}: ${n.what}`);
  if (m.moved?.length) {
    // 0.3 prose shows an HTML comment as text, so the comments the prose held are kept here, with their place
    lines.push('', 'Comments from the 0.2 prose (0.3 would show them as text), each with where it stood:');
    for (const c of m.moved) lines.push(`line ${c.line}, ${c.before}:`, ...c.text.split('\n').map((l) => `    ${l}`));
  }
  return lines.join('\n');
}

/**
 * A definition the migration can't write in 0.3: a widget with the same inputs (where their types
 * migrate, so its uses still check) that shows its name, with the 0.2 definition kept above it as
 * comments (quoted from the source when it was given).
 */
function standIn(m, doc, d, name, why, source) {
  m.todo(d.pos?.[0], `the definition ${d.name} was not migrated (${why}); a stand-in with its inputs shows its name, and its 0.2 source is kept above it`);
  const params = [];
  const slots = [];
  for (const inp of d.inputs) {
    try {
      const t = resolve(m, inp.type, '$doc');
      if (t.t === 'slot') slots.push([m.safe(inp.name, CORE_NAMES), 'opt<view>']);
      else params.push(doc.field(inp.name, inp.type, inp.default, { line: inp.pos?.[0], hint: `${name}_${inp.name}` }));
    } catch (e) {
      if (!(e instanceof Unsupported)) throw e;
    }
  }
  const src = defSource(source, d) ?? `${d.name} "${d.about ?? ''}" (inputs: ${d.inputs.map((i) => i.name).join(', ')})`;
  return {
    w: { name, params, slots },
    decl: D.widget({
      name,
      comments: [...(d.comment ?? []), `TODO: ${d.name} was not migrated: ${why}.`, 'Its 0.2 definition:', ...src.split('\n').map((l) => `    ${l}`)],
      about: d.about,
      params,
      slots,
      view: [S.call('label', [['value', E.text(`${d.name}: not migrated from MKP 0.2 yet`)], ['tone', E.case('color', 'MUTED')]])],
      markdown: [P.md(inlineProse(d.about ?? d.name))],
    }),
  };
}

/** The lines of a definition in the 0.2 source: from its first line to the end of its fence. */
function defSource(source, d) {
  if (!source || !d.pos) return null;
  const lines = source.split('\n');
  const out = [];
  for (let i = d.pos[0] - 1; i < lines.length; i++) {
    if (/^```/.test(lines[i])) break;
    if (i > d.pos[0] - 1 && /^\S/.test(lines[i]) && !/^(#|""")/.test(lines[i])) break;
    out.push(lines[i]);
  }
  return out.join('\n').trimEnd();
}

// ---------------------------------------------------------------------------------------------
// Widget blocks in the document

function widgetBlock(m, n, ctx) {
  if (n.node === 'controls') return controls(m, n, ctx);
  const d = m.def(n.def);
  if (!d) throw new Unsupported(`the block ${n.node} names no definition`);
  if (n.meta?.anchor) m.lossy(n.pos?.[0], `the block's id #${n.meta.anchor} was dropped: 0.3 has no ids`);
  if (d.pack === 'core') return coreBlock(m, n, ctx);
  if (d.pack === '$doc') return docUse(m, n, ctx);
  return packUse(m, n, d, ctx);
}

/** A base widget written as a block in the document (```meter, :::grid cols=2). */
function coreBlock(m, n, ctx) {
  const s = ctx.writer.node({ ...n, children: [] }, ctx.docScope);
  if (s.length !== 1 || s[0].k !== 'call') throw new Unsupported(`the base widget ${n.node} as a document block`);
  const body = n.children?.length ? ctx.pw.blocks(n.children, end(m, n), n) : null;
  return [P.call(s[0].name, s[0].args, body)];
}

/** A use of one of the document's own widgets. */
function docUse(m, n, ctx) {
  const entry = ctx.names.get(n.def);
  const d = m.def(n.def);
  const w = entry.w;
  if (!w) throw new Unsupported(`${d.name} was not migrated, so its use can't be either`);
  const args = [];
  for (const [k, v] of Object.entries(n.props ?? {})) {
    const inp = d.inputs.find((i) => i.name === k);
    const f = w.params.find((p) => p.name === m.safe(k));
    if (!inp || !f) throw new Unsupported(`${d.name} has no input ${k}`);
    const e = docValue(m, v, inp.type, { line: n.pos?.[0], pack: '$doc', sink: ctx.doc });
    if (f.default && printExpr(f.default) === printExpr(e)) continue;
    args.push([f.name, e, k]);
  }
  if (n.records?.length) {
    const groups = new Map();
    for (const r of n.records) (groups.get(r.input) ?? groups.set(r.input, []).get(r.input)).push(r);
    for (const [input, rs] of groups) {
      const inp = d.inputs.find((i) => i.name === input);
      const t = resolve(m, inp.type, '$doc');
      if (t.t !== 'records' || t.slot) throw new Unsupported(`${d.name}'s ${input} records with content`);
      args.push([m.safe(input), records(m, rs, t, ctx.doc, '$doc', n.pos?.[0], yamlOf(m, n), input), input]);
    }
  }
  if (n.meta?.summary) m.lossy(n.pos?.[0], `the summary of this ${d.name} block was dropped: 0.3 builds a document widget's Markdown from the widget ("${n.meta.summary.slice(0, 60)}")`);
  const body = n.children?.length ? ctx.pw.blocks(n.children, end(m, n), n) : null;
  if (body && !w.slots.length) throw new Unsupported(`content for ${d.name}, which has no slot`);
  return [P.call(entry.name, withNotes(m, n, args), body)];
}

/**
 * A list of 0.2 record values (YAML items) as a 0.3 list of record literals, defaults left out, each
 * record's fields in the order the YAML wrote them, and the YAML's comments on each item kept.
 */
function records(m, rs, t, sink, pack, line, y = null, key = null) {
  const name = sink.recordFor(t.kind, t.fields, t.defaults, { line, pack, sink, rich: !!sink.rich });
  const decl = sink.records.get(name);
  const types = new Map(t.fields);
  const notes = y?.items.get(key) ?? [];
  const fieldNotes = y?.fields.get(key) ?? [];
  const items = rs.map((r, i) => {
    const fields = [];
    // the IR keeps the YAML's order, then the defaults it filled in; nested records come after
    const order = [...Object.keys(r.props ?? {}), ...t.fields.map(([f]) => f).filter((f) => !(f in (r.props ?? {})))];
    for (const f of order) {
      const ft = types.get(f);
      if (!ft) continue;
      const fd = decl.fields.find((x) => x.name === m.safe(f));
      const rt = resolve(m, ft, pack);
      let e;
      if (rt.t === 'records') {
        const sub = (r.records ?? []).filter((x) => x.input === f);
        if (!sub.length) continue;
        e = records(m, sub, rt, sink, pack, line);
      } else {
        const v = r.props?.[f];
        if (v === undefined) continue;
        e = docValue(m, v, ft, { line: r.pos?.[0] ?? line, pack, sink, hint: `${name}_${f}` });
      }
      if (fd?.default && printExpr(fd.default) === printExpr(e)) continue;
      if (e.k === 'case' && e.type === 'opt' && !fd?.default) continue;
      fields.push([fd?.name ?? m.safe(f), e]);
    }
    const n = notes[i];
    // a comment on a field of a record written one field a line goes above the record, naming the field
    const fieldLines = [...(fieldNotes[i] ?? new Map())].flatMap(([f, x]) => [...x.before.map((c) => `${f}: ${c}`), ...(x.after ? [`${f}: ${x.after}`] : [])]);
    return noted(E.rec(name, fields), [...(n?.before ?? []), ...fieldLines], n?.after ?? null);
  });
  return E.list(items, true);
}

/** The YAML block's comments and key order, when the source was given. */
function yamlOf(m, n) {
  return n.pos ? m.src?.yaml.get(n.pos[0]) ?? null : null;
}

/** Where a ::: container closes in the source, so a comment before its end stays inside it. */
function end(m, n) {
  return n.pos ? m.src?.ends.get(n.pos[0]) ?? null : null;
}

/** Arguments in the order the YAML wrote their keys, each with the YAML's comments on it. */
function withNotes(m, n, args) {
  const y = yamlOf(m, n);
  if (!y) return args.map(([a, b]) => [a, b]);
  const at = (k) => (y.order.includes(k) ? y.order.indexOf(k) : y.order.length);
  return [...args]
    .sort((a, b) => at(a[2]) - at(b[2]))
    .map(([name, e, k]) => {
      const note = y.keys.get(k);
      return [name, note ? noted(e, note.before, note.after) : e];
    });
}

/** A use of a pack's widget (a stats, a callout, tabs…), through the pack's 0.3 shim. */
function packUse(m, n, d, ctx) {
  let shim = m.packs.get(d.pack);
  if (!shim) m.packs.set(d.pack, (shim = new PackShim(m, d.pack, d.version)));
  const w = shim.widget(d.id);
  const line = n.pos?.[0];
  const at = { line, pack: d.pack, sink: shim, rich: true };
  const args = [];
  for (const [k, v] of Object.entries(n.props ?? {})) {
    const inp = w.inputs.get(k);
    if (!inp) {
      m.todo(line, `${d.name}'s ${k} has no input in the 0.3 shim and was left out`);
      continue;
    }
    const e = docValue(m, v, inp.t, { ...at, hint: `${w.name}_${k}` });
    if (inp.f.default && printExpr(inp.f.default) === printExpr(e)) continue;
    if (e.k === 'case' && e.type === 'opt') continue;
    args.push([inp.f.name, e, k]);
  }
  // record lines: data (a list literal) or content (one child widget each)
  const groups = new Map();
  for (const r of n.records ?? []) (groups.get(r.input) ?? groups.set(r.input, []).get(r.input)).push(r);
  const kidCalls = new Map();
  for (const [input, rs] of groups) {
    const inp = d.inputs.find((i) => i.name === input);
    const t = resolve(m, inp.type, d.pack);
    if (t.t === 'records' && t.slot) {
      const kid = w.kids.get(t.kind);
      kidCalls.set(input, rs.map((r) => P.call(kid.name, kidArgs(m, r, kid, at), ctx.pw.blocks(r.children ?? [], end(m, r), r))));
      continue;
    }
    const f = w.inputs.get(input)?.f;
    args.push([f?.name ?? m.safe(input), records(m, rs, t, shim, d.pack, line, yamlOf(m, n), input), input]);
  }
  if (n.meta?.summary) args.push(['summary', E.text(n.meta.summary), 'summary']);
  // slots: one view slot takes the block; several take @slot blocks
  const slotBodies = [];
  for (const [sname, stype, input02] of w.slots) {
    if (stype === 'view') {
      const firstView = w.slots.find(([, t]) => t === 'view')[0] === sname;
      const content = n.fills?.[input02] ?? (firstView ? n.children : null);
      if (content?.length) slotBodies.push([sname, ctx.pw.blocks(content, end(m, n), n)]);
    } else if (kidCalls.has(input02)) slotBodies.push([sname, kidCalls.get(input02)]);
  }
  if (n.fills) for (const k of Object.keys(n.fills)) if (!w.slots.some(([, , i]) => i === k)) throw new Unsupported(`:::fill ${k} names no slot of ${d.name}`);
  if (!w.slots.length && n.children?.length) throw new Unsupported(`content inside ${d.name}, which has no slot`);
  const a = withNotes(m, n, args);
  if (w.slots.length === 1) return [P.call(w.name, a, slotBodies[0]?.[1] ?? (w.slots[0][1] === 'view' && n.children ? [] : null))];
  return [P.call(w.name, a, null, slotBodies.length ? slotBodies : null)];
}

function kidArgs(m, r, kid, at) {
  const args = [];
  for (const [f, { f: field, t }] of kid.fields) {
    const v = r.props?.[f];
    if (v === undefined || !field) continue;
    const e = docValue(m, v, t, { ...at, hint: `${kid.name}_${f}` });
    if (field.default && printExpr(field.default) === printExpr(e)) continue;
    args.push([field.name, e]);
  }
  return args;
}

/** A ```state block: each control as the 0.3 widget that sets its $state field. */
function controls(m, n, ctx) {
  const out = [];
  for (const name of n.names ?? []) {
    const v = (ctx.docDef?.values ?? []).find((x) => x.name === name);
    const s = E.state(m.safe(name));
    const label = E.text(v?.label ?? name);
    if (v?.k === 'state' && v.control === 'slider') {
      const args = [['value', s], ['label', label]];
      if (v.args?.min && v.args?.max) args.push(['range', E.range(E.num(v.args.min.lit), E.num(v.args.max.lit))]);
      out.push(P.call('slider', args));
    } else if (v?.k === 'state' && v.control === 'toggle') {
      out.push(P.call('press', [['label', label], ['kind', E.case('press_kind', 'SWITCH')], ['selected', s], ['click', E.lambda([], [S.assign(s, E.un('!', s))])]]));
    } else {
      m.todo(n.pos?.[0], `the ${v?.control ?? v?.k ?? ''} control for ${name} has no 0.3 widget here (play, steps, drag and clock need a timer or a canvas); $state.${m.safe(name)} keeps its value`);
      out.push(P.md(`*${inlineProse(v?.label ?? name)}*: \\{$state.${m.safe(name)}}`));
    }
  }
  return out;
}
