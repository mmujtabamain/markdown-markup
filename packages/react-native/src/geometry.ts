// Geometry the renderers share and the core doesn't have yet: a curve's least bend (GAPS 52), the
// marks at an arrow's ends with dot and ring (140), arrow labels placed clear of other lines (141),
// and canvas labels kept inside and clear of each other (107). The same as @mkp/react's; both copies
// go once the core's arrow.ts has them.

import type { ArrowPath, Rect, VArrow, VRun } from '@mkp/core';

export type Pt = [number, number];
export type End = NonNullable<VArrow['head']>;

export interface Mark {
  d: string;
  fill: 'solid' | 'none' | 'hollow';
  tone?: string;
}

/** The least a curve bends, so a link back between adjacent rows is no tight bend beside the forward one. */
export const MIN_BEND = 32;

const r1 = (n: number): string => n.toFixed(1);
const centre = (r: Rect): Pt => [r.x + r.w / 2, r.y + r.h / 2];
const unit = (p: Pt, q: Pt): Pt => {
  const l = Math.hypot(q[0] - p[0], q[1] - p[1]) || 1;
  return [(q[0] - p[0]) / l, (q[1] - p[1]) / l];
};

function exit(r: Rect, t: Pt, gap: number): Pt {
  const [cx, cy] = centre(r);
  const dx = t[0] - cx;
  const dy = t[1] - cy;
  if (dx === 0 && dy === 0) return [cx, cy];
  const s = Math.min(dx === 0 ? Infinity : r.w / 2 / Math.abs(dx), dy === 0 ? Infinity : r.h / 2 / Math.abs(dy));
  const len = Math.hypot(dx, dy);
  return [cx + dx * s + (dx / len) * gap, cy + dy * s + (dy / len) * gap];
}

/** A curved arrow: bent by a quarter of its length, and never by less than MIN_BEND. */
export function curve(a: Rect, b: Rect, gap = 3, headSize = 7): ArrowPath | null {
  const ac = centre(a);
  const bc = centre(b);
  const dx = bc[0] - ac[0];
  const dy = bc[1] - ac[1];
  const len = Math.hypot(dx, dy);
  if (len < 1) return null;
  const k = Math.max(0.25, MIN_BEND / len);
  const ctrl: Pt = [(ac[0] + bc[0]) / 2 - dy * k, (ac[1] + bc[1]) / 2 + dx * k];
  const p0 = exit(a, ctrl, gap);
  const p1 = exit(b, ctrl, gap);
  const ang = Math.atan2(p1[1] - ctrl[1], p1[0] - ctrl[0]);
  const back: Pt = [p1[0] - headSize * Math.cos(ang), p1[1] - headSize * Math.sin(ang)];
  const half = headSize / 2;
  return {
    d: `M${r1(p0[0])},${r1(p0[1])} Q${r1(ctrl[0])},${r1(ctrl[1])} ${r1(back[0])},${r1(back[1])}`,
    head: [p1, [back[0] - half * Math.sin(ang), back[1] + half * Math.cos(ang)], [back[0] + half * Math.sin(ang), back[1] - half * Math.cos(ang)]],
    label: [(p0[0] + 2 * ctrl[0] + p1[0]) / 4, (p0[1] + 2 * ctrl[1] + p1[1]) / 4],
  };
}

const disc = (c: Pt, r: number): string => `M${r1(c[0] - r)},${r1(c[1])} a${r},${r} 0 1,0 ${2 * r},0 a${r},${r} 0 1,0 ${-2 * r},0`;

