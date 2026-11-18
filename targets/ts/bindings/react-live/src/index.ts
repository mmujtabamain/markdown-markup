"use client";
// @mkp/react-live: <MkpLiveDoc source={text} />, an MKP document compiled in the browser by
// @mkp/wasm as it is edited, and drawn by @mkp/react's <MkpDoc>. A text that compiles replaces the
// page, keeping `$state` where its fields still exist; one that doesn't leaves the last page that
// did, and its errors reach `onError` ({ kind: "compile", diagnostics }). The run-time target,
// @mkp/react, ships no WebAssembly; this one does.

import { createElement, useEffect, useRef, useState, type ReactElement } from "react";
import { MkpDoc, type MkpDocProps } from "@mkp/react";
import { Live, type LiveProps } from "@mkp/live";

export interface MkpLiveDocProps extends Omit<MkpDocProps, "ir" | "src">, LiveProps {}

/**
 * An MKP document from its text. `wasm` is where mkp.wasm is (`@mkp/wasm/mkp.wasm` as the
 * bundler gives its URL), or `compiler` a compiler in hand; given one already loaded, the first
 * render has the page, on a server too. The rest is <MkpDoc>'s, `ref` its handle.
 */
export function MkpLiveDoc({ source, path, packs, wasm, compiler, ...props }: MkpLiveDocProps): ReactElement {
  const [, redraw] = useState(0);
  const onError = useRef(props.onError);
  onError.current = props.onError;
  const live = useRef<Live | null>(null);
  if (!live.current) {
    live.current = new Live(() => redraw((n) => n + 1));
    // a compiler in hand compiles now, so a server renders the page
    if (compiler) live.current.update({ source, path, packs, wasm, compiler }, (e) => onError.current?.(e));
  }
  useEffect(() => {
    live.current!.update({ source, path, packs, wasm, compiler }, (e) => onError.current?.(e));
  }, [source, path, packs, wasm, compiler]);
  // nothing to stop on unmount: a late compile's redraw of an unmounted component does nothing,
  // and StrictMode's rehearsed unmount must leave it working
  return createElement(MkpDoc, { ...props, ir: live.current.ir });
}

export { Compiler, compiler, type Builds, type LiveProps, type PackFile, type WasmSource } from "@mkp/live";
export type { MkpDocHandle, MkpDocProps } from "@mkp/react";
export type { DocError, Restored, Snapshot } from "@mkp/view";
