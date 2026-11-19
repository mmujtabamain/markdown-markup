// Layout, as elements: flex and grid as CSS flexbox and grid, cell as a grid item, and sizing as
// the flex item whose grow, shrink, basis and limits it says, as @extended-mark/dom draws them (the same
// parts and classes, so the same stylesheet). Lengths are core's tokens, as custom properties.

import type { Drawn } from "@extended-mark/runtime";
import { field, flag, inner, kase, list, num, str } from "@extended-mark/dom/shared";
import type { ViewContext, ViewWidget } from "../render.js";
import type { Act } from "../act.js";
import { attr, cls, css, h, on, type VNode } from "../vnode.js";
import { claim, isClaimed } from "./controls.js";

const ALIGN: Record<string, string> = { START: "flex-start", CENTER: "center", END: "flex-end", STRETCH: "stretch", BASELINE: "baseline" };
const JUSTIFY: Record<string, string> = { START: "flex-start", CENTER: "center", END: "flex-end", BETWEEN: "space-between", AROUND: "space-around" };
const SELF: Record<string, string> = { START: "start", CENTER: "center", END: "end", STRETCH: "stretch", BASELINE: "baseline" };

/** Which sides an edge draws: top, right, bottom, left. */
const EDGES: Record<string, [boolean, boolean, boolean, boolean]> = {
  ALL: [true, true, true, true],
  TOP: [true, false, false, false],
  RIGHT: [false, true, false, false],
  BOTTOM: [false, false, true, false],
  LEFT: [false, false, false, true],
  X: [false, true, false, true],
  Y: [true, false, true, false],
};

/** The look flex and grid share: padding, fill, stroke on its edges, radius and shadow. */
function box(el: VNode, d: Drawn, ctx: ViewContext): void {
  const t = ctx.tokens;
  const p = (k: string) => d.props.get(k);
  css(el, "gap", t.length(p("gap")));
  css(el, "padding", t.length(p("pad")));
  css(el, "background", t.color(p("fill")));
  const stroke = t.color(p("stroke"));
  const sides = EDGES[kase(p("edge")) ?? "ALL"] ?? EDGES.ALL;
  ["top", "right", "bottom", "left"].forEach((side, k) => css(el, `border-${side}`, stroke && sides[k] ? `1px solid ${stroke}` : undefined));
  css(el, "border-radius", t.length(p("radius")));
  css(el, "box-shadow", t.color(p("shadow")));
}

/** A container whose click does something: clickable, and reachable from the keyboard. A click a
 * control inside already took is left to it. */
function clickable(el: VNode, d: Drawn, ctx: ViewContext): void {
  const listens = ctx.page.listens ? ctx.page.listens(d, "click") : d.events.has("click");
  cls(el, "xtmd-clickable", listens);
  attr(el, "tabindex", listens ? "0" : undefined);
  if (!listens) return;
  on(el, "click", (e) => {
    if (isClaimed(e)) return;
    claim(e);
    ctx.event("click");
  });
  on(el, "keydown", (e) => {
    const key = (e as KeyboardEvent).key;
    if (e.target !== e.currentTarget || (key !== "Enter" && key !== " ")) return;
    e.preventDefault();
    claim(e);
    ctx.event("click");
  });
}

/** The ARIA group a run of tabs, options or radios makes. */
function groupRole(nodes: Drawn[]): string | undefined {
  if (!nodes.length || !nodes.every((n) => n.widget === "core/press")) return undefined;
  const kinds = new Set(nodes.map((n) => kase(n.props.get("kind"))));
  if (kinds.size !== 1) return undefined;
  return ({ TAB: "tablist", OPTION: "listbox", RADIO: "radiogroup" } as Record<string, string>)[[...kinds][0] ?? ""];
}

