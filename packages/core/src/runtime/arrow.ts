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
  /** the marks at its ends other than a plain head: path data, and how it is filled */
  marks?: { d: string; fill: 'solid' | 'none' | 'hollow'; tone?: string }[];
  /** a routed arrow that turns in a gap too narrow for its turns to keep TRACK_GAP apart: widen the gap */
  crowded?: boolean;
}

/** How an arrow ends at an element: an arrow head, a hollow triangle (is a kind of), a bar (one), a
 *  crow's foot (many), or nothing. */
export type ArrowEnd = 'arrow' | 'hollow' | 'one' | 'many' | 'dot' | 'ring' | 'cross' | 'none';

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
function lane(r: Rect, prev: Pt, next: Pt, turn = false): Pt[] {
  const [cx, cy] = centre(r);
  if (Math.abs(r.h - r.w) < 1) return [[cx, cy]];
  const clamp = (v: number, a: number, b: number): number => Math.min(b, Math.max(a, v));
  // lanes=turn: along it only from level with where the line comes from to level with where it goes
  if (turn) return r.h > r.w ? [[cx, clamp(prev[1], r.y, r.y + r.h)], [cx, clamp(next[1], r.y, r.y + r.h)]] : [[clamp(prev[0], r.x, r.x + r.w), cy], [clamp(next[0], r.x, r.x + r.w), cy]];
  const ends: [Pt, Pt] = r.h > r.w ? [[cx, r.y], [cx, r.y + r.h]] : [[r.x, cy], [r.x + r.w, cy]];
  return dist(prev, ends[0]) + dist(ends[1], next) <= dist(prev, ends[1]) + dist(ends[0], next) ? ends : [ends[1], ends[0]];
}

/** Corners rounded off where the path turns (radius 12, less on short segments). */
const CORNER = 12;

/** An arrow through waypoints: straight runs between them, rounded where it turns. */
function routed(a: Rect, b: Rect, via: Rect[], gap: number, headSize: number, corner = CORNER, turn = false): ArrowPath | null {
  return draw(routedPoints(a, b, via, gap, turn), headSize, corner);
}

/** The points an arrow through waypoints runs through, before its corners are rounded. */
function routedPoints(a: Rect, b: Rect, via: Rect[], gap: number, turn = false): Pt[] {
  const mid: Pt[] = [];
  let prev = centre(a);
  via.forEach((r, i) => {
    const run = lane(r, prev, centre(i + 1 < via.length ? via[i + 1] : b), turn);
    mid.push(...run);
    prev = run[run.length - 1];
  });
  const p0 = exit(a, mid[0][0], mid[0][1], gap);
  const last = mid[mid.length - 1];
  const p1 = exit(b, last[0], last[1], gap);
  const pts: Pt[] = [];
  for (const p of [p0, ...mid, p1]) if (!pts.length || dist(pts[pts.length - 1], p) >= 0.5) pts.push(p);
  return pts;
}

/** A hop on run `seg` of a path (from point seg to seg + 1): centred `at` along it, `w` either side, `h` high, towards `side`. */
interface HopArc {
  seg: number;
  at: number;
  w: number;
  h: number;
  side: Pt;
}

