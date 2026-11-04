// arrow via= (6.10): waypoints in the path geometry, the checker and the runtime, and the layered
// diagrams that route their edges through them (mkp-diagrams flow, graph, er; mkp-cs protocol).
import { describe, expect, it } from 'vitest';
import { compile, type PackSource } from '../src/build';
import { formatDiagnostic } from '../src/diag';
import { expand } from '../src/expand';
import { compileCase, fixtureCases } from '../src/fixtures';
import { arrowPath, type Rect } from '../src/runtime/arrow';
import { Runtime } from '../src/runtime/runtime';
import type { VArrow, VNode } from '../src/runtime/view';
import { allPacks } from './helpers';

const enc = new TextEncoder();
function build(src: string) {
  const files = new Map<string, Uint8Array>([
    ['manifest.mkp', enc.encode('pack t@1 "test"\n  requires core@1\n  provides w\n')],
    ['w.mkp', enc.encode(src)],
  ]);
  const c = compile({ packs: [{ label: 't', files } as PackSource] });
  const b = c.document('```w\nsummary: s\n```\n', 'doc.mkp.md');
  return { b, errors: c.diags.errors.map(formatDiagnostic) };
}

function scopeWithArrows(v: VNode[]): VNode | undefined {
  for (const n of v) {
    if (n.arrows?.length) return n;
    const k = scopeWithArrows(n.kids ?? []);
    if (k) return k;
  }
  return undefined;
}

describe('arrowPath through waypoints', () => {
  // two boxes one above the other, and a strut (a lane: no width, some height) off to the side
  const top: Rect = { x: 0, y: 0, w: 40, h: 20 };
  const bottom: Rect = { x: 0, y: 200, w: 40, h: 20 };
  const strut: Rect = { x: 100, y: 60, w: 0, h: 80 };

  it('is unchanged without waypoints', () => {
    const p = arrowPath(top, bottom)!;
    expect(arrowPath(top, bottom, false, 3, 7, [])).toEqual(p);
    expect(p.d).toMatch(/^M[\d.,-]+ L[\d.,-]+$/);
  });

  it('runs along a tall element from end to end, rounding the corners', () => {
    const p = arrowPath(top, bottom, false, 3, 7, [strut])!;
    const enter = p.d.indexOf('Q100.0,60.0');
    const leave = p.d.indexOf('Q100.0,140.0');
    expect(enter).toBeGreaterThan(0);
    expect(leave).toBeGreaterThan(enter);
    // the tip sits just outside the target's outline, reached from the strut's lower end
    const [tx, ty] = p.head[0];
    expect(ty).toBeLessThan(bottom.y);
    expect(ty).toBeGreaterThan(bottom.y - 3.01);
    expect(tx).toBeGreaterThan(20);
    // the shaft stops at the head's base, a head's length (7) short of the tip (d is rounded to 0.1)
    const last = p.d.split(' L').pop()!.split(',').map(Number);
    expect(Math.abs(Math.hypot(last[0] - tx, last[1] - ty) - 7)).toBeLessThan(0.15);
  });

  it('takes a tall element the other way round on the way back up', () => {
    const p = arrowPath(bottom, top, false, 3, 7, [strut])!;
    expect(p.d.indexOf('Q100.0,140.0')).toBeLessThan(p.d.indexOf('Q100.0,60.0'));
    expect(p.head[0][1]).toBeGreaterThan(top.y + top.h);
  });

  it('runs side to side through a wide element and through the centre of an empty one', () => {
    const left: Rect = { x: 0, y: 90, w: 20, h: 20 };
    const right: Rect = { x: 200, y: 90, w: 20, h: 20 };
    const wide = arrowPath(left, right, false, 3, 7, [{ x: 60, y: 40, w: 80, h: 0 }])!;
    expect(wide.d.indexOf('Q60.0,40.0')).toBeLessThan(wide.d.indexOf('Q140.0,40.0'));
    const dot = arrowPath(left, right, false, 3, 7, [{ x: 110, y: 160, w: 0, h: 0 }])!;
    expect(dot.d).toContain('Q110.0,160.0');
  });

  it('puts the label halfway along the path, and curve does not apply', () => {
    const a: Rect = { x: 0, y: 0, w: 20, h: 20 };
    const b: Rect = { x: 200, y: 0, w: 20, h: 20 };
    const via = [{ x: 110, y: 110, w: 0, h: 0 }];
    const p = arrowPath(a, b, false, 3, 7, via)!;
    expect(p.label[0]).toBeCloseTo(110, 6);
    expect(p.label[1]).toBeCloseTo(110, 6);
    expect(arrowPath(a, b, true, 3, 7, via)).toEqual(p);
  });

  it('may leave and come back to one element through a waypoint', () => {
    expect(arrowPath(top, top)).toBeNull();
    expect(arrowPath(top, top, false, 3, 7, [{ x: 20, y: 80, w: 0, h: 0 }])).not.toBeNull();
  });
});

