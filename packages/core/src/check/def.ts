// Checking one definition (spec 6.3–6.14, 6.18, 6.19) and emitting its definition IR (13).

import { Diagnostics, MkpError, Pos, closest, didYouMean } from '../diag';
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
  // how round its turns are: m (12 px, the default), s (6 px) or none (square)
  corner: { t: 'choice', opts: ['none', 's', 'm'] },
};
const META_KEYS = new Set(['id', 'if', 'basis', 'span', 'self', 'keep']);
const META_FLAGS = new Set(['hidden', 'grow']);
/** Canvas shapes the pointer can point at, and the only events they raise (no payload). */
const POINTED_SHAPES = new Set(['circle', 'path']);
const SHAPE_EVENTS = ['enter', 'leave', 'click'];
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

/** A type parameter given two types that don't join. */
interface Clash {
  param: string;
  prev: Type;
  got: Type;
}

/** Binds type parameters by matching what a use gives against what its inputs declare. */
export function unify(want: Type, got: Type, params: string[], bound: Record<string, Type>, env: TypeEnv): string | null {
  const c = unifyWhy(want, got, params, bound, env);
  return c ? clashMessage(c) : null;
}

function clashMessage(c: Clash, where = ''): string {
  return `${c.param} stands for one type in every input that uses it, but it is ${showType(c.prev)} in one place and ${showType(c.got)} in another${where}. Give values of one type, e.g. all numbers or all text`;
}

