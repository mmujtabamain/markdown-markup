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

export function arrowPath(a: Rect, b: Rect, curve = false, gap = 3, headSize = 7): ArrowPath | null {
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
