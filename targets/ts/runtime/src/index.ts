// @extended-mark/runtime: runs the IR the xtmd compiler writes, on the web, agreeing with the native runtime.

export * from "./eval/index.js";
export { Page, inlineSlot, type PageOptions, type PageValues, type Drawn, type Env, type Broken, type Outcome, type Call } from "./page.js";
export { pageBlocks, writeMarkdown, writeInline, type Block, type Inline } from "./markdown.js";
export { layout, planes, planeWrites, place, around, keepInside, ptOf, regionOf, ptValue, regionValue, MAX_LAYOUT_PASSES, type Measure, type Size, type Pt, type Region, type LayoutWrite } from "./layout.js";
export type * as ir from "./generated/ir.js";
