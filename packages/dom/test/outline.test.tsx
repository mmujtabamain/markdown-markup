// @vitest-environment jsdom
// mkp-outline: a first paint from the source alone, with each top-level widget's box at the size it
// says it starts at, and mount(el, bundle, { places: true }) drawing the widgets into those boxes.
import { afterEach, describe, expect, it, vi } from 'vitest';
import { act } from 'react';
import { readdirSync, readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { compile, formatDiagnostic, walkView, Runtime, type IRBundle, type PackSource } from '@mkp/core';
import { mount, outline, placeholder, places, type MountedDocument, type Place } from '../src/index';

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
  const at = (size: Place['size'], defaults?: Place['size']): string => {
    const el = document.createElement('div');
    el.innerHTML = placeholder({ place: 0, name: 'w', line: 1, size }, defaults);
    return (el.firstElementChild as HTMLElement).getAttribute('style')!;
  };
  it('reads minwidth, minheight and aspect written on a block, a ::: line and a {…} line', () => {
    const text = '```plot\nminwidth: 480\naspect: 16/9 # wide\nsummary: s\n```\n\n:::card minheight=120 aspect=(1.5)\nHi.\n:::\n\n```quiz\nsummary: s\n```\n{minheight=200}\n';
    expect(places(text).map((p) => p.size)).toEqual([{ minwidth: 480, aspect: 16 / 9 }, { minheight: 120, aspect: 1.5 }, { minheight: 200 }]);
  });
  it('gives each pair its box: a width and a shape, kept as the page narrows', () => {
    expect(at({ minwidth: 480, minheight: 240 })).toBe('width:min(480px,100%);aspect-ratio:2');
    expect(at({ minwidth: 480, aspect: 1.6 })).toBe('width:min(480px,100%);aspect-ratio:1.6');
    expect(at({ minheight: 200, aspect: 2 })).toBe('width:min(400px,100%);aspect-ratio:2');
  });
  it('gives what one can: a shape at the column’s width, a height, or a width with the default height', () => {
    expect(at({ aspect: 4 / 3 })).toBe('aspect-ratio:1.3333');
    expect(at({ minheight: 300 })).toBe('height:300px');
    expect(at({ minwidth: 300 })).toBe('width:min(300px,100%);height:160px');
    expect(at({})).toBe('height:160px');
  });
  it('lets the widget’s own defaults fill in up to two, what the use wrote winning', () => {
    expect(at({}, { minheight: 48 })).toBe('height:48px');
    expect(at({ aspect: 2 }, { minheight: 100, aspect: 1 })).toBe('width:min(200px,100%);aspect-ratio:2');
    expect(at({ minwidth: 300, minheight: 100 }, { aspect: 1 })).toBe('width:min(300px,100%);aspect-ratio:3');
  });
});

const src = '# A note\n\nSome prose.\n\n```mkp\ncard "A card."\n  in word text\n  column pad=s\n    text word\n  project md = word\n```\n\n```card\nword: one\nsummary: s\n```\n\nMore prose.\n\n:::frame title="Framed"\nInside.\n:::\n\n```card\nword: two\nminwidth: 480\naspect: 2\nsummary: s\n```\n';

describe('outline', () => {
  it('reserves each widget’s box at the size it starts at, quiet, with the prose the host draws', () => {
    const html = outline(src, { sizes: { card: { minheight: 48 } }, prose: (md) => `<p>${md.replace(/^#.*$/m, '').trim()}</p>` });
    const el = document.createElement('div');
    el.innerHTML = html;
    const boxes = [...el.querySelectorAll<HTMLElement>('[data-mkp-place]')];
    expect(boxes.map((b) => [b.getAttribute('data-mkp-place'), b.getAttribute('data-mkp-place-name'), b.getAttribute('style')])).toEqual([
      ['0', 'card', 'height:48px'],
      ['1', 'frame', 'height:160px'],
      ['2', 'card', 'width:min(480px,100%);aspect-ratio:2'],
    ]);
    expect(boxes.every((b) => b.getAttribute('aria-hidden') === 'true' && b.textContent === '')).toBe(true);
    expect(el.querySelector('.mkp-outline')!.getAttribute('aria-busy')).toBe('true');
    expect(el.textContent).toContain('More prose.');
    // without a prose renderer: the placeholders only
    const only = document.createElement('div');
    only.innerHTML = outline(src);
    expect(only.textContent!.trim()).toBe('');
  });

  let views: MountedDocument[] = [];
  afterEach(() => {
    act(() => views.forEach((v) => v.unmount()));
    views = [];
    document.body.innerHTML = '';
    vi.unstubAllGlobals();
  });

  it('is taken over by mount({ places }): each widget drawn into its box, its size then its own, the host’s prose untouched', async () => {
    const c = compile({ packs: [] });
    const b = c.document(src, 'doc.mkp.md') as IRBundle;
    expect(c.diags.errors.map(formatDiagnostic)).toEqual([]);
    const el = document.body.appendChild(document.createElement('div'));
    el.innerHTML = outline(src, { prose: (md) => `<p class="host">${md.trim()}</p>` });
    const prose = [...el.querySelectorAll('p.host')];
    let v!: MountedDocument;
    await act(async () => {
      v = mount(el, b, { places: true });
      views.push(v);
      await v.ready;
    });
    // React commits at the end of act: the boxes are then released
    await act(async () => {
      await new Promise((r) => setTimeout(r, 50));
    });
    const boxes = [...el.querySelectorAll<HTMLElement>('.mkp-outline-place')];
    expect(boxes[0].textContent).toBe('one');
    expect(boxes[1].textContent).toContain('Framed');
    expect(boxes[1].textContent).toContain('Inside.');
    expect(boxes[2].textContent).toBe('two');
    expect(boxes.every((x) => x.classList.contains('mkp-root') && !x.style.height && !x.style.width && !x.style.aspectRatio && !x.hasAttribute('aria-hidden'))).toBe(true);
    // the widget keeps its aspect where it is drawn
    expect(boxes[2].querySelector<HTMLElement>('[data-mkp-place="2"]')!.style.aspectRatio).toBe('2');
    expect(boxes[0].querySelector<HTMLElement>('[data-mkp-place="0"]')!.style.aspectRatio).toBe('');
    // the host's prose is the same elements, never drawn again
    expect([...el.querySelectorAll('p.host')]).toEqual(prose);
    expect(el.querySelector('.mkp-outline')!.hasAttribute('aria-busy')).toBe(false);
    // one runtime for every widget: the document's state is one
    let n = 0;
    walkView(v.runtime!.view(), () => void n++);
    expect(n).toBeGreaterThan(3);
    expect(v.runtime).toBeInstanceOf(Runtime);
  });
});
