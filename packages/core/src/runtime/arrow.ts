// Arrow geometry (spec 6.10): from one measured element's outline to another's. Arrows only read
// sizes, so one pass settles; renderers measure, then call this.

export interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface ArrowPath {
  /** SVG path data for the shaft */
  d: string;
  /** the arrowhead triangle's points */
  head: [number, number][];
  /** where a label sits (the middle of the shaft) */
  label: [number, number];
}

/** Where the ray from a rectangle's centre towards (tx, ty) leaves the rectangle, plus a gap. */
function exit(r: Rect, tx: number, ty: number, gap: number): [number, number] {
  const cx = r.x + r.w / 2;
  const cy = r.y + r.h / 2;
  const dx = tx - cx;
  const dy = ty - cy;
  if (dx === 0 && dy === 0) return [cx, cy];
  const sx = dx === 0 ? Infinity : r.w / 2 / Math.abs(dx);
  const sy = dy === 0 ? Infinity : r.h / 2 / Math.abs(dy);
  const s = Math.min(sx, sy);
  const len = Math.hypot(dx, dy);
  return [cx + dx * s + (dx / len) * gap, cy + dy * s + (dy / len) * gap];
}

type Pt = [number, number];

const centre = (r: Rect): Pt => [r.x + r.w / 2, r.y + r.h / 2];
const dist = (p: Pt, q: Pt): number => Math.hypot(q[0] - p[0], q[1] - p[1]);

/**
 * Where the path runs through one via element: along its longer centre line (top to bottom through
 * a tall one, side to side through a wide one), whichever way round is shorter from `prev` on to
 * `next`; through the centre of a square or empty one.
 */
function lane(r: Rect, prev: Pt, next: Pt): Pt[] {
  const [cx, cy] = centre(r);
  if (Math.abs(r.h - r.w) < 1) return [[cx, cy]];
  const ends: [Pt, Pt] = r.h > r.w ? [[cx, r.y], [cx, r.y + r.h]] : [[r.x, cy], [r.x + r.w, cy]];
  return dist(prev, ends[0]) + dist(ends[1], next) <= dist(prev, ends[1]) + dist(ends[0], next) ? ends : [ends[1], ends[0]];
}

/** Corners rounded off where the path turns (radius 12, less on short segments). */
const CORNER = 12;

/** An arrow through waypoints: straight runs between them, rounded where it turns. */
function routed(a: Rect, b: Rect, via: Rect[], gap: number, headSize: number): ArrowPath | null {
  const mid: Pt[] = [];
  let prev = centre(a);
  via.forEach((r, i) => {
    const run = lane(r, prev, centre(i + 1 < via.length ? via[i + 1] : b));
    mid.push(...run);
    prev = run[run.length - 1];
  });
  const p0 = exit(a, mid[0][0], mid[0][1], gap);
  const last = mid[mid.length - 1];
  const p1 = exit(b, last[0], last[1], gap);
  const pts: Pt[] = [];
  for (const p of [p0, ...mid, p1]) if (!pts.length || dist(pts[pts.length - 1], p) >= 0.5) pts.push(p);
  if (pts.length < 2) return null;
  const from = pts[pts.length - 2];
  const ang = Math.atan2(p1[1] - from[1], p1[0] - from[0]);
  const back: Pt = [p1[0] - headSize * Math.cos(ang), p1[1] - headSize * Math.sin(ang)];
  const head: Pt[] = [
    [p1[0], p1[1]],
    [back[0] - (headSize / 2) * Math.sin(ang), back[1] + (headSize / 2) * Math.cos(ang)],
    [back[0] + (headSize / 2) * Math.sin(ang), back[1] - (headSize / 2) * Math.cos(ang)],
  ];
  const f = (n: number): string => n.toFixed(1);
  const shaft: Pt[] = [...pts.slice(0, -1), back];
  let d = `M${f(shaft[0][0])},${f(shaft[0][1])}`;
  for (let i = 1; i < shaft.length - 1; i++) {
    const [pa, pb, pc] = [shaft[i - 1], shaft[i], shaft[i + 1]];
    const l1 = dist(pa, pb);
    const l2 = dist(pb, pc);
    const r = Math.min(CORNER, l1 / 2, l2 / 2);
    const u: Pt = [pb[0] - ((pb[0] - pa[0]) / l1) * r, pb[1] - ((pb[1] - pa[1]) / l1) * r];
    const w: Pt = [pb[0] + ((pc[0] - pb[0]) / l2) * r, pb[1] + ((pc[1] - pb[1]) / l2) * r];
    d += ` L${f(u[0])},${f(u[1])} Q${f(pb[0])},${f(pb[1])} ${f(w[0])},${f(w[1])}`;
  }
  const end = shaft[shaft.length - 1];
  d += ` L${f(end[0])},${f(end[1])}`;
  // the label: halfway along the path
  const lens = pts.slice(1).map((p, i) => dist(pts[i], p));
  let left = lens.reduce((s, l) => s + l, 0) / 2;
  let label: Pt = pts[0];
  for (let i = 0; i < lens.length; i++) {
    if (left <= lens[i] || i === lens.length - 1) {
      const t = lens[i] > 0 ? Math.min(1, left / lens[i]) : 0;
      label = [pts[i][0] + (pts[i + 1][0] - pts[i][0]) * t, pts[i][1] + (pts[i + 1][1] - pts[i][1]) * t];
      break;
    }
    left -= lens[i];
  }
  return { d, head, label };
}

