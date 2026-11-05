// Checking one definition (spec 6.3–6.14, 6.18, 6.19) and emitting its definition IR (13).

import { Diagnostics, MkpError, Pos, didYouMean } from '../diag';
import type { A, IRAction, IRDef, IRExpr, IRFn, IRInput, IRMeta, IRNode, IRPos, IRState, IRVal, IRValue } from '../ir';
import { IR_VERSION } from '../ir';
import { GFX_SHAPES } from '../base';
import type { Ex } from '../syntax/expr';
import { parseValueString, type ActionSyn, type Arg, type DefSyn, type EventSyn, type NodeSyn, type Val } from '../syntax/mkp';
import { fits, hasParam, join, resolve, sameType, showType, substitute, T, Type, TypeEnv } from '../types';
import { canonical } from '../syntax/canon';
import { ExprChecker, GLOBALS, Scope, withParams, type Checked } from './expr';
import type { DefEntry, FnEntry, Program } from './program';

export const LIMITS = {
  nesting: 12,
  children: 32,
  elements: 300,
  defDepth: 12,
  eachItems: 10000,
  nodes: 5000,
  listSize: 10000,
  budget: 1_000_000,
  budgetMax: 20_000_000,
  steps: 10_000,
  recursion: 64,
  pixelsTerms: 2000,
};

export interface Sig {
  id: string;
  kind: 'widget' | 'part' | 'extern';
  name: string;
  version: number;
  pack: string;
  inputs: Map<string, { type: Type; hasDefault: boolean; about?: string }>;
  order: string[];
  fields: string[];
  outs: Map<string, Type | undefined>;
  /** record kind → the record-list input that holds it (records nested in records are found through recordTypes) */
  records: Map<string, { input: string; type: Extract<Type, { t: 'records' }> }>;
  slots: string[];
  requires: string[];
  /** type parameters, bound at each use (walk of S) */
  params?: string[];
}

/** An arrow's look (6.10): its colour, its line, the marks at its ends, faded back or drawn strong. */
const ARROW_ENDS: Type = { t: 'choice', opts: ['arrow', 'hollow', 'one', 'many', 'dot', 'ring', 'cross', 'none'] };
const ARROW_LOOK: Record<string, Type> = {
  tone: { t: 'token', kind: 'color' },
  line: { t: 'choice', opts: ['solid', 'dashed', 'dotted'] },
  // dot and ring are ER's exactly-one and zero-or-one ends (GAPS 140)
  head: ARROW_ENDS,
  tail: ARROW_ENDS,
  dim: T.bool,
  bold: T.bool,
  // drawn under the content, so a line never crosses a box's text (GAPS 100)
  layer: { t: 'choice', opts: ['front', 'behind'] },
  // quieter than muted (GAPS 122)
  opacity: { t: 'num', lo: 0, hi: 1 },
};
const META_KEYS = new Set(['id', 'if', 'basis', 'span', 'self', 'keep']);
const META_FLAGS = new Set(['hidden', 'grow']);
const SELF: Type = { t: 'choice', opts: ['start', 'center', 'end', 'stretch'] };
const TRACK_RE = /^(auto|fit|\d+(\.\d+)?(fr|ch)|xs|s|m|l|xl)$/;
const EVENT_ONLY_STATE = new Set(['change', 'end']);

export function signatureOf(prog: Program, d: DefEntry): Sig {
  const env = prog.typeEnv(d.pack);
  const inputs = new Map<string, { type: Type; hasDefault: boolean; about?: string }>();
  const order: string[] = [];
  let fields: string[] = [];
  const outs = new Map<string, Type | undefined>();
  const records = new Map<string, { input: string; type: Extract<Type, { t: 'records' }> }>();
  const slots: string[] = [];
  const requires: string[] = [];
  for (const m of d.syn.members) {
    if (m.m === 'in') {
      inputs.set(m.name, { type: m.type, hasDefault: !!m.def || m.type.t === 'slot' || m.type.t === 'records', about: m.about });
      order.push(m.name);
      const t = resolve(m.type, env);
      if (t.t === 'records') records.set(t.kind, { input: m.name, type: t });
      if (t.t === 'slot') slots.push(m.name);
    } else if (m.m === 'fields') fields = m.names;
    else if (m.m === 'out') outs.set(m.name, m.payload);
    else if (m.m === 'requires') requires.push(m.cap);
  }
  return { id: d.id, kind: d.syn.kind, name: d.syn.name, version: d.syn.version, pack: d.pack, inputs, order, fields, outs, records, slots, requires, ...(d.syn.params?.length ? { params: d.syn.params } : {}) };
}

/** Binds type parameters by matching what a use gives against what its inputs declare. */
export function unify(want: Type, got: Type, params: string[], bound: Record<string, Type>, env: TypeEnv): string | null {
  if ((want.t === 'named' || want.t === 'param') && params.includes(want.name)) {
    const prev = bound[want.name];
    if (!prev) {
      bound[want.name] = got;
      return null;
    }
    const j = join(prev, got, env);
    if (!j) return `${want.name} is ${showType(prev)} in one place and ${showType(got)} in another`;
    bound[want.name] = j;
    return null;
  }
  const g = resolve(got, env);
  if ((want.t === 'list' || want.t === 'dict') && g.t === want.t) return unify(want.of, g.of, params, bound, env);
  if (want.t === 'rec' && g.t === 'rec') {
    for (const [n, t] of want.fields) {
      const f = g.fields.find(([m]) => m === n);
      if (f) {
        const e = unify(t, f[1], params, bound, env);
        if (e) return e;
      }
    }
  }
  return null;
}

/** The plain-data type of a YAML value, for inferring a type parameter from a document block. */
export function yamlType(v: unknown, what: string, top = true): Type {
  if (typeof v === 'number') return Number.isInteger(v) ? T.int : T.num;
  if (typeof v === 'boolean') return T.bool;
  if (typeof v === 'string') return T.text;
  if (Array.isArray(v)) {
    // an empty list inside an item takes its type from the other items' (a step with no choices)
    if (!v.length && !top) return T.list(T.unknown);
    if (!v.length) throw new Error(`${what} is empty, so its items' type can't be told; give at least one`);
    let t = yamlType(v[0], `${what}[0]`, false);
    for (let i = 1; i < v.length; i++) {
      const u = yamlType(v[i], `${what}[${i}]`, false);
      const j = join(t, u, () => undefined);
      if (!j) throw new Error(`${what}[${i}] is ${showType(u)}, but the items before it are ${showType(t)}: every item has the same fields of the same types`);
      t = j;
    }
    return T.list(t);
  }
  if (v && typeof v === 'object') return { t: 'rec', fields: Object.entries(v).map(([k, x]) => [k, yamlType(x, `${what}.${k}`, false)] as [string, Type]) };
  throw new Error(`${what} has no value`);
}

/** A signature with its type parameters replaced, for one use. */
export function instantiate(sig: Sig, bound: Record<string, Type>): Sig {
  const inputs = new Map([...sig.inputs].map(([k, v]) => [k, { ...v, type: substitute(v.type, bound) }]));
  const records = new Map([...sig.records].map(([k, v]) => [k, { input: v.input, type: substitute(v.type, bound) as Extract<Type, { t: 'records' }> }]));
  return { ...sig, inputs, records, params: undefined };
}

interface RecCtx {
  kind: 'record';
  type: Extract<Type, { t: 'records' }>;
  sig: Sig;
}
interface UseCtx {
  kind: 'use';
  sig: Sig;
}
interface ViewCtx {
  kind: 'view';
}
type Ctx = RecCtx | UseCtx | ViewCtx;

export interface DefCheckOptions {
  /** the definitions currently being checked inside each other (cycle and depth guard) */
  tokenNames: (kind: string) => Set<string>;
  sigs: Map<string, Sig>;
  /** fixtures may show parts on their own */
  allowParts?: boolean;
  /** the lock's choice for a name used without @N (6.17) */
  locked?: (name: string) => string | undefined;
  /** the profile's block attributes (16): a document may write these on any block */
  blockAttrs?: Set<string>;
}

export class DefChecker {
  readonly ir: IRDef;
  readonly x: ExprChecker;
  readonly env: TypeEnv;
  readonly scope = new Scope();
  private readonly localFns: Record<string, IRFn> = {};
  private readonly staticIds = new Map<string, { hidden: boolean; overlay: boolean; p: Pos }>();
  private elementCount = 0;
  private readonly path: string[] = [];
  readonly usesGfx = new Set<string>();
  /** the definitions this one uses (for cycle and lock tracking) */
  readonly uses = new Set<string>();
  private readonly outs = new Map<string, Type | undefined>();
  private readonly signals = new Map<string, Type>();
  private readonly controlNames = new Map<string, string>();
  private readonly stateNames = new Map<string, { control?: string; settable: boolean; type: Type }>();
  /** option words of this definition's choices → the name whose choice it is */
  private readonly options = new Map<string, string>();

  constructor(
    readonly prog: Program,
    readonly entry: DefEntry,
    readonly diags: Diagnostics,
    readonly opts: DefCheckOptions,
  ) {
    const s = entry.syn;
    // its record kinds are named types inside it, so a fn can take one (GAPS 44)
    const kinds = new Map<string, Type>();
    for (const m of s.members) {
      if (m.m !== 'in') continue;
      const visit = (t: Type): void => {
        if (t.t === 'records') {
          kinds.set(t.kind, { t: 'rec', name: t.kind, fields: t.slot ? [...t.fields, ['slot', T.slot]] : t.fields, ...(t.defaults ? { defaults: t.defaults } : {}) });
          t.fields.forEach(([, f]) => visit(f));
        } else if (t.t === 'list') visit(t.of);
      };
      visit(m.type);
    }
    const base = prog.typeEnv(entry.pack);
    const withKinds: TypeEnv = kinds.size ? (n) => base(n) ?? kinds.get(n) : base;
    this.env = withParams(withKinds, s.params ?? []);
    this.x = new ExprChecker(prog, entry.pack, this.localFns, entry.file, s.params ?? [], kinds);
    this.x.tokenNames = opts.tokenNames;
    this.ir = {
      ir: IR_VERSION,
      kind: s.kind,
      id: entry.id,
      name: s.name,
      version: s.version,
      pack: entry.pack,
      file: entry.file,
      about: s.about,
      inputs: [],
      pos: pos(s.p),
    };
    if (s.params?.length) this.ir.params = s.params;
    // the options of its own choices: no name it declares may hide one (GAPS 42)
    for (const m of s.members) {
      const opts2 = m.m === 'state' && m.opts ? m.opts : m.m === 'in' || m.m === 'var' || m.m === 'host' ? (resolve(m.type, this.env).t === 'choice' ? (resolve(m.type, this.env) as { opts: string[] }).opts : []) : [];
      for (const o of opts2) if (!this.options.has(o)) this.options.set(o, m.m === 'state' || m.m === 'in' || m.m === 'var' || m.m === 'host' ? m.name : '');
    }
    if (s.comments.length) this.ir.comment = s.comments;
    this.path.push(`${s.name}@${s.version}`);
  }

