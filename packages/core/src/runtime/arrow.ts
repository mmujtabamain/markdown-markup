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
  /** which side of `label` its text runs to, when it isn't centred there (a self-loop's) */
  align?: 'start' | 'end';
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
  return draw(pts, headSize);
}

/** The shaft through these points, rounded where it turns, with the head on the last run. */
function draw(pts: Pt[], headSize: number): ArrowPath | null {
  if (pts.length < 2) return null;
  const p1 = pts[pts.length - 1];
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

/** How far a self-loop stands off its element. */
const LOOP = 18;
/** How far apart the two ports on one side of an element sit. */
const PORT = 16;
/** The clear space between two runs that share a track. */
const TRACK_GAP = 8;
/** A smaller step than this between waypoints is taken out: the lanes have room for it, and a jog this small only reads as a kink. */
const JOG = 6;
/** How far from an element's corners a line keeps. */
const INSET = 8;
/** How far a lane must stand off a box for a line to run into its side. */
const CLEAR = 10;

/** One arrow of a scope, measured, for `arrowPaths`. */
export interface ArrowEnds {
  /** the keys of its two ends: arrows that share one can share a run */
  from: string;
  to: string;
  a: Rect;
  b: Rect;
  via?: Rect[];
  curve?: boolean;
  route?: 'down' | 'right';
}

/** A loop on an element's right side, or its left when the right has no room. */
function selfLoop(r: Rect, gap: number, headSize: number, width: number): ArrowPath | null {
  const right = r.x + r.w + LOOP + TRACK_GAP <= width || r.x - LOOP - TRACK_GAP < 0;
  const side = right ? 1 : -1;
  const edge = right ? r.x + r.w : r.x;
  const y = r.y + r.h / 2;
  const s = Math.min(PORT / 2, r.h / 4);
  const p = draw([[edge + side * gap, y - s], [edge + side * LOOP, y - s], [edge + side * LOOP, y + s], [edge + side * gap, y + s]], headSize);
  return p && { ...p, label: [edge + side * (LOOP + 4), y], align: right ? 'start' : 'end' };
}

/** Where an arrow leaves or reaches one side of an element: all that go the same way share it. */
interface Port {
  rect: Rect;
  side: 1 | -1;
  out: boolean;
  /** the positions, across the flow, of what its arrows run to next */
  toward: number[];
  x: number;
}

/** A stop on a square arrow's way. `turn`: it doubles back here, so the level run is at this height. */
interface Stop {
  x: number;
  y: number;
  turn?: boolean;
}

/** A level run between two stops, at the height `track` gives it. */
interface Hop {
  lo: number;
  hi: number;
  from: number;
  to: number;
  /** the ports it leaves and reaches, when it is the arrow's first or last hop */
  out?: string;
  in?: string;
  track?: number;
}

interface Plan {
  i: number;
  across: boolean;
  /** the ports it uses; a line back up (see `aside`) has none, and leaves or arrives by `sides` */
  out?: Port;
  in?: Port;
  sides: [(1 | -1)?, (1 | -1)?];
  // the ends' rects and the stops between them; the end stops wait until the ports are placed
  a: Rect;
  b: Rect;
  first: 1 | -1;
  last: 1 | -1;
  between: Stop[];
  keys: [string, string];
}

/** x and y swapped: a run across is routed as a run down, so the routing only ever thinks in rows. */
const flip = (r: Rect): Rect => ({ x: r.y, y: r.x, w: r.h, h: r.w });
const midY = (r: Rect): number => r.y + r.h / 2;
const midX = (r: Rect): number => r.x + r.w / 2;
/** One wholly above the other. */
const apart = (a: Rect, b: Rect): boolean => a.y + a.h <= b.y || b.y + b.h <= a.y;
const way = (p: Rect, q: Rect): 1 | -1 => (midY(q) < midY(p) ? -1 : 1);
const mean = (ns: number[]): number => ns.reduce((s, n) => s + n, 0) / ns.length;

/** Which side of `end` a line back up can meet it by, coming along a lane at `x`: the side the lane
 *  is on, if the lane stands clear of it. */
function aside(end: Rect, x: number): 1 | -1 | undefined {
  if (x <= end.x - CLEAR) return -1;
  return x >= end.x + end.w + CLEAR ? 1 : undefined;
}

/** Which track of a gap each hop runs on. Hops that leave one port share a track, or else hops that
 *  reach one port do, so a track never joins two sources to two targets; tracks are then reused
 *  along the gap wherever their runs don't touch. */
function layTracks(band: Hop[]): void {
  const lo = Math.max(...band.map((h) => h.lo));
  const hi = Math.min(...band.map((h) => h.hi));
  if (hi - lo < 1) {
    // no height all of them cross (their ends aren't in rows): each takes the middle of its own
    for (const h of band) h.track = (h.lo + h.hi) / 2;
    return;
  }
  const count = (k: string): number => band.filter((h) => h.out === k || h.in === k).length;
  const groups = new Map<string, Hop[]>();
  band.forEach((h, n) => {
    const k = h.out && count(h.out) > 1 ? h.out : h.in && count(h.in) > 1 ? h.in : `#${n}`;
    groups.set(k, [...(groups.get(k) ?? []), h]);
  });
  const spans = [...groups.values()]
    .map((hops) => ({ hops, l: Math.min(...hops.map((h) => Math.min(h.from, h.to))), r: Math.max(...hops.map((h) => Math.max(h.from, h.to))) }))
    .sort((p, q) => p.l - q.l || p.r - q.r);
  const ends: number[] = [];
  const at = spans.map((s) => {
    let k = ends.findIndex((e) => e + TRACK_GAP <= s.l);
    if (k < 0) k = ends.push(s.r) - 1;
    ends[k] = s.r;
    return k;
  });
  spans.forEach((s, n) => {
    for (const h of s.hops) h.track = lo + ((hi - lo) * (at[n] + 1)) / (ends.length + 1);
  });
}

/** Splits hops into the gaps they cross (hops whose heights overlap) and lays each gap's tracks. */
function layGaps(hops: Hop[]): void {
  let band: Hop[] = [];
  let end = -Infinity;
  for (const h of hops.filter((x) => x.track === undefined).sort((p, q) => p.lo - q.lo)) {
    if (band.length && h.lo >= end) {
      layTracks(band);
      band = [];
    }
    band.push(h);
    end = Math.max(end, h.hi);
  }
  if (band.length) layTracks(band);
}

/** Drops repeated points and points along a straight run. */
function tidy(pts: Pt[]): Pt[] {
  const near = (a: number, b: number): boolean => Math.abs(a - b) < 0.5;
  const out: Pt[] = [];
  for (const p of pts) {
    const q = out[out.length - 1];
    if (q && near(p[0], q[0]) && near(p[1], q[1])) continue;
    const o = out[out.length - 2];
    if (o && q && ((near(o[0], q[0]) && near(q[0], p[0])) || (near(o[1], q[1]) && near(q[1], p[1])))) out.pop();
    out.push(p);
  }
  return out;
}

/** The square arrows of a scope: level and upright runs only, sharing ports and tracks. */
function squarePaths(arrows: ArrowEnds[], indices: number[], out: (ArrowPath | null)[], gap: number, headSize: number): void {
  const ports = new Map<string, Port>();
  const port = (name: string, rect: Rect, side: 1 | -1, isOut: boolean, toward: number): Port => {
    const p = ports.get(name) ?? { rect, side, out: isOut, toward: [], x: midX(rect) };
    p.toward.push(toward);
    ports.set(name, p);
    return p;
  };
  const plans: Plan[] = [];
  for (const i of indices) {
    const ar = arrows[i];
    let across = ar.route === 'right';
    const hasVia = (ar.via?.length ?? 0) > 0;
    // no waypoints and no gap to turn in this way round: run the other way, or go direct
    if (!hasVia && !apart(across ? flip(ar.a) : ar.a, across ? flip(ar.b) : ar.b)) across = !across;
    const turned = (r: Rect): Rect => (across ? flip(r) : r);
    const a = turned(ar.a);
    const b = turned(ar.b);
    if (!hasVia && !apart(a, b)) {
      out[i] = arrowPath(ar.a, ar.b, false, gap, headSize);
      continue;
    }
    const via = (ar.via ?? []).map(turned);
    const stops = [a, ...via, b];
    const first = way(a, stops[1]);
    const last = way(stops[stops.length - 2], b);
    const between: Stop[] = [];
    via.forEach((r, j) => {
      const inward = way(stops[j], r);
      const onward = way(r, stops[j + 2]);
      if (inward !== onward) between.push({ x: midX(r), y: midY(r), turn: true });
      else {
        const before = between[between.length - 1];
        const x = before && Math.abs(before.x - midX(r)) < JOG ? before.x : midX(r);
        between.push({ x, y: inward > 0 ? r.y : r.y + r.h }, { x, y: inward > 0 ? r.y + r.h : r.y });
      }
    });
    // a line back up keeps clear of the lines coming down: it leaves or arrives by the side where
    // its lane stands clear of the box, and otherwise by the top or bottom edge beside them
    const up = via.length > 0 && first < 0 && last < 0 && !between.some((s) => s.turn);
    const leave = up ? aside(a, between[0].x) : undefined;
    const reach = up ? aside(b, between[between.length - 1].x) : undefined;
    const axis = across ? 'h' : 'v';
    const names: [string, string] = [`${axis}|${ar.from}|${first}|out`, `${axis}|${ar.to}|${-last}|in`];
    plans.push({
      i, across, a, b, first, last, between, keys: names,
      sides: [leave, reach],
      out: leave ? undefined : port(names[0], a, first, true, midX(stops[1])),
      in: reach ? undefined : port(names[1], b, last > 0 ? -1 : 1, false, midX(stops[stops.length - 2])),
    });
  }
  // a side that arrows both leave and reach by has two ports, side by side, each nearer what it runs
  // to. Level with each other, one leaves on the left of a bottom edge and arrives on the left of a
  // top edge, so a link and the link back run side by side and don't cross
  const sides = new Map<string, Port[]>();
  for (const [name, p] of ports) {
    const k = name.slice(0, name.lastIndexOf('|'));
    sides.set(k, [...(sides.get(k) ?? []), p]);
  }
  for (const ps of sides.values()) {
    if (ps.length < 2) continue;
    const step = Math.min(PORT, ps[0].rect.w / 3);
    const tie = (p: Port): number => (p.out === p.side > 0 ? 0 : 1);
    ps.sort((p, q) => (Math.abs(mean(p.toward) - mean(q.toward)) < 1 ? tie(p) - tie(q) : mean(p.toward) - mean(q.toward)));
    ps.forEach((p, k) => {
      p.x = midX(p.rect) + (k - 0.5) * step;
    });
  }
  // a port with one arrow goes where that arrow is straight, if it can: an end of the line may be
  // anywhere along its element's edge
  const alone = (p: Port, name: string): boolean => p.toward.length === 1 && sides.get(name.slice(0, name.lastIndexOf('|')))!.length === 1;
  for (const p of plans) {
    const [lo, hi] = [(r: Rect) => r.x + Math.min(INSET, r.w / 2), (r: Rect) => r.x + r.w - Math.min(INSET, r.w / 2)];
    const { out: o, in: t } = p;
    const outAlone = !!o && alone(o, p.keys[0]);
    const inAlone = !!t && alone(t, p.keys[1]);
    const left = Math.max(lo(p.a), lo(p.b));
    const right = Math.min(hi(p.a), hi(p.b));
    if (o && t && !p.between.length && outAlone && inAlone) {
      if (left <= right) o.x = t.x = Math.min(right, Math.max(left, (midX(p.a) + midX(p.b)) / 2));
    } else if (o && t && !p.between.length) {
      if (outAlone && t.x >= lo(p.a) && t.x <= hi(p.a)) o.x = t.x;
      if (inAlone && o.x >= lo(p.b) && o.x <= hi(p.b)) t.x = o.x;
    } else if (p.between.length) {
      const next = p.between[0].x;
      const before = p.between[p.between.length - 1].x;
      if (o && outAlone && next >= lo(p.a) && next <= hi(p.a)) o.x = next;
      if (t && inAlone && before >= lo(p.b) && before <= hi(p.b)) t.x = before;
    }
  }
  // the stops in order, and a hop wherever two of them aren't one above the other
  const routes = plans.map((p) => {
    const edge = (r: Rect, side: number): number => (side > 0 ? r.y + r.h : r.y);
    const flank = (r: Rect, side: number): number => (side > 0 ? r.x + r.w + gap : r.x - gap);
    const [leave, reach] = p.sides;
    const n = p.between.length;
    const stops: Stop[] = [
      ...(leave ? [{ x: flank(p.a, leave), y: midY(p.a) }, { x: p.between[0].x, y: midY(p.a) }] : [{ x: p.out!.x, y: edge(p.a, p.first) + p.first * gap }]),
      ...p.between,
      ...(reach ? [{ x: p.between[n - 1].x, y: midY(p.b) }, { x: flank(p.b, reach), y: midY(p.b) }] : [{ x: p.in!.x, y: edge(p.b, -p.last) - p.last * gap }]),
    ];
    const hops = stops.slice(1).map((q, k): Hop | null => {
      const s = stops[k];
      if (Math.abs(s.x - q.x) < 0.5) return null;
      const level = Math.abs(s.y - q.y) < 0.5;
      return {
        lo: Math.min(s.y, q.y), hi: Math.max(s.y, q.y), from: s.x, to: q.x,
        out: k === 0 ? p.keys[0] : undefined,
        in: k === stops.length - 2 ? p.keys[1] : undefined,
        track: level ? s.y : s.turn ? s.y : q.turn ? q.y : undefined,
      };
    });
    return { p, stops, hops };
  });
  for (const across of [false, true]) layGaps(routes.filter((r) => r.p.across === across).flatMap((r) => r.hops.filter((h): h is Hop => !!h)));
  for (const { p, stops, hops } of routes) {
    const pts: Pt[] = [];
    stops.forEach((s, k) => {
      const h = hops[k - 1];
      if (h) pts.push([h.from, h.track!], [h.to, h.track!]);
      pts.push([s.x, s.y]);
    });
    out[p.i] = draw(tidy(pts).map((q): Pt => (p.across ? [q[1], q[0]] : q)), headSize);
  }
}

/**
 * The paths of a scope's arrows, in order. An arrow from an element to itself is a loop on its side.
 * With `route` an arrow has only level and upright runs (down: it leaves and arrives by the top and
 * bottom edges and turns in the gaps between rows; right: the same, by the left and right edges, in
 * the gaps between columns), and arrows with an end in common combine into one line. `width`, the
 * scope's own, keeps a loop inside it.
 */
export function arrowPaths(arrows: ArrowEnds[], gap = 3, headSize = 7, width = Infinity): (ArrowPath | null)[] {
  const out: (ArrowPath | null)[] = arrows.map(() => null);
  const square: number[] = [];
  arrows.forEach((a, i) => {
    if (a.from === a.to) out[i] = selfLoop(a.a, gap, headSize, width);
    else if (a.route) square.push(i);
    else out[i] = arrowPath(a.a, a.b, a.curve, gap, headSize, a.via);
  });
  squarePaths(arrows, square, out, gap, headSize);
  return out;
}
