// Expression typing and resolution (spec 6.7, 6.22): builtins, dispatch with `from` promotion,
// generic fns checked per call, lambdas typed from where they are used, choice options as
// constants, text and maths literals with \val holes.

import { MkpError, Pos, closest, didYouMean } from '../diag';
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
/** The reader's theme, as the host draws it: a drawing that can't follow the colour tokens (a pixels
 *  ramp) picks its colours by it. */
export const THEME: Type = { t: 'choice', opts: ['light', 'dark'] };
export const GLOBALS: Record<string, Type> = { width: WIDTH, theme: THEME, answers: T.bool };

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
    /** the definition's record kinds, as named types (GAPS 44) */
    kinds?: Map<string, Type>,
  ) {
    const base = prog.typeEnv(pack);
    this.env = withParams(kinds?.size ? (n) => base(n) ?? kinds.get(n) : base, typeParams);
    this.tokenNames = prog.tokenNames;
  }

  fail(p: Pos, msg: string, code = 'mkp.type'): never {
    throw new MkpError(code, msg, p);
  }

  r(t: Type): Type {
    return resolve(t, this.env);
  }

  /** A name in scope whose type passes the test, for examples in messages. */
  nameOf(scope: Scope, test: (t: Type) => boolean): string | undefined {
    for (const n of new Set(scope.names())) {
      if (n.startsWith('$')) continue;
      const b = scope.get(n);
      if (b && test(this.r(b.type))) return n;
    }
    return undefined;
  }

  /** A short literal of a type, for examples in messages. */
  sample(t: Type): string {
    return sample(t, this.env);
  }

  /** What to write instead of reading a field from a value that has none. */
  private noFieldHint(o: Ex, ot: Type, name: string): string {
    const on = exprText(o);
    if (['len', 'length', 'size', 'count'].includes(name) && ['list', 'text', 'dict', 'records', 'choice'].includes(ot.t)) return `Write \`len(${on})\` for its length`;
    if (ot.t === 'point') return `A point has only \`.x\` and \`.y\`: write \`${on}.x\``;
    if (ot.t === 'list' || ot.t === 'records') return `Read one item first, e.g. \`${on}[0].${name}\`, or all of them with \`map(${on}, it => it.${name})\``;
    if (ot.t === 'dict') return `Read a key with \`get(${on}, "${name}", default)\` or \`${on}["${name}"]\``;
    return `Remove \`.${name}\`, or read it from a record`;
  }

  check(e: Ex, scope: Scope, expected?: Type): Checked {
    if (++this.depth > 200) this.fail(e.p, 'this expression nests more than 200 levels deep (operators, brackets or calls inside each other), too deep to check. Split it into named steps, e.g. `a = …` then `r = a + …`', 'mkp.limit');
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
        items.forEach((it, i) => {
          const j = join(et, it.type, this.env);
          if (!j) this.fail(e.items[i].p, `the items of a list must all have one type; item ${i + 1}, ${found(e.items[i], it.type)}, differs from the ${showType(et)} items before it. Make every item ${showType(et)} (e.g. \`${this.sample(et)}\`), or every item ${showType(it.type)}`);
          et = j;
        });
        if (elemExp && !hasUnknown(elemExp) && items.length) {
          return { ast: { t: 'list', items: items.map((it) => this.coerce(it, elemExp, e.p).ast) }, type: T.list(elemExp) };
        }
        return { ast: { t: 'list', items: items.map((x) => x.ast) }, type: T.list(et) };
      }
      case 'rec': {
        if (e.fields.length === 0) {
          if (ex && ex.t === 'rec' && ex.fields.length) this.fail(e.p, `expected ${ex.name ? `a ${ex.name}` : 'a'} record with ${ex.fields.map(([n, f]) => `${n} (${showType(f)})`).join(', ')}; found \`{}\`, an empty record. Write its fields, e.g. \`${this.sample(ex)}\``);
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
          if (!f) {
            const names = ot.fields.map((x) => x[0]);
            const on = exprText(e.o);
            const near = closest(e.name, names);
            const fix = near ? `Write \`${on}.${near}\`` : names.length ? `Read one of them, e.g. \`${on}.${names[0]}\`` : 'Add the field to its type';
            this.fail(e.p, `\`${on}\` is ${ot.t === 'records' ? `a ${ot.kind} record` :`${aType(o.type)}`}, which has no field "${e.name}"${didYouMean(e.name, names)}; its fields are ${names.join(', ') || 'none'}. ${fix}`, 'mkp.unknown-field');
          }
          return { ast: { t: 'field', o: o.ast, name: e.name }, type: f[1] };
        }
        if (ot.t === 'any') return { ast: { t: 'field', o: o.ast, name: e.name }, type: T.any };
        return this.fail(e.p, `\`${exprText(e.o)}\` is ${showType(o.type)}, which has no fields, so \`.${e.name}\` can't be read from it. ${this.noFieldHint(e.o, ot, e.name)}`, 'mkp.unknown-field');
      }
      case 'index': {
        const o = this.check(e.o, scope);
        const ot = this.r(o.type);
        if (ot.t === 'param' || ot.t === 'rec') {
          // a record read by a typed path: step[pointer] where pointer is path(S, int)
          const i = this.check(e.i, scope);
          const it = this.r(i.type);
          if (it.t !== 'path') {
            const on = exprText(e.o);
            const what = ot.t === 'param' ? `a ${ot.name} (a type parameter: the records the widget is given)` : `${aType(o.type)} record`;
            const how =
              ot.t === 'rec' && ot.fields.length
                ? `Read a field by name, e.g. \`${on}.${ot.fields[0][0]}\`, or declare an input naming one of its fields, \`in f path(${showType(o.type)}, ${showType(ot.fields[0][1])})\`, and write \`${on}[f]\``
                : `Declare an input naming one of its fields, e.g. \`in f path(${showType(o.type)}, text)\`, and write \`${on}[f]\``;
            this.fail(e.i.p, `\`${on}\` is ${what}, so [ ] needs a path (an input of type path(…) that names one of its fields); found ${found(e.i, i.type)}. ${how}`);
          }
          if (!sameType(it.of, o.type, this.env) && !fits(o.type, it.of, this.env)) {
            this.fail(e.i.p, `the path \`${exprText(e.i)}\` names a field of ${showType(it.of)}, but \`${exprText(e.o)}\` is ${aType(o.type)}. Declare the path as path(${showType(o.type)}, ${showType(it.to)}) and give it ${aType(o.type)} field, or use it on ${aType(it.of)} value`);
          }
          return { ast: { t: 'index', o: o.ast, i: i.ast }, type: it.to };
        }
        if (ot.t === 'list') {
          const i = this.coerce(this.check(e.i, scope, T.int), T.num, e.i.p);
          return { ast: { t: 'index', o: o.ast, i: i.ast }, type: ot.of };
        }
        if (ot.t === 'dict') {
          const i = this.check(e.i, scope, T.text);
          if (!fits(i.type, T.text, this.env)) {
            const num = isNumeric(this.r(i.type)) ? `, or turn the number into text with \`${exprText(e.o)}[format(${exprText(e.i)})]\`` : '';
            this.fail(e.i.p, `the keys of the dict \`${exprText(e.o)}\` are text; found the key ${found(e.i, i.type)}. Index it with text, e.g. \`${exprText(e.o)}["a"]\`${num}`);
          }
          return { ast: { t: 'index', o: o.ast, i: i.ast }, type: ot.of };
        }
        if (ot.t === 'any') return { ast: { t: 'index', o: o.ast, i: this.check(e.i, scope).ast }, type: T.any };
        if (ot.t === 'range') return { ast: { t: 'index', o: o.ast, i: this.coerce(this.check(e.i, scope, T.int), T.num, e.i.p).ast }, type: T.num };
        const textual = ot.t === 'text' || ot.t === 'choice' || ot.t === 'latex';
        const fix = textual ? `To take part of a text, write \`slice(${exprText(e.o)}, 0, 1)\` (characters count from 0)` : 'Index a list or a dict instead, or remove the [ ]';
        return this.fail(e.p, `only lists and dicts can be indexed with [ ]; found ${found(e.o, o.type)}. ${fix}`);
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
        return this.binary('-', { ast: { t: 'num', v: 0 }, type: T.int }, a, e.p, undefined, e.a);
      }
      case 'not': {
        const a = this.check(e.a, scope, T.bool);
        if (this.r(a.type).t !== 'bool') this.fail(e.a.p, `\`not\` needs a bool (true or false) after it; found ${found(e.a, a.type)}. ${boolFix(exprText(e.a), this.r(a.type), (x) => `not (${x})`)}`);
        return { ast: { t: 'not', a: a.ast }, type: T.bool };
      }
      case 'bin': {
        if (e.op === 'and' || e.op === 'or') {
          const a = this.check(e.a, scope, T.bool);
          const b = this.check(e.b, scope, T.bool);
          for (const [x, s, side] of [[a, e.a, 'left'], [b, e.b, 'right']] as const) {
            if (this.r(x.type).t !== 'bool') {
              const op = e.op;
              const put = (t: string): string => (side === 'left' ? `(${t}) ${op} …` : `… ${op} (${t})`);
              this.fail(s.p, `both sides of \`${op}\` must be bools (true or false); the ${side} side is ${found(s, x.type)}. ${boolFix(exprText(s), this.r(x.type), put)}`);
            }
          }
          return { ast: { t: e.op, a: a.ast, b: b.ast }, type: T.bool };
        }
        // choice options compare with words
        if ((e.op === '==' || e.op === '!=') && (e.a.k === 'id' || e.b.k === 'id')) {
          const a0 = this.tryCheck(e.a, scope);
          const b0 = this.tryCheck(e.b, scope);
          if (a0 && !b0) return this.binary(e.op, a0, this.check(e.b, scope, a0.type), e.p, e.a, e.b);
          if (b0 && !a0) return this.binary(e.op, this.check(e.a, scope, b0.type), b0, e.p, e.a, e.b);
        }
        const a = this.check(e.a, scope);
        // a list joined to a list is typed by the first (records, empty lists), unless it holds ints: [0] + nums is nums
        const al = this.r(a.type);
        const b = this.check(e.b, scope, e.op === '+' && al.t === 'list' && this.r(al.of).t !== 'int' ? a.type : undefined);
        return this.binary(e.op, a, b, e.p, e.a, e.b);
      }
      case 'lam': {
        if (!ex || (ex.t !== 'fn' && ex.t !== 'expr')) {
          const here = ex && ex.t !== 'unknown' && ex.t !== 'any' ? `, where ${showType(ex)} is expected` : '';
          this.fail(e.p, `a function written with => can only be passed to a call that takes one (map, filter, sort, fold, …); found \`${exprText(e)}\` on its own${here}. Pass it to a call, e.g. \`map(xs, ${exprText(e)})\`, or declare a fn: \`fn step(x: num): num = …\``);
        }
        const params = ex.t === 'fn' ? ex.params : ex.vars.map((v) => v[1]);
        const ret = ex.t === 'fn' ? ex.ret : ex.ret;
        if (params.length !== e.params.length) {
          const names = Array.from({ length: params.length }, (_, i) => e.params[i] ?? ['x', 'y', 'z', 'w'][i] ?? `p${i + 1}`);
          const head = names.length === 1 ? names[0] : `(${names.join(', ')})`;
          this.fail(e.p, `the function here is given ${plural(params.length, 'value')} each time, so it must take ${plural(params.length, 'parameter')}; found \`${exprText(e)}\`, which takes ${e.params.length}. Write it as \`${head} => …\``);
        }
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
        return this.applyValue(f, e.args, e.p, scope, e.f.k === 'bin' || e.f.k === 'lam' ? `(${exprText(e.f)})` : exprText(e.f));
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
    // where a choice is expected, its option wins over a name that is not of that choice (kind=plain beside a value plain)
    if (b && ex && ex.t === 'choice' && ex.opts.includes(name) && this.r(b.type).t !== 'choice') return { ast: { t: 'str', v: name }, type: ex };
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
    if (consts.length > 1) {
      const packs = consts.map((c) => c.pack);
      const list = packs.length === 2 ? `${packs[0]} and ${packs[1]}` : packs.join(', ');
      this.fail(p, `"${name}" is a constant in more than one pack (${list}), so it is unclear which is meant. Rename the constant in all but one of those packs, or, in a pack, list only one of them under \`depends\``, 'mkp.ambiguous');
    }
    // an option word of a choice in scope
    const choices = scope.choiceTypes().filter((t) => t.t === 'choice' && t.opts.includes(name));
    if (choices.length) return { ast: { t: 'str', v: name }, type: choices[0] };
    // a fn used as a value
    const fns = [...scope.localFns(name), ...this.prog.fnCandidates(name, this.pack)];
    if (fns.length === 1 && fns[0].sig) {
      const f = fns[0];
      return { ast: { t: 'fnref', fn: this.ensureFn(f) }, type: T.fn(f.sig!, f.syn.ret ?? T.any) };
    }
    const known = [...new Set(scope.names())].filter((n) => !n.startsWith('$'));
    const near = closest(name, known);
    const fix = near
      ? `Write \`${near}\``
      : `Declare it before using it (an input such as \`in ${name} int = 1\`, a var, or \`const ${name}: int = 1\` at the top), or use a defined name${known.length ? `: ${known.slice(0, 8).join(', ')}${known.length > 8 ? ', …' : ''}` : ''}`;
    return this.fail(p, `"${name}" is not defined here${didYouMean(name, known)}. ${fix}`, 'mkp.unknown-name');
  }

  /** The type of a pack constant, checking it on first use. */
  constType(id: string): Type {
    const [, name] = id.split(':');
    const c = (this.prog.consts.get(name) ?? []).find((x) => x.id === id)!;
    if (c.checked) return c.checked.type;
    if (c.checking) this.fail(c.syn.p, `the constant ${name} uses itself in its own value (directly or through other constants), so it has no value. Give it a value that does not use ${name}, e.g. \`const ${name}${c.type ? `: ${showType(c.type)}` : ''} = ${c.type ? sample(c.type, this.prog.typeEnv(c.pack)) : '10'}\``);
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
    const what = astText(c.ast);
    const hint = conversionHint(what ?? 'it', from, tt);
    const fix = hint || `Give ${aType(to)} value here, or change the declared type to ${showType(c.type)}`;
    return this.fail(p, `expected ${showType(to)} here; found ${what ? `\`${what}\` (${showType(c.type)})` : `${aType(c.type)} value`}. ${fix}`, 'mkp.type');
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

  binary(op: string, a: Checked, b: Checked, p: Pos, ea?: Ex, eb?: Ex): Checked {
    const at = this.r(a.type);
    const bt = this.r(b.type);
    const sa = ea ? exprText(ea) : astText(a.ast) ?? `${aType(a.type)}`;
    const sb = eb ? exprText(eb) : astText(b.ast) ?? `${aType(b.type)}`;
    const both = `\`${sa}\` (${showType(a.type)}) and \`${sb}\` (${showType(b.type)})`;
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
      if (!join(a.type, b.type, this.env) && !(at.t === 'choice' && bt.t === 'choice')) {
        const conv = isNumeric(at) && bt.t === 'text' ? `, or turn the number into text: \`format(${sa}) ${op} ${sb}\`` : at.t === 'text' && isNumeric(bt) ? `, or turn the number into text: \`${sa} ${op} format(${sb})\`` : '';
        this.fail(p, `\`${op}\` compares two values of the same type; found ${both}. Compare it with ${aType(a.type)} value, e.g. \`${sa} ${op} ${this.sample(a.type)}\`${conv}`);
      }
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
        if (!j) this.fail(p, `\`+\` joins two lists only when their items have the same type; found ${both}. Make the items match, e.g. \`${sa} + ${this.sample(a.type)}\``);
        return { ast: { t: 'builtin', fn: 'lcat', args: [a.ast, b.ast] }, type: T.list(j) };
      }
    }
    if (at.t === 'point' && bt.t === 'point' && (op === '+' || op === '-')) return { ast: { t: 'builtin', fn: 'p' + op, args: [a.ast, b.ast] }, type: T.point };
    if (op === '*' && isNumeric(at) && bt.t === 'point') return { ast: { t: 'builtin', fn: 'ps*', args: [a.ast, b.ast] }, type: T.point };
    if ((op === '*' || op === '/') && at.t === 'point' && isNumeric(bt)) return { ast: { t: 'builtin', fn: 'p' + op, args: [a.ast, b.ast] }, type: T.point };
    if (bt.t === 'unknown' || at.t === 'unknown' || at.t === 'any' || bt.t === 'any') return { ast: { t: 'builtin', fn: op, args: [a.ast, b.ast] }, type: cmp ? T.bool : T.any };
    if (!ea && op === '-' && eb) {
      const own = bt.t === 'rec' || bt.t === 'named';
      return this.fail(p, `\`-\` can't make ${showType(b.type)} negative; found \`-${sb}\`. ${own ? `Add \`op -(a: ${showType(b.type)}): ${showType(b.type)} = …\` to the type's pack` : 'Negate a number or a point instead'}`, 'mkp.no-operator');
    }
    const textNum = (at.t === 'text' || bt.t === 'text') && (isNumeric(at) || isNumeric(bt));
    let fix: string;
    if (at.t === 'list' && op === '+' && fits(b.type, at.of, this.env)) fix = `To add an item to the list, write \`${sa} + [${sb}]\``;
    else if (textNum && cmpOps.has(op)) fix = `Compare like with like: turn the text into a number with \`number(${at.t === 'text' ? sa : sb})\`, or the number into text with \`format(${at.t === 'text' ? sb : sa})\``;
    else if (textNum) fix = `Only \`+\` works on text (it joins); for arithmetic turn the text into a number with \`number(${at.t === 'text' ? sa : sb})\``;
    else if (at.t === 'named' || at.t === 'rec' || bt.t === 'named' || bt.t === 'rec') fix = `Define it in the type's pack: \`op ${op}(a: ${showType(a.type)}, b: ${showType(b.type)}): … = …\``;
    else fix = `Use values that \`${op}\` works on: ${op === '+' ? 'two numbers, two texts, two lists or two points' : cmpOps.has(op) ? 'two numbers or two texts' : 'numbers (points also take + and -, and * or / by a number)'}`;
    return this.fail(p, `there is no \`${op}\` for ${showType(a.type)} and ${showType(b.type)}; found ${both}. ${fix}`, 'mkp.no-operator');
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
      const label = what.startsWith('op ') ? what.slice(3) : what;
      const tied = fitsList.filter((x) => x.cost === fitsList[0].cost).map((x) => `${what}(${x.f.sig!.map(showType).join(', ')}) at ${x.f.file === this.file ? '' : `${x.f.file}:`}line ${x.f.syn.p.line}`);
      const argTypes = `(${args.map((a) => showType(a.type)).join(', ')})`;
      this.fail(p, `\`${label}\` called with ${argTypes} fits more than one definition equally well: ${tied.join(' and ')}. Remove one of them, or change their parameter types so only one fits ${argTypes}`, 'mkp.ambiguous');
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
        file: this.prog.stableFile(f.pack, f.file),
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
      if (!ret) this.fail(p, `${f.syn.name} calls itself, so the type of its result can't be worked out from its body. Declare the result type after the parameters, e.g. \`fn ${f.syn.name}(${f.syn.params.map((q) => `${q.name}: num`).join(', ')}): num = …\``, 'mkp.recursive-untyped');
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
          file: this.prog.stableFile(f.pack, f.file),
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

  private applyValue(f: Checked, args: Ex[], p: Pos, scope: Scope, label: string): Checked {
    const ft = this.r(f.type);
    const call = `${label}(${args.map((a) => exprText(a, 24)).join(', ')})`;
    if (ft.t === 'fn') {
      if (ft.params.length !== args.length) {
        this.fail(p, `\`${label}\` is a function that takes ${plural(ft.params.length, 'argument')}; found ${args.length} in \`${call}\`. Write \`${label}(${ft.params.map((t) => this.sample(t)).join(', ')})\``);
      }
      const as = args.map((a, i) => this.coerce(this.check(a, scope, ft.params[i]), ft.params[i], a.p).ast);
      return { ast: { t: 'apply', f: f.ast, args: as }, type: ft.ret };
    }
    if (ft.t === 'expr') {
      if (ft.vars.length !== args.length) {
        const vars = ft.vars.map((v) => v[0]);
        this.fail(p, `\`${label}\` is an expression in ${vars.join(', ')} (a value of type ${showType(f.type)}), so a call gives it one value per variable, ${vars.length} in all; found ${args.length} in \`${call}\`. Write \`${label}(${ft.vars.map((v) => this.sample(v[1])).join(', ')})\``);
      }
      const as = args.map((a, i) => this.coerce(this.check(a, scope, ft.vars[i][1]), ft.vars[i][1], a.p).ast);
      return { ast: { t: 'apply', f: f.ast, args: as }, type: ft.ret };
    }
    if (ft.t === 'any') return { ast: { t: 'apply', f: f.ast, args: args.map((a) => this.check(a, scope).ast) }, type: T.any };
    return this.fail(p, `\`${label}\` is ${showType(f.type)}, not a function, so it can't be called; found \`${call}\`. Remove the brackets after \`${label}\`${isNumeric(ft) && args.length === 1 ? `, or multiply with \`*\`: \`${label} * (${exprText(args[0], 24)})\`` : ''}`);
  }

  private call(name: string, args: Ex[], p: Pos, scope: Scope, ex?: Type): Checked {
    // a function value in scope (a lambda parameter or an expr(…) input)
    const b = scope.get(name);
    if (b && (this.r(b.type).t === 'fn' || this.r(b.type).t === 'expr' || this.r(b.type).t === 'any')) {
      return this.applyValue({ ast: { t: 'var', name, from: b.from === 'const' ? 'const' : b.from }, type: b.type }, args, p, scope, name);
    }
    if (b) {
      const bt = this.r(b.type);
      const what = b.kind && b.kind !== 'derived' ? `an ${b.kind === 'input' ? 'input' : b.kind === 'const' ? 'constant' : b.kind === 'param' ? 'parameter' : b.kind} of type ${showType(b.type)}` : `a value of type ${showType(b.type)}`;
      const call = `${name}(${args.map((a) => exprText(a, 24)).join(', ')})`;
      const mul = isNumeric(bt) && args.length === 1 ? `, or multiply with \`*\`: \`${name} * (${exprText(args[0], 24)})\`` : '';
      const hidden = name in SPECIAL || NUM1.includes(name) || NUM2.includes(name) || this.prog.fnCandidates(name, this.pack).length;
      const fix = hidden ? `Rename \`${name}\` so the function ${name}(…) can be called` : `Remove the brackets after \`${name}\`${mul}`;
      this.fail(p, `\`${name}\` is ${what.replace(/^an ([^aeiou])/, 'a $1')}, not a function, so it can't be called; found \`${call}\`. ${fix}`);
    }
    const local = scope.localFns(name);
    const packFns = this.prog.fnCandidates(name, this.pack);
    const user = [...local, ...packFns];
    const special = SPECIAL[name];
    if (special && !user.length) return special(this, args, p, scope, ex);
    // checked arguments for dispatch (lambdas are not dispatched on)
    const typedUser = user.filter((f) => f.sig);
    const builtinSig = builtinSignature(name, args.length);
    if (typedUser.length || builtinSig) {
      // one function of this name and arity: its parameters type the arguments (a colour token, a record literal)
      const only = !builtinSig && typedUser.filter((f) => f.sig!.length === args.length);
      const checked = args.map((a, i) => this.check(a, scope, only && only.length === 1 ? only[0].sig![i] : undefined));
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
      const sigs = [...cands.map((c) => c.sig!), ...[1, 2].map((n) => builtinSignature(name, n)).filter((s): s is Type[] => !!s)];
      const forms = sigs.map((s) => `${name}(${s.map(showType).join(', ')})`).join(', ');
      const call = `${name}(${args.map((a) => exprText(a, 24)).join(', ')})`;
      const same = sigs.find((s) => s.length === args.length);
      const bad = same ? checked.findIndex((c, i) => !fits(c.type, same[i], this.env)) : -1;
      const detail = same && bad >= 0 ? `: argument ${bad + 1}, ${found(args[bad], checked[bad].type)}, is not ${showType(same[bad])}` : same ? '' : ` (${args.length} given)`;
      const fix = same ? `Pass arguments of those types, e.g. \`${name}(${same.map((t) => this.sample(t)).join(', ')})\`` : sigs.length ? `Pass ${plural(sigs[0].length, 'argument')}, e.g. \`${name}(${sigs[0].map((t) => this.sample(t)).join(', ')})\`` : 'Check the arguments';
      this.fail(p, `no definition of ${name} takes (${checked.map((c) => showType(c.type)).join(', ')}); found \`${call}\`${detail}. ${name} is defined as ${forms || 'nothing that fits'}. ${fix}`, 'mkp.no-overload');
    }
    const generic = user.filter((f) => f.syn.params.length === args.length);
    if (generic.length === 1) {
      const checked = args.map((a, i) => this.check(a, scope, generic[0].syn.params[i].type));
      return this.specialise(generic[0], checked, p);
    }
    if (generic.length > 1) {
      const ps = Array.from({ length: args.length }, (_, i) => `${generic[0].syn.params[i]?.name ?? `p${i + 1}`}: int`).join(', ');
      this.fail(p, `${name} is defined ${generic.length} times with ${plural(args.length, 'parameter')} and no parameter types, so a call can't tell which one is meant. Give each definition parameter types that differ, e.g. \`fn ${name}(${ps}): int = …\`, or rename one of them`, 'mkp.ambiguous');
    }
    if (user.length) {
      const q = user[0].syn.params;
      this.fail(p, `${name} takes ${plural(q.length, 'argument')} (${q.map((x) => x.name).join(', ')}); found ${args.length} in \`${name}(${args.map((a) => exprText(a, 24)).join(', ')})\`. Pass ${q.length === 1 ? 'one' : q.length === 2 ? 'both' : `all ${q.length}`}: \`${name}(${q.map((x) => (x.type ? this.sample(x.type) : '…')).join(', ')})\``);
    }
    const counts = [1, 2, 3].filter((n) => builtinSignature(name, n));
    if (counts.length) {
      const want = counts.length === 1 ? plural(counts[0], 'argument') : `${counts.join(' or ')} arguments`;
      const eg = counts.map((n) => `\`${name}(${builtinSignature(name, n)!.map(() => '1.5').join(', ')})\``).join(' or ');
      return this.fail(p, `${name} takes ${want}; found ${args.length} in \`${name}(${args.map((a) => exprText(a, 24)).join(', ')})\`. Call it as ${eg}`, 'mkp.unknown-function');
    }
    const all = [...Object.keys(SPECIAL), ...NUM1, ...NUM2, 'log', 'rand', ...this.prog.fns.keys()];
    const near = closest(name, all);
    const fix = near ? `Write \`${near}(…)\`` : `Fix the name, or declare the function first, e.g. \`fn ${name}(x: num): num = …\``;
    return this.fail(p, `there is no function "${name}"${didYouMean(name, all)}. ${fix}`, 'mkp.unknown-function');
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
      if (kind === 'other' && !sh) {
        const field = rt.t === 'rec' && rt.fields.length ? rt.fields.find(([, f]) => ['text', 'num', 'int'].includes(this.r(f).t))?.[0] ?? rt.fields[0][0] : undefined;
        const tn = showType(c.type);
        const one = field ? `Show one of its fields, e.g. \`\\val{${h.src}.${field}}\`, or declare` : 'Declare';
        this.fail(p, `\`\\val{${h.src}}\` shows a ${tn}, which has no text form, so it can't be written into the text. ${one} \`fn show(v: ${tn}): text = …\` so \\val can write any ${tn}`, 'mkp.type');
      }
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

// ---------------------------------------------------------------------------------------------
// Message helpers: what the author wrote, back as text, and short examples of a type's values.

/** An expression as the author would write it, shortened for a message. */
export function exprText(e: Ex, max = 48): string {
  const s = exprSrc(e);
  return s.length > max ? s.slice(0, max - 1) + '…' : s;
}

function exprSrc(e: Ex): string {
  const sub = (x: Ex): string => (x.k === 'bin' || x.k === 'lam' ? `(${exprSrc(x)})` : exprSrc(x));
  switch (e.k) {
    case 'num':
      return String(e.v);
    case 'str':
      return JSON.stringify(e.v);
    case 'tex':
      return e.display ? `$$${e.v}$$` : `$${e.v}$`;
    case 'id':
      return e.name;
    case 'list':
      return `[${e.items.map(exprSrc).join(', ')}]`;
    case 'rec':
      return `{${e.fields.map(([n, x]) => `${n}: ${exprSrc(x)}`).join(', ')}}`;
    case 'point':
      return `(${exprSrc(e.x)}, ${exprSrc(e.y)})`;
    case 'call':
      return `${e.f}(${e.args.map(exprSrc).join(', ')})`;
    case 'apply':
      return `${sub(e.f)}(${e.args.map(exprSrc).join(', ')})`;
    case 'field':
      return `${sub(e.o)}.${e.name}`;
    case 'index':
      return `${sub(e.o)}[${exprSrc(e.i)}]`;
    case 'neg':
      return `-${sub(e.a)}`;
    case 'not':
      return `not ${sub(e.a)}`;
    case 'bin':
      return e.juxt ? `${sub(e.a)}${sub(e.b)}` : `${sub(e.a)} ${e.op} ${sub(e.b)}`;
    case 'lam':
      return `${e.params.length === 1 ? e.params[0] : `(${e.params.join(', ')})`} => ${exprSrc(e.body)}`;
  }
}

/** `x` (type): the value an author wrote and the type it has. */
function found(e: Ex, t: Type): string {
  return `\`${exprText(e)}\` (${showType(t)})`;
}

/** A type with its article: a text, an int. */
function aType(t: Type): string {
  const s = showType(t);
  return `${/^[aeiou]/.test(s) ? 'an' : 'a'} ${s}`;
}

function plural(n: number, word: string): string {
  return `${n} ${word}${n === 1 ? '' : 's'}`;
}

const cmpOps = new Set(['==', '!=', '<', '<=', '>', '>=']);

const TOKEN_SAMPLE: Record<string, string> = { color: 'accent', font: 'body', space: 'm', size: 'm', radius: 'card', shadow: 'raised' };

/** A short literal of a type, for examples in messages. */
function sample(t: Type, env: TypeEnv, depth = 0): string {
  const r = resolve(t, env);
  switch (r.t) {
    case 'int':
      return r.lo !== undefined ? String(r.lo) : '1';
    case 'num':
      return r.lo !== undefined ? String(r.lo) : '1.5';
    case 'bool':
      return 'true';
    case 'text':
      return '"a"';
    case 'latex':
      return '$x$';
    case 'choice':
      return r.opts[0];
    case 'point':
      return '(0, 0)';
    case 'list':
      return depth > 1 ? '[]' : `[${sample(r.of, env, depth + 1)}]`;
    case 'dict':
      return '{}';
    case 'rec':
      return depth > 1 || !r.fields.length ? '{}' : `{${r.fields.slice(0, 2).map(([n, f]) => `${n}: ${sample(f, env, depth + 1)}`).join(', ')}}`;
    case 'token':
      return TOKEN_SAMPLE[r.kind] ?? '…';
    default:
      return '…';
  }
}

/** The usual way to call each hand-typed builtin, for arity messages. */
const USAGE: Record<string, string> = {
  len: 'len(xs)',
  map: 'map(xs, x => …)',
  filter: 'filter(xs, x => …)',
  find: 'find(xs, x => …) or find(xs, x => …, default)',
  sort: 'sort(xs) or sort(xs, x => key)',
  reverse: 'reverse(xs)',
  fold: 'fold(xs, start, (acc, x) => …)',
  group: 'group(xs, x => key)',
  index: 'index(xs, x => key)',
  indexof: 'indexof(xs, x)',
  range: 'range(lo, hi)',
  zip: 'zip(xs, ys)',
  flatten: 'flatten(xss)',
  first: 'first(xs) or first(xs, n)',
  last: 'last(xs) or last(xs, n)',
  slice: 'slice(xs, from, to)',
  at: 'at(xs, i) or at(xs, i, default)',
  sum: 'sum(xs) or sum(lo, hi, k => …)',
  prod: 'prod(lo, hi, k => …)',
  mean: 'mean(xs)',
  min: 'min(xs) or min(a, b)',
  max: 'max(xs) or max(a, b)',
  if: 'if(condition, then, else)',
  put: 'put(d, key, value)',
  get: 'get(d, key, default)',
  keys: 'keys(d)',
  has: 'has(d, key)',
  format: 'format(x) or format(x, digits)',
  join: 'join(xs, separator)',
  iterate: 'iterate(start, n, x => next)',
  scan: 'scan(start, n, x => next)',
  parse: 'parse(text) or parse(text, ["x"])',
  equivalent: 'equivalent(a, b) or equivalent(a, b, ["x"])',
  lower: 'lower(t)',
  upper: 'upper(t)',
  trim: 'trim(t)',
  number: 'number(t)',
  replace: 'replace(t, find, with)',
  split: 'split(t, separator)',
  contains: 'contains(t, part)',
  startswith: 'startswith(t, part)',
  endswith: 'endswith(t, part)',
  rgb: 'rgb(r, g, b)',
  hsl: 'hsl(h, s, l)',
  dist: 'dist(p, q)',
};

/** The usual calls of a builtin, each in backticks. */
function usage(name: string): string {
  return (USAGE[name] ?? `${name}(…)`).split(' or ').map((u) => `\`${u}\``).join(' or ');
}

/** How to turn a value of one type into another, when there is a usual way. */
function conversionHint(what: string, from: Type, to: Type): string {
  const isNum = (t: Type): boolean => t.t === 'num' || t.t === 'int';
  if (to.t === 'int' && from.t === 'num') return `Round it with \`round(${what})\` (or \`floor\`/\`ceil\`), or declare the type as num`;
  if (isNum(to) && (from.t === 'text' || from.t === 'choice')) return `To read a number from text, write \`number(${what})\`${to.t === 'int' ? ` (and \`round(number(${what}))\` for an int)` : ''}`;
  if (to.t === 'text' && isNum(from)) return `To show a number as text, write \`format(${what})\``;
  if (to.t === 'bool' && isNum(from)) return `Compare it to get true or false, e.g. \`${what} > 0\``;
  if (to.t === 'bool' && from.t === 'text') return `Compare it to get true or false, e.g. \`${what} != ""\``;
  if (to.t === 'list' && !['list', 'records'].includes(from.t)) return `Wrap it in a list: \`[${what}]\``;
  return '';
}

/** How to make a bool from a value, written into the place it goes. */
function boolFix(what: string, t: Type, place: (x: string) => string): string {
  if (t.t === 'num' || t.t === 'int') return `Compare it to get true or false, e.g. \`${place(`${what} > 0`)}\``;
  if (t.t === 'text') return `Compare it to get true or false, e.g. \`${place(`${what} != ""`)}\``;
  if (t.t === 'choice') return `Compare it with an option, e.g. \`${place(`${what} == ${t.opts[0]}`)}\``;
  return 'Use a comparison or another true/false value there';
}

/** A simple AST back to the name or literal it came from, when it is one. */
function astText(a: A): string | undefined {
  const x = a as { t: string; name?: string; v?: unknown };
  if (x.t === 'var' && typeof x.name === 'string') return x.name.startsWith('$') ? x.name.slice(1) : x.name.includes(':') ? x.name.split(':').pop() : x.name;
  if (x.t === 'num' || x.t === 'bool') return String(x.v);
  if (x.t === 'str' && typeof x.v === 'string') return x.v.length > 30 ? undefined : JSON.stringify(x.v);
  return undefined;
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
  if (ns.includes(args.length)) return;
  const want = ns.length === 1 ? plural(ns[0], 'argument') : `${ns.slice(0, -1).join(', ')} or ${ns[ns.length - 1]} arguments`;
  const call = `${name}(${args.map((a) => exprText(a, 24)).join(', ')})`;
  c.fail(p, `${name} takes ${want}; found ${args.length} in \`${call}\`. Call it as ${usage(name)}`, 'mkp.arity');
}

function listOf(c: ExprChecker, x: Checked, e: Ex, name: string): Type {
  const t = c.r(x.type);
  if (t.t === 'list') return t.of;
  if (t.t === 'records') return { t: 'rec', fields: t.fields };
  if (t.t === 'any') return T.any;
  const isText = t.t === 'text' || t.t === 'choice';
  const fix = isText && name !== 'join' ? `To get a list of its characters or words, write \`split(${exprText(e)}, "")\` or \`split(${exprText(e)}, " ")\`` : `Pass a list (an input of type list(…), or one written out like [1, 2, 3]): ${usage(name)}`;
  return c.fail(e.p, `${name} needs a list here; found ${found(e, x.type)}. ${fix}`);
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
    if (t.t !== 'list' && t.t !== 'text' && t.t !== 'dict' && t.t !== 'records' && t.t !== 'any') return c.fail(a[0].p, `len counts the items of a list, the characters of a text or the keys of a dict; found ${found(a[0], x.type)}. Pass one of those, e.g. \`len(${c.nameOf(s, (t) => t.t === 'list') ?? '[1, 2, 3]'})\``);
    return { ast: b('len', [x.ast]), type: T.int };
  },
  map(c, a, p, s, ex) {
    arity(c, 'map', a, p, 2);
    const xs = c.check(a[0], s);
    const el = listOf(c, xs, a[0], 'map');
    // a list of known type is expected: each result is typed by it, so tokens read as tokens
    const want = ex && c.r(ex).t === 'list' ? (c.r(ex) as { of: Type }).of : T.unknown;
    const f = lam(c, a[1], s, [el], hasUnknown(want) ? T.unknown : want);
    return { ast: b('map', [xs.ast, f.ast]), type: T.list(retOf(f)) };
  },
  filter(c, a, p, s) {
    arity(c, 'filter', a, p, 2);
    const xs = c.check(a[0], s);
    const el = listOf(c, xs, a[0], 'filter');
    const f = lam(c, a[1], s, [el], T.bool);
    if (c.r(retOf(f)).t !== 'bool') return c.fail(a[1].p, `filter keeps the items its function says true for, so the function must return a bool; found \`${exprText(a[1])}\`, which returns ${showType(retOf(f))}. Give a test, e.g. \`filter(${exprText(a[0], 24)}, x => x > 1)\``);
    return { ast: b('filter', [xs.ast, f.ast]), type: T.list(el) };
  },
  find(c, a, p, s) {
    arity(c, 'find', a, p, 2, 3);
    const xs = c.check(a[0], s);
    const el = listOf(c, xs, a[0], 'find');
    const f = lam(c, a[1], s, [el], T.bool);
    const args = [xs.ast, f.ast];
    if (a[2]) args.push(c.coerce(c.check(a[2], s, el), el, a[2].p).ast);
    return { ast: b('find', args), type: el };
  },
  sort(c, a, p, s) {
    arity(c, 'sort', a, p, 1, 2);
    const xs = c.check(a[0], s);
    const el = listOf(c, xs, a[0], 'sort');
    if (a.length === 1) return { ast: b('sort', [xs.ast]), type: T.list(el) };
    const f = lam(c, a[1], s, [el]);
    return { ast: b('sort', [xs.ast, f.ast]), type: T.list(el) };
  },
  reverse(c, a, p, s) {
    arity(c, 'reverse', a, p, 1);
    const xs = c.check(a[0], s);
    return { ast: b('reverse', [xs.ast]), type: T.list(listOf(c, xs, a[0], 'reverse')) };
  },
  fold(c, a, p, s) {
    arity(c, 'fold', a, p, 3);
    const xs = c.check(a[0], s);
    const el = listOf(c, xs, a[0], 'fold');
    const init = c.check(a[1], s);
    let acc = init.type;
    let f = lam(c, a[2], s, [acc, el]);
    const j = join(acc, retOf(f), c.env);
    if (!j) return c.fail(a[2].p, `fold's function gets the running total and an item and must return the new total, of the same type as the start value \`${exprText(a[1], 24)}\` (${showType(acc)}); found \`${exprText(a[2])}\`, which returns ${showType(retOf(f))}. Return ${aType(acc)}, e.g. \`(acc, x) => acc + x\``);
    if (hasUnknown(acc) || !sameType(j, acc, c.env)) {
      acc = j;
      f = lam(c, a[2], s, [acc, el], acc);
    }
    return { ast: b('fold', [xs.ast, init.ast, f.ast]), type: acc };
  },
  group(c, a, p, s) {
    arity(c, 'group', a, p, 2);
    const xs = c.check(a[0], s);
    const el = listOf(c, xs, a[0], 'group');
    const f = lam(c, a[1], s, [el]);
    return { ast: b('group', [xs.ast, f.ast]), type: T.dict(T.list(el)) };
  },
  index(c, a, p, s) {
    arity(c, 'index', a, p, 2);
    const xs = c.check(a[0], s);
    const el = listOf(c, xs, a[0], 'index');
    const f = lam(c, a[1], s, [el]);
    return { ast: b('index', [xs.ast, f.ast]), type: T.dict(el) };
  },
  indexof(c, a, p, s) {
    arity(c, 'indexof', a, p, 2);
    const xs = c.check(a[0], s);
    if (isText(c, xs)) return { ast: b('tindexof', [xs.ast, textArg(c, a[1], s)]), type: T.int };
    const el = listOf(c, xs, a[0], 'indexof');
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
    return { ast: b('zip', [xs.ast, ys.ast]), type: T.list({ t: 'rec', fields: [['a', listOf(c, xs, a[0], 'zip')], ['b', listOf(c, ys, a[1], 'zip')]] }) };
  },
  flatten(c, a, p, s) {
    arity(c, 'flatten', a, p, 1);
    const xs = c.check(a[0], s);
    const inner = c.r(listOf(c, xs, a[0], 'flatten'));
    if (inner.t !== 'list') return c.fail(a[0].p, `flatten needs a list of lists, such as [[1], [2, 3]]; found ${found(a[0], xs.type)}. Pass a list whose items are lists, or drop flatten if the list is already flat`);
    return { ast: b('flatten', [xs.ast]), type: T.list(inner.of) };
  },
  first(c, a, p, s) {
    arity(c, 'first', a, p, 1, 2);
    const xs = c.check(a[0], s);
    const el = listOf(c, xs, a[0], 'first');
    if (a.length === 1) return { ast: b('at', [xs.ast, { t: 'num', v: 0 }]), type: el };
    const n = c.coerce(c.check(a[1], s), T.num, a[1].p);
    return { ast: b('first', [xs.ast, n.ast]), type: T.list(el) };
  },
  last(c, a, p, s) {
    arity(c, 'last', a, p, 1, 2);
    const xs = c.check(a[0], s);
    const el = listOf(c, xs, a[0], 'last');
    if (a.length === 1) return { ast: b('last1', [xs.ast]), type: el };
    const n = c.coerce(c.check(a[1], s), T.num, a[1].p);
    return { ast: b('last', [xs.ast, n.ast]), type: T.list(el) };
  },
  slice(c, a, p, s) {
    arity(c, 'slice', a, p, 3);
    const xs = c.check(a[0], s);
    if (isText(c, xs)) return { ast: b('tslice', [xs.ast, c.coerce(c.check(a[1], s), T.num, a[1].p).ast, c.coerce(c.check(a[2], s), T.num, a[2].p).ast]), type: T.text };
    const el = listOf(c, xs, a[0], 'slice');
    const i = c.coerce(c.check(a[1], s), T.num, a[1].p);
    const j = c.coerce(c.check(a[2], s), T.num, a[2].p);
    return { ast: b('slice', [xs.ast, i.ast, j.ast]), type: T.list(el) };
  },
  at(c, a, p, s) {
    arity(c, 'at', a, p, 2, 3);
    const xs = c.check(a[0], s);
    const el = listOf(c, xs, a[0], 'at');
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
    if (!isNumeric(c.r(listOf(c, xs, a[0], 'mean')))) return c.fail(a[0].p, `mean needs a list of numbers; found ${found(a[0], xs.type)}. Pass numbers, e.g. \`mean(${c.nameOf(s, (t) => t.t === 'list' && isNumeric(c.r(t.of))) ?? '[1, 2, 3]'})\``);
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
    if (c.r(cond.type).t !== 'bool') return c.fail(a[0].p, `the condition of if (its first argument) must be a bool (true or false); found ${found(a[0], cond.type)}. ${boolFix(exprText(a[0], 24), c.r(cond.type), (t) => `if(${t}, …, …)`)}`);
    // a bare word (a colour token, an option) takes its type from the other branch: if(t == none, muted, t)
    const bare = (e: Ex): boolean => e.k === 'id' && !s.get(e.name) && !GLOBALS[e.name];
    let x: Checked;
    let y: Checked;
    if (!ex && bare(a[1]) && !bare(a[2])) {
      y = c.check(a[2], s);
      x = c.check(a[1], s, y.type);
    } else {
      x = c.check(a[1], s, ex);
      y = c.check(a[2], s, ex ?? x.type);
    }
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
      } else c.fail(p, `the two results of if must have the same type; found ${found(a[1], x.type)} when true and ${found(a[2], y.type)} when false. Change \`${exprText(a[2], 24)}\` to ${aType(x.type)} (e.g. \`${c.sample(x.type)}\`), or \`${exprText(a[1], 24)}\` to ${aType(y.type)}`);
    }
    return { ast: { t: 'if', c: cond.ast, a: xa, b: ya }, type: t! };
  },
  put(c, a, p, s) {
    arity(c, 'put', a, p, 3);
    const d = c.check(a[0], s);
    const dt = c.r(d.type);
    if (dt.t !== 'dict') return c.fail(a[0].p, `put needs a dict (text keys to values) as its first argument; found ${found(a[0], d.type)}. Pass a dict, e.g. \`put(${c.nameOf(s, (t) => t.t === 'dict') ?? '{}'}, "a", 1)\``);
    const k = c.check(a[1], s, T.text);
    if (!fits(k.type, T.text, c.env)) return c.fail(a[1].p, `the keys of a dict are text; found the key ${found(a[1], k.type)} in put. Pass text, e.g. "a"${isNumeric(c.r(k.type)) ? `, or turn the number into text with \`format(${exprText(a[1], 24)})\`` : ''}`);
    const v = c.check(a[2], s, dt.of.t === 'unknown' ? undefined : dt.of);
    const j = join(dt.of, v.type, c.env);
    if (!j) return c.fail(a[2].p, `\`${exprText(a[0], 24)}\` holds ${showType(dt.of)} values, so put can't store ${found(a[2], v.type)} in it. Pass ${aType(dt.of)} as the value, e.g. \`put(${exprText(a[0], 24)}, ${exprText(a[1], 24)}, ${c.sample(dt.of)})\``);
    return { ast: b('put', [d.ast, k.ast, v.ast]), type: T.dict(j) };
  },
  get(c, a, p, s) {
    arity(c, 'get', a, p, 3);
    const d = c.check(a[0], s);
    const dt = c.r(d.type);
    if (dt.t !== 'dict') return c.fail(a[0].p, `get needs a dict (text keys to values) as its first argument; found ${found(a[0], d.type)}. Pass a dict, e.g. \`get(${c.nameOf(s, (t) => t.t === 'dict') ?? 'd'}, "a", 0)\`${c.r(d.type).t === 'list' ? `; to read an item of a list, write \`at(${exprText(a[0], 24)}, i, default)\`` : ''}`);
    const k = c.check(a[1], s, T.text);
    const def = c.check(a[2], s, dt.of);
    const j = join(dt.of, def.type, c.env) ?? c.fail(a[2].p, `get's third argument is the default it returns when the key is missing, so it must be ${showType(dt.of)} like the dict's values; found ${found(a[2], def.type)}. Write e.g. \`get(${exprText(a[0], 24)}, ${exprText(a[1], 24)}, ${c.sample(dt.of)})\``);
    return { ast: b('get', [d.ast, k.ast, def.ast]), type: j };
  },
  keys(c, a, p, s) {
    arity(c, 'keys', a, p, 1);
    const d = c.check(a[0], s);
    if (c.r(d.type).t !== 'dict') return c.fail(a[0].p, `keys lists the keys of a dict; found ${found(a[0], d.type)}. Pass a dict, e.g. \`keys(${c.nameOf(s, (t) => t.t === 'dict') ?? 'd'})\`${c.r(d.type).t === 'list' ? `; a list's positions are \`range(0, len(${exprText(a[0], 24)}) - 1)\`` : ''}`);
    return { ast: b('keys', [d.ast]), type: T.list(T.text) };
  },
  has(c, a, p, s) {
    arity(c, 'has', a, p, 2);
    const d = c.check(a[0], s);
    if (c.r(d.type).t !== 'dict') return c.fail(a[0].p, `has checks whether a dict has a key; found ${found(a[0], d.type)}. Pass a dict, e.g. \`has(${c.nameOf(s, (t) => t.t === 'dict') ?? 'd'}, "a")\`${c.r(d.type).t === 'list' ? `; to test a list, write \`indexof(${exprText(a[0], 24)}, x) >= 0\`` : ''}`);
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
    const el = c.r(listOf(c, xs, a[0], 'join'));
    if (!['text', 'choice', 'num', 'int', 'latex', 'unknown'].includes(el.t)) return c.fail(a[0].p, `join needs a list of text or numbers to join into one text; found ${found(a[0], xs.type)}. Pass such a list, e.g. \`join(["a", "b"], ", ")\`${el.t === 'list' ? ', or flatten a list of lists first with `flatten(…)`' : el.t === 'rec' ? ', or pick a field first: `map(xs, it => it.name)`' : ''}`);
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
    const el = c.r(listOf(c, xs, a[0], 'sum'));
    if (!isNumeric(el)) return c.fail(a[0].p, `sum needs a list of numbers; found ${found(a[0], xs.type)}. Pass numbers, e.g. \`sum(${c.nameOf(s, (t) => t.t === 'list' && isNumeric(c.r(t.of))) ?? '[1, 2, 3]'})\`, or add up a function over a range with \`sum(lo, hi, k => …)\``);
    return { ast: b('lsum', [xs.ast]), type: el.t === 'int' ? T.int : T.num };
  }
  if (name === 'sum') arity(c, name, a, p, 1, 3);
  else arity(c, name, a, p, 3);
  const lo = c.coerce(c.check(a[0], s), T.num, a[0].p);
  const hi = c.coerce(c.check(a[1], s), T.num, a[1].p);
  const f = lam(c, a[2], s, [T.int]);
  const rt = c.r(retOf(f));
  if (isNumeric(rt)) return { ast: b(name, [lo.ast, hi.ast, f.ast]), type: rt.t === 'int' ? T.int : T.num };
  // sums of pack types (complex) fold with the pack's operator
  const op = c.prog.opCandidates(name === 'sum' ? '+' : '*', c.pack).find((o) => o.sig && o.sig.length === 2 && fits(rt, o.sig[0], c.env) && fits(rt, o.sig[1], c.env));
  const zero = c.promotion(T.int, rt);
  if (!op || !zero) {
    const sym = name === 'sum' ? '+' : '*';
    const tn = showType(retOf(f));
    const own = rt.t === 'rec' || rt.t === 'named';
    const missing = [!op ? `\`op ${sym}(a: ${tn}, b: ${tn}): ${tn}\`` : '', !zero ? `\`op from(n: num): ${tn}\` (to start from ${name === 'sum' ? 0 : 1})` : ''].filter(Boolean).join(' and ');
    const fix = own ? `Add ${missing} to the type's pack` : `Return a number from the function, e.g. \`${name}(${exprText(a[0], 12)}, ${exprText(a[1], 12)}, k => k * 2)\``;
    return c.fail(a[2].p, `${name}(lo, hi, k => …) ${name === 'sum' ? 'adds' : 'multiplies'} the function's results for each whole k from lo to hi, so they must be numbers${own ? ` or a type with ${sym} and from` : ''}; found \`${exprText(a[2])}\`, which returns ${tn}. ${fix}`);
  }
  return { ast: b(name + 'T', [lo.ast, hi.ast, f.ast, { t: 'fnref', fn: c.ensureFn(op) }, { t: 'call', fn: zero, args: [{ t: 'num', v: name === 'sum' ? 0 : 1 }] }]), type: rt };
}

