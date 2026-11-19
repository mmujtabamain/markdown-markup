// core.gfx in SVG: a canvas or a plane gives its shapes a space (its units, y up, onto SVG's
// coordinates), layers are groups, and shapes are SVG elements in it. `place` puts ordinary widgets
// at a point; `handle` is dragged; `shade` paints a 2D canvas from a shader, per sampled pixel.

import { MAX_STEPS, Num, ptValue, type Drawn, type Value } from "@extended-mark/runtime";
import type { Action, Widget, WidgetContext, WidgetView } from "../api.js";
import { attr, claim, css, h, isClaimed, kit, s } from "../kit.js";
import { exact, field, flag, inner, kase, list, num, placesFor, point, region, sig, str, toNum, type XY } from "../values.js";

/** A drawing surface's coordinates: its units onto SVG user units, and the screen back to units. */
export interface Space {
  x(u: number): number;
  y(u: number): number;
  /** A length along x (a circle's radius). */
  len(u: number): number;
  /** Where a pointer is, in units. */
  unit(clientX: number, clientY: number): XY | undefined;
  /** How many units one CSS pixel on the screen is now, for rounding a write. */
  unitsPerPx(): number;
  /** Keeps a point inside what the surface shows, for a handle. */
  keep(p: XY): XY;
}

/** A space for shapes drawn outside any canvas: units are pixels, y down. */
const loose: Space = { x: (u) => u, y: (u) => -u, len: (u) => u, unit: () => undefined, unitsPerPx: () => 1, keep: (p) => p };

const spaces: Space[] = [];

/** Draws a surface's slots inside its space: the shapes in them read it as they are drawn. */
export function inSpace(space: Space, draw: () => void): void {
  spaces.push(space);
  try {
    draw();
  } finally {
    spaces.pop();
  }
}

function currentSpace(): Space {
  return spaces[spaces.length - 1] ?? loose;
}

/** A shape's events: clicks, and the pointer or the focus entering and leaving. Only events that
 * do something make a shape interactive. */
function shapeEvents(el: SVGElement, ctx: WidgetContext) {
  let click = false;
  let hover = false;
  let inside = false;
  const enter = (now: boolean) => {
    if (!hover || now === inside) return;
    inside = now;
    ctx.event(now ? "enter" : "leave");
  };
  el.addEventListener("click", (e) => {
    if (!click) return;
    claim(e);
    ctx.event("click");
  });
  el.addEventListener("keydown", (e) => {
    if (!click || (e.key !== "Enter" && e.key !== " ")) return;
    e.preventDefault();
    ctx.event("click");
  });
  // inside while the pointer is over it, or while the keyboard's focus is on it
  el.addEventListener("pointerenter", () => enter(true));
  el.addEventListener("pointerleave", () => enter(el.matches(":focus-visible")));
  el.addEventListener("focus", () => el.matches(":focus-visible") && enter(true));
  el.addEventListener("blur", () => enter(el.matches(":hover")));
  return (d: Drawn, name: string) => {
    const has = (e: string) => (ctx.page.listens ? ctx.page.listens(d, e) : d.events.has(e));
    click = has("click");
    hover = has("enter") || has("leave");
    const live = click || hover;
    attr(el, "role", click ? "button" : name ? "img" : undefined);
    attr(el, "tabindex", live ? "0" : undefined);
    attr(el, "aria-label", name || undefined);
    attr(el, "aria-hidden", name || live ? undefined : "true");
    el.classList.toggle("xtmd-live", live);
  };
}

/** A stroke's width in pixels: a stroke token, or stroke.PX's number. */
function strokeWidth(v: Value | undefined, ctx: WidgetContext): number {
  return num(kit(ctx).tokens.value(v)) ?? 1;
}

// ---- canvas

