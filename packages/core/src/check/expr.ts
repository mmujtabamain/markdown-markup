// Expression typing and resolution (spec 6.7, 6.22): builtins, dispatch with `from` promotion,
// generic fns checked per call, lambdas typed from where they are used, choice options as
// constants, text and maths literals with \val holes.

import { MkpError, Pos, didYouMean } from '../diag';
import type { A, IRFn } from '../ir';
import { Ex, valHoles } from '../syntax/expr';
import { parseExprString } from '../syntax/mkp';
import { canonical } from '../syntax/canon';
import { fits, hasUnknown, isNumeric, join, resolve, sameType, showType, T, Type, TypeEnv } from '../types';
import type { FnEntry, Program } from './program';

export interface Binding {
  type: Type;
  from: 'local' | 'inst' | 'const';
  /** const id (pack:name) for constants */
  id?: string;
  /** what declared it, for messages and action targets */
  kind?: 'input' | 'state' | 'var' | 'derived' | 'host' | 'param' | 'each' | 'const' | 'payload' | 'field' | 'ref';
  control?: string;
}

export interface LocalFn {
  entry: FnEntry;
}

export class Scope {
  private readonly vars = new Map<string, Binding>();
  readonly fns = new Map<string, FnEntry[]>();
  constructor(readonly parent: Scope | null = null) {}
  set(name: string, b: Binding): void {
    this.vars.set(name, b);
  }
  has(name: string): boolean {
    return this.vars.has(name);
  }
  get(name: string): Binding | undefined {
    return this.vars.get(name) ?? this.parent?.get(name);
  }
  localFns(name: string): FnEntry[] {
    return this.fns.get(name) ?? this.parent?.localFns(name) ?? [];
  }
  child(): Scope {
    return new Scope(this);
  }
  names(): string[] {
    return [...this.vars.keys(), ...(this.parent?.names() ?? [])];
  }
  /** choice-typed bindings, for resolving option words */
  choiceTypes(): Type[] {
    const out: Type[] = [];
    for (const b of this.vars.values()) if (b.type.t === 'choice') out.push(b.type);
    return [...out, ...(this.parent?.choiceTypes() ?? [])];
  }
}

export interface Checked {
  ast: A;
  type: Type;
}

const CONSTS: Record<string, [Type, A]> = {
  pi: [T.num, { t: 'num', v: Math.PI }],
  tau: [T.num, { t: 'num', v: 2 * Math.PI }],
  e: [T.num, { t: 'num', v: Math.E }],
  inf: [T.num, { t: 'builtin', fn: 'inf', args: [] }],
  nan: [T.num, { t: 'builtin', fn: 'nan', args: [] }],
  true: [T.bool, { t: 'bool', v: true }],
  false: [T.bool, { t: 'bool', v: false }],
};

/** Typed numeric builtins that take part in dispatch alongside pack fns. */
const NUM1 = ['exp', 'ln', 'sqrt', 'sin', 'cos', 'tan', 'asin', 'acos', 'atan', 'sinh', 'cosh', 'tanh', 'abs', 'floor', 'ceil', 'round', 'sign', 'step', 'fact'];
const NUM2 = ['atan2', 'mod', 'min', 'max', 'pow'];
const INT_RESULT = new Set(['floor', 'ceil', 'round', 'sign', 'step']);

export const RGB: Type = { t: 'rec', name: 'rgb', fields: [['r', T.num], ['g', T.num], ['b', T.num]] };

/**
 * Values every definition can read: the reader's width (GAPS 30) and whether answers are shown
 * (false when Markdown is built without them, GAPS 166).
 */
export const WIDTH: Type = { t: 'choice', opts: ['narrow', 'medium', 'wide'] };
export const GLOBALS: Record<string, Type> = { width: WIDTH, answers: T.bool };

export class ExprChecker {
  /** specialisations being checked, to catch recursion without a return type */
  private get inProgress(): Map<string, Type | undefined> {
    return this.prog.fnsInProgress;
  }
  readonly env: TypeEnv;
  depth = 0;
  /** token names by kind, so token words are values where a token is expected */
  tokenNames?: (kind: string) => Set<string>;

  constructor(
    readonly prog: Program,
    readonly pack: string,
    /** where local fns (and their specialisations) are stored */
    readonly localSink: Record<string, IRFn> | null,
    readonly file: string,
    /** the definition's type parameters (walk of S): opaque types inside it */
    typeParams: string[] = [],
  ) {
    this.env = withParams(prog.typeEnv(pack), typeParams);
    this.tokenNames = prog.tokenNames;
  }

  fail(p: Pos, msg: string, code = 'mkp.type'): never {
    throw new MkpError(code, msg, p);
  }

  r(t: Type): Type {
    return resolve(t, this.env);
  }

  check(e: Ex, scope: Scope, expected?: Type): Checked {
    if (++this.depth > 200) this.fail(e.p, 'the expression is nested too deeply', 'mkp.limit');
    try {
      return this.check1(e, scope, expected);
    } finally {
      this.depth--;
    }
  }

