// The plane (plan tab 15): a clipped view holding one inner element that a CSS transform moves and
// scales for panning and zooming. Spots are positioned absolutely inside it at their points, and
// the background is drawn under the same transform. Boxes come from the runtime's placement maths
// on each spot's own size, which the transform never changes. Dragging pans; the wheel, a pinch or
// + and - zoom; each writes `center` or `zoom` through a checked write.

import { around, ptValue, regionOf, type Drawn, type Region } from "@extended-mark/runtime";
import type { Widget, WidgetView } from "../api.js";
import { attr, claim, css, h, isClaimed, kit, s } from "../kit.js";
import { flag, inner, kase, num, placesFor, point, str, toNum, type XY } from "../values.js";
import { anchorShift, inSpace, type Space } from "./gfx.js";

/** How far a pointer moves before a press becomes a drag. */
const DRAG_START = 4;

/** Inputs, sliders and text keep their own pointer: a drag starting on them doesn't pan. */
const OWN_POINTER = "input, textarea, select, [contenteditable], [data-part='handle']";

function regionNumbers(r: Region | undefined): { from: XY; to: XY } | undefined {
  return r ? { from: { x: r.from.x.toNumber(), y: r.from.y.toNumber() }, to: { x: r.to.x.toNumber(), y: r.to.y.toNumber() } } : undefined;
}