  err(e: unknown): void {
    if (e instanceof MkpError) this.diags.add({ ...e.diagnostic, path: e.diagnostic.path ?? [...this.path] });
    else throw e;
  }
  fail(p: Pos, msg: string, code = 'mkp.check'): never {
    throw new MkpError(code, msg, p, [...this.path]);
  }

  check(): IRDef {
    const s = this.entry.syn;
    const ir = this.ir;
    // header members
    for (const m of s.members) {
      try {
        switch (m.m) {
          case 'requires':
            (ir.requires ??= []).push(m.cap);
            if (!/^[a-z0-9-]+@\d+$/.test(m.cap)) this.fail(m.p, `"${m.cap}" is not a capability (name@N)`);
            break;
          case 'budget':
            if (m.n > LIMITS.budgetMax) this.fail(m.p, `a budget may be at most ${LIMITS.budgetMax.toLocaleString('en')} operations`, 'mkp.limit');
            ir.budget = m.n;
            break;
          case 'fields':
            ir.fields = m.names;
            break;
          case 'out':
            if (m.payload) this.checkType(m.payload, m.p);
            this.outs.set(m.name, m.payload);
            (ir.outs ??= []).push(clean({ name: m.name, payload: m.payload, about: m.about, comment: m.comments.length ? m.comments : undefined }));
            break;
          case 'signal':
            this.checkType(m.payload, m.p);
            if (m.name === 'error') this.fail(m.p, 'the "error" signal is reserved; every widget sends it from its error boundary (15.1)', 'mkp.reserved');
            this.signals.set(m.name, m.payload);
            (ir.signals ??= []).push(clean({ name: m.name, payload: m.payload, about: m.about, comment: m.comments.length ? m.comments : undefined }));
            break;
        }
      } catch (e) {
        this.err(e);
      }
    }
    if (s.kind === 'extern') {
      for (const m of s.members) if (m.m === 'node' || m.m === 'derived' || m.m === 'state' || m.m === 'var') this.err(new MkpError('mkp.extern-view', 'an extern has no view, state or values; providers implement it in code', 'p' in m ? m.p : m.node.p));
    }
    // inputs first: they are in scope everywhere
    for (const m of s.members) {
      if (m.m !== 'in') continue;
      try {
        this.input(m);
      } catch (e) {
        this.err(e);
      }
    }
    if (ir.fields) for (const f of ir.fields) if (!ir.inputs.some((i) => i.name === f)) this.err(new MkpError('mkp.unknown-field', `fields names "${f}", which is not an input${didYouMean(f, ir.inputs.map((i) => i.name))}`, s.p));
    // values in order
    const values: IRValue[] = [];
    for (const m of s.members) {
      try {
        switch (m.m) {
          case 'host': {
            this.checkType(m.type, m.p);
            const def = this.staticValue(m.def, m.type, m.p);
            this.scope.set(m.name, { type: m.type, from: 'inst', kind: 'host' });
            values.push(clean({ k: 'host', name: m.name, type: m.type, default: def, about: m.about, pos: pos(m.p), comment: cm(m.comments) }));
            break;
          }
          case 'var': {
            this.checkType(m.type, m.p);
            const def = this.value(m.def, m.type, this.scope, m.p, true);
            this.declare(m.name, m.p);
            this.scope.set(m.name, { type: m.type, from: 'inst', kind: 'var' });
            this.stateNames.set(m.name, { settable: true, type: m.type });
            values.push(clean({ k: 'var', name: m.name, type: m.type, default: def, about: m.about, pos: pos(m.p), comment: cm(m.comments) }));
            break;
          }
          case 'state':
            values.push(this.state(m));
            break;
          case 'derived': {
            this.declare(m.name, m.p);
            const c = this.x.check(m.e, this.scope);
            this.scope.set(m.name, { type: c.type, from: 'inst', kind: 'derived' });
            values.push(clean({ k: 'derived', name: m.name, value: this.irExpr(c, m.src, m.p), pos: pos(m.p), comment: cm(m.comments) }));
            break;
          }
          case 'fn': {
            // every fn says what it takes and gives, so a mistake is a compile error (GAPS 43)
            const untyped = m.params.filter((q) => !q.type).map((q) => q.name);
            if (untyped.length || !m.ret) this.fail(m.p, `fn ${m.name} must type ${untyped.length ? `its parameter${untyped.length > 1 ? 's' : ''} ${untyped.join(', ')}` : ''}${untyped.length && !m.ret ? ' and ' : ''}${!m.ret ? 'its result (fn name(x: num): num = …)' : ''}`, 'mkp.untyped');
            this.shadow(m.name, m.p);
            const list = this.scope.fns.get(m.name) ?? [];
            const id = `local:${this.entry.id}:${m.name}#${list.length}`;
            const sig = m.params.every((q) => q.type) ? m.params.map((q) => q.type!) : undefined;
            const entry = { id, pack: this.entry.pack, file: this.entry.file, syn: m, sig, scope: this.scope } as FnEntry & { scope: Scope };
            list.push(entry);
            this.scope.fns.set(m.name, list);
            if (sig) this.x.ensureFn(entry);
            values.push(clean({ k: 'fn', name: m.name, fn: id, params: m.params.map((q) => (q.type ? { name: q.name, type: q.type } : { name: q.name })), ret: m.ret, body: normalize(m.src), pos: pos(m.p), comment: cm(m.comments) }));
            break;
          }
        }
      } catch (e) {
        this.err(e);
      }
    }
    if (values.length) ir.values = values;
    // static ids (actions may name ids written later in the view)
    for (const m of s.members) if (m.m === 'node') this.collectIds(m.node);
    // commands (their fields are in scope in their actions)
    for (const m of s.members) {
      if (m.m !== 'command') continue;
      try {
        if (m.payload) this.checkType(m.payload, m.p);
        const sc = this.scope.child();
        const pt = m.payload ? resolve(m.payload, this.env) : undefined;
        if (pt && pt.t === 'rec') for (const [n, t] of pt.fields) sc.set(n, { type: t, from: 'local', kind: 'field' });
        const actions = m.actions.flatMap((a) => this.action(a, sc));
        (ir.commands ??= []).push(clean({ name: m.name, payload: m.payload, about: m.about, actions, comment: cm(m.comments) }));
      } catch (e) {
        this.err(e);
      }
    }
    // the view
    const view: IRNode[] = [];
    for (const m of s.members) {
      if (m.m !== 'node') continue;
      try {
        view.push(...this.nodes([m.node], { kind: 'view' }, this.scope, 1));
      } catch (e) {
        this.err(e);
      }
    }
    if (view.length) ir.view = view;
    if (this.elementCount > LIMITS.elements) this.err(new MkpError('mkp.limit', `${this.elementCount} elements; a definition may have at most ${LIMITS.elements}`, s.p));
    // projections
    for (const m of s.members) {
      if (m.m !== 'project') continue;
      try {
        const c = this.x.coerce(this.x.check(m.e, this.scope, T.text), T.text, m.p);
        (ir.project ??= {})[m.target] = this.irExpr(c, m.src, m.p);
      } catch (e) {
        this.err(e);
      }
    }
    this.answerLeaks();
    this.implementsCheck();
    if (Object.keys(this.localFns).length) ir.fns = this.localFns;
    if (this.usesGfx.size && !s.about && s.kind !== 'extern') {
      this.err(new MkpError('mkp.no-fallback', `${s.name}@${s.version} needs gfx@1 (${[...this.usesGfx].join(', ')}) and has no fallback: give it an "about" text, shown where gfx@1 is missing`, s.p));
    }
    if (this.usesGfx.size && !(ir.requires ?? []).includes('gfx@1')) {
      this.err(new MkpError('mkp.requires-gfx', `${[...this.usesGfx].join(', ')} need the gfx@1 capability; add "requires gfx@1" to ${s.name}@${s.version}`, s.p));
    }
    return ir;
  }

  /**
   * Answers stay out of Markdown built without them (GAPS 166): project md may read an answer
   * input, or a value computed from one, only inside if(answers, …).
   */
  private answerLeaks(): void {
    const ir = this.ir;
    const tainted = new Set(ir.inputs.filter((i) => i.answer).map((i) => i.name));
    if (!tainted.size || !ir.project) return;
    const reads = (a: A | undefined, guarded: boolean, seen: Set<string>): boolean => {
      if (!a || typeof a !== 'object') return false;
      if (a.t === 'if' && a.c.t === 'var' && a.c.name === '$answers') return reads(a.b, guarded, seen) || (!guarded && false);
      if (a.t === 'var' && a.from === 'inst' && tainted.has(a.name)) return !guarded;
      if (a.t === 'call' && this.localFns[a.fn] && !seen.has(a.fn)) {
        seen.add(a.fn);
        if (reads(this.localFns[a.fn].body, guarded, seen)) return true;
      }
      for (const v of Object.values(a)) {
        if (Array.isArray(v)) {
          for (const x of v) if (x && typeof x === 'object' && 't' in x && reads(x as A, guarded, seen)) return true;
        } else if (v && typeof v === 'object' && 't' in v && reads(v as A, guarded, seen)) return true;
      }
      return false;
    };
    for (const v of ir.values ?? []) if (v.k === 'derived' && reads(v.value.ast, false, new Set())) tainted.add(v.name);
    for (const [target, e] of Object.entries(ir.project)) {
      if (e && reads(e.ast, false, new Set())) this.err(new MkpError('mkp.answer-leak', `project ${target} shows an answer (${[...tainted].join(', ')}) outside if(answers, …), so Markdown built without answers would still give it away`, { file: this.entry.file, line: e.pos?.[0] ?? this.entry.syn.p.line, col: e.pos?.[1] ?? 1 }, [...this.path]));
    }
  }

