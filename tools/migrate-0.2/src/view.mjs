// A document's own definitions (its ```mkp fences, kind widget or part) as 0.3 widgets: inputs, the
// widget's own variables, derived values, events, the view tree and the Markdown projection.
// Covered: the layout boxes, text, icon, press, meter, slider, field, image, frame, pane, overlay and
// the Markdown blocks; each, switch, slot, fill and if=; set and emit; project md built from text.
// Anything else throws Unsupported, and the definition falls back (see migrate.mjs).

import { D, E, S, P, expr as printExpr } from './tree.mjs';
import { Unsupported, CORE_NAMES } from './context.mjs';
import { expr, value, typeOf, typeOfA, itemType, resolve, scopeOf, child } from './values.mjs';
import { inlineProse } from './prose.mjs';

// 0.3 defaults that differ from 0.2's, written out so a migrated box keeps its look
const BOX = {
  props: ['align', 'justify', 'gap', 'pad', 'fill', 'stroke', 'edge', 'radius', 'shadow'],
  enums: { align: 'align', justify: 'justify', edge: 'edge' },
  default02: { align: 'start' },
};

/** 0.2 base widget → how to write it in 0.3 */
const BASE = {
  column: { to: 'column', ...BOX, slot: 'children' },
  row: { to: 'row', ...BOX, props: [...BOX.props, 'wrap'], slot: 'children' },
  grid: { to: 'grid', ...BOX, slot: 'children', grid: true },
  stack: { to: 'stack', props: ['align', 'justify', 'pad'], enums: { align: 'align', justify: 'justify' }, default02: {}, slot: 'children' },
  icon: { to: 'icon', props: ['name', 'tone', 'size', 'label'], enums: { size: 'text_size' }, glyph: ['name'], default02: {} },
  press: { to: 'press', props: ['label', 'kind', 'selected', 'disabled', 'tone'], enums: { kind: 'press_kind' }, default02: {}, slot: 'content', events: { click: 'click' } },
  meter: { to: 'meter', props: ['value', 'max', 'label', 'tone'], default02: {} },
  image: { to: 'image', props: ['src', 'alt'], default02: {} },
  frame: { to: 'frame', props: ['title'], default02: {}, slot: 'body' },
  pane: { to: 'pane', props: ['title', 'note'], default02: {}, slot: 'body' },
  heading: { to: 'heading', props: ['level', 'text'], rename: { text: 'value' }, default02: {} },
  paragraph: { to: 'paragraph', props: ['text'], rename: { text: 'value' }, default02: {} },
  code: { to: 'code', props: ['src', 'lang'], default02: {} },
  math: { to: 'math', props: ['tex'], default02: {} },
  divider: { to: 'divider', props: [], default02: {} },
};

export class DefWriter {
  constructor(m, decls, names) {
    this.m = m;
    /** the Decls the enums and records go to: the document's, or a pack shim's */
    this.decls = decls;
    /** 0.2 def id → { name, w } for the definitions that can be used: the document's, or the pack's */
    this.names = names;
    this.pack = decls.pack;
  }

  at(pos) {
    return { line: pos?.[0], pack: this.pack, sink: this.decls };
  }

