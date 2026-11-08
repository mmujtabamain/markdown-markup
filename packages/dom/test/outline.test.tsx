// @vitest-environment jsdom
// mkp-outline: a first paint from the source alone, with each top-level widget's box at the height
// it was last drawn at, and mount(el, bundle, { places: true }) drawing the widgets into those boxes.
import { afterEach, describe, expect, it, vi } from 'vitest';
import { act } from 'react';
import { readdirSync, readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { compile, formatDiagnostic, walkView, Runtime, type IRBundle, type PackSource } from '@mkp/core';
import { heightAt, mergeSizes, mount, outline, places, type MountedDocument, type PlaceSize } from '../src/index';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
const root = join(__dirname, '../../..');

function packOf(dir: string): PackSource {
  const files = new Map<string, Uint8Array>();
  const walk = (d: string, base = ''): void => {
    for (const e of readdirSync(d, { withFileTypes: true })) {
      if (e.isDirectory()) walk(join(d, e.name), `${base}${e.name}/`);
      else files.set(`${base}${e.name}`, new Uint8Array(readFileSync(join(d, e.name))));
    }
  };
  walk(dir);
  return { label: dir, files };
}

describe('places', () => {
  it('numbers every example’s top-level widgets as the compiler does, with no compiler', () => {
    const ex = join(root, 'examples');
    let seen = 0;
    for (const name of readdirSync(ex).filter((n) => existsSync(join(ex, n, 'doc.mkp.md')))) {
      const text = readFileSync(join(ex, name, 'doc.mkp.md'), 'utf8');
      const packDir = join(ex, name, 'pack');
      const packs = existsSync(packDir) ? [packOf(packDir)] : [];
      const beside = join(ex, name, 'doc.mkp');
      const c = compile({ packs });
      const b = c.document(text, `examples/${name}/doc.mkp.md`, undefined, existsSync(beside) ? { docFile: { text: readFileSync(beside, 'utf8'), file: `examples/${name}/doc.mkp` } } : {});
      if (!b) continue;
      const compiled = b.doc.body.filter((n) => typeof n.meta?.place === 'number').map((n) => n.meta!.place);
      expect(places(text).map((p) => p.place), name).toEqual(compiled);
      seen += compiled.length;
    }
    expect(seen).toBeGreaterThan(20);
  });
});

describe('sizes', () => {
  const size: PlaceSize = { place: 0, name: 'plot', at: [[375, 820], [974, 406]] };
  it('takes the height at a width from those measured: along a line between, the nearest outside', () => {
    expect(heightAt(size, 974)).toBe(406);
    expect(heightAt(size, 375)).toBe(820);
    expect(heightAt(size, 674)).toBe(613);
    expect(heightAt(size, 1400)).toBe(406);
    expect(heightAt(size, 320)).toBe(820);
    expect(heightAt(undefined, 500)).toBeUndefined();
  });
  it('merges sizes measured now into those kept: the same width replaced, four widths kept', () => {
    const m = mergeSizes([size], [{ place: 0, name: 'plot', at: [[976, 410]] }, { place: 1, name: 'quiz', at: [[974, 120]] }]);
    expect(m).toEqual([
      { place: 0, name: 'plot', at: [[375, 820], [976, 410]] },
      { place: 1, name: 'quiz', at: [[974, 120]] },
    ]);
    let k = mergeSizes(undefined, []);
    for (const w of [300, 400, 500, 600, 700]) k = mergeSizes(k, [{ place: 0, name: 'plot', at: [[w, 1000 - w]] }]);
    expect(k[0].at.map(([w]) => w)).toEqual([400, 500, 600, 700]);
  });
});

const src = '# A note\n\nSome prose.\n\n```mkp\ncard "A card."\n  in word text\n  column pad=s\n    text word\n  project md = word\n```\n\n```card\nword: one\nsummary: s\n```\n\nMore prose.\n\n:::frame title="Framed"\nInside.\n:::\n\n```card\nword: two\nsummary: s\n```\n';

describe('outline', () => {
  it('reserves each widget’s box at its measured height, quiet, with the prose the host draws', () => {
    const html = outline(src, [{ place: 0, name: 'card', at: [[600, 48]] }, { place: 2, name: 'card', at: [[600, 52]] }], { width: 600, prose: (md) => `<p>${md.replace(/^#.*$/m, '').trim()}</p>` });
    const el = document.createElement('div');
    el.innerHTML = html;
    const boxes = [...el.querySelectorAll<HTMLElement>('[data-mkp-place]')];
    expect(boxes.map((b) => [b.getAttribute('data-mkp-place'), b.getAttribute('data-mkp-place-name'), b.style.height])).toEqual([
      ['0', 'card', '48px'],
      ['1', 'frame', '160px'],
      ['2', 'card', '52px'],
    ]);
    expect(boxes.every((b) => b.getAttribute('aria-hidden') === 'true' && b.textContent === '')).toBe(true);
    expect(el.querySelector('.mkp-outline')!.getAttribute('aria-busy')).toBe('true');
    expect(el.textContent).toContain('More prose.');
    // without a prose renderer: the placeholders only
    const only = document.createElement('div');
    only.innerHTML = outline(src, undefined, { width: 600 });
    expect(only.textContent!.trim()).toBe('');
  });

  let views: MountedDocument[] = [];
  afterEach(() => {
    act(() => views.forEach((v) => v.unmount()));
    views = [];
    document.body.innerHTML = '';
    vi.unstubAllGlobals();
  });

  it('is taken over by mount({ places }): each widget drawn into its box, the host’s prose untouched, and sizes reported', async () => {
    const c = compile({ packs: [] });
    const b = c.document(src, 'doc.mkp.md') as IRBundle;
    expect(c.diags.errors.map(formatDiagnostic)).toEqual([]);
    const el = document.body.appendChild(document.createElement('div'));
    el.innerHTML = outline(src, undefined, { width: 600, prose: (md) => `<p class="host">${md.trim()}</p>` });
    const prose = [...el.querySelectorAll('p.host')];
    // a layout of its own for jsdom: each box 40 px tall, the element 600 px wide
    Object.defineProperty(el, 'clientWidth', { value: 600 });
    vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockReturnValue({ height: 40 } as DOMRect);
    vi.stubGlobal('ResizeObserver', class { constructor(private f: () => void) {} observe() { this.f(); } unobserve() {} disconnect() {} });
    vi.stubGlobal('requestAnimationFrame', (f: FrameRequestCallback) => setTimeout(() => f(0), 0) as unknown as number);
    vi.stubGlobal('cancelAnimationFrame', (h: number) => clearTimeout(h));
    const heard: PlaceSize[][] = [];
    let v!: MountedDocument;
    await act(async () => {
      v = mount(el, b, { places: true, onSizes: (s) => heard.push(s) });
      views.push(v);
      await v.ready;
    });
    // React commits at the end of act: the boxes are then released, and the sizes reported a frame later
    await act(async () => {
      await new Promise((r) => setTimeout(r, 50));
    });
    const boxes = [...el.querySelectorAll<HTMLElement>('.mkp-outline-place')];
    expect(boxes[0].textContent).toBe('one');
    expect(boxes[1].textContent).toContain('Framed');
    expect(boxes[1].textContent).toContain('Inside.');
    expect(boxes[2].textContent).toBe('two');
    expect(boxes.every((x) => x.classList.contains('mkp-root') && x.style.height === '' && !x.hasAttribute('aria-hidden'))).toBe(true);
    // the host's prose is the same elements, never drawn again
    expect([...el.querySelectorAll('p.host')]).toEqual(prose);
    expect(el.querySelector('.mkp-outline')!.hasAttribute('aria-busy')).toBe(false);
    expect(heard.at(-1)).toEqual([
      { place: 0, name: 'card', at: [[600, 40]] },
      { place: 1, name: 'frame', at: [[600, 40]] },
      { place: 2, name: 'card', at: [[600, 40]] },
    ]);
    // one runtime for every widget: the document's state is one
    let n = 0;
    walkView(v.runtime!.view(), () => void n++);
    expect(n).toBeGreaterThan(3);
    expect(v.runtime).toBeInstanceOf(Runtime);
  });
});
