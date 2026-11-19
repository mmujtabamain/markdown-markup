// @extended-mark/embed-live: the plain web's real-time target. `new XtmdLiveDoc(element, { source })`
// compiles a document's text in the browser with @extended-mark/wasm as it is edited, and draws it with
// @extended-mark/embed's XtmdDoc (@extended-mark/dom's widgets). A text that compiles replaces the page, keeping
// `$state` where its fields still exist; one that doesn't leaves the last page that did, and its
// errors reach `onError` ({ kind: "compile", diagnostics }). When to change `source` (each key, a
// pause, a save) is the app's. The run-time target, @extended-mark/embed, ships no WebAssembly; this one does.

import { XtmdDoc, type DocProps, type Given, type Restored, type Snapshot } from "@extended-mark/embed";
import { Live, type LiveProps } from "@extended-mark/live";
import type { Mounted, Page } from "@extended-mark/dom";
import type { ir } from "@extended-mark/runtime";

export interface LiveDocProps extends Omit<DocProps, "ir" | "src">, LiveProps {}

/** A document from its text, drawn by @extended-mark/dom into an element, following the props it is given. */
export class XtmdLiveDoc {
  private props: LiveDocProps;
  private readonly doc: XtmdDoc;
  private readonly live: Live;

  /** `wasm` is where xtmd.wasm is (`@extended-mark/wasm/xtmd.wasm` as the bundler gives its URL), or
   * `compiler` a compiler in hand. */
  constructor(readonly root: HTMLElement, props: LiveDocProps) {
    this.props = props;
    this.doc = new XtmdDoc(root, this.docProps(props));
    this.live = new Live(() => this.doc.update(this.docProps(this.props)));
    this.live.update(props, (e) => this.props.onError?.(e));
  }

  /** The props changed: a new `source` is compiled, the rest is XtmdDoc's. */
  update(next: LiveDocProps): void {
    this.props = next;
    this.doc.update(this.docProps(next));
    this.live.update(next, (e) => this.props.onError?.(e));
  }

  /** Unmounts the page and empties the element. */
  destroy(): void {
    this.live.destroy();
    this.doc.destroy();
  }

  /** The latest text's diagnostics, warnings included. */
  get diagnostics() {
    return this.live.diagnostics;
  }

  /** The running page: the last text that compiled. */
  get running(): Page | undefined {
    return this.doc.running;
  }

  get mounted(): Mounted | undefined {
    return this.doc.mounted;
  }

  // ---- XtmdDoc's handle

  set(changes: Record<string, Given>): void {
    this.doc.set(changes);
  }

  state(): Record<string, ir.Expr> {
    return this.doc.state();
  }

  markdown(): string {
    return this.doc.markdown();
  }

  expose(channel: string, name: string, ...args: Given[]): void {
    this.doc.expose(channel, name, ...args);
  }

  extern(channel: string, values: Record<string, Given>): void {
    this.doc.extern(channel, values);
  }

  snapshot(): Snapshot {
    return this.doc.snapshot();
  }

  restore(snap: Snapshot): Restored {
    return this.doc.restore(snap);
  }

  private docProps(p: LiveDocProps): DocProps {
    const { source: _s, path: _p, packs: _k, wasm: _w, compiler: _c, ...rest } = p;
    return { ...rest, ir: this.live?.ir };
  }
}

export { Compiler, compiler, type Builds, type LiveProps, type PackFile, type WasmSource } from "@extended-mark/live";
export type { DocError, DocProps, Restored, Snapshot } from "@extended-mark/embed";