  /** A 0.2 definition as a 0.3 widget declaration. */
  widget(d) {
    const m = this.m;
    const name = this.names.get(d.id).name;
    const scope = scopeOf({ pack: this.pack });
    const params = [];
    const slots = [];
    const body = [];
    for (const inp of d.inputs) {
      const t = resolve(m, inp.type, this.pack);
      const n = m.safe(inp.name, t.t === 'slot' ? CORE_NAMES : undefined);
      if (t.t === 'slot') {
        slots.push([n, 'view']);
        scope.inst.set(inp.name, E.name(n));
        scope.types.set(inp.name, inp.type);
        continue;
      }
      const f = this.decls.field(inp.name, inp.type, inp.default, { ...this.at(inp.pos), hint: `${name}_${inp.name}` });
      if (inp.about) f.about = inp.about;
      if (inp.comment?.length) f.comments = inp.comment;
      params.push(f);
      scope.inst.set(inp.name, E.name(f.name));
      scope.types.set(inp.name, inp.type);
    }
    for (const o of d.outs ?? []) {
      if (o.payload) throw new Unsupported(`the out ${o.name} carries a payload`);
      body.push({ k: 'event', name: m.safe(o.name), comments: o.comment });
    }
    // a value's comments go above it; a gap in the 0.2 source between two values stays a blank line
    let last = null;
    const place = (v, stmtsOf) => {
      const first = (v.pos?.[0] ?? 0) - (v.comment?.length ?? 0);
      if (last !== null && first - last > 1) body.push(S.blank());
      if (v.comment?.length) body.push(S.comment(v.comment.join('\n')));
      body.push(...stmtsOf);
      last = v.pos?.[0] ?? last;
    };
    if (d.signals?.length || d.commands?.length) throw new Unsupported('signals and commands (an extern channel in 0.3)');
    for (const v of d.values ?? []) {
      const n = m.safe(v.name);
      const at = this.at(v.pos);
      if (v.k === 'var' || (v.k === 'state' && v.control === 'slider')) {
        const t = typeOf(m, v.type, { ...at, hint: `${name}_${v.name}` });
        const init = 'ast' in (v.default ?? {}) ? expr(m, v.default.ast, scope, at, v.type) : value(m, v.default, v.type, at, scope);
        place(v, [S.mut(n, t.none ? `opt<${t.src}>` : t.src, init)]);
        if (v.k === 'state') m.todo(at.line, `${v.name}'s slider in the widget's control bar has no 0.3 bar: place @slider(value = ${n}, …) in the view`);
      } else if (v.k === 'derived') {
        const t = typeOf(m, v.value.type, { ...at, hint: `${name}_${v.name}` });
        place(v, [S.let(n, t.src, expr(m, v.value.ast, scope, at, v.value.type))]);
      } else if (v.k === 'fn') {
        continue; // its body is in the definition's fn table, written below
      } else throw new Unsupported(`a widget's ${v.k}${v.control ? ' ' + v.control : ''} value`);
      scope.inst.set(v.name, E.name(n));
      scope.types.set(v.name, v.k === 'derived' ? v.value.type : v.type);
    }
    scope.fnDefs = new Map(Object.entries(d.fns ?? {}));
    for (const [id, f] of Object.entries(d.fns ?? {})) scope.fns.set(id, m.safe(f.name));
    // a fn's comments are on its value line (fn name(…) = …)
    const fnComments = new Map((d.values ?? []).filter((v) => v.k === 'fn').map((v) => [v.fn, v.comment]));
    const fns = Object.entries(d.fns ?? {}).map(([id, f]) => ({ ...this.fn(f, scope), comments: fnComments.get(id) }));
    const view = this.nodes(d.view ?? [], scope);
    const markdown = d.project?.md ? this.markdown(d.project.md, scope, d) : null;
    const events = body.filter((b) => b.k === 'event').map((b) => (b.comments?.length ? { name: b.name, comments: b.comments } : b.name));
    const own = body.filter((b) => b.k !== 'event');
    return {
      name,
      comments: d.comment,
      about: d.about,
      params,
      slots,
      events,
      body: fns.length && own.length ? [...own, S.blank(), ...fns] : [...own, ...fns],
      view,
      markdown,
    };
  }

  fn(f, scope) {
    const m = this.m;
    if (!f.types) throw new Unsupported(`the fn ${f.name} has no parameter types`);
    const at = this.at(f.pos);
    const locals = new Map(f.params.map((p, i) => [p, [E.name(m.safe(p)), f.types[i]]]));
    const params = f.params.map((p, i) => [m.safe(p), optOf(typeOf(m, f.types[i], at))]);
    const ret = f.ret ? typeOf(m, f.ret, at) : null;
    return { k: 'fndecl', name: m.safe(f.name), params, ret: ret ? (ret.none ? `opt<${ret.src}>` : ret.src) : null, body: [S.ret(expr(m, f.body, child(scope, locals), at, f.ret))] };
  }

