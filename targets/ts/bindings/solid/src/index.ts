// @mkp/solid: MKP documents in Solid, the run-time target. <MkpDoc src={…}> or <MkpDoc ir={…}> draws a
// page from an IR built ahead with Solid's own fine-grained rendering (doc.ts), on a server and in
// the browser. The real-time target is @mkp/solid-live.

export { MkpDoc, MkpNode, type MkpDocHandle, type MkpDocProps } from "./doc.js";
export type { DocError, DocProps, Restored, Snapshot, ViewContext, ViewWidget } from "@mkp/view";
export type { Call, Given, Ir, Outcome, Page, PageValues, Value, ir } from "@mkp/embed";
