// A document running, as a framework target holds it: made from its IR (given, or fetched from a
// URL), its `$state` the app's to control or to start from, every write checked by xtmd, what was
// refused told to the app, and a snapshot that takes everything the page holds out and puts it
// back. No framework here: a target renders `render()` with its own renderer and calls `update`
// with its props.

import { Page, type Call, type Outcome, type PageOptions, type PageValues, type Value, type ir } from "@extended-mark/runtime";
import { RELEASE, channelName, hash, makePage, type DocError, type Ir, type Restored, type Snapshot } from "@extended-mark/embed";

export { hash, type DocError, type Restored, type Snapshot } from "@extended-mark/embed";
import { Num, layout as runLayout, type Measure } from "@extended-mark/runtime";
import { Tokens, webFns } from "@extended-mark/dom/shared";
import { renderPage, type ViewWidget } from "./render.js";
import { h, type VNode } from "./vnode.js";
import { widgets as core } from "./widgets/index.js";

/** What a target gives the document: the same in every framework. */
export interface DocProps {
  /** The page's IR, in hand: the file `xtmd build` writes. */
  ir?: Ir;
  /** Where to fetch the page's IR from, when it isn't in hand. */
  src?: string;
  /** `$state`, controlled: the page shows this, and every change goes through `onStateChange`. */
  state?: Record<string, ir.Expr>;
  /** `$state` to start from, when the app doesn't control it. */
  defaultState?: Record<string, ir.Expr>;
  /** A snapshot to start from: `$state` and every widget's own variables. */
  defaultSnapshot?: Snapshot;
  /** The page's own values: its width and theme. */
  page?: PageValues;
  /** Each extern channel's values, by its name in the document (`tracker`) or in full. */
  externs?: Record<string, Record<string, ir.Expr>>;
  /** Value fns the app supplies, by full name (`acme/rate`). */
  fns?: PageOptions["fns"];
  /** A pack's own extern widgets, drawn the way core's are, by full name. */
  widgets?: Record<string, ViewWidget>;
  /** How the plane's spots are measured: left out, from their elements. The checks give fixed sizes. */
  measure?: (page: Page) => Measure;
  /** `$state` after each change to it. */
  onStateChange?: (state: Record<string, ir.Expr>) => void;
  /** A write xtmd refused, a widget that failed, or an IR that couldn't be had. */
  onError?: (error: DocError) => void;
  /** The app's extern fns the page called, after each change that called any. */
  onCalls?: (calls: Call[]) => void;
}

let docs = 0;

/** A document a framework target renders. */
export class Doc {
  private props: DocProps;
  private page: Page | undefined;
  private tokens: Tokens | undefined;
  private irHash = "";
  private loading: string | undefined;
  private loadFailed: string | undefined;
  private unlisten: (() => void) | undefined;
  private root: Element | undefined;
  private shown: string | undefined;
  private queued = false;
  private gone = false;
  private wantLayout = false;
  private rendering = false;
  /** Bumped at every change the page draws: a target's store snapshot. */
  version = 0;
  readonly uid = `xtmdv${++docs}-`;
  private readonly listeners = new Set<() => void>();
  /** The page reads its value fns through this, so it always calls the latest props' fns. */
  private readonly fns: NonNullable<PageOptions["fns"]>;

  constructor(props: DocProps) {
    this.props = props;
    const web = webFns();
    this.fns = new Proxy({}, { get: (_t, name) => (typeof name === "string" ? (this.props.fns?.[name] ?? web[name]) : undefined), has: (_t, name) => typeof name === "string" && (name in web || !!this.props.fns?.[name]) });
    if (props.ir) this.start(props.ir, props.state ?? props.defaultState, props.defaultSnapshot);
    else if (props.src) void this.fetch(props.src);
  }

  /** Called after every change the page draws: the target renders again. */
  subscribe(f: () => void): () => void {
    this.listeners.add(f);
    return () => this.listeners.delete(f);
  }

  /** The running page, once it has its IR. */
  get running(): Page | undefined {
    return this.page;
  }

