// The runtime (spec 6.6–6.14, 15): state and the control bar, derived values, conditions, keyed
// each, events and actions, signals, host inputs and commands, arrows and the error boundary.
// It turns a bundle (or an expanded bundle) into a view tree of base widgets.

import type { A, IRAction, IRBundle, IRDef, IRExpr, IRFn, IRMaths, IRNode, IRState, IRVal } from '../ir';
import { inlineRuns } from '../markdown';
import { Env, EvalError, EVAL_LIMITS, fromJson, Fun, Programme, toJson, V, withBudget, deepEqual, rec, fmtNum } from '../eval';
import { resolve, showType, Type } from '../types';
import type { VArrow, VLayer, VNode, VRun, VShape } from './view';
import { compilePixels, sampleMesh } from '../gfx/compile';

export interface MathsRenderer {
  render(tex: string, display: boolean): { svg: string; w: number; h: number; va: number } | null;
  speech(tex: string, display: boolean): string | undefined;
}

export interface SignalEvent {
  document: string;
  block: number | string;
  widget: string;
  name: string;
  payload: unknown;
  time: number;
}

export interface RuntimeOptions {
  maths?: MathsRenderer;
  reducedMotion?: boolean;
  onSignal?: (e: SignalEvent) => void;
  onWarn?: (code: string, message: string) => void;
  /** a provider's cap on definition budgets */
  budgetCap?: number;
  /** capabilities the provider implements; gfx nodes fall back without gfx@1 */
  capabilities?: string[];
  /** host input values per block (block index or #anchor) */
  hosts?: Record<string, Record<string, unknown>>;
  /** clock for signal times (tests pass a fixed one) */
  now?: () => number;
  /**
   * Snapshot mode, for the Markdown writer (14): content that depends on reader state is kept
   * and marked instead of being decided by the initial state.
   */
  snapshot?: boolean;
  /** the reader's width, which every definition reads as `width` (GAPS 30); default wide */
  width?: 'narrow' | 'medium' | 'wide';
  /** the reader's theme at the start, as `theme` reads it (light by default; Markdown is light) */
  theme?: 'light' | 'dark';
  /** false: answers are left out (`answers` reads false), for Markdown without them (GAPS 166) */
  answers?: boolean;
}

/** Evaluates f, reporting whether it read reader state. */
export function readsState<T>(f: () => T): { value: T; state: boolean } {
  const outer = tracking;
  const mine = new Set<Cell>();
  tracking = mine;
  try {
    const value = f();
    return { value, state: [...mine].some((c) => c.reader) };
  } finally {
    tracking = outer;
    if (outer) for (const c of mine) outer.add(c);
  }
}

// ---------------------------------------------------------------------------------------------
// Reactivity: cells, memos and dependency tracking

let tracking: Set<Cell> | null = null;

export class Cell {
  version = 0;
  constructor(
    public value: V,
    /** state and vars change while reading; hosts and inputs are data */
    readonly reader = false,
  ) {}
  get(): V {
    if (tracking) tracking.add(this);
    return this.value;
  }
  set(v: V): boolean {
    if (deepEqual(v, this.value)) return false;
    this.value = v;
    this.version++;
    return true;
  }
}

class Memo {
  private value: V | undefined;
  private deps: [Cell, number][] | null = null;
  private busy = false;
  constructor(
    private readonly compute: () => V,
    readonly name: string,
  ) {}
  get(): V {
    if (this.deps && this.deps.every(([c, v]) => c.version === v)) {
      if (tracking) for (const [c] of this.deps) tracking.add(c);
      return this.value!;
    }
    if (this.busy) throw new EvalError('mkp.cycle', `the value ${this.name} depends on itself, through values that lead back to it, so it has no value; found a loop while working it out. Break the loop: make one value in it a state or an input instead of reading the others`);
    const outer = tracking;
    const mine = new Set<Cell>();
    tracking = mine;
    this.busy = true;
    try {
      this.value = this.compute();
    } finally {
      this.busy = false;
      tracking = outer;
    }
    this.deps = [...mine].map((c) => [c, c.version]);
    if (outer) for (const c of mine) outer.add(c);
    return this.value;
  }
}

// ---------------------------------------------------------------------------------------------
// Instances

type InputBinding =
  | { k: 'value'; get: () => V }
  | { k: 'ref'; cell: () => Cell }
  | { k: 'slot'; nodes: IRNode[] }
  | { k: 'records'; get: () => V };

interface SlotValue {
  __slot: true;
  nodes: IRNode[];
  env: Env;
  inst: Inst;
}

interface PlayState {
  dir: 1 | -1;
  acc: number;
}

export class Inst {
  readonly cells = new Map<string, Cell>();
  readonly memos = new Map<string, Memo>();
  readonly inputs = new Map<string, InputBinding>();
  readonly revealed = new Map<string, boolean>();
  readonly overlays = new Map<string, boolean>();
  readonly playing = new Map<string, PlayState>();
  readonly states = new Map<string, IRState>();
  /** this render's ids → view keys */
  ids = new Map<string, string>();
  children: Inst[] = [];
  /** bumped when the caller's scope changes, so inputs read in it are computed again (GAPS 153) */
  readonly scope = new Cell(0);
  error: { code: string; message: string } | null = null;
  errorSent = false;
  env!: Env;
  readonly fns: Record<string, IRFn> | undefined;
  readonly budget: number;
  seen = 0;

  constructor(
    readonly rt: Runtime,
    readonly def: IRDef,
    readonly path: string,
    readonly use: IRNode | null,
    public callerEnv: Env | null,
    public caller: Inst | null,
    readonly depth: number,
    readonly block: number | string | null,
  ) {
    this.fns = def.fns;
    this.budget = Math.min(def.budget ?? EVAL_LIMITS.budget, rt.opts.budgetCap ?? Infinity);
  }

  get(name: string): V {
    const c = this.cells.get(name);
    if (c) return c.get();
    if (name === '$width') return this.rt.widthCell.get();
    if (name === '$theme') return this.rt.themeCell.get();
    if (name === '$answers') return this.rt.opts.answers !== false;
    const m = this.memos.get(name);
    if (m) return m.get();
    const b = this.inputs.get(name);
    if (b) {
      switch (b.k) {
        case 'value':
        case 'records':
          return b.get();
        case 'ref':
          return b.cell().get();
        case 'slot':
          this.scope.get();
          return { __slot: true, nodes: b.nodes, env: this.callerEnv ?? this.env, inst: this.caller ?? this } as unknown as V;
      }
    }
    throw new EvalError('mkp.unbound', `${name} has no value in ${this.def.name}: it is not an input, state, var or value there; found ${name} used in ${this.def.name}. Declare it in ${this.def.name}, or correct the name`);
  }

  /** The cell behind a settable name (state, var or a ref input). */
  cellOf(name: string): Cell | undefined {
    const c = this.cells.get(name);
    if (c) return c;
    const b = this.inputs.get(name);
    if (b && b.k === 'ref') return b.cell();
    return undefined;
  }

  label(): string {
    return `${this.def.name}@${this.def.version}`;
  }
}

// ---------------------------------------------------------------------------------------------

export class Runtime {
  readonly prog: Programme;
  readonly root: Inst;
  private readonly instances = new Map<string, Inst>();
  private readonly handlers = new Map<string, Map<string, (payload?: V) => void>>();
  private readonly subscribers = new Set<() => void>();
  private tree: VNode[] = [];
  private generation = 0;
  private dirty = true;
  private signalTimes: number[] = [];
  readonly warnings: { code: string; message: string }[] = [];
  readonly signals: SignalEvent[] = [];
  private readonly mathsCache = new Map<string, IRMaths>();
  /** each pixels layer's last shape, by its key, with what it was drawn from */
  private readonly pixelsLast = new Map<string, { sig: string; shape: VShape }>();
  private nodeCount = 0;
  /** the reader's width: narrow, medium or wide, as the provider measures it */
  readonly widthCell: Cell;
  readonly themeCell: Cell;

  constructor(
    readonly bundle: IRBundle,
    readonly opts: RuntimeOptions = {},
  ) {
    this.prog = new Programme(bundle.fns, bundle.consts);
    // the host's width is data, not state: a snapshot (the Markdown) draws the branch for its width, not every one
    this.widthCell = new Cell(opts.width ?? 'wide');
    this.themeCell = new Cell(opts.theme ?? 'light');
    const docDef = Object.values(bundle.defs).find((d) => d.pack === '$doc' && d.name === 'document');
    if (!docDef) throw new Error(`this bundle has no document definition, so there is nothing to draw; found only ${Object.keys(bundle.defs).length} pack definitions. Build the bundle from a document (mkp build doc.mkp.md --pack …), not from a pack alone`);
    this.root = new Inst(this, docDef, 'doc', null, null, null, 0, null);
    this.setupInst(this.root);
    this.primeMaths(bundle);
  }

  // -------------------------------------------------------------------------------------------
  // Public API

  view(): VNode[] {
    if (this.dirty) this.render();
    return this.tree;
  }

  /**
   * The provider says how wide the reader's view is: narrow (a phone), medium or wide. Everything
   * that reads `width` is drawn again.
   */
  setWidth(w: 'narrow' | 'medium' | 'wide'): void {
    if (this.widthCell.set(w)) this.changed();
  }

  /**
   * The provider says which theme the reader sees: light or dark. Everything that reads `theme` is
   * drawn again. A renderer that follows the reader's system setting says so whenever it changes.
   */
  setTheme(t: 'light' | 'dark'): void {
    if (this.themeCell.set(t)) this.changed();
  }

  /**
   * The maths engine arrived after the document (a host that loads it lazily): formulas drawn
   * without a picture get one, and everything else, the state included, stays as it is.
   */
  setMaths(m: MathsRenderer | undefined): void {
    if (this.opts.maths === m) return;
    (this.opts as { maths?: MathsRenderer }).maths = m;
    this.changed();
  }

  subscribe(f: () => void): () => void {
    this.subscribers.add(f);
    return () => this.subscribers.delete(f);
  }

  /** Reports an event from a renderer: click, change, submit, open, close, drag. */
  dispatch(key: string, event: string, payload?: unknown): void {
    const h = this.handlers.get(key)?.get(event);
    if (!h) return;
    h(payload === undefined ? undefined : fromJson(payload));
    this.changed();
  }

  /** Whether any control is playing (renderers then call tick on animation frames). */
  playing(): boolean {
    for (const i of this.instances.values()) if (i.playing.size) return true;
    return this.root.playing.size > 0;
  }

  /** Advances playing controls by ms. */
  tick(ms: number): void {
    let any = false;
    for (const inst of [this.root, ...this.instances.values()]) {
      for (const [name, ps] of [...inst.playing]) {
        any = true;
        this.advance(inst, name, ps, ms);
      }
    }
    if (any) this.changed();
  }

