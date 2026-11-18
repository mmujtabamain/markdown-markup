// @mkp/embed-live: the plain web's real-time target. `new MkpLiveDoc(element, { source })`
// compiles a document's text in the browser with @mkp/wasm as it is edited, and draws it with
// @mkp/embed's MkpDoc (@mkp/dom's widgets). A text that compiles replaces the page, keeping
// `$state` where its fields still exist; one that doesn't leaves the last page that did, and its
// errors reach `onError` ({ kind: "compile", diagnostics }). When to change `source` (each key, a
// pause, a save) is the app's. The run-time target, @mkp/embed, ships no WebAssembly; this one does.

import { MkpDoc, type DocProps, type Given, type Restored, type Snapshot } from "@mkp/embed";
import { Live, type LiveProps } from "@mkp/live";
import type { Mounted, Page } from "@mkp/dom";
import type { ir } from "@mkp/runtime";

export interface LiveDocProps extends Omit<DocProps, "ir" | "src">, LiveProps {}

/** A document from its text, drawn by @mkp/dom into an element, following the props it is given. */
export class MkpLiveDoc {
  private props: LiveDocProps;
  private readonly doc: MkpDoc;
  private readonly live: Live;

  /** `wasm` is where mkp.wasm is (`@mkp/wasm/mkp.wasm` as the bundler gives its URL), or
   * `compiler` a compiler in hand. */
  constructor(readonly root: HTMLElement, props: LiveDocProps) {
    this.props = props;
    this.doc = new MkpDoc(root, this.docProps(props));
    this.live = new Live(() => this.doc.update(this.docProps(this.props)));
    this.live.update(props, (e) => this.props.onError?.(e));
  }

  /** The props changed: a new `source` is compiled, the rest is MkpDoc's. */
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

  // ---- MkpDoc's handle

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

export { Compiler, compiler, type Builds, type LiveProps, type PackFile, type WasmSource } from "@mkp/live";
export type { DocError, DocProps, Restored, Snapshot } from "@mkp/embed";
