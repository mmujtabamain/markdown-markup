// @mkp/solid-live: <MkpLiveDoc source={text()} />, an MKP document compiled in the browser by
// @mkp/wasm as it is edited, and drawn by @mkp/solid's <MkpDoc>. A text that compiles replaces the
// page, keeping `$state` where its fields still exist; one that doesn't leaves the last page that
// did, and its errors reach `onError` ({ kind: "compile", diagnostics }). The run-time target,
// @mkp/solid, ships no WebAssembly; this one does. Written without JSX.

import { createComponent, createEffect, createSignal, mergeProps, onCleanup, splitProps, untrack, type JSX } from "solid-js";
import { MkpDoc, type MkpDocProps } from "@mkp/solid";
import { Live, type LiveProps } from "@mkp/live";
import type { Ir } from "@mkp/embed";

export interface MkpLiveDocProps extends Omit<MkpDocProps, "ir" | "src">, LiveProps {}

const LIVE = ["source", "path", "packs", "wasm", "compiler"] as const;

/**
 * An MKP document from its text. `wasm` is where mkp.wasm is (`@mkp/wasm/mkp.wasm` as the
 * bundler gives its URL), or `compiler` a compiler in hand; given one already loaded, the first
 * render has the page, on a server too. The rest is <MkpDoc>'s, `ref` its handle.
 */
export function MkpLiveDoc(props: MkpLiveDocProps): JSX.Element {
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
    MkpDoc,
    mergeProps(rest, {
      get ir() {
        return ir();
      },
    }),
  );
}

export { Compiler, compiler, type Builds, type LiveProps, type PackFile, type WasmSource } from "@mkp/live";
export type { MkpDocHandle, MkpDocProps } from "@mkp/solid";
export type { DocError, Restored, Snapshot } from "@mkp/view";