  /** The instance of a top-level widget block, by index or #anchor. */
  widget(block: number | string): WidgetHandle {
    const inst = [...this.instances.values()].find((i) => i.block === block && i.caller === this.root);
    if (!inst) {
      const have = [...this.instances.values()].filter((i) => i.caller === this.root && i.block !== null).map((i) => String(i.block));
      throw new Error(`there is no widget block ${block} in this document; found ${have.length ? `the blocks ${have.join(', ')}` : 'no widget blocks'}. Pass a block's index (0 for the first) or its #anchor`);
    }
    return new WidgetHandle(this, inst);
  }

  /** Every top-level widget block's instance. */
  blocks(): Inst[] {
    this.view();
    return [...this.instances.values()].filter((i) => i.caller === this.root);
  }

  /** Fixture play step {"press": id}: an element id or a control button (k.play, tour.next…). */
  press(id: string): boolean {
    this.view();
    for (const inst of [this.root, ...this.instances.values()]) {
      const key = inst.ids.get(id);
      if (key && this.handlers.get(key)?.has('click')) {
        this.dispatch(key, 'click');
        return true;
      }
    }
    return false;
  }

  /**
   * Fixture play step {"set": {…}} on the first widget (or the document's state); "part/name"
   * sets the state of the first instance of that part inside the blocks (GAPS 87).
   */
  set(values: Record<string, unknown>, inst?: Inst): void {
    this.view();
    for (const [k0, v] of Object.entries(values)) {
      const slash = k0.indexOf('/');
      const k = slash >= 0 ? k0.slice(slash + 1) : k0;
      const pool = slash >= 0 ? [...this.instances.values()].filter((i) => i.def.name === k0.slice(0, slash)) : [...this.blocks(), this.root];
      const owner = inst ?? pool.find((i) => i.cellOf(k));
      const c = owner?.cellOf(k);
      if (!owner || !c) {
        const names = [...new Set(pool.flatMap((i) => [...i.states.keys()]))];
        throw new Error(`no widget block has a state named ${k0}; found ${names.length ? `the states ${names.join(', ')}` : 'no states at all'}. Set one of those, or write part/name for a state of a part inside the block`);
      }
      this.setCell(owner, k, fromJson(v));
    }
    this.changed();
  }

  /** Fixture play step {"open": id}: opens an overlay (GAPS 115). */
  open(id: string): boolean {
    this.view();
    for (const inst of [this.root, ...this.instances.values()]) {
      const key = inst.ids.get(id);
      if (key && this.handlers.get(key)?.has('open')) {
        this.dispatch(key, 'open');
        return true;
      }
    }
    return false;
  }

  /** The instance a scope view node stands for. */
  instanceAt(key: string): Inst | undefined {
    return this.instances.get(key);
  }

  /** Values of every instance's state and derived values (for conformance and tests). */
  snapshot(): Record<string, Record<string, unknown>> {
    this.view();
    const out: Record<string, Record<string, unknown>> = {};
    for (const inst of [this.root, ...this.instances.values()]) {
      const vals: Record<string, unknown> = {};
      for (const v of inst.def.values ?? []) {
        if (v.k === 'fn') continue;
        try {
          vals[v.name] = toJson(withBudget(inst.budget, `${inst.label()} ${v.name}`, () => inst.get(v.name)));
        } catch (e) {
          vals[v.name] = { error: (e as EvalError).code ?? 'error' };
        }
      }
      if (Object.keys(vals).length) out[inst.path] = vals;
    }
    return out;
  }

  // -------------------------------------------------------------------------------------------
  // Maths

  private primeMaths(b: IRBundle): void {
    const visit = (v: unknown): void => {
      if (!v || typeof v !== 'object') return;
      if (Array.isArray(v)) return v.forEach(visit);
      const o = v as Record<string, unknown>;
      if (typeof o.tex === 'string' && typeof o.svg === 'string') this.mathsCache.set(`${o.display ? 'D' : 'I'}${o.tex}`, o as unknown as IRMaths);
      if (Array.isArray(o.maths)) for (const m of o.maths as IRMaths[]) if (m.svg) this.mathsCache.set(`${m.display ? 'D' : 'I'}${m.tex}`, m);
      for (const x of Object.values(o)) if (x && typeof x === 'object') visit(x);
    };
    visit(b.doc);
    visit(b.defs);
  }

  maths(tex: string, display: boolean): IRMaths {
    const key = `${display ? 'D' : 'I'}${tex}`;
    const hit = this.mathsCache.get(key);
    if (hit && (hit.speech || !this.opts.maths)) return hit;
    const m: IRMaths = hit ? { ...hit } : { tex, display };
    if (this.opts.maths && !m.svg) {
      const r = this.opts.maths.render(this.expandMacros(tex), display);
      if (r) Object.assign(m, r);
    }
    if (this.opts.maths && !m.speech) m.speech = this.opts.maths.speech(this.expandMacros(tex), display);
    if (this.mathsCache.size > 2000) this.mathsCache.clear();
    this.mathsCache.set(key, m);
    return m;
  }

  private expandMacros(tex: string): string {
    let out = tex;
    for (const [k, v] of Object.entries(this.bundle.macros)) out = out.replace(new RegExp(`\\\\${k}(?![A-Za-z])`, 'g'), () => v);
    return out;
  }

  runs(text: string): VRun[] {
    return inlineRuns(text).map((r) => (r.t === 'math' ? { ...r, ...this.maths(r.tex, !!r.display) } : r)) as VRun[];
  }

  // -------------------------------------------------------------------------------------------
  // Instances and their scope

  private setupInst(inst: Inst): void {
    const env = new Env(null, null, inst, this.prog);
    inst.env = env;
    const def = inst.def;
    const use = inst.use;
    // inputs
    for (const inp of def.inputs) {
      const t = this.resolveType(inp.type);
      const given = use?.props?.[inp.name];
      if (t.t === 'slot') {
        const slotName = inp.name;
        const firstSlot = def.inputs.find((i) => this.resolveType(i.type).t === 'slot')?.name;
        const nodes = slotName === firstSlot ? use?.children ?? [] : use?.fills?.[slotName] ?? [];
        inst.inputs.set(inp.name, { k: 'slot', nodes });
        continue;
      }
      if (t.t === 'records') {
        const recs = (use?.records ?? []).filter((r) => r.input === inp.name || (r.node === 'each' || r.node === 'switch'));
        // memoised like a derived value: rebuilt only when state its records read (if=, fields) changes,
        // or when the caller's scope does
        const memo = new Memo(() => {
          inst.scope.get();
          return this.recordValues(recs, inp.name, inst.callerEnv ?? env, inst.caller ?? inst, t);
        }, `${def.name}.${inp.name}`);
        inst.inputs.set(inp.name, { k: 'records', get: () => memo.get() });
        continue;
      }
      if (given && 'ref' in given) {
        const name = (given as { ref: string }).ref;
        inst.inputs.set(inp.name, { k: 'ref', cell: () => inst.caller!.cellOf(name) ?? this.fail('mkp.not-state', `the input ${inp.name} of ${def.name} is bound to ${name} by reference, so ${name} must be a state or var of ${inst.caller!.label()}; found no state or var ${name} there. Declare it there, or bind the input to a state that exists`) });
        continue;
      }
      const val = given ?? inp.default;
      if (val === undefined) {
        inst.inputs.set(inp.name, { k: 'value', get: () => this.fail('mkp.missing-input', `${def.name} needs its input ${inp.name}, which has no default; found no ${inp.name} where ${def.name} is used. Give it there (${inp.name}=…), or give the input a default in ${def.name} (in ${inp.name} ${showType(inp.type)} = …)`) });
        continue;
      }
      const constEnv = new Env(null, null, null, this.prog);
      const memo = new Memo(() => {
        if (!given) return this.valueOf(val, constEnv, inst);
        inst.scope.get();
        return this.valueOf(val, inst.callerEnv ?? env, inst.caller ?? inst);
      }, `${def.name}.${inp.name}`);
      inst.inputs.set(inp.name, { k: 'value', get: () => memo.get() });
    }
    // values in order
    for (const v of def.values ?? []) {
      switch (v.k) {
        case 'state': {
          inst.states.set(v.name, v);
          inst.cells.set(v.name, new Cell(this.stateDefault(inst, v), true));
          // a clock runs from the start; renderers tick only while the page is on screen
          if (v.control === 'clock' && !this.opts.snapshot) inst.playing.set(v.name, { dir: 1, acc: 0 });
          break;
        }
        case 'var':
          inst.cells.set(v.name, new Cell(this.valueOf(v.default, env, inst), true));
          break;
        case 'host': {
          const given = inst.block !== null ? this.opts.hosts?.[String(inst.block)]?.[v.name] : undefined;
          let init = this.valueOf(v.default, env, inst);
          if (given !== undefined) {
            const err = checkValue(given, v.type, (n) => this.bundle.types[n] ?? findType(this.bundle, n));
            if (err) this.warn('mkp.host-input', `the host's value for host input ${v.name} of ${def.name} has the wrong type, so its default is used; found ${err.includes('found ') ? err.slice(err.lastIndexOf('found ') + 6) : 'a value of another type'} (${err.replace(/, found .*$/, '')}). Send a value of type ${showType(v.type)}`);
            else init = fromJson(given);
          }
          inst.cells.set(v.name, new Cell(init));
          break;
        }
        case 'derived': {
          const run = this.prog.compile(v.value.ast);
          inst.memos.set(v.name, new Memo(() => withBudget(inst.budget, `${def.name} ${v.name}`, () => run(env)), `${def.name}.${v.name}`));
          break;
        }
        case 'fn':
          break;
      }
    }
  }

  private stateDefault(inst: Inst, s: IRState): V {
    const env = inst.env;
    if (s.default) return this.valueOf(s.default, env, inst);
    switch (s.control) {
      case 'slider':
        return this.valueOf(s.args.min, env, inst);
      case 'choice':
        return ((s.args.opts as { lit: string[] }).lit ?? [''])[0];
      case 'toggle':
        return false;
      case 'steps':
        return s.args.none && 'lit' in s.args.none && s.args.none.lit ? -1 : 0;
      case 'clock':
        return 0;
      case 'drag': {
        const x = this.rangeOf(s.args.x, env, inst);
        const y = this.rangeOf(s.args.y, env, inst);
        return [(x[0] + x[1]) / 2, (y[0] + y[1]) / 2];
      }
    }
  }

  resolveType(t: Type): Type {
    return resolve(t, (n) => findType(this.bundle, n));
  }

