// Types, values and expressions: 0.2's (packages/core/src/types.ts and ir.ts, shape 1) to 0.3's.
// The 0.2 IR is typed and resolved, so every conversion here starts from what a value IS, never from
// how it was spelled: a choice option becomes its enum's case, a token its token case, an operator on
// text a template literal.

import { E, S } from './tree.mjs';
import { Unsupported } from './context.mjs';

const TOKEN_KINDS = new Set(['color', 'font', 'space', 'size', 'radius', 'shadow']);

/** A 0.2 type with its names looked up: named types to what they name. */
export function resolve(m, t, pack) {
  let seen = 0;
  while (t?.t === 'named' && seen++ < 8) {
    if (t.name === 'iconname') return { t: 'icon' };
    const r = m.named(t.name, pack);
    if (!r) return t;
    t = r.t === 'choice' ? { ...r, name: t.name } : r;
  }
  return t;
}

function contract(lo, hi) {
  if (lo !== undefined && hi !== undefined) return ` ${num(lo)}..${num(hi)}`;
  if (lo !== undefined) return ` ${num(lo)}...`;
  if (hi !== undefined) return ` ...${num(hi)}`;
  return '';
}

function num(v) {
  if (v === Infinity) return '1e308';
  return String(v);
}

/**
 * A 0.2 type as 0.3. `at.sink` declares the enums and records it needs (the document, or a pack shim);
 * `at.hint` names an inline choice's enum; `at.rich` makes text fields rich_text (0.2's `text` widget
 * reads its value as inline Markdown, 0.3's label never does).
 * Returns { src, none } where `none` says the 0.2 type had a `none` value, which 0.3 writes as opt.
 */
export function typeOf(m, t, at) {
  t = resolve(m, t, at.pack);
  switch (t.t) {
    case 'num':
      return { src: 'number' + contract(t.lo, t.hi) };
    case 'int':
      return { src: 'int' + contract(t.lo, t.hi) };
    case 'bool':
      return { src: 'bool' };
    case 'text':
      return { src: at.rich ? 'rich_text' : 'text' };
    case 'latex':
      return { src: 'latex' };
    case 'point':
      return { src: 'point' };
    case 'duration':
      return { src: 'duration' };
    case 'range':
      return { src: 'range<number>' };
    case 'icon':
      return { src: 'glyph', none: true, icon: true };
    case 'token':
      // 0.2's tokens all had a `none`; 0.3 writes "no colour" as opt.NONE
      return { src: t.kind, none: true, token: t.kind };
    case 'choice': {
      // a choice's `none` stays one of its cases: 0.2 compared, showed and defaulted it like any other
      const name = at.sink.enumFor(t.name, t.opts, at.hint);
      return { src: name, enum: name };
    }
    case 'list': {
      const of = typeOf(m, t.of, { ...at, hint: at.hint + '_item' });
      return { src: `list<${of.none ? `opt<${of.src}>` : of.src}>` };
    }
    case 'dict': {
      const of = typeOf(m, t.of, at);
      m.lossy(at.line, `a dict(${of.src}) became core's map<${of.src}>, which is a record of keys and values, not a built-in`);
      return { src: `map<${of.src}>` };
    }
    case 'rec': {
      const name = at.sink.recordFor(t.name, t.fields, t.defaults, at);
      return { src: name };
    }
    case 'records': {
      if (t.slot) throw new Unsupported('a list of records with content is a list slot in 0.3; handled by the widget');
      const name = at.sink.recordFor(t.kind, t.fields, t.defaults, at);
      return { src: `list<${name}>` };
    }
    case 'slot':
      return { src: 'view', slot: true };
    case 'ref':
      m.lossy(at.line, 'a `ref` input became a `mut` input: the caller passes a variable, as $state.name');
      return { ...typeOf(m, t.of, at), mut: true };
    case 'fn': {
      const ps = t.params.map((p, i) => `${'abcdefgh'[i]}: ${typeOf(m, p, at).src}`).join(', ');
      return { src: `fn(${ps}): ${typeOf(m, t.ret, at).src}` };
    }
    case 'expr': {
      const ps = t.vars.map(([n, ty]) => `${n}: ${typeOf(m, ty, at).src}`).join(', ');
      return { src: `fn(${ps}): ${typeOf(m, t.ret, at).src}` };
    }
    case 'param':
      return { src: t.name.toUpperCase() };
    case 'named':
      throw new Unsupported(`the type ${t.name} has no 0.3 equivalent here`);
    default:
      throw new Unsupported(`the 0.2 type ${t.t} has no 0.3 equivalent`);
  }
}