describe('arrow via= in the checker and the runtime', () => {
  const src = `w@1 "w"
  ids = ["m", "nope"]
  stack
    stack id=a
      text "a"
    stack id=m
    stack id=b
      text "b"
  arrow from=a to=b via=(ids)
  arrow from=b to=a via=["m"] curve
  arrow from=a to=b
`;

  it('resolves waypoint ids like from and to, and leaves out a missing one with a warning', () => {
    const { b, errors } = build(src);
    expect(errors).toEqual([]);
    const rt = new Runtime(b!);
    const scope = scopeWithArrows(rt.view())!;
    const [down, back, plain] = scope.arrows as VArrow[];
    const keyOf = (id: string): string => {
      let k = '';
      const walk = (ns: VNode[]): void => ns.forEach((n) => (n.id === id ? (k = n.key) : walk(n.kids ?? [])));
      walk(scope.kids ?? []);
      return k;
    };
    expect(down.via).toEqual([keyOf('m')]);
    expect(back.via).toEqual([keyOf('m')]);
    expect(back.curve).toBe(true);
    expect(plain.via).toBeUndefined();
    expect(rt.warnings.map((w) => w.code)).toContain('mkp.arrow-missing');
    expect(rt.warnings.map((w) => w.message).join('\n')).toMatch(/nope to pass through/);
  });

  it('checks via as a list of ids', () => {
    expect(build(src.replace('via=(ids)', 'via=(3)')).errors.join('\n')).toMatch(/list\(text\)/);
    expect(build(src.replace('via=(ids)', 'over=(ids)')).errors.join('\n')).toMatch(/via=\(ids\)/);
  });
});

describe('arrows in the expanded IR', () => {
  it('substitute inputs and each variables in the label, as in from, to and via', () => {
    const { b, errors } = build(`w@1 "w"
  in links list({a: text, z: text, name: text}) = [{a: "a", z: "b", name: "a to b"}]
  stack
    stack id=a
      text "a"
    stack id=b
      text "b"
  each l in links
    arrow from=(l.a) to=(l.z) label=(l.name)
`);
    expect(errors).toEqual([]);
    // a label is text runs; their text is enough here
    const text = (l: unknown): string => (Array.isArray(l) ? l.map((r: { v?: unknown }) => String(r.v ?? '')).join('') : String(l ?? ''));
    const labels = (rt: Runtime) => (scopeWithArrows(rt.view())?.arrows as VArrow[]).map((a) => text(a.label));
    expect(labels(new Runtime(b!))).toEqual(['a to b']);
    // unrolled, the each variable is gone: a label still reading it would be empty
    expect(labels(new Runtime(expand(b!)))).toEqual(['a to b']);
  });
});

describe('layered diagrams route every edge row by row', () => {
  // Each edge's run, from its source through its waypoints to its target, must step one row at a
  // time: a step that skips a row could pass through a box in it, and a step within one row runs
  // along it. Rows are the children of the innermost element holding every arrow end.
  const c = compile({ packs: allPacks() });
  const wanted = new Set(['mkp-diagrams/flow@1', 'mkp-diagrams/graph@1', 'mkp-diagrams/er@1', 'mkp-cs/protocol@1']);
  const cases = fixtureCases(c).filter((fc) => wanted.has(`${fc.pack}/${fc.widget}`) && !fc.expect?.errors?.length);

  it('covers the fixture cases', () => expect(cases.length).toBeGreaterThanOrEqual(8));

  it.each(cases.map((fc) => [`${fc.pack}/${fc.widget}/${fc.name}`, fc] as const))('%s', (_name, fc) => {
    const rt = new Runtime(compileCase(c, fc).bundle!, { now: () => 0 });
    const scope = scopeWithArrows(rt.view())!;
    const arrows = scope.arrows ?? [];
    const ends = new Set(arrows.flatMap((a) => [a.from, a.to, ...(a.via ?? [])]));
    // the path of keys from the scope down to each arrow end
    const paths = new Map<string, string[]>();
    const nodes = new Map<string, VNode>();
    const walk = (ns: VNode[], path: string[]): void => {
      for (const n of ns) {
        const p = [...path, n.key];
        nodes.set(n.key, n);
        if (ends.has(n.key)) paths.set(n.key, p);
        walk(n.kids ?? [], p);
      }
    };
    walk(scope.kids ?? [], []);
    expect([...ends].filter((k) => !paths.has(k))).toEqual([]);
    const all = [...paths.values()];
    let depth = 0;
    while (all.every((p) => p.length > depth + 1 && p[depth] === all[0][depth])) depth++;
    const rows = (depth ? nodes.get(all[0][depth - 1])!.kids ?? [] : scope.kids ?? []).map((n) => n.key);
    const index = (k: string): number => rows.indexOf(paths.get(k)![depth]);
    expect(rows.length).toBeGreaterThan(1);
    for (const a of arrows) {
      // a link from a node to itself stays in its row: it's a loop
      if (a.from === a.to) continue;
      const run = [a.from, ...(a.via ?? []), a.to];
      for (let i = 1; i < run.length; i++) expect(Math.abs(index(run[i]) - index(run[i - 1])), `${a.key} step ${i}`).toBe(1);
    }
    // labels are laid out as elements of their own, never drawn on the arrow
    expect(arrows.filter((a) => a.label)).toEqual([]);
  });
});
