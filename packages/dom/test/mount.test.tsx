// @vitest-environment jsdom
// mount() from mkp-dom: the maths engine only for a document with maths to draw, and a first paint
// taken over in place rather than drawn again.
import { afterEach, describe, expect, it, vi } from 'vitest';
import { act } from 'react';
import { compile, formatDiagnostic, MathsEngine, type IRBundle } from '@mkp/core';
import { firstPaint } from '@mkp/page';
import { mount, type DomExtern, type MountedDocument } from '../src/index';

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

describe('mount, styles: external', () => {
  it('takes over a first paint drawn without MKP’s stylesheet, in place, when it is told the same', async () => {
    const b = bundle(counter);
    const el = document.body.appendChild(document.createElement('div'));
    const full = firstPaint(b);
    el.innerHTML = firstPaint(b, { styles: 'external' });
    expect(el.innerHTML.length).toBeLessThan(full.length / 3);
    expect(el.querySelector('style')!.textContent).not.toContain('.mkp-frame');
    const press = el.querySelector('[data-mkp-id=up]');
    const warn = vi.spyOn(console, 'warn');
    const error = vi.spyOn(console, 'error');
    await mounted(el, b, { hydrate: true, styles: 'external' });
    expect(el.querySelector('[data-mkp-id=up]')).toBe(press);
    expect(warn).not.toHaveBeenCalled();
    expect(error).not.toHaveBeenCalled();
  });
});

describe('mount, a host’s externs', () => {
  const enc = new TextEncoder();
  const pack = {
    label: 'p',
    files: new Map<string, Uint8Array>([
      ['manifest.mkp', enc.encode('pack p@1 "P."\n  requires core@1\n  provides accordion counted\n')],
      ['accordion.mkp', enc.encode('extern accordion@1 "A section, drawn by the app."\n  in title text "its heading"\n  in body slot\n  out toggled "opened or closed"\n\ncounted@1 "Counts its accordion’s toggles."\n  var n int = 0\n  column\n    accordion title=(if(n > 0, "Details again", "Details"))\n      text "Inside: \\val{n}"\n      @toggled set n=(n + 1)\n  project md = "counted"\n')],
      ['counted.fixture.json', enc.encode(JSON.stringify({ widget: 'counted@1', cases: { one: { props: {}, summary: 'One.' } } }))],
    ]),
  };
  const b = (() => {
    const c = compile({ packs: [pack] });
    const x = c.document('```counted\nsummary: s\n```\n', 'doc.mkp.md');
    if (!x || c.diags.errors.length) throw new Error(c.diags.errors.map(formatDiagnostic).join('\n'));
    return x;
  })();

  it('lets the page draw it once, gives it new inputs through update (its own state kept), and cleans up', async () => {
    const log: string[] = [];
    const draw: DomExtern = (box, { props, slot, dispatch }) => {
      const head = document.createElement('button');
      head.textContent = String(props.title);
      // the page's own state: how often it was opened, never seen by the document
      let opened = 0;
      head.onclick = () => {
        opened++;
        dispatch('toggled');
      };
      box.append(head, slot);
      log.push('draw');
      return {
        update: (p) => {
          head.textContent = `${String(p.props.title)} (${opened})`;
          log.push('update');
        },
        destroy: () => log.push('destroy'),
      };
    };
    const el = document.body.appendChild(document.createElement('div'));
    const v = await mounted(el, b, { externs: { 'p:accordion@1': draw } });
    const box = el.querySelector<HTMLElement>('[data-mkp-extern="p:accordion@1"]')!;
    expect(box.querySelector('button')!.textContent).toBe('Details');
    expect(box.querySelector('.mkp-extern-slot')!.textContent).toBe('Inside: 0');
    act(() => box.querySelector('button')!.click());
    // the document ran its handler; the page was given the new title, and kept its own count
    expect(box.querySelector('.mkp-extern-slot')!.textContent).toBe('Inside: 1');
    expect(box.querySelector('button')!.textContent).toBe('Details again (1)');
    expect(log).toEqual(['draw', 'update']);
    act(() => v.unmount());
    views = [];
    expect(log).toEqual(['draw', 'update', 'destroy']);
  });

  it('leaves an empty box in a first paint, which mount takes over and fills', async () => {
    const draw: DomExtern = (box, { slot }) => void box.append(slot);
    const el = document.body.appendChild(document.createElement('div'));
    el.innerHTML = firstPaint(b, { externs: { 'p:accordion@1': draw } });
    expect(el.querySelector('[data-mkp-extern="p:accordion@1"]')!.innerHTML).toBe('');
    const warn = vi.spyOn(console, 'warn');
    const error = vi.spyOn(console, 'error');
    await mounted(el, b, { hydrate: true, externs: { 'p:accordion@1': draw } });
    expect(warn).not.toHaveBeenCalled();
    expect(error).not.toHaveBeenCalled();
    expect(el.querySelector('[data-mkp-extern="p:accordion@1"] .mkp-extern-slot')!.textContent).toBe('Inside: 0');
  });
});

