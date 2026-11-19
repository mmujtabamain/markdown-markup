// @extended-mark/svelte-live: an Extended Mark document compiled in the browser as it is edited, in a Svelte 5 app.
// The run-time target, @extended-mark/svelte, ships no WebAssembly; this one does.

export { default as XtmdLiveDoc } from "./XtmdLiveDoc.svelte";
export { Compiler, compiler, type Builds, type LiveProps, type PackFile, type WasmSource } from "@extended-mark/live";
export type { DocError, DocProps, Restored, Snapshot } from "@extended-mark/view";
