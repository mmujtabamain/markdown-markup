"use client";
// @extended-mark/react: Extended Mark documents in React, the run-time target. <XtmdDoc src={…}> or <XtmdDoc ir={…}> draws a
// page from an IR built ahead with React's own components (doc.ts), on a server and in the browser.
// The real-time target, which compiles a document's text in the browser, is @extended-mark/react-live.

export { XtmdDoc, toReact, type XtmdDocHandle, type XtmdDocProps } from "./doc.js";
export type { DocError, DocProps, Restored, Snapshot, ViewContext, ViewWidget } from "@extended-mark/view";
export type { Call, Given, Ir, Outcome, Page, PageValues, Value, ir } from "@extended-mark/embed";
