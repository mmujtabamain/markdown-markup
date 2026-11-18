"use client";
// @mkp/react: MKP documents in React, the run-time target. <MkpDoc src={…}> or <MkpDoc ir={…}> draws a
// page from an IR built ahead with React's own components (doc.ts), on a server and in the browser.
// The real-time target, which compiles a document's text in the browser, is @mkp/react-live.

export { MkpDoc, toReact, type MkpDocHandle, type MkpDocProps } from "./doc.js";
export type { DocError, DocProps, Restored, Snapshot, ViewContext, ViewWidget } from "@mkp/view";
export type { Call, Given, Ir, Outcome, Page, PageValues, Value, ir } from "@mkp/embed";
