// @extended-mark/solid-live: <XtmdLiveDoc source={text()} />, an Extended Mark document compiled in the browser by
// @extended-mark/wasm as it is edited, and drawn by @extended-mark/solid's <XtmdDoc>. A text that compiles replaces the
// page, keeping `$state` where its fields still exist; one that doesn't leaves the last page that
// did, and its errors reach `onError` ({ kind: "compile", diagnostics }). The run-time target,
// @extended-mark/solid, ships no WebAssembly; this one does. Written without JSX.

import { createComponent, createEffect, createSignal, mergeProps, onCleanup, splitProps, untrack, type JSX } from "solid-js";
import { XtmdDoc, type XtmdDocProps } from "@extended-mark/solid";
import { Live, type LiveProps } from "@extended-mark/live";
import type { Ir } from "@extended-mark/embed";

export interface XtmdLiveDocProps extends Omit<XtmdDocProps, "ir" | "src">, LiveProps {}

const LIVE = ["source", "path", "packs", "wasm", "compiler"] as const;

/**
 * An Extended Mark document from its text. `wasm` is where xtmd.wasm is (`@extended-mark/wasm/xtmd.wasm` as the
 * bundler gives its URL), or `compiler` a compiler in hand; given one already loaded, the first
 * render has the page, on a server too. The rest is <XtmdDoc>'s, `ref` its handle.
 */
export function XtmdLiveDoc(props: XtmdLiveDocProps): JSX.Element {
  const [given, rest] = splitProps(props, LIVE);
  const [ir, setIr] = createSignal<Ir | undefined>(undefined, { equals: false });
  const live = new Live(() => setIr(() => live.ir));
  const current = () => ({ source: given.source, path: given.path, packs: given.packs, wasm: given.wasm, compiler: given.compiler });
  // a compiler in hand compiles now, so a server renders the page
  untrack(() => {
    if (given.compiler) live.update(current(), (e) => props.onError?.(e));
    setIr(() => live.ir);
  });
  createEffect(() => live.update(current(), (e) => props.onError?.(e)));
  onCleanup(() => live.destroy());
  return createComponent(
    XtmdDoc,
    mergeProps(rest, {
      get ir() {
        return ir();
      },
    }),
  );
}

export { Compiler, compiler, type Builds, type LiveProps, type PackFile, type WasmSource } from "@extended-mark/live";
export type { XtmdDocHandle, XtmdDocProps } from "@extended-mark/solid";
export type { DocError, Restored, Snapshot } from "@extended-mark/view";
