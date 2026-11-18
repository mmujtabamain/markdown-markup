// @mkp/svelte-live: an MKP document compiled in the browser as it is edited, in a Svelte 5 app.
// The run-time target, @mkp/svelte, ships no WebAssembly; this one does.

export { default as MkpLiveDoc } from "./MkpLiveDoc.svelte";
export { Compiler, compiler, type Builds, type LiveProps, type PackFile, type WasmSource } from "@mkp/live";
export type { DocError, DocProps, Restored, Snapshot } from "@mkp/view";