  private check1(e: Ex, scope: Scope, expected?: Type): Checked {
    const ex = expected ? this.r(expected) : undefined;
    switch (e.k) {
      case 'num':
        return { ast: { t: 'num', v: e.v }, type: Number.isInteger(e.v) ? T.int : T.num };
      case 'str':
        return this.template(e.v, false, e.p, scope);
      case 'tex':
        return this.template(e.v, true, e.p, scope);
      case 'id':
        return this.ident(e.name, e.p, scope, ex);
      case 'list': {
        const elemExp = ex && ex.t === 'list' ? ex.of : undefined;
        const items = e.items.map((x) => this.check(x, scope, elemExp));
        // where the element type is known, each item converts to it (a vec2 where points go)
        if (elemExp && !hasUnknown(elemExp) && items.length) {
          return { ast: { t: 'list', items: items.map((it, i) => this.coerce(it, elemExp, e.items[i].p).ast) }, type: T.list(elemExp) };
        }
        let et: Type = T.unknown;
        for (const it of items) {
          const j = join(et, it.type, this.env);
          if (!j) this.fail(e.p, `list items must share one type; found ${showType(et)} and ${showType(it.type)}`);
          et = j;
        }
        if (elemExp && !hasUnknown(elemExp) && items.length) {
          return { ast: { t: 'list', items: items.map((it) => this.coerce(it, elemExp, e.p).ast) }, type: T.list(elemExp) };
        }
        return { ast: { t: 'list', items: items.map((x) => x.ast) }, type: T.list(et) };
      }
      case 'rec': {
        if (e.fields.length === 0) {
          if (ex && ex.t === 'rec' && ex.fields.length) this.fail(e.p, `expected a record with ${ex.fields.map((f) => f[0]).join(', ')}`);
          return { ast: { t: 'dict0' }, type: ex && ex.t === 'dict' ? ex : T.dict(T.unknown) };
        }
        const fields: [string, A][] = [];
        const ft: [string, Type][] = [];
        for (const [n, x] of e.fields) {
          const fexp = ex && ex.t === 'rec' ? ex.fields.find((f) => f[0] === n)?.[1] : ex && ex.t === 'dict' ? ex.of : undefined;
          let c = this.check(x, scope, fexp);
          if (fexp && !hasUnknown(fexp)) c = this.coerce(c, fexp, x.p);
          fields.push([n, c.ast]);
          ft.push([n, c.type]);
        }
        if (ex && ex.t === 'rec' && ex.defaults) {
          // a named type's field defaults fill what the literal leaves out (GAPS 132)
          for (const [n, t] of ex.fields) {
            if (e.fields.some(([m]) => m === n) || ex.defaults[n] === undefined) continue;
            const d = this.check(parseExprString(ex.defaults[n], this.file, e.p.line, e.p.col), new Scope(), t);
            const c = hasUnknown(t) ? d : this.coerce(d, t, e.p);
            fields.push([n, c.ast]);
            ft.push([n, t]);
          }
        }
        if (ex && ex.t === 'rec' && ex.name) {
          // a record literal written for a named type takes that type
          const t: Type = { t: 'rec', fields: ft };
          if (fits(t, { ...ex, name: undefined }, this.env)) return { ast: { t: 'rec', fields }, type: expected! };
        }
        return { ast: { t: 'rec', fields }, type: { t: 'rec', fields: ft } };
      }
      case 'point': {
        const x = this.coerce(this.check(e.x, scope, T.num), T.num, e.x.p);
        const y = this.coerce(this.check(e.y, scope, T.num), T.num, e.y.p);
        return { ast: { t: 'point', x: x.ast, y: y.ast }, type: T.point };
      }
      case 'field': {
        const o = this.check(e.o, scope);
        const ot = this.r(o.type);
        if (ot.t === 'point' && (e.name === 'x' || e.name === 'y')) return { ast: { t: 'field', o: o.ast, name: e.name }, type: T.num };
        if (ot.t === 'rec' || ot.t === 'records') {
          const f = ot.fields.find((x) => x[0] === e.name);
          if (!f) this.fail(e.p, `${showType(o.type)} has no field "${e.name}"${didYouMean(e.name, ot.fields.map((x) => x[0]))}`, 'mkp.unknown-field');
          return { ast: { t: 'field', o: o.ast, name: e.name }, type: f[1] };
        }
        if (ot.t === 'any') return { ast: { t: 'field', o: o.ast, name: e.name }, type: T.any };
        return this.fail(e.p, `${showType(o.type)} has no fields; "${e.name}" can't be read from it`, 'mkp.unknown-field');
      }
      case 'index': {
        const o = this.check(e.o, scope);
        const ot = this.r(o.type);
        if (ot.t === 'param' || ot.t === 'rec') {
          // a record read by a typed path: step[pointer] where pointer is path(S, int)
          const i = this.check(e.i, scope);
          const it = this.r(i.type);
          if (it.t !== 'path') this.fail(e.i.p, `${showType(o.type)} is read by a path (an input typed path(…)) or with .field; found ${showType(i.type)}`);
          if (!sameType(it.of, o.type, this.env) && !fits(o.type, it.of, this.env)) this.fail(e.i.p, `this path reads ${showType(it.of)}, not ${showType(o.type)}`);
          return { ast: { t: 'index', o: o.ast, i: i.ast }, type: it.to };
        }
        if (ot.t === 'list') {
          const i = this.coerce(this.check(e.i, scope, T.int), T.num, e.i.p);
          return { ast: { t: 'index', o: o.ast, i: i.ast }, type: ot.of };
        }
        if (ot.t === 'dict') {
          const i = this.check(e.i, scope, T.text);
          if (!fits(i.type, T.text, this.env)) this.fail(e.i.p, `dict keys are text; found ${showType(i.type)}`);
          return { ast: { t: 'index', o: o.ast, i: i.ast }, type: ot.of };
        }
        if (ot.t === 'any') return { ast: { t: 'index', o: o.ast, i: this.check(e.i, scope).ast }, type: T.any };
        if (ot.t === 'range') return { ast: { t: 'index', o: o.ast, i: this.coerce(this.check(e.i, scope, T.int), T.num, e.i.p).ast }, type: T.num };
        return this.fail(e.p, `only lists and dicts can be indexed; found ${showType(o.type)}`);
      }
      case 'neg': {
        const a = this.check(e.a, scope);
        const at = this.r(a.type);
        if (isNumeric(at)) return { ast: { t: 'builtin', fn: 'neg', args: [a.ast] }, type: at.t === 'int' ? T.int : T.num };
        if (at.t === 'point') return { ast: { t: 'builtin', fn: 'pneg', args: [a.ast] }, type: T.point };
        const ops = this.prog.opCandidates('-', this.pack).filter((o) => o.syn.params.length === 1);
        const pick = this.dispatch(ops, [a], e.p, 'op -');
        if (pick) return pick;
        // -x as 0 - x through a binary op with promotion
        return this.binary('-', { ast: { t: 'num', v: 0 }, type: T.int }, a, e.p);
      }
      case 'not': {
        const a = this.check(e.a, scope, T.bool);
        if (this.r(a.type).t !== 'bool') this.fail(e.p, `"not" needs a boolean; found ${showType(a.type)}`);
        return { ast: { t: 'not', a: a.ast }, type: T.bool };
      }
      case 'bin': {
        if (e.op === 'and' || e.op === 'or') {
          const a = this.check(e.a, scope, T.bool);
          const b = this.check(e.b, scope, T.bool);
          for (const [x, s] of [[a, e.a], [b, e.b]] as const) if (this.r(x.type).t !== 'bool') this.fail(s.p, `"${e.op}" needs booleans; found ${showType(x.type)}`);
          return { ast: { t: e.op, a: a.ast, b: b.ast }, type: T.bool };
        }
        // choice options compare with words
        if ((e.op === '==' || e.op === '!=') && (e.a.k === 'id' || e.b.k === 'id')) {
          const a0 = this.tryCheck(e.a, scope);
          const b0 = this.tryCheck(e.b, scope);
          if (a0 && !b0) return this.binary(e.op, a0, this.check(e.b, scope, a0.type), e.p);
          if (b0 && !a0) return this.binary(e.op, this.check(e.a, scope, b0.type), b0, e.p);
        }
        const a = this.check(e.a, scope);
        const b = this.check(e.b, scope, e.op === '+' && this.r(a.type).t === 'list' ? a.type : undefined);
        return this.binary(e.op, a, b, e.p);
      }
      case 'lam': {
        if (!ex || (ex.t !== 'fn' && ex.t !== 'expr')) this.fail(e.p, 'a lambda (x => …) can only be passed where a function is expected');
        const params = ex.t === 'fn' ? ex.params : ex.vars.map((v) => v[1]);
        const ret = ex.t === 'fn' ? ex.ret : ex.ret;
        if (params.length !== e.params.length) this.fail(e.p, `this function takes ${params.length} parameter(s), not ${e.params.length}`);
        const s = scope.child();
        e.params.forEach((n, i) => s.set(n, { type: params[i], from: 'local', kind: 'param' }));
        let body = this.check(e.body, s, ret.t === 'unknown' || ret.t === 'any' ? undefined : ret);
        if (ret.t !== 'unknown' && ret.t !== 'any' && !hasUnknown(ret)) body = this.coerce(body, ret, e.body.p);
        return { ast: { t: 'lam', params: e.params, body: body.ast }, type: T.fn(params, body.type) };
      }
      case 'call':
        return this.call(e.f, e.args, e.p, scope, ex);
      case 'apply': {
        const f = this.check(e.f, scope);
        return this.applyValue(f, e.args, e.p, scope);
      }
    }
  }

