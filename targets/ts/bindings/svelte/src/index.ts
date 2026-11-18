// @mkp/svelte: an MKP page in a Svelte 5 app, as a component or as an action on any element.

export { default as MkpPage } from "./MkpPage.svelte";
export { default as MkpDoc } from "./MkpDoc.svelte";
export { default as MkpNode } from "./MkpNode.svelte";
export { mkp } from "./action.js";
export type { Call, Given, Handle, Ir, Mounted, Outcome, Page, PageProps, PageValues, Value, Widget, ir } from "@mkp/embed";
export type { DocError, DocProps, Restored, Snapshot } from "@mkp/view";
