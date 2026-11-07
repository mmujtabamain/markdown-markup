// arrow route= and self-links (6.10): level and upright runs only, lines that share an end combine,
// lines that don't share a run, and an element can link to itself.
import { describe, expect, it } from 'vitest';
import { arrowPaths, type ArrowEnds, type Rect } from '../src/runtime/arrow';

const box = (x: number, y: number, w = 60, h = 30): Rect => ({ x, y, w, h });
const link = (from: string, to: string, boxes: Record<string, Rect>, more: Partial<ArrowEnds> = {}): ArrowEnds => ({
  from, to, a: boxes[from], b: boxes[to], route: 'down', ...more,
});

/** The corners of a shaft: each M and L point, and the corner of each rounded turn. */
function corners(d: string): [number, number][] {
  return [...d.matchAll(/[ML](-?[\d.]+),(-?[\d.]+)|Q(-?[\d.]+),(-?[\d.]+) /g)].map((m) => (m[1] !== undefined ? [Number(m[1]), Number(m[2])] : [Number(m[3]), Number(m[4])]));
}

/** Every run of a shaft, as the runs a line is made of once its rounded corners are taken out. */
function runs(d: string): { a: [number, number]; b: [number, number] }[] {
  const pts = [...d.matchAll(/Q(-?[\d.]+),(-?[\d.]+) (-?[\d.]+),(-?[\d.]+)/g)].map((m) => [Number(m[1]), Number(m[2])] as [number, number]);
  const start = /^M(-?[\d.]+),(-?[\d.]+)/.exec(d)!;
  const end = /L(-?[\d.]+),(-?[\d.]+)$/.exec(d)!;
  const all: [number, number][] = [[Number(start[1]), Number(start[2])], ...pts, [Number(end[1]), Number(end[2])]];
  return all.slice(1).map((b, i) => ({ a: all[i], b }));
}

function allSquare(d: string): boolean {
  return runs(d).every(({ a, b }) => Math.abs(a[0] - b[0]) < 0.11 || Math.abs(a[1] - b[1]) < 0.11);
}