  private tryCheck(e: Ex, scope: Scope): Checked | null {
    if (e.k !== 'id') return this.check(e, scope);
    if (scope.get(e.name) || e.name in CONSTS || GLOBALS[e.name] || this.prog.constCandidates(e.name, this.pack).length) return this.check(e, scope);
    return null;
  }

  private ident(name: string, p: Pos, scope: Scope, ex?: Type): Checked {
    const b = scope.get(name);
    if (!b && GLOBALS[name]) return { ast: { t: 'var', name: `$${name}`, from: 'inst' }, type: GLOBALS[name] };
    // where a font, space, size, radius or shadow is expected, its token wins over a name in scope
    if (ex && ex.t === 'token' && ex.kind !== 'color' && this.tokenNames?.(ex.kind).has(name)) return { ast: { t: 'str', v: name }, type: ex };
    if (!b && name === 'none' && ex && ex.t === 'token') return { ast: { t: 'str', v: 'none' }, type: ex };
    if (b) {
      if (b.from === 'const') return { ast: { t: 'var', name: b.id!, from: 'const' }, type: b.type };
      return { ast: { t: 'var', name, from: b.from }, type: b.type.t === 'ref' ? b.type.of : b.type };
    }
    if (ex && ex.t === 'choice' && ex.opts.includes(name)) return { ast: { t: 'str', v: name }, type: ex };
    if (ex && ex.t === 'token' && this.tokenNames?.(ex.kind).has(name)) return { ast: { t: 'str', v: name }, type: ex };
    if (name in CONSTS) {
      const [type, ast] = CONSTS[name];
      return { ast, type };
    }
    const consts = this.prog.constCandidates(name, this.pack);
    if (consts.length === 1) {
      const c = consts[0];
      const type = this.constType(c.id);
      return { ast: { t: 'var', name: c.id, from: 'const' }, type };
    }
    if (consts.length > 1) this.fail(p, `"${name}" is a constant in several packs (${consts.map((c) => c.pack).join(', ')}); qualify it`, 'mkp.ambiguous');
    // an option word of a choice in scope
    const choices = scope.choiceTypes().filter((t) => t.t === 'choice' && t.opts.includes(name));
    if (choices.length) return { ast: { t: 'str', v: name }, type: choices[0] };
    // a fn used as a value
    const fns = [...scope.localFns(name), ...this.prog.fnCandidates(name, this.pack)];
    if (fns.length === 1 && fns[0].sig) {
      const f = fns[0];
      return { ast: { t: 'fnref', fn: this.ensureFn(f) }, type: T.fn(f.sig!, f.syn.ret ?? T.any) };
    }
    return this.fail(p, `"${name}" is not defined here${didYouMean(name, scope.names())}`, 'mkp.unknown-name');
  }

  /** The type of a pack constant, checking it on first use. */
  constType(id: string): Type {
    const [, name] = id.split(':');
    const c = (this.prog.consts.get(name) ?? []).find((x) => x.id === id)!;
    if (c.checked) return c.checked.type;
    if (c.checking) this.fail(c.syn.p, `constant ${name} refers to itself`);
    c.checking = true;
    const sub = new ExprChecker(this.prog, c.pack, null, c.file);
    const env = this.prog.typeEnv(c.pack);
    let res = sub.check(c.syn.e, new Scope(), c.type);
    if (c.type) {
      if (!fits(res.type, c.type, env)) res = sub.coerce(res, c.type, c.syn.p);
      res = { ...res, type: c.type };
    }
    c.checked = { expr: c.syn.src, ast: res.ast, type: res.type };
    this.prog.irConsts[id] = c.checked;
    c.checking = false;
    return res.type;
  }

  // ------------------------------------------------------------------------------------------
  // Conversions

  /** Fits a checked value to an expected type: as is, by `from` promotion or `op point`. */
  coerce(c: Checked, to: Type, p: Pos, allowPoint = true): Checked {
    const from = this.r(c.type);
    const tt = this.r(to);
    if (tt.t === 'text' && from.t === 'latex') return { ast: { t: 'builtin', fn: 'tex2text', args: [c.ast] }, type: T.text };
    if (fits(c.type, to, this.env)) return c;
    if (tt.t === 'point' && allowPoint) {
      const conv = this.prog.opCandidates('point', this.pack).find((o) => o.sig && o.sig.length === 1 && fits(c.type, o.sig[0], this.env));
      if (conv) return { ast: { t: 'call', fn: this.ensureFn(conv), args: [c.ast] }, type: T.point };
    }
    const prom = this.promotion(c.type, to);
    if (prom) return { ast: { t: 'call', fn: prom, args: [c.ast] }, type: to };
    if (tt.t === 'list' && from.t === 'list') {
      // element-wise conversion (a list of complex where points are expected)
      const probe = this.coerceType(from.of, tt.of);
      if (probe) return { ast: { t: 'builtin', fn: 'map', args: [c.ast, { t: 'lam', params: ['_x'], body: probe({ t: 'var', name: '_x', from: 'local' }) }] }, type: to };
    }
    return this.fail(p, `expected ${showType(to)}, found ${showType(c.type)}`, 'mkp.type');
  }

  private coerceType(from: Type, to: Type): ((a: A) => A) | null {
    if (fits(from, to, this.env)) return (a) => a;
    if (this.r(to).t === 'point') {
      const conv = this.prog.opCandidates('point', this.pack).find((o) => o.sig && o.sig.length === 1 && fits(from, o.sig[0], this.env));
      if (conv) {
        const id = this.ensureFn(conv);
        return (a) => ({ t: 'call', fn: id, args: [a] });
      }
    }
    const prom = this.promotion(from, to);
    return prom ? (a) => ({ t: 'call', fn: prom, args: [a] }) : null;
  }

  /** The id of an `op from(a: A): B` with the value fitting A and B the wanted type. */
  promotion(from: Type, to: Type): string | null {
    for (const o of this.prog.opCandidates('from', this.pack)) {
      if (!o.sig || o.sig.length !== 1) continue;
      const ret = o.syn.ret;
      if (!ret) continue;
      if (fits(from, o.sig[0], this.env) && sameType(ret, to, this.env)) return this.ensureFn(o);
    }
    return null;
  }

  // ------------------------------------------------------------------------------------------
  // Operators