  /** What an implemented interface asks for, the definition has, with the same types (6.24). */
  private implementsCheck(): void {
    const ir = this.ir;
    for (const m of this.entry.syn.members) {
      if (m.m !== 'implements') continue;
      for (const nv of m.names) {
        try {
          const e = this.prog.lookupIface(nv, this.entry.pack);
          if (!e) this.fail(m.p, `there is no interface ${nv}${didYouMean(nv, [...this.prog.ifaces.values()].map((x) => `${x.syn.name}@${x.syn.version}`))}`, 'mkp.unknown-interface');
          const f = e.syn;
          const same = (a: Type, b: Type): boolean => sameType(a, b, this.env) || (fits(a, b, this.env) && fits(b, a, this.env));
          const miss: string[] = [];
          for (const x of f.inputs) {
            const i = ir.inputs.find((n) => n.name === x.name);
            if (!i) miss.push(`has no in ${x.name} ${showType(x.type)}`);
            else if (!same(i.type, x.type)) miss.push(`its in ${x.name} is ${showType(i.type)}, not ${showType(x.type)}`);
          }
          for (const x of f.hosts) {
            const h = (ir.values ?? []).find((v) => v.k === 'host' && v.name === x.name) as { type: Type } | undefined;
            if (!h) miss.push(`has no host ${x.name} ${showType(x.type)}`);
            else if (!same(h.type, x.type)) miss.push(`its host ${x.name} is ${showType(h.type)}, not ${showType(x.type)}`);
          }
          for (const x of f.signals) {
            const sg = ir.signals?.find((v) => v.name === x.name);
            const want = resolve(x.payload, this.env);
            const got = sg ? resolve(sg.payload, this.env) : undefined;
            if (!sg || !got || got.t !== 'rec' || want.t !== 'rec') miss.push(`has no signal ${x.name} ${showType(x.payload)}`);
            else for (const [n, t] of want.fields) {
              const g = got.fields.find(([k]) => k === n);
              if (!g || !same(g[1], t)) miss.push(`its signal ${x.name} has no ${n}: ${showType(t)}`);
            }
          }
          for (const x of f.outs) if (!ir.outs?.some((o) => o.name === x.name)) miss.push(`has no out ${x.name}`);
          if (f.project && !ir.project?.md) miss.push('has no project md');
          if (miss.length) this.fail(m.p, `${this.entry.syn.name} implements ${nv} but ${miss.join('; ')}`, 'mkp.interface');
          (ir.implements ??= []).push(e.id);
        } catch (err) {
          this.err(err);
        }
      }
    }
  }

  /**
   * A name this definition declares may not hide what a reader means by the same word (GAPS 42,
   * 83, 110, 128, 137): a colour token, an option of its own choices, or a value every definition
   * reads. Colours are the words a widget computes with (if(ok, ok, bad)); the other token kinds
   * (body, s, card, raised) are only ever read where a font, space, size, radius or shadow is
   * expected, and there the token always wins, so a slot can still be called body.
   */
  shadow(name: string, p: Pos): void {
    try {
      this.shadow1(name, p);
    } catch (e) {
      this.err(e);
    }
  }

