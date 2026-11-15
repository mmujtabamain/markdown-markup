// @mkp/dom: MKP's default web widgets in plain DOM. `mount` draws a @mkp/runtime page into an
// element; `run` makes the page from its IR first; `widgets` are ours, by full name.

export { mount, run } from "./mount.js";
export { widgets } from "./widgets/index.js";
export type { Action, Drawn, Measure, Mounted, MountOptions, Page, PageOptions, Value, Widget, WidgetContext, WidgetView, ir } from "./api.js";
