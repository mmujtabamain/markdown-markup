// What @mkp/dom's widgets read values with, shared with the targets that draw core's widgets
// another way (@mkp/view and the framework targets on it), so every web target reads a value,
// a token, an icon and a link the same: no DOM is needed to import these.

export { field, flag, inner, kase, list, num, point, region, str, exact, placesFor, toNum, type XY } from "./values.js";
export { Tokens, tokenVar, type Theme } from "./tokens.js";
export { GLYPHS, FILLED } from "./icons.js";
export { safeHref, safeSrc, templateText, texOf, noteId } from "./rich.js";
export { texToMathML, drawTex } from "./tex.js";
export { webFns } from "./fns.js";
export { css as styleText } from "./style.js";
