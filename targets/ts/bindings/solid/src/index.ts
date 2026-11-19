// @extended-mark/solid: Extended Mark documents in Solid, the run-time target. <XtmdDoc src={…}> or <XtmdDoc ir={…}> draws a
// page from an IR built ahead with Solid's own fine-grained rendering (doc.ts), on a server and in
// the browser. The real-time target is @extended-mark/solid-live.

export { XtmdDoc, XtmdNode, type XtmdDocHandle, type XtmdDocProps } from "./doc.js";
export type { DocError, DocProps, Restored, Snapshot, ViewContext, ViewWidget } from "@extended-mark/view";
export type { Call, Given, Ir, Outcome, Page, PageValues, Value, ir } from "@extended-mark/embed";