describe('arrow route=down', () => {
  const b = { a: box(100, 0), left: box(0, 100), mid: box(100, 100), right: box(200, 100), end: box(100, 200) };

  it('has only level and upright runs, however far apart its ends are', () => {
    const [p] = arrowPaths([link('a', 'right', b)]);
    expect(allSquare(p!.d)).toBe(true);
    expect(corners(p!.d).length).toBeGreaterThan(2);
  });

  it('runs dead straight when its ends overlap across the flow', () => {
    const near = { a: box(100, 0), b: box(120, 100) };
    const [p] = arrowPaths([link('a', 'b', near)]);
    expect(runs(p!.d)).toHaveLength(1);
    expect(p!.d).not.toContain('Q');
  });

  it('points the head along the last run, at the top edge', () => {
    const [p] = arrowPaths([link('a', 'right', b)]);
    expect(p!.head[0][1]).toBeCloseTo(100);
    expect(p!.head[1][1]).toBeCloseTo(p!.head[2][1]);
  });

  it('leaves one node on one trunk: its lines turn off the same run', () => {
    const [l, m, r] = arrowPaths([link('a', 'left', b), link('a', 'mid', b), link('a', 'right', b)]);
    const start = (d: string) => runs(d)[0].a;
    expect(start(l!.d)).toEqual(start(m!.d));
    expect(start(l!.d)).toEqual(start(r!.d));
    const level = (d: string) => runs(d).find((u) => Math.abs(u.a[1] - u.b[1]) < 0.11)!.a[1];
    expect(level(l!.d)).toBeCloseTo(level(r!.d));
  });

  it('reaches one node as one line', () => {
    const f = { x: box(0, 0), y: box(200, 0), t: box(100, 100) };
    const [p, q] = arrowPaths([link('x', 't', f), link('y', 't', f)]);
    expect(p!.head).toEqual(q!.head);
    const level = (d: string) => runs(d).find((u) => Math.abs(u.a[1] - u.b[1]) < 0.11)!.a[1];
    expect(level(p!.d)).toBeCloseTo(level(q!.d));
  });

  it('never puts two sources on one track when they go to different targets', () => {
    // a to c and b to d cross the gap the same way, so neither run may lie along the other
    const f = { a: box(0, 0), b: box(100, 0), c: box(150, 100), d: box(300, 100) };
    const [p, q] = arrowPaths([link('a', 'c', f), link('b', 'd', f)]);
    const level = (d: string) => runs(d).find((u) => Math.abs(u.a[1] - u.b[1]) < 0.11)!.a[1];
    expect(level(p!.d)).not.toBeCloseTo(level(q!.d));
  });

  it('gives links that only partly share a gap tracks of their own, apart, and not crowded', () => {
    // a's gap is 30..70 and b's 60..130: the 10 px they share has no room for a head's run, so each
    // turns within its own, a track's width from the other where their runs lie side by side
    const f = { a: box(0, 0), b: box(100, 30), c: box(150, 70), d: box(300, 130) };
    const [p, q] = arrowPaths([link('a', 'c', f), link('b', 'd', f)]);
    const level = (d: string) => runs(d).find((u) => Math.abs(u.a[1] - u.b[1]) < 0.11)!.a[1];
    expect(Math.abs(level(p!.d) - level(q!.d))).toBeGreaterThanOrEqual(8);
    expect(allSquare(p!.d) && allSquare(q!.d)).toBe(true);
    expect(p!.crowded || q!.crowded).toBeFalsy();
  });

  it('keeps the turns in a shared gap at least 8 px apart, and says when the gap is too narrow for that', () => {
    const across = (gap: number) => {
      const f: Record<string, Rect> = {};
      const ends: ArrowEnds[] = [];
      for (let k = 0; k < 4; k++) {
        f[`s${k}`] = box(k * 80, 0);
        f[`t${k}`] = box(40 + ((k + 2) % 4) * 80, 30 + gap);
        ends.push(link(`s${k}`, `t${k}`, f));
      }
      return arrowPaths(ends);
    };
    const level = (d: string) => runs(d).find((u) => Math.abs(u.a[1] - u.b[1]) < 0.11)?.a[1];
    const roomy = across(120);
    expect(roomy.some((p) => p!.crowded)).toBe(false);
    const ys = roomy.map((p) => level(p!.d)).filter((y): y is number => y !== undefined).sort((x, y) => x - y);
    for (let k = 1; k < ys.length; k++) if (Math.abs(ys[k] - ys[k - 1]) > 0.5) expect(ys[k] - ys[k - 1]).toBeGreaterThanOrEqual(8);
    expect(across(26).some((p) => p!.crowded)).toBe(true);
  });

  it('shares a track along a gap where the runs do not touch', () => {
    const f = { a: box(0, 0), c: box(70, 100), b: box(300, 0), d: box(370, 100) };
    const [p, q] = arrowPaths([link('a', 'c', f), link('b', 'd', f)]);
    const level = (d: string) => runs(d).find((u) => Math.abs(u.a[1] - u.b[1]) < 0.11)!.a[1];
    expect(level(p!.d)).toBeCloseTo(level(q!.d));
  });

  it('keeps a link and the link back side by side, uncrossed', () => {
    const f = { a: box(100, 0), b: box(100, 100) };
    const [p, q] = arrowPaths([link('a', 'b', f), link('b', 'a', f)]);
    const xs = (d: string) => [...new Set(runs(d).flatMap((u) => [u.a[0], u.b[0]]))];
    expect(xs(p!.d)).toHaveLength(1);
    expect(xs(q!.d)).toHaveLength(1);
    expect(xs(p!.d)[0]).not.toBeCloseTo(xs(q!.d)[0]);
  });

  it('takes a line back up along its lanes and into the side of a box it stands clear of', () => {
    const f = { top: box(100, 0), low: box(100, 200), lane: { x: 50, y: 100, w: 0, h: 40 } };
    const [p] = arrowPaths([{ from: 'low', to: 'top', a: f.low, b: f.top, via: [f.lane], route: 'down' }]);
    expect(allSquare(p!.d)).toBe(true);
    const r = runs(p!.d);
    expect(r[0].a).toEqual([100, 215]);
    expect(p!.head[0]).toEqual([100, 15]);
  });

  it('joins a lane pinned level beside an end by that side of the box (a graph\'s line back)', () => {
    const f = { top: box(100, 0), low: box(100, 200), pinLow: { x: 50, y: 200, w: 0, h: 30 }, lane: { x: 50, y: 100, w: 0, h: 40 }, pinTop: { x: 50, y: 0, w: 0, h: 30 } };
    const [p] = arrowPaths([{ from: 'low', to: 'top', a: f.low, b: f.top, via: [f.pinLow, f.lane, f.pinTop], route: 'down' }]);
    expect(allSquare(p!.d)).toBe(true);
    // out of the left side of the lower box, up the lane, into the left side of the upper one
    expect(runs(p!.d)[0].a).toEqual([100, 215]);
    expect(p!.head[0]).toEqual([100, 15]);
    // never inside either box
    for (const [x, y] of corners(p!.d)) for (const r of [f.top, f.low]) expect(x > r.x && x < r.x + r.w && y > r.y && y < r.y + r.h).toBe(false);
  });

  it('turns a line within one row round a lane below it', () => {
    const f = { l: box(0, 0), r: box(200, 0), lane: { x: 100, y: 60, w: 0, h: 0 } };
    const [p] = arrowPaths([{ from: 'l', to: 'r', a: f.l, b: f.r, via: [f.lane], route: 'down' }]);
    expect(allSquare(p!.d)).toBe(true);
    expect(Math.max(...corners(p!.d).map((c) => c[1]))).toBeCloseTo(60);
    expect(p!.head[0][1]).toBeCloseTo(30);
  });

  it('runs side to side within a row, with no waypoint to go round', () => {
    const f = { l: box(0, 0), r: box(200, 0) };
    const [p] = arrowPaths([link('l', 'r', f)]);
    expect(p!.head[0]).toEqual([200, 15]);
    expect(runs(p!.d)).toHaveLength(1);
  });

  it('routes across with route=right', () => {
    const f = { a: box(0, 0), b: box(200, 100) };
    const [p] = arrowPaths([link('a', 'b', f, { route: 'right' })]);
    expect(allSquare(p!.d)).toBe(true);
    expect(runs(p!.d)[0].a).toEqual([60, 15]);
    expect(p!.head[0]).toEqual([200, 115]);
  });
});

