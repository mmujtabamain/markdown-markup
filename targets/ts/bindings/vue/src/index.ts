// @mkp/vue: MKP documents in Vue 3, the run-time target. <MkpDoc src="…"> or <MkpDoc :ir="…"> draws a
// page from an IR built ahead with Vue's own `h` (doc.ts), on a server and in the browser. The
// real-time target, which compiles a document's text in the browser, is @mkp/vue-live.

export { MkpDoc, docProps, toVue, type MkpDocRef } from "./doc.js";
export type { DocError, DocProps, Restored, Snapshot, ViewContext, ViewWidget } from "@mkp/view";
export type { Call, Given, Ir, Outcome, Page, PageValues, Value, ir } from "@mkp/embed";