function unifyWhy(want: Type, got: Type, params: string[], bound: Record<string, Type>, env: TypeEnv): Clash | null {
  if ((want.t === 'named' || want.t === 'param') && params.includes(want.name)) {
    const prev = bound[want.name];
    if (!prev) {
      bound[want.name] = got;
      return null;
    }
    const j = join(prev, got, env);
    if (!j) return { param: want.name, prev, got };
    bound[want.name] = j;
    return null;
  }
  const g = resolve(got, env);
  if ((want.t === 'list' || want.t === 'dict') && g.t === want.t) return unifyWhy(want.of, g.of, params, bound, env);
  if (want.t === 'rec' && g.t === 'rec') {
    for (const [n, t] of want.fields) {
      const f = g.fields.find(([m]) => m === n);
      if (f) {
        const e = unifyWhy(t, f[1], params, bound, env);
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
    if (!v.length) throw new Error(`${what} is an empty list, so the type of its items can't be worked out. Give at least one item, e.g. - name: First`);
    let t = yamlType(v[0], `${what}[0]`, false);
    for (let i = 1; i < v.length; i++) {
      const u = yamlType(v[i], `${what}[${i}]`, false);
      const j = join(t, u, () => undefined);
      if (!j) throw new Error(`${what}[${i}] is ${showType(u)}, but the items before it are ${showType(t)}; every item must have the same fields, of the same types. Give it the same fields as the others`);
      t = j;
    }
    return T.list(t);
  }
  if (v && typeof v === 'object') return { t: 'rec', fields: Object.entries(v).map(([k, x]) => [k, yamlType(x, `${what}.${k}`, false)] as [string, Type]) };
  throw new Error(`${what} has no value. Write one after its colon, or remove ${what}`);
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
  /** where each gfx@1 use is first written, for the requires-gfx message */
  private readonly gfxAt = new Map<string, Pos>();
  /** where each name was declared, and as what, for the duplicate message */
  private readonly declaredAt = new Map<string, { p: Pos; what: string }>();
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
      file: this.prog.stableFile(entry.pack, entry.file),
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

  /** The definition's name as its author wrote it: with @N in a pack, bare in a document. */
  private get label(): string {
    const s = this.entry.syn;
    return this.entry.pack === '$doc' ? s.name : `${s.name}@${s.version}`;
  }

  /** The element a line sits under, for messages (the definition itself at the top of the view). */
  private parentHead(up = 1): string {
    const h = this.path[this.path.length - 1 - up];
    return h === undefined || this.path.length - 1 - up === 0 ? this.label : `"${h}"`;
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
            if (!/^[a-z0-9-]+@\d+$/.test(m.cap)) {
              const base = m.cap.replace(/@.*$/, '').toLowerCase().replace(/[^a-z0-9-]/g, '') || 'gfx';
              this.fail(m.p, `requires names a capability with its version, written name@N; found "${m.cap}". Write requires ${base}@1`);
            }
            break;
          case 'budget':
            if (m.n > LIMITS.budgetMax) this.fail(m.p, `budget may be at most ${LIMITS.budgetMax.toLocaleString('en')} operations (the work one evaluation may do); found ${m.n.toLocaleString('en')}. Write budget ${LIMITS.budgetMax} or less, or make the widget do less work`, 'mkp.limit');
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
            if (m.name === 'error') this.fail(m.p, `the signal name "error" is reserved: every widget already sends an error signal to the host when it fails; found signal error. Rename it, e.g. signal problem ${showType(m.payload)}`, 'mkp.reserved');
            this.signals.set(m.name, m.payload);
            (ir.signals ??= []).push(clean({ name: m.name, payload: m.payload, about: m.about, comment: m.comments.length ? m.comments : undefined }));
            break;
        }
      } catch (e) {
        this.err(e);
      }
    }
    if (s.kind === 'extern') {
      for (const m of s.members) {
        if (m.m !== 'node' && m.m !== 'derived' && m.m !== 'state' && m.m !== 'var') continue;
        const found = m.m === 'node' ? `the view line "${m.node.head}"` : m.m === 'state' ? `the control ${m.name} = ${m.control}` : m.m === 'var' ? `var ${m.name}` : `the value ${m.name} = …`;
        this.err(new MkpError('mkp.extern-view', `an extern is drawn by its provider's own code, so it declares only inputs, outs, signals and requires, with no view, controls or values; found ${found}. Remove this line, or drop "extern" to write ${s.name} as a widget in MKP`, 'p' in m ? m.p : m.node.p));
      }
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
    if (ir.fields) {
      const fp = s.members.find((m) => m.m === 'fields')?.p ?? s.p;
      for (const f of ir.fields) {
        if (ir.inputs.some((i) => i.name === f)) continue;
        this.err(new MkpError('mkp.unknown-field', `fields lists "${f}", which is not an input of ${this.label}${didYouMean(f, ir.inputs.map((i) => i.name))}; fields names the inputs that values written without a name fill, in order. Declare it (in ${f} text = "") or remove it from fields`, fp, [...this.path]));
      }
    }
    // values in order
    const values: IRValue[] = [];
    for (const m of s.members) {
      try {
        switch (m.m) {
          case 'host': {
            this.checkType(m.type, m.p);
            const def = this.staticValue(m.def, m.type, m.p, m.name);
            this.scope.set(m.name, { type: m.type, from: 'inst', kind: 'host' });
            values.push(clean({ k: 'host', name: m.name, type: m.type, default: def, about: m.about, pos: pos(m.p), comment: cm(m.comments) }));
            break;
          }
          case 'var': {
            this.checkType(m.type, m.p);
            const def = this.value(m.def, m.type, this.scope, m.p, true, m.name);
            this.declare(m.name, m.p, 'a var');
            this.scope.set(m.name, { type: m.type, from: 'inst', kind: 'var' });
            this.stateNames.set(m.name, { settable: true, type: m.type });
            values.push(clean({ k: 'var', name: m.name, type: m.type, default: def, about: m.about, pos: pos(m.p), comment: cm(m.comments) }));
            break;
          }
          case 'state':
            values.push(this.state(m));
            break;
          case 'derived': {
            this.declare(m.name, m.p, 'a value');
            const c = this.x.check(m.e, this.scope);
            this.scope.set(m.name, { type: c.type, from: 'inst', kind: 'derived' });
            values.push(clean({ k: 'derived', name: m.name, value: this.irExpr(c, m.src, m.p), pos: pos(m.p), comment: cm(m.comments) }));
            break;
          }
          case 'fn': {
            // every fn says what it takes and gives, so a mistake is a compile error (GAPS 43)
            const untyped = m.params.filter((q) => !q.type).map((q) => q.name);
            if (untyped.length || !m.ret) {
              const fix = `fn ${m.name}(${m.params.map((q) => `${q.name}: ${q.type ? showType(q.type) : 'num'}`).join(', ')}): ${m.ret ? showType(m.ret) : 'num'} = …`;
              const ps = `${untyped.length > 1 ? 'parameters' : 'parameter'} ${untyped.join(', ')}`;
              const what = untyped.length && !m.ret ? `no type on its ${ps} or on its result` : untyped.length ? `no type on its ${ps}` : 'no result type';
              this.fail(m.p, `fn ${m.name} has ${what}; every fn says what it takes and what it gives. Write the types after colons, e.g. ${fix} (num is an example: use the real types)`, 'mkp.untyped');
            }
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
    if (this.elementCount > LIMITS.elements) this.err(new MkpError('mkp.limit', `${this.label} has ${this.elementCount} elements, more than the ${LIMITS.elements} one definition may have. Repeat a line with each (each r in 1..16 key=r) instead of writing every copy out, or move part of the view into a part of its own`, s.p, [...this.path]));
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
      this.err(new MkpError('mkp.no-fallback', `${this.label} draws with gfx@1 (${[...this.usesGfx].join(', ')}) but has no about text, which readers without gfx@1 see in its place. Add one in quotes after the name: ${this.label} "A map of heights."`, s.p, [...this.path]));
    }
    if (this.usesGfx.size && !(ir.requires ?? []).includes('gfx@1')) {
      const uses = [...this.usesGfx].map((u) => (this.gfxAt.has(u) ? `${u} (line ${this.gfxAt.get(u)!.line})` : u));
      this.err(new MkpError('mkp.requires-gfx', `${uses.join(', ')} ${uses.length > 1 ? 'draw' : 'draws'} with the gfx@1 capability, but ${this.label} doesn't declare it. Add the line requires gfx@1 under the ${this.label} line`, s.p, [...this.path]));
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
      if (e && reads(e.ast, false, new Set())) this.err(new MkpError('mkp.answer-leak', `project ${target} shows ${[...tainted].join(', ')}, which ${tainted.size > 1 ? 'hold' : 'holds'} the answer (an input marked answer), outside if(answers, …), so Markdown built without answers would still give it away. Wrap that part in if(answers, …, ""), e.g. project ${target} = prompt + if(answers, "Answer: " + …, "")`, { file: this.entry.file, line: e.pos?.[0] ?? this.entry.syn.p.line, col: e.pos?.[1] ?? 1 }, [...this.path]));
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
          if (!e) this.fail(m.p, `implements names ${nv}, but no loaded pack declares an interface by that name${didYouMean(nv, [...this.prog.ifaces.values()].map((x) => `${x.syn.name}@${x.syn.version}`))}; interfaces come from a host's pack. Check the name and version, load the pack that declares it, or remove implements ${nv}`, 'mkp.unknown-interface');
          const f = e.syn;
          const same = (a: Type, b: Type): boolean => sameType(a, b, this.env) || (fits(a, b, this.env) && fits(b, a, this.env));
          // what is missing, and the change that gives it
          const miss: [string, string][] = [];
          for (const x of f.inputs) {
            const i = ir.inputs.find((n) => n.name === x.name);
            if (!i) miss.push([`has no in ${x.name} ${showType(x.type)}`, `add in ${x.name} ${showType(x.type)}`]);
            else if (!same(i.type, x.type)) miss.push([`its in ${x.name} is ${showType(i.type)}, not ${showType(x.type)}`, `change it to in ${x.name} ${showType(x.type)}`]);
          }
          for (const x of f.hosts) {
            const h = (ir.values ?? []).find((v) => v.k === 'host' && v.name === x.name) as { type: Type } | undefined;
            if (!h) miss.push([`has no host ${x.name} ${showType(x.type)}`, `add host ${x.name} ${showType(x.type)} = …`]);
            else if (!same(h.type, x.type)) miss.push([`its host ${x.name} is ${showType(h.type)}, not ${showType(x.type)}`, `change it to host ${x.name} ${showType(x.type)}`]);
          }
          for (const x of f.signals) {
            const sg = ir.signals?.find((v) => v.name === x.name);
            const want = resolve(x.payload, this.env);
            const got = sg ? resolve(sg.payload, this.env) : undefined;
            if (!sg || !got || got.t !== 'rec' || want.t !== 'rec') miss.push([`has no signal ${x.name} ${showType(x.payload)}`, `add signal ${x.name} ${showType(x.payload)}, and send it from an event (@click send ${x.name} …)`]);
            else for (const [n, t] of want.fields) {
              const g = got.fields.find(([k]) => k === n);
              if (!g || !same(g[1], t)) miss.push([`its signal ${x.name} has no field ${n}: ${showType(t)}`, `add ${n}: ${showType(t)} to signal ${x.name}`]);
            }
          }
          for (const x of f.outs) if (!ir.outs?.some((o) => o.name === x.name)) miss.push([`has no out ${x.name}`, `add out ${x.name}`]);
          if (f.project && !ir.project?.md) miss.push(['has no project md', 'add project md = …']);
          if (miss.length) {
            const fix = miss.map((x) => x[1]).join('; ');
            this.fail(m.p, `${this.label} implements ${nv} but ${miss.map((x) => x[0]).join('; ')}, which the interface asks for. ${fix[0].toUpperCase()}${fix.slice(1)}; or remove implements ${nv}`, 'mkp.interface');
          }
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
    const cap = `${name[0].toUpperCase()}${name.slice(1)}`;
    if (GLOBALS[name]) {
      const what = name === 'width' ? "the reader's width (narrow, medium or wide)" : name === 'theme' ? "the reader's theme (light or dark)" : 'the answers switch (true when the Markdown includes the answers)';
      this.fail(p, `"${name}" is already ${what}, which every definition can read, so it can't be declared here too. Rename it, e.g. "${name === 'width' ? 'boxWidth' : name === 'theme' ? 'look' : 'given'}"`, 'mkp.shadow');
    }
    if (RESERVED.has(name)) this.fail(p, `"${name}" is a built-in value (as are ${[...RESERVED].filter((r) => r !== name).join(', ')}), so it can't be a name here. Rename it, e.g. "${name}Value"`, 'mkp.shadow');
    for (const kind of ['color']) {
      if (this.opts.tokenNames(kind).has(name)) this.fail(p, `"${name}" is a colour token, so it can't be a name here: tone=${name} or if(…, ${name}, …) could then mean either the colour or this. Rename it, e.g. "is${cap}" or "${name}2"`, 'mkp.shadow');
    }
    const owner = this.options.get(name);
    if (owner !== undefined && owner !== name) this.fail(p, `"${name}" is one of the options ${owner || 'a choice here'} can take, so it can't also be a name: ${owner || 'the choice'} == ${name} could then mean either. Rename it, e.g. "is${cap}"`, 'mkp.shadow');
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
          if (!this.prog.lookupType(x.name, this.entry.pack)) this.fail(p, `there is no type "${x.name}"${didYouMean(x.name, [...this.prog.types.values()].map((v) => v.name))}. Use a built-in type (num, int, text, bool, list(text), …) or declare it at the top level: type ${x.name} = {…}`, 'mkp.unknown-type');
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

  private declare(name: string, p: Pos, what = 'a value'): void {
    if (this.scope.has(name)) {
      const first = this.declaredAt.get(name);
      this.fail(p, `"${name}" is declared twice in ${this.label}${first ? `: first as ${first.what} on line ${first.p.line}, again here` : ''}. Rename one of them, e.g. "${name}2", or remove this line`, 'mkp.duplicate');
    }
    this.declaredAt.set(name, { p, what });
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
    this.declare(m.name, m.p, 'an input');
    const inp: IRInput = { name: m.name, type: m.type, pos: pos(m.p) };
    if (m.answer) inp.answer = true;
    if (m.about) inp.about = m.about;
    if (m.comments.length) inp.comment = m.comments;
    const emptyRecords = rt0(m.type, this.env) === 'records' && m.def?.v === 'expr' && m.def.e.k === 'list' && !m.def.e.items.length;
    if (m.def && !emptyRecords) inp.default = this.staticValue(m.def, m.type, m.p, m.name);
    this.ir.inputs.push(inp);
    const rt = resolve(m.type, this.env);
    this.scope.set(m.name, { type: this.scopeType(m.type), from: 'inst', kind: rt.t === 'ref' ? 'ref' : 'input' });
    if (rt.t === 'ref') this.stateNames.set(m.name, { settable: true, type: rt.of });
  }

  /** A default value: checked against the type with only constants in scope. */
  staticValue(v: Val, type: Type, p: Pos, name?: string): IRVal {
    return this.value(v, type, new Scope(), p, true, name);
  }

  private state(m: Extract<DefSyn['members'][number], { m: 'state' }>): IRState {
    this.declare(m.name, m.p, `a ${m.control}`);
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
      if (playArg.value.v !== 'dur') this.fail(playArg.p, `play takes a duration, how long ${m.name} takes to play through; found play=${playArg.value.src}. Write e.g. play=8s, or play=500ms/step for a pace per step`);
      play = playArg.value.ms;
      playPer = !!playArg.value.per;
    }
    const loopArg = take('loop');
    if (loopArg) {
      const w = loopArg.value.v === 'expr' && loopArg.value.e.k === 'id' ? loopArg.value.e.name : '';
      if (!['once', 'repeat', 'bounce'].includes(w)) this.fail(loopArg.p, `loop takes once, repeat or bounce; found loop=${loopArg.value.src}${didYouMean(loopArg.value.src, ['once', 'repeat', 'bounce'])}. Write e.g. loop=repeat to start again from the beginning, or loop=bounce to play back and forth`);
      loop = w as IRState['loop'];
    }
    switch (m.control) {
      case 'slider': {
        const r = positional.shift();
        if (!r || r.value.v !== 'range') this.fail(r?.p ?? m.p, `a slider needs its range first, written lo..hi; found ${r ? r.value.src : 'no range'}. Write e.g. ${m.name} = slider 0..10${m.label !== undefined ? ` "${m.label}"` : ''}`);
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
        if (!n) this.fail(m.p, `steps needs its number of steps first; found none. Write e.g. ${m.name} = steps 4${m.label !== undefined ? ` "${m.label}"` : ''}, or steps (len(items)) for one step per item`);
        args.n = this.value(n.value, T.int, this.scope, n.p);
        // none=true: it starts at no step (-1), and start over goes back there (GAPS 123)
        for (const k of ['none', 'track']) {
          const a = take(k);
          if (a) {
            const v = this.value(a.value, T.bool, this.scope, a.p);
            if (!('lit' in v)) this.fail(a.p, `${k} on steps must be written as true or false, since it is fixed when the widget is built; found ${k}=${a.value.src}. Write ${k}=true (${k === 'none' ? 'start at no step' : 'show a track'}) or ${k}=false`);
            args[k] = v;
          }
        }
        type = T.int;
        break;
      }
      case 'clock':
        // seconds since it last started, running while the widget is on screen (GAPS 169)
        type = T.num;
        if (play) this.fail(playArg?.p ?? m.p, `a clock counts seconds on its own, so it takes no play=; found play=${playArg?.value.src}. Remove play=…, and start or stop it from an event with play ${m.name} or pause ${m.name}`);
        break;
      case 'drag': {
        for (const k of ['x', 'y']) {
          const a = take(k);
          if (!a || a.value.v !== 'range') this.fail(a?.p ?? m.p, `drag needs a range for ${k}, written ${k}=lo..hi; found ${a ? `${k}=${a.value.src}` : `no ${k}=`}. Write e.g. ${m.name} = drag x=0..1 y=0..1`);
          args[k] = this.value(a.value, T.range, this.scope, a.p);
        }
        type = T.point;
        break;
      }
    }
    if (positional.length) {
      const src = positional[0].value.src;
      const fix: Record<string, string> = {
        slider: `Remove it (a slider takes one range), or give it by name, e.g. step=${src}`,
        steps: `Remove it (steps takes one count), or give it by name: none=true, track=true, play=…`,
        toggle: `Write it bare (${m.name} = toggle "label"), with = true before the label to start it on`,
        choice: `Write only its options, e.g. ${m.name} = choice(a|b) "label", with = a before the label to start on a`,
        clock: `Write it bare: ${m.name} = clock "label"`,
        drag: `Give its ranges by name: ${m.name} = drag x=0..1 y=0..1`,
      };
      this.fail(positional[0].p, `${m.control} takes ${m.control === 'slider' || m.control === 'steps' ? 'no more values' : 'no value'} here; found ${src}. ${fix[m.control][0].toUpperCase()}${fix[m.control].slice(1)}`);
    }
    const settings: Record<string, string[]> = { slider: ['step', 'play', 'loop'], steps: ['none', 'track', 'play', 'loop'], drag: ['x', 'y'], clock: ['loop'], toggle: ['play', 'loop'], choice: ['play', 'loop'] };
    for (const [k, a] of keyed) {
      const ok = settings[m.control] ?? [];
      this.fail(a.p, `${m.control} has no setting "${k}"${didYouMean(k, ok)}; found ${k}=${a.value.src}. ${ok.length ? `It takes ${ok.map((x) => `${x}=`).join(', ')}; remove ${k}=… or use one of those` : `Remove ${k}=…`}`, 'mkp.unknown-prop');
    }
    if (m.control === 'drag' && play) this.fail(playArg?.p ?? m.p, `a drag control is moved by the reader, so it can't play; found play=${playArg?.value.src}. Remove play=… from ${m.name}`);
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
          const ends = m.control === 'slider' || m.control === 'steps';
          if (!EVENT_ONLY_STATE.has(ev.name)) this.fail(ev.p, `a ${m.control} raises only @change${ends ? ' and @end' : ''}; found @${ev.name}. Write @change … to act when ${m.name} changes${ends ? ', or @end … when it reaches its end' : ''}`, 'mkp.unknown-event');
          if (ev.name === 'end' && !ends) this.fail(ev.p, `only a slider or steps reaches an end, so a ${m.control} has no @end; found @end under ${m.name}. Use @change instead, or make ${m.name} a slider or steps`);
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
        const prev = this.staticIds.get(id);
        if (prev) this.err(new MkpError('mkp.duplicate-id', `the id "${id}" is used twice in ${this.label} (first on line ${prev.p.line}); every id in a definition names one element. Rename this one, e.g. id=${id}2`, a.p, [...this.path]));
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

  /** What a value of this type can be, for an error that says what was wrong: a token's names, a
   *  choice's options, a number's range, or the type. */
  takes(type: Type): string {
    const t = resolve(type, this.env);
    if (t.t === 'token') return `a ${t.kind} token: ${['none', ...this.opts.tokenNames(t.kind), ...(t.kind === 'size' ? ['fill'] : [])].join(', ')}`;
    if (t.t === 'choice') return `one of ${t.opts.join(', ')}`;
    if (t.t === 'bool') return 'true or false';
    if ((t.t === 'int' || t.t === 'num') && t.lo !== undefined && t.hi !== undefined) return `${t.t === 'int' ? 'a whole number' : 'a number'} from ${t.lo} to ${t.hi}`;
    if (t.t === 'int') return 'a whole number (int)';
    if (t.t === 'num') return 'a number';
    if (t.t === 'range') return 'a range, written lo..hi';
    if (t.t === 'duration') return 'a duration such as 2s or 500ms';
    return showType(type);
  }

  /** A short value of this type, for the example in a fix. */
  private example(type: Type): string {
    const t = resolve(type, this.env);
    switch (t.t) {
      case 'token': {
        const names = [...this.opts.tokenNames(t.kind)];
        return t.kind === 'color' && names.includes('accent') ? 'accent' : (names[0] ?? 'none');
      }
      case 'choice':
        return t.opts[0];
      case 'bool':
        return 'true';
      case 'int':
        return String(t.lo ?? 1);
      case 'num':
        return String(t.lo ?? 1.5);
      case 'text':
        return '"…"';
      case 'latex':
        return '$x^2$';
      case 'range':
        return '0..1';
      case 'duration':
        return '2s';
      case 'list':
        return '[…]';
      default:
        return '…';
    }
  }

  value(v: Val, type: Type, scope: Scope, p: Pos, defaultMode = false, name?: string): IRVal {
    // "pad takes", or "this value takes" where nothing names it; eg() writes the fix as name=value
    const who = name ?? 'this value';
    const eg = (x: string): string => (name ? `${name}=${x}` : x);
    // what was written, with what kind of value it is when that is not plain from the text
    const found = v.v === 'range' ? `${v.src}, a range` : v.v === 'dur' ? `${v.src}, a duration` : v.src;
    if (type.t === 'list' && type.of.t === 'named' && type.of.name === 'track') return this.tracks(v, scope, p);
    const t = resolve(type, this.env);
    switch (t.t) {
      case 'range': {
        if (v.v !== 'range') this.fail(p, `${who} takes a range, written lo..hi; found ${found}. Write e.g. ${eg(v.v === 'expr' && v.e.k === 'num' ? `0..${v.src}` : '0..1')}`);
        const lo = this.x.coerce(this.x.check(v.lo, scope), T.num, p);
        const hi = this.x.coerce(this.x.check(v.hi, scope), T.num, p);
        return { range: [this.constOrExpr(lo, v.loSrc, p), this.constOrExpr(hi, v.hiSrc, p)] };
      }
      case 'duration':
        if (v.v !== 'dur') this.fail(p, `${who} takes a duration, written with its unit; found ${found}. Write e.g. ${eg(v.v === 'expr' && v.e.k === 'num' ? `${v.src}s` : '6s')} (or 500ms)`);
        return { ms: v.ms };
      case 'ref': {
        if (defaultMode) this.fail(p, `${who} is a ref input, so it can't have a default: each widget that uses this one passes its own var or control, which the ref then changes; found = ${v.src}. Remove = ${v.src}`);
        if (v.v !== 'expr' || v.e.k !== 'id') this.fail(p, `${who} is a ref, so it takes the name of a var or control of the widget using it, which it can then change; found ${found}. Declare one there and pass its name, e.g. var total ${showType(t.of)} = …, then ${eg('total')}`);
        const st = this.stateNames.get(v.e.name) ?? this.refInScope(v.e.name, scope);
        if (!st) {
          const b = scope.get(v.e.name);
          this.fail(p, `${who} is a ref and needs a var, control or ref input it can change, but "${v.e.name}" ${b ? `is ${b.kind === 'input' ? 'an input' : `a ${b.kind}`}, which can't be changed` : 'is not declared here'}${didYouMean(v.e.name, this.stateNames.keys())}. Declare it (var ${v.e.name} ${showType(t.of)} = …) or pass one that exists`, 'mkp.not-state');
        }
        const numInt = resolve(t.of, this.env).t === 'num' && resolve(st.type, this.env).t === 'int';
        if (!numInt && (!fits(st.type, t.of, this.env) || !fits(t.of, st.type, this.env))) this.fail(p, `${who} is a ref to ${showType(t.of)}, but ${v.e.name} is ${showType(st.type)}; a ref and what it changes have the same type. Pass a ${showType(t.of)} var or control, or make the input ref ${showType(st.type)}`);
        return { ref: v.e.name };
      }
      case 'token': {
        if (v.v === 'expr' && v.e.k === 'id') {
          const w = v.e.name;
          if (w === 'none' || this.opts.tokenNames(t.kind).has(w) || (t.kind === 'size' && w === 'fill')) return { tok: w, kind: t.kind };
          const b = scope.get(w);
          if (b && resolve(b.type, this.env).t === 'token') return this.irExpr({ ast: { t: 'var', name: w, from: b.from === 'const' ? 'const' : b.from }, type: b.type }, w, p);
          const near = closest(w, this.opts.tokenNames(t.kind));
          this.fail(p, `"${w}" is not a ${t.kind} token${near ? ` (did you mean "${near}"?)` : ''}; ${who} takes ${this.takes(t)}. Write ${near ? eg(near) : 'one of those names'}`, 'mkp.unknown-token');
        }
        if (v.v !== 'expr') return this.fail(p, `${who} takes ${this.takes(t)}; found ${found}. Write a token name, e.g. ${eg(this.example(t))}`, 'mkp.style-token');
        // a colour written out ("#ff0000") is never a token: themes and dark mode would not hold
        if (v.e.k === 'str' && !this.opts.tokenNames(t.kind).has(v.e.v) && v.e.v !== 'none') {
          this.fail(p, `${who} takes a ${t.kind} token by name${t.kind === 'color' ? ', never a written-out colour, so themes and dark mode can change it' : ''}; found ${v.src}. Write one of ${['none', ...this.opts.tokenNames(t.kind)].join(', ')}, e.g. ${eg(this.example(t))}`, 'mkp.style-token');
        }
        // a computed style: an expression giving a token name (checked against the tokens at runtime)
        const c = this.x.check(v.e, scope, t);
        const ct = resolve(c.type, this.env);
        if (ct.t === 'token' || ct.t === 'text' || ct.t === 'choice') return this.irExpr({ ast: c.ast, type: t }, v.src, p);
        return this.fail(p, `${who} takes ${this.takes(t)}; found ${v.src}, which gives ${showType(c.type)}. Write a token name, or an expression that gives one, e.g. ${eg(t.kind === 'color' ? '(if(done, ok, muted))' : this.example(t))}`, 'mkp.style-token');
      }
      case 'path': {
        // a field of the records the path reads, by name: title=city
        const of = resolve(t.of, this.env);
        const names = of.t === 'rec' ? of.fields.filter(([, ft]) => fits(ft, t.to, this.env)).map(([n]) => n) : [];
        const field = names[0] ?? (of.t === 'rec' ? of.fields[0]?.[0] : undefined) ?? 'city';
        if (v.v !== 'expr') this.fail(p, `${who} takes the name of a field of the items${names.length ? ` (${names.join(', ')})` : ''}; found ${found}. Write e.g. ${eg(field)}`);
        const w = v.e.k === 'id' ? v.e.name : v.e.k === 'str' && !v.e.v.includes('\\val{') ? v.e.v : null;
        if (w === '') return { lit: '' };
        if (w !== null && of.t === 'rec') return this.pathTo(w, t, p, this.env, name);
        const c = this.x.check(v.e, scope, t);
        if (!fits(c.type, t, this.env)) this.fail(p, `${who} takes the name of a field of the items holding ${showType(t.to)}${names.length ? ` (${names.join(', ')})` : ''}; found ${v.src}, which gives ${showType(c.type)}. Write a field name, e.g. ${eg(field)}`, 'mkp.type');
        return this.irExpr(c, v.src, p);
      }
      case 'param':
        if (defaultMode) this.fail(p, `${who} has type ${showType(t)}, a type parameter that each use of ${this.label} fixes, so a default can't be checked here; found = ${v.src}. Remove the default and pass ${who} where ${this.label} is used`, 'mkp.type');
        this.fail(p, `${who} has type ${showType(t)}, a type parameter that each use of ${this.label} fixes, so ${v.src} can't be checked against it here. Pass the value where ${this.label} is used instead`, 'mkp.type');
        break;
      case 'expr': {
        const vars = t.vars.map((x) => x[0]);
        if (v.v !== 'expr') {
          const r = resolve(t.ret, this.env).t;
          const sample = r === 'bool' ? `(${vars[0]} > 1)` : r === 'num' || r === 'int' ? `(${vars[0]} + 1)` : '(…)';
          this.fail(p, `${who} takes an expression in ${vars.join(', ')}, worked out again for each ${vars.join(', ')}; found ${found}. Write one in brackets, e.g. ${eg(vars.length ? sample : '(…)')}`);
        }
        const sc = scope.child();
        for (const [n, vt] of t.vars) sc.set(n, { type: vt, from: 'local', kind: 'param' });
        let body = this.x.check(v.e, sc, t.ret);
        body = this.x.coerce(body, t.ret, p);
        const ast: A = { t: 'lam', params: t.vars.map((x) => x[0]), body: body.ast };
        return this.irExpr({ ast, type: t }, v.src, p);
      }
      case 'slot':
        if (defaultMode) return this.fail(p, `${who} is a slot, filled by the lines indented under each use of the widget, so it can't have a default; found = ${v.src}. Remove the default: in ${who} slot`);
        return this.fail(p, `${who} is a slot, filled by the lines indented under the widget, not by a value; found ${eg(v.src)}. Remove it and write the content on its own lines under the widget`);
      case 'records': {
        const fields = t.fields.filter(([, ft]) => resolve(ft, this.env).t !== 'records').slice(0, 2).map(([f]) => `${f}=…`).join(' ');
        return this.fail(p, `${who} is a list of ${t.kind} records, written as indented "${t.kind} …" lines under the widget, not as a value; found ${eg(v.src)}. Write one line per record instead, e.g. ${t.kind} ${fields}`);
      }
      case 'text': {
        if (v.v !== 'expr') this.fail(p, `${who} takes text; found ${found}. Write it in quotes, e.g. ${eg('"…"')}`);
        let e: Ex = v.e;
        if (e.k === 'tex') e = { k: 'str', v: e.display ? `$$${e.v}$$` : `$${e.v}$`, p: e.p };
        if (e.k === 'str' && !e.v.includes('\\val{')) return { text: e.v };
        const c = this.x.coerce(this.x.check(e, scope, T.text), T.text, p);
        return this.constOrExpr(c, v.src, p);
      }
      case 'latex': {
        if (v.v !== 'expr') this.fail(p, `${who} takes maths written in $…$; found ${found}. Write e.g. ${eg('$x^2$')}`);
        if (v.e.k === 'tex' && !v.e.v.includes('\\val{')) return v.e.display ? { tex: v.e.v, display: true } : { tex: v.e.v };
        const c = this.x.check(v.e, scope, T.latex);
        if (resolve(c.type, this.env).t !== 'latex') this.fail(p, `${who} takes maths ($…$, or an expression that gives latex); found ${v.src}, which gives ${showType(c.type)}. Write it in $…$, with \\val{…} for a live value, e.g. ${eg('$\\val{n}$')}`);
        return this.irExpr(c, v.src, p);
      }
      case 'choice': {
        if (v.v === 'expr' && v.e.k === 'id' && t.opts.includes(v.e.name) && !scope.get(v.e.name)) return { lit: v.e.name };
        if (v.v !== 'expr') this.fail(p, `${who} takes one of ${t.opts.join(', ')}; found ${found}. Write one of those words, e.g. ${eg(t.opts[0])}`, 'mkp.enum');
        // a word that is neither an option nor a name here: say what the options are
        if (v.e.k === 'id' && !scope.get(v.e.name) && !this.prog.constCandidates(v.e.name, this.entry.pack).length) {
          const near = closest(v.e.name, t.opts);
          this.fail(p, `${who} takes one of ${t.opts.join(', ')}; found ${v.e.name}${near ? ` (did you mean "${near}"?)` : ''}. Write ${near ? eg(near) : `one of those words, e.g. ${eg(t.opts[0])}`}`, 'mkp.enum');
        }
        const c = this.x.check(v.e, scope, t);
        if (!fits(c.type, t, this.env)) this.fail(p, `${who} takes one of ${t.opts.join(', ')}; found ${v.src}, which gives ${showType(c.type)}. Write one of those words, e.g. ${eg(t.opts[0])}`, 'mkp.enum');
        return this.constOrExpr(c, v.src, p);
      }
      default: {
        if (v.v !== 'expr') this.fail(p, `${who} takes ${this.takes(type)}; found ${found}. Write ${t.t === 'int' || t.t === 'num' || t.t === 'bool' ? `one value, e.g. ${eg(this.example(t))}` : `a value of type ${showType(type)}`}`);
        let c = this.x.check(v.e, scope, type);
        c = this.x.coerce(c, type, p);
        if (t.t === 'num' || t.t === 'int') this.checkNumRange(c, t, p, who, name);
        return this.constOrExpr(c, v.src, p);
      }
    }
  }

  /**
   * Grid column tracks (GAPS 98): [auto, 1fr, 6ch], words or quoted, or a number n for n equal
   * shares, written or computed.
   */
  private tracks(v: Val, scope: Scope, p: Pos): IRVal {
    if (v.v !== 'expr') this.fail(p, `cols takes a number of equal columns (cols=3) or a list of column tracks (cols=[auto, 1fr, 6ch]); found ${v.src}. Write one of those`);
    const src = v.src.trim();
    if (src.startsWith('[') && src.endsWith(']')) {
      const words = src.slice(1, -1).split(',').map((w) => w.trim().replace(/^"(.*)"$/, '$1')).filter(Boolean);
      for (const w of words) if (!TRACK_RE.test(w)) this.fail(p, `"${w}" is not a column track; a track is auto (as wide as its content), fit, Nfr (a share of the free space, e.g. 1fr), Nch (N characters wide, e.g. 6ch) or a size token (xs, s, m, l, xl); found cols=${src}. Write e.g. cols=[auto, 1fr]`, 'mkp.input-type');
      if (!words.length) this.fail(p, `a grid needs at least one column; found cols=${src}. Write e.g. cols=[1fr] or cols=1`, 'mkp.input-type');
      return { lit: words };
    }
    const c = this.x.check(v.e, scope);
    const ct = resolve(c.type, this.env);
    // tracks worked out: a list of track words (checked as they are drawn)
    if (ct.t === 'list' && resolve(ct.of, this.env).t === 'text') return this.irExpr(c, v.src, p);
    if (ct.t !== 'int') this.fail(p, `cols takes a whole number of equal columns or a list of tracks such as [auto, 1fr]; found ${src}, which gives ${showType(c.type)}. Write e.g. cols=2`, 'mkp.input-type');
    if (c.ast.t === 'num') {
      if (c.ast.v < 1) this.fail(p, `a grid needs at least one column; found cols=${src}. Write cols=1 or more`, 'mkp.input-range');
      return { lit: Array.from({ length: c.ast.v }, () => '1fr') };
    }
    const ast: A = { t: 'builtin', fn: 'map', args: [{ t: 'builtin', fn: 'range', args: [{ t: 'num', v: 1 }, c.ast] }, { t: 'lam', params: ['_c'], body: { t: 'str', v: '1fr' } }] };
    return this.irExpr({ ast, type: T.list(T.text) }, v.src, p);
  }

  /** A path literal: the field must exist in the records and hold what the path promises. `env` is
   *  the types of the definition the path is an input of (a pack's own types, such as walk's entry). */
  pathTo(field: string, t: Extract<Type, { t: 'path' }>, p: Pos, env: TypeEnv = this.env, name?: string): IRVal {
    // "" is no field: an optional path's default; the widget tests path != "" before reading it
    if (field === '') return { lit: '' };
    const who = name ?? 'this path';
    const of = resolve(t.of, env);
    if (of.t !== 'rec') this.fail(p, `"${field}" names a field, but the items it reads are ${showType(t.of)}, not records with fields. Write the items as records with that field, e.g. {${field}: …}`, 'mkp.type');
    const all = of.fields.map(([n]) => n);
    const f = of.fields.find(([n]) => n === field);
    if (!f) {
      const near = closest(field, all);
      const to = name ? `${name}=` : '';
      this.fail(p, `"${field}" isn't a field of the items${near ? ` (did you mean "${near}"?)` : ''}; their fields are ${all.join(', ') || 'none'}. ${all.length ? `Write ${to}${near ?? all[0]}${near ? '' : ' or another of those'}, or add ${field} to the items` : `Give the items a ${field} field`}`, 'mkp.unknown-field');
    }
    if (!fits(f[1], t.to, env)) {
      const ok = of.fields.filter(([, ft]) => fits(ft, t.to, env)).map(([n]) => n);
      const quote = resolve(t.to, env).t === 'text' && ['int', 'num', 'bool'].includes(resolve(f[1], env).t);
      this.fail(p, `${who} needs a field holding ${showType(t.to)}, but "${field}" holds ${showType(f[1])}. ${quote ? `Quote its values to make them text (${field}: "3")` : `Give ${field} ${showType(t.to)} values`}${ok.length ? `, or name a field that holds ${showType(t.to)}: ${ok.join(', ')}` : ''}`, 'mkp.type');
    }
    return { lit: field };
  }

  /** Binds a use's type parameters from the values it gives (6.26). */
  instantiateUse(sig: Sig, args: Arg[], scope: Scope, p: Pos): Sig {
    const params = sig.params!;
    const bound: Record<string, Type> = {};
    const env = this.prog.typeEnv(sig.pack);
    const free = sig.fields.slice();
    // which input first fixed each type parameter, for a clash
    const by: Record<string, string> = {};
    for (const a of args) {
      const name = a.key ?? (a.value.v === 'expr' && a.value.e.k === 'id' && sig.inputs.has(a.value.e.name) ? null : free.shift());
      if (!name) continue;
      if (a.key) free.splice(free.indexOf(a.key) >>> 0, free.includes(a.key) ? 1 : 0);
      const inp = sig.inputs.get(name);
      if (!inp || !hasParamNamed(inp.type, params) || resolve(inp.type, env).t === 'path' || a.value.v !== 'expr') continue;
      const c = this.x.check(a.value.e, scope);
      const e = unifyWhy(inp.type, c.type, params, bound, env);
      if (e) this.fail(a.p, clashMessage(e, by[e.param] ? ` (${by[e.param]} gives ${showType(e.prev)}, ${name}=${a.value.src} gives ${showType(e.got)})` : ''), 'mkp.type');
      for (const x of params) if (bound[x] && !by[x]) by[x] = name;
    }
    const missing = params.filter((x) => !bound[x]);
    if (missing.length) {
      const holders = [...sig.inputs].filter(([, i]) => hasParamNamed(i.type, missing) && resolve(i.type, env).t !== 'path').map(([k, i]) => `${k} (${showType(i.type)})`);
      const what = missing.join(' and ');
      this.fail(p, `${sig.name} can't tell what type ${what} ${missing.length > 1 ? 'are' : 'is'} here: ${what} is read from the value of an input that uses it, and none is given. ${holders.length ? `Pass ${holders.join(' or ')}, e.g. ${holders[0].split(' ')[0]}=[{city: "Oslo"}] for a list of records` : `Pass the inputs of type ${what}`}`, 'mkp.type');
    }
    return instantiate(sig, bound);
  }

  private refInScope(name: string, scope: Scope): { type: Type } | undefined {
    const b = scope.get(name);
    if (b && (b.kind === 'state' || b.kind === 'var' || b.kind === 'ref')) return { type: b.type };
    return undefined;
  }

  private checkNumRange(c: Checked, t: Extract<Type, { t: 'num' | 'int' }>, p: Pos, who = 'this value', name?: string): void {
    if (c.ast.t !== 'num' && !(c.ast.t === 'builtin' && c.ast.fn === 'neg' && c.ast.args[0].t === 'num')) return;
    const v = c.ast.t === 'num' ? c.ast.v : -(c.ast.args[0] as { v: number }).v;
    const eg = (x: number): string => (name ? `${name}=${x}` : String(x));
    if (t.t === 'int' && !Number.isInteger(v)) this.fail(p, `${who} takes a whole number; found ${v}. Write e.g. ${eg(Math.round(v))}`, 'mkp.input-type');
    if (t.lo !== undefined && (v < t.lo || v > t.hi!)) this.fail(p, `${who} takes ${this.takes(t)}; found ${v}. Write a value in that range, e.g. ${eg(v < t.lo ? t.lo : t.hi!)}`, 'mkp.input-range');
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
    if (list.length > LIMITS.children) this.err(new MkpError('mkp.limit', `${this.parentHead(0)} has ${list.length} lines directly under it, more than the ${LIMITS.children} one element may hold (this is number ${LIMITS.children + 1}). Group them into nested rows or columns, or write one line and repeat it with each`, list[LIMITS.children].p, [...this.path]));
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
    if (depth > LIMITS.nesting) this.fail(n.p, `"${n.head}" here is nested ${depth} levels deep, past the ${LIMITS.nesting} levels one definition may nest. Use fewer containers inside containers (each, switch and case are not counted), or move the inner part into a part of its own`, 'mkp.limit');
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
        // the slot's name, then if= (and nothing else): slot body if=(open)
        const rest = n.args.slice(1);
        const cond = rest.length === 1 && rest[0].key === 'if' ? rest[0] : undefined;
        if (!a || a.key || a.value.v !== 'expr' || (rest.length && !cond)) {
          const slots = this.ir.inputs.filter((i) => resolve(i.type, this.env).t === 'slot').map((i) => i.name);
          this.fail(n.p, `slot places one slot input of ${this.label} where it stands, and may take if=; found ${n.args.length ? `slot ${n.args.map((x) => (x.key ? `${x.key}=` : '') + x.value.src).join(' ')}` : 'slot with no name'}. Write slot and the slot's name, e.g. slot ${slots[0] ?? 'body'}${slots.length ? '' : ' (declared as in body slot)'}, or slot ${slots[0] ?? 'body'} if=(open)`);
        }
        const c = this.x.check(a.value.e, scope);
        if (resolve(c.type, this.env).t !== 'slot') this.fail(a.p, `slot places a slot input, but ${a.value.src} is ${showType(c.type)}; found slot ${a.value.src}. ${resolve(c.type, this.env).t === 'text' ? `Show text with text ${a.value.src}, or declare` : 'Declare'} ${a.value.src} as a slot (in ${a.value.src} slot) and fill it with lines indented under the widget`);
        this.elementCount++;
        const slot: IRNode = { node: 'slot', value: this.irExpr(c, a.value.src, a.p), pos: pos(n.p) };
        if (cond) {
          const meta: IRMeta = {};
          this.meta(cond, meta, scope);
          slot.meta = meta;
        }
        return slot;
      }
      case 'controls': {
        const known = [...this.controlNames].filter(([, c]) => c !== 'drag').map(([k]) => k);
        const theirs = known.length ? `its controls are ${known.join(', ')}` : `it declares none (name = slider …, toggle, choice(…), steps … or clock)`;
        const names = n.args.map((a) => (a.value.v === 'expr' && a.value.e.k === 'id' ? a.value.e.name : this.fail(a.p, `controls takes the bare names of ${this.label}'s controls; found ${a.value.src}. Write e.g. controls ${known[0] ?? 'level'}`)));
        for (const nm of names) {
          if (this.controlNames.get(nm) === 'drag') this.fail(n.p, `"${nm}" is a drag control, moved on the canvas, so controls can't place it in the bar. Remove ${nm} from controls`, 'mkp.unknown-control');
          if (!this.controlNames.has(nm)) this.fail(n.p, `"${nm}" is not a control of ${this.label}${didYouMean(nm, known)}; ${theirs}. ${known.length ? `Write e.g. controls ${closest(nm, known) ?? known[0]}` : 'Declare a control first'}`, 'mkp.unknown-control');
        }
        return { node: 'controls', names, pos: pos(n.p) };
      }
      case 'arrow':
        return this.arrow(n, scope);
      case 'fill':
        this.fail(n.p, `fill must sit directly under the widget whose slot it fills; found it under ${this.parentHead()}. Move the fill line up so it is directly under the widget line, and put the each or other lines inside the fill`);
        break;
      case 'case':
      case 'else':
        this.fail(n.p, `${head} must sit directly under a switch on=… line; found it under ${this.parentHead()}. Put a switch above it, e.g. switch on=n, and indent ${head === 'case' ? 'case 3' : 'else'} under it`);
    }
    // under a use or a record: prop lines and records first (6.8)
    if (ctx.kind === 'use' || ctx.kind === 'record') {
      const fields = ctx.kind === 'use' ? null : ctx.type;
      const isInput = ctx.kind === 'use'
        ? ctx.sig.inputs.has(head) && resolve(ctx.sig.inputs.get(head)!.type, this.env).t !== 'records'
        : fields!.fields.some((f) => f[0] === head && resolve(f[1], this.env).t !== 'records');
      // pos is only for messages: a prop line is folded into its owner's props, never kept in the IR
      if (isInput) return { node: '$prop', record: head, ...this.propLine(n, ctx, scope), pos: pos(n.p) } as IRNode;
      const rec = this.findRecord(head, ctx);
      if (rec) return this.record(n, rec, ctx.sig, scope, depth);
    }
    return this.element(n, scope, depth);
  }

  /** A prop line under a use or a record: `question "…"` sets question. */
  private propLine(n: NodeSyn, ctx: UseCtx | RecCtx, scope: Scope): { props: Record<string, IRVal> } {
    const name = n.head;
    const type = ctx.kind === 'use' ? ctx.sig.inputs.get(name)!.type : ctx.type.fields.find((f) => f[0] === name)![1];
    if (n.args.length !== 1 || n.args[0].key) {
      const got = n.args.length ? `${name} ${n.args.map((a) => (a.key ? `${a.key}=${a.value.src}` : a.value.src)).join(' ')}` : `${name} with no value`;
      this.fail(n.p, `the prop line "${name}" sets one value, written ${name} <value>; found ${got}. Write one value, e.g. ${name} ${n.args[0] && !n.args[0].key ? n.args[0].value.src : this.example(type)}`);
    }
    if (n.children.length || n.events.length) {
      const first = n.children[0] ?? n.events[0];
      this.fail(first.p, `the prop line "${name}" sets a value and can't have lines indented under it; found ${n.children.length ? `"${n.children[0].head}"` : `@${n.events[0].name}`} under it. Move that line out from under ${name}`);
    }
    return { props: { [name]: this.value(n.args[0].value, type, scope, n.args[0].p, false, name) } };
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
      this.fail(n.p, `the ${t.kind} record needs ${f}, ${this.takes(ft)}; found ${t.kind} with no ${f}. Add it, e.g. ${t.kind} ${f}=${this.example(ft)}`, 'mkp.missing-input');
    }
    for (const [f, v] of Object.entries(props)) if (v !== undefined) this.gfxCheck(t.kind, f);
    if (GFX_SHAPES.has(t.kind)) this.gfx(t.kind, n.p);
    const out: IRNode = { node: '$record', record: t.kind, input: rec.input, props, pos: pos(n.p) };
    if (Object.keys(meta).length) out.meta = meta;
    if (n.comments.length) (out.meta ??= {}).comment = n.comments;
    if (n.events.length) {
      if (sig.name === 'canvas' && sig.pack === 'core' && POINTED_SHAPES.has(t.kind)) this.shapeEvents(n, t.kind, out, scope);
      else this.fail(n.events[0].p, `a ${t.kind} record is data for ${sig.name}, so it can't take events; found @${n.events[0].name}. Remove the @${n.events[0].name} line${sig.name === 'canvas' && sig.pack === 'core' ? ', or point at a circle or a path instead' : ''}`);
    }
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

  /**
   * A canvas circle's or path's own events: the pointer moving onto it or off it, and a press on it.
   * They carry nothing (no position, no pointer), so a shape tells its widget only which it is, by
   * the scope its lines run in. One that takes a press is a control: it needs a label to be named by.
   */
  private shapeEvents(n: NodeSyn, kind: string, out: IRNode, scope: Scope): void {
    out.on = {};
    const target = out.on;
    for (const ev of n.events) {
      try {
        if (!SHAPE_EVENTS.includes(ev.name))
          this.fail(ev.p, `a ${kind} raises no "${ev.name}" event${didYouMean(ev.name, SHAPE_EVENTS)}; it raises ${SHAPE_EVENTS.join(', ')}. Write @${closest(ev.name, SHAPE_EVENTS) ?? 'click'} …, or remove the @${ev.name} line`, 'mkp.unknown-event');
        const label = out.props?.label as { lit?: unknown; text?: unknown } | undefined;
        if (ev.name === 'click' && (!label || label.lit === '' || label.text === ''))
          this.fail(ev.p, `a ${kind} that takes @click is a control, so a screen reader needs its name; found no label=. Add one, e.g. ${kind} … label="Rent"`, 'mkp.missing-input');
        const sc = scope.child();
        this.deferred.push(() => {
          // several lines for one event run in order
          target[ev.name] = [...(target[ev.name] ?? []), ...this.actions(ev, sc)];
        });
      } catch (e) {
        this.err(e);
      }
    }
  }

  /** Folds prop lines into props and keeps records (and built-ins among records) in order. */
  private mergeOwn(out: IRNode, items: IRNode[]): void {
    for (const it of items) {
      if (it.node === '$prop') Object.assign((out.props ??= {}), it.props);
      else (out.records ??= []).push(it);
    }
  }

  private gfx(name: string, p: Pos): void {
    this.usesGfx.add(name);
    if (!this.gfxAt.has(name)) this.gfxAt.set(name, p);
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
      if (dims && dims.lit === 3) this.gfx('canvas dims=3', n.p);
    }
    for (const r of sig.requires) if (r === 'gfx@1') this.gfx(sig.name, n.p);
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
    const onLine = new Set(Object.keys(out.props!));
    for (const it of ownIr) {
      if (it.node === '$prop') {
        for (const [k, v] of Object.entries(it.props ?? {})) {
          const at = it.pos ? { file: this.entry.file, line: it.pos[0], col: it.pos[1] } : n.p;
          if (out.props![k] !== undefined) this.fail(at, `${k} is set twice on ${sig.name}: ${onLine.has(k) ? `on the ${sig.name} line` : 'by an earlier prop line'}, and again by the prop line here. Remove one of them`, 'mkp.duplicate-prop');
          out.props![k] = v;
        }
        delete it.pos;
      } else (out.records ??= []).push(it);
    }
    if (els.length) {
      if (!sig.slots.length) {
        const c = els[0];
        const own2 = [...sig.inputs.keys(), ...sig.records.keys()];
        this.fail(c.p, `${sig.name} has no slot, so lines can't be indented under it, and "${c.head}" is not one of its inputs or records${didYouMean(c.head, own2)}; found "${c.head}" under ${sig.name}. Remove the line or move it out from under ${sig.name}${sig.pack === this.entry.pack ? `, or give ${sig.name} a slot (in body slot) to hold it` : ''}`, 'mkp.unknown-prop');
      }
      out.children = this.nodes(els, { kind: 'view' }, scope, depth + 1);
    }
    for (const f of fills) {
      const a = f.args[0];
      const slotList = sig.slots.length ? `its slots are ${sig.slots.join(', ')}` : 'it has no slots';
      const nm = a && a.value.v === 'expr' && a.value.e.k === 'id' ? a.value.e.name : this.fail(f.p, `fill takes the name of the ${sig.name} slot it fills; found ${a ? `fill ${a.value.src}` : 'fill with no name'}. ${sig.slots.length > 1 ? `Write e.g. fill ${sig.slots[1]}` : `${slotList[0].toUpperCase()}${slotList.slice(1)}`}`);
      if (!sig.slots.includes(nm)) this.fail(f.p, `${sig.name} has no slot "${nm}"${didYouMean(nm, sig.slots)}; ${slotList}. ${sig.slots.length > 1 ? `Write e.g. fill ${closest(nm, sig.slots.slice(1)) ?? sig.slots[1]}` : sig.slots.length ? `Its one slot takes the lines under ${sig.name} directly, with no fill` : 'Remove the fill'}`, 'mkp.unknown-slot');
      if (nm === sig.slots[0]) this.fail(f.p, `${nm} is the first slot of ${sig.name}, so its lines go straight under ${sig.name}, with no fill; found fill ${nm}. Remove the fill ${nm} line and indent its lines two spaces less`);
      (out.fills ??= {})[nm] = this.nodes(f.children, { kind: 'view' }, scope, depth + 1);
    }
    // required inputs
    for (const [name, inp] of sig.inputs) {
      if (inp.hasDefault || out.props![name] !== undefined) continue;
      this.fail(n.p, `${sig.name} needs ${name}: ${this.takes(inp.type)}. Add it, e.g. ${sig.name} ${name}=${this.example(inp.type)}`, 'mkp.missing-input');
    }
    // events
    if (n.events.length) {
      out.on = {};
      for (const ev of n.events) {
        try {
          if (!sig.outs.has(ev.name)) {
            const outs = [...sig.outs.keys()];
            this.fail(ev.p, sig.outs.size
              ? `${sig.name} raises no "${ev.name}" event${didYouMean(ev.name, outs)}; it raises ${outs.join(', ')}. Write @${closest(ev.name, outs) ?? outs[0]} …, or remove the @${ev.name} line`
              : `${sig.name} raises no events, so @${ev.name} can never run. Remove the @${ev.name} line, or put it on an element that raises ${ev.name}`, 'mkp.unknown-event');
          }
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
      this.fail(p, `there is no widget or part "${name}"${didYouMean(name, all)}. Check the spelling, define ${name} first (${name} "what it shows"), or, if a pack provides it, make that pack available (depends in a pack's manifest)`, 'mkp.unknown-widget');
    }
    const packs = new Set(found.map((d) => d.pack));
    if (packs.size > 1 && !name.includes(':')) {
      const own = found.filter((d) => d.pack === this.entry.pack);
      if (!own.length) this.fail(p, `"${name}" is provided by several packs (${[...packs].join(', ')}), so the bare name could mean either. Write it with its pack's name in front: ${[...packs].map((k) => `${k}:${name}`).join(' or ')}`, 'mkp.ambiguous');
    }
    const lockedId = want === undefined ? this.opts.locked?.(name) : undefined;
    const pick = want !== undefined ? found.find((d) => d.syn.version === want) : (lockedId && found.find((d) => d.id === lockedId)) || found[0];
    if (!pick) {
      const vs = found.map((d) => d.syn.version).sort((a, b) => a - b);
      this.fail(p, `there is no ${name}@${want}; the versions of ${name} are ${vs.join(', ')}. Write ${name}@${vs[vs.length - 1]}, or ${name} for the locked one`, 'mkp.unknown-version');
    }
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
      if (props[k] !== undefined) this.fail(p, `${k} is set twice on ${what}, and this is the second time. Remove one of them`, 'mkp.duplicate-prop');
      props[k] = v;
    };
    // what each bare-word rule means, for an ambiguity
    const means = (h: { k: string; why: string }): string => (h.why === 'a flag' ? `the flag ${h.k}` : h.why === 'a token' ? `a token for ${h.k}` : `an option of ${h.k}`);
    const positional: Arg[] = [];
    for (const a of args) {
      if (a.key) {
        if (META_KEYS.has(a.key) && !inputs.has(a.key)) {
          this.meta(a, meta, scope);
          continue;
        }
        const t = inputs.get(a.key);
        if (t && slots.has(a.key)) this.fail(a.p, `${a.key} is a slot of ${what}, filled by the lines indented under it, not by ${a.key}=…; found ${a.key}=${a.value.src}. Remove it and write the content on its own lines under ${what}`, 'mkp.unknown-prop');
        if (!t) {
          const props2 = [...inputs.keys()].filter((k) => !slots.has(k));
          const list = props2.length > 20 ? `${props2.slice(0, 20).join(', ')}, …` : props2.join(', ');
          this.fail(a.p, `${what} has no prop "${a.key}"${didYouMean(a.key, props2)}; found ${a.key}=${a.value.src}. ${props2.length ? `Its props are ${list}; remove ${a.key}=… or use one of those` : `It takes no props; remove ${a.key}=…`}`, 'mkp.unknown-prop');
        }
        set(a.key, this.value(a.value, t, scope, a.p, false, a.key), a.p);
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
        else if (enums.length > 1) this.fail(a.p, `"${w}" is an option of both ${enums.map((e) => e[0]).join(' and ')}, so the bare word could set either. Write it with its prop: ${enums.map((e) => `${e[0]}=${w}`).join(' or ')}`, 'mkp.ambiguous-arg');
        // 4. a token for a style prop
        const toks = [...inputs].filter(([k, t]) => {
          const r = resolve(t, this.env);
          return r.t === 'token' && props[k] === undefined && this.opts.tokenNames(r.kind).has(w);
        });
        if (toks.length === 1) hits.push({ k: toks[0][0], v: { tok: w, kind: (resolve(toks[0][1], this.env) as { kind: string }).kind }, why: 'a token' });
        else if (toks.length > 1) this.fail(a.p, `"${w}" is a token that fits both ${toks.map((e) => e[0]).join(' and ')}, so the bare word could set either. Write it with its prop: ${toks.map((e) => `${e[0]}=${w}`).join(' or ')}`, 'mkp.ambiguous-arg');
        // meta flags
        if (META_FLAGS.has(w) && !inputs.has(w)) {
          if (hits.length) this.fail(a.p, `"${w}" could be the ${w} flag (${w === 'hidden' ? 'the element starts hidden' : 'it takes the free space'}) or ${hits.map(means).join(' and ')}, so the bare word is ambiguous. Write ${hits.map((h) => `${h.k}=${w}`).join(' or ')} to set ${hits.length > 1 ? 'one of those' : hits[0].k}`, 'mkp.ambiguous-arg');
          if (w === 'hidden') meta.hidden = true;
          else meta.grow = true;
          continue;
        }
        const inScope = !!scope.get(w);
        if (hits.length > 1 || (hits.length === 1 && inScope && hits[0].why !== 'a flag')) {
          this.fail(a.p, `"${w}" could be ${[...hits.map(means), ...(inScope ? [`the value of ${w} declared here`] : [])].join(' or ')}, so the bare word is ambiguous. Write it with its key: ${hits.map((h) => `${h.k}=${w}`).join(' or ')}`, 'mkp.ambiguous-arg');
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
        const named = [...inputs.keys()].filter((x) => !slots.has(x) && props[x] === undefined);
        const fix = named.length ? `Name it, e.g. ${named[0]}=${a.value.src}` : 'Remove it';
        this.fail(a.p, order.length
          ? `${what} takes ${order.length} value${order.length > 1 ? 's' : ''} without a name (${order.join(' ')}, in that order), and they are all given; found another, ${a.value.src}. ${fix}, or remove it`
          : `${what} takes no values without a name, only key=value; found ${a.value.src}. ${fix}`, 'mkp.extra-arg');
      }
      set(k, this.value(a.value, inputs.get(k)!, scope, a.p, false, k), a.p);
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
        } else this.fail(a.p, `id takes a name (id=box) or an expression in brackets (id=("box" + k)); found id=${a.value.src}. Write e.g. id=box`);
        break;
      }
      case 'if': {
        if (a.value.v !== 'expr') this.fail(a.p, `if= takes a true-or-false expression in brackets; found if=${a.value.src}. Write e.g. if=(n > 1)`);
        const c = this.x.check(a.value.e, scope, T.bool);
        if (resolve(c.type, this.env).t !== 'bool') this.fail(a.p, `if= needs true or false; found ${a.value.src}, which gives ${showType(c.type)}. Write a comparison, e.g. if=(n > 1)`);
        meta.if = this.irExpr(c, a.value.src, a.p);
        break;
      }
      case 'basis':
        meta.basis = (this.value(a.value, { t: 'token', kind: 'size' }, scope, a.p, false, 'basis') as { tok: string }).tok;
        break;
      case 'span':
        meta.span = this.value(a.value, { t: 'int', lo: 1, hi: 64 }, scope, a.p, false, 'span');
        break;
      case 'self': {
        // how this child sits across its container, overriding the container's align (GAPS 41)
        const v = this.value(a.value, SELF, scope, a.p, false, 'self');
        if (!('lit' in v)) this.fail(a.p, `self is fixed when the widget is built, so it takes one of start, center, end or stretch written as a word, not worked out; found self=${a.value.src}. Write one word, e.g. self=start, or use two elements, each with its own if=(…)`, 'mkp.enum');
        meta.self = v.lit as IRMeta['self'];
        break;
      }
      case 'keep':
        // scrolls the nearest scrolling container to show it while true (GAPS 150)
        meta.keep = this.value(a.value, T.bool, scope, a.p, false, 'keep');
        break;
    }
  }

  private each(n: NodeSyn, ctx: Ctx, scope: Scope, depth: number): IRNode {
    const a = n.args;
    const v = a[0];
    const kw = a[1];
    const src = a[2];
    if (!v || v.value.v !== 'expr' || v.value.e.k !== 'id' || !kw || kw.value.v !== 'expr' || kw.value.e.k !== 'id' || kw.value.e.name !== 'in' || !src) {
      const got = a.map((x) => (x.key ? `${x.key}=${x.value.src}` : x.value.src)).join(' ');
      this.fail(n.p, `each is written each x in list key=… or each x in lo..hi, naming the loop variable before in; found each${got ? ` ${got}` : ''}. Write e.g. each name in names key=name`);
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
      else if (r.t !== 'list') this.fail(src.p, `each needs a list or a range to go through; found ${src.value.src}, which is ${showType(c.type)}. Loop over a list (each x in items key=x) or a range (each k in 0..(n - 1))`);
      else elem = r.of;
      inVal = this.irExpr(c, src.value.src, src.p);
    } else this.fail(src.p, `each needs a list or a range to go through; found ${src.value.src}, a duration. Loop over a list (each x in items key=x) or a range (each k in 0..(n - 1))`);
    const sc = scope.child();
    sc.set(name, { type: elem!, from: 'local', kind: 'each' });
    const out: IRNode = { node: 'each', var: name, in: inVal!, pos: pos(n.p) };
    let keyed = src.value.v === 'range';
    for (const extra of a.slice(3)) {
      if (extra.key === 'key' && extra.value.v === 'expr') {
        out.key = this.irExpr(this.x.check(extra.value.e, sc), extra.value.src, extra.p);
        keyed = true;
      } else this.fail(extra.p, `each takes only key=… after its list; found ${extra.key ? `${extra.key}=${extra.value.src}` : extra.value.src}. Remove it, or write key=(…) with a value unique to each item`);
    }
    if (!keyed) {
      const er = resolve(elem!, this.env);
      const key = er.t === 'rec' && er.fields.length ? `${name}.${er.fields[0][0]}` : name;
      this.diags.warn('mkp.each-unkeyed', `each over ${src.value.src} has no key=, so it tells items apart by position and they lose their state when the list changes. Add key= with a value unique to each ${name}, e.g. each ${name} in ${src.value.src} key=${key}`, n.p, [...this.path]);
    }
    if (n.events.length) this.fail(n.events[0].p, `each can't take events; found @${n.events[0].name} under each. Move the @${n.events[0].name} line under the element inside the each that should react`);
    // each, switch and case are not levels: they repeat or choose, and draw nothing of their own
    const items = this.nodes(n.children, ctx, sc, depth);
    this.placeChildren(out, items, 'each', n.p);
    return out;
  }

  private placeChildren(out: IRNode, items: IRNode[], under: string, at: Pos): void {
    for (const it of items) {
      if (it.node === '$record' || ((it.node === 'each' || it.node === 'switch') && it.records)) (out.records ??= []).push(it);
      else if (it.node === '$prop') {
        const k = Object.keys(it.props ?? {})[0] ?? String(it.record);
        const where = it.pos ? { file: this.entry.file, line: it.pos[0], col: it.pos[1] } : at;
        const why = under === 'each' ? 'which would set it once per item' : `which would set it only in that ${under}`;
        this.fail(where, `the prop line "${k}" sits under ${under}, ${why}, but a prop is set once. Move it out from under the ${under}, onto the widget, and choose its value there with if(…), e.g. ${k}=(if(…, a, b))`);
      } else (out.children ??= []).push(it);
    }
  }

  private switch(n: NodeSyn, ctx: Ctx, scope: Scope, depth: number): IRNode {
    const on = n.args.find((a) => a.key === 'on');
    if (!on || on.value.v !== 'expr' || n.args.length !== 1) {
      const got = n.args.map((x) => (x.key ? `${x.key}=${x.value.src}` : x.value.src)).join(' ');
      this.fail(n.p, `switch is written switch on=<value>, with nothing else on the line; found switch${got ? ` ${got}` : ''}. Write e.g. switch on=${n.args.find((x) => !x.key)?.value.src ?? 'n'}`);
    }
    const subj = this.x.check(on.value.e, scope);
    const out: IRNode = { node: 'switch', subject: this.irExpr(subj, on.value.src, on.p), cases: [], pos: pos(n.p) };
    const seen = new Map<string, number>();
    let elseLine = 0;
    for (const c of n.children) {
      try {
        if (c.head === 'case') {
          if (c.args.length !== 1) this.fail(c.p, `case takes one value; found case ${c.args.map((x) => x.value.src).join(' ') || 'with no value'}. Write one case line per value, e.g. case ${c.args[0]?.value.src ?? '1'}, then case ${c.args[1]?.value.src ?? '2'} on its own line`);
          const v = this.value(c.args[0].value, subj.type, scope, c.args[0].p);
          const key = JSON.stringify(v);
          if (seen.has(key)) this.diags.warn('mkp.case-unreachable', `case ${c.args[0].value.src} repeats the case on line ${seen.get(key)}, so it can never be chosen. Change its value or remove it`, c.p, [...this.path]);
          else seen.set(key, c.p.line);
          const r = resolve(subj.type, this.env);
          if (r.t === 'int' && r.lo !== undefined && 'lit' in v && typeof v.lit === 'number' && (v.lit < r.lo || v.lit > r.hi!)) this.diags.warn('mkp.case-unreachable', `case ${v.lit} can't happen: the switch's value ${on.value.src} is ${this.takes(subj.type)}. Change the case to a value in that range, or remove it`, c.p, [...this.path]);
          const holder: IRNode = { node: 'case' };
          this.placeChildren(holder, this.nodes(c.children, ctx, scope, depth), 'case', c.p);
          out.cases!.push({ value: v, children: [...(holder.children ?? []), ...(holder.records ?? [])] });
          if (holder.records) out.records = [];
        } else if (c.head === 'else') {
          if (out.else) this.fail(c.p, `switch may have one else, and this is a second (the first is on line ${elseLine}). Merge the two, or remove this one`);
          elseLine = c.p.line;
          const holder: IRNode = { node: 'else' };
          this.placeChildren(holder, this.nodes(c.children, ctx, scope, depth), 'else', c.p);
          out.else = [...(holder.children ?? []), ...(holder.records ?? [])];
          if (holder.records) out.records = [];
        } else this.fail(c.p, `under switch, only case and else lines may go; found "${c.head}". Put it under a case or else, or move it out from under the switch`);
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
      else if (a.key === 'label') out.label = this.value(a.value, T.text, scope, a.p, false, 'label');
      else if (a.key === 'via') out.via = this.value(a.value, T.list(T.text), scope, a.p, false, 'via');
      else if (a.key === 'route') out.route = this.value(a.value, { t: 'choice', opts: ['down', 'right'] }, scope, a.p, false, 'route');
      else if (a.key && ARROW_LOOK[a.key]) (out.look ??= {})[a.key] = this.value(a.value, ARROW_LOOK[a.key], scope, a.p, false, a.key);
      else if (a.key === 'if') {
        const meta: IRMeta = {};
        this.meta(a, meta, scope);
        out.meta = meta;
      } else {
        const keys = ['from', 'to', 'label', 'via', 'route', 'if', ...Object.keys(ARROW_LOOK)];
        const word = !a.key && a.value.v === 'expr' && a.value.e.k === 'id' ? a.value.e.name : undefined;
        // a bare look word (dashed, hollow): say which key takes it
        const owner = word ? Object.entries(ARROW_LOOK).find(([, t]) => t.t === 'choice' && t.opts.includes(word))?.[0] : undefined;
        const near = a.key ? (['colour', 'color'].includes(a.key) ? 'tone' : closest(a.key, keys)) : undefined;
        const fix = owner ? `Write ${owner}=${word}` : near ? `Write ${near}=${a.value.src}` : 'Remove it or use one of those';
        this.fail(a.p, `arrow has no ${a.key ? `prop "${a.key}"` : `setting "${a.value.src}"`}; found ${a.key ? `${a.key}=${a.value.src}` : a.value.src}. It takes from=id to=id, an optional "label", via=(ids), route=down|right, curve, tone=, line=, head=, tail=, dim=, bold=, layer=, opacity= and corner=. ${fix}`, 'mkp.unknown-prop');
      }
    }
    if (!out.from || !out.to) {
      const miss = [!out.from ? 'from=' : '', !out.to ? 'to=' : ''].filter(Boolean).join(' and ');
      this.fail(n.p, `arrow needs from= and to=, the ids of the two elements it joins; found no ${miss}. Add ${miss.replace(/=/g, '=<id>')}, e.g. arrow from=a to=b`);
    }
    return out;
  }

  private idValue(a: Arg, scope: Scope): IRVal {
    if (a.value.v === 'expr' && a.value.e.k === 'id') return { lit: a.value.e.name };
    if (a.value.v !== 'expr') this.fail(a.p, `${a.key ?? 'an id'}= takes an element's id: a name (${a.key}=box) or an expression in brackets (${a.key}=("box" + k)); found ${a.key}=${a.value.src}. Write e.g. ${a.key}=box`);
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
    if (ev.cond.v !== 'expr') this.fail(ev.cond.p, `if= on an event line takes a true-or-false expression in brackets; found if=${ev.cond.src}. Write e.g. if=(n > 1)`);
    const c = this.x.check(ev.cond.e, scope, T.bool);
    if (resolve(c.type, this.env).t !== 'bool') this.fail(ev.cond.p, `if= on an event line needs true or false; found ${ev.cond.src}, which gives ${showType(c.type)}. Write a comparison, e.g. if=(n > 1)`);
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
    const playable = [...this.controlNames].filter(([, c]) => c === 'slider' || c === 'steps' || c === 'clock').map(([k]) => k);
    const sample: Record<string, string | undefined> = { reset: [...this.stateNames.keys()][0], play: playable[0], pause: playable[0], emit: [...this.outs.keys()][0], send: [...this.signals.keys()][0] };
    const word = (x: Arg): string => (x.value.v === 'expr' && x.value.e.k === 'id' && !x.key ? x.value.e.name : this.fail(x.p, `${a.name} takes bare names here; found ${x.key ? `${x.key}=${x.value.src}` : x.value.src}. Write e.g. ${a.name} ${sample[a.name] ?? 'name'}`));
    switch (a.name) {
      case 'set': {
        if (!a.args.length || a.args.some((x) => !x.key)) {
          const bare = a.args.find((x) => !x.key);
          const nm = bare?.value.src ?? [...this.stateNames.keys()][0] ?? 'n';
          this.fail(a.p, `set takes name=value pairs; found set${a.args.length ? ` ${a.args.map((x) => (x.key ? `${x.key}=${x.value.src}` : x.value.src)).join(' ')}` : ' with nothing after it'}. Write e.g. set ${nm}=(${nm} + 1)`);
        }
        // several assignments become several actions, run in order
        return a.args.map((x) => this.setOne(x, scope));
      }
      case 'play':
      case 'pause': {
        const eg = `Write e.g. ${a.name} ${playable[0] ?? 'level'}${playable.length > 1 ? `, and ${a.name} ${playable[1]} as another action` : ''}`;
        if (a.args.length !== 1) this.fail(a.p, `${a.name} takes exactly one slider, steps or clock name; found ${a.args.length ? `${a.name} ${a.args.map((x) => x.value.src).join(' ')}` : 'none'}. ${eg}`, 'mkp.extra-arg');
        const nm = word(a.args[0] ?? this.fail(a.p, `${a.name} takes the name of a slider, steps or clock; found none. ${eg}`));
        const c = this.controlNames.get(nm);
        if (c !== 'slider' && c !== 'steps' && c !== 'clock') {
          const b = this.scope.get(nm);
          const is = c ? `a ${c}` : b ? (b.kind === 'input' ? 'an input' : `a ${b.kind}`) : 'not declared here';
          this.fail(a.p, `"${nm}" is ${is}, not a slider, steps or clock of ${this.label}, so it can't ${a.name}; ${playable.length ? `its playable controls are ${playable.join(', ')}. Write e.g. ${a.name} ${closest(nm, playable) ?? playable[0]}` : `it has none. Declare one, e.g. t = slider 0..1 play=4s "turn"`}`, 'mkp.not-playable');
        }
        return { a: a.name, name: nm };
      }
      case 'reset': {
        const names = a.args.map(word);
        for (const nm of names) {
          if (this.stateNames.has(nm)) continue;
          const can = [...this.stateNames.keys()];
          this.fail(a.p, `reset puts a control, var or ref input back to its start, and "${nm}" is none of these in ${this.label}${didYouMean(nm, can)}. ${can.length ? `Write e.g. reset ${closest(nm, can) ?? can[0]}` : 'Declare one first, e.g. var n int = 0'}`, 'mkp.not-state');
        }
        return { a: 'reset', names };
      }
      case 'reveal':
      case 'hide':
      case 'open':
      case 'close': {
        const x = a.args[0];
        if (!x || a.args.length > 1) {
          const ids = [...this.staticIds.keys()];
          this.fail(a.p, x
            ? `${a.name} takes one id; found ${a.name} ${a.args.map((y) => y.value.src).join(' ')}. Write one action per id, e.g. ${a.name} ${a.args[0].value.src} ${a.name} ${a.args[1].value.src}`
            : `${a.name} needs the id of the element to ${a.name}; found ${a.name} with nothing after it. Write ${a.name} <id>, e.g. ${a.name} ${ids[0] ?? 'help'} (each action takes its own id: reveal a hide b)`);
        }
        if (x.value.v === 'expr' && x.value.e.k === 'id' && !x.key) {
          const id = x.value.e.name;
          const info = this.staticIds.get(id);
          if (!info) {
            const ids = [...this.staticIds.keys()];
            this.fail(x.p, `there is no element with id=${id} in ${this.label}${didYouMean(id, ids)}; ${ids.length ? `its ids are ${ids.join(', ')}` : 'no element in it has an id'}. Add id=${id} to the element to ${a.name}, or name one that exists`, 'mkp.unknown-id');
          }
          if ((a.name === 'open' || a.name === 'close') && !info.overlay) this.fail(x.p, `${id} is not an overlay, so ${a.name} can't ${a.name} it; found ${a.name} ${id}. Use ${a.name === 'open' ? 'reveal' : 'hide'} ${id} for a plain element${a.name === 'open' ? ' (with hidden on it, so it starts hidden)' : ''}, or make ${id} an overlay`, 'mkp.not-overlay');
          if ((a.name === 'reveal' || a.name === 'hide') && !info.hidden && a.name === 'reveal') this.diags.warn('mkp.reveal-visible', `${id} is not hidden, so reveal ${id} does nothing. Add hidden to the element with id=${id} (line ${info.p.line}) so it starts hidden, or remove reveal ${id}`, x.p, [...this.path]);
          return { a: a.name, id };
        }
        const c = this.x.coerce(this.x.check((x.value as { e: Ex }).e, scope), T.text, x.p);
        return { a: a.name, id: this.irExpr(c, x.value.src, x.p) };
      }
      case 'emit':
      case 'send': {
        const isEmit = a.name === 'emit';
        const declared = [...(isEmit ? this.outs : this.signals).keys()];
        const kind = isEmit ? 'out' : 'signal';
        const nm = word(a.args[0] ?? this.fail(a.p, `${a.name} takes the name of ${isEmit ? 'an out (an event for the widget using this one)' : 'a signal (a message to the host)'} of ${this.label}; found ${a.name} with nothing after it. ${declared.length ? `Write e.g. ${a.name} ${declared[0]}` : `Declare one first, e.g. ${kind} done {score: int}`}`));
        const decl = isEmit ? this.outs.get(nm) : this.signals.get(nm);
        if ((isEmit && !this.outs.has(nm)) || (!isEmit && !decl)) {
          const theirs = declared.length ? `; its ${kind}s are ${declared.join(', ')}` : '';
          this.fail(a.p, `${this.label} declares no ${kind} "${nm}"${didYouMean(nm, declared)}${theirs}. Declare it under the ${this.label} line (${kind} ${nm}${isEmit ? '' : ' {field: type}'})${declared.length ? ` or ${a.name} one that exists` : ''}`, isEmit ? 'mkp.unknown-out' : 'mkp.unknown-signal');
        }
        const fields = decl ? (resolve(decl, this.env) as Extract<Type, { t: 'rec' }>).fields : [];
        const payload: [string, IRExpr][] = [];
        for (const x of a.args.slice(1)) {
          if (!x.key || x.value.v !== 'expr') this.fail(x.p, `${a.name} ${nm} takes its fields as field=value; found ${x.key ? `${x.key}=${x.value.src}` : x.value.src}. Write e.g. ${x.key ?? x.value.src}=${x.key ? '(…)' : 'true'}`);
          const f = fields.find((ff) => ff[0] === x.key);
          if (!f) {
            const fs = fields.map(([k]) => k);
            this.fail(x.p, `${nm} has no field "${x.key}"${didYouMean(x.key, fs)}; ${fs.length ? `its fields are ${fs.join(', ')}. Remove ${x.key}=… or use one of those` : `it carries no fields. Remove ${x.key}=…`}`, 'mkp.unknown-field');
          }
          const c = this.x.coerce(this.x.check(x.value.e, scope, f[1]), f[1], x.p);
          payload.push([x.key, this.irExpr(c, x.value.src, x.p)]);
        }
        for (const [f, ft] of fields) if (!payload.some((p2) => p2[0] === f)) this.fail(a.p, `${a.name} ${nm} must give every field of ${nm}, and ${f}, ${this.takes(ft)}, is missing. Add ${f}=…, e.g. ${a.name} ${nm} ${fields.map(([k, kt]) => `${k}=${payload.find((q) => q[0] === k)?.[1].expr ?? this.example(kt)}`).join(' ')}`, 'mkp.missing-field');
        return { a: a.name, name: nm, payload };
      }
    }
    return this.fail(a.p, `"${a.name}" is not an action; the actions are set, play, pause, reset, reveal, hide, open, close, emit and send${didYouMean(a.name, ['set', 'play', 'pause', 'reset', 'reveal', 'hide', 'open', 'close', 'emit', 'send'])}`);
  }

  private setOne(x: Arg, scope: Scope): IRAction {
    const st = this.stateNames.get(x.key!);
    if (!st) {
      const b = this.scope.get(x.key!);
      const can = [...this.stateNames.keys()];
      const is = b ? `is ${b.kind === 'input' ? 'an input' : `a ${b.kind}`} of ${this.label}, which set can't change` : `is not declared in ${this.label}${didYouMean(x.key!, can)}`;
      this.fail(x.p, `set changes a var, control or ref input, and "${x.key}" ${is}. ${b ? `Declare a var to change instead (var ${x.key}2 ${showType(b.type)} = …)` : `Declare it (var ${x.key} int = 0)`}${can.length ? ` or set one that exists: ${can.join(', ')}` : ''}`, 'mkp.not-state');
    }
    if (x.value.v !== 'expr') this.fail(x.p, `set ${x.key}= takes one value or expression; found ${x.key}=${x.value.src}${x.value.v === 'range' ? ', a range' : ', a duration'}. Write e.g. set ${x.key}=${this.example(st.type)}`);
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