describe('a link to itself', () => {
  const r = box(100, 100, 60, 40);

  it('is a square loop on the right, with its label beyond it', () => {
    const [p] = arrowPaths([{ from: 'n', to: 'n', a: r, b: r }]);
    expect(allSquare(p!.d)).toBe(true);
    expect(p!.head[0][0]).toBeCloseTo(160);
    expect(p!.align).toBe('start');
    expect(p!.label[0]).toBeGreaterThan(160 + 18);
  });

  it('goes on the left when the scope has no room on the right', () => {
    const [p] = arrowPaths([{ from: 'n', to: 'n', a: r, b: r }], 3, 7, 170);
    expect(p!.head[0][0]).toBeCloseTo(97);
    expect(p!.align).toBe('end');
  });

  it('loops whether or not the arrow is routed', () => {
    const [p, q] = arrowPaths([{ from: 'n', to: 'n', a: r, b: r }, { from: 'n', to: 'n', a: r, b: r, route: 'down' }]);
    expect(p!.d).toEqual(q!.d);
  });
});

describe('arrows without route', () => {
  it('are the single arrow path, as before', () => {
    const f = { a: box(0, 0), b: box(200, 100) };
    const [p] = arrowPaths([{ from: 'a', to: 'b', a: f.a, b: f.b }]);
    expect(p!.d).toMatch(/^M[\d.,-]+ L[\d.,-]+$/);
  });
});

describe('the marks at an arrow end', () => {
  const f = { a: box(0, 0), b: box(0, 100) };

  it('draws a crow’s foot and a bar instead of a head, the shaft running to the element', () => {
    const [p] = arrowPaths([{ from: 'a', to: 'b', a: f.a, b: f.b, route: 'down', head: 'many', tail: 'one' }]);
    expect(p!.head).toEqual([]);
    expect(p!.marks).toHaveLength(2);
    expect(p!.marks![0].d.match(/M/g)).toHaveLength(3);
    expect(p!.marks![0].fill).toBe('none');
    expect(p!.d.endsWith('L30.0,100.0')).toBe(true);
  });

  it('draws a hollow triangle for a kind of, filled with the surface', () => {
    const [p] = arrowPaths([{ from: 'a', to: 'b', a: f.a, b: f.b, route: 'down', head: 'hollow' }]);
    expect(p!.marks).toEqual([expect.objectContaining({ fill: 'hollow' })]);
  });

  it('keeps the plain head as it was', () => {
    const [p] = arrowPaths([{ from: 'a', to: 'b', a: f.a, b: f.b, route: 'down' }]);
    expect(p!.head).toHaveLength(3);
    expect(p!.marks).toBeUndefined();
  });
});

