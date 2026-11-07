// @vitest-environment jsdom
// The Migrations tab: a part for every release's step, built from the step itself, with its before
// and after (the after is what mkp migrate writes: packages/cli/test/migrate.test.ts holds them to it).
import { describe, expect, it } from 'vitest';
import { act, render } from '@testing-library/react';
import { compile, STEPS } from '@mkp/core';
import { exampleOf, Migrations } from '@/site/Migrations';

describe('Migrations', () => {
  it('has a part for every step, newest first, listing each of its changes, under the header with Migrations marked', async () => {
    const { container } = render(<Migrations />);
    await act(async () => {
      await new Promise((r) => setTimeout(r, 30));
    });
    expect(container.querySelector('[data-site-section="migrations"]')?.getAttribute('aria-current')).toBe('page');
    expect([...container.querySelectorAll('[data-step]')].map((e) => e.getAttribute('data-step'))).toEqual([...STEPS].reverse().map((s) => s.to));
    for (const s of STEPS) for (const c of s.changes) expect(container.querySelector(`[data-step="${s.to}"] [data-change="${c.id}"]`), c.id).not.toBeNull();
    expect(container.querySelector('[data-migrated-drawing] .mkp-root')).not.toBeNull();
    for (const s of STEPS.filter((x) => !x.renames.length && !x.changes.length && !x.removes.length)) expect(container.querySelector(`[data-step="${s.to}"] [data-change="none"]`), s.to).not.toBeNull();
  });
  it('shows a before and after for the newest step that changes anything, the after compiling with this release', () => {
    // a step that changes nothing (0.2.3) only restamps, so it has no example; one that changes something must
    const changing = STEPS.filter((s) => s.renames.length || s.changes.length || s.removes.length);
    for (const s of STEPS.filter((x) => !changing.includes(x))) expect(exampleOf(s.to)).toBeNull();
    const ex = exampleOf(changing[changing.length - 1].to)!;
    expect(ex).not.toBeNull();
    const c = compile({ packs: [] });
    c.document(ex.after, 'after.mkp.md');
    expect(c.diags.errors).toEqual([]);
    // the before is written for the release before: this one refuses it, which is why it migrates
    const c2 = compile({ packs: [] });
    c2.document(ex.before, 'before.mkp.md');
    expect(c2.diags.errors.length).toBeGreaterThan(0);
  });
});
