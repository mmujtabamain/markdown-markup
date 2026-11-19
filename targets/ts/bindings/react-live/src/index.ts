"use client";
// @extended-mark/react-live: <XtmdLiveDoc source={text} />, an Extended Mark document compiled in the browser by
// @extended-mark/wasm as it is edited, and drawn by @extended-mark/react's <XtmdDoc>. A text that compiles replaces the
// page, keeping `$state` where its fields still exist; one that doesn't leaves the last page that
// did, and its errors reach `onError` ({ kind: "compile", diagnostics }). The run-time target,
// @extended-mark/react, ships no WebAssembly; this one does.

import { createElement, useEffect, useRef, useState, type ReactElement } from "react";
import { XtmdDoc, type XtmdDocProps } from "@extended-mark/react";
import { Live, type LiveProps } from "@extended-mark/live";

export interface XtmdLiveDocProps extends Omit<XtmdDocProps, "ir" | "src">, LiveProps {}

/**
 * An Extended Mark document from its text. `wasm` is where xtmd.wasm is (`@extended-mark/wasm/xtmd.wasm` as the
 * bundler gives its URL), or `compiler` a compiler in hand; given one already loaded, the first
 * render has the page, on a server too. The rest is <XtmdDoc>'s, `ref` its handle.
 */
export function XtmdLiveDoc({ source, path, packs, wasm, compiler, ...props }: XtmdLiveDocProps): ReactElement {
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
  return createElement(XtmdDoc, { ...props, ir: live.current.ir });
}

export { Compiler, compiler, type Builds, type LiveProps, type PackFile, type WasmSource } from "@extended-mark/live";
export type { XtmdDocHandle, XtmdDocProps } from "@extended-mark/react";
export type { DocError, Restored, Snapshot } from "@extended-mark/view";