  /** project md as a markdown block: text joined with + is prose with holes. */
  markdown(md, scope, d) {
    const m = this.m;
    const at = this.at(md.pos);
    const hole = (a, s) => `\\{${printExpr(expr(m, a, s, at), '')}}`;
    const lines = (a, s) => {
      if (a.t === 'str') return [P.md(inlineProse(a.v))];
      if (a.t === 'builtin' && a.fn === 'cat') {
        const parts = [];
        const flat = (y) => (y.t === 'builtin' && y.fn === 'cat' ? y.args.forEach(flat) : parts.push(y));
        a.args.forEach(flat);
        return [P.md(parts.map((p) => (p.t === 'str' ? inlineProse(p.v) : hole(p, s))).join(''))];
      }
      if (a.t === 'if') return [P.if(expr(m, a.c, s, at, { t: 'bool' }), lines(a.a, s), lines(a.b, s))];
      // join(map(xs, x => …), "\n"): one line per item
      if (a.t === 'builtin' && a.fn === 'join' && a.args[0].t === 'builtin' && a.args[0].fn === 'map' && a.args[0].args[1].t === 'lam') {
        const [xs, lam] = a.args[0].args;
        const v = m.safe(lam.params[0]);
        const xt = typeOfA(m, xs, s);
        return [P.for(v, expr(m, xs, s, at), lines(lam.body, child(s, new Map([[lam.params[0], [E.name(v), itemType(xt)]]]))))];
      }
      return [P.md(hole(a, s))];
    };
    try {
      return lines(md.ast, scope);
    } catch (e) {
      if (!(e instanceof Unsupported)) throw e;
      m.lossy(at.line, `${d.name}'s project md was left out (${e.what}); 0.3 builds a document widget's Markdown from its view`);
      return null;
    }
  }

  /** Sibling view nodes, with their comments, and a blank line wherever the 0.2 source had one. */
  nodes(ns, scope) {
    const out = [];
    let last = null;
    for (const n of ns) {
      const comments = n.meta?.comment ?? [];
      const first = (n.pos?.[0] ?? 0) - comments.length;
      if (last !== null && n.pos && first - last > 1) out.push(S.blank());
      if (comments.length) out.push(S.comment(comments.join('\n')));
      out.push(...this.node(n, scope));
      last = lastLine(n) ?? last;
    }
    return out;
  }

  /** One 0.2 view node as 0.3 view statements. */
  node(n, scope) {
    const m = this.m;
    const at = this.at(n.pos);
    let out = this.bare(n, scope, at);
    const meta = n.meta ?? {};
    if (meta.id) m.lossy(at.line, `the element id ${typeof meta.id === 'string' ? meta.id : '(computed)'} was dropped: 0.3 has no ids`);
    if (meta.hidden || meta.keep || meta.span || meta.basis || meta.self) throw new Unsupported('hidden, keep, span, basis or self on an element');
    if (meta.grow) out = [S.call('grow', [], out)];
    if (meta.if) out = [S.if([[expr(m, meta.if.ast, scope, at, { t: 'bool' }), out]])];
    return out;
  }

  bare(n, scope, at) {
    const m = this.m;
    switch (n.node) {
      case 'each':
        return this.each(n, scope, at);
      case 'switch': {
        const subject = expr(m, n.subject.ast, scope, at);
        const t = resolve(m, n.subject.type, this.pack);
        const cases = n.cases.map((c) => [[this.pattern(c.value, t, at)], this.nodes(c.children, scope)]);
        if (n.else) cases.push([['else'], this.nodes(n.else, scope)]);
        else if (t.t !== 'choice') cases.push([['else'], []]);
        return [S.match(subject, cases)];
      }
      case 'slot': {
        const a = n.value?.ast;
        if (a?.t === 'var' && scope.inst.has(a.name)) return [S.expr(E.view({ name: scope.inst.get(a.name).n, args: [] }))];
        throw new Unsupported(`a slot placed from a list (slot ${n.value?.expr ?? '…'})`);
      }
      case 'text':
        return [this.text(n, scope, at)];
      case 'range':
        return [this.slider(n, scope, at)];
      case 'field':
        return [this.field(n, scope, at)];
      case 'overlay':
        return [this.overlay(n, scope, at)];
    }
    if (BASE[n.node] && n.def?.startsWith('core:')) return [this.base(n, scope, at)];
    if (n.def && this.names.has(n.def)) return [this.use(n, scope, at)];
    throw new Unsupported(`the 0.2 ${n.node} element`);
  }

