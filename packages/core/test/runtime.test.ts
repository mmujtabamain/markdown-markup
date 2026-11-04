import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { compile } from '../src/build';
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