  /** The current list of record values of a record-list input (records, each and switch among them). */
  private recordValues(nodes: IRNode[], input: string, env: Env, inst: Inst, type?: Type): V {
    const nested = type && type.t === 'records' ? type.fields.map(([f, ft]) => [f, this.resolveType(ft)] as const).filter(([, ft]) => ft.t === 'records') : [];
    const out: V[] = [];
    const visit = (ns: IRNode[], e: Env): void => {
      for (const n of ns) {
        if (n.node === 'each') {
          for (const { env: e2 } of this.eachItems(n, e, inst)) visit([...(n.records ?? []), ...(n.children ?? [])].filter((x) => x.node === '$record' || x.node === 'each' || x.node === 'switch'), e2);
          continue;
        }
        if (n.node === 'switch') {
          const picked = this.switchPick(n, e, inst);
          if (picked) visit(picked, e);
          continue;
        }
        if (n.node !== '$record' || n.input !== input) continue;
        if (n.meta?.if && !this.evalExpr(n.meta.if, e, inst)) continue;
        const o = Object.create(null) as Record<string, V>;
        for (const [k, v] of Object.entries(n.props ?? {})) o[k] = this.valueOf(v, e, inst);
        // nested record lists (fields of record-list type), empty when none are written
        for (const [f, ft] of nested) o[f] = this.recordValues(n.records ?? [], f, e, inst, ft);
        for (const r of n.records ?? []) if (r.input && !(r.input in o)) o[r.input] = this.recordValues(n.records ?? [], r.input, e, inst);
        // a record's slot, when its type has one
        if (!type || (type.t === 'records' && type.slot)) o.slot = { __slot: true, nodes: n.children ?? [], env: e, inst } as unknown as V;
        out.push(o);
      }
    };
    visit(nodes, env);
    return out;
  }

  valueOf(v: IRVal, env: Env, inst: Inst): V {
    if ('lit' in v) return fromJson(v.lit);
    if ('expr' in v && 'ast' in v) return this.evalExpr(v as IRExpr, env, inst);
    if ('text' in v) return (v as { text: string }).text;
    if ('tex' in v) return (v as { tex: string }).tex;
    if ('tok' in v) return (v as { tok: string }).tok;
    if ('ms' in v) return (v as { ms: number }).ms;
    if ('range' in v) return this.rangeOf(v, env, inst);
    if ('ref' in v) return inst.get((v as { ref: string }).ref);
    return 0;
  }

  rangeOf(v: IRVal | undefined, env: Env, inst: Inst): [number, number] {
    if (!v) return [-1, 1];
    if ('range' in v) return [this.valueOf(v.range[0], env, inst) as number, this.valueOf(v.range[1], env, inst) as number];
    const x = this.valueOf(v, env, inst);
    return Array.isArray(x) ? (x as [number, number]) : [-1, 1];
  }

  evalExpr(e: IRExpr, env: Env, inst: Inst): V {
    const run = this.compiled(e.ast);
    return withBudget(inst.budget, `${inst.label()} ${e.expr}`, () => run(env));
  }

  private readonly compiledCache = new WeakMap<A, (env: Env) => V>();
  private compiled(a: A): (env: Env) => V {
    let f = this.compiledCache.get(a);
    if (!f) {
      f = this.prog.compile(a);
      this.compiledCache.set(a, f);
    }
    return f;
  }

  fail(code: string, message: string): never {
    throw new EvalError(code, message);
  }

  warn(code: string, message: string): void {
    if (this.warnings.length < 200 && !this.warnings.some((w) => w.message === message)) {
      this.warnings.push({ code, message });
      this.opts.onWarn?.(code, message);
    }
  }

  // -------------------------------------------------------------------------------------------
  // Rendering

  private changed(): void {
    this.dirty = true;
    for (const f of this.subscribers) f();
  }

  private render(): void {
    this.generation++;
    this.handlers.clear();
    this.nodeCount = 0;
    const root = this.root;
    root.ids = new Map();
    root.children = [];
    const kids = this.renderNodes(this.bundle.doc.body, root.env, root, 'doc');
    const bar = this.bar(root, 'doc');
    this.tree = bar ? [...kids] : kids;
    numberFootnotes(this.tree);
    // drop instances that were not rendered: their state resets when they return
    for (const [k, i] of this.instances) if (i.seen !== this.generation) this.instances.delete(k);
    this.dirty = false;
  }

  private count(inst: Inst): void {
    if (++this.nodeCount > EVAL_LIMITS.list / 2) {
      // 5,000 rendered nodes per widget instance (6.18), counted per document here
      if (this.nodeCount > 5000 * Math.max(1, this.instances.size)) throw new EvalError('mkp.nodes', `a widget may draw at most 5,000 elements; found more than that in ${inst.label()}. Draw fewer: show a long list a page at a time, or cut an each short`);
    }
  }

  renderNodes(nodes: IRNode[], env: Env, inst: Inst, path: string): VNode[] {
    const out: VNode[] = [];
    nodes.forEach((n, i) => {
      const key = `${path}/${i}`;
      const r = this.renderNode(n, env, inst, key);
      if (Array.isArray(r)) out.push(...r);
      else if (r) out.push(r);
    });
    return out;
  }

  private eachItems(n: IRNode, env: Env, inst: Inst): { env: Env; key: string }[] {
    const items: V[] = [];
    let isRange = false;
    if (n.in && 'range' in n.in) {
      isRange = true;
      const [a, b] = this.rangeOf(n.in, env, inst);
      for (let v = Math.ceil(a); v <= b && items.length <= EVAL_LIMITS.list; v++) items.push(v);
    } else if (n.in) {
      const v = this.valueOf(n.in, env, inst);
      if (Array.isArray(v)) items.push(...v);
    }
    // the list limit; the rendered-node count and the budget are what bound a large each (GAPS 112)
    if (items.length > EVAL_LIMITS.list) throw new EvalError('mkp.each', `an each may go over at most ${EVAL_LIMITS.list} items; found ${items.length > EVAL_LIMITS.list && isRange ? `more than ${EVAL_LIMITS.list}` : items.length} in ${inst.label()}. Give it a shorter list or range, e.g. one page of it at a time`);
    const seen = new Set<string>();
    return items.map((item, idx) => {
      const e = env.child({ [n.var!]: item });
      let k: string;
      if (n.key) k = String(toKey(this.evalExpr(n.key, e, inst)));
      else k = isRange ? String(item) : String(idx);
      if (seen.has(k)) throw new EvalError('mkp.duplicate-key', `each item of an each needs its own key; found the key ${k} twice in ${inst.label()}. Make key= read something unique to each item, e.g. its index or an id field`);
      seen.add(k);
      return { env: e, key: k };
    });
  }

  private switchPick(n: IRNode, env: Env, inst: Inst): IRNode[] | null {
    const v = this.evalExpr(n.subject!, env, inst);
    for (const c of n.cases ?? []) if (deepEqual(this.valueOf(c.value, env, inst), v)) return c.children;
    return n.else ?? null;
  }

  private renderNode(n: IRNode, env: Env, inst: Inst, key: string): VNode | VNode[] | null {
    this.count(inst);
    switch (n.node) {
      case 'each': {
        const out: VNode[] = [];
        for (const it of this.eachItems(n, env, inst)) out.push(...this.renderNodes(n.children ?? [], it.env, inst, `${key}[${it.key}]`));
        return out;
      }
      case 'switch': {
        if (this.opts.snapshot) {
          const r = readsState(() => this.evalExpr(n.subject!, env, inst));
          if (r.state) {
            const cases: VNode[] = (n.cases ?? []).map((c, i) => ({ t: 'case', key: `${key}:${i}`, p: { label: String(this.valueOf(c.value, env, inst)) }, kids: this.renderNodes(c.children, env, inst, `${key}:${i}`) }));
            if (n.else) cases.push({ t: 'case', key: `${key}:else`, p: { label: 'else' }, kids: this.renderNodes(n.else, env, inst, `${key}:else`) });
            return { t: 'cases', key, p: { style: 'steps' }, kids: cases };
          }
        }
        const picked = this.switchPick(n, env, inst);
        const idx = picked ? (n.cases ?? []).findIndex((c) => c.children === picked) : -1;
        return picked ? this.renderNodes(picked, env, inst, `${key}:${idx < 0 ? 'else' : idx}`) : [];
      }
      case 'slot': {
        // slot body if=(…): drawn while it holds (a snapshot keeps one that depends on state)
        if (n.meta?.if) {
          const r = readsState(() => this.evalExpr(n.meta!.if!, env, inst));
          if (!r.value && !(this.opts.snapshot && r.state)) return [];
        }
        if (this.opts.snapshot) {
          // a slot chosen by state (tabs: slot pages[at].slot) shows every pane, titled
          const a = n.value!.ast;
          const r = readsState(() => this.evalExpr(n.value!, env, inst));
          if (r.state && a.t === 'field' && a.o.t === 'index') {
            const list = this.compiled(a.o.o)(env) as V[];
            const panes: VNode[] = list.map((item, i) => {
              const rv = item as unknown as Record<string, V>;
              const pane = rv.slot as unknown as SlotValue;
              const title = Object.entries(rv).find(([k, v]) => k !== 'slot' && typeof v === 'string')?.[1];
              const kids = pane && pane.__slot ? this.renderNodes(pane.nodes, pane.env, pane.inst, `${key}~${i}`) : [];
              return { t: 'case', key: `${key}~${i}`, p: { label: title === undefined ? String(i + 1) : String(title) }, kids };
            });
            return { t: 'cases', key, p: { style: 'sections' }, kids: panes };
          }
        }
        const sv = this.evalExpr(n.value!, env, inst) as unknown as SlotValue;
        if (!sv || !sv.__slot) return [];
        return this.renderNodes(sv.nodes, sv.env, sv.inst, `${key}~`);
      }
      case 'controls':
        return (n.names ?? []).map((nm) => this.control(inst, nm, key)).filter(Boolean) as VNode[];
      case 'arrow':
        this.pendingArrows(inst).push({ n, env, key });
        return null;
      case '$record':
      case '$prop':
        return null;
    }
    // meta: if=, hidden, id
    let cond = false;
    if (n.meta?.if) {
      const r = readsState(() => this.evalExpr(n.meta!.if!, env, inst));
      if (!r.value) {
        if (!(this.opts.snapshot && r.state)) return null;
        cond = true;
      }
    }
    let id: string | undefined;
    if (n.meta?.id !== undefined) id = typeof n.meta.id === 'string' ? n.meta.id : String(this.evalExpr(n.meta.id, env, inst));
    const def = n.def ? this.bundle.defs[n.def] : undefined;
    let v: VNode | null;
    if (def && def.kind !== 'extern') v = this.renderUse(n, def, env, inst, key);
    else v = this.renderBase(n, env, inst, key);
    if (!v) return null;
    if (n.pos) v.src = [inst.def.file ?? inst.def.id, n.pos[0], n.pos[1]];
    if (cond) v.p = { ...v.p, $cond: true };
    if (id !== undefined) {
      // a snapshot draws every branch whose condition reads state, so exclusive branches may share an id
      if (inst.ids.has(id) && !this.opts.snapshot) throw new EvalError('mkp.duplicate-id', `ids must be unique within a widget; found id ${id} on two elements in ${inst.label()}. Rename one, or inside an each compute it from the item, e.g. id=(…) with the item's index in it`);
      inst.ids.set(id, v.key);
      v.id = id;
      if (n.meta?.hidden) v.hidden = !inst.revealed.get(id);
    } else if (n.meta?.hidden) v.hidden = true;
    const layout: VNode['layout'] = {};
    if (n.meta?.grow) layout.grow = true;
    if (n.meta?.basis) layout.basis = n.meta.basis;
    if (n.meta?.span) layout.span = this.valueOf(n.meta.span, env, inst) as number;
    if (n.meta?.self) layout.self = n.meta.self;
    if (n.meta?.keep && this.valueOf(n.meta.keep, env, inst)) layout.keep = true;
    if (Object.keys(layout).length) v.layout = layout;
    return v;
  }