function mark(kind: End, P: Pt, u: Pt): Mark | null {
  const v: Pt = [-u[1], u[0]];
  const at = (along: number, across: number): string => `${r1(P[0] - u[0] * along + v[0] * across)},${r1(P[1] - u[1] * along + v[1] * across)}`;
  const back = (by: number): Pt => [P[0] - u[0] * by, P[1] - u[1] * by];
  switch (kind) {
    case 'arrow':
      return { d: `M${at(0, 0)} L${at(7, 3.5)} L${at(7, -3.5)} Z`, fill: 'solid' };
    case 'hollow':
      return { d: `M${at(0, 0)} L${at(12, 6.5)} L${at(12, -6.5)} Z`, fill: 'hollow' };
    case 'one':
      return { d: `M${at(5, 5)} L${at(5, -5)}`, fill: 'none' };
    case 'many':
      return { d: `M${at(11, 0)} L${at(0, 5)} M${at(11, 0)} L${at(0, 0)} M${at(11, 0)} L${at(0, -5)}`, fill: 'none' };
    case 'cross':
      return { d: `M${at(2.5, 4.5)} L${at(11.5, -4.5)} M${at(2.5, -4.5)} L${at(11.5, 4.5)}`, fill: 'none', tone: 'bad' };
    case 'dot':
      return { d: disc(back(3.5), 3.5), fill: 'solid' };
    case 'ring':
      return { d: disc(back(4.5), 4.5), fill: 'hollow' };
    default:
      return null;
  }
}

const numbers = (d: string): number[] => [...d.matchAll(/-?\d+(?:\.\d+)?/g)].map((m) => Number(m[0]));

/** The marks at an arrow's ends other than a head at `to`; the shaft runs on to the tip for them (a cross stops it short). */
export function withEnds(p: ArrowPath, head: End, tail: End): { d: string; head: Pt[]; marks: Mark[] } {
  if (head === 'arrow' && tail === 'none') return { d: p.d, head: p.head, marks: [] };
  const tip = p.head[0];
  const back: Pt = [(p.head[1][0] + p.head[2][0]) / 2, (p.head[1][1] + p.head[2][1]) / 2];
  const n = numbers(p.d);
  const marks = [head === 'arrow' ? null : mark(head, tip, unit(back, tip)), mark(tail, [n[0], n[1]], unit([n[2], n[3]], [n[0], n[1]]))].filter((m): m is Mark => !!m);
  const d = head === 'arrow' || head === 'cross' ? p.d : `${p.d} L${r1(tip[0])},${r1(tip[1])}`;
  return { d, head: head === 'arrow' ? p.head : [], marks };
}

/** A path's points, its curves flattened. */
export function polyline(d: string): Pt[] {
  const out: Pt[] = [];
  for (const m of d.matchAll(/([MLQ])([^MLQ]+)/g)) {
    const n = numbers(m[2]);
    if (m[1] === 'Q' && out.length) {
      const p0 = out[out.length - 1];
      for (let i = 1; i <= 8; i++) {
        const t = i / 8;
        const s = 1 - t;
        out.push([s * s * p0[0] + 2 * s * t * n[0] + t * t * n[2], s * s * p0[1] + 2 * s * t * n[1] + t * t * n[3]]);
      }
    } else for (let i = 0; i + 1 < n.length; i += 2) out.push([n[i], n[i + 1]]);
  }
  return out;
}

function along(pts: Pt[], t: number): Pt {
  const lens = pts.slice(1).map((p, i) => Math.hypot(p[0] - pts[i][0], p[1] - pts[i][1]));
  let left = lens.reduce((s, l) => s + l, 0) * t;
  for (let i = 0; i < lens.length; i++) {
    if (left <= lens[i] || i === lens.length - 1) {
      const k = lens[i] > 0 ? Math.min(1, left / lens[i]) : 0;
      return [pts[i][0] + (pts[i + 1][0] - pts[i][0]) * k, pts[i][1] + (pts[i + 1][1] - pts[i][1]) * k];
    }
    left -= lens[i];
  }
  return pts[0] ?? [0, 0];
}

interface Box {
  x0: number;
  y0: number;
  x1: number;
  y1: number;
}

const boxAt = (c: Pt, [w, h]: [number, number], align?: 'start' | 'end'): Box => {
  const x0 = align === 'start' ? c[0] : align === 'end' ? c[0] - w : c[0] - w / 2;
  return { x0, y0: c[1] - h / 2, x1: x0 + w, y1: c[1] + h / 2 };
};
const overlap = (a: Box, b: Box): boolean => a.x0 < b.x1 && b.x0 < a.x1 && a.y0 < b.y1 && b.y0 < a.y1;

