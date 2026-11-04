// Checking one definition (spec 6.3–6.14, 6.18, 6.19) and emitting its definition IR (13).

import { Diagnostics, MkpError, Pos, didYouMean } from '../diag';
import type { A, IRAction, IRDef, IRExpr, IRFn, IRInput, IRMeta, IRNode, IRPos, IRState, IRVal, IRValue } from '../ir';
import { IR_VERSION } from '../ir';
import { GFX_SHAPES } from '../base';
import type { Ex } from '../syntax/expr';
import { parseValueString, type ActionSyn, type Arg, type DefSyn, type EventSyn, type NodeSyn, type Val } from '../syntax/mkp';
import { fits, resolve, showType, T, Type, TypeEnv } from '../types';
import { canonical } from '../syntax/canon';
import { ExprChecker, Scope, type Checked } from './expr';
import type { DefEntry, FnEntry, Program } from './program';

export const LIMITS = {
  nesting: 12,
  children: 32,
  elements: 300,
  defDepth: 12,
  eachItems: 200,
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
}

/** An arrow's look (6.10): its colour, its line, the marks at its ends, faded back or drawn strong. */
const ARROW_LOOK: Record<string, Type> = {
  tone: { t: 'token', kind: 'color' },
  line: { t: 'choice', opts: ['solid', 'dashed', 'dotted'] },
  head: { t: 'choice', opts: ['arrow', 'hollow', 'one', 'many', 'cross', 'none'] },
  tail: { t: 'choice', opts: ['arrow', 'hollow', 'one', 'many', 'cross', 'none'] },
  dim: T.bool,
  bold: T.bool,
};
const META_KEYS = new Set(['id', 'if', 'basis', 'span']);
const META_FLAGS = new Set(['hidden', 'grow']);
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
  return { id: d.id, kind: d.syn.kind, name: d.syn.name, version: d.syn.version, pack: d.pack, inputs, order, fields, outs, records, slots, requires };
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

  constructor(
    readonly prog: Program,
    readonly entry: DefEntry,
    readonly diags: Diagnostics,
    readonly opts: DefCheckOptions,
  ) {
    const s = entry.syn;
    this.env = prog.typeEnv(entry.pack);
    this.x = new ExprChecker(prog, entry.pack, this.localFns, entry.file);
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
    if (Object.keys(this.localFns).length) ir.fns = this.localFns;
    if (this.usesGfx.size && !s.about && s.kind !== 'extern') {
      this.err(new MkpError('mkp.no-fallback', `${s.name}@${s.version} needs gfx@1 (${[...this.usesGfx].join(', ')}) and has no fallback: give it an "about" text, shown where gfx@1 is missing`, s.p));
    }
    if (this.usesGfx.size && !(ir.requires ?? []).includes('gfx@1')) {
      this.err(new MkpError('mkp.requires-gfx', `${[...this.usesGfx].join(', ')} need the gfx@1 capability; add "requires gfx@1" to ${s.name}@${s.version}`, s.p));
    }
    return ir;
  }

  private checkType(t: Type, p: Pos): void {
    const walk = (x: Type): void => {
      switch (x.t) {
        case 'named':
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
    if (playArg) {
      if (playArg.value.v !== 'dur') this.fail(playArg.p, 'play takes a duration such as 8s');
      play = playArg.value.ms;
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
        type = T.int;
        break;
      }
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
            st.on![ev.name] = this.actions(ev, this.scope);
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
        // a computed style: an expression giving a token name (checked against the tokens at runtime)
        const c = this.x.check(v.e, scope, t);
        const ct = resolve(c.type, this.env);
        if (ct.t === 'token' || ct.t === 'text' || ct.t === 'choice') return this.irExpr({ ast: c.ast, type: t }, v.src, p);
        return this.fail(p, `style props take token names; found ${showType(c.type)}`, 'mkp.style-token');
      }
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
    const sig = this.resolveDef(n.head, n.p);
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
            target[ev.name] = this.actions(ev, sc);
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
        meta.span = this.value(a.value, { t: 'int', lo: 1, hi: 12 }, scope, a.p);
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
      } else this.fail(a.p, 'arrow takes from=id to=id, an optional "label", via=(ids), route=down|right, curve, tone=, line=, head=, tail=, dim= and bold=', 'mkp.unknown-prop');
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
    return ev.actions.flatMap((a) => this.action(a, scope));
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
        if (c !== 'slider' && c !== 'steps') this.fail(a.p, `"${nm}" is not a slider or steps of this definition`, 'mkp.not-playable');
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
