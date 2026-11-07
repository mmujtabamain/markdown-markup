// @vitest-environment jsdom
// mount() from mkp-dom: the maths engine only for a document with maths to draw, and a first paint
// taken over in place rather than drawn again.
import { afterEach, describe, expect, it, vi } from 'vitest';
import { act } from 'react';
import { compile, formatDiagnostic, MathsEngine, type IRBundle } from '@mkp/core';
import { firstPaint } from '@mkp/page';
import { mount, type MountedDocument } from '../src/index';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const counter = '```mkp\ncounter "A number."\n  var n int = 0\n  press label="up" id=up\n    text "Up: \\val{n}"\n    @click set n=(n + 1)\n  project md = "n"\n```\n\n```counter\nsummary: s\n```\n';

function bundle(src: string): IRBundle {
  const c = compile({ packs: [] });
  const b = c.document(src, 'doc.mkp.md');
  if (!b || c.diags.errors.length) throw new Error(c.diags.errors.map(formatDiagnostic).join('\n'));
  return b;
}

let views: MountedDocument[] = [];
afterEach(() => {
  act(() => views.forEach((v) => v.unmount()));
  views = [];
  document.body.innerHTML = '';
  vi.restoreAllMocks();
});

async function mounted(el: HTMLElement, b: IRBundle, opts: Parameters<typeof mount>[2] = {}): Promise<MountedDocument> {
  let v!: MountedDocument;
  await act(async () => {
    v = mount(el, b, opts);
    views.push(v);
    await v.ready;
  });
  return v;
}

describe('mount', () => {
  it('draws a document with no maths without loading the maths engine', async () => {
    const create = vi.spyOn(MathsEngine, 'create');
    const el = document.body.appendChild(document.createElement('div'));
    const v = await mounted(el, bundle(counter));
    expect(create).not.toHaveBeenCalled();
    expect(el.textContent).toContain('Up: 0');
    expect(v.runtime).not.toBeNull();
  });

  it('loads the engine for a document whose maths the build has not typeset', async () => {
    const create = vi.spyOn(MathsEngine, 'create');
    const el = document.body.appendChild(document.createElement('div'));
    await mounted(el, bundle('# Hi\n\nEuler: $e^{i\\pi} = -1$.\n'));
    expect(create).toHaveBeenCalledTimes(1);
    expect(el.querySelector('svg')).not.toBeNull();
  }, 60000);

  it('passes tokens to the document', async () => {
    const el = document.body.appendChild(document.createElement('div'));
    await mounted(el, bundle(counter), { tokens: { space: { m: { value: 12 } } } });
    expect(el.querySelector('style')?.textContent).toContain('--mkp-space-m: 12px;');
  });

  it('takes over a first paint in place: the same elements, still live, and nothing drawn again', async () => {
    const b = bundle(counter);
    const el = document.body.appendChild(document.createElement('div'));
    el.innerHTML = firstPaint(b);
    const root = el.querySelector('.mkp-root');
    const press = el.querySelector<HTMLElement>('[data-mkp-id=up]');
    expect(press?.textContent).toBe('Up: 0');
    const warn = vi.spyOn(console, 'warn');
    const error = vi.spyOn(console, 'error');
    await mounted(el, b, { hydrate: true });
    expect(el.querySelector('.mkp-root')).toBe(root);
    expect(el.querySelector('[data-mkp-id=up]')).toBe(press);
    expect(warn).not.toHaveBeenCalled();
    expect(error).not.toHaveBeenCalled();
    act(() => press!.click());
    expect(press!.textContent).toBe('Up: 1');
  });

  it('draws over a first paint that is not this bundle’s, and says so', async () => {
    const el = document.body.appendChild(document.createElement('div'));
    el.innerHTML = firstPaint(bundle('# Another document\n'));
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    vi.spyOn(console, 'error').mockImplementation(() => {});
    await mounted(el, bundle(counter), { hydrate: true });
    expect(el.textContent).toContain('Up: 0');
    expect(el.textContent).not.toContain('Another document');
    expect(warn.mock.calls.some((c) => String(c[0]).includes('the first paint did not match'))).toBe(true);
  });
});
