#!/usr/bin/env node
// A probe, not part of the migration: writes canonical 0.3 source back from a 0.3 IR (mkp build's
// output), to see how far an IR → source writer gets and how readable its output is. It writes the
// document module only: its imports, its records, enums, lets and $state, its own widgets, and its
// view, where each lowered Markdown block (an extern call to core/paragraph, core/heading, core/bullets
// and the rest) becomes the Markdown it stands for again. Everything core's and the packs' stays in
// their own files and is imported.
//
//   node probe/ir3-source.mjs doc.ir.json > doc.mkp.md
//
// What it can't write becomes a `// TODO` comment above the @@@ line.

import { readFileSync } from 'node:fs';
import { D, E, P, S, document, expr as printExpr } from '../src/tree.mjs';

const ir = JSON.parse(readFileSync(process.argv[2], 'utf8')).ir;
const todo = [];
const binds = new Map(ir.bindings.map((b) => [b.id, b.value]));
const handlers = new Map(ir.handlers.map((h) => [h.id, h.body]));
const short = (n) => n.slice(n.indexOf('/') + 1);
const packs = new Set();
const use = (n) => {
  const p = n.slice(0, n.indexOf('/'));
  if (p !== 'core' && p !== 'doc') packs.add(p);
  return short(n);
};

// what each widget takes: its slots, to know whether a block or @slot blocks fill them
const slotsOf = new Map();
const channels = new Set();
const fieldOrder = new Map();
for (const t of ir.templates) slotsOf.set(t.name, t.slots.map((s) => s.name));
for (const { declare } of ir.declarations) {
  if (declare.extern?.widget) slotsOf.set(declare.extern.widget.name, (declare.extern.widget.slots ?? []).map((s) => s.name));
  if (declare.extern?.channel) channels.add(declare.extern.channel.name);
  if (declare.record) fieldOrder.set(declare.record.name, declare.record.fields.map((f) => f.name));
}

// ---------------------------------------------------------------------------------------------
// Types and values

function type(t) {
  if (!t) return 'void';
  let s = use(t.name);
  if (t.args?.length) s += `<${t.args.map(type).join(', ')}>`;
  const c = t.contract;
  if (c?.range) s += ` ${c.range.low ? val(c.range.low).v ?? '' : ''}${c.range.high ? '..' + val(c.range.high).v : '...'}`;
  if (c?.length) s += `[${c.length.low?.num ?? ''}${c.length.high ? '..' + c.length.high.num : '...'}]`;
  return s;
}