export const flex: ViewWidget = (d, ctx) => {
  const p = (k: string) => d.props.get(k);
  const across = kase(p("axis")) === "X";
  const kids = d.slots.get("children") ?? [];
  const label = str(p("label"));
  const role = groupRole(kids);
  const el = h("div", "flex", {
    "data-axis": across ? "x" : "y",
    role: role ?? (label ? "group" : undefined),
    "aria-label": label || undefined,
    "aria-orientation": role ? (across ? "horizontal" : "vertical") : undefined,
  }, ctx.children(kids));
  css(el, "flex-wrap", flag(p("wrap")) ? "wrap" : undefined);
  css(el, "align-items", ALIGN[kase(p("align")) ?? "STRETCH"]);
  css(el, "justify-content", JUSTIFY[kase(p("justify")) ?? "START"]);
  box(el, d, ctx);
  clickable(el, d, ctx);
  return el;
};

/** A grid's columns: equal shares, or tracks of their own. */
function columns(v: ReturnType<typeof inner>, ctx: ViewContext): string {
  const c = inner(v);
  if (!c || c.kind !== "case") return "minmax(0, 1fr)";
  if (c.name === "EQUAL") return `repeat(${Math.max(1, Math.round(num(field(c, "count")) ?? 1))}, minmax(0, 1fr))`;
  const t = ctx.tokens;
  return list(field(c, "of"))
    .map((track) => {
      switch (kase(track)) {
        case "FR":
          return `minmax(0, ${num(field(track, "share")) ?? 1}fr)`;
        case "CH":
          return `${num(field(track, "count")) ?? 1}ch`;
        case "SIZE":
          return t.length(field(track, "of")) ?? "auto";
        default:
          return "auto";
      }
    })
    .join(" ");
}

export const grid: ViewWidget = (d, ctx) => {
  const p = (k: string) => d.props.get(k);
  const el = h("div", "grid", {}, ctx.children(d.slots.get("children") ?? []));
  css(el, "grid-template-columns", columns(p("cols"), ctx));
  css(el, "align-items", SELF[kase(p("align")) ?? "STRETCH"]);
  const j = kase(p("justify")) ?? "START";
  // between and around share the room out between columns; the rest place items in their cells
  css(el, "justify-content", j === "BETWEEN" || j === "AROUND" ? JUSTIFY[j] : undefined);
  css(el, "justify-items", j === "BETWEEN" || j === "AROUND" ? undefined : SELF[j] === "start" ? undefined : SELF[j]);
  box(el, d, ctx);
  clickable(el, d, ctx);
  return el;
};

export const cell: ViewWidget = (d, ctx) => {
  const p = (k: string) => d.props.get(k);
  const el = h("div", "cell", {}, ctx.children(d.slots.get("child") ?? []));
  const span = Math.max(1, Math.round(num(p("span")) ?? 1));
  const row = num(p("row"));
  const col = num(p("col"));
  css(el, "grid-column", col !== undefined ? `${col} / span ${span}` : span > 1 ? `span ${span}` : undefined);
  css(el, "grid-row", row !== undefined ? String(row) : undefined);
  const place = kase(p("place"));
  css(el, "place-self", place ? SELF[place] : undefined);
  return el;
};

export const sizing: ViewWidget = (d, ctx) => {
  const t = ctx.tokens;
  const p = (k: string) => d.props.get(k);
  const n = (k: string) => num(p(k));
  const el = h("div", "sizing", {}, ctx.children(d.slots.get("child") ?? []));
  css(el, "flex-grow", n("grow") !== undefined ? String(n("grow")) : undefined);
  css(el, "flex-shrink", n("shrink") !== undefined ? String(n("shrink")) : undefined);
  css(el, "flex-basis", t.length(p("basis")));
  css(el, "min-width", t.length(p("min_width")));
  css(el, "min-height", t.length(p("min_height")));
  css(el, "max-width", t.length(p("max_width")));
  css(el, "max-height", t.length(p("max_height")));
  css(el, "aspect-ratio", n("aspect") !== undefined ? String(n("aspect")) : undefined);
  return el;
};

// ---- acting through the element, for the checks

/** None: @extended-mark/dom's layout views have no act, so a check's click on a flex or a grid goes
 * through the page. */
export const acts: Record<string, Act> = {};
