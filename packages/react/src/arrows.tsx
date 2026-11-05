// A scope's arrows (spec 6.10), measured after layout and drawn in the nearest layer that holds both
// of their ends: the scope itself, a frame in full screen or with a scrolling stage, a pane's body,
// or a zoom's moving layer, in that layer's own scrolled and scaled coordinates (GAPS 92, 93, 126,
// 143). Behind arrows go under the content (100); labels are chips placed clear of the other lines
// (141); a curve bends at least so far (52).

import { Fragment, useEffect, useLayoutEffect, useMemo, useRef, useState, type CSSProperties, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { arrowPaths, type ArrowEnds, type ArrowPath, type Rect, type VArrow, type VRun } from '@mkp/core';
import { Runs } from './nodes';

type Pt = [number, number];
type End = NonNullable<VArrow['head']>;

/** A mark at an arrow's end other than its head: path data, and how it is filled. */
interface Mark {
  d: string;
  fill: 'solid' | 'none' | 'hollow';
  tone?: string;
}

/** One arrow as drawn: its shaft, head and other marks, label and look. */
export interface Drawn {
  key: string;
  d: string;
  head: string;
  marks: Mark[];
  label?: Pt;
  align?: 'start' | 'end';
  runs?: VRun[];
  tone?: string;
  line?: string;
  dim?: boolean;
  bold?: boolean;
  opacity?: number;
  behind?: boolean;
}

/** The arrows drawn in one layer, and the layer's size. */
interface Layer {
  host: HTMLElement;
  w: number;
  h: number;
  paths: Drawn[];
}

const DASH: Record<string, string | undefined> = { solid: undefined, dashed: '5 4', dotted: '2 3' };
const GAP = 3;
const HEAD = 7;
/** The least a curve bends, so a link back between adjacent rows is no tight bend beside the forward one (GAPS 52). */
export const MIN_BEND = 32;

const r1 = (n: number): string => n.toFixed(1);
const centre = (r: Rect): Pt => [r.x + r.w / 2, r.y + r.h / 2];
const unit = (p: Pt, q: Pt): Pt => {
  const l = Math.hypot(q[0] - p[0], q[1] - p[1]) || 1;
  return [(q[0] - p[0]) / l, (q[1] - p[1]) / l];
};

/** Where the ray from a rectangle's centre towards `t` leaves it, plus a gap (as the core's routing has it). */
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
export function curve(a: Rect, b: Rect, gap = GAP, headSize = HEAD): ArrowPath | null {
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

/** A circle as path data. */
const disc = (c: Pt, r: number): string => `M${r1(c[0] - r)},${r1(c[1])} a${r},${r} 0 1,0 ${2 * r},0 a${r},${r} 0 1,0 ${-2 * r},0`;

/**
 * The mark of one kind at P, the line arriving along u (a unit vector into the element). The core's
 * marks, plus a dot and a ring (an optional end, GAPS 140), which sit just off the element.
 */
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

/** Marks other than a head at `to`: the shaft runs on to the tip (a cross stops it short), and each mark sits where the line meets its element. */
function withEnds(p: ArrowPath, head: End, tail: End): { d: string; head: Pt[]; marks: Mark[] } {
  if (head === 'arrow' && tail === 'none') return { d: p.d, head: p.head, marks: [] };
  const tip = p.head[0];
  const back: Pt = [(p.head[1][0] + p.head[2][0]) / 2, (p.head[1][1] + p.head[2][1]) / 2];
  const n = numbers(p.d);
  const start: Pt = [n[0], n[1]];
  const next: Pt = [n[2], n[3]];
  const marks = [head === 'arrow' ? null : mark(head, tip, unit(back, tip)), mark(tail, start, unit(next, start))].filter((m): m is Mark => !!m);
  const d = head === 'arrow' || head === 'cross' ? p.d : `${p.d} L${r1(tip[0])},${r1(tip[1])}`;
  return { d, head: head === 'arrow' ? p.head : [], marks };
}

/** A path's points, its curves flattened. */
function polyline(d: string): Pt[] {
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

/** The point a fraction t of the way along a polyline. */
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

/** Whether the segment p–q runs through the box (Liang–Barsky). */
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

/** Where along its own line a label may sit, from the middle out. */
const SPOTS = [0.5, 0.4, 0.6, 0.3, 0.7, 0.22, 0.78];

/**
 * Each label at the first spot along its line where its chip crosses no other line and no label
 * already placed, or else where it crosses fewest (GAPS 141). A loop's label stays beside its loop.
 */
export function placeLabels(paths: Drawn[], lines: Pt[][], size: (p: Drawn) => [number, number]): void {
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

/** A label's size before it has been measured: by its text. */
function estimate(runs: VRun[] | undefined): [number, number] {
  const chars = (runs ?? []).reduce((n, r) => n + ('v' in r ? String(r.v).length : r.t === 'math' ? r.tex.length : 1), 0);
  return [chars * 6.5 + 14, 18];
}

function cssEscape(s: string): string {
  return typeof CSS !== 'undefined' && CSS.escape ? CSS.escape(s) : s.replace(/["\\]/g, '\\$&');
}

const hostIds = new WeakMap<HTMLElement, number>();
let nextHost = 0;
const hostId = (h: HTMLElement): number => {
  let id = hostIds.get(h);
  if (id === undefined) hostIds.set(h, (id = nextHost++));
  return id;
};

/**
 * Draws the arrows, measuring their ends after layout (run by Scope), whenever a size changes, and
 * whenever something inside scrolls or moves (a zoom's pan, a frame going full screen).
 */
export function Arrows({ arrows, box, measure }: { arrows: VArrow[]; box: { current: HTMLDivElement | null }; measure: { current: () => void } }): ReactNode {
  const [layers, setLayers] = useState<Layer[]>([]);
  const labels = useRef(new Map<string, HTMLElement>());
  const sizes = useRef(new Map<string, [number, number]>());
  const sig = useMemo(() => arrows.map((a) => `${a.key}|${a.from}|${a.to}|${(a.via ?? []).join(',')}`).join(';'), [arrows]);
  measure.current = () => {
    const root = box.current;
    if (!root) return;
    const t0 = performance.now();
    const find = (key: string): HTMLElement | null => {
      const el = root.querySelector<HTMLElement>(`[data-mkp-key="${cssEscape(key)}"]`);
      // not shown: hidden, or not laid out (a full-screen frame is fixed, so it has no offset parent)
      return !el || el.hidden || (!el.offsetParent && !el.hasAttribute('data-full')) ? null : el;
    };
    // the layers an element is in, from the nearest out to the scope
    const hostsOf = (el: HTMLElement): HTMLElement[] => {
      const out: HTMLElement[] = [];
      for (let h = el.parentElement?.closest<HTMLElement>('[data-mkp-arrow-host]'); h && h !== root && root.contains(h); h = h.parentElement?.closest<HTMLElement>('[data-mkp-arrow-host]')) out.push(h);
      out.push(root);
      return out;
    };
    // an end scrolled out of a pane between it and the layer the arrow is drawn in is not drawn to
    const inView = (el: HTMLElement, chain: HTMLElement[], host: HTMLElement): boolean => {
      const r = el.getBoundingClientRect();
      for (const h of chain) {
        if (h === host) return true;
        if (h.scrollHeight <= h.clientHeight && h.scrollWidth <= h.clientWidth) continue;
        const b = h.getBoundingClientRect();
        if (r.bottom <= b.top || r.top >= b.bottom || r.right <= b.left || r.left >= b.right) return false;
      }
      return true;
    };
    // a layer's own units: a scale on it or above it (a zoom, a fit) is taken out, and its scroll put in
    const frames = new Map<HTMLElement, (r: DOMRect) => Rect>();
    const relTo = (h: HTMLElement): ((r: DOMRect) => Rect) => {
      let f = frames.get(h);
      if (!f) {
        const base = h.getBoundingClientRect();
        const sx = h.offsetWidth ? base.width / h.offsetWidth : 1;
        const sy = h.offsetHeight ? base.height / h.offsetHeight : 1;
        const ox = h === root ? 0 : h.scrollLeft - h.clientLeft;
        const oy = h === root ? 0 : h.scrollTop - h.clientTop;
        f = (r) => ({ x: (r.left - base.left) / sx + ox, y: (r.top - base.top) / sy + oy, w: r.width / sx, h: r.height / sy });
        frames.set(h, f);
      }
      return f;
    };
    const groups = new Map<HTMLElement, { arrows: VArrow[]; ends: ArrowEnds[] }>();
    for (const a of arrows) {
      const ea = find(a.from);
      const eb = find(a.to);
      if (!ea || !eb) continue;
      const ca = hostsOf(ea);
      const cb = hostsOf(eb);
      const host = ca.find((h) => cb.includes(h)) ?? root;
      if (!inView(ea, ca, host) || !inView(eb, cb, host)) continue;
      const rel = relTo(host);
      // waypoints that are not shown (hidden, not laid out, or in another layer) are passed by
      const via = (a.via ?? [])
        .map(find)
        .filter((e): e is HTMLElement => !!e && host.contains(e))
        .map((e) => rel(e.getBoundingClientRect()));
      const g = groups.get(host) ?? { arrows: [], ends: [] };
      g.arrows.push(a);
      // the ends are the renderer's own (dot and ring among them), so the core draws only the shaft and head
      g.ends.push({ from: a.from, to: a.to, a: rel(ea.getBoundingClientRect()), b: rel(eb.getBoundingClientRect()), via, curve: a.curve, route: a.route, head: 'arrow', tail: 'none' });
      groups.set(host, g);
    }
    const out: Layer[] = [];
    for (const [host, g] of groups) {
      const w = host === root ? root.offsetWidth : Math.max(host.scrollWidth, host.clientWidth);
      const h = host === root ? root.offsetHeight : Math.max(host.scrollHeight, host.clientHeight);
      const raw = arrowPaths(g.ends, GAP, HEAD, w || Infinity);
      const paths: Drawn[] = [];
      const lines: Pt[][] = [];
      g.arrows.forEach((a, i) => {
        const e = g.ends[i];
        const p = e.curve && !e.via?.length && !e.route && e.from !== e.to ? curve(e.a, e.b) : raw[i];
        if (!p) return;
        const end = withEnds(p, a.head ?? 'arrow', a.tail ?? 'none');
        paths.push({
          key: a.key,
          d: end.d,
          head: end.head.map((q) => q.join(',')).join(' '),
          marks: end.marks,
          label: a.label ? p.label : undefined,
          align: p.align,
          runs: a.label,
          tone: a.tone,
          line: a.line,
          dim: a.dim,
          bold: a.bold,
          opacity: a.opacity,
          behind: a.layer === 'behind',
        });
        lines.push(polyline(end.d));
      });
      placeLabels(paths, lines, (p) => sizes.current.get(p.key) ?? estimate(p.runs));
      out.push({ host, w, h, paths });
    }
    setLayers((prev) => (prev.length === out.length && prev.every((l, i) => l.host === out[i].host && l.w === out[i].w && l.h === out[i].h && JSON.stringify(l.paths) === JSON.stringify(out[i].paths)) ? prev : out));
    // measuring cost, for performance probes (spike 2): passes, total and worst time, arrows drawn
    const stats = ((globalThis as { __mkpArrowStats?: { passes: number; total: number; max: number; arrows: number } }).__mkpArrowStats ??= { passes: 0, total: 0, max: 0, arrows: 0 });
    const dt = performance.now() - t0;
    stats.passes++;
    stats.total += dt;
    stats.max = Math.max(stats.max, dt);
    stats.arrows = Math.max(stats.arrows, out.reduce((n, l) => n + l.paths.length, 0));
  };
  useEffect(() => {
    const root = box.current;
    if (!root) return;
    let raf = 0;
    const soon = (): void => {
      if (!raf) raf = requestAnimationFrame(() => ((raf = 0), measure.current()));
    };
    // scroll doesn't bubble, but it is caught on the way down (GAPS 93, 143)
    root.addEventListener('scroll', soon, true);
    // something inside moved after its commit (a zoom's pan, a frame going full screen): measure now
    const now = (): void => measure.current();
    root.addEventListener('mkp-layout', now);
    let ro: ResizeObserver | undefined;
    if (typeof ResizeObserver !== 'undefined') {
      ro = new ResizeObserver(() => measure.current());
      ro.observe(root);
      for (const el of root.querySelectorAll('[data-mkp-key], [data-mkp-arrow-host]')) ro.observe(el);
    }
    return () => {
      root.removeEventListener('scroll', soon, true);
      root.removeEventListener('mkp-layout', now);
      if (raf) cancelAnimationFrame(raf);
      ro?.disconnect();
    };
  }, [sig, box, measure]);
  // a label's real size, once drawn: if one changed, they are placed again
  useLayoutEffect(() => {
    let changed = false;
    for (const [k, el] of labels.current) {
      const w = el.offsetWidth;
      const h = el.offsetHeight;
      if (!w || !h) continue;
      const s = sizes.current.get(k);
      if (!s || Math.abs(s[0] - w) > 0.5 || Math.abs(s[1] - h) > 0.5) {
        sizes.current.set(k, [w, h]);
        changed = true;
      }
    }
    if (changed) measure.current();
  });
  const register = (key: string, el: HTMLElement | null): void => {
    if (el) labels.current.set(key, el);
    else labels.current.delete(key);
  };
  return layers.map((l) => {
    const drawn = (
      <>
        <LayerView layer={l} behind register={register} />
        <LayerView layer={l} behind={false} register={register} />
      </>
    );
    return l.host === box.current ? <Fragment key={hostId(l.host)}>{drawn}</Fragment> : createPortal(drawn, l.host, String(hostId(l.host)));
  });
}

function LayerView({ layer, behind, register }: { layer: Layer; behind: boolean; register: (key: string, el: HTMLElement | null) => void }): ReactNode {
  const paths = layer.paths.filter((p) => !!p.behind === behind);
  if (!paths.length) return null;
  // a provider may give lines their own colour: --mkp-arrow-<tone>, else the tone's
  const ink = (p: Drawn): string => `var(--mkp-arrow-${p.tone ?? 'muted'}, var(--mkp-color-${p.tone ?? 'muted'}))`;
  const fade = (p: Drawn): CSSProperties | undefined => (p.dim || p.opacity !== undefined ? { opacity: (p.dim ? 0.3 : 1) * (p.opacity ?? 1) } : undefined);
  const labelled = paths.filter((p) => p.label && p.runs);
  return (
    <>
      <svg className="mkp-arrows" data-layer={behind ? 'behind' : undefined} aria-hidden="true" width={layer.w} height={layer.h}>
        {paths.map((p) => {
          const width = p.bold ? 2 : 1.5;
          return (
            <g key={p.key} data-mkp-arrow={p.key} data-dim={p.dim ? '' : undefined} data-bold={p.bold ? '' : undefined} style={fade(p)}>
              <path d={p.d} fill="none" stroke={ink(p)} strokeWidth={width} strokeDasharray={DASH[p.line ?? 'solid']} />
              {p.head ? <polygon points={p.head} fill={ink(p)} /> : null}
              {p.marks.map((m, i) => (
                <path key={i} d={m.d} stroke={m.tone ? `var(--mkp-color-${m.tone})` : ink(p)} strokeWidth={m.tone ? 2 : width} fill={m.fill === 'solid' ? ink(p) : m.fill === 'hollow' ? 'var(--mkp-color-surface)' : 'none'} strokeLinejoin="round" strokeLinecap="round" />
              ))}
            </g>
          );
        })}
      </svg>
      {labelled.length ? (
        <div className="mkp-arrow-labels" data-layer={behind ? 'behind' : undefined} aria-hidden="true">
          {labelled.map((p) => (
            <div key={p.key} ref={(el) => register(p.key, el)} className="mkp-arrow-label" data-mkp-arrow-label={p.key} data-align={p.align} style={{ left: p.label![0], top: p.label![1], color: p.tone ? ink(p) : 'var(--mkp-color-muted)', ...fade(p) }}>
              <Runs runs={p.runs!} />
            </div>
          ))}
        </div>
      ) : null}
    </>
  );
}