  pattern(v, t, at) {
    if ('lit' in v) {
      if (t.t === 'choice') return `${this.decls.enumFor(t.name, t.opts, at.hint)}.${this.m.caseName(v.lit)}`;
      if (typeof v.lit === 'string') return JSON.stringify(v.lit);
      return String(v.lit);
    }
    if ('text' in v) return JSON.stringify(v.text);
    throw new Unsupported('a case pattern that is not a literal');
  }

  /** each k in 0..(len(xs) - 1): a walk over xs, with xs[k] read as its item. */
  each(n, scope, at) {
    const m = this.m;
    const k = m.safe(n.var);
    const over = n.in?.ast ?? n.in;
    const isLenRange = (a) =>
      a?.t === 'builtin' && a.fn === 'range' && a.args[0].t === 'num' && a.args[0].v === 0 && a.args[1].t === 'builtin' && a.args[1].fn === '-' && a.args[1].args[1].t === 'num' && a.args[1].args[1].v === 1 && a.args[1].args[0].t === 'builtin' && a.args[1].args[0].fn === 'len';
    const rangeOf = n.in?.range ? { lo: n.in.range[0], hi: n.in.range[1] } : null;
    let xsAst = null;
    if (isLenRange(over)) xsAst = over.args[1].args[0].args[0];
    else if (rangeOf && 'ast' in rangeOf.hi && rangeOf.hi.ast.t === 'builtin' && rangeOf.hi.ast.fn === '-' && rangeOf.hi.ast.args[0].fn === 'len' && rangeOf.lo.lit === 0) xsAst = rangeOf.hi.ast.args[0].args[0];
    if (xsAst) {
      const item = m.safe(`${n.var}_item`);
      const xt = typeOfA(m, xsAst, scope);
      const inner = child(scope, new Map([[n.var, [E.name(k), { t: 'int' }]]]));
      inner.rewrite = [...scope.rewrite, [{ t: 'index', o: xsAst, i: { t: 'var', name: n.var, from: 'local' } }, E.name(item)]];
      inner.types.set(`${n.var}_item`, itemType(xt));
      return [S.for(item, expr(m, xsAst, scope, at), this.nodes(n.children ?? [], inner), k)];
    }
    if (rangeOf) {
      const lo = value(m, rangeOf.lo, { t: 'int' }, at, scope);
      const hi = value(m, rangeOf.hi, { t: 'int' }, at, scope);
      return [S.for(k, E.range(lo, hi), this.nodes(n.children ?? [], child(scope, new Map([[n.var, [E.name(k), { t: 'int' }]]]))))];
    }
    if (n.in && 'ast' in n.in) {
      const xt = typeOfA(m, n.in.ast, scope) ?? resolve(m, n.in.type ?? { t: 'unknown' }, this.pack);
      const of = itemType(xt);
      return [S.for(k, expr(m, n.in.ast, scope, at), this.nodes(n.children ?? [], child(scope, new Map([[n.var, [E.name(k), of]]]))))];
    }
    throw new Unsupported('an each over something other than a list or a range');
  }

  /** An argument value read in this scope. */
  arg(v, t02, scope, at) {
    return value(this.m, v, t02, at, scope);
  }

  input02(n, name) {
    return this.m.def(n.def)?.inputs.find((i) => i.name === name);
  }

