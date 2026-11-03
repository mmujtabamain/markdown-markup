// @vitest-environment jsdom
// The web renderer in jsdom: the section-18 document renders with the right roles, and the
// controls drive the runtime.
import { afterEach, describe, expect, it } from 'vitest';
import { act, cleanup, fireEvent, render } from '@testing-library/react';

afterEach(cleanup);
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { compile, Runtime } from '@mkp/core';
import { MkpDocument } from '../src/index';
import { allPacks, ROOT } from '../../core/test/helpers';

function rootsBundle() {
  const c = compile({ packs: allPacks() });
  return c.document(readFileSync(join(ROOT, 'examples/spec18/roots.mkp.md'), 'utf8'), 'roots.mkp.md')!;
}

describe('@mkp/react', () => {
  it('renders the 18.5 document with roles a screen reader can use', () => {
    const { container, getAllByRole, getByRole } = render(<MkpDocument bundle={rootsBundle()} reducedMotion />);
    expect(container.querySelector('.mkp-error')).toBeNull();
    expect(getAllByRole('tab').map((t) => t.textContent)).toEqual(['Roots', 'Powers']);
    expect(getAllByRole('tab')[0].getAttribute('aria-selected')).toBe('true');
    expect(getByRole('toolbar', { name: 'controls' })).toBeTruthy();
    expect(getByRole('slider', { name: 'which root' })).toBeTruthy();
    expect(container.querySelector('blockquote[role="note"]')?.textContent).toContain('Every root lies on the unit circle.');
    expect(container.querySelector('.mkp-canvas svg circle')).toBeTruthy();
    expect(container.querySelector('[data-mkp-src]')?.getAttribute('data-mkp-src')).toMatch(/:\d+:\d+$/);
  });
  it('switches tabs, moves the slider and toggles state through the runtime', () => {
    const rt = new Runtime(rootsBundle(), { reducedMotion: true });
    const { getAllByRole, getByRole, container } = render(<MkpDocument bundle={rt.bundle} runtime={rt} reducedMotion />);
    act(() => {
      fireEvent.click(getAllByRole('tab')[1]);
    });
    expect(getAllByRole('tab')[1].getAttribute('aria-selected')).toBe('true');
    act(() => {
      fireEvent.change(getByRole('slider', { name: 'which root' }), { target: { value: '3' } });
    });
    expect(rt.blocks().find((b) => b.def.name === 'roots')!.get('k')).toBe(3);
    const spin = getByRole('button', { name: 'multiply the plane by it' });
    act(() => {
      fireEvent.click(spin);
    });
    expect(spin.getAttribute('aria-pressed')).toBe('true');
    expect(container.querySelector('.mkp-error')).toBeNull();
  });
});