describe('a cross at an arrow’s end', () => {
  const f = { a: box(0, 0), b: box(0, 100) };

  it('marks a message that never arrives: the shaft stops at the cross, drawn in the bad tone', () => {
    const [p] = arrowPaths([{ from: 'a', to: 'b', a: f.a, b: f.b, route: 'down', head: 'cross' }]);
    expect(p!.head).toEqual([]);
    expect(p!.marks).toEqual([expect.objectContaining({ fill: 'none', tone: 'bad' })]);
    expect(p!.marks![0].d.match(/M/g)).toHaveLength(2);
    // a head's length short of the tip, where the cross is centred
    expect(p!.d.endsWith('L30.0,93.0')).toBe(true);
  });
});

describe('a straight run before every head', () => {
  /** The length of the straight run a head sits on: from the last bend's end to the tip. */
  const runIn = (d: string, tip: number[]): number => {
    const r = runs(d);
    const last = r[r.length - 1];
    return Math.hypot(tip[0] - last.a[0], tip[1] - last.a[1]);
  };
  const tree = (gap: number) => ({ p: box(100, 0), l: box(0, 30 + gap), r: box(200, 30 + gap) });

  it('keeps the head and 6 px of line straight, in a tree whose layers are 16 px apart', () => {
    const f = tree(16);
    for (const p of arrowPaths([link('p', 'l', f), link('p', 'r', f)])) {
      expect(p!.head[0][1]).toBeCloseTo(46);
      expect(runIn(p!.d, p!.head[0])).toBeGreaterThanOrEqual(7 + 6 - 0.11);
      expect(allSquare(p!.d)).toBe(true);
    }
  });
  it('keeps the trunk in the middle when there is room for both runs, and the tail its own', () => {
    const f = tree(60);
    const [p] = arrowPaths([link('p', 'l', f)]);
    const level = runs(p!.d).find((u) => Math.abs(u.a[1] - u.b[1]) < 0.11)!.a[1];
    expect(level).toBeGreaterThanOrEqual(30 + 6);
    expect(level).toBeLessThanOrEqual(90 - 13);
  });
  it('gives the head its run first in a gap too narrow for both, going up as well as down', () => {
    const f = tree(8);
    const [down] = arrowPaths([link('p', 'l', f)]);
    expect(runIn(down!.d, down!.head[0])).toBeGreaterThanOrEqual(8 - 0.11);
    const [up] = arrowPaths([link('l', 'p', f)]);
    expect(up!.head[0][1]).toBeCloseTo(30);
    expect(runIn(up!.d, up!.head[0])).toBeGreaterThanOrEqual(8 - 0.11);
  });
  it('does the same across, with route=right', () => {
    const f = { p: box(0, 100), l: box(76, 0), r: box(76, 200) };
    for (const p of arrowPaths([link('p', 'l', f, { route: 'right' }), link('p', 'r', f, { route: 'right' })])) {
      expect(p!.head[0][0]).toBeCloseTo(76);
      expect(runIn(p!.d, p!.head[0])).toBeGreaterThanOrEqual(13 - 0.11);
    }
  });
});

describe('arrow corner=', () => {
  const f = { a: box(100, 0), b: box(0, 100) };
  it('rounds turns by 12 px by default, 6 with s, and not at all with none', () => {
    const q = (d: string) => [...d.matchAll(/ L(-?[\d.]+),(-?[\d.]+) Q(-?[\d.]+),(-?[\d.]+)/g)].map((m) => Math.hypot(Number(m[1]) - Number(m[3]), Number(m[2]) - Number(m[4])));
    const [m, s, none] = arrowPaths([link('a', 'b', f), link('a', 'b', f, { corner: 6 }), link('a', 'b', f, { corner: 0 })]);
    expect(Math.max(...q(m!.d))).toBeCloseTo(12, 0);
    expect(Math.max(...q(s!.d))).toBeCloseTo(6, 0);
    expect(Math.max(...q(none!.d))).toBeCloseTo(0, 0);
    expect(allSquare(none!.d)).toBe(true);
  });
});