export const canvas: Widget = (d, ctx) => {
  const el = h("figure", "canvas", { role: "group" });
  const svg = s("svg", "canvas.surface", { preserveAspectRatio: "none" });
  el.append(svg);
  let xr = { lo: -1, hi: 1 };
  let yr = { lo: -1, hi: 1 };
  let w = 320;
  let ht = 320;
  const space: Space = {
    x: (u) => ((u - xr.lo) / (xr.hi - xr.lo || 1)) * w,
    y: (u) => ((yr.hi - u) / (yr.hi - yr.lo || 1)) * ht,
    len: (u) => (u / (xr.hi - xr.lo || 1)) * w,
    unit(cx, cy) {
      const r = svg.getBoundingClientRect();
      if (!r.width || !r.height) return undefined;
      return { x: xr.lo + ((cx - r.left) / r.width) * (xr.hi - xr.lo), y: yr.hi - ((cy - r.top) / r.height) * (yr.hi - yr.lo) };
    },
    unitsPerPx() {
      const r = svg.getBoundingClientRect();
      return (xr.hi - xr.lo) / (r.width || w);
    },
    keep: (p) => ({ x: Math.min(xr.hi, Math.max(xr.lo, p.x)), y: Math.min(yr.hi, Math.max(yr.lo, p.y)) }),
  };
  let listens = false;
  svg.addEventListener("click", (e) => {
    if (!listens || isClaimed(e)) return;
    const at = space.unit(e.clientX, e.clientY);
    if (!at) return;
    const p = placesFor(space.unitsPerPx());
    ctx.event("click", [ptValue({ x: toNum(at.x, p), y: toNum(at.y, p) })]);
  });
  const view: WidgetView = {
    el,
    update(d) {
      const t = kit(ctx).tokens;
      const ends = (v: Value | undefined) => {
        const r = inner(v);
        return r && r.kind === "range" ? { lo: num(r.low ?? undefined) ?? -1, hi: num(r.high ?? undefined) ?? 1 } : { lo: -1, hi: 1 };
      };
      xr = ends(d.props.get("x"));
      yr = ends(d.props.get("y"));
      w = t.number(d.props.get("width")) ?? 320;
      const aspect = num(d.props.get("aspect")) ?? (xr.hi - xr.lo) / (yr.hi - yr.lo || 1);
      ht = w / (aspect > 0 ? aspect : 1);
      attr(svg, "viewBox", `0 0 ${w} ${ht}`);
      css(el, "width", `${w}px`);
      css(el, "aspect-ratio", `${w} / ${ht}`);
      attr(el, "aria-label", str(d.props.get("label")) || undefined);
      listens = ctx.page.listens ? ctx.page.listens(d, "click") : d.events.has("click");
      el.classList.toggle("xtmd-clickable", listens);
      inSpace(space, () => ctx.children(svg, d.slots.get("layers") ?? []));
    },
  };
  view.update(d);
  return view;
};

// ---- layer

export const layer: Widget = (d, ctx) => {
  const el = s("g", "layer");
  const clip = s("clipPath");
  const rect = s("rect");
  clip.append(rect);
  const shapes = s("g", "layer.shapes");
  el.append(clip, shapes);
  const id = `${kit(ctx).uid}clip-${++clips}`;
  clip.id = id;
  const view: WidgetView = {
    el,
    update(d) {
      const space = currentSpace();
      const o = num(d.props.get("opacity")) ?? 1;
      attr(el, "opacity", o === 1 ? undefined : String(o));
      const r = region(d.props.get("clip"));
      if (r) {
        const [x0, x1] = [space.x(r.from.x), space.x(r.to.x)].sort((a, b) => a - b);
        const [y0, y1] = [space.y(r.from.y), space.y(r.to.y)].sort((a, b) => a - b);
        for (const [k, v] of [["x", x0], ["y", y0], ["width", x1 - x0], ["height", y1 - y0]] as const) attr(rect, k, String(v));
      }
      attr(shapes, "clip-path", r ? `url(#${id})` : undefined);
      ctx.children(shapes, d.slots.get("shapes") ?? []);
    },
  };
  view.update(d);
  return view;
};

let clips = 0;

// ---- circle and path

export const circle: Widget = (d, ctx) => {
  const el = s("circle", "circle");
  const events = shapeEvents(el, ctx);
  const view: WidgetView = {
    el,
    update(d) {
      const space = currentSpace();
      const t = kit(ctx).tokens;
      const at = point(d.props.get("at")) ?? { x: 0, y: 0 };
      attr(el, "cx", String(space.x(at.x)));
      attr(el, "cy", String(space.y(at.y)));
      attr(el, "r", String(Math.abs(space.len(num(d.props.get("r")) ?? 0))));
      css(el, "fill", t.color(d.props.get("fill")) ?? "none");
      css(el, "stroke", t.color(d.props.get("stroke")));
      css(el, "stroke-width", `${strokeWidth(d.props.get("width"), ctx)}px`);
      const o = num(d.props.get("opacity")) ?? 1;
      attr(el, "opacity", o === 1 ? undefined : String(o));
      events(d, str(d.props.get("label")));
    },
    act: shapeAct(el),
  };
  view.update(d);
  return view;
};

