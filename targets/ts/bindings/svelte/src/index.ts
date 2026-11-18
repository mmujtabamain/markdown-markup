// @mkp/svelte: MKP documents in Svelte 5, the run-time target. <MkpDoc src={…}> or <MkpDoc ir={…}> draws
// a page from an IR built ahead with Svelte's own elements (MkpDoc.svelte, MkpNode.svelte), on a
// server and in the browser. The real-time target is @mkp/svelte-live.

export { default as MkpDoc } from "./MkpDoc.svelte";
export { default as MkpNode } from "./MkpNode.svelte";
export type { DocError, DocProps, Restored, Snapshot, ViewContext, ViewWidget } from "@mkp/view";
export type { Call, Given, Ir, Outcome, Page, PageValues, Value, ir } from "@mkp/embed";
