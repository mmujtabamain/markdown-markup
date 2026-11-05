// The compute layer (spec 6.7, 6.18): resolved expression trees compiled to closures, with no
// eval and no host objects. Records and dicts are null-prototype objects, so keys such as
// __proto__ and constructor are plain data. Every evaluation runs under an operation budget.

import type { A, IRExpr, IRFn } from './ir';
import { ExprParser, type Ex } from './syntax/expr';
import { PosMap } from './syntax/lexer';

export type V = number | boolean | string | V[] | Rec | Fun;
export interface Rec {
  [k: string]: V;
}
export type Fun = ((...args: V[]) => V) & { __mkpFn?: true };

export const EVAL_LIMITS = { budget: 1_000_000, depth: 64, steps: 10_000, list: 10_000 };

export class EvalError extends Error {
  constructor(
    readonly code: string,
    message: string,
    readonly where?: string,
  ) {
    super(message);
  }
}

/** The budget of the evaluation in progress. */
export interface Budget {
  ops: number;
  limit: number;
  depth: number;
  where?: string;
}

let budget: Budget = { ops: 0, limit: EVAL_LIMITS.budget, depth: 0 };

/** Runs f as one evaluation with its own budget (6.18). */
export function withBudget<T>(limit: number, where: string | undefined, f: () => T): T {
  const saved = budget;
  budget = { ops: 0, limit, depth: 0, where };
  try {
    return f();
  } finally {
    budget = saved;
  }
}

function tick(n = 1): void {
  budget.ops += n;
  if (budget.ops > budget.limit) {
    throw new EvalError('mkp.budget', `ran out of budget (${budget.limit.toLocaleString('en')} operations)${budget.where ? ` in ${budget.where}` : ''}; simplify it or raise the definition's budget`, budget.where);
  }
}

function checkList(xs: V[]): V[] {
  if (xs.length > EVAL_LIMITS.list) throw new EvalError('mkp.list-size', `a list grew to ${xs.length} items; at most ${EVAL_LIMITS.list}`, budget.where);
  return xs;
}

export function rec(fields: [string, V][]): Rec {
  const o = Object.create(null) as Rec;
  for (const [k, v] of fields) o[k] = v;
  return o;
}

/** Converts plain JSON (fixtures, host inputs, literals) into runtime values. */
export function fromJson(v: unknown): V {
  if (Array.isArray(v)) return v.map(fromJson);
  if (v && typeof v === 'object') {
    const o = Object.create(null) as Rec;
    for (const k of Object.keys(v)) o[k] = fromJson((v as Record<string, unknown>)[k]);
    return o;
  }
  if (typeof v === 'number' || typeof v === 'boolean' || typeof v === 'string') return v;
  return 0;
}

/** Converts a runtime value to plain JSON (signals, conformance). */
export function toJson(v: V): unknown {
  if (Array.isArray(v)) return v.map(toJson);
  if (typeof v === 'function') return '<fn>';
  if (v && typeof v === 'object' && (v as { __slot?: boolean }).__slot) return '<slot>';
  if (v && typeof v === 'object') {
    const o: Record<string, unknown> = {};
    for (const k of Object.keys(v)) o[k] = toJson(v[k]);
    return o;
  }
  if (typeof v === 'number' && !Number.isFinite(v)) return Number.isNaN(v) ? 'nan' : v > 0 ? 'inf' : '-inf';
  return v;
}

function has(o: Rec, k: string): boolean {
  return Object.prototype.hasOwnProperty.call(o, k);
}

export function deepEqual(a: V, b: V): boolean {
  if (a === b) return true;
  if (typeof a === 'number' && typeof b === 'number') return a === b;
  if (Array.isArray(a) && Array.isArray(b)) return a.length === b.length && a.every((x, i) => deepEqual(x, b[i]));
  if (a && b && typeof a === 'object' && typeof b === 'object' && !Array.isArray(a) && !Array.isArray(b)) {
    const ka = Object.keys(a);
    const kb = Object.keys(b);
    return ka.length === kb.length && ka.every((k) => has(b as Rec, k) && deepEqual((a as Rec)[k], (b as Rec)[k]));
  }
  return false;
}

