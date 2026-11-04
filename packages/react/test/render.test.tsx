// @vitest-environment jsdom
// The web renderer in jsdom: the section-18 document renders with the right roles, and the
// controls drive the runtime.
import { afterEach, describe, expect, it } from 'vitest';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';

afterEach(cleanup);
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { compile, compileCase, fixtureCases, Runtime } from '@mkp/core';
import { BASE_CSS, MkpDocument, NEUTRAL_CSS, MkpProvider, Node, useMkpView } from '../src/index';
import { allPacks, ROOT } from '../../core/test/helpers';

function rootsBundle() {
  const c = compile({ packs: allPacks() });
  return c.document(readFileSync(join(ROOT, 'examples/spec18/roots.mkp.md'), 'utf8'), 'roots.mkp.md')!;
}

describe('@mkp/react', () => {
  it('draws a change at once: a press leaves no old copy behind, and nothing transitions', () => {
    expect(BASE_CSS + NEUTRAL_CSS).not.toMatch(/transition|animation|@keyframes/);
    const { container, getAllByRole } = render(<MkpDocument bundle={rootsBundle()} />);
    const before = container.innerHTML;
    fireEvent.click(getAllByRole('tab')[1]);
    expect(container.innerHTML).not.toBe(before);
    expect(getAllByRole('tab')[1].getAttribute('aria-selected')).toBe('true');
    expect(container.querySelector('.mkp-leaving, .mkp-enter')).toBeNull();
    expect(new Set([...container.querySelectorAll('[data-mkp-key]')].map((e) => e.getAttribute('data-mkp-key'))).size).toBe(container.querySelectorAll('[data-mkp-key]').length);
  });

  it('renders the 18.5 document with roles a screen reader can use', () => {
    const { container, getAllByRole, getByRole } = render(<MkpDocument bundle={rootsBundle()} reducedMotion />);
    expect(container.querySelector('.mkp-error')).toBeNull();
    expect(getAllByRole('tab').map((t) => t.textContent)).toEqual(['Roots', 'Powers']);
    expect(getAllByRole('tab')[0].getAttribute('aria-selected')).toBe('true');
    // the row of tabs is their tablist, and every node names its base widget for providers' styles
    expect(getByRole('tablist').querySelectorAll('[role=tab]').length).toBe(2);
    expect(getAllByRole('tab')[0].getAttribute('data-mkp')).toBe('press');
    expect(getAllByRole('tab')[0].getAttribute('data-kind')).toBe('tab');
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
    // how far along the track the value is (0..4 here), for providers that paint the filled part
    expect((getByRole('slider', { name: 'which root' }) as HTMLElement).style.getPropertyValue('--mkp-range-fill')).toBe('75%');
    expect(rt.blocks().find((b) => b.def.name === 'roots')!.get('k')).toBe(3);
    const spin = getByRole('button', { name: 'multiply the plane by it' });
    act(() => {
      fireEvent.click(spin);
    });
    expect(spin.getAttribute('aria-pressed')).toBe('true');
    expect(container.querySelector('.mkp-error')).toBeNull();
  });
  it("a trace marks the current line, and a variable's row keeps its height whatever it shows", () => {
    const c = compile({ packs: allPacks() });
    const fc = fixtureCases(c).find((k) => k.widget === 'trace@1' && k.name === 'sum-loop')!;
    const bundle = compileCase(c, fc).bundle!;
    const { container } = render(<MkpDocument bundle={bundle} />);
    const marked = () => container.querySelector('.mkp-code-line[aria-current]')?.textContent;
    expect(container.querySelectorAll('.mkp-code-line')).toHaveLength(4);
    expect(marked()).toBe('total = 0');
    fireEvent.click(screen.getByRole('button', { name: 'next: step' }));
    fireEvent.click(screen.getByRole('button', { name: 'next: step' }));
    expect(marked()).toBe('    total = total + i');
    const row = screen.getByText('changed').closest<HTMLElement>('[data-mkp=grid]')!;
    expect(row.textContent).toContain('i');
    expect(row.style.background).toContain('--mkp-tint-warn');
  });

  it('lets a host lay the top-level blocks out itself, each in its own root', () => {
    const bundle = rootsBundle();
    function Host() {
      const nodes = useMkpView();
      return nodes.map((n) => (
        <section key={n.key} className="mkp-root" data-host-block>
          <Node n={n} />
        </section>
      ));
    }
    const { container, getAllByRole } = render(
      <MkpProvider bundle={bundle} reducedMotion>
        <Host />
      </MkpProvider>,
    );
    expect(container.querySelectorAll('[data-host-block]').length).toBe(bundle.doc.body.length);
    expect(getAllByRole('tab').length).toBe(2);
    expect(container.querySelector('.mkp-error')).toBeNull();
    // a box's outline reads a provider's --mkp-stroke-<name> first
    expect(container.querySelector('[data-mkp=stack][style*="border"]')?.getAttribute('style')).toMatch(/var\(--mkp-stroke-\w+, var\(--mkp-color-\w+\)\)/);
  });
});