export const plane: Widget = (d, ctx) => {
  const el = h("div", "plane", { role: "group", "aria-roledescription": "plane" });
  const view = h("div", "plane.view", { tabindex: "0", "aria-keyshortcuts": "ArrowLeft ArrowRight ArrowUp ArrowDown + -" });
  const inner_ = h("div", "plane.inner");
  const bg = s("svg", "plane.background", { width: "1", height: "1" });
  const items = h("div", "plane.items");
  inner_.append(bg, items);
  view.append(inner_);
  el.append(view);

  let z = 1;
  let c: XY = { x: 0, y: 0 };
  let low = 1;
  let high = 1;
  let listens = false;

  /** The plane's units: one unit is one CSS pixel at zoom 1, y up. */
  const space: Space = {
    x: (u) => u,
    y: (u) => -u,
    len: (u) => u,
    unit(cx, cy) {
      const r = view.getBoundingClientRect();
      return { x: c.x + (cx - r.left - r.width / 2) / z, y: c.y - (cy - r.top - r.height / 2) / z };
    },
    unitsPerPx: () => 1 / z,
    keep: (p) => p,
  };

  /** The reader moving the view: the zoom first, so the centre is kept inside bounds for it. */
  const move = (center: XY, zoom = z) => {
    if (zoom !== z) {
      const nz = toNum(zoom, 3);
      if (nz.toNumber() !== z) ctx.write("zoom", { kind: "num", n: nz });
    }
    const p = placesFor(1 / zoom);
    const next = { x: toNum(center.x, p), y: toNum(center.y, p) };
    if (next.x.toNumber() !== c.x || next.y.toNumber() !== c.y) ctx.write("center", ptValue(next));
  };

  /** Zooms about a point on the screen, which stays under the pointer. */
  const zoomAt = (cx: number, cy: number, want: number) => {
    const nz = Math.min(high, Math.max(low, want));
    if (!(high > low) || Math.abs(nz - z) < 1e-6) return;
    const r = view.getBoundingClientRect();
    const ox = cx - r.left - r.width / 2;
    const oy = cy - r.top - r.height / 2;
    const u = { x: c.x + ox / z, y: c.y - oy / z };
    move({ x: u.x - ox / nz, y: u.y + oy / nz }, nz);
  };

  // ---- the pointer: drag to pan, two fingers to pinch
  const pointers = new Map<number, XY>();
  let drag: { x: number; y: number; c: XY; moved: boolean } | undefined;
  let pinch: { dist: number; z: number } | undefined;
  let dragged = false;
  view.addEventListener("pointerdown", (e) => {
    if ((e.pointerType === "mouse" && e.button !== 0) || (e.target as Element).closest?.(OWN_POINTER)) return;
    pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (pointers.size === 1) drag = { x: e.clientX, y: e.clientY, c: { ...c }, moved: false };
    else if (pointers.size === 2) {
      const [a, b] = [...pointers.values()];
      pinch = { dist: Math.hypot(a.x - b.x, a.y - b.y) || 1, z };
      drag = undefined;
    }
  });
  view.addEventListener("pointermove", (e) => {
    if (!pointers.has(e.pointerId)) return;
    pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (pinch && pointers.size >= 2) {
      const [a, b] = [...pointers.values()];
      zoomAt((a.x + b.x) / 2, (a.y + b.y) / 2, (pinch.z * Math.hypot(a.x - b.x, a.y - b.y)) / pinch.dist);
      return;
    }
    if (!drag) return;
    const dx = e.clientX - drag.x;
    const dy = e.clientY - drag.y;
    if (!drag.moved) {
      if (Math.hypot(dx, dy) < DRAG_START) return;
      drag.moved = true;
      view.setPointerCapture?.(e.pointerId);
      view.classList.add("xtmd-panning");
    }
    move({ x: drag.c.x - dx / z, y: drag.c.y + dy / z });
  });
  const up = (e: PointerEvent) => {
    if (!pointers.delete(e.pointerId)) return;
    if (drag?.moved) dragged = true;
    if (pointers.size < 2) pinch = undefined;
    if (pointers.size === 0) {
      drag = undefined;
      view.classList.remove("xtmd-panning");
    }
  };
  view.addEventListener("pointerup", up);
  view.addEventListener("pointercancel", up);
  view.addEventListener("click", (e) => {
    // the click that ends a drag is the drag's
    if (dragged) {
      dragged = false;
      claim(e);
      return;
    }
    if (!listens || isClaimed(e) || (e.target as Element).closest?.("[data-part='spot']")) return;
    claim(e);
    const at = space.unit(e.clientX, e.clientY);
    if (!at) return;
    const p = placesFor(1 / z);
    ctx.event("click", [ptValue({ x: toNum(at.x, p), y: toNum(at.y, p) })]);
  });
  view.addEventListener(
    "wheel",
    (e) => {
      if (!(high > low)) return;
      e.preventDefault();
      const dy = e.deltaMode === 1 ? e.deltaY * 16 : e.deltaMode === 2 ? e.deltaY * 400 : e.deltaY;
      zoomAt(e.clientX, e.clientY, z * Math.exp(-dy * (e.ctrlKey ? 0.01 : 0.0015)));
    },
    { passive: false },
  );
  view.addEventListener("keydown", (e) => {
    if (e.target !== view) return;
    const r = view.getBoundingClientRect();
    const step = 40 / z;
    const pans: Record<string, XY> = { ArrowLeft: { x: -step, y: 0 }, ArrowRight: { x: step, y: 0 }, ArrowUp: { x: 0, y: step }, ArrowDown: { x: 0, y: -step } };
    if (pans[e.key]) move({ x: c.x + pans[e.key].x, y: c.y + pans[e.key].y });
    else if (e.key === "+" || e.key === "=") zoomAt(r.left + r.width / 2, r.top + r.height / 2, z * 1.25);
    else if (e.key === "-" || e.key === "_") zoomAt(r.left + r.width / 2, r.top + r.height / 2, z / 1.25);
    else return;
    e.preventDefault();
  });

  // ---- sizes: a spot that changes size, or the view, lays the plane out again. Only a real
  // change does: a spot drawn anew (a row of a list made again at each redraw) is measured by the
  // layout that follows the redraw, and laying out again for it would never end.
  const observed = new Set<Element>();
  const sizes = new WeakMap<Element, string>();
  const sizeOf = (x: Element) => `${(x as HTMLElement).offsetWidth}x${(x as HTMLElement).offsetHeight}`;
  const ro =
    typeof ResizeObserver === "function"
      ? new ResizeObserver((entries) => {
          let moved = false;
          for (const e of entries) {
            const now = sizeOf(e.target);
            if (sizes.get(e.target) !== now) moved = true;
            sizes.set(e.target, now);
          }
          if (moved) kit(ctx).layout();
        })
      : undefined;
  ro?.observe(view);

  const self: WidgetView = {
    el,
    update(d: Drawn) {
      const p = (k: string) => d.props.get(k);
      const t = kit(ctx).tokens;
      z = num(p("zoom")) ?? 1;
      c = point(p("center")) ?? { x: 0, y: 0 };
      const aspect = num(p("aspect")) ?? 1.5;
      const label = str(p("label"));
      attr(el, "aria-label", label || undefined);
      attr(view, "aria-label", label || undefined);
      css(el, "width", t.length(p("width")));
      css(view, "aspect-ratio", String(aspect));
      css(inner_, "transform", `scale(${z}) translate(${-c.x}px, ${c.y}px)`);
      listens = ctx.page.listens ? ctx.page.listens(d, "click") : d.events.has("click");
      // how far the reader may zoom: zoom_range, counted from the zoom that fits bounds with `fit`
      const range = inner(p("zoom_range"));
      let base = 1;
      const spots = (d.slots.get("items") ?? []).filter((n) => n.widget === "core/spot");
      const bounds = regionNumbers(regionOf(p("bounds")) ?? around(spots.map((n) => regionOf(n.props.get("box"))).filter((r): r is Region => !!r)));
      const width = t.number(p("width")) ?? view.clientWidth;
      if (flag(p("fit")) && bounds && width > 0) {
        const bw = bounds.to.x - bounds.from.x;
        const bh = bounds.to.y - bounds.from.y;
        if (bw && bh) base = Math.min(width / bw, width / aspect / bh);
      }
      low = Math.max(0.1, (range && range.kind === "range" ? (num(range.low ?? undefined) ?? 1) : 1) * base);
      high = Math.min(10, (range && range.kind === "range" ? (num(range.high ?? undefined) ?? 1) : 1) * base);
      el.classList.toggle("xtmd-zoomable", high > low);
      inSpace(space, () => ctx.children(bg, d.slots.get("background") ?? []));
      ctx.children(items, d.slots.get("items") ?? []);
      if (ro) {
        const now = new Set(items.children);
        for (const x of observed) if (!now.has(x)) (ro.unobserve(x), observed.delete(x));
        for (const x of now) {
          if (observed.has(x)) continue;
          ro.observe(x);
          observed.add(x);
          sizes.set(x, sizeOf(x));
        }
      }
    },
    destroy() {
      ro?.disconnect();
    },
  };
  self.update(d);
  return self;
};

export const spot: Widget = (d, ctx) => {
  const el = h("div", "spot");
  const view: WidgetView = {
    el,
    update(d) {
      const at = point(d.props.get("at")) ?? { x: 0, y: 0 };
      const nudge = point(d.props.get("nudge")) ?? { x: 0, y: 0 };
      // at its point in the plane's units, y up; the anchor's part of it on the point
      css(el, "left", `${at.x + nudge.x}px`);
      css(el, "top", `${-(at.y + nudge.y)}px`);
      css(el, "transform", anchorShift(kase(d.props.get("anchor")) ?? "CENTER"));
      ctx.children(el, d.slots.get("child") ?? []);
    },
  };
  view.update(d);
  return view;
};