function compareKeys(a: V, b: V): number {
  if (typeof a === 'number' && typeof b === 'number') return a < b ? -1 : a > b ? 1 : 0;
  if (typeof a === 'string' && typeof b === 'string') return a < b ? -1 : a > b ? 1 : 0;
  if (typeof a === 'boolean' && typeof b === 'boolean') return Number(a) - Number(b);
  if (Array.isArray(a) && Array.isArray(b)) {
    for (let i = 0; i < Math.min(a.length, b.length); i++) {
      const c = compareKeys(a[i], b[i]);
      if (c) return c;
    }
    return a.length - b.length;
  }
  return 0;
}

// ---------------------------------------------------------------------------------------------
// Number display (6.7 live values): up to four significant figures, ∞ and —.

export function fmtNum(x: number, tex = false): string {
  if (Number.isNaN(x)) return tex ? '\\text{—}' : '—';
  if (!Number.isFinite(x)) return x > 0 ? (tex ? '\\infty' : '∞') : tex ? '-\\infty' : '−∞';
  if (x === 0) return '0';
  const a = Math.abs(x);
  if (a >= 1e6 || a < 1e-4) {
    const [m, e] = x.toExponential(3).split('e');
    const mant = String(Number(m));
    const exp = Number(e);
    return tex ? `${mant} \\times 10^{${exp}}` : `${mant}e${exp}`;
  }
  return String(Number(x.toPrecision(4)));
}

export function fmtValue(v: V, kind: string, tex: boolean): string {
  switch (kind) {
    case 'num':
    case 'int':
      return fmtNum(v as number, tex);
    case 'bool':
      return v ? 'true' : 'false';
    case 'point': {
      const p = v as number[];
      return `(${fmtNum(p[0], tex)}, ${fmtNum(p[1], tex)})`;
    }
    case 'list':
      return `[${(v as V[]).map((x) => (typeof x === 'number' ? fmtNum(x, tex) : String(x))).join(', ')}]`;
    case 'latex':
      return tex ? (v as string) : `$${v as string}$`;
    default:
      return typeof v === 'number' ? fmtNum(v, tex) : String(v);
  }
}

// ---------------------------------------------------------------------------------------------
// Environments

export interface InstLookup {
  get(name: string): V;
}

export class Env {
  constructor(
    readonly vars: Record<string, V> | null,
    readonly parent: Env | null,
    readonly inst: InstLookup | null,
    readonly prog: Programme,
  ) {}
  local(name: string): V {
    let e: Env | null = this;
    while (e) {
      if (e.vars && has(e.vars as Rec, name)) return e.vars[name];
      e = e.parent;
    }
    if (this.inst) return this.inst.get(name);
    throw new EvalError('mkp.unbound', `"${name}" has no value here`);
  }
  instVar(name: string): V {
    if (this.inst) return this.inst.get(name);
    return this.local(name);
  }
  child(vars: Record<string, V>): Env {
    return new Env(vars, this, this.inst, this.prog);
  }
  /** the instance-level env (for fns written inside a definition) */
  root(): Env {
    return new Env(null, null, this.inst, this.prog);
  }
}

/** What evaluation needs from a bundle: fns, constants, local fns of the running definition. */
export class Programme {
  private readonly compiled = new Map<string, (env: Env) => V>();
  private readonly fnCache = new Map<string, Fun>();
  private readonly constVals = new Map<string, V>();
  private readonly constBusy = new Set<string>();
  constructor(
    readonly fns: Record<string, IRFn>,
    readonly consts: Record<string, IRExpr>,
  ) {}

  compile(a: A): (env: Env) => V {
    return compileAst(a);
  }

  fnBody(id: string, local: Record<string, IRFn> | undefined): { fn: IRFn; run: (env: Env) => V } {
    const fn = local?.[id] ?? this.fns[id];
    if (!fn) throw new EvalError('mkp.unknown-fn', `the function ${id} is not in this bundle`);
    let run = this.compiled.get(id);
    if (!run) {
      run = compileAst(fn.body);
      this.compiled.set(id, run);
    }
    return { fn, run };
  }

  constValue(id: string): V {
    if (this.constVals.has(id)) return this.constVals.get(id)!;
    const c = this.consts[id];
    if (!c) throw new EvalError('mkp.unknown-const', `the constant ${id} is not in this bundle`);
    if (this.constBusy.has(id)) throw new EvalError('mkp.cycle', `constant ${id} refers to itself`);
    this.constBusy.add(id);
    const v = withBudget(EVAL_LIMITS.budget, id, () => compileAst(c.ast)(new Env(null, null, null, this)));
    this.constBusy.delete(id);
    this.constVals.set(id, v);
    return v;
  }

