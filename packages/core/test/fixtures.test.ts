// Every fixture case compiles, renders in the runtime without an error boundary, runs its play
// steps, and writes Markdown; every definition has a valid case (spec 11).
import { describe, expect, it } from 'vitest';
import { compile } from '../src/build';
import { formatDiagnostic } from '../src/diag';
import { compileCase, fixtureCases, missingFixtures } from '../src/fixtures';
import { writeMarkdown } from '../src/md';
import { Runtime } from '../src/runtime/runtime';
import { walk, type VNode } from '../src/runtime/view';
import { allPacks } from './helpers';

const c = compile({ packs: allPacks() });
const cases = fixtureCases(c);

describe('packs', () => {
  it('build without errors', () => expect(c.diags.errors.map(formatDiagnostic)).toEqual([]));
  it('every definition has a valid fixture case', () => expect(missingFixtures(c)).toEqual([]));
});

describe.each(cases.map((fc) => [`${fc.pack}/${fc.widget}/${fc.name}`, fc] as const))('%s', (_name, fc) => {
  it('compiles (or fails as expected)', () => {
    const r = compileCase(c, fc);
    if (fc.expect?.errors?.length) expect(r.diags.errors.map((d) => d.code)).toEqual(expect.arrayContaining(fc.expect.errors));
    else expect(r.diags.errors.map(formatDiagnostic)).toEqual([]);
  });
  if (fc.expect?.errors?.length) return;
  it('renders, plays and writes Markdown', () => {
    const { bundle } = compileCase(c, fc);
    const rt = new Runtime(bundle!, { now: () => 0, hosts: fc.hosts ? { '0': fc.hosts } : undefined });
    const errs = (v: VNode[]): string[] => {
      const out: string[] = [];
      walk(v, (n) => n.t === 'error' && out.push(String(n.p.message)));
      return out;
    };
    expect(errs(rt.view())).toEqual([]);
    for (const s of fc.play ?? []) {
      if (s.press) expect(rt.press(s.press), `press ${s.press}`).toBe(true);
      if (s.set) rt.set(s.set);
      if (s.command) rt.widget(0).command(s.command, s.args);
      if (s.wait) for (let t = 0; t < s.wait; t += 50) rt.tick(50);
      expect(errs(rt.view())).toEqual([]);
    }
    expect(rt.warnings.filter((w) => w.code !== 'mkp.arrow-missing')).toEqual([]);
    for (const toggles of [[], ['gfm', 'math', 'mermaid', 'html', 'images']] as const) {
      const md = writeMarkdown(bundle!, { toggles: [...toggles] }).md;
      expect(md.length).toBeGreaterThan(20);
      if (fc.expect?.md?.[toggles.join(',') || 'plain']) expect(md).toBe(fc.expect.md[toggles.join(',') || 'plain']);
    }
  });
});