  private readonly arrowQueue = new Map<Inst, { n: IRNode; env: Env; key: string }[]>();
  private pendingArrows(inst: Inst): { n: IRNode; env: Env; key: string }[] {
    let q = this.arrowQueue.get(inst);
    if (!q) {
      q = [];
      this.arrowQueue.set(inst, q);
    }
    return q;
  }

  /** A use of a derived widget or part: an instance, its view, its bar and its arrows. */
  private renderUse(n: IRNode, def: IRDef, env: Env, inst: Inst, key: string): VNode {
    const depth = inst.depth + 1;
    const path = `${key}#${def.name}`;
    if (depth > 13 || (inst.def.id === def.id && depth > 12)) {
      this.warn('mkp.recursion', `widgets may be nested at most 12 levels deep while the page runs; found ${def.name} at level ${depth}, so it shows "…" there instead. Stop the recursion sooner, e.g. with if= on a level input or by passing a shorter list each time`);
      return { t: 'text', key: path, p: { runs: [{ t: 'text', v: '…' }], tone: 'muted' } };
    }
    let child = this.instances.get(path);
    if (!child || child.def !== def) {
      child = new Inst(this, def, path, n.inst ? { ...n, children: n.children } : n, env, inst, depth, inst === this.root ? n.meta?.block ?? n.meta?.anchor ?? null : null);
      this.instances.set(path, child);
      try {
        this.setupInst(child);
      } catch (e) {
        child.error = { code: (e as EvalError).code ?? 'mkp.runtime', message: (e as Error).message };
      }
    } else {
      // a keyed instance can move (each key=): its inputs read the scope it is in now
      if (child.caller !== inst || !sameScope(child.callerEnv, env)) child.scope.set((child.scope.value as number) + 1);
      child.callerEnv = env;
      child.caller = inst;
    }
    child.seen = this.generation;
    inst.children.push(child);
    child.ids = new Map();
    child.children = [];
    const view = n.inst?.view ?? def.view ?? [];
    const vnode: VNode = { t: 'scope', key: path, p: { def: def.id, name: def.name } };
    if (n.meta?.summary) vnode.p.summary = n.meta.summary;
    if (n.meta?.anchor) vnode.p.anchor = n.meta.anchor;
    if (child.error) return this.errorNode(child, vnode, n);
    try {
      this.arrowQueue.delete(child);
      const kids = this.renderNodes(view, child.env, child, path);
      const bar = this.bar(child, path);
      // a widget drawn in a frame has its bar in the frame's (6.8)
      const frame = kids.length === 1 && kids[0].t === 'frame' ? kids[0] : undefined;
      if (frame && bar) {
        frame.slots = { ...frame.slots, bar: [...(bar.kids ?? []), ...(frame.slots?.bar ?? [])] };
        this.placeStatus(frame);
      }
      vnode.kids = bar && !frame ? [...kids, bar] : kids;
      const arrows = this.resolveArrows(child);
      if (arrows.length) vnode.arrows = arrows;
      // events this use handles are run in the caller (emit)
      return vnode;
    } catch (e) {
      if (!(e instanceof EvalError)) throw e;
      child.error = { code: e.code, message: e.message };
      return this.errorNode(child, vnode, n);
    }
  }

  private errorNode(child: Inst, vnode: VNode, n: IRNode): VNode {
    const err = child.error!;
    if (!child.errorSent) {
      child.errorSent = true;
      this.emitSignal(child, 'error', { code: err.code, message: err.message, path: child.path });
    }
    return { t: 'error', key: vnode.key, p: { summary: n.meta?.summary ?? child.def.about ?? '', message: err.message, code: err.code, name: child.def.name } };
  }

  private resolveArrows(inst: Inst): VArrow[] {
    const q = this.arrowQueue.get(inst) ?? [];
    this.arrowQueue.delete(inst);
    const out: VArrow[] = [];
    for (const { n, env, key } of q) {
      if (n.meta?.if && !this.evalExpr(n.meta.if, env, inst)) continue;
      const fromId = String(this.valueOf(n.from!, env, inst));
      const toId = String(this.valueOf(n.to!, env, inst));
      const from = this.findId(inst, fromId);
      const to = this.findId(inst, toId);
      if (!from || !to) {
        this.warn('mkp.arrow-missing', `the arrow from ${fromId} to ${toId} is not drawn, since each end must be an element's id; found no element with id ${!from ? fromId : toId} in ${inst.label()} or the widgets inside it. Give that element id=${!from ? fromId : toId}, or correct ${!from ? 'from=' : 'to='}`);
        continue;
      }
      const a: VArrow = { key: `${key}:${fromId}>${toId}`, from, to };
      if (n.label) a.label = this.runs(String(this.valueOf(n.label, env, inst)));
      if (n.curve) a.curve = true;
      if (n.route) a.route = this.valueOf(n.route, env, inst) as 'down' | 'right';
      for (const [k, v] of Object.entries(n.look ?? {})) {
        const x = this.valueOf(v, env, inst);
        if (k === 'dim' || k === 'bold') {
          if (x) a[k] = true;
        } else if (k === 'opacity') {
          if (typeof x === 'number' && x < 1) a.opacity = Math.max(0, x);
        } else if (k === 'layer') {
          if (x === 'behind') a.layer = 'behind';
        } else if (k === 'lanes') {
          if (x === 'turn') a.lanes = 'turn';
        } else if (k === 'hop') {
          if (x === 'none') a.hop = 'none';
        } else if (x !== 'none' || k === 'head' || k === 'corner') (a as unknown as Record<string, unknown>)[k] = String(x);
      }
      // an empty label draws nothing, not an empty box (GAPS 129)
      if (a.label && !a.label.some((r) => ('v' in r && String(r.v).trim()) || r.t === 'math')) delete a.label;
      if (n.via) {
        // waypoints: each id found like from and to; one that is missing is left out, with a warning
        const via: string[] = [];
        for (const v of this.valueOf(n.via, env, inst) as V[]) {
          const k = this.findId(inst, String(v));
          if (k) via.push(k);
          else this.warn('mkp.arrow-missing', `the arrow from ${fromId} to ${toId} goes via ${String(v)}, so the path skips that point; found no element with id ${String(v)} in ${inst.label()} or the widgets inside it. Give that element id=${String(v)}, or remove it from via=`);
        }
        if (via.length) a.via = via;
      }
      out.push(a);
    }
    return out;
  }

  /** An id in the instance itself, or in the instances nested inside it (6.8, 6.10). */
  private findId(inst: Inst, id: string): string | undefined {
    const own = inst.ids.get(id);
    if (own) return own;
    const hits: string[] = [];
    const walk = (i: Inst): void => {
      for (const c of i.children) {
        const k = c.ids.get(id);
        if (k) hits.push(k);
        walk(c);
      }
    };
    walk(inst);
    if (hits.length > 1) throw new EvalError('mkp.duplicate-id', `an arrow end must name one element; found id ${id} in ${hits.length} widgets nested in ${inst.label()}, so it is unclear which is meant. Give the element you mean an id of its own, and use that`);
    return hits[0];
  }

  // -------------------------------------------------------------------------------------------
  // Base widgets

  private props(n: IRNode, env: Env, inst: Inst): Record<string, V> {
    const out: Record<string, V> = { ...this.externDefaults(n.def) };
    for (const [k, v] of Object.entries(n.props ?? {})) out[k] = this.valueOf(v, env, inst);
    return out;
  }

  private readonly defaultsCache = new Map<string, Record<string, V>>();
  /** A base widget's defaults for the props a use leaves out, so a provider gets every prop. */
  private externDefaults(id: string | undefined): Record<string, V> {
    if (!id) return {};
    let d = this.defaultsCache.get(id);
    if (!d) {
      d = {};
      const def = this.bundle.defs[id];
      if (def?.kind === 'extern') {
        const empty = new Env(null, null, null, this.prog);
        for (const i of def.inputs) {
          const t = this.resolveType(i.type).t;
          if (!i.default || t === 'slot' || t === 'records' || t === 'ref') continue;
          try {
            d[i.name] = this.valueOf(i.default, empty, this.root);
          } catch {
            // a default that reads something is left to the provider
          }
        }
      }
      this.defaultsCache.set(id, d);
    }
    return d;
  }

  private on(key: string, event: string, f: (payload?: V) => void): void {
    let m = this.handlers.get(key);
    if (!m) {
      m = new Map();
      this.handlers.set(key, m);
    }
    m.set(event, f);
  }

  /** Wires a node's own handlers (written on it in .mkp) to run in its writer's scope. */
  private wire(n: IRNode, v: { key: string; ev?: string[] }, env: Env, inst: Inst): void {
    for (const [ev, actions] of Object.entries(n.on ?? {})) {
      this.on(v.key, ev, (payload) => this.runActions(actions, payload === undefined ? env : env.child({ [ev]: payload }), inst));
      (v.ev ??= []).includes(ev) || v.ev.push(ev);
    }
  }

