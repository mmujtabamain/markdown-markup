// @mkp/angular: MKP documents in Angular, the run-time target. <mkp-doc src="…"> or <mkp-doc [ir]="…">
// draws a page from an IR built ahead through Angular's Renderer2 (doc.ts), on a server and in the
// browser. The real-time target is @mkp/angular-live.

export { MkpDoc } from "./doc.js";
export type { DocError, DocProps, Restored, Snapshot, ViewContext, ViewWidget } from "@mkp/view";
export type { Call, Given, Ir, Outcome, Page, PageValues, Value, ir } from "@mkp/embed";