function minmax(c: ExprChecker, name: 'min' | 'max', a: Ex[], p: Pos, s: Scope): Checked {
  if (a.length === 1) {
    const xs = c.check(a[0], s);
    const el = c.r(listOf(c, xs, a[0], name));
    if (!isNumeric(el) && el.t !== 'unknown') return c.fail(a[0].p, `${name} of a list needs a list of numbers; found ${found(a[0], xs.type)}. Pass numbers, e.g. \`${name}([1, 2, 3])\`, or two numbers: \`${name}(a, b)\``);
    return { ast: b('l' + name, [xs.ast]), type: el.t === 'int' ? T.int : T.num };
  }
  arity(c, name, a, p, 1, 2);
  const x = c.check(a[0], s);
  const y = c.check(a[1], s);
  const xt = c.r(x.type);
  const yt = c.r(y.type);
  if (!(isNumeric(xt) || xt.t === 'any') || !(isNumeric(yt) || yt.t === 'any')) {
    const [bad, bt] = !(isNumeric(xt) || xt.t === 'any') ? [a[0], x.type] : [a[1], y.type];
    return c.fail(bad.p, `${name} takes two numbers, or one list of numbers; found ${found(a[0], x.type)} and ${found(a[1], y.type)}. Replace ${found(bad, bt)} with a number, e.g. \`${name}(${bad === a[0] ? `1, ${exprText(a[1], 24)}` : `${exprText(a[0], 24)}, 1`})\``);
  }
  return { ast: b(name, [x.ast, y.ast]), type: xt.t === 'int' && yt.t === 'int' ? T.int : T.num };
}

function iterLike(c: ExprChecker, name: string, a: Ex[], p: Pos, s: Scope): Checked {
  arity(c, name, a, p, 3);
  const init = c.check(a[0], s);
  const n = c.coerce(c.check(a[1], s), T.num, a[1].p);
  let st = init.type;
  let f = lam(c, a[2], s, [st]);
  const j = join(st, retOf(f), c.env);
  if (!j) return c.fail(a[2].p, `${name}'s step function gets the current value and must return the next one, of the same type as the start value \`${exprText(a[0], 24)}\` (${showType(st)}); found \`${exprText(a[2])}\`, which returns ${showType(retOf(f))}. Return ${aType(st)}, e.g. \`v => v + 1\``);
  if (!sameType(j, st, c.env) || hasUnknown(st)) {
    st = j;
    f = lam(c, a[2], s, [st], st);
  }
  return { ast: b(name, [init.ast, n.ast, f.ast]), type: st };
}
