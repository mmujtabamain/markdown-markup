// @mkp/core's runtime half: what drawing an already compiled bundle needs, and nothing that
// compiles, checks or writes Markdown. The release builds it as mkp-runtime.js, which mkp-react.js
// and mkp-dom.js import, and which mkp.js (the whole core) imports too, so a page that loads both
// loads each module once. Everything here is also exported by the core's index.
export * from './diag';
export * from './ir';
export { Runtime, Inst, WidgetHandle, checkValue, type RuntimeOptions, type SignalEvent, type MathsRenderer } from './runtime/runtime';
export type { VNode, VLayer, VShape, VArrow, VRun, VMaths, ShapeEvent } from './runtime/view';
export { walk as walkView } from './runtime/view';
export { arrowPath, arrowPaths, ARROW_CORNERS, type ArrowEnd, type ArrowEnds, type Rect, type ArrowPath } from './runtime/arrow';
export { fmtNum, fromJson, toJson, rand, EvalError } from './eval';
export { TokenTable, tokenSetIR, tokenNames } from './tokens';
export { inlineRuns, plainText, safeHref, type Run } from './markdown';
export { MathsEngine, prerender, needsMaths } from './maths';
export { ICON_GLYPHS, ICON_NAMES } from './icons';
export { VERSION, RELEASE } from './version';
export { bundleStamp, readStamp, writeStamp, compareReleases, CURRENT, UNSTAMPED, type Stamp } from './stamp';
export { migrateBundle, migrateRoots, choicesFor, stepsBetween, needsMigration, STEPS, type Step, type Change, type Choice, type MigrateOptions, type MigrateResult, type Renamed } from './migrate/index';