  private renderBase(n: IRNode, env: Env, inst: Inst, key: string): VNode | null {
    const kids = (): VNode[] => this.renderNodes(n.children ?? [], env, inst, key);
    switch (n.node) {
      case 'paragraph':
      case 'heading': {
        const p = this.props(n, env, inst);
        const v: VNode = { t: n.node, key, p: { runs: this.runs(String(p.text ?? '')) } };
        if (n.node === 'heading') v.p.level = p.level ?? 2;
        if (n.meta?.anchor) v.p.anchor = n.meta.anchor;
        return v;
      }
      case 'divider':
        return { t: 'divider', key, p: {} };
      case 'code': {
        const p = this.props(n, env, inst);
        const marks = ((p.marks as V[] | undefined) ?? []).map((m) => Object.fromEntries(m instanceof Map ? m : Object.entries(m as object)));
        const v: VNode = { t: 'code', key, p: { src: p.src, lang: p.lang ?? '', line: p.line ?? 0, ...(marks.length ? { marks } : {}), ...(p.pickable ? { pickable: true } : {}) } };
        // a pressed line raises pick {line} (GAPS 68, 96)
        this.wire(n, v, env, inst);
        return v;
      }
      case 'math': {
        const p = this.props(n, env, inst);
        const marks = ((p.marks as V[] | undefined) ?? []).map((m) => Object.fromEntries(m instanceof Map ? m : Object.entries(m as object)));
        return { t: 'math', key, p: { ...this.maths(String(p.tex), true), ...(marks.length ? { marks } : {}) } };
      }
      case 'quote': {
        const p = this.props(n, env, inst);
        return { t: 'quote', key, p: { alert: p.alert ?? 'none' }, kids: kids() };
      }
      case 'list': {
        const p = this.props(n, env, inst);
        const items: VNode[] = [];
        let idx = 0;
        const visit = (rs: IRNode[], e: Env, k: string): void => {
          for (const r of rs) {
            if (r.node === 'each') {
              for (const it of this.eachItems(r, e, inst)) visit([...(r.records ?? []), ...(r.children ?? [])], it.env, `${k}[${it.key}]`);
              continue;
            }
            if (r.node !== '$record') continue;
            if (r.meta?.if && !this.evalExpr(r.meta.if, e, inst)) continue;
            const rp = this.props(r, e, inst);
            items.push({ t: 'item', key: `${k}/${idx}`, p: { checked: rp.checked ?? 'none' }, kids: this.renderNodes(r.children ?? [], e, inst, `${k}/${idx}`) });
            idx++;
          }
        };
        visit(n.records ?? [], env, key);
        return { t: 'list', key, p: { ordered: !!p.ordered, start: p.start ?? 1 }, kids: items };
      }
      case 'table': {
        const p = this.props(n, env, inst);
        const head = (p.head as string[]).map((c) => this.runs(c));
        const rows = (p.rows as string[][]).map((r) => r.map((c) => this.runs(String(c))));
        return { t: 'table', key, p: { head, rows, align: p.align ?? [] } };
      }
      case 'footnote': {
        const p = this.props(n, env, inst);
        return { t: 'footnote', key, p: { label: p.label }, kids: kids() };
      }
      case 'column':
      case 'row':
      case 'grid':
      case 'stack': {
        const p = this.props(n, env, inst);
        const v: VNode = { t: n.node, key, p, kids: kids() };
        this.wire(n, v, env, inst);
        return v;
      }
      case 'text': {
        const p = this.props(n, env, inst);
        const value = String(p.value ?? '');
        const v: VNode = { t: 'text', key, p: { ...p, runs: p.literal ? [{ t: 'text', v: value }] : this.runs(value) } };
        delete v.p.value;
        return v;
      }
      case 'image': {
        const p = this.props(n, env, inst);
        return { t: 'image', key, p };
      }
      case 'press': {
        const p = this.props(n, env, inst);
        const v: VNode = { t: 'press', key, p, kids: kids(), ev: [] };
        this.wire(n, v, env, inst);
        if (!v.ev!.includes('click')) v.ev!.push('click');
        return v;
      }
      case 'range': {
        const p = this.props(n, env, inst);
        const ref = (n.props?.value as { ref?: string } | undefined)?.ref;
        const v: VNode = { t: 'range', key, p, ev: ['change'] };
        this.on(key, 'change', (payload) => {
          const val = Array.isArray(payload) ? payload[0] : (payload as Record<string, V> | undefined)?.value ?? payload;
          if (ref) this.setCell(inst, ref, val as V);
          for (const a of n.on?.change ?? []) this.runActions([a], env.child({ change: rec([['value', val as V]]) }), inst);
        });
        return v;
      }
      case 'field': {
        const p = this.props(n, env, inst);
        const ref = (n.props?.value as { ref?: string } | undefined)?.ref;
        const v: VNode = { t: 'field', key, p, ev: ['change', 'submit'] };
        this.on(key, 'change', (payload) => {
          const val = typeof payload === 'string' ? payload : String((payload as Record<string, V> | undefined)?.value ?? '');
          if (ref) this.setCell(inst, ref, val);
          if (n.on?.change) this.runActions(n.on.change, env.child({ change: rec([['value', val]]) }), inst);
        });
        this.on(key, 'submit', (payload) => {
          const val = typeof payload === 'string' ? payload : String((payload as Record<string, V> | undefined)?.value ?? (ref ? inst.get(ref) : ''));
          if (ref && typeof payload === 'string') this.setCell(inst, ref, val);
          if (n.on?.submit) this.runActions(n.on.submit, env.child({ submit: rec([['value', val]]) }), inst);
        });
        return v;
      }
      case 'overlay': {
        const p = this.props(n, env, inst);
        const id = typeof n.meta?.id === 'string' ? n.meta.id : key;
        const open = inst.overlays.get(id) ?? false;
        const v: VNode = { t: 'overlay', key, p: { ...p, open }, kids: kids(), ev: ['open', 'close'] };
        if (open) v.body = this.renderNodes(n.fills?.body ?? [], env, inst, `${key}.body`);
        this.on(key, 'open', () => {
          inst.overlays.set(id, true);
          if (n.on?.open) this.runActions(n.on.open, env, inst);
        });
        this.on(key, 'close', () => {
          inst.overlays.set(id, false);
          if (n.on?.close) this.runActions(n.on.close, env, inst);
        });
        return v;
      }
      case 'canvas':
        return this.canvas(n, env, inst, key);
      case 'frame': {
        const p = this.props(n, env, inst);
        const slot = (nm: string): VNode[] => this.renderNodes(n.fills?.[nm] ?? [], env, inst, `${key}.${nm}`);
        const v: VNode = {
          t: 'frame',
          key,
          p: { kind: String(p.kind ?? ''), title: this.runs(String(p.title ?? '')), height: p.height ?? 'none', tone: p.tone ?? 'none', statuslines: Math.max(1, Math.min(3, Math.round(Number(p.statuslines ?? 1)))) },
          kids: kids(),
          slots: { actions: slot('actions'), bar: slot('bar'), about: slot('about'), details: slot('details') },
        };
        if (p.status) v.p.status = this.runs(String(p.status));
        this.placeStatus(v);
        return v;
      }
      case 'pane': {
        const p = this.props(n, env, inst);
        return { t: 'pane', key, p: { title: this.runs(String(p.title ?? '')), note: this.runs(String(p.note ?? '')) }, kids: kids(), slots: { footer: this.renderNodes(n.fills?.footer ?? [], env, inst, `${key}.footer`) } };
      }
      case 'icon': {
        const p = this.props(n, env, inst);
        // name=none: no icon, so a widget can leave one out by data (graph's items)
        return p.name === 'none' ? null : { t: 'icon', key, p, kids: kids() };
      }
      default:
        // an extern the host implements (a pack's, or a transitional base one): its props and what it
        // holds, drawn, and its id, for a host's component chosen by id
        {
          const v: VNode = { t: n.node, key, p: this.props(n, env, inst), kids: kids(), ...(n.def && !n.def.startsWith('core:') ? { ext: n.def } : {}) };
          // its outs, written on the use (@toggled …), run when the host reports them
          this.wire(n, v, env, inst);
          return v;
        }
    }
  }

  private canvas(n: IRNode, env: Env, inst: Inst, key: string): VNode {
    const p = this.props(n, env, inst);
    const layers: VLayer[] = [];
    // a provider declares gfx@1 when it has it; otherwise gfx shapes show their fallback (8.1)
    const gfx = (this.opts.capabilities ?? ['core@1']).includes('gfx@1');
    const visitLayers = (rs: IRNode[], e: Env, k: string): void => {
      rs.forEach((r, i) => {
        const lk = `${k}/${i}`;
        if (r.node === 'each') {
          for (const it of this.eachItems(r, e, inst)) visitLayers([...(r.records ?? []), ...(r.children ?? [])], it.env, `${lk}[${it.key}]`);
          return;
        }
        if (r.node === 'switch') {
          const picked = this.switchPick(r, e, inst);
          if (picked) visitLayers(picked, e, `${lk}:s`);
          return;
        }
        if (r.node !== '$record' || r.record !== 'layer') return;
        if (r.meta?.if && !this.evalExpr(r.meta.if, e, inst)) return;
        const lp = this.props(r, e, inst);
        const shapes: VShape[] = [];
        this.shapes(r.records ?? [], e, inst, lk, shapes, gfx, p);
        const layer: VLayer = { key: lk, opacity: (lp.opacity as number) ?? 1, shapes };
        // clip=[corner, corner]: the shapes are cut off outside that rectangle (a plot inside its axes' margins)
        const corners = ((lp.clip as number[][] | undefined) ?? []).filter((q) => Number.isFinite(q[0]) && Number.isFinite(q[1]));
        if (corners.length >= 2) {
          const [a, b] = corners;
          layer.clip = [Math.min(a[0], b[0]), Math.min(a[1], b[1]), Math.max(a[0], b[0]), Math.max(a[1], b[1])];
        }
        if (typeof r.meta?.id === 'string') inst.ids.set(r.meta.id, lk);
        layers.push(layer);
      });
    };
    visitLayers(n.records ?? [], env, key);
    const v: VNode = { t: 'canvas', key, p, layers };
    return v;
  }

