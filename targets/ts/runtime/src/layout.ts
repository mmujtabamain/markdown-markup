// The plane's layout (page 5, plane; plan tab 15). A target measures what it drew; this works
// out, in the plane's units, where each spot landed, the plane's bounds when they are left out,
// its centre kept inside them and the region it draws, and writes them as one change per pass.
//
// At zoom 1 one unit of the plane is one of the page's own lengths, so a spot's box is its
// child's size on the page, placed at its point: panning and zooming never change it.

import type { Drawn, Page } from "./page.js";
import { Num } from "./eval/num.js";
import { record, some, type Value as V } from "./eval/value.js";

/** A size on the page, in its own lengths (a CSS pixel, an Android dp). */
export interface Size {
  width: Num;
  height: Num;
}

/** A point or a region, in a plane's units. */
export interface Pt {
  x: Num;
  y: Num;
}
export interface Region {
  from: Pt;
  to: Pt;
}

/** What a target tells the layout: the size of each spot's child, and the width a plane is
 * given when it says none. */
export interface Measure {
  spot(spot: Drawn): Size;
  planeWidth(plane: Drawn): Num;
}

/** A layout still changing after this many passes is stopped: a failure of the plane. */
export const MAX_LAYOUT_PASSES = 8;

/** One write a layout makes: a `mut` input of a drawn widget. */
export interface LayoutWrite {
  path: string;
  input: string;
  value: V;
}

const HALF = Num.literal("0.5")!;

/** Where a spot's child lands: the anchor's part of it on the point, moved by the nudge. */
export function place(at: Pt, anchor: string, nudge: Pt, size: Size): Region {
  // how much of the width is left of the point, and of the height below it
  const left = anchor.endsWith("W") ? Num.zero() : anchor.endsWith("E") ? size.width : size.width.mul(HALF);
  const below = anchor.startsWith("S") ? Num.zero() : anchor.startsWith("N") ? size.height : size.height.mul(HALF);
  const x = at.x.add(nudge.x).sub(left);
  const y = at.y.add(nudge.y).sub(below);
  return { from: { x, y }, to: { x: x.add(size.width), y: y.add(size.height) } };
}

/** The region around every box. */
export function around(boxes: Region[]): Region | undefined {
  if (!boxes.length) return undefined;
  const min = (a: Num, b: Num) => (a.lt(b) ? a : b);
  const max = (a: Num, b: Num) => (a.gt(b) ? a : b);
  return boxes.reduce((r, b) => ({
    from: { x: min(r.from.x, b.from.x), y: min(r.from.y, b.from.y) },
    to: { x: max(r.to.x, b.to.x), y: max(r.to.y, b.to.y) },
  }));
}

/** A centre kept where the drawn area stays inside the bounds, on each axis; their middle where
 * the bounds are smaller than it. */
export function keepInside(center: Pt, half: Pt, bounds: Region): Pt {
  const axis = (c: Num, h: Num, lo: Num, hi: Num): Num => {
    if (hi.sub(lo).lt(h.add(h))) return lo.add(hi).mul(HALF);
    if (c.sub(h).lt(lo)) return lo.add(h);
    if (c.add(h).gt(hi)) return hi.sub(h);
    return c;
  };
  return { x: axis(center.x, half.x, bounds.from.x, bounds.to.x), y: axis(center.y, half.y, bounds.from.y, bounds.to.y) };
}

// ---- values

export function ptOf(v: V | undefined): Pt | undefined {
  if (!v || v.kind !== "record") return undefined;
  const x = v.fields.find(([k]) => k === "x")?.[1];
  const y = v.fields.find(([k]) => k === "y")?.[1];
  return x?.kind === "num" && y?.kind === "num" ? { x: x.n, y: y.n } : undefined;
}

export function regionOf(v: V | undefined): Region | undefined {
  if (v?.kind === "opt") return regionOf(v.value ?? undefined);
  if (!v || v.kind !== "record") return undefined;
  const from = ptOf(v.fields.find(([k]) => k === "from")?.[1]);
  const to = ptOf(v.fields.find(([k]) => k === "to")?.[1]);
  return from && to ? { from, to } : undefined;
}

export function ptValue(p: Pt): V {
  return record("core/point", [
    ["x", { kind: "num", n: p.x }],
    ["y", { kind: "num", n: p.y }],
  ]);
}

export function regionValue(r: Region): V {
  return record("core/region", [
    ["from", ptValue(r.from)],
    ["to", ptValue(r.to)],
  ]);
}

function numOf(v: V | undefined, or: Num): Num {
  return v?.kind === "num" ? v.n : or;
}

// ---- a pass

/** Every plane in the tree, outermost first. */
export function planes(nodes: Drawn[], out: Drawn[] = []): Drawn[] {
  for (const n of nodes) {
    if (n.widget === "core/plane") out.push(n);
    for (const kids of n.slots.values()) planes(kids, out);
  }
  return out;
}

/** What one plane writes after a layout: each spot's box, its centre when it had to move, and
 * the region it draws. Boxes come first, so bounds left out are worked out from them. */