  /** The fns written inside the definition being evaluated (set by the runtime per instance). */
  localFns: Record<string, IRFn> | undefined;

  call(id: string, args: V[], env: Env): V {
    const local = id.startsWith('local:');
    const table = local ? (env.inst as { fns?: Record<string, IRFn> } | null)?.fns ?? this.localFns : undefined;
    const { fn, run } = this.fnBody(id, table);
    if (++budget.depth > EVAL_LIMITS.depth) {
      budget.depth = 0;
      throw new EvalError('mkp.depth', `${fn.name} recursed more than ${EVAL_LIMITS.depth} deep`, budget.where);
    }
    try {
      const vars = Object.create(null) as Record<string, V>;
      fn.params.forEach((p, i) => (vars[p] = args[i]));
      const base = local ? env.root() : new Env(null, null, null, this);
      return run(base.child(vars));
    } finally {
      budget.depth--;
    }
  }

  fnValue(id: string, env: Env): Fun {
    const key = id.startsWith('local:') ? '' : id;
    if (key && this.fnCache.has(key)) return this.fnCache.get(key)!;
    const f = ((...args: V[]) => this.call(id, args, env)) as Fun;
    if (key) this.fnCache.set(key, f);
    return f;
  }
}

// ---------------------------------------------------------------------------------------------
// The compiler

type C = (env: Env) => V;

const num = (v: V): number => v as number;

export function compileAst(a: A): C {
  switch (a.t) {
    case 'num': {
      const v = a.v;
      return () => v;
    }
    case 'bool': {
      const v = a.v;
      return () => v;
    }
    case 'str': {
      const v = a.v;
      return () => v;
    }
    case 'var': {
      const name = a.name;
      if (a.from === 'const') return (env) => env.prog.constValue(name);
      if (a.from === 'inst') return (env) => (tick(), env.instVar(name));
      return (env) => (tick(), env.local(name));
    }
    case 'list': {
      const items = a.items.map(compileAst);
      return (env) => {
        tick(items.length);
        return checkList(items.map((f) => f(env)));
      };
    }
    case 'rec': {
      const fields = a.fields.map(([k, x]) => [k, compileAst(x)] as const);
      return (env) => {
        tick(fields.length);
        const o = Object.create(null) as Rec;
        for (const [k, f] of fields) o[k] = f(env);
        return o;
      };
    }
    case 'dict0':
      return () => Object.create(null) as Rec;
    case 'point': {
      const x = compileAst(a.x);
      const y = compileAst(a.y);
      return (env) => (tick(), [x(env), y(env)]);
    }
    case 'field': {
      const o = compileAst(a.o);
      const name = a.name;
      return (env) => {
        tick();
        const v = o(env);
        if (Array.isArray(v)) {
          if (name === 'x') return v[0];
          if (name === 'y') return v[1];
        }
        if (v && typeof v === 'object' && has(v as Rec, name)) return (v as Rec)[name];
        throw new EvalError('mkp.missing-key', `no field "${name}" here`, budget.where);
      };
    }
    case 'index': {
      const o = compileAst(a.o);
      const i = compileAst(a.i);
      return (env) => {
        tick();
        const v = o(env);
        const k = i(env);
        if (Array.isArray(v)) {
          const n = k as number;
          if (!Number.isInteger(n) || n < 0 || n >= v.length) throw new EvalError('mkp.index', `index ${String(k)} is out of range (0..${v.length - 1}); use at(xs, i, default)`, budget.where);
          return v[n];
        }
        if (v && typeof v === 'object' && has(v as Rec, String(k))) return (v as Rec)[String(k)];
        throw new EvalError('mkp.missing-key', `no key "${String(k)}"; use get(d, key, default)`, budget.where);
      };
    }
    case 'not': {
      const x = compileAst(a.a);
      return (env) => (tick(), !x(env));
    }
    case 'and': {
      const x = compileAst(a.a);
      const y = compileAst(a.b);
      return (env) => (tick(), (x(env) as boolean) && (y(env) as boolean));
    }
    case 'or': {
      const x = compileAst(a.a);
      const y = compileAst(a.b);
      return (env) => (tick(), (x(env) as boolean) || (y(env) as boolean));
    }
    case 'if': {
      const c = compileAst(a.c);
      const x = compileAst(a.a);
      const y = compileAst(a.b);
      return (env) => (tick(), c(env) ? x(env) : y(env));
    }
    case 'lam': {
      const params = a.params;
      const body = compileAst(a.body);
      return (env) => {
        const f = ((...args: V[]) => {
          const vars = Object.create(null) as Record<string, V>;
          for (let i = 0; i < params.length; i++) vars[params[i]] = args[i];
          return body(env.child(vars));
        }) as Fun;
        f.__mkpFn = true;
        return f;
      };
    }
    case 'apply': {
      const f = compileAst(a.f);
      const args = a.args.map(compileAst);
      return (env) => {
        tick();
        const fv = f(env);
        if (typeof fv !== 'function') throw new EvalError('mkp.not-fn', 'this value is not a function', budget.where);
        return fv(...args.map((x) => x(env)));
      };
    }
    case 'call': {
      const id = a.fn;
      const args = a.args.map(compileAst);
      return (env) => {
        tick();
        return env.prog.call(id, args.map((x) => x(env)), env);
      };
    }
    case 'fnref': {
      const id = a.fn;
      return (env) => env.prog.fnValue(id, env);
    }
    case 'tmpl': {
      const holes = a.holes.map(compileAst);
      const parts = a.v.split(/\\val\{(\d+)\}/);
      const show = a.show;
      const modes = a.modes;
      const kinds = a.kinds;
      return (env) => {
        let out = '';
        for (let i = 0; i < parts.length; i++) {
          if (i % 2 === 0) {
            out += parts[i];
            continue;
          }
          const n = Number(parts[i]);
          const v = holes[n](env);
          const tex = modes[n] === 'tex';
          if (show[n]) {
            const s = env.prog.call(show[n]!, [v], env) as string;
            out += tex ? s : `$${s}$`;
          } else out += fmtValue(v, kinds[n], tex);
        }
        return out;
      };
    }
    case 'builtin':
      return builtin(a.fn, a.args.map(compileAst));
  }
}