  base(n, scope, at) {
    const m = this.m;
    const spec = BASE[n.node];
    const args = [];
    const props = { ...(n.props ?? {}) };
    for (const [k, d] of Object.entries(spec.default02 ?? {})) if (!(k in props)) props[k] = { lit: d };
    if (n.node === 'column' || n.node === 'row') {
      if ('tint' in props && !('fill' in props)) {
        props.fill = props.tint;
        m.lossy(at.line, 'tint (a wash of a colour) became fill');
      }
      if (('padx' in props || 'pady' in props) && !('pad' in props)) {
        props.pad = props.padx ?? props.pady;
        m.lossy(at.line, 'padx/pady became one pad: 0.3 pads all sides alike');
      }
    }
    for (const [k, v] of Object.entries(props)) {
      if (k === 'tint' || k === 'padx' || k === 'pady' || k === 'cols') continue;
      if (!spec.props.includes(k)) {
        m.lossy(at.line, `${n.node} ${k}=… has no 0.3 input and was dropped`);
        continue;
      }
      const inp = this.input02(n, k);
      let e;
      if (spec.enums?.[k] && 'lit' in v) e = E.case(spec.enums[k], m.caseName(v.lit));
      else if (spec.glyph?.includes(k) && 'lit' in v) {
        if (v.lit === 'none') continue;
        e = E.case('glyph', m.caseName(v.lit));
      }
      else e = this.arg(v, inp?.type, scope, at);
      if (e.k === 'case' && e.type === 'opt') continue;
      args.push([spec.rename?.[k] ?? k, e]);
    }
    if (spec.grid) {
      const c = props.cols;
      if (!c) throw new Unsupported('a grid with no cols');
      if ('lit' in c && typeof c.lit === 'number') args.unshift(['cols', E.case('cols', 'EQUAL', [E.num(c.lit)])]);
      else if ('ast' in c && ['num', 'int'].includes(c.type?.t ?? typeOfA(m, c.ast, scope)?.t)) args.unshift(['cols', E.case('cols', 'EQUAL', [expr(m, c.ast, scope, at)])]);
      else throw new Unsupported('grid cols as tracks');
    }
    if (n.node === 'press' && !args.some(([k]) => k === 'label')) {
      // 0.3's press needs a label (what it says to a reader without the view): the text it holds
      const t = (n.children ?? []).find((c) => c.node === 'text')?.props?.value;
      args.unshift(['label', t ? this.arg(t, { t: 'text' }, scope, at) : E.text('')]);
    }
    const events = this.events(n, scope, at, spec.events ?? { click: 'click' });
    args.push(...events);
    const kids = this.nodes(n.children ?? [], scope);
    if (n.fills) throw new Unsupported(`fill on a ${n.node}`);
    const name = n.node === 'icon' && n.props?.name && 'ast' in n.props.name ? typeOfA(m, n.props.name.ast, scope) : null;
    if (name?.t === 'icon') {
      // 0.2's icon name could be none, and then nothing was drawn; 0.3's icon needs a glyph: open it
      const g = m.safe('glyph_');
      const opened = args.find(([k]) => k === 'name')[1];
      return S.if([[{ k: 'open', name: g, type: 'glyph', value: opened }, [S.call(spec.to, args.map(([k, v]) => [k, k === 'name' ? E.name(g) : v]), kids.length ? kids : null)]]]);
    }
    return S.call(spec.to, args, kids.length ? kids : null);
  }