  binary(op: string, a: Checked, b: Checked, p: Pos): Checked {
    const at = this.r(a.type);
    const bt = this.r(b.type);
    const num = isNumeric(at) && isNumeric(bt);
    const cmp = ['==', '!=', '<', '<=', '>', '>='].includes(op);
    if (num) {
      if (cmp) return { ast: { t: 'builtin', fn: op, args: [a.ast, b.ast] }, type: T.bool };
      const intRes = at.t === 'int' && bt.t === 'int' && op !== '/' && op !== '^';
      return { ast: { t: 'builtin', fn: op, args: [a.ast, b.ast] }, type: intRes ? T.int : T.num };
    }
    // pack operators (exact first, then with promotion)
    const symbol = op === '!=' ? '==' : op === '>' || op === '<=' || op === '>=' ? '<' : op;
    const ops = this.prog.opCandidates(symbol, this.pack).filter((o) => o.syn.params.length === 2);
    if (ops.length) {
      const args = op === '>' || op === '<=' ? [b, a] : [a, b];
      const picked = this.dispatch(ops, args, p, `op ${symbol}`, true);
      if (picked) {
        if (op === '!=' || op === '>=' || op === '<=') return { ast: { t: 'not', a: picked.ast }, type: T.bool };
        return picked;
      }
    }
    if (op === '==' || op === '!=') {
      if (!join(a.type, b.type, this.env) && !(at.t === 'choice' && bt.t === 'choice')) this.fail(p, `can't compare ${showType(a.type)} with ${showType(b.type)}`);
      return { ast: { t: 'builtin', fn: op, args: [a.ast, b.ast] }, type: T.bool };
    }
    if (cmp && (at.t === 'text' || at.t === 'choice') && (bt.t === 'text' || bt.t === 'choice')) return { ast: { t: 'builtin', fn: op, args: [a.ast, b.ast] }, type: T.bool };
    if (op === '+') {
      if ((at.t === 'text' || at.t === 'choice' || at.t === 'latex') && (bt.t === 'text' || bt.t === 'choice' || isNumeric(bt) || bt.t === 'latex')) {
        const ty = at.t === 'latex' && bt.t === 'latex' ? T.latex : T.text;
        return { ast: { t: 'builtin', fn: 'cat', args: [a.ast, b.ast] }, type: ty };
      }
      if (isNumeric(at) && (bt.t === 'text' || bt.t === 'choice')) return { ast: { t: 'builtin', fn: 'cat', args: [a.ast, b.ast] }, type: T.text };
      if (at.t === 'list' && bt.t === 'list') {
        const j = join(at.of, bt.of, this.env);
        if (!j) this.fail(p, `can't join ${showType(a.type)} and ${showType(b.type)}`);
        return { ast: { t: 'builtin', fn: 'lcat', args: [a.ast, b.ast] }, type: T.list(j) };
      }
    }
    if (at.t === 'point' && bt.t === 'point' && (op === '+' || op === '-')) return { ast: { t: 'builtin', fn: 'p' + op, args: [a.ast, b.ast] }, type: T.point };
    if (op === '*' && isNumeric(at) && bt.t === 'point') return { ast: { t: 'builtin', fn: 'ps*', args: [a.ast, b.ast] }, type: T.point };
    if ((op === '*' || op === '/') && at.t === 'point' && isNumeric(bt)) return { ast: { t: 'builtin', fn: 'p' + op, args: [a.ast, b.ast] }, type: T.point };
    if (bt.t === 'unknown' || at.t === 'unknown' || at.t === 'any' || bt.t === 'any') return { ast: { t: 'builtin', fn: op, args: [a.ast, b.ast] }, type: cmp ? T.bool : T.any };
    return this.fail(p, `no operator ${op} for ${showType(a.type)} and ${showType(b.type)}`, 'mkp.no-operator');
  }

  /**
   * Picks a candidate by declared argument types: exact matches win; otherwise at most one
   * `from` promotion per argument; equal fits are ambiguous (6.22).
   */
  dispatch(cands: FnEntry[], args: Checked[], p: Pos, what: string, quiet = false): Checked | null {
    type Fit = { f: FnEntry; cost: number; conv: (string | null)[] };
    const fitsList: Fit[] = [];
    for (const f of cands) {
      if (!f.sig || f.sig.length !== args.length) continue;
      let cost = 0;
      const conv: (string | null)[] = [];
      let ok = true;
      for (let i = 0; i < args.length; i++) {
        if (fits(args[i].type, f.sig[i], this.env) && !(this.r(f.sig[i]).t !== 'any' && this.r(args[i].type).t === 'any')) {
          conv.push(null);
          continue;
        }
        const pr = this.promotion(args[i].type, f.sig[i]);
        if (pr) {
          conv.push(pr);
          cost++;
          continue;
        }
        ok = false;
        break;
      }
      if (ok) fitsList.push({ f, cost, conv });
    }
    if (!fitsList.length) {
      if (quiet) return null;
      return null;
    }
    fitsList.sort((x, y) => x.cost - y.cost);
    if (fitsList.length > 1 && fitsList[0].cost === fitsList[1].cost) {
      this.fail(p, `${what} is ambiguous for (${args.map((a) => showType(a.type)).join(', ')}): ${fitsList.filter((x) => x.cost === fitsList[0].cost).map((x) => x.f.id).join(' and ')} fit equally`, 'mkp.ambiguous');
    }
    const best = fitsList[0];
    const id = this.ensureFn(best.f);
    const argAsts = args.map((a, i) => (best.conv[i] ? ({ t: 'call', fn: best.conv[i]!, args: [a.ast] } as A) : a.ast));
    return { ast: { t: 'call', fn: id, args: argAsts }, type: best.f.syn.ret ?? this.fnRet(best.f) };
  }

  private fnRet(f: FnEntry): Type {
    const ir = (f.syn as { local?: boolean }).local ? this.localSink?.[f.id] : this.prog.irFns[f.id];
    return ir?.ret ?? T.any;
  }

  /** Checks a typed fn's body once (memoised) and returns its id. */
  ensureFn(f: FnEntry): string {
    const local = f.id.startsWith('local:');
    const sink = local ? this.localSink! : this.prog.irFns;
    if (sink[f.id] || this.inProgress.has(f.id)) return f.id;
    if (!f.sig) return f.id;
    this.inProgress.set(f.id, f.syn.ret);
    try {
      const checker = local ? this : new ExprChecker(this.prog, f.pack, null, f.file);
      const s = local ? (f as FnEntry & { scope: Scope }).scope.child() : new Scope();
      f.syn.params.forEach((q, i) => s.set(q.name, { type: f.sig![i], from: 'local', kind: 'param' }));
      let body = checker.check(f.syn.body, s, f.syn.ret);
      if (f.syn.ret) body = checker.coerce(body, f.syn.ret, f.syn.body.p);
      sink[f.id] = {
        name: f.syn.name,
        params: f.syn.params.map((q) => q.name),
        types: f.sig,
        ret: f.syn.ret ?? body.type,
        body: body.ast,
        src: canonical(f.syn.src),
        local: local || undefined,
        op: f.op,
        pos: [f.syn.p.line, f.syn.p.col],
        file: f.file,
      };
    } finally {
      this.inProgress.delete(f.id);
    }
    return f.id;
  }

