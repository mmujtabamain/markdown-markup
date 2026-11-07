// The 2D canvas (spec 8): a coordinate space with layers drawn in order, shapes in data units (or a
// circle's px), labels and placed elements as HTML over the SVG, handles with arrow-key
// alternatives (WCAG 2.5.7), and with gfx@1: pixels through WebGL and a 3D mesh with a camera.

import { useEffect, useId, useLayoutEffect, useRef, useState, type CSSProperties, type KeyboardEvent, type ReactNode } from 'react';
import type { VNode, VShape, VRun } from '@mkp/core';
import { color, size as sizeTok } from './style';
import { Kids, Runs, useCtx } from './nodes';

const SIZES: Record<string, number> = { s: 160, m: 320, l: 480 };

/** The width it has: its parent's, up to `max`. */
function useWidth(ref: { current: HTMLElement | null }, max: number): number {
  const [w, setW] = useState(max);
  useEffect(() => {
    const el = ref.current?.parentElement;
    if (!el || typeof ResizeObserver === 'undefined') return;
    const ro = new ResizeObserver(() => {
      const avail = el.clientWidth || max;
      setW(Math.max(80, Math.min(max, avail)));
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, [ref, max]);
  return w;
}

/** A fixed height in a size token, as drawn (a provider may give the token its own value). */
function useHeight(ref: { current: HTMLElement | null }, token: string | undefined): number | undefined {
  const [h, setH] = useState<number | undefined>(token ? SIZES[token] ?? 160 : undefined);
  useEffect(() => {
    const el = ref.current;
    if (!token || !el || typeof ResizeObserver === 'undefined') return;
    const ro = new ResizeObserver(() => el.clientHeight && setH(el.clientHeight));
    ro.observe(el);
    return () => ro.disconnect();
  }, [ref, token]);
  return token ? h : undefined;
}

export function Canvas({ n }: { n: VNode }): ReactNode {
  const { rt } = useCtx();
  // one page may draw a document twice: its layers' clip rectangles need ids of their own
  const uid = useId();
  const p = n.p;
  const box = useRef<HTMLDivElement | null>(null);
  const tok = String(p.size ?? 'm');
  const cssMax = tok === 'fill' ? 4000 : SIZES[tok] ?? 320;
  const W = useWidth(box, cssMax);
  const x = (p.x as number[]) ?? [-1, 1];
  const y = (p.y as number[]) ?? [-1, 1];
  const aspect = Number(p.aspect) > 0 ? Number(p.aspect) : (x[1] - x[0]) / (y[1] - y[0]) || 1;
  // a height of its own, so a plot fills a stage of that height whatever its width (GAPS 18, 104)
  const fixed = p.height && p.height !== 'none' ? String(p.height) : undefined;
  const H = Math.round(useHeight(box, fixed) ?? W / aspect);
  if (Number(p.dims) === 3) return <Canvas3D n={n} W={W} H={H} box={box} />;
  const X = (v: number): number => ((v - x[0]) / (x[1] - x[0])) * W;
  const Y = (v: number): number => H - ((v - y[0]) / (y[1] - y[0])) * H;
  const unit = W / (x[1] - x[0]);
  const html: ReactNode[] = [];
  const labels: Label[] = [];
  const dispatch = (key: string, event: string): void => rt.dispatch(key, event);
  const clipId = (l: { key: string }): string => `mkp-clip-${(uid + l.key).replace(/[^\w-]/g, '_')}`;
  const layers = (n.layers ?? []).map((l) => (
    <g key={l.key} opacity={l.opacity} data-mkp-key={l.key} clipPath={l.clip ? `url(#${clipId(l)})` : undefined}>
      {l.clip ? (
        <clipPath id={clipId(l)}>
          <rect x={X(l.clip[0])} y={Y(l.clip[3])} width={X(l.clip[2]) - X(l.clip[0])} height={Y(l.clip[1]) - Y(l.clip[3])} />
        </clipPath>
      ) : null}
      {l.shapes.map((s) => shape(s, { X, Y, unit, W, H, x, y, html, labels, opacity: l.opacity, dispatch }))}
    </g>
  ));
  // a figure is an image, unless a shape in it can be pressed: then it is a group of controls
  const pressable = (n.layers ?? []).some((l) => l.shapes.some((s) => (s.t === 'circle' || s.t === 'path') && s.ev?.includes('click')));
  return (
    <div
      ref={(el) => {
        box.current = el;
      }}
      data-mkp="canvas"
      data-mkp-key={n.key}
      data-mkp-id={n.id}
      hidden={n.hidden || undefined}
      className="mkp-canvas"
      style={{ width: W, height: fixed ? sizeTok(fixed) : H }}
      role={pressable ? 'group' : 'img'}
      aria-label={String(p.label || 'figure')}
    >
      <svg width={W} height={H} viewBox={`0 0 ${W} ${H}`}>
        {layers}
      </svg>
      {html}
      <Labels labels={labels} W={W} H={H} />
    </div>
  );
}

interface Geo {
  X: (v: number) => number;
  Y: (v: number) => number;
  unit: number;
  W: number;
  H: number;
  x: number[];
  y: number[];
  html: ReactNode[];
  labels: Label[];
  opacity: number;
  dispatch: (key: string, event: string) => void;
}

/**
 * A circle's or path's own events, for the ones it was written with: the pointer onto it and off it,
 * and a press. One that takes a press is a control: focusable, named by its label, pressed with Enter
 * or Space, and it reports focus as enter and blur as leave, as a press does. Nothing else of the
 * pointer (no position, no buttons) reaches the document.
 */
function pointing(s: Extract<VShape, { t: 'circle' | 'path' }>, g: Geo): Record<string, unknown> {
  const ev = s.ev ?? [];
  if (!ev.length) return {};
  const on: Record<string, unknown> = { 'data-mkp-key': s.key, 'data-pointed': '' };
  const send = (e: string) => () => g.dispatch(s.key, e);
  if (ev.includes('enter')) on.onPointerEnter = send('enter');
  if (ev.includes('leave')) on.onPointerLeave = send('leave');
  if (ev.includes('click')) {
    Object.assign(on, { 'data-press': '', role: 'button', tabIndex: 0, 'aria-label': s.label || undefined, onClick: send('click') });
    on.onKeyDown = (e: KeyboardEvent) => {
      if (e.key !== 'Enter' && e.key !== ' ') return;
      e.preventDefault();
      g.dispatch(s.key, 'click');
    };
    if (ev.includes('enter')) on.onFocus = send('enter');
    if (ev.includes('leave')) on.onBlur = send('leave');
  }
  return on;
}

const paint = (c: string): string => (c && c !== 'none' ? color(c)! : 'none');
const own = (o: number | undefined): number | undefined => (o !== undefined && o < 1 ? o : undefined);

/** A dash that keeps its look at any stroke width. */
const dash = (w: number): string => `${Math.max(4, 3 * w)} ${Math.max(3, 2.5 * w)}`;

/**
 * A path's head at its last point, sized to its stroke and never more than a share of its length,
 * so a short line keeps a shaft (GAPS 113). The shaft stops under an arrow's head, not at its tip.
 */
export function pathHead(pts: number[][], kind: 'arrow' | 'dot', w: number): { shaft: number[][]; tri?: string; at: number[]; size: number } {
  const n = pts.length;
  const total = pts.slice(1).reduce((s, q, i) => s + Math.hypot(q[0] - pts[i][0], q[1] - pts[i][1]), 0);
  const tip = pts[n - 1];
  let k = n - 2;
  while (k > 0 && Math.hypot(tip[0] - pts[k][0], tip[1] - pts[k][1]) < 0.5) k--;
  const from = pts[k] ?? tip;
  const len = Math.hypot(tip[0] - from[0], tip[1] - from[1]) || 1;
  const u = [(tip[0] - from[0]) / len, (tip[1] - from[1]) / len];
  if (kind === 'dot') return { shaft: pts, at: tip, size: Math.min(Math.max(2.5, w * 1.8), Math.max(1.5, total / 4)) };
  const L = Math.min(5 + 2.5 * w, Math.max(3, total * 0.4));
  const half = L * 0.42 + w / 2;
  const base = [tip[0] - u[0] * L, tip[1] - u[1] * L];
  const shaft = [...pts.slice(0, n - 1), [tip[0] - u[0] * L * 0.6, tip[1] - u[1] * L * 0.6]];
  const f = (v: number): string => v.toFixed(2);
  const tri = `${f(tip[0])},${f(tip[1])} ${f(base[0] - u[1] * half)},${f(base[1] + u[0] * half)} ${f(base[0] + u[1] * half)},${f(base[1] - u[0] * half)}`;
  return { shaft, tri, at: tip, size: L };
}

function shape(s: VShape, g: Geo): ReactNode {
  const { X, Y, unit } = g;
  switch (s.t) {
    case 'circle':
      // px: a radius on the screen, whatever the ranges (GAPS 109)
      return <circle key={s.key} cx={X(s.c[0])} cy={Y(s.c[1])} r={s.px ? s.px : Math.max(0.5, s.r * unit)} fill={paint(s.fill)} stroke={paint(s.stroke)} strokeWidth={s.width} opacity={own(s.opacity)} {...pointing(s, g)} />;
    case 'path': {
      const pts = s.pts.map((q) => [X(q[0]), Y(q[1])]);
      if (!pts.length) return null;
      const head = s.head && pts.length > 1 ? pathHead(pts, s.head, s.width || 1) : null;
      const line = head?.shaft ?? pts;
      const d = line.map((q, i) => `${i ? 'L' : 'M'}${q[0].toFixed(2)},${q[1].toFixed(2)}`).join(' ') + (s.closed ? ' Z' : '');
      const ink = paint(s.stroke);
      return (
        <g key={s.key} opacity={own(s.opacity)} data-head={s.head} {...pointing(s, g)}>
          <path d={d} fill={paint(s.fill)} stroke={ink} strokeWidth={s.width} strokeDasharray={s.dash ? dash(s.width || 1) : undefined} strokeLinejoin="round" />
          {head?.tri ? <polygon points={head.tri} fill={ink} /> : null}
          {head && !head.tri ? <circle cx={head.at[0]} cy={head.at[1]} r={head.size} fill={ink} /> : null}
        </g>
      );
    }
    case 'label':
      g.labels.push({ s, x: X(s.at[0]) + (s.dx ?? 0), y: Y(s.at[1]) - (s.dy ?? 0), opacity: g.opacity * (s.opacity ?? 1) });
      return null;
    case 'image':
      return <image key={s.key} href={s.src} x={X(s.at[0]) - (s.w * unit) / 2} y={Y(s.at[1]) - ((s.h || s.w) * unit) / 2} width={s.w * unit} height={(s.h || s.w) * unit} aria-label={s.alt} />;
    case 'place':
      g.html.push(
        <div key={s.key} className="mkp-place" style={{ left: X(s.at[0]), top: Y(s.at[1]), opacity: g.opacity }}>
          <Kids nodes={s.kids} />
        </div>,
      );
      return null;
    case 'handle':
      return <Handle key={s.key} s={s} g={g} />;
    case 'pixels':
      g.html.push(<Pixels key={s.key} s={s} g={g} />);
      return null;
    case 'mesh':
      return null;
  }
}

/** A label to place: its shape, its point in pixels (with its own offsets, dy up), and its opacity. */
interface Label {
  s: Extract<VShape, { t: 'label' }>;
  x: number;
  y: number;
  opacity: number;
}

/** Where on a label its point is: a fraction across and down it. */
function anchorAt(a: string): [number, number] {
  if (a === 'center') return [0.5, 0.5];
  return [a.includes('e') ? 0 : a.includes('w') ? 1 : 0.5, a.includes('n') ? 1 : a.includes('s') ? 0 : 0.5];
}

type Spot = [number, number, number, number];
const clash = (a: Spot, b: Spot): number => Math.max(0, Math.min(a[0] + a[2], b[0] + b[2]) - Math.max(a[0], b[0])) * Math.max(0, Math.min(a[1] + a[3], b[1] + b[3]) - Math.max(a[1], b[1]));

/**
 * The labels' places once their sizes are known: each kept inside the canvas, then moved the least
 * it can to clear the labels placed before it (GAPS 107). [x, y, w, h] per label, in order.
 */
export function placeCanvasLabels(boxes: { x: number; y: number; w: number; h: number; anchor: string }[], W: number, H: number): Spot[] {
  const inside = (x: number, y: number, w: number, h: number): Spot => [Math.max(0, Math.min(W - w, x)), Math.max(0, Math.min(H - h, y)), w, h];
  const placed: Spot[] = [];
  for (const b of boxes) {
    const [ax, ay] = anchorAt(b.anchor);
    const start = inside(b.x - b.w * ax, b.y - b.h * ay, b.w, b.h);
    const hits = placed.filter((o) => clash(o, start) > 0);
    if (!hits.length) {
      placed.push(start);
      continue;
    }
    const tries: Spot[] = [start];
    for (const o of hits) tries.push(inside(start[0], o[1] - b.h - 1, b.w, b.h), inside(start[0], o[1] + o[3] + 1, b.w, b.h), inside(o[0] - b.w - 1, start[1], b.w, b.h), inside(o[0] + o[2] + 1, start[1], b.w, b.h));
    const cost = (t: Spot): number => placed.reduce((s, o) => s + clash(o, t), 0) * 1000 + Math.hypot(t[0] - start[0], t[1] - start[1]);
    placed.push(tries.reduce((best, t) => (cost(t) < cost(best) ? t : best)));
  }
  return placed;
}

/** The canvas's labels as HTML (so they hold inline maths), placed once their sizes are measured. */
function Labels({ labels, W, H }: { labels: Label[]; W: number; H: number }): ReactNode {
  const refs = useRef(new Map<string, HTMLDivElement>());
  const [spots, setSpots] = useState<Record<string, [number, number]>>({});
  useLayoutEffect(() => {
    const boxes = labels.map((l) => {
      const el = refs.current.get(l.s.key);
      return { x: l.x, y: l.y, w: el?.offsetWidth ?? 0, h: el?.offsetHeight ?? 0, anchor: l.s.anchor };
    });
    // not laid out yet (no sizes): the anchors stand
    if (!boxes.some((b) => b.w > 0)) return;
    const placed = placeCanvasLabels(boxes, W, H);
    const next: Record<string, [number, number]> = {};
    labels.forEach((l, i) => (next[l.s.key] = [Math.round(placed[i][0] * 10) / 10, Math.round(placed[i][1] * 10) / 10]));
    setSpots((prev) => (JSON.stringify(prev) === JSON.stringify(next) ? prev : next));
  });
  return labels.map((l) => {
    const s = l.s;
    const at = spots[s.key];
    const [ax, ay] = anchorAt(s.anchor);
    const place: CSSProperties = at ? { left: at[0], top: at[1] } : { left: l.x, top: l.y, transform: `translate(${-ax * 100}%, ${-ay * 100}%)` };
    return (
      <div
        key={s.key}
        ref={(el) => {
          if (el) refs.current.set(s.key, el);
          else refs.current.delete(s.key);
        }}
        className="mkp-overlay-label"
        data-chip={s.chip ? '' : undefined}
        data-halo={s.halo ? '' : undefined}
        data-size={s.size}
        style={{ ...place, color: color(s.tone), opacity: l.opacity < 1 ? l.opacity : undefined }}
      >
        <Runs runs={s.runs as VRun[]} />
      </div>
    );
  });
}

/** A drag handle: pointer drag, plus arrow keys as the non-drag alternative. */
function Handle({ s, g }: { s: Extract<VShape, { t: 'handle' }>; g: Geo }): ReactNode {
  const { rt } = useCtx();
  const dragging = useRef(false);
  const ref = useRef<SVGGElement>(null);
  const toData = (e: { clientX: number; clientY: number }): number[] => {
    const svg = ref.current?.ownerSVGElement;
    const r = svg!.getBoundingClientRect();
    const px = e.clientX - r.left;
    const py = e.clientY - r.top;
    return [g.x[0] + (px / g.W) * (g.x[1] - g.x[0]), g.y[0] + ((g.H - py) / g.H) * (g.y[1] - g.y[0])];
  };
  const stepX = (s.x[1] - s.x[0]) / 50;
  const stepY = (s.y[1] - s.y[0]) / 50;
  const fmt = (v: number): string => String(Number(v.toPrecision(3)));
  return (
    <g
      ref={ref}
      className="mkp-handle"
      tabIndex={0}
      role="slider"
      aria-label={s.label}
      aria-valuetext={`(${fmt(s.at[0])}, ${fmt(s.at[1])})`}
      data-mkp-key={s.key}
      onPointerDown={(e) => {
        dragging.current = true;
        (e.currentTarget as Element).setPointerCapture(e.pointerId);
      }}
      onPointerMove={(e) => dragging.current && rt.dispatch(s.key, 'drag', toData(e))}
      onPointerUp={() => (dragging.current = false)}
      onKeyDown={(e) => {
        const d: Record<string, [number, number]> = { ArrowLeft: [-stepX, 0], ArrowRight: [stepX, 0], ArrowUp: [0, stepY], ArrowDown: [0, -stepY] };
        const m = d[e.key];
        if (!m) return;
        e.preventDefault();
        const k = e.shiftKey ? 5 : 1;
        rt.dispatch(s.key, 'drag', [s.at[0] + m[0] * k, s.at[1] + m[1] * k]);
      }}
    >
      <circle cx={g.X(s.at[0])} cy={g.Y(s.at[1])} r={14} fill="transparent" />
      <circle cx={g.X(s.at[0])} cy={g.Y(s.at[1])} r={7} fill={color(s.tone)} stroke="var(--mkp-color-surface)" strokeWidth={2} />
    </g>
  );
}

/** pixels: the compiled GLSL in a WebGL canvas, or the fallback image. */
function Pixels({ s, g }: { s: Extract<VShape, { t: 'pixels' }>; g: Geo }): ReactNode {
  const ref = useRef<HTMLCanvasElement>(null);
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    const cv = ref.current;
    if (!cv || s.fallback) return;
    const gl = cv.getContext('webgl', { preserveDrawingBuffer: true });
    if (!gl) {
      setFailed(true);
      return;
    }
    const prog = buildProgram(gl, s.glsl);
    if (!prog) {
      setFailed(true);
      return;
    }
    gl.useProgram(prog);
    const buf = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, buf);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1]), gl.STATIC_DRAW);
    const loc = gl.getAttribLocation(prog, 'a_pos');
    gl.enableVertexAttribArray(loc);
    gl.vertexAttribPointer(loc, 2, gl.FLOAT, false, 0, 0);
    gl.uniform2f(gl.getUniformLocation(prog, 'mkp_x'), g.x[0], g.x[1]);
    gl.uniform2f(gl.getUniformLocation(prog, 'mkp_y'), g.y[0], g.y[1]);
    gl.uniform2f(gl.getUniformLocation(prog, 'mkp_size'), cv.width, cv.height);
    const vec2s = new Map<string, number[]>();
    for (const [k, v] of Object.entries(s.uniforms)) {
      const m = /^(.*)\.([xy])$/.exec(k);
      if (m) {
        const cur = vec2s.get(m[1]) ?? [0, 0];
        cur[m[2] === 'x' ? 0 : 1] = v;
        vec2s.set(m[1], cur);
      } else gl.uniform1f(gl.getUniformLocation(prog, k), v);
    }
    for (const [k, v] of vec2s) gl.uniform2f(gl.getUniformLocation(prog, k), v[0], v[1]);
    gl.viewport(0, 0, cv.width, cv.height);
    gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
  }, [s.glsl, JSON.stringify(s.uniforms), g.W, g.H, s.fallback]);
  const res = Math.min(s.res, Math.round(g.W));
  if (s.fallback || failed) return s.fallback ? <img src={s.fallback} alt="" style={{ position: 'absolute', left: 0, top: 0, width: g.W, height: g.H, opacity: g.opacity, imageRendering: 'pixelated' }} /> : null;
  return <canvas ref={ref} width={res} height={Math.round((res * g.H) / g.W)} data-mkp-gfx="pixels" style={{ position: 'absolute', left: 0, top: 0, width: g.W, height: g.H, opacity: g.opacity, pointerEvents: 'none', zIndex: -1 }} />;
}

