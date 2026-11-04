// The 2D canvas (spec 8): a coordinate space with layers drawn in order, shapes in data units,
// labels and placed elements as HTML over the SVG, handles with arrow-key alternatives (WCAG
// 2.5.7), and with gfx@1: pixels through WebGL and a 3D mesh with a camera.

import { useEffect, useRef, useState, type ReactNode } from 'react';
import type { VNode, VShape, VRun } from '@mkp/core';
import { color, radius as radiusTok } from './style';
import { Kids, Runs, useCtx } from './nodes';

const SIZES: Record<string, number> = { s: 160, m: 320, l: 480 };

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

export function Canvas({ n, cls, reg }: { n: VNode; cls?: string; reg?: (el: HTMLElement | null) => void }): ReactNode {
  const p = n.p;
  const box = useRef<HTMLDivElement | null>(null);
  const sizeTok = String(p.size ?? 'm');
  const cssMax = sizeTok === 'fill' ? 4000 : SIZES[sizeTok] ?? 320;
  const W = useWidth(box, cssMax);
  const x = (p.x as number[]) ?? [-1, 1];
  const y = (p.y as number[]) ?? [-1, 1];
  const aspect = Number(p.aspect) > 0 ? Number(p.aspect) : (x[1] - x[0]) / (y[1] - y[0]) || 1;
  const H = Math.round(W / aspect);
  if (Number(p.dims) === 3) return <Canvas3D n={n} cls={cls} reg={reg} W={W} H={H} box={box} />;
  const X = (v: number): number => ((v - x[0]) / (x[1] - x[0])) * W;
  const Y = (v: number): number => H - ((v - y[0]) / (y[1] - y[0])) * H;
  const unit = W / (x[1] - x[0]);
  const html: ReactNode[] = [];
  const layers = (n.layers ?? []).map((l) => (
    <g key={l.key} opacity={l.opacity} data-mkp-key={l.key}>
      {l.shapes.map((s) => shape(s, { X, Y, unit, W, H, x, y, html, opacity: l.opacity }))}
    </g>
  ));
  return (
    <div
      ref={(el) => {
        box.current = el;
        reg?.(el);
      }}
      data-mkp-key={n.key}
      data-mkp-id={n.id}
      hidden={n.hidden || undefined}
      className={['mkp-canvas', cls].filter(Boolean).join(' ')}
      style={{ width: W, height: H }}
      role="img"
      aria-label={String(p.label || 'figure')}
    >
      <svg width={W} height={H} viewBox={`0 0 ${W} ${H}`}>
        {layers}
      </svg>
      {html}
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
  opacity: number;
}

const stroke = (c: string): string => (c && c !== 'none' ? color(c)! : 'none');

function shape(s: VShape, g: Geo): ReactNode {
  const { X, Y, unit } = g;
  switch (s.t) {
    case 'rect': {
      const x0 = Math.min(X(s.a[0]), X(s.b[0]));
      const y0 = Math.min(Y(s.a[1]), Y(s.b[1]));
      return <rect key={s.key} x={x0} y={y0} width={Math.abs(X(s.b[0]) - X(s.a[0]))} height={Math.abs(Y(s.b[1]) - Y(s.a[1]))} rx={s.radius && s.radius !== 'none' ? radiusTok(s.radius) : undefined} fill={stroke(s.fill)} stroke={stroke(s.stroke)} />;
    }
    case 'line':
      return (
        <g key={s.key}>
          <line x1={X(s.a[0])} y1={Y(s.a[1])} x2={X(s.b[0])} y2={Y(s.b[1])} stroke={stroke(s.stroke)} strokeWidth={s.width} strokeDasharray={s.dash ? '5 4' : undefined} />
          {s.arrow ? <ArrowHead a={[X(s.a[0]), Y(s.a[1])]} b={[X(s.b[0]), Y(s.b[1])]} fill={stroke(s.stroke)} /> : null}
        </g>
      );
    case 'circle':
      return <circle key={s.key} cx={X(s.c[0])} cy={Y(s.c[1])} r={Math.max(0.5, s.r * unit)} fill={stroke(s.fill)} stroke={stroke(s.stroke)} strokeWidth={s.width} />;
    case 'path': {
      if (!s.pts.length) return null;
      const d = s.pts.map((q, i) => `${i ? 'L' : 'M'}${X(q[0]).toFixed(2)},${Y(q[1]).toFixed(2)}`).join(' ') + (s.closed ? ' Z' : '');
      return <path key={s.key} d={d} fill={stroke(s.fill)} stroke={stroke(s.stroke)} strokeWidth={s.width} strokeDasharray={s.dash ? '5 4' : undefined} strokeLinejoin="round" />;
    }
    case 'label': {
      const off = anchorOffset(s.anchor);
      g.html.push(
        <div key={s.key} className="mkp-overlay-label" style={{ left: X(s.at[0]), top: Y(s.at[1]), color: color(s.tone), opacity: g.opacity, transform: `translate(${off[0]}, ${off[1]})` }}>
          <Runs runs={s.runs as VRun[]} />
        </div>,
      );
      return null;
    }
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

function anchorOffset(a: string): [string, string] {
  const h = a.includes('e') ? '0%' : a.includes('w') ? '-100%' : '-50%';
  const v = a.includes('n') ? '-100%' : a.includes('s') ? '0%' : '-50%';
  return [h, v];
}

function ArrowHead({ a, b, fill }: { a: number[]; b: number[]; fill: string }): ReactNode {
  const ang = Math.atan2(b[1] - a[1], b[0] - a[0]);
  const s = 8;
  const p1 = [b[0] - s * Math.cos(ang - 0.4), b[1] - s * Math.sin(ang - 0.4)];
  const p2 = [b[0] - s * Math.cos(ang + 0.4), b[1] - s * Math.sin(ang + 0.4)];
  return <polygon points={`${b[0]},${b[1]} ${p1.join(',')} ${p2.join(',')}`} fill={fill} />;
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
function Canvas3D({ n, cls, reg, W, H, box }: { n: VNode; cls?: string; reg?: (el: HTMLElement | null) => void; W: number; H: number; box: { current: HTMLDivElement | null } }): ReactNode {
  const p = n.p;
  const view = (p.view as number[]) ?? [35, 25];
  const [cam, setCam] = useState<[number, number]>([view[0], view[1]]);
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
        reg?.(e);
      }}
      data-mkp-key={n.key}
      className={['mkp-canvas', cls].filter(Boolean).join(' ')}
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
