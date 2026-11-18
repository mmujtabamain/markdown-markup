// The plane (plan tab 15), as elements: a clipped view holding one inner element that a CSS
// transform moves and scales for panning and zooming, as @mkp/dom draws it (the same parts and
// classes, so the same stylesheet). Spots are positioned absolutely inside it at their points, and
// the background is drawn under the same transform. Boxes come from the runtime's placement maths
// on each spot's own size, which the transform never changes. Dragging pans; the wheel, a pinch or
// + and - zoom; each writes `center` or `zoom` through a checked write.
//
// A render has no elements, so what @mkp/dom keeps in its closures lives elsewhere here: a gesture
// in progress and the ResizeObserver are kept by the view's element (its hook makes them), and the
// zoom and centre a gesture moves from are read from the page as the event comes, so a framework
// that renders later than the page changes still pans and zooms from where the page is now.

import { around, ptValue, regionOf, type Drawn, type Page, type Region } from "@mkp/runtime";
import { flag, inner, kase, num, placesFor, point, region, str, toNum, type XY } from "@mkp/dom/shared";
import type { ViewContext, ViewWidget } from "../render.js";
import type { Act } from "../act.js";
import { cls, css, h, on, s, type Hook } from "../vnode.js";
import { claim, isClaimed } from "./controls.js";
import { anchorShift, inSpace, type Space } from "./gfx.js";

/** How far a pointer moves before a press becomes a drag. */
const DRAG_START = 4;

/** Inputs, sliders and text keep their own pointer: a drag starting on them doesn't pan. */
const OWN_POINTER = "input, textarea, select, [contenteditable], [data-part='handle']";

const VIEW = "[data-part='plane.view']";
const ITEMS = ":scope > [data-part='plane.inner'] > [data-part='plane.items']";

function regionNumbers(r: Region | undefined): { from: XY; to: XY } | undefined {
  return r ? { from: { x: r.from.x.toNumber(), y: r.from.y.toNumber() }, to: { x: r.to.x.toNumber(), y: r.to.y.toNumber() } } : undefined;
}

/** Where the plane is looking: its zoom and the centre of what it draws. */
interface Look {
  z: number;
  c: XY;
}

function lookOf(d: Drawn): Look {
  return { z: num(d.props.get("zoom")) ?? 1, c: point(d.props.get("center")) ?? { x: 0, y: 0 } };
}

/** How far the reader may zoom: zoom_range, counted from the zoom that fits bounds with `fit`,
 * for a plane `measured` pixels wide when it gives no width of its own. */
function limitsOf(d: Drawn, ctx: ViewContext, measured: number): { low: number; high: number } {
  const p = (k: string) => d.props.get(k);
  const aspect = num(p("aspect")) ?? 1.5;
  const range = inner(p("zoom_range"));
  let base = 1;
  const spots = (d.slots.get("items") ?? []).filter((n) => n.widget === "core/spot");
  const bounds = regionNumbers(regionOf(p("bounds")) ?? around(spots.map((n) => regionOf(n.props.get("box"))).filter((r): r is Region => !!r)));
  const width = ctx.tokens.number(p("width")) ?? measured;
  if (flag(p("fit")) && bounds && width > 0) {
    const bw = bounds.to.x - bounds.from.x;
    const bh = bounds.to.y - bounds.from.y;
    if (bw && bh) base = Math.min(width / bw, width / aspect / bh);
  }
  const low = Math.max(0.1, (range && range.kind === "range" ? (num(range.low ?? undefined) ?? 1) : 1) * base);
  const high = Math.min(10, (range && range.kind === "range" ? (num(range.high ?? undefined) ?? 1) : 1) * base);
  return { low, high };
}

/** The width the plane drew at its last layout, from the region it wrote it draws: what
 * @mkp/dom reads from its view's clientWidth while it updates, without an element to read. */
function drawnWidth(d: Drawn, z: number): number {
  const r = region(d.props.get("drawn"));
  return r ? Math.max(0, Math.round((r.to.x - r.from.x) * z)) : 0;
}

// ---- what the view's element keeps across renders

interface Live {
  /** The pointers down on it, for a drag or a pinch. */
  pointers: Map<number, XY>;
  drag?: { x: number; y: number; c: XY; moved: boolean };
  pinch?: { dist: number; z: number };
  /** A drag just ended: the click that follows is the drag's. */
  dragged: boolean;
  panning: boolean;
  /** The latest render's: the Doc's layout, and the wheel's handler. */
  layout: () => void;
  wheel: (e: WheelEvent, view: HTMLElement) => void;
  /** The wheel's listener, added in the hook: it must not be passive, to keep the page from scrolling. */
  onWheel?: (e: Event) => void;
  ro?: ResizeObserver;
  observed: Set<Element>;
  sizes: WeakMap<Element, string>;
}