  private shadow1(name: string, p: Pos): void {
    // the base set's externs name their props as they are drawn (field width, a box's line)
    if (this.prog.packs.get(this.entry.pack)?.builtin) return;
    if (GLOBALS[name]) this.fail(p, `"${name}" is the reader's ${name === 'width' ? 'width (narrow, medium or wide)' : 'answers switch'}, which every definition reads; name this something else`, 'mkp.shadow');
    if (RESERVED.has(name)) this.fail(p, `"${name}" is a value of the language; name this something else`, 'mkp.shadow');
    for (const kind of ['color']) {
      if (this.opts.tokenNames(kind).has(name)) this.fail(p, `"${name}" is a ${kind === 'color' ? 'colour' : kind} token; a name declared here can't take it, or "${name}" in a style would mean this instead (rename it, e.g. "${name}2" or "is${name[0].toUpperCase()}${name.slice(1)}")`, 'mkp.shadow');
    }
    const owner = this.options.get(name);
    if (owner !== undefined && owner !== name) this.fail(p, `"${name}" is an option of ${owner ? `${owner}'s choice` : 'a choice here'}; a name can't take it, or comparing ${owner || 'it'} with ${name} would read this instead`, 'mkp.shadow');
  }

  private checkType(t: Type, p: Pos): void {
    const walk = (x: Type): void => {
      switch (x.t) {
        case 'param':
          break;
        case 'path':
          walk(x.of);
          walk(x.to);
          break;
        case 'named':
          if (this.entry.syn.params?.includes(x.name)) break;
          if (resolve(x, this.env).t !== 'named') break;
          if (!this.prog.lookupType(x.name, this.entry.pack)) this.fail(p, `there is no type "${x.name}"${didYouMean(x.name, [...this.prog.types.values()].map((v) => v.name))}`, 'mkp.unknown-type');
          break;
        case 'list':
        case 'dict':
        case 'ref':
          walk(x.of);
          break;
        case 'rec':
        case 'records':
          x.fields.forEach((f) => walk(f[1]));
          break;
        case 'expr':
          x.vars.forEach((v) => walk(v[1]));
          walk(x.ret);
          break;
        default:
          break;
      }
    };
    walk(t);
  }

  private declare(name: string, p: Pos): void {
    if (this.scope.has(name)) this.fail(p, `"${name}" is already declared in this definition`, 'mkp.duplicate');
    this.shadow(name, p);
  }

  /** The scope type of an input: record lists read as lists of records with their slot. */
  private scopeType(t: Type): Type {
    const r = resolve(t, this.env);
    if (r.t === 'records') return T.list({ t: 'rec', fields: r.slot ? [...r.fields, ['slot', T.slot]] : r.fields });
    return t;
  }

  private input(m: Extract<DefSyn['members'][number], { m: 'in' }>): void {
    this.checkType(m.type, m.p);
    this.declare(m.name, m.p);
    const inp: IRInput = { name: m.name, type: m.type, pos: pos(m.p) };
    if (m.answer) inp.answer = true;
    if (m.about) inp.about = m.about;
    if (m.comments.length) inp.comment = m.comments;
    const emptyRecords = rt0(m.type, this.env) === 'records' && m.def?.v === 'expr' && m.def.e.k === 'list' && !m.def.e.items.length;
    if (m.def && !emptyRecords) inp.default = this.staticValue(m.def, m.type, m.p);
    this.ir.inputs.push(inp);
    const rt = resolve(m.type, this.env);
    this.scope.set(m.name, { type: this.scopeType(m.type), from: 'inst', kind: rt.t === 'ref' ? 'ref' : 'input' });
    if (rt.t === 'ref') this.stateNames.set(m.name, { settable: true, type: rt.of });
  }

  /** A default value: checked against the type with only constants in scope. */
  staticValue(v: Val, type: Type, p: Pos): IRVal {
    return this.value(v, type, new Scope(), p, true);
  }

  private state(m: Extract<DefSyn['members'][number], { m: 'state' }>): IRState {
    this.declare(m.name, m.p);
    const args: Record<string, IRVal> = {};
    let type: Type = T.num;
    let play: number | undefined;
    let loop: IRState['loop'];
    const positional = m.args.filter((a) => !a.key);
    const keyed = new Map(m.args.filter((a) => a.key).map((a) => [a.key!, a]));
    const take = (k: string): Arg | undefined => {
      const a = keyed.get(k);
      keyed.delete(k);
      return a;
    };
    const playArg = take('play');
    let playPer = false;
    if (playArg) {
      if (playArg.value.v !== 'dur') this.fail(playArg.p, 'play takes a duration such as 8s, or 500ms/step');
      play = playArg.value.ms;
      playPer = !!playArg.value.per;
    }
    const loopArg = take('loop');
    if (loopArg) {
      const w = loopArg.value.v === 'expr' && loopArg.value.e.k === 'id' ? loopArg.value.e.name : '';
      if (!['once', 'repeat', 'bounce'].includes(w)) this.fail(loopArg.p, 'loop is once, repeat or bounce');
      loop = w as IRState['loop'];
    }
    switch (m.control) {
      case 'slider': {
        const r = positional.shift();
        if (!r || r.value.v !== 'range') this.fail(m.p, 'a slider needs its range: slider a..b');
        const lo = this.x.coerce(this.x.check(r.value.lo, this.scope), T.num, r.p);
        const hi = this.x.coerce(this.x.check(r.value.hi, this.scope), T.num, r.p);
        args.min = this.constOrExpr(lo, r.value.loSrc, r.p);
        args.max = this.constOrExpr(hi, r.value.hiSrc, r.p);
        const st = take('step');
        let intStep = false;
        if (st) {
          const sv = this.value(st.value, T.num, this.scope, st.p);
          args.step = sv;
          intStep = st.value.v === 'expr' && st.value.e.k === 'num' && Number.isInteger(st.value.e.v);
        }
        type = intStep && resolve(lo.type, this.env).t === 'int' ? T.int : T.num;
        break;
      }
      case 'choice':
        type = { t: 'choice', opts: m.opts! };
        args.opts = { lit: m.opts };
        break;
      case 'toggle':
        type = T.bool;
        break;
      case 'steps': {
        const n = positional.shift();
        if (!n) this.fail(m.p, 'steps needs a count: steps n');
        args.n = this.value(n.value, T.int, this.scope, n.p);
        // none=true: it starts at no step (-1), and start over goes back there (GAPS 123)
        for (const k of ['none', 'track']) {
          const a = take(k);
          if (a) {
            const v = this.value(a.value, T.bool, this.scope, a.p);
            if (!('lit' in v)) this.fail(a.p, `${k} is true or false, written`);
            args[k] = v;
          }
        }
        type = T.int;
        break;
      }
      case 'clock':
        // seconds since it last started, running while the widget is on screen (GAPS 169)
        type = T.num;
        if (play) this.fail(m.p, 'a clock runs on its own; play and pause it with actions');
        break;
      case 'drag': {
        for (const k of ['x', 'y']) {
          const a = take(k);
          if (!a || a.value.v !== 'range') this.fail(m.p, 'drag needs its ranges: drag x=a..b y=c..d');
          args[k] = this.value(a.value, T.range, this.scope, a.p);
        }
        type = T.point;
        break;
      }
    }
    if (positional.length) this.fail(positional[0].p, `unexpected value for ${m.control}`);
    for (const [k, a] of keyed) this.fail(a.p, `${m.control} has no setting "${k}"`, 'mkp.unknown-prop');
    if (m.control === 'drag' && play) this.fail(m.p, 'a drag control cannot play');
    const st: IRState = { k: 'state', name: m.name, control: m.control, type, args, pos: pos(m.p) };
    if (play) st.play = play;
    if (playPer) st.playPer = true;
    if (loop) st.loop = loop;
    if (m.def) st.default = this.value(m.def, type, this.scope, m.def.p);
    if (m.label) st.label = m.label;
    if (m.comments.length) st.comment = m.comments;
    this.scope.set(m.name, { type, from: 'inst', kind: 'state', control: m.control });
    this.stateNames.set(m.name, { control: m.control, settable: true, type });
    this.controlNames.set(m.name, m.control);
    if (m.events.length) {
      st.on = {};
      for (const ev of m.events) {
        try {
          if (!EVENT_ONLY_STATE.has(ev.name)) this.fail(ev.p, `a state line raises change and end, not "${ev.name}"`, 'mkp.unknown-event');
          if (ev.name === 'end' && m.control !== 'slider' && m.control !== 'steps') this.fail(ev.p, 'only a slider or steps reaches an end');
          // the actions are checked after the view's ids are known
          this.deferred.push(() => {
            st.on![ev.name] = [...(st.on![ev.name] ?? []), ...this.actions(ev, this.scope)];
          });
        } catch (e) {
          this.err(e);
        }
      }
    }
    return st;
  }

  private readonly deferred: (() => void)[] = [];

  private collectIds(n: NodeSyn): void {
    for (const a of n.args) {
      if (a.key === 'id' && a.value.v === 'expr' && a.value.e.k === 'id' && !a.value.src.startsWith('(')) {
        const id = a.value.e.name;
        const hidden = n.args.some((b) => !b.key && b.value.v === 'expr' && b.value.e.k === 'id' && b.value.e.name === 'hidden');
        if (this.staticIds.has(id)) this.err(new MkpError('mkp.duplicate-id', `the id "${id}" is used twice in this definition`, a.p, [...this.path]));
        this.staticIds.set(id, { hidden, overlay: n.head === 'overlay', p: a.p });
      }
    }
    for (const c of n.children) this.collectIds(c);
  }

  irExpr(c: Checked, src: string, p: Pos): IRExpr {
    const e: IRExpr = { expr: normalize(src), ast: c.ast, type: c.type, pos: pos(p) };
    if (isStatic(c.ast, this.scope)) e.static = true;
    return e;
  }

  // ------------------------------------------------------------------------------------------
  // Values for props, fields and defaults

  value(v: Val, type: Type, scope: Scope, p: Pos, defaultMode = false): IRVal {
    if (type.t === 'list' && type.of.t === 'named' && type.of.name === 'track') return this.tracks(v, scope, p);
    const t = resolve(type, this.env);
    switch (t.t) {
      case 'range': {
        if (v.v !== 'range') this.fail(p, `expected a range a..b, found ${v.src}`);
        const lo = this.x.coerce(this.x.check(v.lo, scope), T.num, p);
        const hi = this.x.coerce(this.x.check(v.hi, scope), T.num, p);
        return { range: [this.constOrExpr(lo, v.loSrc, p), this.constOrExpr(hi, v.hiSrc, p)] };
      }
      case 'duration':
        if (v.v !== 'dur') this.fail(p, `expected a duration such as 6s or 500ms, found ${v.src}`);
        return { ms: v.ms };
      case 'ref': {
        if (defaultMode) this.fail(p, 'a ref input has no default; the caller passes its state');
        if (v.v !== 'expr' || v.e.k !== 'id') this.fail(p, `a ref takes the name of the caller's state, found ${v.src}`);
        const st = this.stateNames.get(v.e.name) ?? this.refInScope(v.e.name, scope);
        if (!st) this.fail(p, `"${v.e.name}" is not state, a var or a ref here; a ref input needs settable state`, 'mkp.not-state');
        const numInt = resolve(t.of, this.env).t === 'num' && resolve(st.type, this.env).t === 'int';
        if (!numInt && (!fits(st.type, t.of, this.env) || !fits(t.of, st.type, this.env))) this.fail(p, `this ref is ${showType(t.of)}, but ${v.e.name} is ${showType(st.type)}`);
        return { ref: v.e.name };
      }
      case 'token': {
        if (v.v === 'expr' && v.e.k === 'id') {
          const w = v.e.name;
          if (w === 'none' || this.opts.tokenNames(t.kind).has(w) || (t.kind === 'size' && w === 'fill')) return { tok: w, kind: t.kind };
          const b = scope.get(w);
          if (b && resolve(b.type, this.env).t === 'token') return this.irExpr({ ast: { t: 'var', name: w, from: b.from === 'const' ? 'const' : b.from }, type: b.type }, w, p);
          this.fail(p, `"${w}" is not a ${t.kind} token${didYouMean(w, this.opts.tokenNames(t.kind))}`, 'mkp.unknown-token');
        }
        if (v.v !== 'expr') return this.fail(p, `style props take token names; found ${v.src}`, 'mkp.style-token');
        // a colour written out ("#ff0000") is never a token: themes and dark mode would not hold
        if (v.e.k === 'str' && !this.opts.tokenNames(t.kind).has(v.e.v) && v.e.v !== 'none') this.fail(p, `style props take token names, such as ${[...this.opts.tokenNames(t.kind)].slice(0, 4).join(', ')}; found ${v.src}`, 'mkp.style-token');
        // a computed style: an expression giving a token name (checked against the tokens at runtime)
        const c = this.x.check(v.e, scope, t);
        const ct = resolve(c.type, this.env);
        if (ct.t === 'token' || ct.t === 'text' || ct.t === 'choice') return this.irExpr({ ast: c.ast, type: t }, v.src, p);
        return this.fail(p, `style props take token names; found ${showType(c.type)}`, 'mkp.style-token');
      }
      case 'path': {
        // a field of the records the path reads, by name: title=city
        if (v.v !== 'expr') this.fail(p, `expected a field name, found ${v.src}`);
        const w = v.e.k === 'id' ? v.e.name : v.e.k === 'str' && !v.e.v.includes('\\val{') ? v.e.v : null;
        const of = resolve(t.of, this.env);
        if (w === '') return { lit: '' };
        if (w !== null && of.t === 'rec') return this.pathTo(w, t, p);
        const c = this.x.check(v.e, scope, t);
        if (!fits(c.type, t, this.env)) this.fail(p, `expected ${showType(t)}, found ${showType(c.type)}`, 'mkp.type');
        return this.irExpr(c, v.src, p);
      }
      case 'param':
        this.fail(p, `${showType(t)} is known only where the definition is used`, 'mkp.type');
        break;
      case 'expr': {
        if (v.v !== 'expr') this.fail(p, `expected an expression in ${t.vars.map((x) => x[0]).join(', ')}`);
        const sc = scope.child();
        for (const [n, vt] of t.vars) sc.set(n, { type: vt, from: 'local', kind: 'param' });
        let body = this.x.check(v.e, sc, t.ret);
        body = this.x.coerce(body, t.ret, p);
        const ast: A = { t: 'lam', params: t.vars.map((x) => x[0]), body: body.ast };
        return this.irExpr({ ast, type: t }, v.src, p);
      }
      case 'slot':
        return this.fail(p, 'a slot is filled by indented lines (or a container), not by an argument');
      case 'records':
        return this.fail(p, `${t.kind} records are written as indented "${t.kind} …" lines`);
      case 'text': {
        if (v.v !== 'expr') this.fail(p, `expected text, found ${v.src}`);
        let e: Ex = v.e;
        if (e.k === 'tex') e = { k: 'str', v: e.display ? `$$${e.v}$$` : `$${e.v}$`, p: e.p };
        if (e.k === 'str' && !e.v.includes('\\val{')) return { text: e.v };
        const c = this.x.coerce(this.x.check(e, scope, T.text), T.text, p);
        return this.constOrExpr(c, v.src, p);
      }
      case 'latex': {
        if (v.v !== 'expr') this.fail(p, `expected maths $…$, found ${v.src}`);
        if (v.e.k === 'tex' && !v.e.v.includes('\\val{')) return v.e.display ? { tex: v.e.v, display: true } : { tex: v.e.v };
        const c = this.x.check(v.e, scope, T.latex);
        if (resolve(c.type, this.env).t !== 'latex') this.fail(p, `expected maths ($…$ or a latex value), found ${showType(c.type)}`);
        return this.irExpr(c, v.src, p);
      }
      case 'choice': {
        if (v.v === 'expr' && v.e.k === 'id' && t.opts.includes(v.e.name) && !scope.get(v.e.name)) return { lit: v.e.name };
        if (v.v !== 'expr') this.fail(p, `expected one of ${t.opts.join(', ')}`);
        const c = this.x.check(v.e, scope, t);
        if (!fits(c.type, t, this.env)) this.fail(p, `expected one of ${t.opts.join(', ')}, found ${v.src}`, 'mkp.enum');
        return this.constOrExpr(c, v.src, p);
      }
      default: {
        if (v.v !== 'expr') this.fail(p, `expected ${showType(type)}, found ${v.src}`);
        let c = this.x.check(v.e, scope, type);
        c = this.x.coerce(c, type, p);
        if (t.t === 'num' || t.t === 'int') this.checkNumRange(c, t, p);
        return this.constOrExpr(c, v.src, p);
      }
    }
  }

  /**
   * Grid column tracks (GAPS 98): [auto, 1fr, 6ch], words or quoted, or a number n for n equal
   * shares, written or computed.
   */
  private tracks(v: Val, scope: Scope, p: Pos): IRVal {
    if (v.v !== 'expr') this.fail(p, 'cols takes a number of equal columns or tracks such as [auto, 1fr, 6ch]');
    const src = v.src.trim();
    if (src.startsWith('[') && src.endsWith(']')) {
      const words = src.slice(1, -1).split(',').map((w) => w.trim().replace(/^"(.*)"$/, '$1')).filter(Boolean);
      for (const w of words) if (!TRACK_RE.test(w)) this.fail(p, `"${w}" is not a column track: auto, fit, Nfr (a share), Nch (characters) or a size token (s, m, l)`, 'mkp.input-type');
      if (!words.length) this.fail(p, 'a grid needs at least one column', 'mkp.input-type');
      return { lit: words };
    }
    const c = this.x.check(v.e, scope, T.int);
    if (resolve(c.type, this.env).t !== 'int') this.fail(p, `cols takes a whole number or tracks such as [auto, 1fr]; found ${showType(c.type)}`, 'mkp.input-type');
    if (c.ast.t === 'num') {
      if (c.ast.v < 1) this.fail(p, 'a grid needs at least one column', 'mkp.input-range');
      return { lit: Array.from({ length: c.ast.v }, () => '1fr') };
    }
    const ast: A = { t: 'builtin', fn: 'map', args: [{ t: 'builtin', fn: 'range', args: [{ t: 'num', v: 1 }, c.ast] }, { t: 'lam', params: ['_c'], body: { t: 'str', v: '1fr' } }] };
    return this.irExpr({ ast, type: T.list(T.text) }, v.src, p);
  }

  /** A path literal: the field must exist in the records and hold what the path promises. */
  pathTo(field: string, t: Extract<Type, { t: 'path' }>, p: Pos): IRVal {
    // "" is no field: an optional path's default; the widget tests path != "" before reading it
    if (field === '') return { lit: '' };
    const of = resolve(t.of, this.env);
    if (of.t !== 'rec') this.fail(p, `a path reads records; ${showType(t.of)} is not one`, 'mkp.type');
    const f = of.fields.find(([n]) => n === field);
    if (!f) this.fail(p, `"${field}" isn't a field of the items (they have ${of.fields.map(([n]) => n).join(', ') || 'no fields'})${didYouMean(field, of.fields.map(([n]) => n))}`, 'mkp.unknown-field');
    if (!fits(f[1], t.to, this.env)) this.fail(p, `"${field}" holds ${showType(f[1])}, but this path needs ${showType(t.to)}${resolve(t.to, this.env).t === 'text' && ['int', 'num', 'bool'].includes(resolve(f[1], this.env).t) ? ' (quote the values in the YAML to make them text)' : ''}`, 'mkp.type');
    return { lit: field };
  }

  /** Binds a use's type parameters from the values it gives (6.26). */
  instantiateUse(sig: Sig, args: Arg[], scope: Scope, p: Pos): Sig {
    const params = sig.params!;
    const bound: Record<string, Type> = {};
    const env = this.prog.typeEnv(sig.pack);
    const free = sig.fields.slice();
    for (const a of args) {
      const name = a.key ?? (a.value.v === 'expr' && a.value.e.k === 'id' && sig.inputs.has(a.value.e.name) ? null : free.shift());
      if (!name) continue;
      if (a.key) free.splice(free.indexOf(a.key) >>> 0, free.includes(a.key) ? 1 : 0);
      const inp = sig.inputs.get(name);
      if (!inp || !hasParamNamed(inp.type, params) || resolve(inp.type, env).t === 'path' || a.value.v !== 'expr') continue;
      const c = this.x.check(a.value.e, scope);
      const e = unify(inp.type, c.type, params, bound, env);
      if (e) this.fail(a.p, e, 'mkp.type');
    }
    const missing = params.filter((x) => !bound[x]);
    if (missing.length) this.fail(p, `${sig.name} can't tell what ${missing.join(' and ')} ${missing.length > 1 ? 'are' : 'is'} here: give the inputs that hold ${missing.length > 1 ? 'them' : 'it'}`, 'mkp.type');
    return instantiate(sig, bound);
  }

  private refInScope(name: string, scope: Scope): { type: Type } | undefined {
    const b = scope.get(name);
    if (b && (b.kind === 'state' || b.kind === 'var' || b.kind === 'ref')) return { type: b.type };
    return undefined;
  }

  private checkNumRange(c: Checked, t: Extract<Type, { t: 'num' | 'int' }>, p: Pos): void {
    if (c.ast.t !== 'num' && !(c.ast.t === 'builtin' && c.ast.fn === 'neg' && c.ast.args[0].t === 'num')) return;
    const v = c.ast.t === 'num' ? c.ast.v : -(c.ast.args[0] as { v: number }).v;
    if (t.t === 'int' && !Number.isInteger(v)) this.fail(p, `expected a whole number, found ${v}`, 'mkp.input-type');
    if (t.lo !== undefined && (v < t.lo || v > t.hi!)) this.fail(p, `${v} is outside ${t.lo}..${t.hi}`, 'mkp.input-range');
  }

  /** Literal values stay literal; everything else is an expression. */
  private constOrExpr(c: Checked, src: string, p: Pos): IRVal {
    const a = c.ast;
    if (a.t === 'num' || a.t === 'bool' || a.t === 'str') return { lit: a.v };
    if (a.t === 'builtin' && a.fn === 'neg' && a.args[0].t === 'num') return { lit: -a.args[0].v };
    const folded = literalOf(a);
    if (folded !== undefined && (a.t === 'list' || a.t === 'rec') && !JSON.stringify(c.type).includes('"choice"')) return { lit: folded };
    return this.irExpr(c, src, p);
  }

  // ------------------------------------------------------------------------------------------
  // Nodes

  nodes(list: NodeSyn[], ctx: Ctx, scope: Scope, depth: number): IRNode[] {
    if (list.length > LIMITS.children) this.err(new MkpError('mkp.limit', `${list.length} children; an element may have at most ${LIMITS.children} as written`, list[LIMITS.children].p, [...this.path]));
    const out: IRNode[] = [];
    for (const n of list) {
      try {
        const r = this.node(n, ctx, scope, depth);
        if (r) out.push(r);
      } catch (e) {
        this.err(e);
      }
    }
    return out;
  }

  private node(n: NodeSyn, ctx: Ctx, scope: Scope, depth: number): IRNode | null {
    if (depth > LIMITS.nesting) this.fail(n.p, `nested ${depth} levels deep; at most ${LIMITS.nesting} under one definition`, 'mkp.limit');
    this.path.push(n.head);
    try {
      return this.node1(n, ctx, scope, depth);
    } finally {
      this.path.pop();
    }
  }

  private node1(n: NodeSyn, ctx: Ctx, scope: Scope, depth: number): IRNode | null {
    const head = n.head;
    switch (head) {
      case 'each':
        return this.each(n, ctx, scope, depth);
      case 'switch':
        return this.switch(n, ctx, scope, depth);
      case 'slot': {
        const a = n.args[0];
        if (!a || a.value.v !== 'expr' || n.args.length > 1) this.fail(n.p, 'slot places one slot value: slot body or slot pages[i].slot');
        const c = this.x.check(a.value.e, scope);
        if (resolve(c.type, this.env).t !== 'slot') this.fail(a.p, `slot needs a slot value; found ${showType(c.type)}`);
        this.elementCount++;
        return { node: 'slot', value: this.irExpr(c, a.value.src, a.p), pos: pos(n.p) };
      }
      case 'controls': {
        const names = n.args.map((a) => (a.value.v === 'expr' && a.value.e.k === 'id' ? a.value.e.name : this.fail(a.p, 'controls takes state names')));
        for (const nm of names) if (!this.controlNames.has(nm) || this.controlNames.get(nm) === 'drag') this.fail(n.p, `"${nm}" is not a control of ${this.entry.syn.name}`, 'mkp.unknown-control');
        return { node: 'controls', names, pos: pos(n.p) };
      }
      case 'arrow':
        return this.arrow(n, scope);
      case 'fill':
        this.fail(n.p, 'fill belongs directly under a widget, to fill one of its slots');
        break;
      case 'case':
      case 'else':
        this.fail(n.p, `${head} belongs under switch`);
    }
    // under a use or a record: prop lines and records first (6.8)
    if (ctx.kind === 'use' || ctx.kind === 'record') {
      const fields = ctx.kind === 'use' ? null : ctx.type;
      const isInput = ctx.kind === 'use'
        ? ctx.sig.inputs.has(head) && resolve(ctx.sig.inputs.get(head)!.type, this.env).t !== 'records'
        : fields!.fields.some((f) => f[0] === head && resolve(f[1], this.env).t !== 'records');
      if (isInput) return { node: '$prop', record: head, ...this.propLine(n, ctx, scope) } as IRNode;
      const rec = this.findRecord(head, ctx);
      if (rec) return this.record(n, rec, ctx.sig, scope, depth);
    }
    return this.element(n, scope, depth);
  }

  /** A prop line under a use or a record: `question "…"` sets question. */
  private propLine(n: NodeSyn, ctx: UseCtx | RecCtx, scope: Scope): { props: Record<string, IRVal> } {
    const name = n.head;
    const type = ctx.kind === 'use' ? ctx.sig.inputs.get(name)!.type : ctx.type.fields.find((f) => f[0] === name)![1];
    if (n.args.length !== 1 || n.args[0].key) this.fail(n.p, `a prop line sets one value: ${name} <value>`);
    if (n.children.length || n.events.length) this.fail(n.p, `the prop line "${name}" cannot have indented lines`);
    return { props: { [name]: this.value(n.args[0].value, type, scope, n.args[0].p) } };
  }

  private findRecord(kind: string, ctx: UseCtx | RecCtx): { input: string; type: Extract<Type, { t: 'records' }> } | undefined {
    if (ctx.kind === 'use') return ctx.sig.records.get(kind);
    for (const [fname, ft] of ctx.type.fields) {
      const r = resolve(ft, this.env);
      if (r.t === 'records' && r.kind === kind) return { input: fname, type: r };
    }
    return undefined;
  }

  private record(n: NodeSyn, rec: { input: string; type: Extract<Type, { t: 'records' }> }, sig: Sig, scope: Scope, depth: number): IRNode {
    const t = rec.type;
    const fieldTypes = new Map(t.fields);
    const order = t.fields.filter(([, ft]) => resolve(ft, this.env).t !== 'records').map(([n2]) => n2);
    const { props, meta } = this.fillArgs(n.args, fieldTypes, order, scope, `${t.kind} record`, new Set());
    // defaults and required fields
    for (const [f, ft] of t.fields) {
      if (props[f] !== undefined || resolve(ft, this.env).t === 'records') continue;
      const d = t.defaults?.[f];
      if (d !== undefined) {
        props[f] = this.staticValue(parseValueString(d, this.entry.file, n.p.line, n.p.col), ft, n.p);
        continue;
      }
      if (n.children.some((c) => c.head === f)) continue;
      this.fail(n.p, `the ${t.kind} record needs ${f} (${showType(ft)})`, 'mkp.missing-input');
    }
    for (const [f, v] of Object.entries(props)) if (v !== undefined) this.gfxCheck(t.kind, f);
    if (GFX_SHAPES.has(t.kind)) this.usesGfx.add(t.kind);
    const out: IRNode = { node: '$record', record: t.kind, input: rec.input, props, pos: pos(n.p) };
    if (Object.keys(meta).length) out.meta = meta;
    if (n.comments.length) (out.meta ??= {}).comment = n.comments;
    if (n.events.length) this.fail(n.events[0].p, `a ${t.kind} record has no events`);
    if (n.children.length) {
      if (t.slot) {
        // the record's slot: elements, plus prop lines and nested records of the record itself
        const own: NodeSyn[] = [];
        const els: NodeSyn[] = [];
        for (const c of n.children) (fieldTypes.has(c.head) || this.findRecord(c.head, { kind: 'record', type: t, sig }) ? own : els).push(c);
        const ownIr = this.nodes(own, { kind: 'record', type: t, sig }, scope, depth + 1);
        this.mergeOwn(out, ownIr);
        out.children = this.nodes(els, { kind: 'view' }, scope, depth + 1);
      } else {
        const ownIr = this.nodes(n.children, { kind: 'record', type: t, sig }, scope, depth + 1);
        this.mergeOwn(out, ownIr);
      }
    }
    return out;
  }

  /** Folds prop lines into props and keeps records (and built-ins among records) in order. */
  private mergeOwn(out: IRNode, items: IRNode[]): void {
    for (const it of items) {
      if (it.node === '$prop') Object.assign((out.props ??= {}), it.props);
      else (out.records ??= []).push(it);
    }
  }

  private gfxCheck(kind: string, field: string): void {
    void kind;
    void field;
  }

  private element(n: NodeSyn, scope: Scope, depth: number): IRNode {
    this.elementCount++;
    let sig = this.resolveDef(n.head, n.p);
    if (sig.params?.length) sig = this.instantiateUse(sig, n.args, scope, n.p);
    this.uses.add(sig.id);
    if (sig.kind === 'widget' || sig.kind === 'part' || sig.kind === 'extern') {
      // fine: definitions use widgets, parts and externs alike
    }
    const order = sig.fields.length ? sig.fields : [];
    const { props, meta } = this.fillArgs(n.args, new Map([...sig.inputs].map(([k, v]) => [k, v.type])), order, scope, sig.name, new Set(sig.slots));
    if (sig.name === 'canvas' && sig.pack === 'core') {
      const dims = props.dims as { lit?: number } | undefined;
      if (dims && dims.lit === 3) this.usesGfx.add('canvas dims=3');
    }
    for (const r of sig.requires) if (r === 'gfx@1') this.usesGfx.add(sig.name);
    const out: IRNode = { node: sig.name, def: sig.id, props, pos: pos(n.p) };
    if (Object.keys(meta).length) out.meta = meta;
    if (n.comments.length) (out.meta ??= {}).comment = n.comments;
    // children: prop lines, records, fills, elements into the first slot
    const own: NodeSyn[] = [];
    const els: NodeSyn[] = [];
    const fills: NodeSyn[] = [];
    for (const c of n.children) {
      if (c.head === 'fill') fills.push(c);
      else if ((sig.inputs.has(c.head) && resolve(sig.inputs.get(c.head)!.type, this.env).t !== 'records') || sig.records.has(c.head) || ((c.head === 'each' || c.head === 'switch') && this.recordsInside(c, sig))) own.push(c);
      else els.push(c);
    }
    const ownIr = this.nodes(own, { kind: 'use', sig }, scope, depth + 1);
    for (const it of ownIr) {
      if (it.node === '$prop') {
        for (const [k, v] of Object.entries(it.props ?? {})) {
          if (out.props![k] !== undefined) this.fail(n.p, `${k} is set twice`, 'mkp.duplicate-prop');
          out.props![k] = v;
        }
      } else (out.records ??= []).push(it);
    }
    if (els.length) {
      if (!sig.slots.length) {
        const c = els[0];
        this.fail(c.p, `${sig.name} has no input, record or slot named "${c.head}"${didYouMean(c.head, [...sig.inputs.keys(), ...sig.records.keys()])}`, 'mkp.unknown-prop');
      }
      out.children = this.nodes(els, { kind: 'view' }, scope, depth + 1);
    }
    for (const f of fills) {
      const a = f.args[0];
      const nm = a && a.value.v === 'expr' && a.value.e.k === 'id' ? a.value.e.name : this.fail(f.p, 'fill takes a slot name');
      if (!sig.slots.includes(nm)) this.fail(f.p, `${sig.name} has no slot "${nm}"${didYouMean(nm, sig.slots)}`, 'mkp.unknown-slot');
      if (nm === sig.slots[0]) this.fail(f.p, `${nm} is the first slot; its lines need no fill`);
      (out.fills ??= {})[nm] = this.nodes(f.children, { kind: 'view' }, scope, depth + 1);
    }
    // required inputs
    for (const [name, inp] of sig.inputs) {
      if (inp.hasDefault || out.props![name] !== undefined) continue;
      this.fail(n.p, `${sig.name} needs ${name} (${showType(inp.type)})`, 'mkp.missing-input');
    }
    // events
    if (n.events.length) {
      out.on = {};
      for (const ev of n.events) {
        try {
          if (!sig.outs.has(ev.name)) this.fail(ev.p, `${sig.name} raises no "${ev.name}" event${sig.outs.size ? `; it raises ${[...sig.outs.keys()].join(', ')}` : ''}`, 'mkp.unknown-event');
          const sc = scope.child();
          const payload = sig.outs.get(ev.name);
          if (payload) sc.set(ev.name, { type: payload, from: 'local', kind: 'payload' });
          const target = out.on;
          this.deferred.push(() => {
            // several lines for one event run in order
            target[ev.name] = [...(target[ev.name] ?? []), ...this.actions(ev, sc)];
          });
        } catch (e) {
          this.err(e);
        }
      }
    }
    return out;
  }

  private recordsInside(n: NodeSyn, sig: Sig): boolean {
    return n.children.some((c) => sig.records.has(c.head) || ((c.head === 'each' || c.head === 'switch' || c.head === 'case' || c.head === 'else') && this.recordsInside(c, sig)));
  }

  /** Finds the definition a head names (name or name@N or pack:name). */
  resolveDef(head: string, p: Pos): Sig {
    const m = /^(.+?)(?:@(\d+))?$/.exec(head)!;
    const name = m[1];
    const want = m[2] ? Number(m[2]) : undefined;
    const found = this.prog.lookupDefs(name, this.entry.pack);
    if (!found.length) {
      const all = [...this.prog.defs.values()].map((d) => d.syn.name);
      this.fail(p, `there is no widget or part "${name}"${didYouMean(name, all)}`, 'mkp.unknown-widget');
    }
    const packs = new Set(found.map((d) => d.pack));
    if (packs.size > 1 && !name.includes(':')) {
      const own = found.filter((d) => d.pack === this.entry.pack);
      if (!own.length) this.fail(p, `"${name}" is provided by several packs (${[...packs].join(', ')}); write pack:${name}`, 'mkp.ambiguous');
    }
    const lockedId = want === undefined ? this.opts.locked?.(name) : undefined;
    const pick = want !== undefined ? found.find((d) => d.syn.version === want) : (lockedId && found.find((d) => d.id === lockedId)) || found[0];
    if (!pick) this.fail(p, `there is no ${name}@${want}; versions: ${found.map((d) => d.syn.version).join(', ')}`, 'mkp.unknown-version');
    let sig = this.opts.sigs.get(pick.id);
    if (!sig) {
      sig = signatureOf(this.prog, pick);
      this.opts.sigs.set(pick.id, sig);
    }
    return sig;
  }

  /** Fills props from args by the rules of 6.8. */
  fillArgs(args: Arg[], inputs: Map<string, Type>, order: string[], scope: Scope, what: string, slots: Set<string>): { props: Record<string, IRVal>; meta: IRMeta } {
    const props: Record<string, IRVal> = {};
    const meta: IRMeta = {};
    const set = (k: string, v: IRVal, p: Pos): void => {
      if (props[k] !== undefined) this.fail(p, `${k} is set twice`, 'mkp.duplicate-prop');
      props[k] = v;
    };
    const positional: Arg[] = [];
    for (const a of args) {
      if (a.key) {
        if (META_KEYS.has(a.key) && !inputs.has(a.key)) {
          this.meta(a, meta, scope);
          continue;
        }
        const t = inputs.get(a.key);
        if (!t || slots.has(a.key)) this.fail(a.p, `${what} has no prop "${a.key}"${didYouMean(a.key, [...inputs.keys()])}`, 'mkp.unknown-prop');
        set(a.key, this.value(a.value, t, scope, a.p), a.p);
        continue;
      }
      const w = a.value.v === 'expr' && a.value.e.k === 'id' ? a.value.e.name : null;
      if (w) {
        const hits: { k: string; v: IRVal; why: string }[] = [];
        // 2. a boolean prop
        const bt = inputs.get(w);
        if (bt && resolve(bt, this.env).t === 'bool') hits.push({ k: w, v: { lit: true }, why: 'a flag' });
        // 3. an enum value of exactly one prop
        const enums = [...inputs].filter(([k, t]) => {
          const r = resolve(t, this.env);
          return r.t === 'choice' && r.opts.includes(w) && props[k] === undefined;
        });
        if (enums.length === 1) hits.push({ k: enums[0][0], v: { lit: w }, why: `a ${enums[0][0]} option` });
        else if (enums.length > 1) this.fail(a.p, `"${w}" is an option of ${enums.map((e) => e[0]).join(' and ')}; write ${enums[0][0]}=${w}`, 'mkp.ambiguous-arg');
        // 4. a token for a style prop
        const toks = [...inputs].filter(([k, t]) => {
          const r = resolve(t, this.env);
          return r.t === 'token' && props[k] === undefined && this.opts.tokenNames(r.kind).has(w);
        });
        if (toks.length === 1) hits.push({ k: toks[0][0], v: { tok: w, kind: (resolve(toks[0][1], this.env) as { kind: string }).kind }, why: 'a token' });
        else if (toks.length > 1) this.fail(a.p, `"${w}" is a token for ${toks.map((e) => e[0]).join(' and ')}; write ${toks[0][0]}=${w}`, 'mkp.ambiguous-arg');
        // meta flags
        if (META_FLAGS.has(w) && !inputs.has(w)) {
          if (hits.length) this.fail(a.p, `"${w}" is ambiguous here; use key=value`, 'mkp.ambiguous-arg');
          if (w === 'hidden') meta.hidden = true;
          else meta.grow = true;
          continue;
        }
        const inScope = !!scope.get(w);
        if (hits.length > 1 || (hits.length === 1 && inScope && hits[0].why !== 'a flag')) {
          this.fail(a.p, `"${w}" matches more than one rule (${hits.map((h) => h.why).join(', ')}${inScope ? ', a name in scope' : ''}); write key=value`, 'mkp.ambiguous-arg');
        }
        if (hits.length === 1) {
          set(hits[0].k, hits[0].v, a.p);
          continue;
        }
      }
      positional.push(a);
    }
    // 6. positional fields in order
    const free = order.filter((k) => props[k] === undefined && !slots.has(k));
    for (const a of positional) {
      const k = free.shift();
      if (!k) {
        const hint = order.length ? ` (its fields are ${order.join(' ')})` : ' (it takes no positional values)';
        this.fail(a.p, `unexpected value ${a.value.src} for ${what}${hint}`, 'mkp.extra-arg');
      }
      set(k, this.value(a.value, inputs.get(k)!, scope, a.p), a.p);
    }
    return { props, meta };
  }

  private meta(a: Arg, meta: IRMeta, scope: Scope): void {
    switch (a.key) {
      case 'id': {
        if (a.value.v === 'expr' && a.value.e.k === 'id' && !a.value.src.startsWith('(')) meta.id = a.value.e.name;
        else if (a.value.v === 'expr') {
          const c = this.x.coerce(this.x.check(a.value.e, scope), T.text, a.p);
          meta.id = this.irExpr(c, a.value.src, a.p);
        } else this.fail(a.p, 'id takes a name or (an expression)');
        break;
      }
      case 'if': {
        if (a.value.v !== 'expr') this.fail(a.p, 'if takes a boolean expression');
        const c = this.x.check(a.value.e, scope, T.bool);
        if (resolve(c.type, this.env).t !== 'bool') this.fail(a.p, `if needs a boolean; found ${showType(c.type)}`);
        meta.if = this.irExpr(c, a.value.src, a.p);
        break;
      }
      case 'basis':
        meta.basis = (this.value(a.value, { t: 'token', kind: 'size' }, scope, a.p) as { tok: string }).tok;
        break;
      case 'span':
        meta.span = this.value(a.value, { t: 'int', lo: 1, hi: 64 }, scope, a.p);
        break;
      case 'self': {
        // how this child sits across its container, overriding the container's align (GAPS 41)
        const v = this.value(a.value, SELF, scope, a.p);
        if (!('lit' in v)) this.fail(a.p, 'self takes start, center, end or stretch', 'mkp.enum');
        meta.self = v.lit as IRMeta['self'];
        break;
      }
      case 'keep':
        // scrolls the nearest scrolling container to show it while true (GAPS 150)
        meta.keep = this.value(a.value, T.bool, scope, a.p);
        break;
    }
  }

  private each(n: NodeSyn, ctx: Ctx, scope: Scope, depth: number): IRNode {
    const a = n.args;
    const v = a[0];
    const kw = a[1];
    const src = a[2];
    if (!v || v.value.v !== 'expr' || v.value.e.k !== 'id' || !kw || kw.value.v !== 'expr' || kw.value.e.k !== 'id' || kw.value.e.name !== 'in' || !src) {
      this.fail(n.p, 'expected "each x in list [key=expr]" or "each x in a..b"');
    }
    const name = v.value.e.name;
    this.shadow(name, v.p);
    let elem: Type;
    let inVal: IRVal;
    if (src.value.v === 'range') {
      const lo = this.x.coerce(this.x.check(src.value.lo, scope), T.num, src.p);
      const hi = this.x.coerce(this.x.check(src.value.hi, scope), T.num, src.p);
      elem = resolve(lo.type, this.env).t === 'int' ? T.int : T.num;
      inVal = { range: [this.constOrExpr(lo, src.value.loSrc, src.p), this.constOrExpr(hi, src.value.hiSrc, src.p)] };
    } else if (src.value.v === 'expr') {
      const c = this.x.check(src.value.e, scope);
      const r = resolve(c.type, this.env);
      if (r.t === 'records') elem = { t: 'rec', fields: r.slot ? [...r.fields, ['slot', T.slot]] : r.fields };
      else if (r.t !== 'list') this.fail(src.p, `each needs a list or a range; found ${showType(c.type)}`);
      else elem = r.of;
      inVal = this.irExpr(c, src.value.src, src.p);
    } else this.fail(src.p, 'each needs a list or a range');
    const sc = scope.child();
    sc.set(name, { type: elem!, from: 'local', kind: 'each' });
    const out: IRNode = { node: 'each', var: name, in: inVal!, pos: pos(n.p) };
    let keyed = src.value.v === 'range';
    for (const extra of a.slice(3)) {
      if (extra.key === 'key' && extra.value.v === 'expr') {
        out.key = this.irExpr(this.x.check(extra.value.e, sc), extra.value.src, extra.p);
        keyed = true;
      } else this.fail(extra.p, 'each takes only key=expr after its list');
    }
    if (!keyed) this.diags.warn('mkp.each-unkeyed', `each over a list without key= uses the index as identity, so items lose their state when the list changes; add key=… with a unique value of ${name}`, n.p, [...this.path]);
    if (n.events.length) this.fail(n.events[0].p, 'each has no events');
    const items = this.nodes(n.children, ctx, sc, depth + 1);
    this.placeChildren(out, items);
    return out;
  }

  private placeChildren(out: IRNode, items: IRNode[]): void {
    for (const it of items) {
      if (it.node === '$record' || ((it.node === 'each' || it.node === 'switch') && it.records)) (out.records ??= []).push(it);
      else if (it.node === '$prop') this.fail({ file: this.entry.file, line: it.pos?.[0] ?? 0, col: it.pos?.[1] ?? 0 }, 'a prop line cannot be repeated or chosen; use if(…) in its value');
      else (out.children ??= []).push(it);
    }
  }

  private switch(n: NodeSyn, ctx: Ctx, scope: Scope, depth: number): IRNode {
    const on = n.args.find((a) => a.key === 'on');
    if (!on || on.value.v !== 'expr' || n.args.length !== 1) this.fail(n.p, 'expected "switch on=expr"');
    const subj = this.x.check(on.value.e, scope);
    const out: IRNode = { node: 'switch', subject: this.irExpr(subj, on.value.src, on.p), cases: [], pos: pos(n.p) };
    const seen = new Set<string>();
    for (const c of n.children) {
      try {
        if (c.head === 'case') {
          if (c.args.length !== 1) this.fail(c.p, 'case takes one value');
          const v = this.value(c.args[0].value, subj.type, scope, c.args[0].p);
          const key = JSON.stringify(v);
          if (seen.has(key)) this.diags.warn('mkp.case-unreachable', 'this case repeats an earlier one and can never be chosen', c.p, [...this.path]);
          seen.add(key);
          const r = resolve(subj.type, this.env);
          if (r.t === 'int' && r.lo !== undefined && 'lit' in v && typeof v.lit === 'number' && (v.lit < r.lo || v.lit > r.hi!)) this.diags.warn('mkp.case-unreachable', `case ${v.lit} can't happen (${showType(subj.type)})`, c.p, [...this.path]);
          const holder: IRNode = { node: 'case' };
          this.placeChildren(holder, this.nodes(c.children, ctx, scope, depth + 1));
          out.cases!.push({ value: v, children: [...(holder.children ?? []), ...(holder.records ?? [])] });
          if (holder.records) out.records = [];
        } else if (c.head === 'else') {
          if (out.else) this.fail(c.p, 'switch has one else');
          const holder: IRNode = { node: 'else' };
          this.placeChildren(holder, this.nodes(c.children, ctx, scope, depth + 1));
          out.else = [...(holder.children ?? []), ...(holder.records ?? [])];
          if (holder.records) out.records = [];
        } else this.fail(c.p, `under switch, only case and else; found "${c.head}"`);
      } catch (e) {
        this.err(e);
      }
    }
    return out;
  }

  private arrow(n: NodeSyn, scope: Scope): IRNode {
    const out: IRNode = { node: 'arrow', pos: pos(n.p) };
    for (const a of n.args) {
      if (a.key === 'from' || a.key === 'to') {
        out[a.key] = this.idValue(a, scope);
      } else if (!a.key && a.value.v === 'expr' && a.value.e.k === 'id' && a.value.e.name === 'curve') out.curve = true;
      else if (!a.key && a.value.v === 'expr' && a.value.e.k !== 'id') out.label = this.value(a.value, T.text, scope, a.p);
      else if (a.key === 'label') out.label = this.value(a.value, T.text, scope, a.p);
      else if (a.key === 'via') out.via = this.value(a.value, T.list(T.text), scope, a.p);
      else if (a.key === 'route') out.route = this.value(a.value, { t: 'choice', opts: ['down', 'right'] }, scope, a.p);
      else if (a.key && ARROW_LOOK[a.key]) (out.look ??= {})[a.key] = this.value(a.value, ARROW_LOOK[a.key], scope, a.p);
      else if (a.key === 'if') {
        const meta: IRMeta = {};
        this.meta(a, meta, scope);
        out.meta = meta;
      } else this.fail(a.p, 'arrow takes from=id to=id, an optional "label", via=(ids), route=down|right, curve, tone=, line=, head=, tail=, dim=, bold=, layer= and opacity=', 'mkp.unknown-prop');
    }
    if (!out.from || !out.to) this.fail(n.p, 'arrow needs from=id and to=id');
    return out;
  }

  private idValue(a: Arg, scope: Scope): IRVal {
    if (a.value.v === 'expr' && a.value.e.k === 'id') return { lit: a.value.e.name };
    if (a.value.v !== 'expr') this.fail(a.p, 'an id is a name or (an expression)');
    const c = this.x.coerce(this.x.check(a.value.e, scope), T.text, a.p);
    return this.irExpr(c, a.value.src, a.p);
  }

  // ------------------------------------------------------------------------------------------
  // Events and actions

  runDeferred(): void {
    for (const f of this.deferred.splice(0)) {
      try {
        f();
      } catch (e) {
        this.err(e);
      }
    }
  }

  private actions(ev: EventSyn, scope: Scope): IRAction[] {
    const acts = ev.actions.flatMap((a) => this.action(a, scope));
    if (!ev.cond) return acts;
    if (ev.cond.v !== 'expr') this.fail(ev.p, 'if takes a boolean expression');
    const c = this.x.check(ev.cond.e, scope, T.bool);
    if (resolve(c.type, this.env).t !== 'bool') this.fail(ev.cond.p, `if needs a boolean; found ${showType(c.type)}`);
    return [{ a: 'when', cond: this.irExpr(c, ev.cond.src, ev.cond.p), actions: acts }];
  }

  private action(a: ActionSyn, scope: Scope): IRAction[] {
    try {
      const r = this.action1(a, scope);
      return Array.isArray(r) ? r : [r];
    } catch (e) {
      this.err(e);
      return [];
    }
  }

  private action1(a: ActionSyn, scope: Scope): IRAction | IRAction[] {
    const word = (x: Arg): string => (x.value.v === 'expr' && x.value.e.k === 'id' && !x.key ? x.value.e.name : this.fail(x.p, `${a.name} takes names here`));
    switch (a.name) {
      case 'set': {
        if (!a.args.length || a.args.some((x) => !x.key)) this.fail(a.p, 'set takes name=expr …');
        // several assignments become several actions, run in order
        return a.args.map((x) => this.setOne(x, scope));
      }
      case 'play':
      case 'pause': {
        if (a.args.length !== 1) this.fail(a.p, `${a.name} takes exactly one slider or steps name`, 'mkp.extra-arg');
        const nm = word(a.args[0] ?? this.fail(a.p, `${a.name} takes a slider or steps name`));
        const c = this.controlNames.get(nm);
        if (c !== 'slider' && c !== 'steps' && c !== 'clock') this.fail(a.p, `"${nm}" is not a slider, steps or clock of this definition`, 'mkp.not-playable');
        return { a: a.name, name: nm };
      }
      case 'reset': {
        const names = a.args.map(word);
        for (const nm of names) if (!this.stateNames.has(nm)) this.fail(a.p, `"${nm}" is not state here`, 'mkp.not-state');
        return { a: 'reset', names };
      }
      case 'reveal':
      case 'hide':
      case 'open':
      case 'close': {
        const x = a.args[0];
        if (!x || a.args.length > 1) this.fail(a.p, `${a.name} takes one id`);
        if (x.value.v === 'expr' && x.value.e.k === 'id' && !x.key) {
          const id = x.value.e.name;
          const info = this.staticIds.get(id);
          if (!info) this.fail(x.p, `there is no element with id=${id} in ${this.entry.syn.name}${didYouMean(id, this.staticIds.keys())}`, 'mkp.unknown-id');
          if ((a.name === 'open' || a.name === 'close') && !info.overlay) this.fail(x.p, `${id} is not an overlay`, 'mkp.not-overlay');
          if ((a.name === 'reveal' || a.name === 'hide') && !info.hidden && a.name === 'reveal') this.diags.warn('mkp.reveal-visible', `${id} is not hidden, so reveal does nothing until it is hidden`, x.p, [...this.path]);
          return { a: a.name, id };
        }
        const c = this.x.coerce(this.x.check((x.value as { e: Ex }).e, scope), T.text, x.p);
        return { a: a.name, id: this.irExpr(c, x.value.src, x.p) };
      }
      case 'emit':
      case 'send': {
        const nm = word(a.args[0] ?? this.fail(a.p, `${a.name} takes a name`));
        const decl = a.name === 'emit' ? this.outs.get(nm) : this.signals.get(nm);
        if (a.name === 'emit' && !this.outs.has(nm)) this.fail(a.p, `${this.entry.syn.name} declares no out "${nm}"`, 'mkp.unknown-out');
        if (a.name === 'send' && !decl) this.fail(a.p, `${this.entry.syn.name} declares no signal "${nm}"`, 'mkp.unknown-signal');
        const fields = decl ? (resolve(decl, this.env) as Extract<Type, { t: 'rec' }>).fields : [];
        const payload: [string, IRExpr][] = [];
        for (const x of a.args.slice(1)) {
          if (!x.key || x.value.v !== 'expr') this.fail(x.p, `${a.name} takes field=expr`);
          const f = fields.find((ff) => ff[0] === x.key);
          if (!f) this.fail(x.p, `${nm} has no field "${x.key}"`, 'mkp.unknown-field');
          const c = this.x.coerce(this.x.check(x.value.e, scope, f[1]), f[1], x.p);
          payload.push([x.key, this.irExpr(c, x.value.src, x.p)]);
        }
        for (const [f] of fields) if (!payload.some((p2) => p2[0] === f)) this.fail(a.p, `${a.name} ${nm} needs ${f}`, 'mkp.missing-field');
        return { a: a.name, name: nm, payload };
      }
    }
    return this.fail(a.p, `unknown action ${a.name}`);
  }

  private setOne(x: Arg, scope: Scope): IRAction {
    const st = this.stateNames.get(x.key!);
    if (!st) this.fail(x.p, `"${x.key}" is not state, a var or a ref input of ${this.entry.syn.name}`, 'mkp.not-state');
    if (x.value.v !== 'expr') this.fail(x.p, 'set takes an expression');
    const c = this.x.coerce(this.x.check(x.value.e, scope, st.type), st.type, x.p);
    const kind = this.scope.get(x.key!)?.kind;
    return { a: 'set', name: x.key!, target: kind === 'ref' ? 'ref' : kind === 'var' ? 'var' : 'state', value: this.irExpr(c, x.value.src, x.p) };
  }
}