describe('arrow lanes=turn', () => {
  const ys = (d: string) => corners(d).map(([, y]) => y);

  it('on a route, a lane across the way says where the line turns: one run across the gap, there', () => {
    // route=right through a tall lane in the gap: full passes through the lane's middle height,
    // turn keeps the ends' heights and makes its one upright run at the lane
    const g = { a: box(0, 0), b: box(300, 200), lane: { x: 150, y: -100, w: 10, h: 500 } };
    const [full] = arrowPaths([{ from: 'a', to: 'b', a: g.a, b: g.b, via: [g.lane], route: 'right' }]);
    const [turn] = arrowPaths([{ from: 'a', to: 'b', a: g.a, b: g.b, via: [g.lane], route: 'right', lanes: 'turn' }]);
    expect(ys(full!.d).some((y) => Math.abs(y - 150) < 0.5)).toBe(true);
    const upright = runs(turn!.d).filter((u) => Math.abs(u.a[0] - u.b[0]) < 0.11);
    expect(upright).toHaveLength(1);
    expect(upright[0].a[0]).toBeCloseTo(155);
    expect(ys(turn!.d).every((y) => y >= 15 - 0.5 && y <= 215 + 0.5)).toBe(true);
    expect(allSquare(turn!.d)).toBe(true);
  });

  it('on a free path, joins the lane level with where it comes from and leaves level with where it goes', () => {
    const g = { a: box(0, 0), b: box(300, 0), lane: { x: 150, y: -200, w: 10, h: 400 } };
    const [full] = arrowPaths([{ from: 'a', to: 'b', a: g.a, b: g.b, via: [g.lane] }]);
    const [turn] = arrowPaths([{ from: 'a', to: 'b', a: g.a, b: g.b, via: [g.lane], lanes: 'turn' }]);
    expect(Math.min(...ys(full!.d))).toBeLessThan(-100);
    expect(Math.min(...ys(turn!.d))).toBeGreaterThan(-1);
    expect(Math.max(...ys(turn!.d))).toBeLessThan(31);
  });
});