// ---------------------------------------------------------------------------------------------
// Values (IRVal), as written in YAML blocks, container arguments and defaults

/** The 0.3 case for a 0.2 token name (ok → color.OK), or opt.NONE. */
export function token(m, kind, name, line) {
  if (name === 'none') return E.none();
  if (kind === 'size' && name === 'fill') throw new Unsupported('size=fill has no 0.3 token: a box that fills is @grow');
  return E.case(kind, m.caseName(name));
}

/** A 0.2 value as a 0.3 expression, for a slot of 0.2 type `t02`; `scope` reads expressions. */
export function value(m, v, t02, at, scope = null) {
  const t = t02 ? resolve(m, t02, at.pack) : undefined;
  if (v == null) throw new Unsupported('a value with nothing in it');
  if ('ref' in v) return E.state(v.ref);
  if ('tok' in v) return token(m, v.kind, v.tok, at.line);
  if ('ms' in v) return E.dur(v.ms);
  if ('range' in v) return E.range(value(m, v.range[0], { t: 'num' }, at, scope), value(m, v.range[1], { t: 'num' }, at, scope));
  if ('ast' in v && 'expr' in v) {
    if (!scope) throw new Unsupported(`an expression (${v.expr}) where no scope can read it`);
    return expr(m, v.ast, scope, at, t02 ?? v.type);
  }
  if ('tex' in v) return E.text(v.tex);
  if ('text' in v) {
    if (v.vals?.length) throw new Unsupported('a text with \\val holes outside a definition');
    return E.text(v.text);
  }
  if ('slot' in v) throw new Unsupported('slot content as a value');
  if ('lit' in v) return lit(m, v.lit, t, at);
  throw new Unsupported(`a 0.2 value of the shape ${Object.keys(v).join(',')}`);
}

export function lit(m, x, t, at) {
  if (t?.t === 'icon') return x === 'none' ? E.none() : E.case('glyph', m.caseName(x));
  if (t?.t === 'choice') return E.case(t.core ?? at.sink.enumFor(t.name, t.opts, at.hint), m.caseName(x));
  if (t?.t === 'token') return token(m, t.kind, x, at.line);
  if (t?.t === 'list' || Array.isArray(x)) {
    if (!Array.isArray(x)) throw new Unsupported('a list value that is not a list');
    const of = t?.t === 'list' ? resolve(m, t.of, at.pack) : undefined;
    return E.list(
      x.map((y) => lit(m, y, of, at)),
      x.length > 4,
    );
  }
  if (typeof x === 'boolean') return E.bool(x);
  if (typeof x === 'number') return E.num(x);
  if (typeof x === 'string') return E.text(x);
  if (x && typeof x === 'object') {
    if (t?.t === 'rec' || t?.t === 'point') {
      const fields = t.t === 'point' ? [['x', { t: 'num' }], ['y', { t: 'num' }]] : t.fields;
      const name = t.t === 'point' ? 'point' : at.sink.recordFor(t.name, t.fields, t.defaults, at);
      return E.rec(
        name,
        fields.filter(([k]) => k in x).map(([k, ft]) => [m.safe(k), lit(m, x[k], resolve(m, ft, at.pack), at)]),
      );
    }
    throw new Unsupported('a record value of no known record type');
  }
  throw new Unsupported(`the literal ${JSON.stringify(x)}`);
}