export const path: Widget = (d, ctx) => {
  const el = s("g", "path");
  const line = s("path", "path.line");
  const head = s("path", "path.head");
  el.append(line, head);
  const events = shapeEvents(el, ctx);
  const view: WidgetView = {
    el,
    update(d) {
      const space = currentSpace();
      const t = kit(ctx).tokens;
      const pts = list(d.props.get("points"))
        .map(point)
        .filter((p): p is XY => !!p)
        .map((p) => ({ x: space.x(p.x), y: space.y(p.y) }));
      const closed = flag(d.props.get("closed"));
      attr(line, "d", pts.map((p, k) => `${k ? "L" : "M"}${p.x} ${p.y}`).join("") + (closed ? "Z" : ""));
      const color = t.color(d.props.get("stroke"));
      const w = strokeWidth(d.props.get("width"), ctx);
      css(line, "fill", closed ? (t.color(d.props.get("fill")) ?? "none") : "none");
      css(line, "stroke", color ?? "none");
      css(line, "stroke-width", `${w}px`);
      css(line, "stroke-dasharray", flag(d.props.get("dash")) ? `${w * 4} ${w * 3}` : undefined);
      // the head at the last point, along the last segment, in the stroke's colour
      const kind = kase(d.props.get("head")) ?? "NONE";
      const [a, b] = [pts[pts.length - 2], pts[pts.length - 1]];
      let hd = "";
      if (a && b && kind !== "NONE") {
        const len = Math.hypot(b.x - a.x, b.y - a.y) || 1;
        const [ux, uy] = [(b.x - a.x) / len, (b.y - a.y) / len];
        const size = 4 + w * 3;
        if (kind === "ARROW") {
          const back = { x: b.x - ux * size, y: b.y - uy * size };
          hd = `M${b.x} ${b.y}L${back.x - uy * size * 0.5} ${back.y + ux * size * 0.5}L${back.x + uy * size * 0.5} ${back.y - ux * size * 0.5}Z`;
        } else {
          const r = size * 0.4;
          hd = `M${b.x - r} ${b.y}a${r} ${r} 0 1 0 ${2 * r} 0a${r} ${r} 0 1 0 ${-2 * r} 0Z`;
        }
      }
      attr(head, "d", hd || undefined);
      css(head, "fill", hd ? (color ?? "none") : undefined);
      const o = num(d.props.get("opacity")) ?? 1;
      attr(el, "opacity", o === 1 ? undefined : String(o));
      events(d, str(d.props.get("label")));
    },
    act: shapeAct(el),
  };
  view.update(d);
  return view;
};

/** A shape acted on by the checks: a click is a real click; entering and leaving are the pointer's. */
function shapeAct(el: SVGElement) {
  return (a: Action): boolean => {
    if (!("event" in a)) return false;
    if (a.event === "click") el.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true }));
    else if (a.event === "enter" || a.event === "leave") el.dispatchEvent(new PointerEvent(a.event === "enter" ? "pointerenter" : "pointerleave"));
    else return false;
    return true;
  };
}

// ---- place: ordinary widgets at a point

/** How far an anchor moves a box from its point, as CSS translate percentages. */
export function anchorShift(anchor: string): string {
  const x = anchor.endsWith("W") ? "0%" : anchor.endsWith("E") ? "-100%" : "-50%";
  const y = anchor.startsWith("N") ? "0%" : anchor.startsWith("S") ? "-100%" : "-50%";
  return `translate(${x}, ${y})`;
}

export const place: Widget = (d, ctx) => {
  const el = s("foreignObject", "place", { width: "1", height: "1" });
  const box = h("div", "place.box");
  el.append(box);
  const view: WidgetView = {
    el,
    update(d) {
      const space = currentSpace();
      const at = point(d.props.get("at")) ?? { x: 0, y: 0 };
      const nudge = point(d.props.get("nudge")) ?? { x: 0, y: 0 };
      // the foreignObject sits on the point; its box hangs from it by the anchor, nudged in pixels, y up
      attr(el, "x", String(space.x(at.x) + nudge.x));
      attr(el, "y", String(space.y(at.y) - nudge.y));
      css(box, "transform", anchorShift(kase(d.props.get("anchor")) ?? "CENTER"));
      const o = num(d.props.get("opacity")) ?? 1;
      attr(el, "opacity", o === 1 ? undefined : String(o));
      const name = str(d.props.get("label"));
      attr(box, "role", name ? "group" : undefined);
      attr(box, "aria-label", name || undefined);
      ctx.children(box, d.slots.get("child") ?? []);
    },
  };
  view.update(d);
  return view;
};

// ---- handle