  /** The page as elements: a placeholder while its IR is being fetched, or a notice if it couldn't be. */
  render(): VNode {
    if (!this.page || !this.tokens) {
      const why = this.loadFailed;
      return h("div", undefined, { class: "xtmd-root", "data-xtmd-root": "", "data-xtmd-loading": why ? undefined : "" }, why ? [h("div", "notice", { role: "alert" }, [why])] : []);
    }
    this.rendering = true;
    let root: VNode;
    try {
      root = renderPage({ page: this.page, registry: { ...core, ...(this.props.widgets ?? {}) }, tokens: this.tokens, uid: this.uid, layout: () => this.layout(), after: () => this.report() });
    } finally {
      this.rendering = false;
    }
    // the root's element, for the plane's measure and the snapshot's tests
    root.hook = {
      mount: (el) => {
        this.root = el;
        this.settle();
      },
      update: (el) => {
        this.root = el;
        this.settle();
      },
      unmount: () => (this.root = undefined),
    };
    return root;
  }

  /** The target's props changed: do what each change means. */
  update(next: DocProps): void {
    const prev = this.props;
    this.props = next;
    if (this.gone) return;
    if (next.ir !== prev.ir && next.ir) {
      // a new page: `$state` carried over where its fields still exist
      this.start(next.ir, next.state ?? this.page?.observeState() ?? next.defaultState, undefined);
      return;
    }
    if (!next.ir && next.src !== prev.src && next.src) {
      void this.fetch(next.src);
      return;
    }
    const page = this.page;
    if (!page) return;
    if (next.page && JSON.stringify(next.page) !== JSON.stringify(prev.page)) page.setPage(next.page);
    if (next.externs !== prev.externs) {
      for (const [c, values] of Object.entries(next.externs ?? {})) {
        if (JSON.stringify(values) === JSON.stringify(prev.externs?.[c])) continue;
        page.setExtern(channelName(page.module, c), this.values(values));
      }
    }
    // controlled: a new `$state` from the app wins, checked as any write of the app's is; one xtmd
    // refuses is told to onError once, and the page keeps the last that fit
    if (next.state && JSON.stringify(next.state) !== JSON.stringify(prev.state) && JSON.stringify(next.state) !== JSON.stringify(page.observeState())) {
      page.set(this.values(next.state));
      this.report();
    }
  }

  /** Stops the page: the document can't be used again. */
  destroy(): void {
    this.gone = true;
    this.unlisten?.();
    this.listeners.clear();
  }

  // ---- what an app does through a target's handle

  /** Writes `$state` fields as one change, checked: refused whole, or done. */
  set(changes: Record<string, ir.Expr | Value>): void {
    this.page?.set(this.values(changes));
    this.report();
  }

  /** `$state` now. */
  state(): Record<string, ir.Expr> {
    return this.page?.observeState() ?? {};
  }

  /** The page as Markdown, with the values it has now. */
  markdown(): string {
    return this.page?.markdown() ?? "";
  }

  /** Calls a fn the document exposes. */
  expose(channel: string, name: string, ...args: (ir.Expr | Value)[]): void {
    if (!this.page) return;
    this.page.expose(channelName(this.page.module, channel), name, args.map((a) => this.value(a)));
  }

  /** Everything the page holds now: `$state`, and every widget's own variables by place. */
  snapshot(): Snapshot {
    return { xtmd: RELEASE, ir: this.irHash, state: this.state(), own: this.page?.observeOwn() ?? {} };
  }

  /** Puts a snapshot back. With the same IR, all of it; with another, `$state` only, as widgets'
   * places may now be other widgets. `$state` goes back as one checked write. */
  restore(snap: Snapshot): Restored {
    const page = this.page;
    if (!page) return { restored: "none", dropped: [], why: "the page isn't loaded yet" };
    if (!snap || typeof snap !== "object" || snap.xtmd !== RELEASE || typeof snap.state !== "object") {
      return { restored: "none", dropped: [], why: `a snapshot this xtmd (${RELEASE}) can't read` };
    }
    page.set(this.values(snap.state ?? {}));
    const o = page.takeOutcome();
    if (o.refused.length) {
      for (const r of o.refused) this.props.onError?.({ kind: "refused", ...r });
      return { restored: "none", dropped: o.refused.map((r) => r.site ?? r.rule ?? "$state"), why: o.refused[0].rule ?? o.refused[0].code };
    }
    if (snap.ir !== this.irHash) {
      this.changed();
      return { restored: "state", dropped: ["own"] };
    }
    const left = page.restoreOwn(snap.own ?? {});
    this.changed();
    return { restored: "all", dropped: left };
  }

  // ---- inside