const MATH1: Record<string, (x: number) => number> = {
  exp: Math.exp,
  ln: Math.log,
  sqrt: Math.sqrt,
  sin: Math.sin,
  cos: Math.cos,
  tan: Math.tan,
  asin: Math.asin,
  acos: Math.acos,
  atan: Math.atan,
  sinh: Math.sinh,
  cosh: Math.cosh,
  tanh: Math.tanh,
  abs: Math.abs,
  floor: Math.floor,
  ceil: Math.ceil,
  round: (x) => Math.floor(x + 0.5),
  sign: (x) => (x > 0 ? 1 : x < 0 ? -1 : 0),
  step: (x) => (x >= 0 ? 1 : 0),
  fact: (x) => {
    if (!Number.isInteger(x) || x < 0) return NaN;
    if (x > 170) return Infinity;
    let r = 1;
    for (let k = 2; k <= x; k++) r *= k;
    return r;
  },
  neg: (x) => -x,
};

const MATH2: Record<string, (x: number, y: number) => number> = {
  '+': (x, y) => x + y,
  '-': (x, y) => x - y,
  '*': (x, y) => x * y,
  '/': (x, y) => x / y,
  '^': Math.pow,
  pow: Math.pow,
  atan2: Math.atan2,
  mod: (x, y) => ((x % y) + y) % y,
  min: Math.min,
  max: Math.max,
};

/** rand(seed, k): a deterministic number in [0, 1) from 32-bit integer mixing (same on every engine). */
export function rand(seed: number, k: number): number {
  let h = (Math.imul((seed | 0) ^ 0x9e3779b9, 0x85ebca6b) ^ Math.imul((k | 0) + 0x632be5ab, 0xc2b2ae35)) >>> 0;
  h ^= h >>> 16;
  h = Math.imul(h, 0x7feb352d) >>> 0;
  h ^= h >>> 15;
  h = Math.imul(h, 0x846ca68b) >>> 0;
  h ^= h >>> 16;
  return (h >>> 0) / 4294967296;
}