  /** Checks an untyped (generic) fn for one call's argument types. */
  specialise(f: FnEntry, args: Checked[], p: Pos): Checked {
    const local = f.id.startsWith('local:');
    const sink = local ? this.localSink! : this.prog.irFns;
    const types = f.syn.params.map((q, i) => q.type ?? args[i].type);
    const id = `${f.id}<${types.map((t) => showType(t)).join(',')}>`;
    if (this.inProgress.has(id)) {
      const ret = this.inProgress.get(id);
      if (!ret) this.fail(p, `${f.syn.name} calls itself; give it a return type (fn ${f.syn.name}(…): type = …)`, 'mkp.recursive-untyped');
      return { ast: { t: 'call', fn: id, args: args.map((a) => a.ast) }, type: ret };
    }
    if (!sink[id]) {
      this.inProgress.set(id, f.syn.ret);
      try {
        const checker = local ? this : new ExprChecker(this.prog, f.pack, null, f.file);
        const s = local ? (f as FnEntry & { scope: Scope }).scope.child() : new Scope();
        f.syn.params.forEach((q, i) => s.set(q.name, { type: types[i], from: 'local', kind: 'param' }));
        let body = checker.check(f.syn.body, s, f.syn.ret);
        if (f.syn.ret) body = checker.coerce(body, f.syn.ret, f.syn.body.p);
        sink[id] = {
          name: f.syn.name,
          params: f.syn.params.map((q) => q.name),
          types,
          ret: f.syn.ret ?? body.type,
          body: body.ast,
          src: canonical(f.syn.src),
          local: local || undefined,
          generic: f.id,
          pos: [f.syn.p.line, f.syn.p.col],
          file: f.file,
        };
      } finally {
        this.inProgress.delete(id);
      }
    }
    const argAsts = args.map((a, i) => (f.syn.params[i].type ? this.coerce(a, f.syn.params[i].type!, p).ast : a.ast));
    return { ast: { t: 'call', fn: id, args: argAsts }, type: sink[id].ret! };
  }

  // ------------------------------------------------------------------------------------------
  // Calls

  private applyValue(f: Checked, args: Ex[], p: Pos, scope: Scope): Checked {
    const ft = this.r(f.type);
    if (ft.t === 'fn') {
      if (ft.params.length !== args.length) this.fail(p, `this function takes ${ft.params.length} argument(s)`);
      const as = args.map((a, i) => this.coerce(this.check(a, scope, ft.params[i]), ft.params[i], a.p).ast);
      return { ast: { t: 'apply', f: f.ast, args: as }, type: ft.ret };
    }
    if (ft.t === 'expr') {
      if (ft.vars.length !== args.length) this.fail(p, `this expression takes ${ft.vars.length} variable(s)`);
      const as = args.map((a, i) => this.coerce(this.check(a, scope, ft.vars[i][1]), ft.vars[i][1], a.p).ast);
      return { ast: { t: 'apply', f: f.ast, args: as }, type: ft.ret };
    }
    if (ft.t === 'any') return { ast: { t: 'apply', f: f.ast, args: args.map((a) => this.check(a, scope).ast) }, type: T.any };
    return this.fail(p, `${showType(f.type)} is not a function`);
  }

  private call(name: string, args: Ex[], p: Pos, scope: Scope, ex?: Type): Checked {
    // a function value in scope (a lambda parameter or an expr(…) input)
    const b = scope.get(name);
    if (b && (this.r(b.type).t === 'fn' || this.r(b.type).t === 'expr' || this.r(b.type).t === 'any')) {
      return this.applyValue({ ast: { t: 'var', name, from: b.from === 'const' ? 'const' : b.from }, type: b.type }, args, p, scope);
    }
    if (b) this.fail(p, `"${name}" is a ${showType(b.type)}, not a function`);
    const local = scope.localFns(name);
    const packFns = this.prog.fnCandidates(name, this.pack);
    const user = [...local, ...packFns];
    const special = SPECIAL[name];
    if (special && !user.length) return special(this, args, p, scope, ex);
    // checked arguments for dispatch (lambdas are not dispatched on)
    const typedUser = user.filter((f) => f.sig);
    const builtinSig = builtinSignature(name, args.length);
    if (typedUser.length || builtinSig) {
      const checked = args.map((a) => this.check(a, scope));
      const cands = [...typedUser];
      // builtin numeric signatures take part as candidates
      if (builtinSig) {
        const exact = checked.every((c, i) => fits(c.type, builtinSig[i], this.env));
        if (exact) {
          const res = builtinSig.length === 1 && INT_RESULT.has(name) ? T.int : name === 'abs' && this.r(checked[0].type).t === 'int' ? T.int : name === 'mod' || name === 'min' || name === 'max' ? (checked.every((c) => this.r(c.type).t === 'int') ? T.int : T.num) : T.num;
          const exactUser = typedUser.filter((f) => f.sig!.every((s, i) => fits(checked[i].type, s, this.env)));
          if (!exactUser.length) return { ast: { t: 'builtin', fn: name, args: checked.map((c) => c.ast) }, type: res };
        }
      }
      const picked = this.dispatch(cands, checked, p, name);
      if (picked) return picked;
      const generic = user.filter((f) => !f.sig && f.syn.params.length === args.length);
      if (generic.length === 1) return this.specialise(generic[0], checked, p);
      if (special) return special(this, args, p, scope, ex);
      this.fail(p, `no ${name}(…) takes (${checked.map((c) => showType(c.type)).join(', ')})${cands.length ? `; candidates: ${cands.map((c) => `${name}(${c.sig!.map(showType).join(', ')})`).join(', ')}` : ''}`, 'mkp.no-overload');
    }
    const generic = user.filter((f) => f.syn.params.length === args.length);
    if (generic.length === 1) {
      const checked = args.map((a, i) => this.check(a, scope, generic[0].syn.params[i].type));
      return this.specialise(generic[0], checked, p);
    }
    if (generic.length > 1) this.fail(p, `${name} is defined more than once with ${args.length} parameter(s); give the parameters types so calls can be dispatched`, 'mkp.ambiguous');
    if (user.length) this.fail(p, `${name} takes ${user[0].syn.params.length} argument(s), not ${args.length}`);
    return this.fail(p, `there is no function "${name}"${didYouMean(name, [...Object.keys(SPECIAL), ...NUM1, ...NUM2, ...this.prog.fns.keys()])}`, 'mkp.unknown-function');
  }

  // ------------------------------------------------------------------------------------------
  // Text and maths literals

  /** A text or maths literal; \val{…} holes become a template. */
  template(src: string, tex: boolean, p: Pos, scope: Scope): Checked {
    const holes = valHoles(src);
    const type = tex ? T.latex : T.text;
    if (!holes.length) return { ast: { t: 'str', v: src }, type };
    let out = '';
    let last = 0;
    const asts: A[] = [];
    const show: (string | null)[] = [];
    const modes: ('tex' | 'text')[] = [];
    const kinds: string[] = [];
    holes.forEach((h, n) => {
      out += src.slice(last, h.at) + `\\val{${n}}`;
      last = h.end;
      const e = parseExprString(h.src, p.file, p.line, p.col);
      const c = this.check(e, scope);
      asts.push(c.ast);
      const sh = this.showFn(c.type, p);
      show.push(sh);
      const rt = this.r(c.type);
      const kind = ['num', 'int', 'bool', 'text', 'latex', 'choice', 'point', 'list'].includes(rt.t) ? rt.t : 'other';
      // a value \\val can't write is a compile error, never "[object Object]" (6.7)
      if (kind === 'other' && !sh) this.fail(p, `\\val{${h.src}} is ${showType(c.type)}, which has no written form; show one of its fields, or give its type a show fn`, 'mkp.type');
      kinds.push(kind);
      modes.push(tex || insideMaths(src, h.at) ? 'tex' : 'text');
    });
    out += src.slice(last);
    return { ast: { t: 'tmpl', v: out, tex, holes: asts, show, modes, kinds }, type };
  }

