// @extended-mark/vue: Extended Mark documents in Vue 3, the run-time target. <XtmdDoc src="…"> or <XtmdDoc :ir="…"> draws a
// page from an IR built ahead with Vue's own `h` (doc.ts), on a server and in the browser. The
// real-time target, which compiles a document's text in the browser, is @extended-mark/vue-live.

export { XtmdDoc, docProps, toVue, type XtmdDocRef } from "./doc.js";
export type { DocError, DocProps, Restored, Snapshot, ViewContext, ViewWidget } from "@extended-mark/view";
export type { Call, Given, Ir, Outcome, Page, PageValues, Value, ir } from "@extended-mark/embed";
