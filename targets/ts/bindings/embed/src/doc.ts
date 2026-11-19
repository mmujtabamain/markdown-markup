// XtmdDoc: a document in an element, the plain web's run-time target, drawn by @extended-mark/dom. It is
// made from its IR, in hand or fetched from a URL. `$state` is the app's to control or to start
// from. Every write is checked by xtmd, and what is refused reaches `onError`. A snapshot takes
// everything the page holds out and puts it back. It is the plain web's twin of the frameworks'
// <XtmdDoc> (@extended-mark/view), with the same props, on Embed. There is no compiler here: @extended-mark/embed-live
// compiles a document's text.

import type { Mounted, Widget } from "@extended-mark/dom";
import type { Call, Page, PageOptions, PageValues, Value, ir } from "@extended-mark/runtime";
import { Embed, type PageProps } from "./index.js";
import type { Given, Ir } from "./page.js";
import { RELEASE, hash, type DocError, type Restored, type Snapshot } from "./snapshot.js";

/** What a document is given: the same in the plain web as in every framework. */
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
  /** The app's widgets by full name, in place of @extended-mark/dom's, or a pack's. */
  widgets?: Record<string, Widget>;
  /** How the plane's spots are measured: left out, from the DOM. The checks give fixed sizes. */
  measure?: PageProps["measure"];
  /** `$state` after each change to it. */
  onStateChange?: (state: Record<string, ir.Expr>) => void;
  /** A write xtmd refused, a widget that failed, or an IR that couldn't be had. */
  onError?: (error: DocError) => void;
  /** The app's extern fns the page called, after each change that called any. */
  onCalls?: (calls: Call[]) => void;
  /** The page was drawn: at the start, and again after each new IR. */
  onMount?: (mounted: Mounted) => void;
}

function same(a: unknown, b: unknown): boolean {
  return a === b || JSON.stringify(a) === JSON.stringify(b);
}

/** A document drawn by @extended-mark/dom into an element, following the props it is given. */
export class XtmdDoc {
  private props: DocProps;
  private embed: Embed | undefined;
  private irHash = "";
  private loading: string | undefined;
  private gone = false;

  constructor(readonly root: HTMLElement, props: DocProps) {
    this.props = props;
    if (props.ir) this.start(props.ir);
    else if (props.src) void this.fetch(props.src);
    else this.waiting();
  }

  /** The running page, once it has its IR. */
  get running(): Page | undefined {
    return this.embed?.live ? this.embed.page : undefined;
  }

  /** The page as @extended-mark/dom drew it, once it has its IR. */
  get mounted(): Mounted | undefined {
    return this.embed?.live ? this.embed.mounted : undefined;
  }

  /** The props changed: do what each change means. */
  update(next: DocProps): void {
    const prev = this.props;
    this.props = next;
    if (this.gone) return;
    if (next.ir && next.ir !== prev.ir) {
      this.loadedIr = next.ir;
      this.irHash = hash(JSON.stringify(next.ir));
      // a new page: `$state` carried over where its fields still exist (Embed's own rule)
      if (this.embed) this.embed.update(this.embedProps(next, next.ir));
      else this.start(next.ir);
      if (next.state && !same(next.state, this.state())) this.embed!.set(next.state);
      return;
    }
    if (!next.ir && next.src && next.src !== prev.src) {
      void this.fetch(next.src);
      return;
    }
    const e = this.embed;
    if (!e) return;
    e.update(this.embedProps(next, this.loadedIr!));
    // controlled: a new `state` from the app is a checked write; refused, the page keeps the last that fit
    if (next.state && !same(next.state, prev.state) && !same(next.state, this.state())) e.set(next.state);
  }

  /** Unmounts the page and empties the element. The document can't be used again. */
  destroy(): void {
    this.gone = true;
    this.embed?.destroy();
    this.root.replaceChildren();
  }

  // ---- the handle

  /** Writes `$state` fields as one change, checked: refused whole (told to onError), or done. */
  set(changes: Record<string, Given>): void {
    this.embed?.set(changes);
  }

  /** `$state` now. */
  state(): Record<string, ir.Expr> {
    return this.running?.observeState() ?? {};
  }

  /** The page as Markdown, with the values it has now. */
  markdown(): string {
    return this.running?.markdown() ?? "";
  }

