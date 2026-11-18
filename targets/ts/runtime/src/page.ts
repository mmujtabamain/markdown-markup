// A page running: the lowered IR mounted, redrawn after every change, with every change made
// through a transaction that is checked and undone when it fails (page 6, plan tab 11).
//
// No DOM: a page is drawn by whoever reads its tree (@mkp/dom on the web, the test target in
// checks). Each widget is identified by its path: the sites of the template instances it belongs
// to, each loop row as [position], then its own site.

import type * as ir from "./generated/ir.js";
import { Constants, Failure, Machine, Num, Program, type Binding, type Host, type Outer } from "./eval/index.js";
import { Value, caseOf, none, toIr, type Value as V } from "./eval/value.js";

/** What the app tells the page about where it is read. */
export interface PageValues {
  width?: "NARROW" | "MEDIUM" | "WIDE";
  theme?: "LIGHT" | "DARK";
}

/** How a page is mounted: what the app and the target give it. */
export interface PageOptions {
  page?: PageValues;
  /** `$state`'s values, in the IR's form, over its starting ones. */
  state?: Record<string, ir.Expr>;
  /** Each channel's values, in the IR's form. */
  externs?: Record<string, Record<string, ir.Expr>>;
  /** The value fns the target supplies, by full name. */
  fns?: Record<string, (args: readonly V[]) => V | null>;
  /** Whether the target draws an extern widget, by full name. One it doesn't shows its Markdown
   * instead (page 6), and is reported in `missing()`. Left out, every one is drawn. */
  supplies?: (widget: string) => boolean;
  /** For the test target only: defects to switch on. */
  defects?: string[];
  /** Reuse a widget's drawn subtree when nothing it read has changed (on by default). Off
   * draws every widget anew on every change, for comparing the two. */
  memo?: boolean;
}

/** Where a node's values are read: its widget instance, the locals around it, its path as
 * observed (loop rows by position) and its identity (loop rows by their item). */
export interface Env {
  owner: number | undefined;
  bindings: [string, Binding][];
  path: string;
  key?: string;
}

/** A drawn extern widget, as the page asks a target to draw it. */
export interface Drawn {
  path: string;
  /** Who it is across redraws: a loop row's widgets follow its item, not its position. */
  key: string;
  widget: string;
  props: Map<string, V>;
  slots: Map<string, Drawn[]>;
  /** Events the caller set, each to a handler. */
  events: Map<string, { handler: string; env: Env }>;
  /** `mut` inputs given a variable: where the widget writes. */
  writes: Map<string, { place: ir.Place; env: Env }>;
  levels: ir.Level[];
}

/** A rule that failed: a `require`'s message, or a code, and where. */
export interface Broken {
  rule?: string;
  code?: string;
  site?: string;
}

export interface Outcome {
  refused: Broken[];
  failures: Broken[];
}

export interface Call {
  call: { name: string; args: ir.Expr[] };
}

interface Instance {
  id: number;
  path: string;
  template: ir.Template;
  inputs: Map<string, V>;
  /** `mut` inputs: the caller's place, read and written live. */
  places: Map<string, { place: ir.Place; env: Env }>;
  cells: Map<string, V>;
  slots: Map<string, { nodes: ir.Node[]; env: Env }>;
  events: Map<string, { handler: string; env: Env }>;
  seen: boolean;
}

/** What a widget's drawing read and made, so a redraw can reuse it while none of it changed. */
interface Frame {
  /** Each outside value read, by key (`s:field`, `x:channel.value`, `c:id:cell`, `o:key`), with
   * its version then. */
  deps: Map<string, number>;
  /** The instances drawn inside it, with their paths: seen again when it is reused. */
  nested: [Instance, string][];
  own: string[];
  missed: string[];
  /** The extern calls drawn inside it, whose memos a reuse keeps. */
  ext: string[];
  /** It failed, or asked the app for a value: drawn anew every time. */
  dirty: boolean;
}

interface Memo extends Frame {
  template: string;
  path: string;
  owner: number | undefined;
  args: V[];
  bindings: [string, Binding][];
  slots: Record<string, ir.Node[]>;
  events: Record<string, string>;
  epoch: number;
  drawn: Drawn[];
}

const NO_NODES: Record<string, ir.Node[]> = {};
const NO_EVENTS: Record<string, string> = {};

function join(path: string, part: string): string {
  return path ? `${path}/${part}` : part;
}

function failureCode(f: unknown): string {
  return f instanceof Failure ? `failure.${String(f.kind).toLowerCase()}` : "failure.ir";
}

function message(f: unknown): string {
  return f instanceof Error ? f.message : String(f);
}

/** The page: mount it, read its tree, its `$state` and its Markdown, and change it. */
export class Page {
  readonly module: ir.Module;
  readonly program: Program;
  readonly machine: Machine;
  private readonly templates = new Map<string, ir.Template>();
  private readonly externWidgets = new Map<string, ir.ExternWidget>();
  private readonly handlers = new Map<string, ir.Handler>();
  private readonly bindings = new Map<string, ir.Expr>();
  private readonly appFns: Set<string>;
  private readonly stateDecl: ir.State | undefined;
  private readonly instances = new Map<number, Instance>();
  /** Instances by identity: rows follow their items, so a row's widget keeps its variables. */
  private readonly byPath = new Map<string, Instance>();
  /** The same instances by the path they were last drawn at. */
  private atPath = new Map<string, Instance>();
  /** Extern widgets' own `mut` values, for inputs the caller gave no variable, by identity. */
  private own = new Map<string, Map<string, V>>();
  private ownSeen = new Set<string>();
  /** Slots read as values, by the id their view holds. */
  private held: { nodes: ir.Node[]; env: Env }[] = [];
  private state = new Map<string, V>();
  private externs = new Map<string, V>();
  private calls: Call[] = [];
  private outcome: Outcome = { refused: [], failures: [] };
  private drawn: Drawn[] = [];
  private readonly listeners = new Set<() => void>();
  /** Each outside value's version, bumped when it is written, and the epoch, bumped when every
   * memo must go (an undo, what the target supplies). */
  private versions = new Map<string, number>();
  private epoch = 0;
  private memo = new Map<string, Memo>();
  private externMemo = new Map<string, Frame & { node: ir.NodeExtern; path: string; owner: number | undefined; bindings: [string, Binding][]; epoch: number; drawn: Drawn[] }>();
  /** The extern calls drawn this redraw: the memos of the rest are dropped after it. */
  private externSeen = new Set<string>();
  private frames: Frame[] = [];
  private readonly memoOn: boolean;
  /** How many changes came from outside the layout: the reader's, the app's, the page's
   * values. A layout that didn't settle is held until the next one. */
  changes = 0;
  /** Warnings for the app, since it last took them: not failures, the page carries on. */
  private warnings: Broken[] = [];
  /** The spots outside their plane's bounds now, so each is reported once as it moves out. */
  private outside = new Set<string>();
  /** Every failure caught, with its message and stack, for a host's log. */
  readonly errors: unknown[] = [];
  /** Defects switched on, for the test target: each must be caught by a check. */
  private readonly defects: Set<string>;
  /** Whether the target draws an extern widget. */
  private supplies: (widget: string) => boolean;
  /** Extern widgets drawn as their Markdown because the target doesn't supply them. */
  private readonly missed = new Set<string>();
  /** The value fns the target supplies, by full name: `core/moment.local`. */
  private readonly targetFns: Record<string, (args: readonly V[]) => V | null>;