// ---------------------------------------------------------------------------------------------
// Expressions (the A tree)

/**
 * A scope reads names: `inst` (a widget's inputs, variables and derived values, or the document's
 * state), `locals` (lambda and loop variables), `consts`, `fns` (fn ids → names), `types` (each
 * name's 0.2 type, where it is known) and `rewrite` (expressions the caller has replaced, such as
 * xs[k] inside a loop over xs).
 */
export function scopeOf(over = {}) {
  return { inst: new Map(), locals: new Map(), consts: new Map(), fns: new Map(), types: new Map(), rewrite: [], ...over };
}

/** A scope with more locals: name → [0.3 expression, 0.2 type or undefined]. */
export function child(scope, locals) {
  const types = new Map(scope.types);
  const ls = new Map(scope.locals);
  for (const [k, v] of locals) {
    if (Array.isArray(v)) {
      ls.set(k, v[0]);
      if (v[1]) types.set(k, v[1]);
      else types.delete(k);
    } else {
      ls.set(k, v);
      types.delete(k);
    }
  }
  return { ...scope, locals: ls, types };
}

const ARITH = { '+': '+', '-': '-', '*': '*', '/': '/', mod: '%', '==': '==', '!=': '!=', '<': '<', '<=': '<=', '>': '>', '>=': '>=' };
const METHOD0 = { len: 'len', trim: 'trim', lower: 'lower', upper: 'upper', floor: 'floor', ceil: 'ceil', round: 'round', abs: 'abs', sin: 'sin', cos: 'cos', tan: 'tan', atan: 'atan', exp: 'exp', sign: 'sign', reverse: 'reversed', sort: 'sorted', first: 'first', last: 'last' };
const METHOD_OPT = { sqrt: 'sqrt', ln: 'ln', asin: 'asin', acos: 'acos', number: 'number' };
const METHOD1 = { startswith: 'starts', endswith: 'ends', contains: 'has', split: 'split', join: 'join', atan2: 'atan2', min: 'min', max: 'max', indexof: 'position', slice: 'slice' };

/** Same tree? (positions and types aside) */
function same(a, b) {
  return JSON.stringify(a) === JSON.stringify(b);
}

/**
 * The 0.2 type of an expression, where it can be told cheaply: names, fields, calls, branches.
 * 0.2's IR types each whole expression but not its parts, and a bare word (ok, check, done) is a
 * `str` whose meaning comes from where it is used, so the translation needs this to write it.
 */
export function typeOfA(m, a, scope, pack = scope.pack ?? '$doc') {
  const r = (t) => (t ? resolve(m, t, pack) : undefined);
  switch (a.t) {
    case 'num':
      return { t: 'num' };
    case 'bool':
      return { t: 'bool' };
    case 'str':
    case 'tmpl':
      return { t: 'text' };
    case 'var':
      if (a.name === '$width' || (a.name === 'width' && a.from !== 'local' && !scope.types.has('width'))) return { t: 'choice', opts: ['narrow', 'medium', 'wide'], core: 'width' };
      if (a.name === '$theme' || (a.name === 'theme' && a.from !== 'local' && !scope.types.has('theme'))) return { t: 'choice', opts: ['light', 'dark'], core: 'theme' };
      return r(scope.types.get(a.name));
    case 'field': {
      const o = typeOfA(m, a.o, scope, pack);
      const fs = o?.t === 'rec' || o?.t === 'records' ? o.fields : o?.t === 'point' ? [['x', { t: 'num' }], ['y', { t: 'num' }]] : null;
      return r(fs?.find(([k]) => k === a.name)?.[1]);
    }
    case 'index':
      return r(itemType(typeOfA(m, a.o, scope, pack)));
    case 'call': {
      const f = m.b.fns?.[a.fn] ?? scope.fnDefs?.get(a.fn);
      return r(f?.ret);
    }
    case 'if':
      return typeOfA(m, a.a, scope, pack) ?? typeOfA(m, a.b, scope, pack);
    case 'not':
    case 'and':
    case 'or':
      return { t: 'bool' };
    case 'builtin':
      if (['==', '!=', '<', '<=', '>', '>=', 'startswith', 'endswith', 'contains'].includes(a.fn)) return { t: 'bool' };
      if (['cat', 'format', 'join', 'lower', 'upper', 'trim'].includes(a.fn)) return { t: 'text' };
      if (['len', 'floor', 'ceil', 'round'].includes(a.fn)) return { t: 'int' };
      if (['+', '-', '*', '/', 'neg', 'min', 'max', 'abs', 'lsum', 'mod'].includes(a.fn)) return typeOfA(m, a.args[0], scope, pack) ?? { t: 'num' };
      if (a.fn === 'filter' || a.fn === 'reverse' || a.fn === 'sort') return typeOfA(m, a.args[0], scope, pack);
      return undefined;
  }
  return undefined;
}