/**
 * The path from one element's outline to another's. With `via` (the waypoints' rects, in order) it
 * runs through each of them (see `lane`) with rounded corners, and `curve` does not apply.
 */
export function arrowPath(a: Rect, b: Rect, curve = false, gap = 3, headSize = 7, via: Rect[] = []): ArrowPath | null {
  if (via.length) return routed(a, b, via, gap, headSize);
  const ac: [number, number] = [a.x + a.w / 2, a.y + a.h / 2];
  const bc: [number, number] = [b.x + b.w / 2, b.y + b.h / 2];
  if (Math.hypot(bc[0] - ac[0], bc[1] - ac[1]) < 1) return null;
  let ctrl: [number, number] | null = null;
  if (curve) {
    const mx = (ac[0] + bc[0]) / 2;
    const my = (ac[1] + bc[1]) / 2;
    const dx = bc[0] - ac[0];
    const dy = bc[1] - ac[1];
    ctrl = [mx - dy * 0.25, my + dx * 0.25];
  }
  const p0 = exit(a, ctrl ? ctrl[0] : bc[0], ctrl ? ctrl[1] : bc[1], gap);
  const p1 = exit(b, ctrl ? ctrl[0] : ac[0], ctrl ? ctrl[1] : ac[1], gap);
  // direction at the end
  const from = ctrl ?? p0;
  const ang = Math.atan2(p1[1] - from[1], p1[0] - from[0]);
  const back: [number, number] = [p1[0] - headSize * Math.cos(ang), p1[1] - headSize * Math.sin(ang)];
  const head: [number, number][] = [
    [p1[0], p1[1]],
    [back[0] - (headSize / 2) * Math.sin(ang), back[1] + (headSize / 2) * Math.cos(ang)],
    [back[0] + (headSize / 2) * Math.sin(ang), back[1] - (headSize / 2) * Math.cos(ang)],
  ];
  const f = (n: number): string => n.toFixed(1);
  const d = ctrl ? `M${f(p0[0])},${f(p0[1])} Q${f(ctrl[0])},${f(ctrl[1])} ${f(back[0])},${f(back[1])}` : `M${f(p0[0])},${f(p0[1])} L${f(back[0])},${f(back[1])}`;
  const label: [number, number] = ctrl ? [(p0[0] + 2 * ctrl[0] + p1[0]) / 4, (p0[1] + 2 * ctrl[1] + p1[1]) / 4] : [(p0[0] + p1[0]) / 2, (p0[1] + p1[1]) / 2];
  return { d, head, label };
}