  constructor(ir: ir.File | ir.Module, opts: PageOptions = {}) {
    this.defects = new Set(opts.defects ?? []);
    this.targetFns = opts.fns ?? {};
    this.supplies = opts.supplies ?? (() => true);
    this.memoOn = opts.memo ?? true;
    this.module = "ir" in ir ? ir.ir : ir;
    this.program = Program.fromModule(this.module);
    for (const t of this.module.templates) {
      this.templates.set(t.name, t);
      for (const f of t.fns) this.program.fns.set(f.name, f);
    }
    for (const h of this.module.handlers) this.handlers.set(h.id, h);
    for (const b of this.module.bindings) this.bindings.set(b.id, b.value);
    this.appFns = new Set(this.module.needs.app);
    let state: ir.State | undefined;
    for (const d of this.module.declarations) {
      const decl = d.declare as Record<string, unknown>;
      if ("$state" in decl) state = decl["$state"] as ir.State;
      if ("extern" in decl) {
        const x = decl.extern as Record<string, unknown>;
        if ("widget" in x) this.externWidgets.set((x.widget as ir.ExternWidget).name, x.widget as ir.ExternWidget);
      }
    }
    this.stateDecl = state;
    this.machine = new Machine(this.program, this.host());
    // the page's values, then $state's starting values, then what the app gives
    for (const d of this.module.declarations) {
      const decl = d.declare as Record<string, unknown>;
      if (!("extern" in decl)) continue;
      const x = decl.extern as Record<string, unknown>;
      if (!("channel" in x)) continue;
      const c = x.channel as ir.ExternChannel;
      for (const f of c.values) {
        if (f.default) this.externs.set(`${c.name}.${f.name}`, this.constant(f.default));
      }
    }
    for (const f of state?.fields ?? []) {
      if (f.default) this.state.set(f.name, this.constant(f.default));
    }
    for (const [k, x] of Object.entries(opts.state ?? {})) this.state.set(k, this.constant(x));
    for (const [c, values] of Object.entries(opts.externs ?? {})) {
      for (const [k, x] of Object.entries(values)) this.externs.set(`${c}.${k}`, this.constant(x));
    }
    if (opts.page) this.applyPage(opts.page);
    this.redraw();
  }

  // ---- reading the page

  /** The drawn extern widgets, in order. */
  tree(): Drawn[] {
    return this.drawn;
  }