describe('mount, a host’s icons', () => {
  const icons = bundle('```mkp\nicons "Two icons."\n  row\n    icon name=help label="Help"\n    icon name=info tone=accent\n  project md = "i"\n```\n\n```icons\nsummary: s\n```\n');
  const HELP = '<svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="10"></circle></svg>';

  it('puts an SVG string in the box, for one name; the others keep MKP’s symbol', async () => {
    const el = document.body.appendChild(document.createElement('div'));
    await mounted(el, icons, { icons: { help: HELP } });
    const help = el.querySelector<HTMLElement>('.mkp-icon[data-name=help]')!;
    expect(help.querySelector('.mkp-icon-host')!.innerHTML).toBe(HELP);
    expect(help.textContent).toBe('');
    expect(help.getAttribute('aria-label')).toBe('Help');
    expect(el.querySelector('.mkp-icon[data-name=info]')!.textContent).toBe('ⓘ');
  });

  it('calls a render function with the box and the icon’s props, and its cleanup on unmount', async () => {
    const seen: string[] = [];
    const cleaned: string[] = [];
    const draw = (box: HTMLElement, p: { name: string; size: string; tone: string; color: string; label?: string }) => {
      seen.push(`${p.name} ${p.size} ${p.tone} ${p.color} ${p.label ?? '-'}`);
      box.textContent = `[${p.name}]`;
      return () => cleaned.push(p.name);
    };
    const el = document.body.appendChild(document.createElement('div'));
    const v = await mounted(el, icons, { icons: draw });
    expect(seen.sort()).toEqual(['help normal none currentColor Help', 'info normal accent var(--mkp-color-accent) -']);
    expect(el.querySelector('.mkp-icon[data-name=info]')!.textContent).toBe('[info]');
    // other options: the same icons are not drawn again
    act(() => v.update({ theme: 'dark' }));
    expect(seen).toHaveLength(2);
    act(() => v.unmount());
    views = [];
    expect(cleaned.sort()).toEqual(['help', 'info']);
  });

  it('takes over a first paint drawn with the same icons, in place, and fills a render function’s box then', async () => {
    const opts = { icons: { help: HELP, info: (box: HTMLElement) => void (box.textContent = 'i') } };
    const el = document.body.appendChild(document.createElement('div'));
    el.innerHTML = firstPaint(icons, opts);
    expect(el.querySelector('.mkp-icon[data-name=help] .mkp-icon-host')!.innerHTML).toBe(HELP);
    expect(el.querySelector('.mkp-icon[data-name=info] .mkp-icon-host')!.textContent).toBe('');
    const root = el.querySelector('.mkp-root');
    const warn = vi.spyOn(console, 'warn');
    const error = vi.spyOn(console, 'error');
    await mounted(el, icons, { ...opts, hydrate: true });
    expect(el.querySelector('.mkp-root')).toBe(root);
    expect(warn).not.toHaveBeenCalled();
    expect(error).not.toHaveBeenCalled();
    expect(el.querySelector('.mkp-icon[data-name=info] .mkp-icon-host')!.textContent).toBe('i');
  });
});

describe('mount, an older bundle', () => {
  it('migrates a bundle with no stamp (0.2.1) as it loads, and says what changed', async () => {
    const b = bundle('```mkp\nq "A widget."\n  zoom\n    text "wide"\n  project md = "q"\n```\n\n```q\nsummary: s\n```\n');
    delete (b as { mkp?: string }).mkp;
    const heard: string[] = [];
    const el = document.body.appendChild(document.createElement('div'));
    const v = await mounted(el, b, { migrate: { keep: ['zoom-minscale'], onWarn: (w) => heard.push(...w.map((x) => x.code)) } });
    expect(heard).toEqual(['mkp.migrate-kept']);
    expect(el.textContent).toContain('wide');
    expect(v.runtime).not.toBeNull();
  });
});