  /** 0.2 text is inline Markdown: plain words become a label, anything with markup a paragraph. */
  text(n, scope, at) {
    const m = this.m;
    const v = n.props?.value ?? { text: '' };
    const markup = (s) => /[*_`[\]$\\]/.test(s);
    // the words as written, holes aside: \val{…} is no markup
    const src = 'text' in v ? v.text : v.ast?.t === 'tmpl' ? v.ast.v.replace(/\\val\{\d+\}/g, '') : v.ast?.t === 'str' ? v.ast.v : '';
    const args = [];
    const val = this.arg(v, { t: 'text' }, scope, at);
    if (markup(src) && (('text' in v) || v.ast?.t === 'tmpl' || v.ast?.t === 'str')) {
      m.lossy(at.line, 'a text with inline Markdown became a paragraph (0.3 labels are plain)');
      return S.call('paragraph', [['value', val]]);
    }
    args.push(['value', val]);
    const p = n.props ?? {};
    if (p.tone) {
      const e = this.arg(p.tone, { t: 'token', kind: 'color' }, scope, at);
      if (!(e.k === 'case' && e.type === 'opt')) args.push(['tone', e]);
    }
    if (p.size && 'lit' in p.size) args.push(['size', E.case('text_size', m.caseName(p.size.lit))]);
    if (p.weight && 'lit' in p.weight) args.push(['weight', E.case('weight', m.caseName(p.weight.lit))]);
    if (p.font && 'tok' in p.font && p.font.tok !== 'body') args.push(['font', E.case('font', m.caseName(p.font.tok))]);
    if (p.align && 'lit' in p.align) args.push(['align', E.case('align', m.caseName(p.align.lit))]);
    if (p.wrap && 'lit' in p.wrap) args.push(['wrap', E.bool(p.wrap.lit)]);
    if (p.clip && 'lit' in p.clip) args.push(['clip', E.bool(p.clip.lit)]);
    for (const k of Object.keys(p)) if (!['value', 'tone', 'size', 'weight', 'font', 'align', 'wrap', 'clip'].includes(k)) m.lossy(at.line, `text ${k}=… has no 0.3 label input and was dropped`);
    return S.call('label', args);
  }

  slider(n, scope, at) {
    const m = this.m;
    const p = n.props ?? {};
    if (!p.value || !('ast' in p.value) || p.value.ast.t !== 'var') throw new Unsupported('a range whose value is not a variable');
    const args = [['value', expr(m, p.value.ast, scope, at)], ['label', p.label ? this.arg(p.label, { t: 'text' }, scope, at) : E.text('')]];
    if (p.min && p.max) args.push(['range', E.range(this.arg(p.min, { t: 'num' }, scope, at), this.arg(p.max, { t: 'num' }, scope, at))]);
    if (n.on && Object.keys(n.on).length) throw new Unsupported('a range with @change actions');
    return S.call('slider', args);
  }

  field(n, scope, at) {
    const m = this.m;
    const p = n.props ?? {};
    if (!p.value || !('ast' in p.value) || p.value.ast.t !== 'var') throw new Unsupported('a field whose value is not a variable');
    if (p.kind && p.kind.lit === 'number') throw new Unsupported('a number field (0.3 fields hold text)');
    const args = [['value', expr(m, p.value.ast, scope, at)], ['label', p.label ? this.arg(p.label, { t: 'text' }, scope, at) : E.text('')]];
    if (p.placeholder) args.push(['placeholder', this.arg(p.placeholder, { t: 'text' }, scope, at)]);
    args.push(...this.events(n, scope, at, { submit: 'submit' }));
    return S.call('field', args);
  }

  overlay(n, scope, at) {
    const p = n.props ?? {};
    const args = [['label', p.label ? this.arg(p.label, { t: 'text' }, scope, at) : E.text('')]];
    if (p.mode && 'lit' in p.mode) args.push(['mode', E.case('overlay_mode', this.m.caseName(p.mode.lit))]);
    const anchor = this.nodes(n.children ?? [], scope);
    const body = this.nodes(n.fills?.body ?? [], scope);
    return S.call('overlay', args, null, [['anchor', anchor], ['body', body]]);
  }

  /** @click set n=(…) and friends: an event set to a fn. */
  events(n, scope, at, names) {
    const out = [];
    for (const [ev, actions] of Object.entries(n.on ?? {})) {
      const to = names[ev];
      if (!to) throw new Unsupported(`the event @${ev} on ${n.node}`);
      out.push([to, E.lambda([], this.actions(actions, scope, at))]);
    }
    return out;
  }

  actions(list, scope, at) {
    const m = this.m;
    return list.flatMap((a) => {
      switch (a.a) {
        case 'set': {
          const target = a.target === 'state' ? E.state(a.name) : scope.inst.get(a.name) ?? E.name(m.safe(a.name));
          return [S.assign(target, expr(m, a.value.ast, scope, at, scope.types.get(a.name) ?? a.value.type))];
        }
        case 'emit':
          if (a.payload?.length) throw new Unsupported('an emit with a payload');
          return [S.invoke(m.safe(a.name))];
        case 'when':
          return [S.if([[expr(m, a.cond.ast, scope, at, { t: 'bool' }), this.actions(a.actions, scope, at)]])];
        default:
          throw new Unsupported(`the action ${a.a}`);
      }
    });
  }

  /** A use of one of the document's own widgets inside a view. */
  use(n, scope, at) {
    const m = this.m;
    const { name } = this.names.get(n.def);
    const d = m.def(n.def);
    // a pack's part is declared in the pack the first time a widget of it uses it
    this.decls.want?.(n.def);
    const args = [];
    for (const [k, v] of Object.entries(n.props ?? {})) {
      const inp = d.inputs.find((i) => i.name === k);
      if (!inp) throw new Unsupported(`${d.name} has no input ${k}`);
      args.push([m.safe(k), this.arg(v, inp.type, scope, at)]);
    }
    if (n.records?.length) throw new Unsupported('record lines in a use inside a view');
    args.push(...this.events(n, scope, at, Object.fromEntries((d.outs ?? []).map((o) => [o.name, m.safe(o.name)]))));
    const kids = this.nodes(n.children ?? [], scope);
    return S.call(name, args, kids.length ? kids : null);
  }
}

/** A pack's or the document's top-level fns (fn … = … lines), as 0.3 fns; one that can't be written is a TODO. */
export function fnDecls(m, sink, pack, scope = scopeOf({ pack })) {
  // a fn that calls one that failed fails too: go round until nothing more fails
  for (let round = 0; round < 4; round++) {
    const before = m.failedFns.size;
    const out = fnDeclsOnce(m, sink, pack, scope);
    if (m.failedFns.size === before) {
      return out;
    }
  }
  return [];
}

function fnDeclsOnce(m, sink, pack, scope) {
  const out = [];
  for (const [id, f] of Object.entries(m.b.fns ?? {})) {
    if (m.failedFns.has(id)) continue;
    if (!id.startsWith(`${pack}:`) || f.generic) continue;
    const at = { line: f.pos?.[0], pack, sink };
    try {
      if (f.op) throw new Unsupported(`an operator (op ${f.op}): 0.3 joins a type to an operator through an interface`);
      if (!f.types) throw new Unsupported('a fn without parameter types');
      const params = f.params.map((p, i) => [m.safe(p), optOf(typeOf(m, f.types[i], at))]);
      if (params.some(([, t]) => /^[A-Z]/.test(t))) throw new Unsupported('a generic fn');
      const locals = new Map(f.params.map((p, i) => [p, [E.name(m.safe(p)), f.types[i]]]));
      const ret = f.ret ? typeOf(m, f.ret, at) : null;
      out.push(D.fn(m.safe(f.name), params, ret ? (ret.none ? `opt<${ret.src}>` : ret.src) : null, [S.ret(expr(m, f.body, child(scope, locals), at, f.ret))]));
    } catch (e) {
      if (!(e instanceof Unsupported)) throw e;
      m.failedFns.add(id);
      m.todo(at.line, `the fn ${f.name} was not migrated: ${e.what}`);
    }
  }
  return out;
}

/** A 0.2 type that had `none` is an opt in 0.3. */
function optOf(t) {
  return t.none ? `opt<${t.src}>` : t.src;
}

/** The last 0.2 source line a view node or its children start on. */
function lastLine(n) {
  let l = n.pos?.[0] ?? null;
  const kids = [...(n.children ?? []), ...(n.records ?? []), ...(n.else ?? []), ...(n.cases ?? []).flatMap((c) => c.children), ...Object.values(n.fills ?? {}).flat()];
  for (const k of kids) {
    const x = lastLine(k);
    if (x !== null && (l === null || x > l)) l = x;
  }
  for (const a of Object.values(n.on ?? {}).flat()) if (a.value?.pos?.[0] > (l ?? 0)) l = a.value.pos[0];
  return l;
}