  private shapes(rs: IRNode[], env: Env, inst: Inst, key: string, out: VShape[], gfx: boolean, canvasProps: Record<string, V>): void {
    rs.forEach((r, i) => {
      const k = `${key}/${i}`;
      if (r.node === 'each') {
        for (const it of this.eachItems(r, env, inst)) this.shapes([...(r.records ?? []), ...(r.children ?? [])], it.env, inst, `${k}[${it.key}]`, out, gfx, canvasProps);
        return;
      }
      if (r.node === 'switch') {
        const picked = this.switchPick(r, env, inst);
        if (picked) this.shapes(picked, env, inst, `${k}:s`, out, gfx, canvasProps);
        return;
      }
      if (r.node !== '$record') return;
      if (r.meta?.if && !this.evalExpr(r.meta.if, env, inst)) return;
      const p = this.props(r, env, inst);
      const pt = (x: V): number[] => x as number[];
      let s: VShape | null = null;
      const opacity = typeof p.opacity === 'number' && p.opacity < 1 ? { opacity: Math.max(0, p.opacity) } : {};
      switch (r.record) {
        case 'circle':
          s = { t: 'circle', key: k, c: pt(p.c), r: p.r as number, ...(p.px ? { px: p.px as number } : {}), fill: String(p.fill), stroke: String(p.stroke), width: p.width as number, ...opacity, ...(p.label ? { label: String(p.label) } : {}) };
          break;
        case 'path': {
          // points that aren't finite (a function's pole) break the path rather than draw to infinity
          const pts = (p.pts as number[][]).filter((q) => Number.isFinite(q[0]) && Number.isFinite(q[1]));
          s = { t: 'path', key: k, pts, closed: !!p.closed, fill: String(p.fill), stroke: String(p.stroke), width: p.width as number, dash: !!p.dash, ...(p.head && p.head !== 'none' ? { head: p.head as 'arrow' | 'dot' } : {}), ...opacity, ...(p.label ? { label: String(p.label) } : {}) };
          break;
        }
        case 'label':
          s = {
            t: 'label',
            key: k,
            at: pt(p.at),
            runs: this.runs(String(p.text)),
            tone: String(p.tone),
            anchor: String(p.anchor),
            ...(p.chip ? { chip: true } : {}),
            ...(p.size && p.size !== 'normal' ? { size: p.size as 'small' | 'large' } : {}),
            ...(p.halo ? { halo: true } : {}),
            ...(p.dx ? { dx: p.dx as number } : {}),
            ...(p.dy ? { dy: p.dy as number } : {}),
            ...opacity,
          };
          break;
        case 'image':
          s = { t: 'image', key: k, src: String(p.src), at: pt(p.at), w: p.w as number, h: p.h as number, alt: String(p.alt) };
          break;
        case 'place':
          s = { t: 'place', key: k, at: pt(p.at), kids: this.renderNodes(r.children ?? [], env, inst, k) };
          break;
        case 'handle': {
          const ref = (r.props?.p as { ref?: string } | undefined)?.ref;
          const st = ref ? this.stateFor(inst, ref) : undefined;
          const xr = st ? this.rangeOf(st.state.args.x, st.inst.env, st.inst) : [-1, 1];
          const yr = st ? this.rangeOf(st.state.args.y, st.inst.env, st.inst) : [-1, 1];
          s = { t: 'handle', key: k, at: pt(p.p), tone: String(p.tone), label: st?.state.label ?? ref ?? 'point', x: xr, y: yr };
          if (ref) {
            const owner = inst;
            this.on(k, 'drag', (payload) => {
              const q = payload as number[];
              const clamped = [Math.min(xr[1], Math.max(xr[0], q[0])), Math.min(yr[1], Math.max(yr[0], q[1]))];
              this.setCell(owner, ref, clamped);
            });
          }
          if (typeof r.meta?.id === 'string') inst.ids.set(r.meta.id, k);
          break;
        }
        case 'pixels': {
          const fexpr = r.props?.f as IRExpr;
          const compiled = compilePixels(fexpr, this.bundle, (name) => inst.get(name), env, (name) => this.lambdaInput(inst, name), inst.fns);
          const xr = (canvasProps.x as number[]) ?? [-1, 1];
          const yr = (canvasProps.y as number[]) ?? [-1, 1];
          // the same expression reading the same values over the same ranges draws the same image: the
          // shape from last time is kept as it was (a renderer sees nothing changed), and a fallback
          // image is never computed again (GAPS: a heat map recomputes only when what it reads moves)
          const sig = `${compiled.glsl}|${JSON.stringify(compiled.uniforms)}|${xr}|${yr}|${p.res}|${gfx ? 1 : 0}`;
          const last = this.pixelsLast.get(k);
          if (last && last.sig === sig) s = last.shape;
          else {
            const fallback = gfx ? undefined : compiled.fallback?.(xr, yr);
            s = { t: 'pixels', key: k, glsl: compiled.glsl, sksl: compiled.sksl, uniforms: compiled.uniforms, res: p.res as number, fallback };
            if (this.pixelsLast.size > 200) this.pixelsLast.clear();
            this.pixelsLast.set(k, { sig, shape: s });
          }
          break;
        }
        case 'mesh': {
          const f = p.f as Fun;
          const nn = p.n as number;
          const xr = (canvasProps.x as number[]) ?? [-1, 1];
          const yr = (canvasProps.y as number[]) ?? [-1, 1];
          const z = withBudget(inst.budget, `${inst.label()} mesh`, () => sampleMesh(f, xr, yr, nn));
          s = { t: 'mesh', key: k, z, n: nn, fill: String(p.fill) };
          break;
        }
      }
      if (s) {
        // a circle's or path's own @enter, @leave and @click, run in the scope it was written in
        if (r.on && (s.t === 'circle' || s.t === 'path')) this.wire(r, s, env, inst);
        out.push(s);
      }
    });
  }

  /** An expr(…) input's lambda, with the caller's scope for its other names (for pixels). */
  private lambdaInput(inst: Inst, name: string): { params: string[]; body: A; lookup: (name: string, local: boolean) => V } | null {
    const given = inst.use?.props?.[name];
    const decl = inst.def.inputs.find((x) => x.name === name);
    const val = given ?? decl?.default;
    if (!val || !('ast' in val) || val.ast.t !== 'lam') return null;
    const scopeEnv = given ? inst.callerEnv ?? inst.env : inst.env;
    const scopeInst = given ? inst.caller ?? inst : inst;
    return {
      params: val.ast.params,
      body: val.ast.body,
      lookup: (n, local) => (local ? scopeEnv.local(n) : n.includes(':') ? this.prog.constValue(n) : scopeInst.get(n)),
    };
  }

  private stateFor(inst: Inst, name: string): { inst: Inst; state: IRState } | undefined {
    const st = inst.states.get(name);
    if (st) return { inst, state: st };
    const b = inst.inputs.get(name);
    if (b && b.k === 'ref' && inst.caller && inst.use?.props?.[name] && 'ref' in inst.use.props[name]) return this.stateFor(inst.caller, (inst.use.props[name] as { ref: string }).ref);
    return undefined;
  }

  // -------------------------------------------------------------------------------------------
  // The control bar (6.6): built from base widgets

  /** A frame's status line goes in its bar: after a steps control's buttons, or else first (6.8). */
  private placeStatus(f: VNode): void {
    const k = `${f.key}.status`;
    const strip = (ns: VNode[]): VNode[] => ns.filter((x) => x.key !== k);
    const bar = strip(f.slots?.bar ?? []).map((x) => (x.p.control === 'steps' ? { ...x, kids: strip(x.kids ?? []) } : x));
    f.slots = { ...f.slots, bar };
    const runs = f.p.status as VRun[] | undefined;
    if (!runs?.length) return;
    // one line that never wraps, or room kept for up to three, so the bar is as tall whatever it says
    const lines = Number(f.p.statuslines ?? 1);
    const status: VNode = { t: 'text', key: k, p: { runs, tone: 'ink', font: 'body', weight: 'regular', size: 'body', align: 'start', wrap: lines > 1, role: 'status', ...(lines > 1 ? { lines } : {}) }, layout: { grow: true } };
    const steps = bar.find((x) => x.p.control === 'steps');
    if (!steps) {
      bar.unshift(status);
      return;
    }
    const kids = steps.kids!;
    kids.splice(kids.findIndex((x) => x.key.endsWith('.next')) + 1, 0, status);
    steps.layout = { ...steps.layout, grow: true };
  }

  private bar(inst: Inst, path: string): VNode | null {
    const placed = new Set<string>();
    const findPlaced = (ns: IRNode[]): void => {
      for (const n of ns) {
        if (n.node === 'controls') n.names?.forEach((x) => placed.add(x));
        if (n.children) findPlaced(n.children);
        if (n.records) findPlaced(n.records);
        for (const c of n.cases ?? []) findPlaced(c.children);
        if (n.else) findPlaced(n.else);
        for (const f of Object.values(n.fills ?? {})) findPlaced(f);
      }
    };
    findPlaced(inst.use?.inst?.view ?? inst.def.view ?? []);
    if (inst === this.root) findPlaced(this.bundle.doc.body);
    const kids: VNode[] = [];
    for (const s of inst.states.values()) {
      if (s.control === 'drag' || placed.has(s.name)) continue;
      const c = this.control(inst, s.name, `${path}.bar`);
      if (c) kids.push(c);
    }
    if (!kids.length) return null;
    return { t: 'bar', key: `${path}.bar`, p: {}, kids };
  }