/** An IR value or expression as a tree expression. */
function val(v) {
  if ('text' in v) return E.text(v.text);
  if ('num' in v) return v.num.startsWith('-') ? E.un('-', E.num(v.num.slice(1))) : E.num(v.num);
  if ('bool' in v) return E.bool(v.bool);
  if ('none' in v) return E.none();
  if ('some' in v) return val(v.some); // a plain value is accepted where an opt is wanted
  if ('case' in v) return E.case(use(v.case.enum), v.case.name, v.case.args?.map(val));
  if ('token' in v) {
    const [ty, c] = v.token.split('.');
    return E.case(use(ty), c);
  }
  if ('record' in v) {
    if (v.record.type === 'core/latex' || v.record.type === 'core/template') return E.text(...template(v.record.type === 'core/latex' ? v.record.fields.tex.record.fields : v.record.fields));
    // the IR keeps a record's fields by name; the record's declaration gives their order
    const order = fieldOrder.get(v.record.type) ?? [];
    const fs = Object.entries(v.record.fields).sort(([a], [b]) => order.indexOf(a) - order.indexOf(b));
    return E.rec(use(v.record.type), fs.map(([k, x]) => [k, val(x)]));
  }
  if ('list' in v) return E.list(v.list.map(val), v.list.length > 3);
  if ('range' in v) return E.range(val(v.range.low), val(v.range.high));
  if ('rich' in v) return E.text(rich(v.rich.segments, false));
  if ('template' in v) return E.text(...v.template.pieces.flatMap((p, i) => [p, ...(v.template.holes[i] ? [val(v.template.holes[i])] : [])]).filter((p) => p !== ''));
  if ('show' in v) return val(v.show.value);
  if ('bind' in v) return val(binds.get(v.bind));
  if ('get' in v) {
    const g = v.get;
    if ('$state' in g) return E.state(g.$state);
    return E.name(short(g.input ?? g.local ?? g.cell ?? g.let ?? g.slot ?? Object.values(g)[0]));
  }
  if ('place' in v) return place(v.place);
  if ('field' in v) return E.field(val(v.field.value), v.field.name);
  if ('index' in v) return E.index(val(v.index.value), val(v.index.at));
  if ('op' in v) {
    const [a, b, c] = v.op.args.map(val);
    if (v.op.name === '?') return E.cond(a, b, c);
    return b ? E.bin(v.op.name, a, b) : E.un(v.op.name, a);
  }
  if ('call' in v) {
    const n = v.call.name;
    const dot = n.lastIndexOf('.');
    const owner = dot > 0 ? n.slice(0, dot) : null;
    // an extern channel's fn is called on the channel; a fn added to a type, on its first argument
    if (owner && channels.has(owner)) return E.method(E.name(short(owner)), n.slice(dot + 1), v.call.args.map(val));
    if (owner) return E.method(val(v.call.args[0]), n.slice(dot + 1), v.call.args.slice(1).map(val));
    return E.call(use(n), v.call.args.map(val));
  }
  if ('fn' in v) return E.lambda(v.fn.params.map((p) => p.name), stmts(v.fn.body));
  todo.push(`a value of the shape ${Object.keys(v).join(',')}`);
  return E.name('todo_');
}

function place(p) {
  let e = '$state' in p.root ? E.state(p.root.$state) : E.name(short(Object.values(p.root)[0]));
  for (const s of p.path) e = s.field ? E.field(e, s.field) : E.index(e, val(s.index));
  return e;
}

function template(fields) {
  const pieces = fields.pieces.list.map((p) => p.text);
  const holes = fields.holes.list;
  return pieces.flatMap((p, i) => [p, ...(holes[i] ? [val(holes[i])] : [])]).filter((p) => p !== '');
}

function stmts(body) {
  return body.map((s) => {
    if (s.return) return S.ret(s.return.value ? val(s.return.value) : null);
    if (s.set) return S.assign(place(s.set.place), val(s.set.value));
    if (s.call) return S.expr(val({ call: s.call }));
    if (s.invoke) return S.invoke(s.invoke.event, s.invoke.args.map(val));
    if (s.match) return S.match(val(s.match.subject), s.match.cases.map((c) => [c.when.map((w) => (w.case ? `${use(w.case.enum)}.${w.case.name}` : 'else')), stmts(c.then)]));
    todo.push(`a statement ${Object.keys(s)[0]}`);
    return S.comment('TODO');
  });
}

// ---------------------------------------------------------------------------------------------
// Rich text as Markdown, in the one spelling of each mark (spec page 1, "Markdown out")