/** The shaft through these points, rounded where it turns (by `corner`, less on short runs), with the head on the last run, and a hop over each line it crosses (`hops`). */
function draw(pts: Pt[], headSize: number, corner = CORNER, hops: HopArc[] = []): ArrowPath | null {
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
  // the hops along run k: a line to where each starts, then a half-ellipse over to where it ends
  const arcs = (k: number): string => {
    const [pa, pb] = [shaft[k], shaft[k + 1]];
    const len = dist(pa, pb);
    if (len < 1) return '';
    const u: Pt = [(pb[0] - pa[0]) / len, (pb[1] - pa[1]) / len];
    return hops
      .filter((h) => h.seg === k)
      .sort((x, y) => x.at - y.at)
      .map((h) => {
        const a: Pt = [pa[0] + u[0] * (h.at - h.w), pa[1] + u[1] * (h.at - h.w)];
        const b: Pt = [pa[0] + u[0] * (h.at + h.w), pa[1] + u[1] * (h.at + h.w)];
        // sweep 1 turns clockwise on screen: over the top of a run going right, round the left of one going up
        const sweep = u[0] * h.side[1] - u[1] * h.side[0] < 0 ? 1 : 0;
        return ` L${f(a[0])},${f(a[1])} A${f(h.w)},${f(h.h)} 0 0 ${sweep} ${f(b[0])},${f(b[1])}`;
      })
      .join('');
  };
  for (let i = 1; i < shaft.length - 1; i++) {
    d += arcs(i - 1);
    const [pa, pb, pc] = [shaft[i - 1], shaft[i], shaft[i + 1]];
    const l1 = dist(pa, pb);
    const l2 = dist(pb, pc);
    const r = Math.min(corner, l1 / 2, l2 / 2);
    const u: Pt = [pb[0] - ((pb[0] - pa[0]) / l1) * r, pb[1] - ((pb[1] - pa[1]) / l1) * r];
    const w: Pt = [pb[0] + ((pc[0] - pb[0]) / l2) * r, pb[1] + ((pc[1] - pb[1]) / l2) * r];
    d += ` L${f(u[0])},${f(u[1])} Q${f(pb[0])},${f(pb[1])} ${f(w[0])},${f(w[1])}`;
  }
  const end = shaft[shaft.length - 1];
  d += `${arcs(shaft.length - 2)} L${f(end[0])},${f(end[1])}`;
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
export function arrowPath(a: Rect, b: Rect, curve = false, gap = 0, headSize = 7, via: Rect[] = [], corner = CORNER, turn = false): ArrowPath | null {
  if (via.length) return routed(a, b, via, gap, headSize, corner, turn);
  const ac: [number, number] = [a.x + a.w / 2, a.y + a.h / 2];
  const bc: [number, number] = [b.x + b.w / 2, b.y + b.h / 2];
  if (Math.hypot(bc[0] - ac[0], bc[1] - ac[1]) < 1) return null;
  let ctrl: [number, number] | null = null;
  if (curve) {
    const mx = (ac[0] + bc[0]) / 2;
    const my = (ac[1] + bc[1]) / 2;
    const dx = bc[0] - ac[0];
    const dy = bc[1] - ac[1];
    // a quarter of the distance, but never less than a clear bend: a back link between two
    // rows next to each other otherwise hugs the straight line (GAPS 52)
    const k = Math.max(0.25, MIN_BEND / Math.max(1, Math.hypot(dx, dy)));
    ctrl = [mx - dy * k, my + dx * k];
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

/** The least a curved arrow bends away from the straight line, in pixels (GAPS 52). */
const MIN_BEND = 32;
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
  /** turn: a via lane says where the line turns, and it runs along the lane only as far as it must */
  lanes?: 'full' | 'turn';
  /** none: it never hops over another line, and nothing hops over it (a sequence's lifelines) */
  hop?: 'auto' | 'none';
  curve?: boolean;
  route?: 'down' | 'right';
  /** the mark at `to` (default an arrow head) and at `from` (default none) */
  head?: ArrowEnd;
  tail?: ArrowEnd;
  /** the radius its turns are rounded to, in pixels (arrow corner=: m 12, s 6, none 0); 12 by default */
  corner?: number;
}

/** arrow corner=: the radius of its turns. */
export const ARROW_CORNERS: Record<string, number> = { none: 0, s: 6, m: 12 };

const r1 = (n: number): string => n.toFixed(1);

/** The mark of one kind at P, the line arriving along u (a unit vector pointing into the element). */
function mark(kind: ArrowEnd, P: Pt, u: Pt): { d: string; fill: 'solid' | 'none' | 'hollow'; tone?: string } | null {
  const v: Pt = [-u[1], u[0]];
  const at = (along: number, across: number): string => `${r1(P[0] - u[0] * along + v[0] * across)},${r1(P[1] - u[1] * along + v[1] * across)}`;
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
      // centred where the shaft stops, a head's length short of the element: it never got there
      return { d: `M${at(2.5, 4.5)} L${at(11.5, -4.5)} M${at(2.5, -4.5)} L${at(11.5, 4.5)}`, fill: 'none', tone: 'bad' };
    default:
      return null;
  }
}

const unit = (p: Pt, q: Pt): Pt => {
  const l = Math.hypot(q[0] - p[0], q[1] - p[1]) || 1;
  return [(q[0] - p[0]) / l, (q[1] - p[1]) / l];
};

/** An arrow with other marks at its ends than a head at `to`: the shaft runs to the tip for a mark
 *  that isn't a head, and each mark is drawn along the line where it meets its element. */
function withEnds(p: ArrowPath, head: ArrowEnd, tail: ArrowEnd): ArrowPath {
  if (head === 'arrow' && tail === 'none') return p;
  const tip = p.head[0];
  const back: Pt = [(p.head[1][0] + p.head[2][0]) / 2, (p.head[1][1] + p.head[2][1]) / 2];
  const nums = [...p.d.matchAll(/-?[\d.]+/g)].slice(0, 4).map((m) => Number(m[0]));
  const start: Pt = [nums[0], nums[1]];
  const next: Pt = [nums[2], nums[3]];
  const marks = [head === 'arrow' ? null : mark(head, tip, unit(back, tip)), mark(tail, start, unit(next, start))].filter((m): m is NonNullable<typeof m> => !!m);
  // a mark that isn't a head lets the shaft run on to the element; a cross stops it short
  const d = head === 'arrow' || head === 'cross' ? p.d : `${p.d} L${r1(tip[0])},${r1(tip[1])}`;
  return { ...p, d, head: head === 'arrow' ? p.head : [], marks };
}

/** A loop on an element's right side, or its left when the right has no room. */
function selfLoop(r: Rect, gap: number, headSize: number, width: number, corner = CORNER): ArrowPath | null {
  const right = r.x + r.w + LOOP + TRACK_GAP <= width || r.x - LOOP - TRACK_GAP < 0;
  const side = right ? 1 : -1;
  const edge = right ? r.x + r.w : r.x;
  const y = r.y + r.h / 2;
  const s = Math.min(PORT / 2, r.h / 4);
  const p = draw([[edge + side * gap, y - s], [edge + side * LOOP, y - s], [edge + side * LOOP, y + s], [edge + side * gap, y + s]], headSize, corner);
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
  /** which way it runs across its gap: 1 towards hi, -1 towards lo */
  dir?: 1 | -1;
  /** its track is nearer than TRACK_GAP to another's that runs beside it: the gap is too narrow */
  crowded?: boolean;
  /** the arrow it is part of */
  route?: number;
}

/** An upright run that passes through a gap without turning in it: another line's level run may cross it. */
interface Upright {
  x: number;
  lo: number;
  hi: number;
  route: number;
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
  /** where lanes=turn lanes put its runs across a gap */
  tracks: number[];
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

/** The least straight run before a head (the head and 6 px of line) and after a tail. */
const RUN_IN = (headSize: number): number => headSize + 6;
const RUN_OUT = 6;

/** Which track of a gap each hop runs on. Hops that leave one port share a track, or else hops that
 *  reach one port do, so a track never joins two sources to two targets; tracks are then reused
 *  along the gap wherever their runs don't touch. The tracks keep clear of the side the heads
 *  arrive at by RUN_IN, so a head is never on a bend, and of the side tails leave by RUN_OUT; in a
 *  gap too narrow for both, the heads' run comes first. */
function layTracks(band: Hop[], headSize: number, fixed: Upright[] = []): void {
  // the room a straight run needs at each side: heads arrive at hi going down (dir 1), at lo going up
  const need = (hs: Hop[], side: 1 | -1): number => Math.max(0, ...hs.map((h) => (h.in && h.dir === side ? RUN_IN(headSize) : h.out && h.dir === -side ? RUN_OUT : 0)));
  const count = (k: string): number => band.filter((h) => h.out === k || h.in === k).length;
  const groups = new Map<string, Hop[]>();
  band.forEach((h, n) => {
    const k = h.out && count(h.out) > 1 ? h.out : h.in && count(h.in) > 1 ? h.in : `#${n}`;
    groups.set(k, [...(groups.get(k) ?? []), h]);
  });
  const spans = [...groups.values()]
    .map((hops) => ({ hops, l: Math.min(...hops.map((h) => Math.min(h.from, h.to))), r: Math.max(...hops.map((h) => Math.max(h.from, h.to))) }))
    .sort((p, q) => p.l - q.l || p.r - q.r);
  let lo = Math.max(...band.map((h) => h.lo));
  let hi = Math.min(...band.map((h) => h.hi));
  if (hi - lo < 1) {
    // no height all of them cross (their ends aren't in rows): each group turns within its own
    // height, as near its middle as it can while keeping TRACK_GAP from the tracks beside it
    placeApart(spans, need);
    return;
  }
  const atHi = need(band, 1);
  const atLo = need(band, -1);
  if (hi - lo >= atLo + atHi) {
    lo += atLo;
    hi -= atHi;
  } else if (spans.length > 1) {
    // the height they share has no room for their runs: each turns within its own instead
    placeApart(spans, need);
    return;
  } else {
    // not room for both: the heads' run first, then what is left for the tails'
    const heads = band.some((h) => h.in && h.dir === 1) ? 1 : band.some((h) => h.in && h.dir === -1) ? -1 : 0;
    const t = heads === 1 ? Math.max(lo, hi - atHi) : heads === -1 ? Math.min(hi, lo + atLo) : (lo + hi) / 2;
    for (const h of band) h.track = t;
    return;
  }
  const ends: number[] = [];
  const at = spans.map((s) => {
    let k = ends.findIndex((e) => e + TRACK_GAP <= s.l);
    if (k < 0) k = ends.push(s.r) - 1;
    ends[k] = s.r;
    return k;
  });
  // fewer than TRACK_GAP between neighbouring tracks reads as one line
  const crowded = ends.length > 1 && (hi - lo) / (ends.length + 1) < TRACK_GAP;
  // which height each row of tracks takes: the order with the fewest crossings, today's on a tie
  const order = fewestCrossings(spans, at, ends.length, (row) => lo + ((hi - lo) * (row + 1)) / (ends.length + 1), fixed);
  spans.forEach((s, n) => {
    for (const h of s.hops) {
      h.track = lo + ((hi - lo) * (order[at[n]] + 1)) / (ends.length + 1);
      if (crowded) h.crowded = true;
    }
  });
}

/** Rows of tracks this many or fewer are ordered by trying every order (7! = 5040). */
const MAX_ORDERED = 7;

/**
 * The order of a gap's rows of tracks (row → position) under which the fewest level runs cross an
 * upright run: the hops' own (from the line's start to its track, and from its track on) and those
 * of lines passing through the gap. Today's order (row k at position k) is kept unless another
 * crosses strictly less, so a graph that crosses nothing draws as it did.
 */
function fewestCrossings(spans: { hops: Hop[] }[], at: number[], rows: number, y: (pos: number) => number, fixed: Upright[]): number[] {
  const identity = [...Array(rows).keys()];
  if (rows < 2 || rows > MAX_ORDERED) return identity;
  const hops = spans.flatMap((s, n) => s.hops.map((h) => ({ h, row: at[n] })));
  const crossings = (order: number[]): number => {
    const t = (row: number): number => y(order[row]);
    const level = hops.map(({ h, row }) => ({ x0: Math.min(h.from, h.to), x1: Math.max(h.from, h.to), y: t(row), route: h.route }));
    // a hop's uprights: from its start's side of the gap to its track, and from its track to its end's
    const ups: Upright[] = [
      ...fixed,
      ...hops.flatMap(({ h, row }) => {
        const y0 = t(row);
        const start = h.dir === -1 ? { lo: y0, hi: h.hi } : { lo: h.lo, hi: y0 };
        const end = h.dir === -1 ? { lo: h.lo, hi: y0 } : { lo: y0, hi: h.hi };
        return [{ x: h.from, ...start, route: h.route ?? -1 }, { x: h.to, ...end, route: h.route ?? -1 }];
      }),
    ];
    let n = 0;
    for (const l of level) for (const u of ups) if (u.route !== l.route && u.x > l.x0 + 0.5 && u.x < l.x1 - 0.5 && l.y > u.lo + 0.5 && l.y < u.hi - 0.5) n++;
    return n;
  };
  let best = identity;
  let least = crossings(identity);
  if (!least) return identity;
  const permute = (rest: number[], done: number[]): void => {
    if (!least) return;
    if (!rest.length) {
      const n = crossings(done);
      if (n < least) [best, least] = [[...done], n];
      return;
    }
    for (let k = 0; k < rest.length; k++) permute([...rest.slice(0, k), ...rest.slice(k + 1)], [...done, rest[k]]);
  };
  permute(identity, []);
  return best;
}

/**
 * Tracks for hops that don't all cross one height: each group gets the point of its own height
 * (less its runs) nearest its middle that keeps TRACK_GAP from every track already laid that runs
 * beside it (their spans along the gap overlap); one with no such point is crowded, at the point
 * furthest from them.
 */
function placeApart(spans: { hops: Hop[]; l: number; r: number }[], need: (hs: Hop[], side: 1 | -1) => number): void {
  const laid: { l: number; r: number; y: number }[] = [];
  for (const s of spans) {
    let lo = Math.max(...s.hops.map((h) => h.lo));
    let hi = Math.min(...s.hops.map((h) => h.hi));
    const [atLo, atHi] = [need(s.hops, -1), need(s.hops, 1)];
    if (hi - lo >= atLo + atHi) {
      lo += atLo;
      hi -= atHi;
    }
    if (hi < lo) [lo, hi] = [(lo + hi) / 2, (lo + hi) / 2];
    const beside = laid.filter((t) => t.l < s.r + TRACK_GAP && s.l < t.r + TRACK_GAP && t.y >= lo - TRACK_GAP && t.y <= hi + TRACK_GAP);
    const clearance = (y: number): number => Math.min(Infinity, ...beside.map((t) => Math.abs(t.y - y)));
    const mid = (lo + hi) / 2;
    // the middle first, then outwards a step at a time, both ways
    const tries = [mid];
    for (let k = 1; mid - k * TRACK_GAP >= lo || mid + k * TRACK_GAP <= hi; k++) for (const y of [mid - k * TRACK_GAP, mid + k * TRACK_GAP]) if (y >= lo && y <= hi) tries.push(y);
    tries.push(lo, hi);
    let y = tries.find((t) => clearance(t) >= TRACK_GAP);
    const crowded = y === undefined;
    if (y === undefined) y = tries.reduce((b, t) => (clearance(t) > clearance(b) ? t : b), mid);
    for (const h of s.hops) {
      h.track = y;
      if (crowded) h.crowded = true;
    }
    laid.push({ l: s.l, r: s.r, y });
  }
}

/** Splits hops into the gaps they cross (hops whose heights overlap) and lays each gap's tracks. */
function layGaps(hops: Hop[], headSize: number, fixed: Upright[] = []): void {
  let band: Hop[] = [];
  let end = -Infinity;
  for (const h of hops.filter((x) => x.track === undefined).sort((p, q) => p.lo - q.lo)) {
    if (band.length && h.lo >= end) {
      layTracks(band, headSize, fixed);
      band = [];
    }
    band.push(h);
    end = Math.max(end, h.hi);
  }
  if (band.length) layTracks(band, headSize, fixed);
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
function squarePaths(arrows: ArrowEnds[], indices: number[], out: (ArrowPath | null)[], gap: number, headSize: number, lines: (Pt[] | null)[]): void {
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
      out[i] = arrowPath(ar.a, ar.b, false, gap, headSize, [], ar.corner);
      lines[i] = straightPoints(ar.a, ar.b, gap);
      continue;
    }
    // lanes=turn: a lane lying across the way the line runs says only where it turns (its run across
    // the gap is at the lane), not a point to pass through; a lane lying along it is run along as far
    // as the line must
    const tracks: number[] = [];
    const via = (ar.via ?? []).map(turned).filter((r) => !(ar.lanes === 'turn' && r.w > r.h && tracks.push(midY(r))));
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
        let [enter, leave] = inward > 0 ? [r.y, r.y + r.h] : [r.y + r.h, r.y];
        if (ar.lanes === 'turn') {
          // only the part of the lane between where the line comes from and where it goes, with
          // room left in the gaps for its turns (a tail's run and a track, a head's run and a track)
          const from = inward > 0 ? stops[j].y + stops[j].h : stops[j].y;
          const to = inward > 0 ? stops[j + 2].y : stops[j + 2].y + stops[j + 2].h;
          const [top, bottom] = [r.y, r.y + r.h];
          const clamp = (v: number): number => Math.min(bottom, Math.max(top, v));
          enter = clamp(from + inward * (RUN_OUT + TRACK_GAP));
          leave = clamp(to - inward * (RUN_IN(headSize) + TRACK_GAP));
          if ((leave - enter) * inward < 0) leave = enter;
        }
        between.push({ x, y: enter }, { x, y: leave });
      }
    });
    // a line back up keeps clear of the lines coming down: it leaves or arrives by the side where
    // its lane stands clear of the box, and otherwise by the top or bottom edge beside them
    const up = via.length > 0 && first < 0 && last < 0 && !between.some((s) => s.turn);
    // a lane level with an end, clear of its box (a graph pins one beside a line back's ends): the
    // line leaves or arrives by that side of the box
    const pinned = (end: Rect, r: Rect | undefined): 1 | -1 | undefined => (r && !apart(end, r) ? aside(end, midX(r)) : undefined);
    const leave = pinned(a, via[0]) ?? (up ? aside(a, between[0].x) : undefined);
    const reach = pinned(b, via[via.length - 1]) ?? (up ? aside(b, between[between.length - 1].x) : undefined);
    const axis = across ? 'h' : 'v';
    const names: [string, string] = [`${axis}|${ar.from}|${first}|out`, `${axis}|${ar.to}|${-last}|in`];
    plans.push({
      i, across, a, b, first, last, between, keys: names, tracks,
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
        track: level ? s.y : s.turn ? s.y : q.turn ? q.y : p.tracks.find((t) => t >= Math.min(s.y, q.y) && t <= Math.max(s.y, q.y)),
        dir: q.y > s.y ? 1 : -1,
        route: p.i,
      };
    });
    return { p, stops, hops };
  });
  for (const across of [false, true]) {
    const these = routes.filter((r) => r.p.across === across);
    // the runs that pass straight down through a gap: a level run laid across one crosses it
    const fixed: Upright[] = these.flatMap(({ p, stops, hops }) => hops.flatMap((h, k) => (h ? [] : [{ x: stops[k].x, lo: Math.min(stops[k].y, stops[k + 1].y), hi: Math.max(stops[k].y, stops[k + 1].y), route: p.i }])));
    layGaps(these.flatMap((r) => r.hops.filter((h): h is Hop => !!h)), headSize, fixed);
  }
  for (const { p, stops, hops } of routes) {
    const pts: Pt[] = [];
    stops.forEach((s, k) => {
      const h = hops[k - 1];
      if (h) pts.push([h.from, h.track!], [h.to, h.track!]);
      pts.push([s.x, s.y]);
    });
    const line = tidy(pts).map((q): Pt => (p.across ? [q[1], q[0]] : q));
    const drawn = draw(line, headSize, arrows[p.i].corner ?? CORNER);
    if (drawn && hops.some((h) => h?.crowded)) drawn.crowded = true;
    out[p.i] = drawn;
    lines[p.i] = line;
  }
}