  control(inst: Inst, name: string, path: string): VNode | null {
    const s = inst.states.get(name);
    if (!s) return null;
    const key = `${path}.${name}`;
    const cell = inst.cells.get(name)!;
    const value = cell.get();
    const label = s.label ?? name;
    const env = inst.env;
    // a glyph inside a press takes tone none: it is the press's own colour (white on a high press)
    const text = (k: string, t: string, tone = 'ink'): VNode => ({ t: 'text', key: k, p: { runs: this.runs(t), tone, font: 'body', weight: 'regular', size: 'small', align: 'start', wrap: true } });
    const press = (k: string, id: string, lbl: string, kids: VNode[], f: () => void, extra: Record<string, unknown> = {}): VNode => {
      inst.ids.set(id, k);
      this.on(k, 'click', () => f());
      return { t: 'press', key: k, id, p: { kind: 'button', selected: false, disabled: false, label: lbl, tone: 'none', ...extra }, kids, ev: ['click'] };
    };
    switch (s.control) {
      case 'slider': {
        const [min, max] = [this.valueOf(s.args.min, env, inst) as number, this.valueOf(s.args.max, env, inst) as number];
        const step = s.args.step ? (this.valueOf(s.args.step, env, inst) as number) : 0;
        const kids: VNode[] = [];
        if (s.play) {
          const playing = inst.playing.has(name);
          kids.push(press(`${key}.play`, `${name}.play`, playing ? `pause ${label}` : `play ${label}`, [text(`${key}.play.t`, playing ? '⏸' : '▶', 'none')], () => (playing ? this.pause(inst, name) : this.play(inst, name)), { kind: 'toggle', selected: playing }));
        }
        kids.push(text(`${key}.label`, label, 'muted'));
        inst.ids.set(name, key);
        kids.push({ t: 'range', key: `${key}.range`, p: { value, min, max, step, label }, ev: ['change'] });
        this.on(`${key}.range`, 'change', (payload) => {
          const v = typeof payload === 'number' ? payload : ((payload as Record<string, V>)?.value as number);
          this.setCell(inst, name, quantize(v, min, max, step));
        });
        kids.push(text(`${key}.value`, fmtNum(value as number)));
        return { t: 'row', key, id: name, p: { gap: 's', align: 'center', justify: 'start', wrap: true, pad: 'none', fill: 'none', stroke: 'none', radius: 'none', shadow: 'none', role: 'control', label }, kids };
      }
      case 'toggle':
        return press(key, name, label, [text(`${key}.t`, label)], () => this.setCell(inst, name, !value), { kind: 'toggle', selected: !!value });
      case 'choice': {
        const opts = ((s.args.opts as { lit: string[] }).lit ?? []) as string[];
        const kids: VNode[] = [text(`${key}.label`, label, 'muted')];
        for (const o of opts) kids.push(press(`${key}.${o}`, `${name}.${o}`, o, [text(`${key}.${o}.t`, o, 'none')], () => this.setCell(inst, name, o), { kind: 'option', selected: value === o }));
        inst.ids.set(name, key);
        return { t: 'row', key, id: name, p: { gap: 'xs', align: 'center', justify: 'start', wrap: true, pad: 'none', fill: 'none', stroke: 'none', radius: 'none', shadow: 'none', role: 'radiogroup', label }, kids };
      }
      case 'steps': {
        const n = this.valueOf(s.args.n, env, inst) as number;
        const at = value as number;
        const none = !!(s.args.none && 'lit' in s.args.none && s.args.none.lit);
        const go = (to: number): void => this.setCell(inst, name, Math.max(none ? -1 : 0, Math.min(n - 1, to)));
        // back, play, next; a track once there are enough steps to need one; where it is; start over.
        // Every part keeps its width, so nothing moves as it plays.
        const kids: VNode[] = [press(`${key}.prev`, `${name}.prev`, `previous: ${label}`, [text(`${key}.prev.t`, '‹', 'none')], () => go(Math.max(0, at - 1)), { disabled: at <= 0, emphasis: 'low' })];
        if (s.play) {
          const playing = inst.playing.has(name);
          kids.push(press(`${key}.play`, `${name}.play`, playing ? `pause ${label}` : `play ${label}`, [text(`${key}.play.t`, playing ? '⏸' : '▶', 'none')], () => (playing ? this.pause(inst, name) : this.play(inst, name)), { kind: 'toggle', selected: playing, emphasis: 'high' }));
        }
        kids.push(press(`${key}.next`, `${name}.next`, `next: ${label}`, [text(`${key}.next.t`, '›', 'none')], () => go(at + 1), { disabled: at >= n - 1, emphasis: 'low' }));
        // a track only where the widget asks for one (GAPS 124)
        if (s.args.track && 'lit' in s.args.track && s.args.track.lit) {
          kids.push({ t: 'range', key: `${key}.range`, p: { value: Math.max(0, at), min: 0, max: n - 1, step: 1, label }, ev: ['change'] });
          this.on(`${key}.range`, 'change', (payload) => go(Math.round(typeof payload === 'number' ? payload : ((payload as Record<string, V>)?.value as number))));
        }
        const count = text(`${key}.at`, `${at < 0 ? '—' : at + 1}/${n}`, 'muted');
        count.p.font = 'mono';
        kids.push(count);
        kids.push(press(`${key}.reset`, `${name}.reset`, `start over: ${label}`, [text(`${key}.reset.t`, '↺', 'none')], () => go(none ? -1 : 0), { disabled: at <= (none ? -1 : 0), emphasis: 'low' }));
        inst.ids.set(name, key);
        return { t: 'row', key, id: name, p: { gap: 's', align: 'center', justify: 'start', wrap: false, pad: 'none', fill: 'none', stroke: 'none', radius: 'none', shadow: 'none', role: 'group', label, control: 'steps' }, kids };
      }
      case 'clock': {
        const playing = inst.playing.has(name);
        const secs = Math.floor(value as number);
        const shown = `${Math.floor(secs / 60)}:${String(secs % 60).padStart(2, '0')}`;
        const time = text(`${key}.time`, shown, 'muted');
        time.p.font = 'mono';
        inst.ids.set(name, key);
        return {
          t: 'row',
          key,
          id: name,
          p: { gap: 's', align: 'center', justify: 'start', wrap: false, pad: 'none', fill: 'none', stroke: 'none', radius: 'none', shadow: 'none', role: 'group', label, control: 'clock' },
          kids: [press(`${key}.play`, `${name}.play`, playing ? `pause ${label}` : `resume ${label}`, [text(`${key}.play.t`, playing ? '⏸' : '▶', 'none')], () => (playing ? this.pause(inst, name) : this.play(inst, name)), { kind: 'toggle', selected: playing, emphasis: 'low' }), time],
        };
      }
      default:
        return null;
    }
  }

  // -------------------------------------------------------------------------------------------
  // State changes, play, actions

  setCell(inst: Inst, name: string, v: V): void {
    const c = inst.cellOf(name);
    if (!c) return;
    if (typeof v === 'number' && Number.isInteger(c.value) && this.isIntState(inst, name)) v = Math.round(v);
    if (c.set(v)) {
      // a ref writes the caller's state: its change events fire there
      const owner = inst.cells.has(name) ? { inst, name } : this.ownerOfRef(inst, name);
      if (owner) this.stateChanged(owner.inst, owner.name);
    }
  }

  private isIntState(inst: Inst, name: string): boolean {
    const owner = inst.cells.has(name) ? { inst, name } : this.ownerOfRef(inst, name);
    if (!owner) return false;
    const s = owner.inst.states.get(owner.name);
    const decl = s ? s.type : ((owner.inst.def.values ?? []).find((x) => x.name === owner.name && x.k === 'var') as { type?: Type } | undefined)?.type;
    return !!decl && this.resolveType(decl).t === 'int';
  }

  private ownerOfRef(inst: Inst, name: string): { inst: Inst; name: string } | null {
    const given = inst.use?.props?.[name];
    if (given && 'ref' in given && inst.caller) {
      const n2 = (given as { ref: string }).ref;
      if (inst.caller.cells.has(n2)) return { inst: inst.caller, name: n2 };
      return this.ownerOfRef(inst.caller, n2);
    }
    return null;
  }

  private stateChanged(inst: Inst, name: string): void {
    const s = inst.states.get(name);
    if (!s) return;
    const v = inst.cells.get(name)!.value;
    if (s.on?.change) this.runActions(s.on.change, inst.env.child({ change: rec([['value', v]]) }), inst);
    if (s.on?.end && this.atEnd(inst, s, v)) this.runActions(s.on.end, inst.env, inst);
  }

  private atEnd(inst: Inst, s: IRState, v: V): boolean {
    if (s.control === 'steps') return (v as number) >= (this.valueOf(s.args.n, inst.env, inst) as number) - 1;
    if (s.control === 'slider') return (v as number) >= (this.valueOf(s.args.max, inst.env, inst) as number);
    return false;
  }

  play(inst: Inst, name: string): void {
    const s = inst.states.get(name);
    if (s?.control === 'clock') {
      if (!inst.playing.has(name)) inst.playing.set(name, { dir: 1, acc: 0 });
      return;
    }
    if (!s || (s.control !== 'slider' && s.control !== 'steps')) return;
    const c = inst.cells.get(name)!;
    if (this.atEnd(inst, s, c.value) && (s.loop ?? 'once') === 'once') {
      c.set(s.control === 'slider' ? (this.valueOf(s.args.min, inst.env, inst) as number) : 0);
    }
    inst.playing.set(name, { dir: 1, acc: 0 });
  }

  pause(inst: Inst, name: string): void {
    inst.playing.delete(name);
  }

  private advance(inst: Inst, name: string, ps: PlayState, ms: number): void {
    const s = inst.states.get(name)!;
    const c = inst.cells.get(name)!;
    const dur = s.play ?? 4000;
    const loop = s.loop ?? 'once';
    if (s.control === 'clock') {
      ps.acc += ms;
      // whole hundredths, so a clock read every frame doesn't redraw for nothing
      if (ps.acc < 100) return;
      const v = Math.round(((c.value as number) + ps.acc / 1000) * 10) / 10;
      ps.acc = 0;
      if (c.set(v)) this.stateChanged(inst, name);
      return;
    }
    if (s.control === 'steps') {
      const n = this.valueOf(s.args.n, inst.env, inst) as number;
      ps.acc += ms;
      const every = s.playPer ? dur : dur / Math.max(1, n);
      while (ps.acc >= every) {
        ps.acc -= every;
        let v = (c.value as number) + 1;
        if (v > n - 1) {
          if (loop === 'once') {
            inst.playing.delete(name);
            return;
          }
          v = 0;
        }
        if (c.set(v)) this.stateChanged(inst, name);
      }
      return;
    }
    const min = this.valueOf(s.args.min, inst.env, inst) as number;
    const max = this.valueOf(s.args.max, inst.env, inst) as number;
    const step = s.args.step ? (this.valueOf(s.args.step, inst.env, inst) as number) : 0;
    const span = max - min;
    // under reduced motion, play moves in jumps of a tenth of the range (or one step)
    const jump = this.opts.reducedMotion ? Math.max(step, span / 10) : 0;
    // play=1s/step: each step takes that long, however many there are (GAPS 156)
    const total = s.playPer ? dur * (step > 0 ? span / step : 10) : dur;
    ps.acc += (ms / total) * span * ps.dir;
    let delta = ps.acc;
    if (jump) {
      if (Math.abs(ps.acc) < jump) return;
      delta = Math.trunc(ps.acc / jump) * jump;
    } else if (step && Math.abs(ps.acc) < step) return;
    else if (step) delta = Math.trunc(ps.acc / step) * step;
    ps.acc -= delta;
    let v = (c.value as number) + delta;
    let ended = false;
    if (v >= max) {
      if (loop === 'repeat') v = min + (v - max);
      else if (loop === 'bounce') {
        v = max - (v - max);
        ps.dir = -1;
      } else {
        v = max;
        ended = true;
      }
    } else if (v <= min && ps.dir < 0) {
      v = min + (min - v);
      ps.dir = 1;
    }
    v = quantize(v, min, max, step);
    if (c.set(v)) this.stateChanged(inst, name);
    if (ended) inst.playing.delete(name);
  }

  runActions(actions: IRAction[], env: Env, inst: Inst): void {
    for (const a of actions) {
      try {
        this.action(a, env, inst);
      } catch (e) {
        if (!(e instanceof EvalError)) throw e;
        inst.error = { code: e.code, message: e.message };
        return;
      }
    }
  }