const VERTEX = 'attribute vec2 a_pos; void main() { gl_Position = vec4(a_pos, 0.0, 1.0); }';

function buildProgram(gl: WebGLRenderingContext, frag: string): WebGLProgram | null {
  const sh = (type: number, src: string): WebGLShader | null => {
    const s = gl.createShader(type)!;
    gl.shaderSource(s, src);
    gl.compileShader(s);
    if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) {
      console.warn('mkp pixels shader:', gl.getShaderInfoLog(s));
      return null;
    }
    return s;
  };
  const v = sh(gl.VERTEX_SHADER, VERTEX);
  const f = sh(gl.FRAGMENT_SHADER, frag);
  if (!v || !f) return null;
  const p = gl.createProgram()!;
  gl.attachShader(p, v);
  gl.attachShader(p, f);
  gl.linkProgram(p);
  return gl.getProgramParameter(p, gl.LINK_STATUS) ? p : null;
}

/** dims=3: a mesh z = f(x, y) seen through a camera the reader can turn (drag or arrow keys). */
function Canvas3D({ n, W, H, box }: { n: VNode; W: number; H: number; box: { current: HTMLDivElement | null } }): ReactNode {
  const p = n.p;
  const view = (p.view as number[]) ?? [35, 25];
  const [cam, setCam] = useState<[number, number]>([view[0], view[1]]);
  // a view the widget changes (a turn slider) moves the camera too (GAPS 114)
  useEffect(() => setCam([view[0], view[1]]), [view[0], view[1]]);
  const drag = useRef<[number, number] | null>(null);
  const xr = (p.x as number[]) ?? [-1, 1];
  const yr = (p.y as number[]) ?? [-1, 1];
  const zr = (p.z as number[]) ?? [-1, 1];
  const az = (cam[0] * Math.PI) / 180;
  const el = (cam[1] * Math.PI) / 180;
  const norm = (v: number, r: number[]): number => ((v - r[0]) / (r[1] - r[0]) - 0.5) * 2;
  const project = (x: number, y: number, z: number): [number, number, number] => {
    const X = norm(x, xr);
    const Y = norm(y, yr);
    const Z = norm(z, zr) * 0.8;
    const x1 = X * Math.cos(az) - Y * Math.sin(az);
    const y1 = X * Math.sin(az) + Y * Math.cos(az);
    const sy = Z * Math.cos(el) - y1 * Math.sin(el);
    const depth = y1 * Math.cos(el) + Z * Math.sin(el);
    const s = Math.min(W, H) * 0.33;
    return [W / 2 + x1 * s, H / 2 - sy * s, depth];
  };
  const polys: { d: string; depth: number; shade: number; fill: string; key: string }[] = [];
  for (const l of n.layers ?? []) {
    for (const s of l.shapes) {
      if (s.t !== 'mesh') continue;
      const N = s.n;
      for (let j = 0; j < N; j++) {
        for (let i = 0; i < N; i++) {
          const pt = (ii: number, jj: number): [number, number, number] => project(xr[0] + ((xr[1] - xr[0]) * ii) / N, yr[0] + ((yr[1] - yr[0]) * jj) / N, s.z[jj][ii]);
          const q = [pt(i, j), pt(i + 1, j), pt(i + 1, j + 1), pt(i, j + 1)];
          const zAvg = (s.z[j][i] + s.z[j][i + 1] + s.z[j + 1][i + 1] + s.z[j + 1][i]) / 4;
          polys.push({ key: `${s.key}/${i}/${j}`, d: q.map((v, k) => `${k ? 'L' : 'M'}${v[0].toFixed(1)},${v[1].toFixed(1)}`).join(' ') + 'Z', depth: q.reduce((a, v) => a + v[2], 0) / 4, shade: Math.min(1, Math.max(0, (zAvg - zr[0]) / (zr[1] - zr[0]))), fill: s.fill });
        }
      }
    }
  }
  polys.sort((a, b) => a.depth - b.depth);
  return (
    <div
      ref={(e) => {
        box.current = e;
      }}
      data-mkp-key={n.key}
      className="mkp-canvas"
      style={{ width: W, height: H }}
      role="img"
      tabIndex={0}
      aria-label={`${String(p.label || '3D surface')}; arrow keys turn the view`}
      onPointerDown={(e) => {
        drag.current = [e.clientX, e.clientY];
        e.currentTarget.setPointerCapture(e.pointerId);
      }}
      onPointerMove={(e) => {
        if (!drag.current) return;
        const [x0, y0] = drag.current;
        drag.current = [e.clientX, e.clientY];
        setCam(([a, b]) => [a + (e.clientX - x0) * 0.5, Math.max(-89, Math.min(89, b + (e.clientY - y0) * 0.5))]);
      }}
      onPointerUp={() => (drag.current = null)}
      onKeyDown={(e) => {
        const d: Record<string, [number, number]> = { ArrowLeft: [-5, 0], ArrowRight: [5, 0], ArrowUp: [0, 5], ArrowDown: [0, -5] };
        const m = d[e.key];
        if (m) {
          e.preventDefault();
          setCam(([a, b]) => [a + m[0], Math.max(-89, Math.min(89, b + m[1]))]);
        }
      }}
    >
      <svg width={W} height={H} data-mkp-gfx="mesh">
        {polys.map((q) => (
          <path key={q.key} d={q.d} fill={`color-mix(in srgb, ${color(q.fill)} ${Math.round(35 + 65 * q.shade)}%, var(--mkp-color-surface))`} stroke="var(--mkp-color-surface)" strokeWidth={0.4} />
        ))}
      </svg>
    </div>
  );
}
