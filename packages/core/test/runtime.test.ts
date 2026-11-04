import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { compile } from '../src/build';
import { compileCase, fixtureCases } from '../src/fixtures';
import { formatDiagnostic } from '../src/diag';
import { Runtime } from '../src/runtime/runtime';
import { walk, type VNode } from '../src/runtime/view';
import { allPacks, ROOT } from './helpers';

function roots() {
  const c = compile({ packs: allPacks() });
  const b = c.document(readFileSync(join(ROOT, 'examples/spec18/roots.mkp.md'), 'utf8'), 'roots.mkp.md');
  expect(c.diags.errors.map(formatDiagnostic)).toEqual([]);
  return b!;
}

function find(nodes: VNode[], f: (n: VNode) => boolean): VNode[] {
  const out: VNode[] = [];
  walk(nodes, (n) => f(n) && out.push(n));
  return out;
}

describe('runtime: trace', () => {
  const c = compile({ packs: allPacks() });
  const fc = fixtureCases(c).find((k) => k.widget === 'trace@1' && k.name === 'sum-loop')!;
  const texts = (rt: Runtime) => find(rt.view(), (n) => n.t === 'text').map((n) => (n.p.runs as { v?: string }[]).map((r) => r.v ?? '').join(''));

  it('shows a value as it is, not as Markdown, and every variable has a row at every step', () => {
    const run = [{ line: 1, values: ['2*3*4', '—'] }, { line: 2, values: ['2*3*4', '1'] }];
    const rt = new Runtime(compileCase(c, { ...fc, props: { ...fc.props, run } }).bundle!, { now: () => 0 });
    expect(texts(rt)).toContain('2*3*4');
    expect(texts(rt)).toContain('total');
    expect(texts(rt)).toContain('i');
  });

  it('passes the current line to the code, and marks what changed and what to watch', () => {
    const rt = new Runtime(compileCase(c, fc).bundle!, { now: () => 0 });
    const code = () => find(rt.view(), (n) => n.t === 'code')[0];
    expect(code().p.line).toBe(1);
    rt.set({ pos: 2 });
    expect(code().p.line).toBe(3);
    expect(texts(rt)).toEqual(expect.arrayContaining(['changed', 'watch']));
    expect(find(rt.view(), (n) => n.t === 'grid').map((n) => n.p.tint)).toEqual(expect.arrayContaining(['warn', 'info']));
  });

  it("puts Play between a stepper's arrows, then the track, the count and start over", () => {
    const rt = new Runtime(compileCase(c, fc).bundle!, { now: () => 0 });
    const v = rt.view();
    expect(find(v, (n) => n.t === 'press').map((n) => n.p.label)).toEqual(['previous: step', 'play step', 'next: step', 'start over: step']);
    const steps = find(v, (n) => n.p.control === 'steps')[0];
    const track = steps.kids!.some((k) => k.t === 'range');
    // the frame's status line goes after next
    expect(steps.kids!.map((k) => (k.p.role === 'status' ? 'status' : k.t))).toEqual(track ? ['press', 'press', 'press', 'status', 'range', 'text', 'press'] : ['press', 'press', 'press', 'status', 'text', 'press']);
  });

  it('draws in a frame, its bar in the frame', () => {
    const rt = new Runtime(compileCase(c, fc).bundle!, { now: () => 0 });
    const v = rt.view();
    expect(find(v, (n) => n.t === 'bar')).toEqual([]);
    const frame = find(v, (n) => n.t === 'frame')[0];
    expect(frame.p.kind).toBe('Trace · python');
    expect(frame.slots!.bar[0].p.control).toBe('steps');
    expect(find(v, (n) => n.t === 'pane').length).toBe(2);
  });

  it('starts over from where it is', () => {
    const rt = new Runtime(compileCase(c, fc).bundle!, { now: () => 0 });
    const at = (): unknown => find(rt.view(), (n) => n.t === 'text' && n.key.endsWith('.at'))[0].p.runs;
    expect(rt.press('pos.next')).toBe(true);
    expect(rt.press('pos.next')).toBe(true);
    expect(JSON.stringify(at())).toContain('"3/');
    expect(rt.press('pos.reset')).toBe(true);
    expect(JSON.stringify(at())).toContain('"1/');
  });
});

describe('runtime: roots of unity', () => {
  it('renders the widget with its bar, tabs, canvas and quiz', () => {
    const rt = new Runtime(roots(), { now: () => 0 });
    const v = rt.view();
    expect(rt.warnings).toEqual([]);
    expect(find(v, (n) => n.t === 'error')).toEqual([]);
    expect(find(v, (n) => n.t === 'canvas').length).toBe(1);
    expect(find(v, (n) => n.t === 'bar').length).toBe(1);
    expect(find(v, (n) => n.t === 'quote').length).toBe(1);
    const quiz = find(v, (n) => n.id === 'check');
    expect(quiz.length).toBe(1);
    expect(quiz[0].hidden).toBe(true);
  });
  it('plays k and steps the tour to reveal the quiz', () => {
    const rt = new Runtime(roots(), { now: () => 0 });
    rt.view();
    expect(rt.press('k.play')).toBe(true);
    rt.tick(2100);
    const s = rt.blocks().find((b) => b.def.name === 'roots')!;
    const k = s.get('k') as number;
    expect(k).toBeGreaterThan(0);
    rt.set({ tour: 2 });
    const quiz = find(rt.view(), (n) => n.id === 'check');
    expect(quiz[0].hidden).toBe(false);
    const snap = rt.snapshot();
    const vals = Object.values(snap).find((x) => 'w' in x)!;
    expect((vals.w as { re: number }).re).toBeCloseTo(Math.cos((2 * Math.PI * k) / 5), 9);
  });
});
