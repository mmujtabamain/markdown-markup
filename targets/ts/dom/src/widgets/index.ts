// Our default widgets, by full name: every core extern, and the runtime's notice. An app's own,
// passed to mount as `widgets`, replace them by name.

import type { Widget } from "../api.js";
import { bullets, code, divider, footnote, heading, item, math, paragraph, quote, table } from "./blocks.js";
import { field, icon, image, label, overlay, press, slider } from "./controls.js";
import { canvas, circle, handle, layer, path, place, shade } from "./gfx.js";
import { cell, flex, grid, sizing } from "./layout.js";
import { notice } from "./notice.js";
import { plane, spot } from "./plane.js";

export const widgets: Record<string, Widget> = {
  "core/paragraph": paragraph,
  "core/heading": heading,
  "core/bullets": bullets,
  "core/item": item,
  "core/quote": quote,
  "core/code": code,
  "core/math": math,
  "core/table": table,
  "core/footnote": footnote,
  "core/divider": divider,
  "core/label": label,
  "core/image": image,
  "core/icon": icon,
  "core/press": press,
  "core/field": field,
  "core/slider": slider,
  "core/overlay": overlay,
  "core/canvas": canvas,
  "core/layer": layer,
  "core/circle": circle,
  "core/path": path,
  "core/place": place,
  "core/handle": handle,
  "core/shade": shade,
  "core/flex": flex,
  "core/grid": grid,
  "core/cell": cell,
  "core/sizing": sizing,
  "core/plane": plane,
  "core/spot": spot,
  "#notice": notice,
};
