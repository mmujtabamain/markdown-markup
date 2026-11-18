// What every real-time target shares: a document's text compiled in the browser by @mkp/wasm,
// into the IR a run-time target's <MkpDoc> draws. A text that compiles replaces the page (its
// `$state` carried over where its fields still exist); one that doesn't leaves the last page that
// did, and its errors go to the app, so a preview keeps up with an editor and only a broken draft
// waits. When to compile (each key, a pause, a save) is the app's: it changes `source`.

import { Compiler, type Built, type PackFile, type WasmSource } from "@mkp/wasm";
import type { DocError } from "@mkp/view";
import type { Ir } from "@mkp/embed";

export { Compiler, type Built, type PackFile, type WasmSource } from "@mkp/wasm";

/** What compiles a text: @mkp/wasm's compiler, or anything that builds the same way, such as one
 * the app runs in a worker, which answers with a promise. */
export interface Builds {
  build(path: string, text: string, packs?: PackFile[]): Built | Promise<Built>;
}

/** What a real-time target is given besides a run-time target's props. */
export interface LiveProps {
  /** The document's text. */
  source: string;
  /** Its path, for diagnostics and to say it is a document: `page.mkp.md` when left out. */
  path?: string;
  /** The files of the packs it uses. */
  packs?: PackFile[];
  /** Where mkp.wasm is, when the compiler isn't given: its URL, its bytes or the module. */
  wasm?: WasmSource;
  /** The compiler: left out, one loaded from `wasm` and shared by every document on the page. */
  compiler?: Builds;
}

const loaded = new Map<unknown, Promise<Compiler>>();

/** The compiler for `wasm`, loaded once for the page. */
export function compiler(wasm?: WasmSource): Promise<Compiler> {
  let c = loaded.get(wasm);
  if (!c) {
    c = Compiler.load(wasm);
    // a load that failed may be tried again
    c.catch(() => loaded.delete(wasm));
    loaded.set(wasm, c);
  }
  return c;
}

/** One document's text, followed: `ir` is the last that compiled, `diagnostics` the latest text's. */
export class Live {
  /** The IR to draw: undefined until a text has compiled. */
  ir: Ir | undefined;
  /** The latest text's diagnostics, warnings included. */
  diagnostics: Built["diagnostics"] = [];
  private props: LiveProps | undefined;
  private builds: Builds | undefined;
  private wanted = "";
  private done = "";
  private seq = 0;
  private gone = false;

  /** `changed` is called when `ir` or `diagnostics` change; `onError` hears a text that didn't
   * compile, or a compiler that couldn't be loaded. */
  constructor(private readonly changed: () => void, private onError?: (e: DocError) => void) {}

  /** The target's props, each time they change. */
  update(props: LiveProps, onError?: (e: DocError) => void): void {
    this.props = props;
    this.onError = onError;
    const key = JSON.stringify([props.path ?? "page.mkp.md", props.source, props.packs ?? []]);
    if (key === this.wanted) return;
    this.wanted = key;
    if (props.compiler) {
      this.builds = props.compiler;
      this.compile();
    } else if (this.builds) this.compile();
    else {
      compiler(props.wasm).then(
        (c) => {
          if (this.gone) return;
          this.builds = c;
          this.compile();
        },
        (e) => this.onError?.({ kind: "load", message: e instanceof Error ? e.message : String(e) }),
      );
    }
  }

  destroy(): void {
    this.gone = true;
  }

  private compile(): void {
    const p = this.props!;
    const key = this.wanted;
    if (key === this.done) return;
    const seq = ++this.seq;
    const path = p.path ?? "page.mkp.md";
    let built: Built | Promise<Built>;
    try {
      built = this.builds!.build(path, p.source, p.packs ?? []);
    } catch (e) {
      this.onError?.({ kind: "compile", message: e instanceof Error ? e.message : String(e), diagnostics: [] });
      return;
    }
    const take = (b: Built) => {
      // a text changed again while this one was compiling: the later one wins
      if (this.gone || seq !== this.seq) return;
      this.done = key;
      this.diagnostics = b.diagnostics;
      if (b.ir) this.ir = b.ir as unknown as Ir;
      else {
        const first = b.diagnostics.find((d) => d.severity === "error");
        const where = first ? `${first.file}:${first.line}:${first.column}: ${first.message}` : "it has errors";
        this.onError?.({ kind: "compile", message: `${path} doesn't compile (${b.errors} error${b.errors === 1 ? "" : "s"}): ${where}`, diagnostics: b.diagnostics });
      }
      this.changed();
    };
    if (built instanceof Promise) built.then(take, (e) => seq === this.seq && this.onError?.({ kind: "compile", message: e instanceof Error ? e.message : String(e), diagnostics: [] }));
    else take(built);
  }
}