describe('crossings: fewer, then a hop where one remains', () => {
  const level = (d: string) => runs(d.replace(/ A[^L]*/g, ' ')).find((u) => Math.abs(u.a[1] - u.b[1]) < 0.11)!.a[1];
  const arcs = (d: string) => [...d.matchAll(/A(-?[\d.]+),(-?[\d.]+) 0 0 ([01]) (-?[\d.]+),(-?[\d.]+)/g)].map((m) => ({ rx: Number(m[1]), ry: Number(m[2]), sweep: Number(m[3]) }));
  const plain = (from: string, to: string, boxes: Record<string, Rect>, more: Partial<ArrowEnds> = {}): ArrowEnds => ({ from, to, a: boxes[from], b: boxes[to], ...more });

  it('orders the tracks of a gap so the fewest runs cross, and keeps today’s order where nothing crosses', () => {
    // P (a to d) above Q (b to c) crosses Q's way down and Q crosses P's: below it, neither does
    const f = { a: box(0, 0), b: box(150, 0), d: box(300, 100), c: box(400, 100) };
    const [p, q] = arrowPaths([link('a', 'd', f), link('b', 'c', f)]);
    expect(level(p!.d)).toBeGreaterThan(level(q!.d));
    expect(arcs(p!.d)).toEqual([]);
    expect(arcs(q!.d)).toEqual([]);
    // nothing crosses: the order is as before (the first span on the first track)
    const g = { a: box(0, 0), c: box(70, 100), b: box(300, 0), d: box(370, 100) };
    const [r, s] = arrowPaths([link('a', 'c', g), link('b', 'd', g)]);
    expect(level(r!.d)).toBeCloseTo(level(s!.d));
  });

  it('puts one upward hop on the level line where two links cross at right angles; the upright stays straight', () => {
    const f = { l: box(0, 100), r: box(300, 100), t: box(150, 0), b: box(150, 230) };
    const [h, v] = arrowPaths([plain('l', 'r', f), plain('t', 'b', f)]);
    expect(arcs(h!.d)).toEqual([{ rx: 5, ry: 5, sweep: 1 }]);
    expect(arcs(v!.d)).toEqual([]);
  });

  it('gives each hop’s arc on its own too, for a dashed line to draw unbroken over its dashes', () => {
    const f = { l: box(0, 100), r: box(300, 100), t: box(150, 0), b: box(150, 230) };
    const [h, v] = arrowPaths([plain('l', 'r', f), plain('t', 'b', f)]);
    expect(h!.hops).toHaveLength(1);
    expect(h!.hops![0]).toMatch(/^M[\d.]+,[\d.]+ A5\.0,5\.0 0 0 1 [\d.]+,[\d.]+$/);
    // the same arc as in the whole path
    expect(h!.d).toContain(h!.hops![0].replace(/^M([^ ]+) /, 'L$1 '));
    expect(v!.hops).toBeUndefined();
  });

  it('draws no hop where a line is hop=none: the lifeline breaks instead, so the message reads on top', () => {
    const f = { l: box(0, 100), r: box(300, 100), t: box(150, 0), b: box(150, 230) };
    const [h, v] = arrowPaths([plain('l', 'r', f), plain('t', 'b', f, { hop: 'none', head: 'none' })]);
    expect(arcs(h!.d)).toEqual([]);
    expect(arcs(v!.d)).toEqual([]);
    // the message is straight; the lifeline stops 3.5 px above it and goes on 3.5 px below
    expect(h!.d).not.toContain(' M');
    const gap = /L(-?[\d.]+),(-?[\d.]+) M(-?[\d.]+),(-?[\d.]+)/.exec(v!.d)!;
    expect(Number(gap[2])).toBeCloseTo(115 - 3.5, 0);
    expect(Number(gap[4])).toBeCloseTo(115 + 3.5, 0);
    expect(v!.hops).toBeUndefined();
    // two lines that never hop cross as they are
    const [a, b] = arrowPaths([plain('l', 'r', f, { hop: 'none' }), plain('t', 'b', f, { hop: 'none' })]);
    expect(a!.d).not.toContain(' M');
    expect(b!.d).not.toContain(' M');
  });

  it('hops once over a shared trunk, not once per link in it', () => {
    // two links from t straight down, one longer: one line where they overlap
    const f = { l: box(0, 100), r: box(300, 100), t: box(150, 0), b: box(150, 230), c: box(150, 330) };
    const [h] = arrowPaths([plain('l', 'r', f), plain('t', 'b', f), plain('t', 'c', f)]);
    expect(arcs(h!.d)).toHaveLength(1);
  });

  it('makes crossings closer than a hop one wider hop', () => {
    const f = { l: box(0, 100), r: box(300, 100), t: box(150, 0, 6, 30), b: box(150, 230, 6, 30), u: box(156, 0, 6, 30), w: box(156, 230, 6, 30) };
    const [h] = arrowPaths([plain('l', 'r', f), plain('t', 'b', f), plain('u', 'w', f)]);
    expect(arcs(h!.d)).toEqual([{ rx: 8, ry: 5, sweep: 1 }]);
  });

  it('draws no hop at a corner or an end: a run that ends on another is a join', () => {
    // the upright reaches the level line's element edge right where the level run ends
    const f = { l: box(0, 100), r: box(140, 100), t: box(165, 0, 20, 30), b: box(165, 230, 20, 30) };
    const [h, v] = arrowPaths([plain('l', 'r', f), plain('t', 'b', f)]);
    expect(arcs(h!.d)).toEqual([]);
    expect(arcs(v!.d)).toEqual([]);
  });

  it('moves a turn that would hug another line, or cross it at its corner, to before the line', () => {
    // a's line comes from the left and turns down to c 4 px beside the line from t to b (the image:
    // its corner seems to join that line). Its run down moves 8 px clear, on the side it comes from,
    // so its level run doesn't cross the other line at all
    const xs = (d: string) => runs(d.replace(/ A[^L]*/g, ' ')).filter((u) => Math.abs(u.a[0] - u.b[0]) < 0.11).map((u) => u.a[0]);
    for (const cx of [104, 96]) {
      const f = { a: box(0, 0), c: box(cx, 100, 60, 30), t: box(100, -60, 60, 30), b: box(100, 300, 60, 30) };
      const [p, q] = arrowPaths([link('a', 'c', f), { from: 't', to: 'b', a: f.t, b: f.b }]);
      const line = xs(q!.d)[0];
      const down = xs(p!.d).at(-1)!;
      expect(line - down).toBeGreaterThanOrEqual(8 - 0.11);
      expect(arcs(p!.d)).toEqual([]);
      expect(arcs(q!.d)).toEqual([]);
    }
  });
});
