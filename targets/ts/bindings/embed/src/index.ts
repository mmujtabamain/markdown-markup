// @mkp/embed: an MKP page in an element, for the framework bindings. Each binding (@mkp/react,
// @mkp/vue, @mkp/svelte, @mkp/solid, @mkp/angular) makes one Embed when its element is in the
// document, hands it the props it was given whenever they change, and destroys it when it leaves.
// Everything else is here, so the bindings agree: how a page is made from the props, what a change
// of props does to it, and when the app hears what the page did.

import { toIr, type Call, type Outcome, type Page, type PageOptions, type PageValues, type Value, type ir } from "@mkp/runtime";
import { mount, type MountOptions, type Mounted, type Widget } from "@mkp/dom";
import { channelName, channelsOf, empty, isValue, makePage, moduleOf, type Given, type Ir } from "./page.js";

export { channelName, makePage, stateFields, type Given, type Ir } from "./page.js";
export { RELEASE, hash, type DocError, type Restored, type Snapshot } from "./snapshot.js";
export { MkpDoc, type DocProps } from "./doc.js";

/** What every binding takes: the page, what the app gives it, and what the app wants to hear. */
export interface PageProps {
  /** The page's IR. A new one remounts the page, keeping `$state` where its fields still exist. */
  ir: Ir;
  /** `$state` to start from, in the IR's form, over its starting values. Read when the page is
   * mounted, and checked as an app's write is: a field that doesn't fit keeps its starting value. */
  state?: Record<string, ir.Expr>;
  /** The page's own values: its width and theme. A change calls `page.setPage`. */
  page?: PageValues;
  /** Each extern channel's values, in the IR's form, by its name in the document (`tracker`) or
   * its full name (`doc/tracker`). A changed channel calls `page.setExtern`. */
  externs?: Record<string, Record<string, ir.Expr>>;
  /** Value fns the app supplies, by full name (`acme/rate`). The latest are always the ones called. */
  fns?: PageOptions["fns"];
  /** The app's widgets by full name (`core/press`), in place of @mkp/dom's. A change remounts. */
  widgets?: Record<string, Widget>;
  /** How the plane's spots are measured, for the page it is given: left out, from the DOM. The
   * checks give fixed sizes. */
  measure?: (page: Page) => NonNullable<MountOptions["measure"]>;
  /** The app's extern fns the page called, after each change that called any. */
  onCalls?: (calls: Call[], handle: Handle) => void;
  /** `$state`, in the IR's form, after each change to it. */
  onState?: (state: Record<string, ir.Expr>, handle: Handle) => void;
  /** Writes that were refused and failures, after each change that had any. */
  onOutcome?: (outcome: Outcome, handle: Handle) => void;
  /** The page was drawn: when it is mounted, and again after each remount. */
  onMount?: (mounted: Mounted, handle: Handle) => void;
}

/** What an app holds to reach the page: a binding's ref, or `usePage()`. */
export interface Handle {
  /** The running page. */
  readonly page: Page;
  /** The page as @mkp/dom drew it. */
  readonly mounted: Mounted;
  /** Writes `$state` fields as one change, checked as every change is: refused whole, or done. */
  set(changes: Record<string, Given>): void;
  /** Calls a fn the document exposes: `expose("tracker", "clear_done")`. A channel is named as the
   * document names it, or in full (`doc/tracker`). */
  expose(channel: string, name: string, ...args: Given[]): void;
  /** Gives a channel's extern values. They are kept when the page is remounted. */
  extern(channel: string, values: Record<string, Given>): void;
  /** `$state` now, in the IR's form. */
  state(): Record<string, ir.Expr>;
  /** The page as Markdown, with the values it has now. */
  markdown(): string;
}

type Channels = Record<string, Record<string, ir.Expr>>;

function sameRecord(a: object | undefined, b: object | undefined): boolean {
  if (a === b) return true;
  if (!a || !b) return false;
  const ka = Object.keys(a);
  if (ka.length !== Object.keys(b).length) return false;
  return ka.every((k) => (a as Record<string, unknown>)[k] === (b as Record<string, unknown>)[k]);
}

function sameJson(a: unknown, b: unknown): boolean {
  return a === b || JSON.stringify(a) === JSON.stringify(b);
}

/**
 * An MKP page drawn into an element by @mkp/dom, following the props it is given. The bindings make
 * one when their element is in the document (never on a server) and destroy it when it leaves.
 */
export class Embed implements Handle {
  private props: PageProps;
  private current: Mounted | undefined;
  private unlisten: (() => void) | undefined;
  /** The extern values the app gave, by props or through the handle, by each channel's full name:
   * kept across remounts. */
  private readonly channels: Channels;
  /** `$state` as onState last heard it. */
  private shown: string | undefined;
  /** What a page had for the app when it was replaced, and what remounting refused. */
  private held: { calls: Call[]; outcome: Outcome } = { calls: [], outcome: empty() };
  private queued = false;
  private gone = false;
  /** The page reads its value fns through this, so it always calls the latest props' fns. */
  private readonly fns: NonNullable<PageOptions["fns"]>;

  constructor(readonly root: HTMLElement, props: PageProps) {
    this.props = props;
    this.fns = new Proxy({}, { get: (_t, name) => (typeof name === "string" ? this.props.fns?.[name] : undefined) });
    this.channels = channelsOf(moduleOf(props.ir), props.externs);
    this.start(props.state, true);
  }