function esc(s) {
  return s.replace(/[\\`*_[\]$]/g, '\\$&');
}

/** A paragraph's text: what would start another block at the start of a line is escaped there. */
function lineStarts(s) {
  return s.replace(/^( {0,3})(#(?=[\s#]|$)|[>@]|[+*-](?=\s|$)|\d+[.)](?=\s|$)|\}(?=\s*$))/gm, '$1\\$2');
}

/** Segments as inline Markdown; `prose` writes holes as \{…}, otherwise as template holes are not possible here. */
function rich(segs, prose = true) {
  let out = '';
  for (const { segment: s } of segs) {
    let t;
    if (s.part === 'CODE') t = '`' + s.value.text + '`';
    else if (s.part === 'MATH') t = '$' + template(s.value.record.fields.tex.record.fields).map((p) => (typeof p === 'string' ? p : `\\{${exprSrc(p)}}`)).join('') + '$';
    else if (s.part === 'NOTE') t = `[^${s.value.text}]`;
    else if (s.part === 'IMAGE') t = `![${esc(s.alt.text)}](${s.src.text})`;
    else if (s.value && 'text' in s.value) t = esc(s.value.text);
    else t = prose ? `\\{${exprSrc(val(s.value))}}` : (todo.push('a hole in rich text outside prose'), '');
    const mk = s.marks ?? {};
    if (mk.italic) t = `*${t}*`;
    if (mk.bold) t = `**${t}**`;
    if (mk.strike) t = `~~${t}~~`;
    if (mk.link) t = `[${t}](${mk.link.text})`;
    out += t;
  }
  return out.replace(/\*\*\*\*/g, '');
}

const exprSrc = (e) => printExpr(e, '');

function richOf(v) {
  if (v.bind) return richOf(binds.get(v.bind));
  if (v.rich) return rich(v.rich.segments);
  return `\\{${exprSrc(val(v))}}`;
}

// ---------------------------------------------------------------------------------------------
// Views: lowered Markdown blocks back to Markdown, uses back to calls

function md(nodes) {
  return prose(nodes).map((p) => p.text ?? '').join('\n\n');
}

function prose(nodes) {
  const out = [];
  for (const n of nodes) {
    const [k] = Object.keys(n);
    const b = n[k];
    if (k === 'extern' && b.name.startsWith('core/') && BLOCKS[short(b.name)]) out.push(P.md(BLOCKS[short(b.name)](b)));
    else if (k === 'extern' || k === 'use') out.push(call(b));
    else if (k === 'for') out.push(P.for(b.name, val(b.over), prose(b.body)));
    else if (k === 'if') {
      const br = b.branches[0];
      out.push(P.if(val(br.when), prose(br.then), b.else?.length ? prose(b.else) : null));
    } else {
      todo.push(`a ${k} in prose`);
    }
  }
  return out;
}

const BLOCKS = {
  paragraph: (b) => lineStarts(richOf(b.props.value)),
  heading: (b) => `${'#'.repeat(Number(b.props.level.num))} ${richOf(b.props.value)}`,
  divider: () => '---',
  code: (b) => {
    // a code block's text ends with its last line's break
    const src = b.props.src.text.replace(/\n$/, '');
    let f = '```';
    while (src.includes(f)) f += '`';
    return `${f}${b.props.lang?.text ?? ''}\n${src}\n${f}`;
  },
  math: (b) => `$$\n${template(b.props.tex.record.fields.tex.record.fields).map((p) => (typeof p === 'string' ? p : `\\{${exprSrc(p)}}`)).join('')}\n$$`,
  quote: (b) => md(b.slots.body).split('\n').map((l) => (l ? `> ${l}` : '>')).join('\n'),
  bullets: (b) => {
    const ordered = b.props.ordered?.bool;
    let k = Number(b.props.start?.num ?? 1);
    return b.slots.items
      .map((it) => {
        const mark = ordered ? `${k++}.` : '-';
        const done = it.extern.props.done;
        const box = done?.some ? (done.some.bool ? '[x] ' : '[ ] ') : done?.bool !== undefined ? (done.bool ? '[x] ' : '[ ] ') : '';
        const body = md(it.extern.slots.body);
        return `${mark} ${box}${body.split('\n').map((l, i) => (i && l ? ' '.repeat(mark.length + 1) + l : l)).join('\n')}`;
      })
      .join('\n');
  },
  table: (b) => {
    const cell = (c) => richOf(c).replace(/\|/g, '\\|');
    const head = b.props.head.list.map(cell);
    const align = (b.props.align?.list ?? []).map((a) => a.case.name);
    const sep = head.map((_, i) => (align[i] === 'CENTER' ? ':---:' : align[i] === 'END' ? '---:' : '---'));
    return [head, sep, ...b.props.rows.list.map((r) => r.list.map(cell))].map((r) => `| ${r.join(' | ')} |`).join('\n');
  },
  footnote: (b) => `[^${b.props.mark.text}]: ${md(b.slots.body)}`,
};

function args(b) {
  const out = Object.entries(b.props ?? b.args ?? {}).map(([k, v]) => [k, val(v)]);
  for (const [k, place] of Object.entries(b.writes ?? {})) out.push([k, val({ place })]);
  for (const [k, h] of Object.entries(b.events ?? {})) out.push([k, E.lambda([], stmts(handlers.get(h)))]);
  return out;
}

function call(b) {
  const slots = slotsOf.get(b.name) ?? [];
  const filled = Object.entries(b.slots ?? {}).filter(([, ns]) => ns.length);
  const name = use(b.name);
  if (!filled.length) return P.call(name, args(b));
  if (slots.length === 1) return P.call(name, args(b), prose(filled[0][1]));
  return P.call(name, args(b), null, filled.map(([s, ns]) => [s, prose(ns)]));
}

/** A view in code (a widget's own): the same, as statements. */
function view(nodes) {
  return nodes.map((n) => {
    const [k] = Object.keys(n);
    const b = n[k];
    if (k === 'extern' || k === 'use') {
      const slots = slotsOf.get(b.name) ?? [];
      const filled = Object.entries(b.slots ?? {}).filter(([, ns]) => ns.length);
      if (!filled.length) return S.call(use(b.name), args(b));
      if (slots.length === 1) return S.call(use(b.name), args(b), view(filled[0][1]));
      return S.call(use(b.name), args(b), null, filled.map(([s, ns]) => [s, view(ns)]));
    }
    if (k === 'for') return S.for(b.name, val(b.over), view(b.body), b.position ?? null, b.mut);
    if (k === 'if') return S.if(b.branches.map((br) => [val(br.when), view(br.then)]), b.else?.length ? view(b.else) : null);
    if (k === 'slot') return S.expr(E.view({ name: b.name ?? b.slot, args: [] }));
    todo.push(`a ${k} in a view`);
    return S.comment(`TODO: a ${k}`);
  });
}

// ---------------------------------------------------------------------------------------------
// The document module

const decls = [];
for (const { declare } of ir.declarations) {
  const [k] = Object.keys(declare);
  const d = declare[k];
  const name = d.name ?? d.widget?.name ?? d.channel?.name;
  if (!name?.startsWith('doc/') && k !== '$state') continue;
  if (k === 'record') decls.push(D.record(short(name), d.fields.map((f) => ({ name: f.name, type: type(f.type), default: f.default ? val(f.default) : undefined }))));
  else if (k === 'enum') decls.push(D.enum(short(name), d.cases.map((c) => c.name)));
  else if (k === 'let') decls.push(D.let(short(name), type(d.type), val(d.value)));
  else if (k === '$state') decls.push(D.state(d.fields.map((f) => ({ name: f.name, type: type(f.type), default: val(f.default) }))));
  else if (k === 'fn') decls.push(D.fn(short(name).replace(/^([a-z_]+)\./, '$1.'), d.params.map((p) => [p.name, p.name === 'self' ? null : type(p.type)]), d.returns ? type(d.returns) : null, stmts(d.body)));
  else todo.push(`the declaration ${k} ${name}`);
}
for (const t of ir.templates) {
  if (!t.name.startsWith('doc/')) continue;
  decls.push(
    D.widget({
      name: short(t.name),
      params: t.inputs.map((i) => ({ name: i.name, type: type(i.type), default: i.default ? val(i.default) : undefined, mut: i.mut })),
      slots: t.slots.map((s) => [s.name, type(s.type)]),
      events: t.events.map((e) => e.name),
      body: t.cells.map((c) => (c.mut ? S.mut(c.name, type(c.type), val(c.default)) : S.let(c.name, type(c.type), val(c.default)))),
      view: view(t.view),
      markdown: prose(t.markdown),
    }),
  );
}
const doc = ir.templates.find((t) => t.name === 'doc');
const body = prose(doc.view);
const front = ir.front_matter ? `---\n${ir.front_matter}\n---` : null;
const head = [...[...packs].sort().map((p) => D.import(p)), ...todo.map((t) => D.comment(`TODO: ${t}`))];
process.stdout.write(document({ front, decls: [...head, ...decls], body }));
