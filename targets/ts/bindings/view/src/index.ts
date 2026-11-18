// @mkp/view: what every framework target draws an MKP page from. A `Doc` runs the document (its
// IR given or fetched, `$state` controlled or not, every write checked, snapshots), and `render()`
// gives the page as plain elements (`VNode`s) that each target renders with its own renderer:
// core's widgets are written once here, drawn as @mkp/dom draws them.

export { Doc, hash, type DocError, type DocProps, type Restored, type Snapshot } from "./doc.js";
export { renderPage, children, type Drawing, type ViewContext, type ViewWidget } from "./render.js";
export { h, s, attr, cls, css, prop, on, textOf, type Child, type Hook, type VNode } from "./vnode.js";
export { toHtml, escapeHtml, walk } from "./html.js";
export { widgets } from "./widgets/index.js";
export { act, type Action } from "./act.js";
export type { Call, Outcome, PageValues, Value, ir } from "@mkp/runtime";
export type { Ir } from "@mkp/embed";
export { Patcher, type Host } from "./patch.js";