function crosses(p: Pt, q: Pt, b: Box): boolean {
  let t0 = 0;
  let t1 = 1;
  const dx = q[0] - p[0];
  const dy = q[1] - p[1];
  for (const [pp, qq] of [[-dx, p[0] - b.x0], [dx, b.x1 - p[0]], [-dy, p[1] - b.y0], [dy, b.y1 - p[1]]]) {
    if (pp === 0) {
      if (qq < 0) return false;
      continue;
    }
    const r = qq / pp;
    if (pp < 0) {
      if (r > t1) return false;
      t0 = Math.max(t0, r);
    } else {
      if (r < t0) return false;
      t1 = Math.min(t1, r);
    }
  }
  return true;
}

const SPOTS = [0.5, 0.4, 0.6, 0.3, 0.7, 0.22, 0.78];

/** Each label at the first spot along its line where it crosses no other line and no label before it, or where it crosses fewest. */
export function placeLabels<T extends { label?: Pt; align?: 'start' | 'end' }>(paths: T[], lines: Pt[][], size: (p: T) => [number, number]): void {
  const taken: Box[] = [];
  paths.forEach((p, i) => {
    if (!p.label) return;
    if (p.align) {
      taken.push(boxAt(p.label, size(p), p.align));
      return;
    }
    let best = p.label;
    let score = Infinity;
    for (const t of SPOTS) {
      const c = along(lines[i], t);
      const b = boxAt(c, size(p));
      let s = 0;
      lines.forEach((l, j) => {
        if (j === i) return;
        for (let k = 0; k + 1 < l.length; k++)
          if (crosses(l[k], l[k + 1], b)) {
            s++;
            break;
          }
      });
      for (const o of taken) if (overlap(o, b)) s += 2;
      if (s < score) {
        score = s;
        best = c;
        if (!s) break;
      }
    }
    p.label = best;
    taken.push(boxAt(best, size(p)));
  });
}

/** A label's size before it has been measured: by its text, at a font size. */
export function estimate(runs: VRun[] | undefined, fontSize = 13): [number, number] {
  const chars = (runs ?? []).reduce((n, r) => n + ('v' in r ? String(r.v).length : r.t === 'math' ? r.tex.length : 1), 0);
  return [chars * fontSize * 0.5 + 14, fontSize * 1.4];
}

/** Where on a label its point is: a fraction across and down it. */
export function anchorAt(a: string): [number, number] {
  if (a === 'center') return [0.5, 0.5];
  return [a.includes('e') ? 0 : a.includes('w') ? 1 : 0.5, a.includes('n') ? 1 : a.includes('s') ? 0 : 0.5];
}

export type Spot = [number, number, number, number];
const clash = (a: Spot, b: Spot): number => Math.max(0, Math.min(a[0] + a[2], b[0] + b[2]) - Math.max(a[0], b[0])) * Math.max(0, Math.min(a[1] + a[3], b[1] + b[3]) - Math.max(a[1], b[1]));

/** Canvas labels, each kept inside the canvas and moved the least it can to clear those before it: [x, y, w, h]. */
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

/** A grid's column tracks as a list: what the widget wrote, or n equal shares. */
export function trackList(cols: unknown): string[] {
  if (typeof cols === 'number') return Array.from({ length: Math.max(1, Math.round(cols)) }, () => '1fr');
  return Array.isArray(cols) && cols.length ? cols.map(String) : ['1fr', '1fr'];
}

/** A width class from a width in pixels: narrow (a phone), medium or wide. */
export function widthClass(px: number): 'narrow' | 'medium' | 'wide' {
  return px < 600 ? 'narrow' : px < 1000 ? 'medium' : 'wide';
}

/** A formula's SVG with each \mark{id} group in its colour: currentColor inside it then follows. */
export function markSvg(svg: string, colours: Record<string, string>): string {
  let out = svg;
  for (const [id, c] of Object.entries(colours)) {
    const safe = id.replace(/[^\w-]/g, '');
    out = out.replace(new RegExp(`<(\\w+)((?:(?!>)[^])*?\\bclass="[^"]*\\bmkp-mark-${safe}\\b[^"]*")`, 'g'), (m, tag: string, rest: string) => (/\scolor="/.test(rest) ? m : `<${tag}${rest} color="${c}"`));
  }
  return out;
}