function builtin(fn: string, args: C[]): C {
  const [x, y, z, w, u] = args;
  if (fn in MATH1) {
    const f = MATH1[fn];
    return (env) => (tick(), f(num(x(env))));
  }
  if (fn in MATH2) {
    const f = MATH2[fn];
    return (env) => (tick(), f(num(x(env)), num(y(env))));
  }
  switch (fn) {
    case 'inf':
      return () => Infinity;
    case 'nan':
      return () => NaN;
    case 'log':
      return args.length === 2 ? (env) => (tick(), Math.log(num(x(env))) / Math.log(num(y(env)))) : (env) => (tick(), Math.log10(num(x(env))));
    case 'rand':
      return (env) => (tick(), rand(num(x(env)), num(y(env))));
    case '==':
      return (env) => (tick(), deepEqual(x(env), y(env)));
    case '!=':
      return (env) => (tick(), !deepEqual(x(env), y(env)));
    case '<':
      return (env) => (tick(), (x(env) as number) < (y(env) as number));
    case '<=':
      return (env) => (tick(), (x(env) as number) <= (y(env) as number));
    case '>':
      return (env) => (tick(), (x(env) as number) > (y(env) as number));
    case '>=':
      return (env) => (tick(), (x(env) as number) >= (y(env) as number));
    case 'cat':
      return (env) => {
        tick();
        const a = x(env);
        const b = y(env);
        return (typeof a === 'number' ? fmtNum(a) : String(a)) + (typeof b === 'number' ? fmtNum(b) : String(b));
      };
    case 'lcat':
      return (env) => (tick(), checkList([...(x(env) as V[]), ...(y(env) as V[])]));
    case 'p+':
      return (env) => {
        tick();
        const a = x(env) as number[];
        const b = y(env) as number[];
        return [a[0] + b[0], a[1] + b[1]];
      };
    case 'p-':
      return (env) => {
        tick();
        const a = x(env) as number[];
        const b = y(env) as number[];
        return [a[0] - b[0], a[1] - b[1]];
      };
    case 'p*':
      return (env) => {
        tick();
        const a = x(env) as number[];
        const k = num(y(env));
        return [a[0] * k, a[1] * k];
      };
    case 'p/':
      return (env) => {
        tick();
        const a = x(env) as number[];
        const k = num(y(env));
        return [a[0] / k, a[1] / k];
      };
    case 'ps*':
      return (env) => {
        tick();
        const k = num(x(env));
        const a = y(env) as number[];
        return [a[0] * k, a[1] * k];
      };
    case 'pneg':
      return (env) => {
        tick();
        const a = x(env) as number[];
        return [-a[0], -a[1]];
      };
    case 'dist':
      return (env) => {
        tick();
        const a = x(env) as number[];
        const b = y(env) as number[];
        return Math.hypot(a[0] - b[0], a[1] - b[1]);
      };
    case 'tex2text':
      return (env) => `$${x(env) as string}$`;
    case 'len':
      return (env) => {
        tick();
        const v = x(env);
        if (Array.isArray(v) || typeof v === 'string') return v.length;
        return Object.keys(v as Rec).length;
      };
    case 'map':
      return (env) => {
        const xs = x(env) as V[];
        const f = y(env) as Fun;
        tick(xs.length);
        return xs.map((e) => f(e));
      };
    case 'filter':
      return (env) => {
        const xs = x(env) as V[];
        const f = y(env) as Fun;
        tick(xs.length);
        return xs.filter((e) => f(e) as boolean);
      };
    case 'find':
      return (env) => {
        const xs = x(env) as V[];
        const f = y(env) as Fun;
        tick(xs.length);
        for (const e of xs) if (f(e)) return e;
        if (z) return z(env);
        throw new EvalError('mkp.not-found', 'find found nothing; give it a default: find(xs, f, default)', budget.where);
      };
    case 'sort':
      return (env) => {
        const xs = x(env) as V[];
        const f = y ? (y(env) as Fun) : null;
        tick(xs.length * Math.max(1, Math.ceil(Math.log2(xs.length + 1))));
        const keyed = xs.map((e, i) => ({ e, k: f ? f(e) : e, i }));
        keyed.sort((p, q) => compareKeys(p.k, q.k) || p.i - q.i);
        return keyed.map((p) => p.e);
      };
    case 'reverse':
      return (env) => {
        const xs = x(env) as V[];
        tick(xs.length);
        return [...xs].reverse();
      };
    case 'fold':
      return (env) => {
        const xs = x(env) as V[];
        let acc = y(env);
        const f = z(env) as Fun;
        tick(xs.length);
        for (const e of xs) acc = f(acc, e);
        return acc;
      };
    case 'group':
      return (env) => {
        const xs = x(env) as V[];
        const f = y(env) as Fun;
        tick(xs.length);
        const o = Object.create(null) as Rec;
        for (const e of xs) {
          const k = String(f(e));
          ((o[k] ??= []) as V[]).push(e);
        }
        return o;
      };
    case 'index':
      return (env) => {
        const xs = x(env) as V[];
        const f = y(env) as Fun;
        tick(xs.length);
        const o = Object.create(null) as Rec;
        for (const e of xs) o[String(f(e))] = e;
        return o;
      };
    case 'indexof':
      return (env) => {
        const xs = x(env) as V[];
        const v = y(env);
        tick(xs.length);
        for (let i = 0; i < xs.length; i++) if (deepEqual(xs[i], v)) return i;
        return -1;
      };
    case 'range':
      return (env) => {
        const a = Math.ceil(num(x(env)));
        const b = Math.floor(num(y(env)));
        const n = Math.max(0, b - a + 1);
        if (n > EVAL_LIMITS.list) throw new EvalError('mkp.list-size', `range(${a}, ${b}) has ${n} items; at most ${EVAL_LIMITS.list}`, budget.where);
        tick(n);
        return Array.from({ length: n }, (_, i) => a + i);
      };
    case 'zip':
      return (env) => {
        const a = x(env) as V[];
        const b = y(env) as V[];
        const n = Math.min(a.length, b.length);
        tick(n);
        return Array.from({ length: n }, (_, i) => rec([['a', a[i]], ['b', b[i]]]));
      };
    case 'flatten':
      return (env) => {
        const xs = x(env) as V[][];
        tick(xs.length);
        return checkList(xs.flat() as V[]);
      };
    case 'at':
      return (env) => {
        tick();
        const xs = x(env) as V[];
        // an index out of range is never wrapped: -1 is not the last item (GAPS 111); last() is
        const i = num(y(env));
        if (Number.isInteger(i) && i >= 0 && i < xs.length) return xs[i];
        if (z) return z(env);
        throw new EvalError('mkp.index', `index ${num(y(env))} is out of range (0..${xs.length - 1}); use at(xs, i, default)`, budget.where);
      };
    case 'first':
      return (env) => {
        const xs = x(env) as V[];
        tick();
        return xs.slice(0, Math.max(0, num(y(env))));
      };
    case 'last':
      return (env) => {
        const xs = x(env) as V[];
        const n = Math.max(0, num(y(env)));
        tick();
        return n === 0 ? [] : xs.slice(-n);
      };
    case 'slice':
      return (env) => {
        const xs = x(env) as V[];
        tick();
        return xs.slice(num(y(env)), num(z(env)));
      };
    case 'last1':
      return (env) => {
        tick();
        const xs = x(env) as V[];
        if (!xs.length) throw new EvalError('mkp.index', 'last of an empty list; use at(xs, len(xs) - 1, default)', budget.where);
        return xs[xs.length - 1];
      };
    // text (GAPS 82): positions count characters from 0, like lists
    case 'tslice':
      return (env) => {
        tick();
        return [...(x(env) as string)].slice(num(y(env)), num(z(env))).join('');
      };
    case 'tindexof':
      return (env) => {
        const t = x(env) as string;
        tick(t.length);
        const i = t.indexOf(y(env) as string);
        return i < 0 ? -1 : [...t.slice(0, i)].length;
      };
    case 'lower':
      return (env) => (tick(), (x(env) as string).toLowerCase());
    case 'upper':
      return (env) => (tick(), (x(env) as string).toUpperCase());
    case 'trim':
      return (env) => (tick(), (x(env) as string).trim().replace(/\s+/g, ' '));
    case 'replace':
      return (env) => {
        const t = x(env) as string;
        tick(t.length);
        const a = y(env) as string;
        return a ? t.split(a).join(z(env) as string) : t;
      };
    case 'split':
      return (env) => {
        const t = x(env) as string;
        tick(t.length);
        const sep = y(env) as string;
        const parts = sep ? t.split(sep) : [...t];
        return checkList(parts);
      };
    case 'contains':
      return (env) => (tick(), (x(env) as string).includes(y(env) as string));
    case 'startswith':
      return (env) => (tick(), (x(env) as string).startsWith(y(env) as string));
    case 'endswith':
      return (env) => (tick(), (x(env) as string).endsWith(y(env) as string));
    case 'number':
      // a number as a reader types it: spaces and a decimal comma are fine; anything else is nan
      return (env) => {
        tick();
        const t = (x(env) as string).trim().replace(/\s+/g, '').replace(/^([+-]?\d*),(\d+)$/, '$1.$2').replace(/^\+/, '');
        return /^-?(\d+\.?\d*|\.\d+)(e[+-]?\d+)?$/i.test(t) ? Number(t) : NaN;
      };
    case 'lsum':
      return (env) => {
        const xs = x(env) as number[];
        tick(xs.length);
        let s = 0;
        for (const v of xs) s += v;
        return s;
      };
    case 'mean':
      return (env) => {
        const xs = x(env) as number[];
        tick(xs.length);
        if (!xs.length) return NaN;
        let s = 0;
        for (const v of xs) s += v;
        return s / xs.length;
      };
    case 'lmin':
      return (env) => {
        const xs = x(env) as number[];
        tick(xs.length);
        return xs.length ? Math.min(...xs) : NaN;
      };
    case 'lmax':
      return (env) => {
        const xs = x(env) as number[];
        tick(xs.length);
        return xs.length ? Math.max(...xs) : NaN;
      };
    case 'sum':
    case 'prod':
      return (env) => {
        const a = Math.ceil(num(x(env)));
        const b = Math.floor(num(y(env)));
        const f = z(env) as Fun;
        if (b - a + 1 > EVAL_LIMITS.steps) throw new EvalError('mkp.steps', `${fn} over ${b - a + 1} terms; at most ${EVAL_LIMITS.steps}`, budget.where);
        let s = fn === 'sum' ? 0 : 1;
        for (let k = a; k <= b; k++) s = fn === 'sum' ? s + num(f(k)) : s * num(f(k));
        return s;
      };
    case 'sumT':
    case 'prodT':
      return (env) => {
        const a = Math.ceil(num(x(env)));
        const b = Math.floor(num(y(env)));
        const f = z(env) as Fun;
        const op = w(env) as Fun;
        let s = u(env);
        if (b - a + 1 > EVAL_LIMITS.steps) throw new EvalError('mkp.steps', `${fn} over ${b - a + 1} terms; at most ${EVAL_LIMITS.steps}`, budget.where);
        for (let k = a; k <= b; k++) s = op(s, f(k));
        return s;
      };
    case 'put':
      return (env) => {
        const d = x(env) as Rec;
        const n = Object.keys(d).length;
        tick(n + 1);
        const o = Object.create(null) as Rec;
        for (const k of Object.keys(d)) o[k] = d[k];
        o[String(y(env))] = z(env);
        if (n + 1 > EVAL_LIMITS.list) throw new EvalError('mkp.list-size', `a dict grew past ${EVAL_LIMITS.list} keys`, budget.where);
        return o;
      };
    case 'get':
      return (env) => {
        tick();
        const d = x(env) as Rec;
        const k = String(y(env));
        return has(d, k) ? d[k] : z(env);
      };
    case 'keys':
      return (env) => {
        const d = x(env) as Rec;
        tick();
        return Object.keys(d);
      };
    case 'has':
      return (env) => (tick(), has(x(env) as Rec, String(y(env))));
    case 'format':
      return (env) => {
        tick();
        const v = num(x(env));
        if (!y) return fmtNum(v);
        const d = Math.max(0, Math.min(12, Math.round(num(y(env)))));
        return Number.isFinite(v) ? v.toFixed(d) : fmtNum(v);
      };
    case 'join':
      return (env) => {
        const xs = x(env) as V[];
        tick(xs.length);
        return xs.map((v) => (typeof v === 'number' ? fmtNum(v) : String(v))).join(y(env) as string);
      };
    case 'iterate':
    case 'scan':
      return (env) => {
        let s = x(env);
        const n = num(y(env));
        const f = z(env) as Fun;
        if (n > EVAL_LIMITS.steps) throw new EvalError('mkp.steps', `${fn} for ${n} steps; at most ${EVAL_LIMITS.steps}`, budget.where);
        const out: V[] = fn === 'scan' ? [s] : [];
        for (let k = 0; k < n; k++) {
          const next = f(s);
          const same = deepEqual(next, s);
          s = next;
          if (fn === 'scan') out.push(s);
          if (same) break;
        }
        return fn === 'scan' ? checkList(out) : s;
      };
    case 'parse':
      return (env) => {
        tick(10);
        const vars = (y(env) as string[]) ?? [];
        return parseUserExpr(String(x(env)), vars);
      };
    case 'equivalent':
      return (env) => {
        tick(50);
        return equivalent(String(x(env)), String(y(env)), (z?.(env) as string[]) ?? []);
      };
    case 'rgb':
      return (env) => (tick(), rec([['r', clamp01(num(x(env)))], ['g', clamp01(num(y(env)))], ['b', clamp01(num(z(env)))]]));
    case 'hsl':
      return (env) => {
        tick();
        const [r, g, b] = hsl(num(x(env)), num(y(env)), num(z(env)));
        return rec([['r', r], ['g', g], ['b', b]]);
      };
  }
  throw new EvalError('mkp.unknown-builtin', `unknown builtin ${fn}`);
}