  /** The `show` fn for a pack type (6.7 live values), or null for core values. */
  showFn(t: Type, p: Pos): string | null {
    const r = this.r(t);
    if (['num', 'int', 'bool', 'text', 'latex', 'choice', 'point', 'list', 'any', 'unknown', 'dict'].includes(r.t)) return null;
    const cands = this.prog.fnCandidates('show', this.pack).filter((f) => f.sig && f.sig.length === 1 && fits(t, f.sig[0], this.env));
    if (!cands.length) return null;
    void p;
    return this.ensureFn(cands[0]);
  }
}

/** A type environment in which the definition's type parameters are opaque types. */
export function withParams(env: TypeEnv, params: string[]): TypeEnv {
  if (!params.length) return env;
  return (n) => (params.includes(n) ? { t: 'param', name: n } : env(n));
}

function insideMaths(s: string, at: number): boolean {
  let maths = false;
  for (let i = 0; i < at; i++) {
    if (s[i] === '\\') {
      i++;
      continue;
    }
    if (s[i] === '$') maths = !maths;
  }
  return maths;
}

function builtinSignature(name: string, n: number): Type[] | null {
  if (n === 1 && NUM1.includes(name)) return [T.num];
  if (n === 2 && NUM2.includes(name)) return [T.num, T.num];
  if (name === 'log' && (n === 1 || n === 2)) return n === 1 ? [T.num] : [T.num, T.num];
  if (name === 'rand' && n === 2) return [T.num, T.num];
  return null;
}

// ---------------------------------------------------------------------------------------------
// Generic builtins: typed by hand because their argument types depend on each other.

type Special = (c: ExprChecker, args: Ex[], p: Pos, scope: Scope, ex?: Type) => Checked;

function arity(c: ExprChecker, name: string, args: Ex[], p: Pos, ...ns: number[]): void {
  if (!ns.includes(args.length)) return c.fail(p, `${name} takes ${ns.join(' or ')} argument(s), not ${args.length}`, 'mkp.arity');
}

function listOf(c: ExprChecker, x: Checked, p: Pos, name: string): Type {
  const t = c.r(x.type);
  if (t.t === 'list') return t.of;
  if (t.t === 'records') return { t: 'rec', fields: t.fields };
  if (t.t === 'any') return T.any;
  return c.fail(p, `${name} needs a list; found ${showType(x.type)}`);
}

function b(fn: string, args: A[]): A {
  return { t: 'builtin', fn, args };
}

function lam(c: ExprChecker, e: Ex, scope: Scope, params: Type[], ret: Type = T.unknown): Checked {
  return c.check(e, scope, T.fn(params, ret));
}

function retOf(x: Checked): Type {
  return x.type.t === 'fn' ? x.type.ret : T.any;
}