const RESERVED = new Set(['none', 'true', 'false', 'pi', 'tau', 'inf', 'nan']);

function hasParamNamed(t: Type, params: string[]): boolean {
  if (hasParam(t)) return true;
  switch (t.t) {
    case 'named':
      return params.includes(t.name);
    case 'list':
    case 'dict':
    case 'ref':
      return hasParamNamed(t.of, params);
    case 'rec':
    case 'records':
      return t.fields.some(([, f]) => hasParamNamed(f, params));
    case 'path':
      return hasParamNamed(t.of, params) || hasParamNamed(t.to, params);
    default:
      return false;
  }
}

/** The value of a literal tree (numbers, booleans, strings, and lists and records of them). */
function literalOf(a: A): unknown {
  switch (a.t) {
    case 'num':
    case 'bool':
    case 'str':
      return a.v;
    case 'builtin':
      return a.fn === 'neg' && a.args[0].t === 'num' ? -a.args[0].v : undefined;
    case 'list': {
      const items = a.items.map(literalOf);
      return items.every((x) => x !== undefined) ? items : undefined;
    }
    case 'rec': {
      const o: Record<string, unknown> = {};
      for (const [k, x] of a.fields) {
        const v = literalOf(x);
        if (v === undefined) return undefined;
        o[k] = v;
      }
      return o;
    }
    default:
      return undefined;
  }
}