/** The type of a list's items: a list's, or a list of records' record. */
export function itemType(t) {
  if (t?.t === 'list') return t.of;
  if (t?.t === 'records') return { t: 'rec', name: t.kind, fields: t.fields, defaults: t.defaults };
  return undefined;
}

/** `want` is the 0.2 type the value must have, where it is known: it decides what a bare word means. */
export function expr(m, a, scope, at, want) {
  const w = want ? resolve(m, want, at.pack ?? '$doc') : undefined;
  const x = (y, t, s = scope) => expr(m, y, s, at, t);
  for (const [from, to] of scope.rewrite) if (same(a, from)) return to;
  switch (a.t) {
    case 'num':
      return a.v < 0 ? E.un('-', E.num(-a.v)) : E.num(a.v);
    case 'bool':
      return E.bool(a.v);
    case 'str':
      if (w && (w.t === 'choice' || w.t === 'token' || w.t === 'icon')) return lit(m, a.v, w, { ...at, sink: at.sink });
      return E.text(a.v);
    case 'tmpl': {
      const parts = [];
      const re = /\\val\{(\d+)\}/g;
      let last = 0;
      for (let mm; (mm = re.exec(a.v)); ) {
        parts.push(a.v.slice(last, mm.index));
        const h = a.holes[Number(mm[1])];
        const shown = a.show?.[Number(mm[1])];
        parts.push(shown ? E.method(x(h), 'fmt', [E.num(String(shown).replace(/\D/g, '') || 0)]) : x(h));
        last = re.lastIndex;
      }
      parts.push(a.v.slice(last));
      return E.text(...parts.filter((p) => p !== ''));
    }
    case 'var': {
      if (a.from === 'local' && scope.locals.has(a.name)) return scope.locals.get(a.name);
      if (a.from === 'inst' && scope.inst.has(a.name)) return scope.inst.get(a.name);
      if (scope.locals.has(a.name)) return scope.locals.get(a.name);
      if (scope.inst.has(a.name)) return scope.inst.get(a.name);
      // 0.2's globals: the page's width and theme
      if (a.name === '$width' || (a.name === 'width' && a.from !== 'local')) return E.field(E.name('page'), 'width');
      if (a.name === '$theme' || (a.name === 'theme' && a.from !== 'local')) return E.field(E.name('page'), 'theme');
      if (a.from === 'const' || scope.consts.has(a.name)) {
        if (scope.consts.has(a.name)) return scope.consts.get(a.name);
        if (a.name === 'pi') return E.name('pi');
        if (a.name === 'e') return E.name('euler');
        if (a.name === 'tau') return E.bin('*', E.num(2), E.name('pi'));
        if (a.name === 'true' || a.name === 'false') return E.bool(a.name === 'true');
        if (a.name === 'width') return E.field(E.name('page'), 'width');
        if (a.name === 'theme') return E.field(E.name('page'), 'theme');
      }
      throw new Unsupported(`the name ${a.name} (${a.from}) is not visible in 0.3 here`);
    }
    case 'list':
      return E.list(a.items.map((i) => x(i, w?.t === 'list' ? w.of : undefined)));
    case 'rec': {
      // typed by where it goes: a named record when the wanted type is one
      const fs = w?.t === 'rec' ? new Map(w.fields) : new Map();
      const name = w?.t === 'rec' ? at.sink?.recordFor(w.name, w.fields, w.defaults, { ...at, pack: at.pack ?? '$doc' }) ?? '' : '';
      return E.rec(name, a.fields.map(([k, v]) => [m.safe(k), x(v, fs.get(k))]));
    }
    case 'point':
      return E.rec('point', [['x', x(a.x)], ['y', x(a.y)]]);
    case 'field':
      return E.field(x(a.o), m.safe(a.name));
    case 'index':
      m.lossy(at.line, 'xs[i] gives an opt in 0.3; the migration only rewrites xs[k] inside a walk over xs');
      throw new Unsupported(`indexing (${JSON.stringify(a).slice(0, 60)}…) outside a walk over the same list`);
    case 'not':
      return E.un('!', x(a.a, { t: 'bool' }));
    case 'and':
      return E.bin('&&', x(a.a, { t: 'bool' }), x(a.b, { t: 'bool' }));
    case 'or':
      return E.bin('||', x(a.a, { t: 'bool' }), x(a.b, { t: 'bool' }));
    case 'if':
      return E.cond(x(a.c, { t: 'bool' }), x(a.a, want), x(a.b, want));
    case 'lam': {
      const ps = w?.t === 'fn' ? w.params : [];
      const locals = new Map(a.params.map((p, i) => [p, [E.name(m.safe(p)), ps[i]]]));
      return E.lambda(
        a.params.map((p) => m.safe(p)),
        [S.ret(x(a.body, w?.t === 'fn' ? w.ret : undefined, child(scope, locals)))],
      );
    }
    case 'fnref':
    case 'call': {
      if (m.failedFns.has(a.fn)) throw new Unsupported(`it calls ${m.b.fns?.[a.fn]?.name ?? a.fn}, a fn that did not migrate`);
      const f = scope.fns.get(a.fn) ?? (m.b.fns?.[a.fn] ? m.safe(m.b.fns[a.fn].name) : undefined);
      if (!f) throw new Unsupported(`a call to the fn ${a.fn}, which this migration has no 0.3 name for`);
      const def = m.b.fns?.[a.fn] ?? scope.fnDefs?.get(a.fn);
      return a.t === 'fnref' ? E.name(f) : E.call(f, a.args.map((y, i) => x(y, def?.types?.[i])));
    }
    case 'apply': {
      const f = expr(m, a.f, scope, at);
      if (f.k !== 'name') throw new Unsupported('a call of a computed fn');
      return E.call(f.n, a.args.map((y) => x(y)));
    }
    case 'builtin':
      return builtin(m, a, scope, at, w);
  }
  throw new Unsupported(`the 0.2 expression ${a.t}`);
}