export const handle: Widget = (d, ctx) => {
  const el = s("g", "handle", { tabindex: "0", role: "slider", "aria-roledescription": "handle" });
  const hit = s("circle", "handle.hit", { r: "14" });
  const dot = s("circle", "handle.dot", { r: "7" });
  el.append(hit, dot);
  let space = currentSpace();
  let at: XY = { x: 0, y: 0 };
  const write = (p: XY) => {
    const k = space.keep(p);
    const places = placesFor(space.unitsPerPx());
    ctx.write("at", ptValue({ x: toNum(k.x, places), y: toNum(k.y, places) }));
  };
  let dragging: number | undefined;
  el.addEventListener("pointerdown", (e) => {
    if (e.button !== 0) return;
    // the handle's drag, not the plane's pan around it
    e.stopPropagation();
    e.preventDefault();
    dragging = e.pointerId;
    el.setPointerCapture?.(e.pointerId);
    el.focus({ preventScroll: true });
  });
  el.addEventListener("pointermove", (e) => {
    if (dragging !== e.pointerId) return;
    const p = space.unit(e.clientX, e.clientY);
    if (p) write(p);
  });
  const stop = (e: PointerEvent) => {
    if (dragging === e.pointerId) dragging = undefined;
  };
  el.addEventListener("pointerup", stop);
  el.addEventListener("pointercancel", stop);
  el.addEventListener("click", claim);
  el.addEventListener("keydown", (e) => {
    const step = space.unitsPerPx() * (e.shiftKey ? 40 : 8);
    const move: Record<string, XY> = { ArrowLeft: { x: -step, y: 0 }, ArrowRight: { x: step, y: 0 }, ArrowUp: { x: 0, y: step }, ArrowDown: { x: 0, y: -step } };
    const m = move[e.key];
    if (!m) return;
    e.preventDefault();
    write({ x: at.x + m.x, y: at.y + m.y });
  });
  const view: WidgetView = {
    el,
    update(d) {
      space = currentSpace();
      at = point(d.props.get("at")) ?? { x: 0, y: 0 };
      for (const c of [hit, dot]) {
        attr(c, "cx", String(space.x(at.x)));
        attr(c, "cy", String(space.y(at.y)));
      }
      css(dot, "fill", kit(ctx).tokens.color(d.props.get("tone")) ?? "var(--xtmd-color-accent)");
      const o = num(d.props.get("opacity")) ?? 1;
      attr(el, "opacity", o === 1 ? undefined : String(o));
      attr(el, "aria-label", str(d.props.get("label")) || undefined);
      const shown = `(${exact(field(d.props.get("at"), "x"))?.show() ?? 0}, ${exact(field(d.props.get("at"), "y"))?.show() ?? 0})`;
      attr(el, "aria-valuetext", shown);
    },
    // no act: a drag lands on whole pixels, so a check's exact point goes through the page
  };
  view.update(d);
  return view;
};

// ---- shade: pixels from a shader

/** At most this many pixels are worked out per shade, scaled up to its size. */
export const MAX_SHADE_PIXELS = 65536;

export const shade: Widget = (d, ctx) => {
  const el = s("foreignObject", "shade", { role: "img" });
  const cv = h("canvas", "shade.pixels");
  el.append(cv);
  let was = "";
  let job = 0;
  const view: WidgetView = {
    el,
    update(d) {
      const space = currentSpace();
      attr(el, "aria-label", str(d.props.get("label")) || undefined);
      const o = num(d.props.get("opacity")) ?? 1;
      attr(el, "opacity", o === 1 ? undefined : String(o));
      const area = d.props.get("area");
      const r = region(area);
      if (!r) return;
      const [x0, x1] = [space.x(r.from.x), space.x(r.to.x)].sort((a, b) => a - b);
      const [y0, y1] = [space.y(r.from.y), space.y(r.to.y)].sort((a, b) => a - b);
      attr(el, "x", String(x0));
      attr(el, "y", String(y0));
      attr(el, "width", String(Math.max(0, x1 - x0)));
      attr(el, "height", String(Math.max(0, y1 - y0)));
      const now = [sig(area), sig(d.props.get("shader")), sig(d.props.get("args")), x1 - x0, y1 - y0, kit(ctx).tokens.theme()].join("|");
      if (now === was) return;
      was = now;
      paint(cv, el, d, x1 - x0, y1 - y0, ctx, ++job, () => job);
    },
    destroy() {
      job++;
    },
  };
  view.update(d);
  return view;
};

/**
 * Paints a shade: a coarse pass now, so something shows at once, then every sampled pixel in
 * slices of a few milliseconds, so the page stays responsive. At most MAX_SHADE_PIXELS are worked
 * out, and fewer when the shader is Extended Mark code: the whole shade keeps within the step limit.
 */