function clamp01(v: number): number {
  return Number.isNaN(v) ? 0 : Math.min(1, Math.max(0, v));
}

/** h in turns, s and l in 0..1 */
export function hsl(h: number, s: number, l: number): [number, number, number] {
  h = ((h % 1) + 1) % 1;
  s = clamp01(s);
  l = clamp01(l);
  const c = (1 - Math.abs(2 * l - 1)) * s;
  const hp = h * 6;
  const xx = c * (1 - Math.abs((hp % 2) - 1));
  let r = 0;
  let g = 0;
  let b = 0;
  if (hp < 1) [r, g, b] = [c, xx, 0];
  else if (hp < 2) [r, g, b] = [xx, c, 0];
  else if (hp < 3) [r, g, b] = [0, c, xx];
  else if (hp < 4) [r, g, b] = [0, xx, c];
  else if (hp < 5) [r, g, b] = [xx, 0, c];
  else [r, g, b] = [c, 0, xx];
  const m = l - c / 2;
  return [r + m, g + m, b + m];
}

// ---------------------------------------------------------------------------------------------
// The answer-checking engine: parse(text, vars) and equivalent(a, b, vars)

const USER_FNS: Record<string, (x: number) => number> = { ...MATH1, log: Math.log10 };

function userCompile(e: Ex, vars: string[]): ((env: number[]) => number) | null {
  switch (e.k) {
    case 'num':
      return () => e.v;
    case 'id': {
      const i = vars.indexOf(e.name);
      if (i >= 0) return (env) => env[i];
      if (e.name === 'pi') return () => Math.PI;
      if (e.name === 'e') return () => Math.E;
      return null;
    }
    case 'neg': {
      const a = userCompile(e.a, vars);
      return a && ((env) => -a(env));
    }
    case 'bin': {
      const f = MATH2[e.op];
      if (!f) return null;
      const a = userCompile(e.a, vars);
      const b = userCompile(e.b, vars);
      return a && b && ((env) => f(a(env), b(env)));
    }
    case 'call': {
      const f = USER_FNS[e.f];
      if (!f || e.args.length !== 1) return null;
      const a = userCompile(e.args[0], vars);
      return a && ((env) => f(a(env)));
    }
    default:
      return null;
  }
}