const lives = new WeakMap<Element, Live>();

function liveOf(el: Element): Live {
  let st = lives.get(el);
  if (!st) {
    st = { pointers: new Map(), dragged: false, panning: false, layout: () => {}, wheel: () => {}, observed: new Set(), sizes: new WeakMap() };
    lives.set(el, st);
  }
  return st;
}

const sizeOf = (x: Element) => `${(x as HTMLElement).offsetWidth}x${(x as HTMLElement).offsetHeight}`;

function setPanning(view: Element, st: Live, panning: boolean): void {
  st.panning = panning;
  view.classList.toggle("mkp-panning", panning);
}

/** The outside change each plane last asked for the layout after, by page and place. */
const asked = new WeakMap<Page, Map<string, number>>();

/** Asks for the plane's layout once this render is in the document, after every change but the
 * layout's own, as @mkp/dom's mount settles it: `page.changes` counts every change from outside
 * the layout. A render that follows the layout's own writes doesn't ask again, or a spot in a list
 * made anew at each redraw, whose own box never stays, would lay the page out for ever. A plane
 * the page didn't have before asks on its first render. */
function askLayout(d: Drawn, ctx: ViewContext): void {
  let m = asked.get(ctx.page);
  if (!m) asked.set(ctx.page, (m = new Map()));
  if (m.get(d.path) === ctx.page.changes) return;
  m.set(d.path, ctx.page.changes);
  ctx.layout();
}

/** Watches the spots the view holds now: a spot that changes size, or the view, lays the plane
 * out again. Only a real change does: a spot drawn anew (a row of a list made again at each
 * redraw) is measured by the layout that follows the redraw, and laying out again for it would
 * never end. */
function watchItems(view: Element, st: Live): void {
  const ro = st.ro;
  if (!ro) return;
  const items = view.querySelector(ITEMS);
  const now = new Set(items ? [...items.children] : []);
  for (const x of st.observed) {
    if (now.has(x)) continue;
    ro.unobserve(x);
    st.observed.delete(x);
  }
  for (const x of now) {
    if (st.observed.has(x)) continue;
    ro.observe(x);
    st.observed.add(x);
    st.sizes.set(x, sizeOf(x));
  }
}

// ---- plane