function paint(cv: HTMLCanvasElement, el: Element, d: Drawn, wPx: number, hPx: number, ctx: WidgetContext, id: number, current: () => number): void {
  const machine = ctx.page.machine;
  const shader = inner(d.props.get("shader"));
  const args = d.props.get("args") ?? { kind: "opt", value: null };
  const area = d.props.get("area");
  const from = { x: exact(field(field(area, "from"), "x")), y: exact(field(field(area, "from"), "y")) };
  const to = { x: exact(field(field(area, "to"), "x")), y: exact(field(field(area, "to"), "y")) };
  const g = cv.getContext("2d");
  el.setAttribute("data-state", "painting");
  if (!shader || shader.kind !== "fn" || !g || !from.x || !from.y || !to.x || !to.y || wPx <= 0 || hPx <= 0) {
    el.setAttribute("data-state", shader && shader.kind === "fn" ? "empty" : "no-shader");
    return;
  }
  const [lx, hx] = from.x.lt(to.x) ? [from.x, to.x] : [to.x, from.x];
  const [ly, hy] = from.y.lt(to.y) ? [from.y, to.y] : [to.y, from.y];
  /** One pass of cols × rows samples: each one's colour, from the top-left, row by row. */
  const pass = (cols: number, rows: number) => {
    const px = hx.sub(lx).div(Num.int(cols));
    const py = hy.sub(ly).div(Num.int(rows));
    const half = Num.parse("0.5")!;
    const xs = Array.from({ length: cols }, (_, i) => ({ kind: "num", n: lx.add(px.mul(Num.int(i).add(half))) }) as Value);
    const ys = Array.from({ length: rows }, (_, j) => ({ kind: "num", n: hy.sub(py.mul(Num.int(j).add(half))) }) as Value);
    const size: Value = { kind: "num", n: px };
    const data = new ImageData(cols, rows);
    let j = 0;
    const row = () => {
      for (let i = 0; i < cols; i++) {
        const at: Value = { kind: "record", ty: "core/point", fields: [["x", xs[i]], ["y", ys[j]]] };
        const c = machine.apply(shader, [{ value: at }, { value: size }, { value: args }]);
        const k = (j * cols + i) * 4;
        const ch = (n: string, or: number) => Math.round(255 * Math.min(1, Math.max(0, num(field(c, n)) ?? or)));
        data.data[k] = ch("r", 0);
        data.data[k + 1] = ch("g", 0);
        data.data[k + 2] = ch("b", 0);
        data.data[k + 3] = ch("a", 1);
      }
      j++;
    };
    return { data, row, done: () => j >= rows };
  };
  const show = (data: ImageData) => {
    cv.width = data.width;
    cv.height = data.height;
    g.putImageData(data, 0, 0);
  };
  const fail = (f: unknown) => {
    ctx.page.errors.push(f);
    el.setAttribute("data-state", "failed");
  };
  // the coarse pass, and what one sample costs in steps
  const dpr = typeof devicePixelRatio === "number" ? Math.min(2, devicePixelRatio) : 1;
  const scale = Math.min(dpr, Math.sqrt(MAX_SHADE_PIXELS / (wPx * hPx)));
  let cols = Math.max(1, Math.round(wPx * scale));
  let rows = Math.max(1, Math.round(hPx * scale));
  const c0 = Math.min(cols, 16);
  const r0 = Math.min(rows, 16);
  machine.resetSteps();
  let perSample: number;
  try {
    const coarse = pass(c0, r0);
    while (!coarse.done()) coarse.row();
    perSample = Math.max(1, machine.steps / (c0 * r0));
    show(coarse.data);
  } catch (f) {
    fail(f);
    return;
  }
  const budget = Math.floor((MAX_STEPS * 0.9) / perSample);
  if (cols * rows > budget) {
    const k = Math.sqrt(budget / (cols * rows));
    cols = Math.max(1, Math.floor(cols * k));
    rows = Math.max(1, Math.floor(rows * k));
  }
  el.setAttribute("data-samples", `${cols}x${rows}`);
  if (cols <= c0 && rows <= r0) {
    el.setAttribute("data-state", "done");
    return;
  }
  const full = pass(cols, rows);
  let steps = 0;
  const slice = () => {
    if (current() !== id) return;
    const until = performance.now() + 12;
    try {
      while (!full.done() && performance.now() < until) {
        machine.resetSteps();
        full.row();
        steps += machine.steps;
        if (steps > MAX_STEPS) throw new Error("the shader took more than the step limit");
      }
    } catch (f) {
      fail(f);
      return;
    }
    if (full.done()) {
      show(full.data);
      el.setAttribute("data-state", "done");
    } else setTimeout(slice, 0);
  };
  setTimeout(slice, 0);
}