  get mounted(): Mounted {
    if (!this.current) throw new Error("@mkp/embed: the page isn't mounted");
    return this.current;
  }

  get page(): Page {
    return this.mounted.page;
  }

  /** Whether the page is drawn now: false once destroyed. */
  get live(): boolean {
    return !this.gone && this.current !== undefined;
  }

  /** The binding's props changed: do what each change means. */
  update(next: PageProps): void {
    const prev = this.props;
    this.props = next;
    if (this.gone) return;
    const changed: Channels = {};
    if (next.externs !== prev.externs) {
      const module = moduleOf(next.ir);
      for (const [c, values] of Object.entries(next.externs ?? {})) {
        if (sameJson(values, prev.externs?.[c])) continue;
        const full = channelName(module, c);
        changed[full] = values;
        this.channels[full] = { ...this.channels[full], ...values };
      }
    }
    if (next.ir !== prev.ir || !sameRecord(next.widgets, prev.widgets)) {
      // a new page: $state carried over where its fields still exist, the app's values given again
      this.start(this.page.observeState(), false);
      return;
    }
    if (next.page && !sameRecord(next.page, prev.page)) this.page.setPage(next.page);
    for (const [c, values] of Object.entries(changed)) this.page.setExtern(c, this.values(values));
  }

  /** Unmounts the page and empties the element. The embed can't be used again. */
  destroy(): void {
    if (this.gone) return;
    this.gone = true;
    this.stop();
    this.root.replaceChildren();
  }

  // ---- the handle

  set(changes: Record<string, Given>): void {
    this.page.set(this.values(changes));
    // a refused write doesn't redraw, so nothing else would tell the app
    this.changed();
  }

  expose(channel: string, name: string, ...args: Given[]): void {
    this.page.expose(channelName(this.page.module, channel), name, args.map((a) => this.value(a)));
  }

  extern(name: string, values: Record<string, Given>): void {
    const channel = channelName(this.page.module, name);
    const vs = this.values(values);
    this.channels[channel] = { ...this.channels[channel], ...Object.fromEntries(Object.entries(vs).map(([k, v]) => [k, toIr(v)])) };
    this.page.setExtern(channel, vs);
  }

  state(): Record<string, ir.Expr> {
    return this.page.observeState();
  }

  markdown(): string {
    return this.page.markdown();
  }

  // ---- inside

  private value(x: Given): Value {
    return isValue(x) ? x : this.page.value(x);
  }

  private values(xs: Record<string, Given>): Record<string, Value> {
    return Object.fromEntries(Object.entries(xs).map(([k, x]) => [k, this.value(x)]));
  }

  private start(given: Record<string, ir.Expr> | undefined, first: boolean): void {
    const p = this.props;
    this.stop();
    const { page, outcome } = makePage(p.ir, { page: p.page, externs: this.channels, fns: this.fns }, given, first);
    this.held.outcome.refused.push(...outcome.refused);
    this.held.outcome.failures.push(...outcome.failures);
    // whatever was in the element (a server's pre-rendered Markdown) gives way to the page
    this.root.replaceChildren();
    const mounted = mount(page, this.root, { widgets: p.widgets, measure: p.measure?.(page) });
    this.current = mounted;
    this.unlisten = page.onChange(() => this.changed());
    if (first) this.shown = JSON.stringify(page.observeState());
    p.onMount?.(mounted, this);
    this.changed();
  }

  private stop(): void {
    this.unlisten?.();
    this.unlisten = undefined;
    const m = this.current;
    if (!m) return;
    this.current = undefined;
    // what the old page had for the app still reaches it
    this.held.calls.push(...m.page.takeCalls());
    const o = m.page.takeOutcome();
    this.held.outcome.refused.push(...o.refused);
    this.held.outcome.failures.push(...o.failures);
    m.unmount();
  }

  /** After a change: the app hears about it once the change is done and drawn. */
  private changed(): void {
    if (this.queued) return;
    this.queued = true;
    queueMicrotask(() => {
      this.queued = false;
      if (!this.gone && this.current) this.deliver();
    });
  }

  private deliver(): void {
    const p = this.props;
    const page = this.page;
    const state = page.observeState();
    const json = JSON.stringify(state);
    if (json !== this.shown) {
      this.shown = json;
      p.onState?.(state, this);
    }
    if (p.onCalls) {
      const calls = [...this.held.calls, ...page.takeCalls()];
      this.held.calls = [];
      if (calls.length) p.onCalls(calls, this);
    }
    if (p.onOutcome) {
      const o = page.takeOutcome();
      const outcome = { refused: [...this.held.outcome.refused, ...o.refused], failures: [...this.held.outcome.failures, ...o.failures] };
      this.held.outcome = empty();
      if (outcome.refused.length || outcome.failures.length) p.onOutcome(outcome, this);
    }
  }
}

/** Makes an embed: the same as `new Embed(root, props)`. */
export function embed(root: HTMLElement, props: PageProps): Embed {
  return new Embed(root, props);
}

export type { Call, Outcome, Page, PageValues, Value, ir } from "@mkp/runtime";
export type { Mounted, Widget } from "@mkp/dom";