const SPECIAL: Record<string, Special> = {
  len(c, a, p, s) {
    arity(c, 'len', a, p, 1);
    const x = c.check(a[0], s);
    const t = c.r(x.type);
    if (t.t !== 'list' && t.t !== 'text' && t.t !== 'dict' && t.t !== 'records' && t.t !== 'any') return c.fail(p, `len needs a list, text or dict; found ${showType(x.type)}`);
    return { ast: b('len', [x.ast]), type: T.int };
  },
  map(c, a, p, s) {
    arity(c, 'map', a, p, 2);
    const xs = c.check(a[0], s);
    const el = listOf(c, xs, p, 'map');
    const f = lam(c, a[1], s, [el]);
    return { ast: b('map', [xs.ast, f.ast]), type: T.list(retOf(f)) };
  },
  filter(c, a, p, s) {
    arity(c, 'filter', a, p, 2);
    const xs = c.check(a[0], s);
    const el = listOf(c, xs, p, 'filter');
    const f = lam(c, a[1], s, [el], T.bool);
    if (c.r(retOf(f)).t !== 'bool') return c.fail(a[1].p, 'filter needs a function that returns a boolean');
    return { ast: b('filter', [xs.ast, f.ast]), type: T.list(el) };
  },
  find(c, a, p, s) {
    arity(c, 'find', a, p, 2, 3);
    const xs = c.check(a[0], s);
    const el = listOf(c, xs, p, 'find');
    const f = lam(c, a[1], s, [el], T.bool);
    const args = [xs.ast, f.ast];
    if (a[2]) args.push(c.coerce(c.check(a[2], s, el), el, a[2].p).ast);
    return { ast: b('find', args), type: el };
  },
  sort(c, a, p, s) {
    arity(c, 'sort', a, p, 1, 2);
    const xs = c.check(a[0], s);
    const el = listOf(c, xs, p, 'sort');
    if (a.length === 1) return { ast: b('sort', [xs.ast]), type: T.list(el) };
    const f = lam(c, a[1], s, [el]);
    return { ast: b('sort', [xs.ast, f.ast]), type: T.list(el) };
  },
  reverse(c, a, p, s) {
    arity(c, 'reverse', a, p, 1);
    const xs = c.check(a[0], s);
    return { ast: b('reverse', [xs.ast]), type: T.list(listOf(c, xs, p, 'reverse')) };
  },
  fold(c, a, p, s) {
    arity(c, 'fold', a, p, 3);
    const xs = c.check(a[0], s);
    const el = listOf(c, xs, p, 'fold');
    const init = c.check(a[1], s);
    let acc = init.type;
    let f = lam(c, a[2], s, [acc, el]);
    const j = join(acc, retOf(f), c.env);
    if (!j) return c.fail(a[2].p, `fold's function must return the accumulator's type ${showType(acc)}; it returns ${showType(retOf(f))}`);
    if (hasUnknown(acc) || !sameType(j, acc, c.env)) {
      acc = j;
      f = lam(c, a[2], s, [acc, el], acc);
    }
    return { ast: b('fold', [xs.ast, init.ast, f.ast]), type: acc };
  },
  group(c, a, p, s) {
    arity(c, 'group', a, p, 2);
    const xs = c.check(a[0], s);
    const el = listOf(c, xs, p, 'group');
    const f = lam(c, a[1], s, [el]);
    return { ast: b('group', [xs.ast, f.ast]), type: T.dict(T.list(el)) };
  },
  index(c, a, p, s) {
    arity(c, 'index', a, p, 2);
    const xs = c.check(a[0], s);
    const el = listOf(c, xs, p, 'index');
    const f = lam(c, a[1], s, [el]);
    return { ast: b('index', [xs.ast, f.ast]), type: T.dict(el) };
  },
  indexof(c, a, p, s) {
    arity(c, 'indexof', a, p, 2);
    const xs = c.check(a[0], s);
    if (isText(c, xs)) return { ast: b('tindexof', [xs.ast, textArg(c, a[1], s)]), type: T.int };
    const el = listOf(c, xs, p, 'indexof');
    const x = c.check(a[1], s, el);
    return { ast: b('indexof', [xs.ast, x.ast]), type: T.int };
  },
  range(c, a, p, s) {
    arity(c, 'range', a, p, 2);
    const lo = c.coerce(c.check(a[0], s, T.int), T.num, a[0].p);
    const hi = c.coerce(c.check(a[1], s, T.int), T.num, a[1].p);
    return { ast: b('range', [lo.ast, hi.ast]), type: T.list(T.int) };
  },
  zip(c, a, p, s) {
    arity(c, 'zip', a, p, 2);
    const xs = c.check(a[0], s);
    const ys = c.check(a[1], s);
    return { ast: b('zip', [xs.ast, ys.ast]), type: T.list({ t: 'rec', fields: [['a', listOf(c, xs, p, 'zip')], ['b', listOf(c, ys, p, 'zip')]] }) };
  },
  flatten(c, a, p, s) {
    arity(c, 'flatten', a, p, 1);
    const xs = c.check(a[0], s);
    const inner = c.r(listOf(c, xs, p, 'flatten'));
    if (inner.t !== 'list') return c.fail(p, 'flatten needs a list of lists');
    return { ast: b('flatten', [xs.ast]), type: T.list(inner.of) };
  },
  first(c, a, p, s) {
    arity(c, 'first', a, p, 1, 2);
    const xs = c.check(a[0], s);
    const el = listOf(c, xs, p, 'first');
    if (a.length === 1) return { ast: b('at', [xs.ast, { t: 'num', v: 0 }]), type: el };
    const n = c.coerce(c.check(a[1], s), T.num, a[1].p);
    return { ast: b('first', [xs.ast, n.ast]), type: T.list(el) };
  },
  last(c, a, p, s) {
    arity(c, 'last', a, p, 1, 2);
    const xs = c.check(a[0], s);
    const el = listOf(c, xs, p, 'last');
    if (a.length === 1) return { ast: b('last1', [xs.ast]), type: el };
    const n = c.coerce(c.check(a[1], s), T.num, a[1].p);
    return { ast: b('last', [xs.ast, n.ast]), type: T.list(el) };
  },
  slice(c, a, p, s) {
    arity(c, 'slice', a, p, 3);
    const xs = c.check(a[0], s);
    if (isText(c, xs)) return { ast: b('tslice', [xs.ast, c.coerce(c.check(a[1], s), T.num, a[1].p).ast, c.coerce(c.check(a[2], s), T.num, a[2].p).ast]), type: T.text };
    const el = listOf(c, xs, p, 'slice');
    const i = c.coerce(c.check(a[1], s), T.num, a[1].p);
    const j = c.coerce(c.check(a[2], s), T.num, a[2].p);
    return { ast: b('slice', [xs.ast, i.ast, j.ast]), type: T.list(el) };
  },
  at(c, a, p, s) {
    arity(c, 'at', a, p, 2, 3);
    const xs = c.check(a[0], s);
    const el = listOf(c, xs, p, 'at');
    const i = c.coerce(c.check(a[1], s), T.num, a[1].p);
    const args = [xs.ast, i.ast];
    if (a[2]) args.push(c.coerce(c.check(a[2], s, el), el, a[2].p).ast);
    return { ast: b('at', args), type: el };
  },
  sum(c, a, p, s) {
    return aggregate(c, 'sum', a, p, s);
  },
  prod(c, a, p, s) {
    return aggregate(c, 'prod', a, p, s);
  },
  mean(c, a, p, s) {
    arity(c, 'mean', a, p, 1);
    const xs = c.check(a[0], s);
    if (!isNumeric(c.r(listOf(c, xs, p, 'mean')))) return c.fail(p, 'mean needs a list of numbers');
    return { ast: b('mean', [xs.ast]), type: T.num };
  },
  min(c, a, p, s) {
    return minmax(c, 'min', a, p, s);
  },
  max(c, a, p, s) {
    return minmax(c, 'max', a, p, s);
  },
  if(c, a, p, s, ex) {
    arity(c, 'if', a, p, 3);
    const cond = c.check(a[0], s, T.bool);
    if (c.r(cond.type).t !== 'bool') return c.fail(a[0].p, `if needs a boolean condition; found ${showType(cond.type)}`);
    const x = c.check(a[1], s, ex);
    const y = c.check(a[2], s, ex ?? x.type);
    let t = join(x.type, y.type, c.env);
    let xa = x.ast;
    let ya = y.ast;
    if (!t) {
      // one branch may promote to the other's type
      const px = c.promotion(x.type, y.type);
      const py = c.promotion(y.type, x.type);
      if (py) {
        ya = { t: 'call', fn: py, args: [ya] };
        t = x.type;
      } else if (px) {
        xa = { t: 'call', fn: px, args: [xa] };
        t = y.type;
      } else c.fail(p, `if's branches have different types: ${showType(x.type)} and ${showType(y.type)}`);
    }
    return { ast: { t: 'if', c: cond.ast, a: xa, b: ya }, type: t! };
  },
  put(c, a, p, s) {
    arity(c, 'put', a, p, 3);
    const d = c.check(a[0], s);
    const dt = c.r(d.type);
    if (dt.t !== 'dict') return c.fail(a[0].p, `put needs a dict; found ${showType(d.type)}`);
    const k = c.check(a[1], s, T.text);
    if (!fits(k.type, T.text, c.env)) return c.fail(a[1].p, `dict keys are text; found ${showType(k.type)}`);
    const v = c.check(a[2], s, dt.of.t === 'unknown' ? undefined : dt.of);
    const j = join(dt.of, v.type, c.env);
    if (!j) return c.fail(a[2].p, `this dict holds ${showType(dt.of)}, not ${showType(v.type)}`);
    return { ast: b('put', [d.ast, k.ast, v.ast]), type: T.dict(j) };
  },
  get(c, a, p, s) {
    arity(c, 'get', a, p, 3);
    const d = c.check(a[0], s);
    const dt = c.r(d.type);
    if (dt.t !== 'dict') return c.fail(a[0].p, `get needs a dict; found ${showType(d.type)}`);
    const k = c.check(a[1], s, T.text);
    const def = c.check(a[2], s, dt.of);
    const j = join(dt.of, def.type, c.env) ?? c.fail(a[2].p, `the default must be ${showType(dt.of)}`);
    return { ast: b('get', [d.ast, k.ast, def.ast]), type: j };
  },
  keys(c, a, p, s) {
    arity(c, 'keys', a, p, 1);
    const d = c.check(a[0], s);
    if (c.r(d.type).t !== 'dict') return c.fail(a[0].p, 'keys needs a dict');
    return { ast: b('keys', [d.ast]), type: T.list(T.text) };
  },
  has(c, a, p, s) {
    arity(c, 'has', a, p, 2);
    const d = c.check(a[0], s);
    if (c.r(d.type).t !== 'dict') return c.fail(a[0].p, 'has needs a dict');
    const k = c.check(a[1], s, T.text);
    return { ast: b('has', [d.ast, k.ast]), type: T.bool };
  },
  format(c, a, p, s) {
    arity(c, 'format', a, p, 1, 2);
    const x = c.check(a[0], s);
    const args = [c.coerce(x, T.num, a[0].p).ast];
    if (a[1]) args.push(c.coerce(c.check(a[1], s), T.num, a[1].p).ast);
    return { ast: b('format', args), type: T.text };
  },
  join(c, a, p, s) {
    arity(c, 'join', a, p, 2);
    const xs = c.check(a[0], s);
    const el = c.r(listOf(c, xs, p, 'join'));
    if (!['text', 'choice', 'num', 'int', 'latex', 'unknown'].includes(el.t)) return c.fail(a[0].p, 'join needs a list of text');
    const sep = c.check(a[1], s, T.text);
    return { ast: b('join', [xs.ast, sep.ast]), type: T.text };
  },
  iterate(c, a, p, s) {
    return iterLike(c, 'iterate', a, p, s);
  },
  scan(c, a, p, s) {
    const r = iterLike(c, 'scan', a, p, s);
    return { ast: r.ast, type: T.list(r.type) };
  },
  parse(c, a, p, s) {
    arity(c, 'parse', a, p, 1, 2);
    const t = c.check(a[0], s, T.text);
    const vars = a[1] ? c.check(a[1], s, T.list(T.text)) : { ast: { t: 'list', items: [] } as A, type: T.list(T.text) };
    const n = a[1] && a[1].k === 'list' ? a[1].items.length : 1;
    return { ast: b('parse', [t.ast, vars.ast]), type: T.fn(Array.from({ length: a[1] && a[1].k === 'list' ? n : 0 }, () => T.num), T.num) };
  },
  equivalent(c, a, p, s) {
    arity(c, 'equivalent', a, p, 2, 3);
    const x = c.check(a[0], s, T.text);
    const y = c.check(a[1], s, T.text);
    const vars = a[2] ? c.check(a[2], s, T.list(T.text)) : { ast: { t: 'list', items: [] } as A, type: T.list(T.text) };
    return { ast: b('equivalent', [x.ast, y.ast, vars.ast]), type: T.bool };
  },
  lower: text1('lower'),
  upper: text1('upper'),
  trim: text1('trim'),
  number(c, a, p, s) {
    arity(c, 'number', a, p, 1);
    return { ast: b('number', [textArg(c, a[0], s)]), type: T.num };
  },
  replace(c, a, p, s) {
    arity(c, 'replace', a, p, 3);
    return { ast: b('replace', a.map((x) => textArg(c, x, s))), type: T.text };
  },
  split(c, a, p, s) {
    arity(c, 'split', a, p, 2);
    return { ast: b('split', a.map((x) => textArg(c, x, s))), type: T.list(T.text) };
  },
  contains: text2('contains'),
  startswith: text2('startswith'),
  endswith: text2('endswith'),
  rgb(c, a, p, s) {
    arity(c, 'rgb', a, p, 3);
    return { ast: b('rgb', a.map((x) => c.coerce(c.check(x, s), T.num, x.p).ast)), type: RGB };
  },
  hsl(c, a, p, s) {
    arity(c, 'hsl', a, p, 3);
    return { ast: b('hsl', a.map((x) => c.coerce(c.check(x, s), T.num, x.p).ast)), type: RGB };
  },
  dist(c, a, p, s) {
    arity(c, 'dist', a, p, 2);
    return { ast: b('dist', a.map((x) => c.coerce(c.check(x, s), T.point, x.p).ast)), type: T.num };
  },
};