  private action(a: IRAction, env: Env, inst: Inst): void {
    switch (a.a) {
      case 'set': {
        const v = this.evalExpr(a.value, env, inst);
        this.setCell(inst, a.name, v);
        break;
      }
      case 'play':
        this.play(inst, a.name);
        break;
      case 'pause':
        this.pause(inst, a.name);
        break;
      case 'reset': {
        const names = a.names.length ? a.names : [...inst.cells.keys()];
        for (const nm of names) {
          const s = inst.states.get(nm);
          const vdecl = (inst.def.values ?? []).find((x) => x.name === nm);
          const def = s ? this.stateDefault(inst, s) : vdecl && (vdecl.k === 'var' || vdecl.k === 'host') ? this.valueOf(vdecl.default, inst.env, inst) : undefined;
          if (def !== undefined) this.setCell(inst, nm, def);
          // a clock starts again from 0; anything else stops
          if (s?.control === 'clock') inst.playing.set(nm, { dir: 1, acc: 0 });
          else inst.playing.delete(nm);
        }
        break;
      }
      case 'reveal':
      case 'hide': {
        const id = typeof a.id === 'string' ? a.id : String(this.evalExpr(a.id, env, inst));
        if (!inst.ids.has(id) && typeof a.id !== 'string') this.warn('mkp.action-target', `${a.a} did nothing, since it names an element by id; found no element with id ${id} in ${inst.label()} (the id was worked out when it ran). Give an element id=${id}, or correct the expression that makes the id`);
        inst.revealed.set(id, a.a === 'reveal');
        break;
      }
      case 'open':
      case 'close': {
        const id = typeof a.id === 'string' ? a.id : String(this.evalExpr(a.id, env, inst));
        inst.overlays.set(id, a.a === 'open');
        break;
      }
      case 'emit': {
        const payload = rec(a.payload.map(([k, e]) => [k, this.evalExpr(e, env, inst)]));
        const handlers = inst.use?.on?.[a.name];
        if (handlers && inst.caller && inst.callerEnv) {
          const e2 = a.payload.length ? inst.callerEnv.child({ [a.name]: payload }) : inst.callerEnv;
          this.runActions(handlers, e2, inst.caller);
        }
        break;
      }
      case 'send': {
        const payload = Object.fromEntries(a.payload.map(([k, e]) => [k, toJson(this.evalExpr(e, env, inst))]));
        this.emitSignal(inst, a.name, payload);
        break;
      }
      case 'when':
        if (this.evalExpr(a.cond, env, inst)) for (const x of a.actions) this.action(x, env, inst);
        break;
    }
  }

  emitSignal(inst: Inst, name: string, payload: unknown): void {
    const now = this.opts.now ? this.opts.now() : Date.now();
    // rate limit: at most 30 signals per second per runtime; payloads capped at 16 KB
    this.signalTimes = this.signalTimes.filter((t) => now - t < 1000);
    if (this.signalTimes.length >= 30) {
      this.warn('mkp.signal-rate', `signal ${name} was dropped: a page may send at most 30 signals a second; found more than 30 in the last second. Send it less often, e.g. on a press rather than on every change`);
      return;
    }
    if (JSON.stringify(payload).length > 16384) {
      this.warn('mkp.signal-size', `signal ${name} was dropped: a signal's payload may be at most 16 KB; found ${(JSON.stringify(payload).length / 1024).toFixed(1)} KB. Send less, e.g. an id or a count instead of whole records`);
      return;
    }
    this.signalTimes.push(now);
    let top = inst;
    while (top.caller && top.caller !== this.root) top = top.caller;
    const e: SignalEvent = { document: this.bundle.doc.file, block: top.block ?? 0, widget: `${inst.def.name}@${inst.def.version}`, name, payload, time: now };
    this.signals.push(e);
    if (this.signals.length > 500) this.signals.shift();
    this.opts.onSignal?.(e);
  }

  command(inst: Inst, name: string, args: unknown): void {
    const c = inst.def.commands?.find((x) => x.name === name);
    if (!c) {
      const have = (inst.def.commands ?? []).map((x) => x.name);
      throw new Error(`${inst.label()} has no command ${name}; found ${have.length ? `the commands ${have.join(', ')}` : 'no commands'}. Send one of those${have.length ? '' : ', or declare the command in the definition'}`);
    }
    if (c.payload) {
      const err = checkValue(args ?? {}, c.payload, (n) => findType(this.bundle, n));
      if (err) throw new Error(`the arguments of command ${name} of ${inst.label()} have the wrong shape (${err}). Send them as ${showType(c.payload)}`);
    }
    const fields = c.payload && args && typeof args === 'object' ? Object.fromEntries(Object.entries(args as Record<string, unknown>).map(([k, v]) => [k, fromJson(v)])) : {};
    this.runActions(c.actions, inst.env.child(fields), inst);
    this.changed();
  }

  setHost(inst: Inst, name: string, value: unknown): void {
    const h = (inst.def.values ?? []).find((v) => v.k === 'host' && v.name === name);
    if (!h || h.k !== 'host') {
      const have = (inst.def.values ?? []).filter((v) => v.k === 'host').map((v) => v.name);
      throw new Error(`${inst.label()} has no host input ${name}; found ${have.length ? `the host inputs ${have.join(', ')}` : 'no host inputs'}. Set one of those${have.length ? '' : ', or declare it in the definition (host name type = default)'}`);
    }
    const err = checkValue(value, h.type, (n) => findType(this.bundle, n));
    if (err) throw new Error(`the value for host input ${name} of ${inst.label()} has the wrong type (${err}). Send a value of type ${showType(h.type)}`);
    const size = JSON.stringify(value).length;
    if (size > 65536) throw new Error(`a host input's value may be at most 64 KB; found ${(size / 1024).toFixed(1)} KB for host input ${name} of ${inst.label()}. Send a smaller value, e.g. fewer items`);
    inst.cells.get(name)!.set(fromJson(value));
    this.changed();
  }
}

export class WidgetHandle {
  constructor(
    readonly rt: Runtime,
    readonly inst: Inst,
  ) {}
  command(name: string, args?: unknown): void {
    this.rt.command(this.inst, name, args);
  }
  host(name: string, value: unknown): void {
    this.rt.setHost(this.inst, name, value);
  }
  on(signal: string, f: (payload: unknown) => void): () => void {
    const prev = this.rt.opts.onSignal;
    const inst = this.inst;
    const handler = (e: SignalEvent): void => {
      prev?.(e);
      if (e.name === signal && e.block === (inst.block ?? 0)) f(e.payload);
    };
    (this.rt.opts as RuntimeOptions).onSignal = handler;
    return () => {
      (this.rt.opts as RuntimeOptions).onSignal = prev;
    };
  }
  state(): Record<string, unknown> {
    return this.rt.snapshot()[this.inst.path] ?? {};
  }
}

function quantize(v: number, min: number, max: number, step: number): number {
  let x = Math.min(max, Math.max(min, v));
  if (step > 0) x = min + Math.round((x - min) / step) * step;
  return Number(x.toPrecision(12));
}

function toKey(v: V): string | number {
  if (typeof v === 'string' || typeof v === 'number') return v;
  return JSON.stringify(toJson(v));
}

/**
 * Footnotes are numbered by the order of their first reference, as GitHub numbers them (GAPS 34):
 * each reference run and each footnote gets n.
 */
function numberFootnotes(tree: VNode[]): void {
  const order = new Map<string, number>();
  const runs = (rs: unknown): void => {
    if (!Array.isArray(rs)) return;
    for (const r of rs as VRun[]) {
      if (r.t !== 'fnref') continue;
      if (!order.has(r.label)) order.set(r.label, order.size + 1);
      r.n = order.get(r.label);
    }
  };
  const visit = (ns: VNode[] | undefined): void => {
    for (const n of ns ?? []) {
      runs(n.p.runs);
      runs(n.p.title);
      if (Array.isArray(n.p.rows)) for (const row of n.p.rows as unknown[][]) for (const c of row) runs(c);
      if (Array.isArray(n.p.head)) for (const c of n.p.head as unknown[]) runs(c);
      visit(n.kids);
      for (const s of Object.values(n.slots ?? {})) visit(s);
      visit(n.body);
    }
  };
  visit(tree);
  let next = order.size + 1;
  const notes = (ns: VNode[] | undefined): void => {
    for (const n of ns ?? []) {
      if (n.t === 'footnote') n.p.n = order.get(String(n.p.label)) ?? next++;
      notes(n.kids);
    }
  };
  notes(tree);
}

/** Whether two scopes bind the same values (each makes a new scope per item on every render). */
function sameScope(a: Env | null, b: Env | null): boolean {
  while (a && b) {
    if (a === b) return true;
    if (a.inst !== b.inst || !!a.vars !== !!b.vars) return false;
    if (a.vars && b.vars) {
      const ka = Object.keys(a.vars);
      if (ka.length !== Object.keys(b.vars).length || ka.some((k) => !deepEqual(a!.vars![k], b!.vars![k]))) return false;
    }
    a = a.parent;
    b = b.parent;
  }
  return a === b;
}

export function findType(b: IRBundle, name: string): Type | undefined {
  if (b.types[name]) return b.types[name];
  for (const [k, t] of Object.entries(b.types)) if (k.endsWith(`:${name}`)) return t;
  return undefined;
}

/** Validates plain data against a type (host inputs, command args, signal payloads). */
export function checkValue(v: unknown, t: Type, env: (n: string) => Type | undefined, depth = 0): string | null {
  if (depth > 32) return 'nested too deeply';
  const r = resolve(t, env);
  switch (r.t) {
    case 'num':
      return typeof v === 'number' ? null : `expected a number, found ${JSON.stringify(v)}`;
    case 'int':
      return typeof v === 'number' && Number.isInteger(v) ? null : `expected a whole number, found ${JSON.stringify(v)}`;
    case 'bool':
      return typeof v === 'boolean' ? null : 'expected true or false';
    case 'text':
    case 'latex':
      return typeof v === 'string' ? null : 'expected text';
    case 'choice':
      return typeof v === 'string' && r.opts.includes(v) ? null : `expected one of ${r.opts.join(', ')}`;
    case 'point':
      return Array.isArray(v) && v.length === 2 && v.every((x) => typeof x === 'number') ? null : 'expected a point [x, y]';
    case 'list':
      if (!Array.isArray(v)) return 'expected a list';
      if (v.length > EVAL_LIMITS.list) return 'the list is too long';
      for (const x of v) {
        const e = checkValue(x, r.of, env, depth + 1);
        if (e) return e;
      }
      return null;
    case 'dict':
      if (!v || typeof v !== 'object' || Array.isArray(v)) return 'expected a mapping';
      for (const x of Object.values(v)) {
        const e = checkValue(x, r.of, env, depth + 1);
        if (e) return e;
      }
      return null;
    case 'rec':
      if (!v || typeof v !== 'object' || Array.isArray(v)) return 'expected a record';
      for (const [k, ft] of r.fields) {
        if (!(k in (v as object))) return `missing field ${k}`;
        const e = checkValue((v as Record<string, unknown>)[k], ft, env, depth + 1);
        if (e) return `${k}: ${e}`;
      }
      for (const k of Object.keys(v)) if (!r.fields.some((f) => f[0] === k)) return `unknown field ${k}`;
      return null;
    default:
      return null;
  }
}