/**
 * The paths of a scope's arrows, in order. An arrow from an element to itself is a loop on its side.
 * With `route` an arrow has only level and upright runs (down: it leaves and arrives by the top and
 * bottom edges and turns in the gaps between rows; right: the same, by the left and right edges, in
 * the gaps between columns), and arrows with an end in common combine into one line. `width`, the
 * scope's own, keeps a loop inside it.
 */
export function arrowPaths(arrows: ArrowEnds[], gap = 0, headSize = 7, width = Infinity): (ArrowPath | null)[] {
  const out: (ArrowPath | null)[] = arrows.map(() => null);
  // each straight-run arrow's points before its corners are rounded: what untangle works on
  const lines: (Pt[] | null)[] = arrows.map(() => null);
  const square: number[] = [];
  arrows.forEach((a, i) => {
    if (a.from === a.to) out[i] = selfLoop(a.a, gap, headSize, width, a.corner);
    else if (a.route) square.push(i);
    else if (a.curve && !a.via?.length) out[i] = arrowPath(a.a, a.b, true, gap, headSize, [], a.corner);
    else {
      const line = a.via?.length ? routedPoints(a.a, a.b, a.via, gap, a.lanes === 'turn') : straightPoints(a.a, a.b, gap);
      lines[i] = line;
      out[i] = line && draw(line, headSize, a.corner ?? CORNER);
    }
  });
  squarePaths(arrows, square, out, gap, headSize, lines);
  const hops = untangle(arrows, lines, headSize);
  lines.forEach((line, i) => {
    if (!line || !(hops[i].length || hops.moved.has(i))) return;
    const crowded = out[i]?.crowded;
    out[i] = draw(line, headSize, arrows[i].corner ?? CORNER, hops[i]);
    if (out[i] && crowded) out[i]!.crowded = true;
  });
  return out.map((p, i) => (p ? withEnds(p, arrows[i].head ?? 'arrow', arrows[i].tail ?? 'none') : p));
}