function isText(c: ExprChecker, x: Checked): boolean {
  const t = c.r(x.type);
  return t.t === 'text' || t.t === 'choice' || t.t === 'latex';
}

function textArg(c: ExprChecker, e: Ex, s: Scope): A {
  return c.coerce(c.check(e, s, T.text), T.text, e.p).ast;
}

function text1(name: string): Special {
  return (c, a, p, s) => {
    arity(c, name, a, p, 1);
    return { ast: b(name, [textArg(c, a[0], s)]), type: T.text };
  };
}

function text2(name: string): Special {
  return (c, a, p, s) => {
    arity(c, name, a, p, 2);
    return { ast: b(name, a.map((x) => textArg(c, x, s))), type: T.bool };
  };
}

function aggregate(c: ExprChecker, name: 'sum' | 'prod', a: Ex[], p: Pos, s: Scope): Checked {
  if (a.length === 1 && name === 'sum') {
    const xs = c.check(a[0], s);
    const el = c.r(listOf(c, xs, p, 'sum'));
    if (!isNumeric(el)) return c.fail(p, 'sum needs a list of numbers');
    return { ast: b('lsum', [xs.ast]), type: el.t === 'int' ? T.int : T.num };
  }
  arity(c, name, a, p, 3);
  const lo = c.coerce(c.check(a[0], s), T.num, a[0].p);
  const hi = c.coerce(c.check(a[1], s), T.num, a[1].p);
  const f = lam(c, a[2], s, [T.int]);
  const rt = c.r(retOf(f));
  if (isNumeric(rt)) return { ast: b(name, [lo.ast, hi.ast, f.ast]), type: rt.t === 'int' ? T.int : T.num };
  // sums of pack types (complex) fold with the pack's operator
  const op = c.prog.opCandidates(name === 'sum' ? '+' : '*', c.pack).find((o) => o.sig && o.sig.length === 2 && fits(rt, o.sig[0], c.env) && fits(rt, o.sig[1], c.env));
  const zero = c.promotion(T.int, rt);
  if (!op || !zero) return c.fail(p, `${name} over ${showType(rt)} needs ${name === 'sum' ? '+' : '*'} and a from(num) for that type`);
  return { ast: b(name + 'T', [lo.ast, hi.ast, f.ast, { t: 'fnref', fn: c.ensureFn(op) }, { t: 'call', fn: zero, args: [{ t: 'num', v: name === 'sum' ? 0 : 1 }] }]), type: rt };
}

function minmax(c: ExprChecker, name: 'min' | 'max', a: Ex[], p: Pos, s: Scope): Checked {
  if (a.length === 1) {
    const xs = c.check(a[0], s);
    const el = c.r(listOf(c, xs, p, name));
    if (!isNumeric(el) && el.t !== 'unknown') return c.fail(p, `${name} needs numbers`);
    return { ast: b('l' + name, [xs.ast]), type: el.t === 'int' ? T.int : T.num };
  }
  arity(c, name, a, p, 1, 2);
  const x = c.check(a[0], s);
  const y = c.check(a[1], s);
  const xt = c.r(x.type);
  const yt = c.r(y.type);
  if (!(isNumeric(xt) || xt.t === 'any') || !(isNumeric(yt) || yt.t === 'any')) return c.fail(p, `${name} takes two numbers or a list; found ${showType(x.type)} and ${showType(y.type)}`);
  return { ast: b(name, [x.ast, y.ast]), type: xt.t === 'int' && yt.t === 'int' ? T.int : T.num };
}

function iterLike(c: ExprChecker, name: string, a: Ex[], p: Pos, s: Scope): Checked {
  arity(c, name, a, p, 3);
  const init = c.check(a[0], s);
  const n = c.coerce(c.check(a[1], s), T.num, a[1].p);
  let st = init.type;
  let f = lam(c, a[2], s, [st]);
  const j = join(st, retOf(f), c.env);
  if (!j) return c.fail(a[2].p, `${name}'s step must return the state's type ${showType(st)}; it returns ${showType(retOf(f))}`);
  if (!sameType(j, st, c.env) || hasUnknown(st)) {
    st = j;
    f = lam(c, a[2], s, [st], st);
  }
  return { ast: b(name, [init.ast, n.ast, f.ast]), type: st };
}
