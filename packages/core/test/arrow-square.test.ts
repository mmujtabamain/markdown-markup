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
    expect(p!.head[0][1]).toBeCloseTo(100 - 3);
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
    expect(r[0].a).toEqual([97, 215]);
    expect(p!.head[0]).toEqual([97, 15]);
  });

  it('joins a lane pinned level beside an end by that side of the box (a graph\'s line back)', () => {
    const f = { top: box(100, 0), low: box(100, 200), pinLow: { x: 50, y: 200, w: 0, h: 30 }, lane: { x: 50, y: 100, w: 0, h: 40 }, pinTop: { x: 50, y: 0, w: 0, h: 30 } };
    const [p] = arrowPaths([{ from: 'low', to: 'top', a: f.low, b: f.top, via: [f.pinLow, f.lane, f.pinTop], route: 'down' }]);
    expect(allSquare(p!.d)).toBe(true);
    // out of the left side of the lower box, up the lane, into the left side of the upper one
    expect(runs(p!.d)[0].a).toEqual([97, 215]);
    expect(p!.head[0]).toEqual([97, 15]);
    // never inside either box
    for (const [x, y] of corners(p!.d)) for (const r of [f.top, f.low]) expect(x > r.x && x < r.x + r.w && y > r.y && y < r.y + r.h).toBe(false);
  });

  it('turns a line within one row round a lane below it', () => {
    const f = { l: box(0, 0), r: box(200, 0), lane: { x: 100, y: 60, w: 0, h: 0 } };
    const [p] = arrowPaths([{ from: 'l', to: 'r', a: f.l, b: f.r, via: [f.lane], route: 'down' }]);
    expect(allSquare(p!.d)).toBe(true);
    expect(Math.max(...corners(p!.d).map((c) => c[1]))).toBeCloseTo(60);
    expect(p!.head[0][1]).toBeCloseTo(33);
  });

  it('runs side to side within a row, with no waypoint to go round', () => {
    const f = { l: box(0, 0), r: box(200, 0) };
    const [p] = arrowPaths([link('l', 'r', f)]);
    expect(p!.head[0]).toEqual([197, 15]);
    expect(runs(p!.d)).toHaveLength(1);
  });

  it('routes across with route=right', () => {
    const f = { a: box(0, 0), b: box(200, 100) };
    const [p] = arrowPaths([link('a', 'b', f, { route: 'right' })]);
    expect(allSquare(p!.d)).toBe(true);
    expect(runs(p!.d)[0].a).toEqual([63, 15]);
    expect(p!.head[0]).toEqual([197, 115]);
  });
});

describe('a link to itself', () => {
  const r = box(100, 100, 60, 40);

  it('is a square loop on the right, with its label beyond it', () => {
    const [p] = arrowPaths([{ from: 'n', to: 'n', a: r, b: r }]);
    expect(allSquare(p!.d)).toBe(true);
    expect(p!.head[0][0]).toBeCloseTo(163);
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
    expect(p!.d.endsWith('L30.0,97.0')).toBe(true);
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
    expect(p!.d.endsWith('L30.0,90.0')).toBe(true);
  });
});