/** A straight arrow's two points: where the line between the centres leaves each element. */
function straightPoints(a: Rect, b: Rect, gap: number): Pt[] | null {
  const [ac, bc] = [centre(a), centre(b)];
  if (dist(ac, bc) < 1) return null;
  return [exit(a, bc[0], bc[1], gap), exit(b, ac[0], ac[1], gap)];
}

/** How far apart two runs of different links must be, side by side, not to read as one. */
const CLEAR_RUN = TRACK_GAP;
/** A hop's radius: about three times the stroke (1.5 px). */
const HOP = 5;

/**
 * The finishing pass over a scope's arrows, on their points before corners are rounded. First, two
 * runs of different links side by side closer than CLEAR_RUN (a line that turns right beside
 * another, so its corner seems to join it) are moved apart, where one of them can move without its
 * ends leaving their elements. Then each crossing that remains gets a hop: the flatter run lifts over
 * the steeper (a level run upwards, an upright one to the left). Not crossings: a run ending on
 * another, runs along one line (a shared trunk), and one within a hop of a corner, head or tail.
 * Crossings closer than a hop's width make one wider hop. hop=none lines neither hop nor are hopped.
 */
function untangle(arrows: ArrowEnds[], lines: (Pt[] | null)[], headSize: number): HopArc[][] & { moved: Set<number> } {
  const hops = Object.assign(
    arrows.map((): HopArc[] => []),
    { moved: new Set<number>() },
  );
  const takes = (i: number): boolean => !!lines[i] && arrows[i].hop !== 'none';
  const shares = (i: number, j: number): boolean => arrows[i].from === arrows[j].from || arrows[i].to === arrows[j].to || arrows[i].from === arrows[j].to || arrows[i].to === arrows[j].from;
  const level = (p: Pt, q: Pt): boolean => Math.abs(p[1] - q[1]) < 0.5;
  const upright = (p: Pt, q: Pt): boolean => Math.abs(p[0] - q[0]) < 0.5;

  // 1. runs side by side: move one apart
  const ends = (i: number): [Rect, Rect] => [arrows[i].a, arrows[i].b];
  /** Whether run k of line i can move by d across itself (dx for an upright, dy for a level run). */
  const canMove = (i: number, k: number, d: number): boolean => {
    const L = lines[i]!;
    const n = L.length;
    const along = upright(L[k], L[k + 1]) ? 1 : 0;
    const across = 1 - along;
    for (const [j, nb] of [[k, k - 1], [k + 1, k + 1]] as const) {
      if (nb >= 0 && nb + 1 < n) {
        // a neighbouring run, across this one: it lengthens or shortens, and must keep its way and some length
        const other = nb === k - 1 ? L[nb] : L[nb + 1];
        const before = L[j][across] - other[across];
        const after = before + d;
        if (Math.sign(before) !== Math.sign(after) || Math.abs(after) < 2) return false;
      } else {
        // an end: it slides along its element's edge, and must stay on it, clear of the corners
        const r = ends(i)[j === 0 ? 0 : 1];
        const lo = across === 0 ? r.x : r.y;
        const size = across === 0 ? r.w : r.h;
        const inset = Math.min(INSET, size / 2);
        const v = L[j][across] + d;
        if (v < lo + inset || v > lo + size - inset) return false;
      }
    }
    return true;
  };
  const shift = (i: number, k: number, d: number): void => {
    const L = lines[i]!;
    const across = upright(L[k], L[k + 1]) ? 0 : 1;
    L[k][across] += d;
    L[k + 1][across] += d;
    hops.moved.add(i);
  };
  const steep = (p: Pt, q: Pt): number => Math.abs(q[1] - p[1]) / (Math.abs(q[0] - p[0]) + 1e-9);
  /** How far from each end of run k a crossing must be: a corner's rounding, or a head's or a tail's length. */
  const trims = (i: number, k: number): [number, number] => {
    const L = lines[i]!;
    const n = L.length;
    const corner = arrows[i].corner ?? CORNER;
    const len = (q: number): number => dist(L[q], L[q + 1]);
    const at = (q: number): number => Math.min(corner, len(q - 1) / 2, len(q) / 2);
    const start = k === 0 ? ((arrows[i].tail ?? 'none') === 'none' ? 0 : headSize) : at(k);
    const end = k === n - 2 ? headSize : at(k + 1);
    return [start, end];
  };
  /** Where runs p–p2 and q–q2 cross, as distances along each, or null if they don't. */
  const crossing = (p: Pt, p2: Pt, q: Pt, q2: Pt): { ta: number; tb: number } | null => {
    const r: Pt = [p2[0] - p[0], p2[1] - p[1]];
    const s2: Pt = [q2[0] - q[0], q2[1] - q[1]];
    const den = r[0] * s2[1] - r[1] * s2[0];
    if (Math.abs(den) < 1e-6) return null;
    const t = ((q[0] - p[0]) * s2[1] - (q[1] - p[1]) * s2[0]) / den;
    const u = ((q[0] - p[0]) * r[1] - (q[1] - p[1]) * r[0]) / den;
    if (t < 0 || t > 1 || u < 0 || u > 1) return null;
    return { ta: t * Math.hypot(...r), tb: u * Math.hypot(...s2) };
  };
  // how badly line i sits among the others: a run side by side with another's closer than
  // CLEAR_RUN, or a crossing too near a corner or an end to hop, counts 3; a crossing that can hop, 1
  type Bad = { k: number; j: number; m: number; kind: 'side' | 'corner'; near?: number };
  const assess = (i: number): { score: number; bad: Bad[] } => {
    const A = lines[i]!;
    const bad: Bad[] = [];
    let score = 0;
    for (let j = 0; j < arrows.length; j++) {
      if (j === i || !lines[j] || shares(i, j)) continue;
      const B = lines[j]!;
      for (let k = 0; k + 1 < A.length; k++) {
        for (let m = 0; m + 1 < B.length; m++) {
          const [p, p2, q, q2] = [A[k], A[k + 1], B[m], B[m + 1]];
          const vert = upright(p, p2) && upright(q, q2);
          const horiz = level(p, p2) && level(q, q2);
          if (vert || horiz) {
            const ax = vert ? 0 : 1;
            const along = 1 - ax;
            const apart = Math.abs(q[ax] - p[ax]);
            const overlap = Math.min(Math.max(p[along], p2[along]), Math.max(q[along], q2[along])) - Math.max(Math.min(p[along], p2[along]), Math.min(q[along], q2[along]));
            if (apart >= 0.5 && apart < CLEAR_RUN && overlap >= 2) {
              score += 3;
              bad.push({ k, j, m, kind: 'side' });
            }
            continue;
          }
          const x = crossing(p, p2, q, q2);
          if (!x) continue;
          const [ia, ea] = trims(i, k);
          const [ib, eb] = trims(j, m);
          const [la, lb] = [dist(p, p2), dist(q, q2)];
          // a run ending on another is a join, not a crossing
          if (x.ta < 0.5 || x.ta > la - 0.5 || x.tb < 0.5 || x.tb > lb - 0.5) continue;
          if (x.ta < ia + HOP || x.ta > la - ea - HOP || x.tb < ib + HOP || x.tb > lb - eb - HOP) {
            score += 3;
            // which of line i's own corners it is too near, if one: that corner's next run can move
            const near = x.ta < ia + HOP && k > 0 ? k - 1 : x.ta > la - ea - HOP && k + 2 < A.length ? k + 1 : undefined;
            bad.push({ k, j, m, kind: 'corner', near });
          } else score += 1;
        }
      }
    }
    return { score, bad };
  };
  /** Where run k of line i may go instead, across itself, to clear run m of line j. */
  const places = (i: number, b: Bad): { k: number; to: number[] }[] => {
    const [A, B] = [lines[i]!, lines[b.j]!];
    if (b.kind === 'side') {
      const ax = upright(A[b.k], A[b.k + 1]) ? 0 : 1;
      const at = B[b.m][ax];
      return [{ k: b.k, to: [at - CLEAR_RUN, at + CLEAR_RUN] }];
    }
    if (b.near === undefined) return [];
    // the corner's other run, which is parallel to B's run: before the line, or past it with room to hop
    const run = b.near;
    const ax = upright(A[run], A[run + 1]) ? 0 : 1;
    if (!(ax === 0 ? upright(B[b.m], B[b.m + 1]) : level(B[b.m], B[b.m + 1]))) return [];
    const at = B[b.m][ax];
    const room = (arrows[i].corner ?? CORNER) + HOP + 2;
    return [{ k: run, to: [at - CLEAR_RUN, at + CLEAR_RUN, at - room, at + room] }];
  };
  for (let pass = 0; pass < 2; pass++) {
    for (let i = 0; i < arrows.length; i++) {
      if (!lines[i]) continue;
      let now = assess(i);
      for (const b of now.bad) {
        for (const { k, to } of places(i, b)) {
          const L = lines[i]!;
          const ax = upright(L[k], L[k + 1]) ? 0 : 1;
          let best: { d: number; score: number } | null = null;
          for (const t of to) {
            const d = t - L[k][ax];
            if (Math.abs(d) < 0.01 || !canMove(i, k, d)) continue;
            L[k][ax] += d;
            L[k + 1][ax] += d;
            const score = assess(i).score;
            L[k][ax] -= d;
            L[k + 1][ax] -= d;
            if (score < now.score && (!best || score < best.score || (score === best.score && Math.abs(d) < Math.abs(best.d)))) best = { d, score };
          }
          if (best) {
            shift(i, k, best.d);
            now = assess(i);
          }
        }
      }
    }
  }

  // 2. crossings: a hop on the flatter run
  const found = arrows.map((): { seg: number; at: number }[] => []);
  for (let i = 0; i < arrows.length; i++) {
    if (!takes(i)) continue;
    for (let j = i + 1; j < arrows.length; j++) {
      if (!takes(j)) continue;
      const [A, B] = [lines[i]!, lines[j]!];
      for (let k = 0; k + 1 < A.length; k++) {
        for (let m = 0; m + 1 < B.length; m++) {
          const [p, p2, q, q2] = [A[k], A[k + 1], B[m], B[m + 1]];
          const r: Pt = [p2[0] - p[0], p2[1] - p[1]];
          const s2: Pt = [q2[0] - q[0], q2[1] - q[1]];
          const den = r[0] * s2[1] - r[1] * s2[0];
          if (Math.abs(den) < 1e-6) continue; // parallel: a shared trunk, or apart
          const t = ((q[0] - p[0]) * s2[1] - (q[1] - p[1]) * s2[0]) / den;
          const u = ((q[0] - p[0]) * r[1] - (q[1] - p[1]) * r[0]) / den;
          const [lr, ls] = [Math.hypot(...r), Math.hypot(...s2)];
          const [ta, tb] = [t * lr, u * ls];
          const [ia, ea] = trims(i, k);
          const [ib, eb] = trims(j, m);
          // a proper crossing: inside both runs, clear of their corners and ends by a hop
          if (ta < ia + HOP || ta > lr - ea - HOP || tb < ib + HOP || tb > ls - eb - HOP) continue;
          const [si, sj] = [steep(p, p2), steep(q, q2)];
          if (si < sj - 1e-6 || (Math.abs(si - sj) <= 1e-6 && i > j)) found[i].push({ seg: k, at: ta });
          else found[j].push({ seg: m, at: tb });
        }
      }
    }
  }
  found.forEach((list, i) => {
    const L = lines[i];
    if (!L || !list.length) return;
    for (const seg of [...new Set(list.map((c) => c.seg))]) {
      // one hop per point (a shared trunk crossed), and crossings closer than a hop's width as one
      const ats = list.filter((c) => c.seg === seg).map((c) => c.at).sort((x, y) => x - y);
      const groups: number[][] = [];
      for (const a of ats) {
        const g = groups[groups.length - 1];
        if (g && a - g[g.length - 1] < 2 * HOP + 2) g.push(a);
        else groups.push([a]);
      }
      const [p, q] = [L[seg], L[seg + 1]];
      const len = dist(p, q);
      const u: Pt = [(q[0] - p[0]) / len, (q[1] - p[1]) / len];
      // upwards for a run flatter than 45 degrees, else to the left
      const n: Pt = Math.abs(u[0]) >= Math.abs(u[1]) ? (u[0] > 0 ? [u[1], -u[0]] : [-u[1], u[0]]) : u[1] > 0 ? [-u[1], u[0]] : [u[1], -u[0]];
      const [s0, s1] = trims(i, seg);
      for (const g of groups) {
        const w = (g[g.length - 1] - g[0]) / 2 + HOP;
        const at = (g[0] + g[g.length - 1]) / 2;
        if (at - w < s0 || at + w > len - s1) continue;
        hops[i].push({ seg, at, w, h: HOP, side: n });
      }
    }
  });
  return hops;
}