function rt0(t: Type, env: TypeEnv): string {
  return resolve(t, env).t;
}

export function pos(p: Pos): IRPos {
  return [p.line, p.col];
}

function cm(c: string[]): string[] | undefined {
  return c.length ? c : undefined;
}

export function clean<T extends object>(o: T): T {
  for (const k of Object.keys(o) as (keyof T)[]) if (o[k] === undefined) delete o[k];
  return o;
}

function normalize(src: string): string {
  return canonical(src);
}

/** An expression is static when it reads only inputs and constants (no state, no locals). */
function isStatic(a: A, scope: Scope): boolean {
  switch (a.t) {
    case 'var': {
      if (a.from === 'const') return true;
      const b = scope.get(a.name);
      return !!b && (b.kind === 'input' || b.kind === 'const');
    }
    case 'num':
    case 'bool':
    case 'str':
    case 'dict0':
    case 'fnref':
      return true;
    case 'lam':
      return false;
    default: {
      for (const v of Object.values(a)) {
        if (v && typeof v === 'object') {
          if (Array.isArray(v)) {
            for (const x of v) if (x && typeof x === 'object' && 't' in x && !isStatic(x as A, scope)) return false;
          } else if ('t' in v && !isStatic(v as A, scope)) return false;
        }
      }
      return true;
    }
  }
}