function builtin(m, a, scope, at, w) {
  const x = (y, t) => expr(m, y, scope, at, t);
  const [p, q, r] = a.args;
  const fn = a.fn;
  if (fn === '==' || fn === '!=' || fn === '<' || fn === '<=' || fn === '>' || fn === '>=') {
    // a bare word on one side takes the other side's type: s == done, tone != none
    const tp = typeOfA(m, p, scope);
    const tq = typeOfA(m, q, scope);
    const none = (y, t) => y.t === 'str' && y.v === 'none' && t && (t.t === 'token' || t.t === 'icon');
    // `x == none` on a 0.2 type that has none is "x is opt.NONE" in 0.3
    if (none(q, tp) || none(p, tq)) {
      const side = none(q, tp) ? p : q;
      const t = none(q, tp) ? tp : tq;
      return E.bin(fn === '==' ? '==' : '!=', x(side, t), E.none());
    }
    return E.bin(ARITH[fn], x(p, tq), x(q, tp));
  }
  if (fn in ARITH) return E.bin(ARITH[fn], x(p, w), x(q, w));
  if (fn === 'neg') return E.un('-', x(p, w));
  if (fn === 'cat') {
    // text joined with + is a template literal in 0.3: there is no + on text
    const parts = [];
    const flat = (y) => (y.t === 'builtin' && y.fn === 'cat' ? y.args.forEach(flat) : parts.push(y));
    a.args.forEach(flat);
    return E.text(...parts.map((y) => (y.t === 'str' ? y.v : x(y))).filter((s) => s !== ''));
  }
  if (fn === 'format') {
    if (q) return E.method(x(p), 'fmt', [x(q)]);
    return E.text(x(p));
  }
  // a choice was text in 0.2: text fns read it through its show fn
  const asText = (y) => (typeOfA(m, y, scope)?.t === 'choice' ? E.method(x(y), 'show') : x(y));
  if (['trim', 'lower', 'upper'].includes(fn) && a.args.length === 1) return E.method(asText(p), METHOD0[fn]);
  if (['startswith', 'endswith', 'contains', 'split'].includes(fn) && a.args.length === 2) return E.method(asText(p), METHOD1[fn], [x(q)]);
  if (fn in METHOD0 && a.args.length === 1) return E.method(x(p), METHOD0[fn]);
  if (fn in METHOD_OPT && a.args.length === 1) {
    m.lossy(at.line, `${fn}() gives an opt in 0.3 (no answer for some inputs); the migration falls back to 0`);
    return E.method(E.method(x(p), METHOD_OPT[fn]), 'or', [E.num(0)]);
  }
  if (fn in METHOD1 && a.args.length === 2) return E.method(x(p), METHOD1[fn], [x(q)]);
  if (fn === '^') {
    m.lossy(at.line, 'a ^ b gives an opt in 0.3 (a.pow(b)); the migration falls back to 0');
    return E.method(E.method(x(p), 'pow', [x(q)]), 'or', [E.num(0)]);
  }
  if (fn === 'lsum' || fn === 'sum') return E.method(E.method(x(p), 'sum'), 'or', [E.num(0)]);
  if (fn === 'map' || fn === 'filter' || fn === 'find') {
    if (p.t === 'builtin' && p.fn === 'range') throw new Unsupported(`${fn} over range(a, b): a 0.3 range is walked by for, and is not a list`);
    const item = itemType(typeOfA(m, p, scope));
    const f = q.t === 'lam' ? lambdaOver(m, q, item, scope, at) : x(q);
    return E.method(x(p), fn, [f]);
  }
  if (fn === 'at' && a.args.length === 3) return E.method(E.method(x(p), 'at', [x(q)]), 'or', [x(r, itemType(typeOfA(m, p, scope)))]);
  if (fn === 'range' && a.args.length === 2) return E.range(x(p), x(q));
  if (fn === 'len') return E.method(x(p), 'len');
  throw new Unsupported(`the 0.2 builtin ${fn}(${a.args.length} args) has no 0.3 translation here`);
}

/** x => … over the items of a list whose item type is known. */
function lambdaOver(m, lam, item, scope, at) {
  const locals = new Map(lam.params.map((p, i) => [p, [E.name(m.safe(p)), i === 0 ? item : undefined]]));
  return E.lambda(
    lam.params.map((p) => m.safe(p)),
    [S.ret(expr(m, lam.body, child(scope, locals), at))],
  );
}