function userParse(text: string, vars: string[]): ((env: number[]) => number) | null {
  const src = text.replace(/π/g, 'pi').replace(/×|·/g, '*').replace(/−/g, '-').replace(/÷/g, '/').trim();
  if (!src || src.length > 500) return null;
  try {
    const map = new PosMap('<answer>', [{ at: 0, line: 1, col: 1 }]);
    return userCompile(ExprParser.parse(src, 0, src.length, map), vars);
  } catch {
    return null;
  }
}

export function parseUserExpr(text: string, vars: string[]): Fun {
  const f = userParse(text, vars);
  const out = ((...args: V[]) => (f ? f(args as number[]) : NaN)) as Fun;
  out.__mkpFn = true;
  return out;
}

export function equivalent(a: string, b: string, vars: string[]): boolean {
  const fa = userParse(a, vars);
  const fb = userParse(b, vars);
  if (!fa || !fb) return false;
  let compared = 0;
  for (let k = 0; k < 16; k++) {
    const env = vars.map((_, i) => -3 + 6 * rand(7919 + i, k));
    const x = fa(env);
    const y = fb(env);
    if (Number.isNaN(x) && Number.isNaN(y)) continue;
    if (!Number.isFinite(x) || !Number.isFinite(y)) {
      if (x !== y) return false;
      continue;
    }
    compared++;
    if (Math.abs(x - y) > 1e-9 + 1e-6 * Math.max(Math.abs(x), Math.abs(y))) return false;
  }
  return compared > 0 || vars.length === 0;
}
