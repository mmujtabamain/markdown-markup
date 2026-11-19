// Layout: flex and grid as CSS flexbox and grid, cell as a grid item, and sizing as the flex item
// whose grow, shrink, basis and limits it says. Lengths are core's tokens, as custom properties.

import type { Drawn } from "@extended-mark/runtime";
import type { Widget, WidgetContext, WidgetView } from "../api.js";
import { attr, claim, css, h, isClaimed, kit } from "../kit.js";
import { field, flag, inner, kase, list, num, str } from "../values.js";

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
function box(el: HTMLElement, d: Drawn, ctx: WidgetContext): void {
  const t = kit(ctx).tokens;
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
function clickable(el: HTMLElement, ctx: WidgetContext) {
  let on = false;
  el.addEventListener("click", (e) => {
    if (!on || isClaimed(e)) return;
    claim(e);
    ctx.event("click");
  });
  el.addEventListener("keydown", (e) => {
    if (!on || e.target !== el || (e.key !== "Enter" && e.key !== " ")) return;
    e.preventDefault();
    claim(e);
    ctx.event("click");
  });
  return (d: Drawn) => {
    on = ctx.page.listens ? ctx.page.listens(d, "click") : d.events.has("click");
    el.classList.toggle("xtmd-clickable", on);
    attr(el, "tabindex", on ? "0" : undefined);
  };
}

/** The ARIA group a run of tabs, options or radios makes. */
function groupRole(nodes: Drawn[]): string | undefined {
  if (!nodes.length || !nodes.every((n) => n.widget === "core/press")) return undefined;
  const kinds = new Set(nodes.map((n) => kase(n.props.get("kind"))));
  if (kinds.size !== 1) return undefined;
  return { TAB: "tablist", OPTION: "listbox", RADIO: "radiogroup" }[[...kinds][0] ?? ""];
}

export const flex: Widget = (d, ctx) => {
  const el = h("div", "flex");
  const click = clickable(el, ctx);
  const view: WidgetView = {
    el,
    update(d) {
      const p = (k: string) => d.props.get(k);
      const across = kase(p("axis")) === "X";
      el.dataset.axis = across ? "x" : "y";
      css(el, "flex-wrap", flag(p("wrap")) ? "wrap" : undefined);
      css(el, "align-items", ALIGN[kase(p("align")) ?? "STRETCH"]);
      css(el, "justify-content", JUSTIFY[kase(p("justify")) ?? "START"]);
      box(el, d, ctx);
      click(d);
      const kids = d.slots.get("children") ?? [];
      const label = str(p("label"));
      const role = groupRole(kids);
      attr(el, "role", role ?? (label ? "group" : undefined));
      attr(el, "aria-label", label || undefined);
      attr(el, "aria-orientation", role ? (across ? "horizontal" : "vertical") : undefined);
      ctx.children(el, kids);
    },
  };
  view.update(d);
  return view;
};

/** A grid's columns: equal shares, or tracks of their own. */
function columns(v: ReturnType<typeof inner>, ctx: WidgetContext): string {
  const c = inner(v);
  if (!c || c.kind !== "case") return "minmax(0, 1fr)";
  if (c.name === "EQUAL") return `repeat(${Math.max(1, Math.round(num(field(c, "count")) ?? 1))}, minmax(0, 1fr))`;
  const t = kit(ctx).tokens;
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

export const grid: Widget = (d, ctx) => {
  const el = h("div", "grid");
  const click = clickable(el, ctx);
  const view: WidgetView = {
    el,
    update(d) {
      const p = (k: string) => d.props.get(k);
      css(el, "grid-template-columns", columns(p("cols"), ctx));
      css(el, "align-items", SELF[kase(p("align")) ?? "STRETCH"]);
      const j = kase(p("justify")) ?? "START";
      // between and around share the room out between columns; the rest place items in their cells
      css(el, "justify-content", j === "BETWEEN" || j === "AROUND" ? JUSTIFY[j] : undefined);
      css(el, "justify-items", j === "BETWEEN" || j === "AROUND" ? undefined : SELF[j] === "start" ? undefined : SELF[j]);
      box(el, d, ctx);
      click(d);
      ctx.children(el, d.slots.get("children") ?? []);
    },
  };
  view.update(d);
  return view;
};

export const cell: Widget = (d, ctx) => {
  const el = h("div", "cell");
  const view: WidgetView = {
    el,
    update(d) {
      const p = (k: string) => d.props.get(k);
      const span = Math.max(1, Math.round(num(p("span")) ?? 1));
      const row = num(p("row"));
      const col = num(p("col"));
      css(el, "grid-column", col !== undefined ? `${col} / span ${span}` : span > 1 ? `span ${span}` : undefined);
      css(el, "grid-row", row !== undefined ? String(row) : undefined);
      const place = kase(p("place"));
      css(el, "place-self", place ? SELF[place] : undefined);
      ctx.children(el, d.slots.get("child") ?? []);
    },
  };
  view.update(d);
  return view;
};

export const sizing: Widget = (d, ctx) => {
  const el = h("div", "sizing");
  const view: WidgetView = {
    el,
    update(d) {
      const t = kit(ctx).tokens;
      const p = (k: string) => d.props.get(k);
      const n = (k: string) => num(p(k));
      css(el, "flex-grow", n("grow") !== undefined ? String(n("grow")) : undefined);
      css(el, "flex-shrink", n("shrink") !== undefined ? String(n("shrink")) : undefined);
      css(el, "flex-basis", t.length(p("basis")));
      css(el, "min-width", t.length(p("min_width")));
      css(el, "min-height", t.length(p("min_height")));
      css(el, "max-width", t.length(p("max_width")));
      css(el, "max-height", t.length(p("max_height")));
      css(el, "aspect-ratio", n("aspect") !== undefined ? String(n("aspect")) : undefined);
      ctx.children(el, d.slots.get("child") ?? []);
    },
  };
  view.update(d);
  return view;
};