  private value(x: ir.Expr | Value): Value {
    return typeof x === "object" && x !== null && "kind" in x ? (x as Value) : this.page!.value(x as ir.Expr);
  }

  private values(xs: Record<string, ir.Expr | Value>): Record<string, Value> {
    return Object.fromEntries(Object.entries(xs).map(([k, x]) => [k, this.value(x)]));
  }

  private async fetch(src: string): Promise<void> {
    this.loading = src;
    this.loadFailed = undefined;
    this.notify();
    let irFile: Ir;
    try {
      const r = await fetch(src);
      if (!r.ok) throw new Error(`${r.status} ${r.statusText}`);
      irFile = (await r.json()) as Ir;
    } catch (e) {
      if (this.loading !== src) return;
      this.loadFailed = `The page at ${src} couldn't be loaded: ${e instanceof Error ? e.message : String(e)}`;
      this.props.onError?.({ kind: "load", message: this.loadFailed });
      this.notify();
      return;
    }
    if (this.gone || this.loading !== src) return;
    this.loading = undefined;
    this.start(irFile, this.props.state ?? this.page?.observeState() ?? this.props.defaultState, this.page ? undefined : this.props.defaultSnapshot);
  }

  private start(irFile: Ir, given: Record<string, ir.Expr> | undefined, snap: Snapshot | undefined): void {
    this.unlisten?.();
    this.irHash = hash(JSON.stringify(irFile));
    const p = this.props;
    // `$state` as the app gives it, checked as an app's write is: what doesn't fit is refused
    const { page, outcome } = makePage(irFile, { page: p.page, externs: p.externs, fns: this.fns }, given);
    const registry = { ...core, ...(p.widgets ?? {}) };
    page.setSupplies((w) => Object.hasOwn(registry, w));
    this.page = page;
    this.tokens = new Tokens(page);
    this.shown = JSON.stringify(page.observeState());
    for (const r of outcome.refused) p.onError?.({ kind: "refused", ...r });
    if (snap) this.restore(snap);
    this.unlisten = page.onChange(() => this.changed());
    this.notify();
  }

  private notify(): void {
    this.version++;
    for (const l of this.listeners) l();
  }

  /** After a change the page drew: the target renders, then the app hears what changed. */
  changed(): void {
    this.notify();
    this.report();
  }

  /** The app hears what the page did, once what is happening now is done: `$state` if it changed,
   * the calls made, and what was refused. A write refused draws nothing new. */
  report(): void {
    if (this.queued) return;
    this.queued = true;
    queueMicrotask(() => {
      this.queued = false;
      if (!this.gone) this.deliver();
    });
  }

  private deliver(): void {
    const page = this.page;
    if (!page) return;
    const p = this.props;
    const state = page.observeState();
    const json = JSON.stringify(state);
    if (json !== this.shown) {
      this.shown = json;
      p.onStateChange?.(state);
    }
    const calls = page.takeCalls();
    if (calls.length) p.onCalls?.(calls);
    const o: Outcome = page.takeOutcome();
    for (const r of o.refused) p.onError?.({ kind: "refused", ...r });
    for (const f of o.failures) p.onError?.({ kind: "failed", ...f });
  }

  /** A widget asks for the plane's layout: after this render is in the document, or now when it
   * asks between renders (a spot's size changed, with nothing else). */
  private layout(): void {
    this.wantLayout = true;
    if (!this.rendering) this.settle();
  }

  /** The plane's layout, measured from the elements on the page, once a render is in. */
  private settle(): void {
    const page = this.page;
    const root = this.root;
    if (!page || !root || !this.wantLayout) return;
    this.wantLayout = false;
    const at = (path: string) => root.querySelector(`[data-xtmd-site="${CSS.escape(path)}"]`) as HTMLElement | null;
    const measure: Measure = this.props.measure?.(page) ?? {
      spot: (s) => {
        const el = at(s.path);
        return { width: Num.int(Math.max(0, el?.offsetWidth ?? 0)), height: Num.int(Math.max(0, el?.offsetHeight ?? 0)) };
      },
      planeWidth: (pl) => {
        const el = at(pl.path);
        const view = el?.querySelector?.("[data-part='plane.view']") as HTMLElement | null | undefined;
        return Num.int(Math.max(0, Math.round((view ?? el)?.clientWidth ?? 0)));
      },
    };
    try {
      runLayout(page, measure);
    } catch (f) {
      page.errors.push(f);
    }
  }
}
