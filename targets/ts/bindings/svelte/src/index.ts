// @extended-mark/svelte: Extended Mark documents in Svelte 5, the run-time target. <XtmdDoc src={…}> or <XtmdDoc ir={…}> draws
// a page from an IR built ahead with Svelte's own elements (XtmdDoc.svelte, XtmdNode.svelte), on a
// server and in the browser. The real-time target is @extended-mark/svelte-live.

export { default as XtmdDoc } from "./XtmdDoc.svelte";
export { default as XtmdNode } from "./XtmdNode.svelte";
export type { DocError, DocProps, Restored, Snapshot, ViewContext, ViewWidget } from "@extended-mark/view";
export type { Call, Given, Ir, Outcome, Page, PageValues, Value, ir } from "@extended-mark/embed";