  /** Calls a fn the document exposes, on its channel (`app`, or in full). */
  expose(channel: string, name: string, ...args: Given[]): void {
    this.embed?.expose(channel, name, ...args);
  }

  /** Gives a channel's values. */
  extern(channel: string, values: Record<string, Given>): void {
    this.embed?.extern(channel, values);
  }

  /** Everything the page holds now: `$state`, and every widget's own variables by place. */
  snapshot(): Snapshot {
    return { xtmd: RELEASE, ir: this.irHash, state: this.state(), own: this.running?.observeOwn() ?? {} };
  }

  /** Puts a snapshot back. With the same IR, all of it; with another, `$state` only, as widgets'
   * places may now be other widgets. `$state` goes back as one checked write. */
  restore(snap: Snapshot): Restored {
    const page = this.running;
    if (!page) return { restored: "none", dropped: [], why: "the page isn't loaded yet" };
    if (!snap || typeof snap !== "object" || snap.xtmd !== RELEASE || typeof snap.state !== "object") {
      return { restored: "none", dropped: [], why: `a snapshot this xtmd (${RELEASE}) can't read` };
    }
    page.set(Object.fromEntries(Object.entries(snap.state).map(([k, x]) => [k, page.value(x) as Value])));
    const o = page.takeOutcome();
    for (const f of o.failures) this.props.onError?.({ kind: "failed", ...f });
    if (o.refused.length) {
      for (const r of o.refused) this.props.onError?.({ kind: "refused", ...r });
      return { restored: "none", dropped: o.refused.map((r) => r.site ?? r.rule ?? "$state"), why: o.refused[0].rule ?? o.refused[0].code };
    }
    if (snap.ir !== this.irHash) return { restored: "state", dropped: ["own"] };
    return { restored: "all", dropped: page.restoreOwn(snap.own ?? {}) };
  }

  // ---- inside

  /** The IR drawn now: the one given, or the one fetched. */
  private loadedIr: Ir | undefined;

  private waiting(why?: string): void {
    const box = document.createElement("div");
    box.className = "xtmd-root";
    box.setAttribute("data-xtmd-root", "");
    if (why) {
      const n = document.createElement("div");
      n.className = "xtmd-notice";
      n.setAttribute("role", "alert");
      n.textContent = why;
      box.append(n);
    } else box.setAttribute("data-xtmd-loading", "");
    this.root.replaceChildren(box);
  }

  private embedProps(p: DocProps, irFile: Ir): PageProps {
    return {
      ir: irFile,
      state: p.state ?? p.defaultState,
      page: p.page,
      externs: p.externs,
      fns: p.fns,
      widgets: p.widgets,
      measure: p.measure,
      onState: (s) => this.props.onStateChange?.(s),
      onCalls: (c) => this.props.onCalls?.(c),
      onOutcome: (o) => {
        for (const r of o.refused) this.props.onError?.({ kind: "refused", ...r });
        for (const f of o.failures) this.props.onError?.({ kind: "failed", ...f });
      },
      onMount: (m) => this.props.onMount?.(m),
    };
  }

  private start(irFile: Ir): void {
    this.loadedIr = irFile;
    this.irHash = hash(JSON.stringify(irFile));
    this.embed = new Embed(this.root, this.embedProps(this.props, irFile));
    const snap = this.props.defaultSnapshot;
    if (snap && !this.props.state) this.restore(snap);
  }

  private async fetch(src: string): Promise<void> {
    this.loading = src;
    if (!this.embed) this.waiting();
    let irFile: Ir;
    try {
      const r = await fetch(src);
      if (!r.ok) throw new Error(`${r.status} ${r.statusText}`);
      irFile = (await r.json()) as Ir;
    } catch (e) {
      if (this.loading !== src || this.gone) return;
      const message = `The page at ${src} couldn't be loaded: ${e instanceof Error ? e.message : String(e)}`;
      this.props.onError?.({ kind: "load", message });
      if (!this.embed) this.waiting(message);
      return;
    }
    if (this.gone || this.loading !== src) return;
    this.loading = undefined;
    if (this.embed) {
      this.loadedIr = irFile;
      this.irHash = hash(JSON.stringify(irFile));
      this.embed.update(this.embedProps(this.props, irFile));
    } else this.start(irFile);
  }
}