export const plane: ViewWidget = (d, ctx) => {
  askLayout(d, ctx);
  const p = (k: string) => d.props.get(k);
  const t = ctx.tokens;
  const { z, c } = lookOf(d);
  const aspect = num(p("aspect")) ?? 1.5;
  const label = str(p("label"));
  const listens = ctx.page.listens ? ctx.page.listens(d, "click") : d.events.has("click");
  const { low, high } = limitsOf(d, ctx, drawnWidth(d, z));

  /** The plane as the page has it now, for an event: the latest render may not be in yet. */
  const current = (): Drawn => {
    const n = ctx.page.find(d.path);
    return n && n.widget === d.widget ? n : d;
  };
  const lookNow = (): Look => lookOf(current());
  const viewOf = (from: Element) => from.closest(VIEW) as HTMLElement | null;

  /** The plane's units: one unit is one CSS pixel at zoom 1, y up. */
  const space: Space = {
    x: (u) => u,
    y: (u) => -u,
    len: (u) => u,
    unit(cx, cy, from) {
      const v = viewOf(from);
      if (!v) return undefined;
      const at = lookNow();
      const r = v.getBoundingClientRect();
      return { x: at.c.x + (cx - r.left - r.width / 2) / at.z, y: at.c.y - (cy - r.top - r.height / 2) / at.z };
    },
    unitsPerPx: () => 1 / lookNow().z,
    keep: (q) => q,
  };

  /** The reader moving the view: the zoom first, so the centre is kept inside bounds for it. */
  const move = (at: Look, center: XY, zoom = at.z) => {
    if (zoom !== at.z) {
      const nz = toNum(zoom, 3);
      if (nz.toNumber() !== at.z) ctx.write("zoom", { kind: "num", n: nz });
    }
    const places = placesFor(1 / zoom);
    const next = { x: toNum(center.x, places), y: toNum(center.y, places) };
    if (next.x.toNumber() !== at.c.x || next.y.toNumber() !== at.c.y) ctx.write("center", ptValue(next));
  };

  /** Zooms about a point on the screen, which stays under the pointer. */
  const zoomAt = (view: HTMLElement, cx: number, cy: number, want: number) => {
    const n = current();
    const at = lookOf(n);
    const lim = limitsOf(n, ctx, view.clientWidth);
    const nz = Math.min(lim.high, Math.max(lim.low, want));
    if (!(lim.high > lim.low) || Math.abs(nz - at.z) < 1e-6) return;
    const r = view.getBoundingClientRect();
    const ox = cx - r.left - r.width / 2;
    const oy = cy - r.top - r.height / 2;
    const u = { x: at.c.x + ox / at.z, y: at.c.y - oy / at.z };
    move(at, { x: u.x - ox / nz, y: u.y + oy / nz }, nz);
  };

  const view = h("div", "plane.view", { tabindex: "0", "aria-keyshortcuts": "ArrowLeft ArrowRight ArrowUp ArrowDown + -", "aria-label": label || undefined });

  // ---- the pointer: drag to pan, two fingers to pinch
  on(view, "pointerdown", (e) => {
    const pe = e as PointerEvent;
    if ((pe.pointerType === "mouse" && pe.button !== 0) || (e.target as Element).closest?.(OWN_POINTER)) return;
    const st = liveOf(e.currentTarget as Element);
    st.pointers.set(pe.pointerId, { x: pe.clientX, y: pe.clientY });
    if (st.pointers.size === 1) st.drag = { x: pe.clientX, y: pe.clientY, c: { ...lookNow().c }, moved: false };
    else if (st.pointers.size === 2) {
      const [a, b] = [...st.pointers.values()];
      st.pinch = { dist: Math.hypot(a.x - b.x, a.y - b.y) || 1, z: lookNow().z };
      st.drag = undefined;
    }
  });
  on(view, "pointermove", (e) => {
    const pe = e as PointerEvent;
    const me = e.currentTarget as HTMLElement;
    const st = liveOf(me);
    if (!st.pointers.has(pe.pointerId)) return;
    st.pointers.set(pe.pointerId, { x: pe.clientX, y: pe.clientY });
    if (st.pinch && st.pointers.size >= 2) {
      const [a, b] = [...st.pointers.values()];
      zoomAt(me, (a.x + b.x) / 2, (a.y + b.y) / 2, (st.pinch.z * Math.hypot(a.x - b.x, a.y - b.y)) / st.pinch.dist);
      return;
    }
    const drag = st.drag;
    if (!drag) return;
    const dx = pe.clientX - drag.x;
    const dy = pe.clientY - drag.y;
    if (!drag.moved) {
      if (Math.hypot(dx, dy) < DRAG_START) return;
      drag.moved = true;
      me.setPointerCapture?.(pe.pointerId);
      setPanning(me, st, true);
    }
    const at = lookNow();
    move(at, { x: drag.c.x - dx / at.z, y: drag.c.y + dy / at.z });
  });
  const up = (e: Event) => {
    const me = e.currentTarget as Element;
    const st = liveOf(me);
    if (!st.pointers.delete((e as PointerEvent).pointerId)) return;
    if (st.drag?.moved) st.dragged = true;
    if (st.pointers.size < 2) st.pinch = undefined;
    if (st.pointers.size === 0) {
      st.drag = undefined;
      setPanning(me, st, false);
    }
  };
  on(view, "pointerup", up);
  on(view, "pointercancel", up);
  on(view, "click", (e) => {
    const me = e.currentTarget as HTMLElement;
    const st = liveOf(me);
    // the click that ends a drag is the drag's
    if (st.dragged) {
      st.dragged = false;
      claim(e);
      return;
    }
    if (!listens || isClaimed(e) || (e.target as Element).closest?.("[data-part='spot']")) return;
    claim(e);
    const m = e as MouseEvent;
    const at = space.unit(m.clientX, m.clientY, me);
    if (!at) return;
    const places = placesFor(space.unitsPerPx(me));
    ctx.event("click", [ptValue({ x: toNum(at.x, places), y: toNum(at.y, places) })]);
  });
  on(view, "keydown", (e) => {
    if (e.target !== e.currentTarget) return;
    const ke = e as KeyboardEvent;
    const me = e.currentTarget as HTMLElement;
    const at = lookNow();
    const r = me.getBoundingClientRect();
    const step = 40 / at.z;
    const pans: Record<string, XY> = { ArrowLeft: { x: -step, y: 0 }, ArrowRight: { x: step, y: 0 }, ArrowUp: { x: 0, y: step }, ArrowDown: { x: 0, y: -step } };
    if (pans[ke.key]) move(at, { x: at.c.x + pans[ke.key].x, y: at.c.y + pans[ke.key].y });
    else if (ke.key === "+" || ke.key === "=") zoomAt(me, r.left + r.width / 2, r.top + r.height / 2, at.z * 1.25);
    else if (ke.key === "-" || ke.key === "_") zoomAt(me, r.left + r.width / 2, r.top + r.height / 2, at.z / 1.25);
    else return;
    e.preventDefault();
  });

  /** The wheel zooms: a listener that isn't passive, added by the hook, calls this render's. */
  const wheel = (e: WheelEvent, me: HTMLElement) => {
    const n = current();
    const lim = limitsOf(n, ctx, me.clientWidth);
    if (!(lim.high > lim.low)) return;
    e.preventDefault();
    const dy = e.deltaMode === 1 ? e.deltaY * 16 : e.deltaMode === 2 ? e.deltaY * 400 : e.deltaY;
    zoomAt(me, e.clientX, e.clientY, lookOf(n).z * Math.exp(-dy * (e.ctrlKey ? 0.01 : 0.0015)));
  };
  /** The Doc's layout, got now and kept for the ResizeObserver, which calls it after this render. */
  const layout = () => ctx.layout();
  const hook: Hook = {
    mount(el) {
      const st = liveOf(el);
      st.layout = layout;
      st.wheel = wheel;
      if (!st.onWheel) {
        st.onWheel = (e) => st.wheel(e as WheelEvent, el as HTMLElement);
        el.addEventListener("wheel", st.onWheel, { passive: false });
      }
      // sizes: a spot that changes size, or the view, lays the plane out again
      if (!st.ro && typeof ResizeObserver === "function") {
        st.ro = new ResizeObserver((entries) => {
          let moved = false;
          for (const x of entries) {
            const now = sizeOf(x.target);
            if (st.sizes.get(x.target) !== now) moved = true;
            st.sizes.set(x.target, now);
          }
          if (moved) st.layout();
        });
        st.ro.observe(el);
      }
      watchItems(el, st);
      el.classList.toggle("mkp-panning", st.panning);
    },
    update(el) {
      const st = liveOf(el);
      st.layout = layout;
      st.wheel = wheel;
      watchItems(el, st);
      // a renderer that sets the class again drops the drag's
      el.classList.toggle("mkp-panning", st.panning);
    },
    unmount(el) {
      const st = lives.get(el);
      if (!st) return;
      st.ro?.disconnect();
      if (st.onWheel) el.removeEventListener("wheel", st.onWheel);
      lives.delete(el);
    },
  };
  view.hook = hook;
  css(view, "aspect-ratio", String(aspect));

  const background = inSpace(space, () => ctx.children(d.slots.get("background") ?? []));
  const bg = s("svg", "plane.background", { width: "1", height: "1" }, background);
  const items = h("div", "plane.items", {}, ctx.children(d.slots.get("items") ?? []));
  const inner_ = h("div", "plane.inner", {}, [bg, items]);
  css(inner_, "transform", `scale(${z}) translate(${-c.x}px, ${c.y}px)`);
  view.children = [inner_];

  const el = h("div", "plane", { role: "group", "aria-roledescription": "plane", "aria-label": label || undefined }, [view]);
  css(el, "width", t.length(p("width")));
  return cls(el, "mkp-zoomable", high > low);
};

// ---- spot

export const spot: ViewWidget = (d, ctx) => {
  const at = point(d.props.get("at")) ?? { x: 0, y: 0 };
  const nudge = point(d.props.get("nudge")) ?? { x: 0, y: 0 };
  const el = h("div", "spot", {}, ctx.children(d.slots.get("child") ?? []));
  // at its point in the plane's units, y up; the anchor's part of it on the point
  css(el, "left", `${at.x + nudge.x}px`);
  css(el, "top", `${-(at.y + nudge.y)}px`);
  css(el, "transform", anchorShift(kase(d.props.get("anchor")) ?? "CENTER"));
  return el;
};

// ---- acting through the element, for the checks

/** None: @mkp/dom's plane and spot have no act, so a check's click, pan or zoom on a plane goes
 * through the page. */
export const acts: Record<string, Act> = {};