export function planeWrites(page: Page, plane: Drawn, measure: Measure): LayoutWrite[] {
  const writes: LayoutWrite[] = [];
  const boxes: Region[] = [];
  const zero: Pt = { x: Num.zero(), y: Num.zero() };
  for (const s of plane.slots.get("items") ?? []) {
    if (s.widget !== "core/spot") continue;
    const at = ptOf(s.props.get("at")) ?? zero;
    const anchor = s.props.get("anchor");
    const nudge = ptOf(s.props.get("nudge")) ?? zero;
    let box = place(at, anchor?.kind === "case" ? anchor.name : "CENTER", nudge, measure.spot(s));
    box = defective(page, plane, box);
    boxes.push(box);
    writes.push({ path: s.path, input: "box", value: some(regionValue(box)) });
  }
  const bounds = regionOf(plane.props.get("bounds")) ?? around(boxes);
  const aspect = numOf(plane.props.get("aspect"), Num.literal("1.5")!);
  const w = plane.props.get("width");
  const width = w?.kind === "opt" && w.value ? numOf(tokenNum(page, w.value), measure.planeWidth(plane)) : measure.planeWidth(plane);
  // the zoom: `fit` starts it where the whole of bounds fits, and zoom_range counts from there
  const was_zoom = numOf(plane.props.get("zoom"), Num.int(1));
  const fit = plane.props.get("fit");
  let base = Num.int(1);
  if (fit?.kind === "bool" && fit.b && bounds) {
    const bw = bounds.to.x.sub(bounds.from.x);
    const bh = bounds.to.y.sub(bounds.from.y);
    if (!bw.isZero() && !bh.isZero()) {
      const across = width.div(bw);
      const up = width.div(aspect).div(bh);
      base = across.lt(up) ? across : up;
    }
  }
  let zoom = was_zoom;
  const started = startedPlanes(page);
  if (!started.has(plane.key)) {
    started.add(plane.key);
    if (fit?.kind === "bool" && fit.b) zoom = base;
  }
  const range = plane.props.get("zoom_range");
  if (range?.kind === "range") {
    const lo = range.low?.kind === "num" ? range.low.n.mul(base) : undefined;
    const hi = range.high?.kind === "num" ? range.high.n.mul(base) : undefined;
    if (lo && zoom.lt(lo)) zoom = lo;
    if (hi && zoom.gt(hi)) zoom = hi;
  }
  // and inside what the zoom input allows
  const least = Num.literal("0.1")!;
  const most = Num.int(10);
  if (zoom.lt(least)) zoom = least;
  if (zoom.gt(most)) zoom = most;
  if (!zoom.equals(was_zoom)) writes.push({ path: plane.path, input: "zoom", value: { kind: "num", n: zoom } });
  // the drawn area, in the plane's units: the widget's size on the page over the zoom
  const half: Pt = { x: width.div(zoom).mul(HALF), y: width.div(aspect).div(zoom).mul(HALF) };
  const was = ptOf(plane.props.get("center")) ?? zero;
  const center = bounds ? keepInside(was, half, bounds) : was;
  if (!center.x.equals(was.x) || !center.y.equals(was.y)) writes.push({ path: plane.path, input: "center", value: ptValue(center) });
  const drawn: Region = { from: { x: center.x.sub(half.x), y: center.y.sub(half.y) }, to: { x: center.x.add(half.x), y: center.y.add(half.y) } };
  writes.push({ path: plane.path, input: "drawn", value: some(regionValue(drawn)) });
  return writes;
}

/** The test target's defects: a box in screen pixels changes with every zoom, and one measured
 * from the drawn area's corner changes with every pan. The checks catch both. */
function defective(page: Page, plane: Drawn, box: Region): Region {
  const zoom = numOf(plane.props.get("zoom"), Num.int(1));
  if (page.defect("boxes-in-pixels")) {
    const scale = (p: Pt): Pt => ({ x: p.x.mul(zoom), y: p.y.mul(zoom) });
    return { from: scale(box.from), to: scale(box.to) };
  }
  if (page.defect("boxes-follow-the-view")) {
    const c = ptOf(plane.props.get("center")) ?? { x: Num.zero(), y: Num.zero() };
    const shift = (p: Pt): Pt => ({ x: p.x.sub(c.x), y: p.y.sub(c.y) });
    return { from: shift(box.from), to: shift(box.to) };
  }
  return box;
}

const started = new WeakMap<Page, Set<string>>();

/** The planes of a page already laid out once, by identity: `fit` only sets where they start. */
function startedPlanes(page: Page): Set<string> {
  let s = started.get(page);
  if (!s) started.set(page, (s = new Set()));
  return s;
}

function tokenNum(page: Page, v: V): V | undefined {
  if (v.kind === "num") return v;
  if (v.kind === "case") return page.machine.defaultTokenValue(v);
  return undefined;
}

/** Lays the page's planes out until nothing changes: each pass's writes are one change. A page
 * still changing after MAX_LAYOUT_PASSES passes is stopped, and is a failure of its planes. */
export function layout(page: Page, measure: Measure): void {
  for (let pass = 0; pass < MAX_LAYOUT_PASSES; pass++) {
    const all = planes(page.tree());
    if (!all.length) return;
    const writes = all.flatMap((p) => planeWrites(page, p, measure));
    if (!page.layoutWrite(writes)) return;
  }
  for (const p of planes(page.tree())) page.layoutFailed(p.path);
}