  /** Every drawn extern widget by its path, as a check observes it. */
  observeTree(): Record<string, { widget: string; props: Record<string, ir.Expr>; slots?: Record<string, string[]> }> {
    const out: Record<string, { widget: string; props: Record<string, ir.Expr>; slots?: Record<string, string[]> }> = {};
    const walk = (nodes: Drawn[]) => {
      for (const n of nodes) {
        const props: Record<string, ir.Expr> = {};
        for (const [k, v] of [...n.props.entries()].sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))) {
          if (v.kind !== "fn") props[k] = toIr(v);
        }
        const entry: { widget: string; props: Record<string, ir.Expr>; slots?: Record<string, string[]> } = { widget: n.widget, props };
        if (n.slots.size) {
          entry.slots = {};
          for (const [s, kids] of n.slots) entry.slots[s] = kids.map((k) => k.path);
        }
        out[n.path] = entry;
        for (const kids of n.slots.values()) walk(kids);
      }
    };
    walk(this.drawn);
    return out;
  }

  /** Every `shade` drawn, by path: the fn it was given, by name, and its arguments (plan tab 16,
   * `shaded`). With `samples`, also the colour at the area's two corners and its middle, worked
   * out by the shader itself, as the test target does. */
  observeShaded(samples = false): Record<string, { shader: string; args: ir.Expr; samples?: { at: ir.Expr; pixel: ir.Expr }[] }> {
    const out: Record<string, { shader: string; args: ir.Expr; samples?: { at: ir.Expr; pixel: ir.Expr }[] }> = {};
    const walk = (nodes: Drawn[]) => {
      for (const n of nodes) {
        if (n.widget === "core/shade") {
          const fn = n.props.get("shader");
          const args = n.props.get("args") ?? none();
          const entry: { shader: string; args: ir.Expr; samples?: { at: ir.Expr; pixel: ir.Expr }[] } = { shader: fn ? shaderName(fn) : "", args: toIr(args) };
          const area = n.props.get("area");
          if (samples && fn && area?.kind === "record") {
            const pt = (name: string) => area.fields.find(([k]) => k === name)?.[1];
            const from = pt("from");
            const to = pt("to");
            const coord = (p: V | undefined, k: string) => (p?.kind === "record" ? p.fields.find(([f]) => f === k)?.[1] : undefined);
            const fx = coord(from, "x"), fy = coord(from, "y"), tx = coord(to, "x"), ty = coord(to, "y");
            if (fx?.kind === "num" && fy?.kind === "num" && tx?.kind === "num" && ty?.kind === "num") {
              const half = Num.literal("0.5")!;
              const point = (x: Num, y: Num): V => ({ kind: "record", ty: "core/point", fields: [["x", { kind: "num", n: x }], ["y", { kind: "num", n: y }]] }) as V;
              const px = { kind: "num", n: tx.n.sub(fx.n).abs().div(Num.int(64)) } as V;
              entry.samples = [point(fx.n, fy.n), point(fx.n.add(tx.n).mul(half), fy.n.add(ty.n).mul(half)), point(tx.n, ty.n)].map((at) => {
                this.machine.resetSteps();
                const pixel = this.machine.apply(fn, [{ value: at }, { value: px }, { value: args }]);
                return { at: toIr(at), pixel: pixel ? toIr(pixel) : { none: {} } };
              });
            }
          }
          out[n.path] = entry;
        }
        for (const kids of n.slots.values()) walk(kids);
      }
    };
    walk(this.drawn);
    return out;
  }

  /** `$state` as it is now, in the IR's form. */
  observeState(): Record<string, ir.Expr> {
    const out: Record<string, ir.Expr> = {};
    for (const [k, v] of this.state) out[k] = toIr(v);
    return out;
  }

  stateValue(name: string): V | undefined {
    return this.state.get(name);
  }

  /** The extern fns of the app called since the last time they were taken. */
  takeCalls(): Call[] {
    const c = this.calls;
    this.calls = [];
    return c;
  }

  /** Refused writes and failures since the last time they were taken. */
  takeOutcome(): Outcome {
    const o = this.outcome;
    this.outcome = { refused: [], failures: [] };
    return o;
  }

  /** Called after every redraw. */
  onChange(listener: () => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  // ---- changing it: every change is one transaction, checked, and undone when it fails

  /** A reader's event on a drawn widget. */
  event(path: string, name: string, args: V[] = []): void {
    const node = this.find(path);
    const ev = node?.events.get(name);
    if (!node || !ev) return;
    this.transaction(path, () => this.runHandler(ev.handler, ev.env, args));
  }

  /** A drawn widget writing one of its `mut` inputs, as a slider does. */
  write(path: string, input: string, value: V): void {
    this.changes++;
    this.machine.resetSteps();
    const node = this.find(path);
    if (!node) return;
    const w = node.writes.get(input);
    if (!w) {
      // a widget's own value: kept by the page for it, checked against the input's type
      const f = this.externWidgets.get(node.widget)?.inputs.find((f) => f.name === input && f.mut);
      if (!f) return;
      if (!this.machine.fits(value, f.type)) {
        this.outcome.refused.push({ code: "contracts.outside", site: path });
        return;
      }
      if (!this.own.has(node.key)) this.own.set(node.key, new Map());
      this.own.get(node.key)!.set(input, value);
      this.bump(`o:${node.key}`);
      this.redraw();
      return;
    }
    const snap = this.snapshot();
    try {
      this.writePlace(w.place, w.env, value);
      const broken = !this.defect("unchecked-writes") && this.contractBroken(w.place, w.env);
      if (broken) {
        this.restore(snap);
        this.outcome.refused.push({ code: "contracts.outside", site: path });
        this.redraw();
        return;
      }
      const rule = this.stateRuleBroken();
      if (rule) {
        this.restore(snap);
        this.outcome.refused.push({ rule });
      }
    } catch (f) {
      this.restore(snap);
      this.outcome.refused.push({ code: "contracts.outside", site: path });
    }
    this.redraw();
  }

  /** A layout pass's writes, as one change: a value equal to the one there is no change, and a
   * refused write undoes the pass. Whether the layout has to run again: only when a variable
   * changed, since a widget's own values are read by no MKP code. A spot in a loop over a list
   * made anew at each redraw gets a new identity each time, so its own box never stays. */
  layoutWrite(writes: { path: string; input: string; value: V }[]): boolean {
    this.machine.resetSteps();
    const snap = this.snapshot();
    const ownBefore = new Map([...this.own].map(([k, m]) => [k, new Map(m)]));
    let changed = false;
    let shared = false;
    for (const { path, input, value } of writes) {
      const node = this.find(path);
      if (!node) continue;
      const now = node.props.get(input);
      if (now && this.machine.equal(now, value)) continue;
      const w = node.writes.get(input);
      try {
        if (w) {
          this.writePlace(w.place, w.env, value);
          if (this.contractBroken(w.place, w.env)) throw new Failure("Rule", "contracts.outside");
          shared = true;
        } else {
          if (!this.own.has(node.key)) this.own.set(node.key, new Map());
          this.own.get(node.key)!.set(input, value);
      this.bump(`o:${node.key}`);
        }
        changed = true;
      } catch {
        this.restore(snap);
        this.own = ownBefore;
        this.outcome.refused.push({ code: "contracts.outside", site: path });
        return false;
      }
    }
    if (!changed) return false;
    const rule = this.stateRuleBroken();
    if (rule) {
      this.restore(snap);
      this.own = ownBefore;
      this.outcome.refused.push({ rule });
      return false;
    }
    this.redraw();
    return shared;
  }

  /** The warnings since the app last took them: a spot outside its plane's bounds (page 5,
   * plane), reported when the page runs as it can't be known when it is compiled. */
  takeWarnings(): Broken[] {
    const w = this.warnings;
    this.warnings = [];
    return w;
  }

  /** Where a spot is, against its plane's bounds: a warning when it moves outside them. */
  spotInside(path: string, inside: boolean): void {
    if (inside) {
      this.outside.delete(path);
    } else if (!this.outside.has(path)) {
      this.outside.add(path);
      this.warnings.push({ code: "views.spot-outside-bounds", site: path });
    }
  }

  /** A plane whose layout didn't settle (page 6, failures). */
  layoutFailed(path: string): void {
    if (!this.outcome.failures.some((b) => b.site === path && b.code === "failure.layout")) this.outcome.failures.push({ code: "failure.layout", site: path });
  }

  /** An app's write to `$state`: one change, checked once. */
  set(changes: Record<string, V>): void {
    this.changes++;
    this.machine.resetSteps();
    const snap = this.snapshot();
    const fields = new Map((this.stateDecl?.fields ?? []).map((f) => [f.name, f]));
    for (const [k, v] of Object.entries(changes)) {
      const f = fields.get(k);
      if (!f || !this.ofType(v, f.type) || !this.machine.fits(v, f.type)) {
        this.restore(snap);
        this.outcome.refused.push({ code: "contracts.outside", site: `$state.${k}` });
        return;
      }
      this.state.set(k, v);
      this.bump(`s:${k}`);
    }
    const rule = this.defect("unchecked-app-writes") ? undefined : this.stateRuleBroken();
    if (rule) {
      this.restore(snap);
      this.outcome.refused.push({ rule });
      return;
    }
    this.redraw();
  }

  /** An app calling a fn the document exposes. */
  expose(channel: string, name: string, args: V[] = []): void {
    for (const d of this.module.declarations) {
      const decl = d.declare as Record<string, unknown>;
      if (!("expose" in decl)) continue;
      const e = decl.expose as ir.Expose;
      if (e.channel !== channel) continue;
      const f = e.fns.find((f) => f.name === name);
      if (!f) continue;
      this.transaction(`${channel}.${name}`, () => this.runBody(f.params, f.body, { owner: undefined, bindings: [], path: "" }, args));
      return;
    }
  }

  /** The app giving a channel's values. */
  setExtern(channel: string, values: Record<string, V>): void {
    this.changes++;
    for (const [k, v] of Object.entries(values)) {
      this.externs.set(`${channel}.${k}`, v);
      this.bump(`x:${channel}.${k}`);
    }
    this.redraw();
  }

  /** The page's own values: its width and theme. */
  setPage(page: PageValues): void {
    this.changes++;
    this.applyPage(page);
    this.redraw();
  }

  /** Which extern widgets the target draws: set by a target before it first draws the page,
   * as @mkp/dom does from its registry. The page is drawn again. */
  setSupplies(supplies: (widget: string) => boolean): void {
    this.supplies = supplies;
    this.epoch++;
    this.missed.clear();
    this.redraw();
  }

  /** The extern widgets this page uses that the target doesn't supply, each shown as its
   * Markdown: reported when the page is mounted, and kept up to date as it changes. */
  missing(): string[] {
    return [...this.missed].sort();
  }

  // ---- the page's Markdown

  /** The page as Markdown, with the values it has now. */
  markdown(): string {
    // set by markdown.ts, which reads the live page
    this.machine.resetSteps();
    return pageMarkdown(this);
  }

  // ---- widgets' own variables, for a snapshot

  /** Every drawn widget's own variables now, by the place it is drawn at (`s0/s4[2]/s1`): a widget
   * written in MKP, its variables; an extern widget, the `mut` inputs no caller gave a variable. */
  observeOwn(): Record<string, Record<string, ir.Expr>> {
    const out: Record<string, Record<string, ir.Expr>> = {};
    for (const [path, inst] of this.atPath) {
      if (inst.cells.size) out[path] = Object.fromEntries([...inst.cells].map(([k, v]) => [k, toIr(v)]));
    }
    const walk = (nodes: Drawn[]) => {
      for (const n of nodes) {
        const own = [...(this.own.get(n.key) ?? [])].filter(([k]) => !n.writes.has(k));
        if (own.length) out[n.path] = { ...out[n.path], ...Object.fromEntries(own.map(([k, v]) => [k, toIr(v)])) };
        for (const kids of n.slots.values()) walk(kids);
      }
    };
    walk(this.drawn);
    return out;
  }

  /** Widgets' own variables put back by place, as one change: each value checked against its
   * variable's type. One that doesn't fit, or whose widget isn't drawn at that place, is left out,
   * and returned as `place.name`. */
  restoreOwn(values: Record<string, Record<string, ir.Expr>>): string[] {
    this.changes++;
    this.machine.resetSteps();
    const nodes = new Map<string, Drawn>();
    const walk = (ns: Drawn[]) => {
      for (const n of ns) {
        nodes.set(n.path, n);
        for (const kids of n.slots.values()) walk(kids);
      }
    };
    walk(this.drawn);
    const left: string[] = [];
    for (const [path, vars] of Object.entries(values)) {
      const inst = this.atPath.get(path);
      const node = nodes.get(path);
      for (const [name, x] of Object.entries(vars)) {
        let v: V;
        try {
          v = this.value(x);
        } catch {
          left.push(`${path}.${name}`);
          continue;
        }
        const cell = inst?.template.cells.find((c) => c.name === name);
        if (inst && cell && this.machine.fits(v, cell.type)) {
          inst.cells.set(name, v);
          continue;
        }
        const input = node ? this.externWidgets.get(node.widget)?.inputs.find((f) => f.name === name && f.mut) : undefined;
        if (node && input && !node.writes.has(name) && this.machine.fits(v, input.type)) {
          if (!this.own.has(node.key)) this.own.set(node.key, new Map());
          this.own.get(node.key)!.set(name, v);
          continue;
        }
        left.push(`${path}.${name}`);
      }
    }
    // every memo read the old values
    this.epoch++;
    this.redraw();
    return left;
  }

  // ---- inside

  /** Whether a defect is switched on: only the test target ever does. */
  defect(name: string): boolean {
    return this.defects.has(name);
  }

  private applyPage(page: PageValues): void {
    if (page.width) {
      this.externs.set("core/page.width", caseOf("core/width", page.width));
      this.bump("x:core/page.width");
    }
    if (page.theme) {
      this.externs.set("core/page.theme", caseOf("core/theme", page.theme));
      this.bump("x:core/page.theme");
    }
  }

  /** Whether a value has a type's shape. The app's values come from outside, so their type is
   * checked before their contract: the compiler has proved only the page's own. */
  ofType(v: V, t: ir.Type, depth = 0): boolean {
    let ty = t;
    for (let guard = 0; this.program.aliases.has(ty.name) && guard < 16; guard++) ty = this.program.aliases.get(ty.name)!;
    const arg = ty.args?.[0];
    if (depth > 64) return false;
    switch (ty.name) {
      case "core/number":
      case "core/int":
        return v.kind === "num";
      case "core/text":
        return v.kind === "text";
      case "core/bool":
        return v.kind === "bool";
      case "core/duration":
        return v.kind === "duration";
      case "core/list":
        return v.kind === "list" && (!arg || v.items.every((i) => this.ofType(i.value, arg, depth + 1)));
      case "core/opt":
        return v.kind === "opt" && (v.value === null || !arg || this.ofType(v.value, arg, depth + 1));
      case "core/range":
        return v.kind === "range";
    }
    const rec = this.program.records.get(ty.name);
    if (rec) {
      if (v.kind !== "record" || v.ty !== ty.name) return false;
      return rec.fields.every((f) => {
        const x = v.fields.find(([k]) => k === f.name);
        return x ? this.ofType(x[1], f.type, depth + 1) : false;
      });
    }
    if (this.program.enums.has(ty.name) || this.program.tokens.has(ty.name)) return v.kind === "case" && v.ty === ty.name;
    // a type parameter, or a fn or view, which the app doesn't write
    return true;
  }

  /** A value in the IR's form, as the app and the checks give them. */
  value(x: ir.Expr): V {
    return this.constant(x);
  }

  private constant(x: ir.Expr): V {
    return new Machine(this.program, new Constants()).eval(x);
  }

  private host(): Host {
    const page = this;
    return {
      read(m: Machine, what: Outer, owner?: number): V {
        switch (what.kind) {
          case "state": {
            page.track(`s:${what.name}`);
            const v = page.state.get(what.name);
            if (!v) throw new Failure("Ir", `$state has no field ${what.name}`);
            return v;
          }
          case "extern": {
            page.track(`x:${what.name}`);
            const v = page.externs.get(what.name);
            if (!v) throw new Failure("NotConstant", `${what.name} is given by the app`);
            return v;
          }
          case "let": {
            const v = m.prog.lets.get(what.name);
            if (v) return v;
            const d = page.module.declarations.find((d) => "let" in (d.declare as object) && ((d.declare as { let: ir.LetDecl }).let.name === what.name));
            if (d) return m.eval((d.declare as { let: ir.LetDecl }).let.value);
            throw new Failure("Ir", `no let ${what.name}`);
          }
          case "input": {
            const inst = owner === undefined ? undefined : page.instances.get(owner);
            if (!inst) throw new Failure("Ir", `no input ${what.name} here`);
            const p = inst.places.get(what.name);
            if (p) return page.machine.evalWith(p.env.bindings, p.env.owner, { place: p.place } as ir.Expr);
            const v = inst.inputs.get(what.name);
            if (!v) throw new Failure("Ir", `no input ${what.name}`);
            return v;
          }
          case "cell": {
            if (owner !== undefined) page.track(`c:${owner}:${what.name}`);
            const v = owner === undefined ? undefined : page.instances.get(owner)?.cells.get(what.name);
            if (!v) throw new Failure("Ir", `no variable ${what.name}`);
            return v;
          }
          case "slot": {
            const inst = owner === undefined ? undefined : page.instances.get(owner);
            const s = inst?.slots.get(what.name);
            if (!s) return none();
            return page.slotValue(inst!, what.name, s);
          }
        }
      },
      write(m: Machine, what: Outer, owner: number | undefined, value: V): void {
        switch (what.kind) {
          case "state": {
            const f = page.stateDecl?.fields.find((f) => f.name === what.name);
            if (f && !page.defect("unchecked-writes") && !m.fits(value, f.type)) throw new Failure("Rule", `$state.${what.name} is outside its contract`);
            page.state.set(what.name, value);
            page.bump(`s:${what.name}`);
            return;
          }
          case "cell": {
            const inst = owner === undefined ? undefined : page.instances.get(owner);
            if (!inst) throw new Failure("Ir", `no variable ${what.name} here`);
            const c = inst.template.cells.find((c) => c.name === what.name);
            if (c && !page.defect("unchecked-writes") && !m.fits(value, c.type)) throw new Failure("Rule", `${what.name} is outside its contract`);
            inst.cells.set(what.name, value);
            page.bump(`c:${inst.id}:${what.name}`);
            return;
          }
          case "input": {
            const inst = owner === undefined ? undefined : page.instances.get(owner);
            const p = inst?.places.get(what.name);
            if (!p) throw new Failure("Ir", `${what.name} is not a mut input given a variable`);
            page.writePlace(p.place, p.env, value);
            return;
          }
          default:
            throw new Failure("Ir", `${what.kind} ${what.name} can't be written`);
        }
      },
      callExtern(_m: Machine, name: string, args: V[]): V | null | undefined {
        const own = page.targetFns[name];
        if (own) return own(args);
        if (!page.appFns.has(name)) return undefined;
        for (const f of page.frames) f.dirty = true;
        if (!page.defect("lost-calls")) page.calls.push({ call: { name, args: args.map(toIr) } });
        return null;
      },
      invoke(_m: Machine, event: string, args: V[], owner: number | undefined): void {
        const inst = owner === undefined ? undefined : page.instances.get(owner);
        const ev = inst?.events.get(event);
        if (ev) page.runHandler(ev.handler, ev.env, args);
      },
    };
  }

  /** A slot read as a value: a list slot gives its calls as views; any other, one view. */
  private slotValue(inst: Instance, name: string, s: { nodes: ir.Node[]; env: Env }): V {
    const decl = inst.template.slots.find((x) => x.name === name);
    if (decl?.type.name === "core/list") {
      const views = this.expandViews(s.nodes, s.env);
      return this.machine.makeList(views);
    }
    this.held.push({ nodes: s.nodes, env: s.env });
    const id = this.held.length - 1;
    return { kind: "view", widget: "#slot", args: new Map([["id", numOf(id)]]), slots: {}, events: {}, exprs: {}, captured: [], owner: undefined } as V;
  }

  /** A slot's calls as views, through its loops and branches. */
  private expandViews(nodes: ir.Node[], env: Env): V[] {
    const out: V[] = [];
    for (const n of nodes) {
      if ("extern" in n || "use" in n) {
        const x = ("extern" in n ? n.extern : n.use) as ir.NodeExtern & ir.NodeUse;
        const args = new Map<string, V>();
        const given = ("extern" in n ? n.extern.props : n.use.args) as Record<string, ir.Expr>;
        for (const [k, e] of Object.entries(given)) args.set(k, this.evalIn(env, e));
        out.push({ kind: "view", widget: x.name, args, slots: x.slots ?? {}, events: x.events ?? {}, exprs: given, captured: env.bindings, owner: env.owner } as V);
      } else if ("for" in n) {
        for (const row of this.machine.loopRows(env.bindings, env.owner, n.for)) out.push(...this.expandViews(n.for.body, { ...env, bindings: [...env.bindings, ...row.bindings] }));
      } else if ("if" in n) {
        const b = this.pickBranch(n.if, env);
        if (b) out.push(...this.expandViews(b.nodes, b.env));
      }
    }
    return out;
  }

  evalIn(env: Env, e: ir.Expr): V {
    const x = "bind" in e ? this.bindings.get((e as { bind: string }).bind) : e;
    if (!x) throw new Failure("Ir", "a binding the page doesn't have");
    return this.machine.evalWith(env.bindings, env.owner, x);
  }

  private writePlace(place: ir.Place, env: Env, value: V): void {
    this.machine.setPlace(env.bindings, env.owner, place, value);
  }

  /** Whether the variable a place writes now breaks its own contract. */
  private contractBroken(place: ir.Place, env: Env): boolean {
    const root = place.root as Record<string, string>;
    if ("$state" in root && place.path.length === 0) {
      const f = this.stateDecl?.fields.find((f) => f.name === root["$state"]);
      const v = this.state.get(root["$state"]);
      return !!f && !!v && !this.machine.fits(v, f.type);
    }
    if ("cell" in root && place.path.length === 0 && env.owner !== undefined) {
      const inst = this.instances.get(env.owner);
      const c = inst?.template.cells.find((c) => c.name === root.cell);
      const v = inst?.cells.get(root.cell);
      return !!c && !!v && !this.machine.fits(v, c.type);
    }
    return false;
  }

  /** The message of the first of `$state`'s rules that no longer holds. */
  private stateRuleBroken(): string | undefined {
    for (const r of this.stateDecl?.requires ?? []) {
      const ok = this.runBody([], r.body, { owner: undefined, bindings: [], path: "" }, []);
      if (ok && ok.kind === "bool" && !ok.b) return r.message;
    }
    return undefined;
  }

  private runHandler(id: string, env: Env, args: V[]): void {
    const h = this.handlers.get(id);
    if (!h) throw new Failure("Ir", `no handler ${id}`);
    this.runBody(h.params ?? [], h.body, env, args);
  }

  private runBody(params: ir.Param[], body: ir.Stmt[], env: Env, args: V[]): V | undefined {
    const f: V = { kind: "fn", params, body, captured: env.bindings, owner: env.owner } as V;
    return this.machine.apply(f, args.map((value) => ({ value }))) ?? undefined;
  }

  private snapshot() {
    return {
      state: new Map(this.state),
      cells: new Map([...this.instances].map(([id, i]) => [id, new Map(i.cells)])),
      calls: this.calls.length,
    };
  }

  private restore(s: ReturnType<Page["snapshot"]>): void {
    this.epoch++;
    this.state = s.state;
    for (const [id, cells] of s.cells) {
      const i = this.instances.get(id);
      if (i) i.cells = cells;
    }
    this.calls.length = s.calls;
  }

  /** A change from outside: done whole, with `$state`'s rules after it, or undone. */
  private transaction(site: string, run: () => void): void {
    this.changes++;
    const snap = this.snapshot();
    try {
      this.machine.resetSteps();
      run();
      const rule = this.stateRuleBroken();
      if (rule) throw new Failure("Rule", rule, rule);
    } catch (f) {
      this.errors.push(f);
      if (!this.defect("no-undo")) this.restore(snap);
      if (f instanceof Failure && f.kind === "Rule" && f.rule) this.outcome.failures.push({ rule: f.rule, site });
      else this.outcome.failures.push({ code: failureCode(f), site });
    }
    this.redraw();
  }

  /** The widget drawn at a path now, if there is one. */
  find(path: string): Drawn | undefined {
    const walk = (nodes: Drawn[]): Drawn | undefined => {
      for (const n of nodes) {
        if (n.path === path) return n;
        for (const kids of n.slots.values()) {
          const f = walk(kids);
          if (f) return f;
        }
      }
      return undefined;
    };
    return walk(this.drawn);
  }

  // ---- drawing

  /** Draws the whole page again: once per change. */
  redraw(): void {
    // a target that doesn't redraw after a change keeps showing the old page
    if (this.defect("no-redraw") && this.drawn.length) return;
    // each redraw has the step limit to itself, as each event does: steps never pile up across changes
    this.machine.resetSteps();
    for (const i of this.instances.values()) i.seen = false;
    this.held = [];
    this.missed.clear();
    this.atPath = new Map();
    this.ownSeen = new Set();
    this.externSeen = new Set();
    const doc = this.templates.get("doc");
    this.drawn = doc ? this.drawNodes(doc.view, { owner: undefined, bindings: [], path: "" }) : [];
    // a widget that left the page leaves with its variables
    for (const [id, i] of [...this.instances]) {
      if (!i.seen) {
        this.instances.delete(id);
        // a widget of another kind may have taken its key this redraw: that one stays
        if (this.byPath.get(i.path) === i) {
          this.byPath.delete(i.path);
          this.memo.delete(i.path);
        }
      }
    }
    for (const k of [...this.own.keys()]) if (!this.ownSeen.has(k)) this.own.delete(k);
    for (const k of [...this.externMemo.keys()]) if (!this.externSeen.has(k)) this.externMemo.delete(k);
    for (const l of this.listeners) l();
  }

  pickBranch(n: ir.NodeIf, env: Env): { nodes: ir.Node[]; env: Env } | undefined {
    for (const b of n.branches) {
      const w = b.when as Record<string, unknown>;
      if ("cond" in w) {
        const v = this.evalIn(env, w.cond as ir.Expr);
        if (v.kind === "bool" && v.b) return { nodes: b.then, env };
      } else {
        const opened = this.machine.openCond(env.bindings, env.owner, w.open as ir.CondOpen);
        if (opened) return { nodes: b.then, env: { ...env, bindings: [...env.bindings, [(w.open as ir.CondOpen).name, opened]] } };
      }
    }
    return { nodes: n.else, env };
  }

  drawNodes(nodes: ir.Node[], env0: Env): Drawn[] {
    let env = env0;
    const out: Drawn[] = [];
    for (const n of nodes) {
      if ("declare" in n) {
        const l = n.declare.let;
        env = { ...env, bindings: [...env.bindings, [l.name, { value: this.evalIn(env, l.value) }]] };
      } else if ("for" in n) {
        const rows = this.machine.loopRows(env.bindings, env.owner, n.for);
        rows.forEach((row, k) =>
          out.push(...this.drawNodes(n.for.body, { owner: env.owner, bindings: [...env.bindings, ...row.bindings], path: join(env.path, `${n.for.site}[${k}]`), key: join(env.key ?? env.path, `${n.for.site}[${this.defect("rows-by-position") ? k : row.key}]`) })),
        );
      } else if ("if" in n) {
        const b = this.pickBranch(n.if, env);
        if (b) out.push(...this.drawNodes(b.nodes, b.env));
      } else if ("match" in n) {
        const v = this.evalIn(env, n.match.value);
        let done = false;
        for (const c of n.match.cases) {
          const binds = this.matches(v, c.when);
          if (binds) {
            out.push(...this.drawNodes(c.then, { ...env, bindings: [...env.bindings, ...binds] }));
            done = true;
            break;
          }
        }
        if (!done) out.push(...this.drawNodes(n.match.else ?? [], env));
      } else if ("place" in n) {
        const v = this.evalIn(env, n.place.view);
        out.push(...this.drawView(v, join(env.path, n.place.site), env));
      } else if ("extern" in n) {
        out.push(...this.drawExtern(n.extern, env));
      } else if ("use" in n) {
        out.push(...this.drawUse(n.use.name, join(env.path, n.use.site), n.use.args, n.use.slots ?? {}, n.use.events ?? {}, env, n.use.levels, join(env.key ?? env.path, n.use.site)));
      }
    }
    return out;
  }

  matches(v: V, patterns: ir.Pattern[]): [string, Binding][] | undefined {
    for (const p of patterns) {
      const q = p as Record<string, unknown>;
      if ("case" in q) {
        const pc = q.case as ir.PatternCase;
        if (v.kind === "case" && v.name === pc.name) return (pc.binds ?? []).map((b, k) => [b, { value: v.values[k]?.[1] ?? none() }]);
        if (v.kind === "opt" && pc.name === "SOME" && v.value) return (pc.binds ?? []).slice(0, 1).map((b) => [b, { value: v.value! }]);
        if (v.kind === "opt" && pc.name === "NONE" && !v.value) return [];
      } else if ("num" in q && v.kind === "num" && this.machine.equal(v, this.constant({ num: q.num } as ir.Expr))) return [];
      else if ("text" in q && v.kind === "text" && v.s === q.text) return [];
      else if ("bool" in q && v.kind === "bool" && v.b === q.bool) return [];
    }
    return undefined;
  }

  /** An extern widget's call: reused from the last redraw when it is the same call at the same
   * place, with the same locals around it, and nothing it read has changed. */
  private drawExtern(x: ir.NodeExtern, env: Env): Drawn[] {
    const key = join(env.key ?? env.path, x.site);
    const path = join(env.path, x.site);
    const m = this.externMemo.get(key);
    if (this.memoOn && m && m.node === x && m.epoch === this.epoch && m.path === path && m.owner === env.owner && [...m.deps].every(([k, v]) => (this.versions.get(k) ?? 0) === v) && this.sameBindings(m.bindings, env.bindings)) {
      this.replay(m);
      this.externSeen.add(key);
      for (const f of this.frames) f.ext.push(key);
      return m.drawn;
    }
    const frame: Frame = { deps: new Map(), nested: [], own: [], missed: [], ext: [], dirty: false };
    this.frames.push(frame);
    let drawn: Drawn[];
    try {
      drawn = this.drawExternNow(x, env);
    } finally {
      this.frames.pop();
    }
    if (this.memoOn && !frame.dirty) this.externMemo.set(key, { ...frame, node: x, path, owner: env.owner, bindings: env.bindings, epoch: this.epoch, drawn });
    else this.externMemo.delete(key);
    this.externSeen.add(key);
    for (const f of this.frames) f.ext.push(key);
    return drawn;
  }

  /** What a reused subtree did when it was drawn: its instances are seen again, and every widget
   * being drawn around it is told what it read. */
  private replay(m: Frame): void {
    for (const [inst, p] of m.nested) {
      inst.seen = true;
      this.atPath.set(p, inst);
    }
    for (const k of m.own) this.ownSeen.add(k);
    for (const n of m.missed) this.missed.add(n);
    for (const k of m.ext) this.externSeen.add(k);
    for (const f of this.frames) {
      for (const [k, v] of m.deps) if (!f.deps.has(k)) f.deps.set(k, v);
      f.nested.push(...m.nested);
      f.own.push(...m.own);
      f.missed.push(...m.missed);
      f.ext.push(...m.ext);
    }
  }

  private drawExternNow(x: ir.NodeExtern, env: Env): Drawn[] {
    const path = join(env.path, x.site);
    const key = join(env.key ?? env.path, x.site);
    const props = new Map<string, V>();
    for (const [k, e] of Object.entries(x.props)) props.set(k, this.evalIn(env, e));
    const writes = new Map<string, { place: ir.Place; env: Env }>();
    for (const [k, p] of Object.entries(x.writes ?? {})) {
      props.set(k, this.machine.evalWith(env.bindings, env.owner, { place: p } as ir.Expr));
      writes.set(k, { place: p, env });
    }
    const w = this.externWidgets.get(x.name);
    for (const f of w?.inputs ?? []) {
      if (!props.has(f.name) && f.default) props.set(f.name, this.evalIn(env, f.default));
    }
    // a widget the target doesn't draw shows its Markdown instead (page 6), drawn with the
    // blocks the target does: its markdown block, in an instance holding its inputs
    if (w && !this.supplies(x.name)) {
      this.missed.add(x.name);
      for (const f of this.frames) f.missed.push(x.name);
      const inst = this.enterExtern(w, path, props, x.slots ?? {}, env);
      try {
        return this.drawNodes(w.markdown ?? [], { ...inst, path, key });
      } finally {
        this.leave(inst);
      }
    }
    // what it wrote to its own `mut` inputs stands until the caller gives them a variable
    this.track(`o:${key}`);
    const own = this.own.get(key);
    if (own) {
      this.ownSeen.add(key);
      for (const f of this.frames) f.own.push(key);
      for (const [k, v] of own) if (!writes.has(k)) props.set(k, v);
    }
    const slots = new Map<string, Drawn[]>();
    for (const [s, nodes] of Object.entries(x.slots ?? {})) slots.set(s, this.drawNodes(nodes, env));
    const events = new Map<string, { handler: string; env: Env }>();
    for (const [e, h] of Object.entries(x.events ?? {})) events.set(e, { handler: h, env });
    return [{ path, key, widget: x.name, props, slots, events, writes, levels: x.levels ?? [] }];
  }

  /** A widget written in MKP: its instance, kept by its path, and its view. */
  private drawUse(name: string, path: string, args: Record<string, ir.Expr>, slots: Record<string, ir.Node[]>, events: Record<string, string>, env: Env, levels: ir.Level[] = [], key: string = path): Drawn[] {
    const t = this.templates.get(name);
    if (!t) {
      // an extern widget held as a view value
      return this.drawExtern({ name, site: path.split("/").pop()!, props: args, slots, events, writes: {}, levels } as ir.NodeExtern, { ...env, path: path.split("/").slice(0, -1).join("/") });
    }
    // a failure working out whether it can be reused is left to drawing it, so it fails there,
    // as it would with no reuse at all
    let reused: Drawn[] | undefined;
    try {
      reused = this.reuse(name, path, key, args, slots, events, env);
    } catch {
      reused = undefined;
    }
    if (reused) return reused;
    const frame: Frame = { deps: new Map(), nested: [], own: [], missed: [], ext: [], dirty: false };
    this.frames.push(frame);
    let drawn: Drawn[];
    try {
      const own = this.enterUse(t, path, args, slots, events, env, key);
      drawn = this.drawNodes(t.view, own);
    } catch (f) {
      drawn = [this.failed(name, path, f)];
    } finally {
      this.frames.pop();
    }
    const inst = this.byPath.get(key);
    if (this.memoOn && !frame.dirty && inst) {
      this.memo.set(key, { ...frame, template: name, path, owner: env.owner, args: this.argValues(args, env), bindings: env.bindings, slots, events, epoch: this.epoch, drawn });
    } else {
      this.memo.delete(key);
    }
    return drawn;
  }

  // ---- reusing what a widget drew (plan tab 2: only the bindings that read what changed)

  /** A read of an outside value, for every widget being drawn. */
  track(key: string): void {
    if (!this.frames.length) return;
    const v = this.versions.get(key) ?? 0;
    for (const f of this.frames) if (!f.deps.has(key)) f.deps.set(key, v);
  }

  /** An outside value written: every memo that read it is out of date. */
  bump(key: string): void {
    this.versions.set(key, (this.versions.get(key) ?? 0) + 1);
  }

  private argValues(args: Record<string, ir.Expr>, env: Env): V[] {
    return Object.keys(args)
      .sort()
      .map((k) => {
        const e = args[k];
        return "place" in e ? this.machine.evalWith(env.bindings, env.owner, e) : this.evalIn(env, e);
      });
  }

  /** The widget's subtree from the last redraw, when it is called the same way at the same place
   * and nothing it read has changed since: its instances, own values and missing widgets are
   * seen again, and every widget around it is told what it read. */
  private reuse(name: string, path: string, key: string, args: Record<string, ir.Expr>, slots: Record<string, ir.Node[]>, events: Record<string, string>, env: Env): Drawn[] | undefined {
    const m = this.memo.get(key);
    if (!this.memoOn || !m || m.epoch !== this.epoch || m.template !== name || m.path !== path || m.owner !== env.owner) return undefined;
    if (!sameRecord(m.slots, slots) || !sameRecord(m.events, events)) return undefined;
    for (const [k, v] of m.deps) if ((this.versions.get(k) ?? 0) !== v) return undefined;
    if (!this.sameBindings(m.bindings, env.bindings)) return undefined;
    const now = this.argValues(args, env);
    if (now.length !== m.args.length || now.some((v, k) => !this.machine.equal(v, m.args[k]))) return undefined;
    this.replay(m);
    return m.drawn;
  }

  private sameBindings(a: [string, Binding][], b: [string, Binding][]): boolean {
    if (a === b) return true;
    if (a.length !== b.length) return false;
    return a.every(([n, x], k) => {
      const [m, y] = b[k];
      if (n !== m) return false;
      if ("value" in x && "value" in y) return x.value === y.value || this.machine.equal(x.value, y.value);
      if ("ref" in x && "ref" in y) return JSON.stringify(x.ref) === JSON.stringify(y.ref);
      return false;
    });
  }

  /** A widget that failed: reported once, and a notice in its place (page 6). */
  failed(name: string, path: string, f: unknown): Drawn {
    for (const fr of this.frames) fr.dirty = true;
    const broken: Broken = f instanceof Failure && f.kind === "Rule" && f.rule ? { rule: f.rule, site: path } : { code: failureCode(f), site: path };
    if (!this.outcome.failures.some((b) => b.site === path && b.code === broken.code && b.rule === broken.rule)) this.outcome.failures.push(broken);
    return { path, key: path, widget: "#notice", props: new Map([["message", { kind: "text", s: `${name.split("/").pop()} failed: ${message(f)}` } as V]]), slots: new Map(), events: new Map(), writes: new Map(), levels: [] };
  }

  /** A widget's instance at a path, made or kept, with its inputs, slots and events from this
   * call: the env its own code runs in. Its rules have to hold. */
  enterUse(t: ir.Template, path: string, args: Record<string, ir.Expr>, slots: Record<string, ir.Node[]>, events: Record<string, string>, env: Env, key: string = path): Env {
    let inst = this.byPath.get(key);
    const fresh = !inst || inst.template.name !== t.name;
    if (fresh) {
      const id = this.machine.newId();
      inst = { id, path: key, template: t, inputs: new Map(), places: new Map(), cells: new Map(), slots: new Map(), events: new Map(), seen: true };
      this.instances.set(id, inst);
      this.byPath.set(key, inst);
    }
    const it = inst!;
    it.seen = true;
    this.atPath.set(path, it);
    for (const f of this.frames) f.nested.push([it, path]);
    it.places.clear();
    it.inputs.clear();
    for (const [k, e] of Object.entries(args)) {
      if ("place" in e) it.places.set(k, { place: (e as { place: ir.Place }).place, env });
      else it.inputs.set(k, this.evalIn(env, e));
    }
    const own: Env = { owner: it.id, bindings: [], path, key };
    for (const f of t.inputs) {
      if (!it.inputs.has(f.name) && !it.places.has(f.name)) it.inputs.set(f.name, f.default ? this.evalIn(own, f.default) : none());
    }
    it.slots.clear();
    for (const [s, nodes] of Object.entries(slots)) it.slots.set(s, { nodes, env });
    it.events.clear();
    for (const [e, h] of Object.entries(events)) it.events.set(e, { handler: h, env });
    if (fresh) for (const c of t.cells) it.cells.set(c.name, c.default ? this.evalIn(own, c.default) : none());
    for (const r of t.requires) {
      const ok = this.runBody([], r.body, own, []);
      if (ok && ok.kind === "bool" && !ok.b) throw new Failure("Rule", r.message, r.message);
    }
    return own;
  }

  /** An extern widget's instance, for its markdown block: its inputs' values and its slots. */
  enterExtern(w: ir.ExternWidget, path: string, props: Map<string, V>, slots: Record<string, ir.Node[]>, env: Env): Env {
    const t = { name: w.name, generics: [], inputs: w.inputs, slots: w.slots, events: w.events, cells: [], requires: [], fns: [], view: [], markdown: w.markdown, levels: w.levels } as unknown as ir.Template;
    const id = this.machine.newId();
    const inst: Instance = { id, path: `${path}#md`, template: t, inputs: new Map(props), places: new Map(), cells: new Map(), slots: new Map(), events: new Map(), seen: true };
    for (const f of w.inputs) {
      if (!inst.inputs.has(f.name)) inst.inputs.set(f.name, f.default ? this.evalIn(env, f.default) : none());
    }
    for (const [s, nodes] of Object.entries(slots)) inst.slots.set(s, { nodes, env });
    this.instances.set(id, inst);
    return { owner: id, bindings: [], path };
  }

  /** Drops an instance made only to write Markdown. */
  leave(env: Env): void {
    const i = env.owner === undefined ? undefined : this.instances.get(env.owner);
    if (i && i.path.endsWith("#md")) this.instances.delete(i.id);
  }

  templateOf(name: string): ir.Template | undefined {
    return this.templates.get(name);
  }

  externWidget(name: string): ir.ExternWidget | undefined {
    return this.externWidgets.get(name);
  }

  /** Whether a drawn widget's event runs anything. A handler that only passes the event on, as
   * `column` gives its `flex` `click = fn() { invoke click(); }`, counts only when the caller of
   * the widget it passes it to set that event in turn: so a target makes only what does something
   * clickable. */
  listens(d: Drawn, event: string): boolean {
    let ev = d.events.get(event);
    for (let depth = 0; ev && depth < 64; depth++) {
      const h = this.handlers.get(ev.handler);
      const only = h && h.body.length === 1 ? ((h.body[0] as Record<string, unknown>).invoke as { event: string } | undefined) : undefined;
      if (!only) return !!h;
      const inst = ev.env.owner === undefined ? undefined : this.instances.get(ev.env.owner);
      ev = inst?.events.get(only.event);
    }
    return false;
  }

  /** The type of the variable a drawn widget's `mut` input writes, its contract included: where a
   * slider's ends and step come from (page 5). The input's own type when the caller gave no
   * variable; undefined for a local, whose type the IR doesn't keep. */
  writeType(d: Drawn, input: string): ir.Type | undefined {
    const w = d.writes.get(input);
    if (!w) return this.externWidgets.get(d.widget)?.inputs.find((f) => f.name === input)?.type;
    const root = w.place.root as Record<string, string>;
    const inst = w.env.owner === undefined ? undefined : this.instances.get(w.env.owner);
    let t: ir.Type | undefined;
    if ("$state" in root) t = this.stateDecl?.fields.find((f) => f.name === root["$state"])?.type;
    else if ("cell" in root) t = inst?.template.cells.find((c) => c.name === root.cell)?.type;
    else if ("input" in root) t = inst?.template.inputs.find((f) => f.name === root.input)?.type;
    for (const s of w.place.path) {
      let base = t;
      for (let k = 0; base && k < 16 && this.program.aliases.has(base.name); k++) base = this.program.aliases.get(base.name);
      if (!base) return undefined;
      // a record's field, or a list's item
      if ("field" in s) t = (base.fields ?? this.program.records.get(base.name)?.fields)?.find((f) => f.name === s.field.name)?.type;
      else t = base.args?.[0];
    }
    return t;
  }

  heldSlot(id: number): { nodes: ir.Node[]; env: Env } | undefined {
    return this.held[id];
  }

  /** Each row of a loop with the locals it binds, as drawing walks it. */
  rows(n: ir.NodeFor, env: Env): [string, Binding][][] {
    return this.machine.loopRows(env.bindings, env.owner, n).map((r) => r.bindings);
  }

  /** The same rows with their keys: a `mut for` row's is its item's identity. */
  keyedRows(n: ir.NodeFor, env: Env): { key: string; bindings: [string, Binding][] }[] {
    return this.machine.loopRows(env.bindings, env.owner, n).map((r, k) => ({ key: this.defect("rows-by-position") ? String(k) : String(r.key), bindings: r.bindings }));
  }

  /** A view held in a value: a slot's content, or a call made as a value. */
  drawView(v: V, path: string, env: Env): Drawn[] {
    if (v.kind === "opt") return v.value ? this.drawView(v.value, path, env) : [];
    if (v.kind === "list") return v.items.flatMap((i, k) => this.drawView(i.value, `${path}[${k}]`, env));
    if (v.kind !== "view") return [];
    if (v.widget === "#slot") {
      const id = v.args.get("id");
      const held = id && id.kind === "num" ? this.held[Number(id.n.show())] : undefined;
      return held ? this.drawNodes(held.nodes, held.env) : [];
    }
    const made: Env = { owner: v.owner, bindings: [...v.captured], path: env.path };
    const args: Record<string, ir.Expr> = {};
    for (const [k, x] of v.args) args[k] = toIr(x);
    const t = this.templates.get(v.widget);
    if (t) return this.drawUse(v.widget, path, args, v.slots as Record<string, ir.Node[]>, v.events as Record<string, string>, made);
    const props = new Map(v.args);
    const w = this.externWidgets.get(v.widget);
    for (const f of w?.inputs ?? []) {
      if (!props.has(f.name) && f.default) props.set(f.name, this.evalIn(made, f.default));
    }
    const slots = new Map<string, Drawn[]>();
    for (const [s, nodes] of Object.entries(v.slots)) slots.set(s, this.drawNodes(nodes as ir.Node[], made));
    const events = new Map<string, { handler: string; env: Env }>();
    for (const [e, h] of Object.entries(v.events)) events.set(e, { handler: h as string, env: made });
    return [{ path, key: join(env.key ?? env.path, path.split("/").pop()!), widget: v.widget, props, slots, events, writes: new Map(), levels: w?.levels ?? [] }];
  }

  /** The live instance at a path, for the Markdown writer. */
  instanceAt(path: string): { id: number; cells: Map<string, V> } | undefined {
    return this.atPath.get(path);
  }

  stateNow(): Map<string, V> {
    return this.state;
  }

  externsNow(): Map<string, V> {
    return this.externs;
  }
}

/** A shader's name: a named fn is lowered to a lambda that calls it with its own parameters. */
function shaderName(f: V): string {
  if (f.kind !== "fn" || f.body.length !== 1) return "";
  const ret = (f.body[0] as { return?: { value?: ir.Expr } }).return?.value as { call?: ir.Call } | undefined;
  const call = ret?.call;
  if (!call) return "";
  const passes = call.args.length === f.params.length && call.args.every((a, k) => (a as { get?: { local?: string } }).get?.local === f.params[k].name);
  return passes ? call.name : "";
}

function sameRecord<T>(a: Record<string, T>, b: Record<string, T>): boolean {
  if (a === b) return true;
  const ka = Object.keys(a);
  return ka.length === Object.keys(b).length && ka.every((k) => a[k] === b[k]);
}

function numOf(n: number) {
  return Value.num(Num.int(n));
}

// the Markdown writer, set by markdown.ts
let pageMarkdown: (p: Page) => string = () => "";
export function setMarkdownWriter(w: (p: Page) => string): void {
  pageMarkdown = w;
}
