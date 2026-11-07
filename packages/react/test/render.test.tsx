// @vitest-environment jsdom
// The web renderer in jsdom, on small documents that define their widgets inline: the four
// containers and their props, text, press, field, code and maths, the canvas, the runtime's
// control rows, the reader's width and the stylesheet.
import { afterEach, describe, expect, it } from 'vitest';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { compile, formatDiagnostic, Runtime, type IRBundle } from '@mkp/core';
import { BASE_CSS, keepInView, MkpDocument, MkpProvider, NEUTRAL_CSS, Node, placeCanvasLabels, SHELL_CSS, tokenCss, useMkpView, widthClass } from '../src/index';

afterEach(cleanup);

const fence = (b: string): string => '```mkp\n' + b + '\n```\n';
const block = (name: string, yaml = 'summary: s'): string => '```' + name + '\n' + yaml + '\n```\n';

/** A document with one widget, w, defined inline from its lines, a block using it, and any Markdown after. */
function doc(lines: string[], after = ''): IRBundle {
  const text = fence(['w "A test widget."', ...lines.map((l) => '  ' + l), '  project md = "w"'].join('\n')) + block('w') + after;
  const c = compile({ packs: [] });
  const b = c.document(text, 'doc.mkp.md');
  if (!b || c.diags.errors.length) throw new Error(c.diags.errors.map(formatDiagnostic).join('\n'));
  return b;
}

function draw(b: IRBundle) {
  const rt = new Runtime(b, { now: () => 0, reducedMotion: true });
  return { rt, ...render(<MkpDocument bundle={b} runtime={rt} reducedMotion />) };
}

const one = (c: HTMLElement, sel: string): HTMLElement => c.querySelector<HTMLElement>(sel)!;

const tabs = [
  'var at text = "a"',
  'row',
  '  press kind=tab selected=(at == "a")',
  '    text "Roots"',
  '    @click set at="a"',
  '  press kind=tab selected=(at == "b")',
  '    text "Powers"',
  '    @click set at="b"',
  'text "now \\val{at}"',
];

describe('@mkp/react', () => {
  it('draws a change at once: a press leaves no old copy behind, and nothing transitions', () => {
    expect(BASE_CSS + NEUTRAL_CSS + SHELL_CSS).not.toMatch(/transition|animation|@keyframes/);
    const { container, getAllByRole } = draw(doc(tabs));
    const before = container.innerHTML;
    fireEvent.click(getAllByRole('tab')[1]);
    expect(container.innerHTML).not.toBe(before);
    expect(getAllByRole('tab')[1].getAttribute('aria-selected')).toBe('true');
    expect(container.textContent).toContain('now b');
    expect(container.querySelector('.mkp-leaving, .mkp-enter')).toBeNull();
    expect(new Set([...container.querySelectorAll('[data-mkp-key]')].map((e) => e.getAttribute('data-mkp-key'))).size).toBe(container.querySelectorAll('[data-mkp-key]').length);
  });

  it('gives a row of tabs its tablist, and every node names its base widget and where it was written', () => {
    const { container, getAllByRole, getByRole } = draw(doc(tabs));
    expect(container.querySelector('.mkp-error')).toBeNull();
    expect(getByRole('tablist').querySelectorAll('[role=tab]').length).toBe(2);
    expect(getAllByRole('tab').map((t) => t.textContent)).toEqual(['Roots', 'Powers']);
    expect(getAllByRole('tab')[0].getAttribute('data-mkp')).toBe('press');
    expect(getAllByRole('tab')[0].getAttribute('data-kind')).toBe('tab');
    expect(getByRole('tablist').getAttribute('data-mkp')).toBe('row');
    expect(container.querySelector('[data-mkp-src]')?.getAttribute('data-mkp-src')).toMatch(/^doc\.mkp\.md:\d+:\d+$/);
  });

  it('lets a host lay the top-level blocks out itself, each in its own root', () => {
    const bundle = doc(tabs, '\nA paragraph after.\n');
    function Host() {
      return useMkpView().map((n) => (
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
  });
});

describe('the containers', () => {
  it('column: children down it, aligned across and centred down it (safely, by the stylesheet)', () => {
    const { container } = draw(doc(['column align=center justify=center gap=s pad=m', '  text "a"', '  text "b"']));
    const col = one(container, '[data-mkp=column]');
    expect(col.style.display).toBe('flex');
    expect(col.style.flexDirection).toBe('column');
    expect(col.style.alignItems).toBe('center');
    expect(col.style.gap).toBe('var(--mkp-space-s)');
    expect(col.style.padding).toBe('var(--mkp-space-m)');
    expect(col.getAttribute('data-flow')).toBe('column');
    expect(col.getAttribute('data-justify')).toBe('center');
    expect(col.style.justifyContent).toBe('');
  });

  it('row: wraps unless told not to, and centres safely so an overflowing row keeps its start (GAPS 120)', () => {
    const { container } = draw(doc(['row justify=center wrap=false', '  text "a"', 'row justify=between', '  text "b"']));
    const [a, b] = container.querySelectorAll<HTMLElement>('[data-mkp=row]');
    expect(a.style.flexWrap).toBe('nowrap');
    expect(a.getAttribute('data-justify')).toBe('center');
    expect(BASE_CSS).toContain('[data-justify=center] { justify-content: center; justify-content: safe center; }');
    expect(b.style.flexWrap).toBe('wrap');
    expect(b.style.justifyContent).toBe('space-between');
  });

  it('grid: column tracks, or a number of equal shares (GAPS 98, 148)', () => {
    const { container } = draw(doc(['grid cols=[auto, 1fr, 6ch, fit, m] justify=center', '  text "a"', 'grid cols=3', '  text "b"']));
    const [a, b] = container.querySelectorAll<HTMLElement>('[data-mkp=grid]');
    expect(a.style.gridTemplateColumns).toBe('auto minmax(0, 1fr) 6ch fit-content(100%) var(--mkp-size-m, auto)');
    expect(a.style.justifyItems).toBe('center');
    expect(b.style.gridTemplateColumns).toBe('minmax(0, 1fr) minmax(0, 1fr) minmax(0, 1fr)');
  });

  it('stack: layers in one cell, the last on top, placed by align and justify (GAPS 79)', () => {
    const { container } = draw(doc(['stack align=end justify=center', '  text "under"', '  text "over"']));
    const st = one(container, '[data-mkp=stack]');
    expect(st.style.display).toBe('grid');
    expect(st.style.alignItems).toBe('end');
    expect(st.style.justifyItems).toBe('center');
    expect(st.hasAttribute('data-layers')).toBe(true);
    expect([...st.children].map((k) => k.textContent)).toEqual(['under', 'over']);
    expect(BASE_CSS).toContain('[data-layers] > * { grid-area: 1 / 1;');
  });

  it('width=fit, minwidth and a child’s self= (GAPS 19, 41, 142)', () => {
    const { container } = draw(doc(['column width=fit minwidth=m', '  text "a" self=end', 'row width=fill', '  text "b"']));
    const col = one(container, '[data-mkp=column]');
    expect(col.style.width).toBe('fit-content');
    expect(col.style.maxWidth).toBe('100%');
    expect(col.style.minWidth).toBe('var(--mkp-size-m)');
    expect(one(col, '[data-mkp=text]').style.alignSelf).toBe('flex-end');
    expect(one(container, '[data-mkp=row]').style.width).toBe('100%');
  });

  it('scroll=x: the outline stays put and the content scrolls inside it, never narrower than minwidth (GAPS 149)', () => {
    const { container } = draw(doc(['row scroll=x wrap=false stroke=line pad=s', '  text "a"', 'column scroll=x minwidth=l', '  text "b"']));
    const row = one(container, '[data-mkp=row]');
    expect(row.getAttribute('data-scroll')).toBe('x');
    expect(row.style.overflowX).toBe('auto');
    expect(row.style.border).toContain('var(--mkp-stroke-line, var(--mkp-color-line))');
    const inner = one(row, '[data-mkp-inner]');
    expect(inner.style.display).toBe('flex');
    expect(inner.style.padding).toBe('var(--mkp-space-s)');
    expect(inner.style.width).toBe('max-content');
    expect(inner.textContent).toBe('a');
    expect(one(one(container, '[data-mkp=column]'), '[data-mkp-inner]').style.minWidth).toBe('var(--mkp-size-l)');
  });

  it('a border on the sides edge= names, at its weight, in its line (GAPS 154)', () => {
    const { container } = draw(doc(['column stroke=line edge=bottom weight=thick line=dashed', '  text "a"', 'row stroke=muted edge=x', '  text "b"', 'grid stroke=accent', '  text "c"']));
    const col = one(container, '[data-mkp=column]');
    expect(col.style.borderBottom).toBe('4px dashed var(--mkp-stroke-line, var(--mkp-color-line))');
    expect(col.style.borderTop).toBe('');
    const row = one(container, '[data-mkp=row]');
    expect(row.style.borderLeft).toBe('1px solid var(--mkp-stroke-muted, var(--mkp-color-muted))');
    expect(row.style.borderRight).toBe(row.style.borderLeft);
    expect(row.style.borderTop).toBe('');
    expect(one(container, '[data-mkp=grid]').style.border).toBe('1px solid var(--mkp-stroke-accent, var(--mkp-color-accent))');
  });

  it('a press on a container’s own background raises click; one on a child does not (GAPS 125)', () => {
    const { container } = draw(doc(['var n int = 0', 'column pad=m', '  text "count \\val{n}"', '  @click set n=(n + 1)']));
    const col = one(container, '[data-mkp=column]');
    fireEvent.click(col);
    expect(container.textContent).toContain('count 1');
    fireEvent.click(one(col, '[data-mkp=text]'));
    expect(container.textContent).toContain('count 1');
    // no role and no key handling: it is the pointer's only
    expect(col.getAttribute('role')).toBeNull();
    fireEvent.keyDown(col, { key: 'Enter' });
    expect(container.textContent).toContain('count 1');
  });

  it('a pane in a column keeps its height (GAPS 145)', () => {
    expect(BASE_CSS).toContain('[data-flow=column] > .mkp-pane { flex: 1 1 auto; }');
  });
});

describe('a zoom’s height', () => {
  it('is its content’s, between its minheight (none: room for its tools) and its maxheight (l by default)', () => {
    const { container } = draw(doc(['column gap=s', '  zoom', '    text "a"', '  zoom minheight=s maxheight=m', '    text "b"', '  zoom maxheight=none', '    text "c"']));
    const zooms = [...container.querySelectorAll<HTMLElement>('.mkp-zoom')];
    expect(zooms.map((z) => [z.style.minHeight, z.style.maxHeight])).toEqual([
      ['', 'var(--mkp-size-l)'],
      ['var(--mkp-size-s)', 'var(--mkp-size-m)'],
      ['', ''],
    ]);
    // with no minheight, the stylesheet keeps room for the tools, when it shows them
    expect(SHELL_CSS).toContain('.mkp-zoom { position: relative; overflow: hidden; }');
    expect(SHELL_CSS).toContain('.mkp-zoom[data-tools] { min-height: calc(var(--mkp-space-s) * 2 + 40px); }');
  });

  it('shows its lock only when there is something to zoom or pan: shrunk to fit, clipped, a drawing or a picture', () => {
    // a view 300 wide and 160 tall; what a zoom holds is 100 wide and 40 tall, unless it says "wide"
    // (600) or "tall" (500); stretched, it is never narrower than its view
    const canvasLines = ['canvas x=0..10 y=0..10 size=s', '  layer', '    circle (5, 5) 1'];
    const names = ['clientWidth', 'clientHeight', 'offsetWidth', 'offsetHeight'] as const;
    const was = names.map((k) => [k, Object.getOwnPropertyDescriptor(k.startsWith('client') ? Element.prototype : HTMLElement.prototype, k)] as const);
    const is = (el: Element, c: string): boolean => el.classList.contains(c);
    const say = (el: Element, w: string): boolean => (el.textContent ?? '').includes(w);
    Object.defineProperty(Element.prototype, 'clientWidth', { configurable: true, get(this: Element) { return is(this, 'mkp-zoom') || is(this, 'mkp-fit') ? 300 : 0; } });
    Object.defineProperty(Element.prototype, 'clientHeight', { configurable: true, get(this: Element) { return is(this, 'mkp-zoom') ? 160 : 0; } });
    Object.defineProperty(HTMLElement.prototype, 'offsetWidth', {
      configurable: true,
      get(this: HTMLElement) {
        if (!is(this, 'mkp-fit-inner')) return 0;
        const want = say(this, 'wide') ? 600 : 100;
        return this.style.minWidth === '0' ? want : Math.max(want, 300);
      },
    });
    Object.defineProperty(HTMLElement.prototype, 'offsetHeight', { configurable: true, get(this: HTMLElement) { return is(this, 'mkp-fit-inner') || is(this, 'mkp-zoom-content') ? (say(this, 'tall') ? 500 : 40) : 0; } });
    try {
      const { container } = draw(doc(['column gap=s', '  zoom', '    text "fits"', '  zoom', '    text "wide"', '  zoom maxheight=s', '    text "tall"', '  zoom', ...canvasLines.map((l) => '    ' + l), '  zoom', '    image "plan.svg" "a plan"']));
      const zooms = [...container.querySelectorAll<HTMLElement>('.mkp-zoom')];
      const locks = zooms.map((z) => !!z.querySelector('button[aria-label="Unlock to zoom and pan"]'));
      expect(locks).toEqual([false, true, true, true, true]);
      expect(zooms.map((z) => z.hasAttribute('data-tools'))).toEqual([false, true, true, true, true]);
      // what fits keeps its whole width and size: no strip kept free for a lock, no shrinking
      const [fits, wide] = zooms.map((z) => z.querySelector<HTMLElement>('.mkp-fit'));
      expect(fits!.style.paddingRight).toBe('');
      expect(fits!.hasAttribute('data-shrunk')).toBe(false);
      expect(wide!.style.paddingRight).toBe('44px');
      expect(wide!.hasAttribute('data-shrunk')).toBe(true);
      // a pinch on what fits is the page's, not the zoom's: it neither points at a lock nor is stopped
      expect(fireEvent.wheel(zooms[0], { ctrlKey: true, deltaY: -10 })).toBe(true);
      expect(zooms[0].hasAttribute('data-nudged')).toBe(false);
      act(() => void fireEvent.wheel(zooms[1], { ctrlKey: true, deltaY: -10 }));
      expect(zooms[1].hasAttribute('data-nudged')).toBe(true);
    } finally {
      for (const [k, d] of was) Object.defineProperty(k.startsWith('client') ? Element.prototype : HTMLElement.prototype, k, d!);
    }
  });
});

describe('keep=true (GAPS 150)', () => {
  it('scrolls the nearest scrolling ancestor, and only it, to show the element', () => {
    const outer = document.createElement('div');
    const pane = document.createElement('div');
    const kept = document.createElement('div');
    outer.style.overflowY = 'auto';
    pane.style.overflowY = 'auto';
    pane.appendChild(kept);
    outer.appendChild(pane);
    document.body.appendChild(outer);
    for (const [el, sh, ch] of [[pane, 1000, 200], [outer, 2000, 300]] as const) {
      Object.defineProperty(el, 'scrollHeight', { value: sh });
      Object.defineProperty(el, 'clientHeight', { value: ch });
    }
    pane.getBoundingClientRect = () => ({ top: 0, bottom: 200, left: 0, right: 100, width: 100, height: 200 }) as DOMRect;
    kept.getBoundingClientRect = () => ({ top: 500, bottom: 520, left: 0, right: 100, width: 100, height: 20 }) as DOMRect;
    keepInView(kept);
    expect(pane.scrollTop).toBe(328);
    expect(outer.scrollTop).toBe(0);
    outer.remove();
  });

  it('is applied when the node is drawn kept', () => {
    const b = doc(['var at int = 0', 'row scroll=x wrap=false', '  text "one" keep=(at == 0)', '  text "two" keep=(at == 1)', 'press id=go', '  text "next"', '  @click set at=1']);
    const rect = HTMLElement.prototype.getBoundingClientRect;
    const sw = Object.getOwnPropertyDescriptor(Element.prototype, 'scrollWidth');
    const cw = Object.getOwnPropertyDescriptor(Element.prototype, 'clientWidth');
    HTMLElement.prototype.getBoundingClientRect = function (this: HTMLElement) {
      const left = this.textContent === 'two' && this.getAttribute('data-mkp') === 'text' ? 600 : 0;
      const width = this.hasAttribute('data-scroll') ? 200 : 50;
      return { left, right: left + width, top: 0, bottom: 20, width, height: 20 } as DOMRect;
    };
    Object.defineProperty(Element.prototype, 'scrollWidth', { configurable: true, get: () => 1000 });
    Object.defineProperty(Element.prototype, 'clientWidth', { configurable: true, get: () => 200 });
    try {
      const { container, getByRole } = draw(b);
      const row = one(container, '[data-scroll]');
      expect(row.scrollLeft).toBe(0);
      fireEvent.click(getByRole('button', { name: 'next' }));
      expect(row.scrollLeft).toBe(458);
    } finally {
      HTMLElement.prototype.getBoundingClientRect = rect;
      Object.defineProperty(Element.prototype, 'scrollWidth', sw!);
      Object.defineProperty(Element.prototype, 'clientWidth', cw!);
    }
  });
});

describe('text, press, field, code and maths', () => {
  it('text clips to its lines with an ellipsis, and keeps their height (GAPS 151)', () => {
    const { container } = draw(doc(['text "a long title" lines=2 clip=true', 'text "one line" clip=true', 'text "plain" lines=3']));
    const [a, b, c] = container.querySelectorAll<HTMLElement>('[data-mkp=text]');
    expect(a.hasAttribute('data-clip')).toBe(true);
    expect(a.style.getPropertyValue('--mkp-lines')).toBe('2');
    expect(a.style.minHeight).toBe('2lh');
    expect(b.style.getPropertyValue('--mkp-lines')).toBe('1');
    expect(c.hasAttribute('data-clip')).toBe(false);
    expect(BASE_CSS).toMatch(/\[data-clip\] \{[^}]*-webkit-line-clamp: var\(--mkp-lines, 1\)/);
  });

  it('a press raises enter and leave, with the pointer and with focus', () => {
    const { container, getByRole } = draw(doc(['var over text = "no"', 'press label="card"', '  text "card"', '  @enter set over="yes"', '  @leave set over="no"', 'text "over \\val{over}"']));
    const card = getByRole('button', { name: 'card' });
    fireEvent.pointerEnter(card);
    expect(container.textContent).toContain('over yes');
    fireEvent.pointerLeave(card);
    expect(container.textContent).toContain('over no');
    fireEvent.focus(card);
    expect(container.textContent).toContain('over yes');
    fireEvent.blur(card);
    expect(container.textContent).toContain('over no');
  });

  it('a field of several lines is a textarea: Enter is a new line, Ctrl or Cmd+Enter submits (GAPS 80)', () => {
    const { container } = draw(doc(['var v text = ""', 'var got text = "-"', 'field value=v lines=3 label="answer"', '  @submit set got=(submit.value)', 'text "got \\val{got}"']));
    const box = one(container, 'textarea');
    expect(box.getAttribute('rows')).toBe('3');
    fireEvent.change(box, { target: { value: 'two\nlines' } });
    fireEvent.keyDown(box, { key: 'Enter' });
    expect(container.textContent).toContain('got -');
    fireEvent.keyDown(box, { key: 'Enter', ctrlKey: true });
    expect(container.textContent).toContain('got two\nlines');
    fireEvent.change(box, { target: { value: 'three' } });
    fireEvent.keyDown(box, { key: 'Enter', metaKey: true });
    expect(container.textContent).toContain('got three');
  });

  it('a one-line field submits on Enter; a tone marks it right or wrong (GAPS 86)', () => {
    const { container } = draw(doc(['var v text = ""', 'var right bool = false', 'field value=v tone=(if(right, ok, bad)) label="x"', '  @submit set right=true']));
    const input = one(container, 'input.mkp-field');
    expect(input.getAttribute('data-mkp')).toBe('field');
    expect(input.getAttribute('data-tone')).toBe('bad');
    expect(input.getAttribute('aria-invalid')).toBe('true');
    expect(input.style.borderColor).toBe('var(--mkp-color-bad)');
    fireEvent.keyDown(input, { key: 'Enter' });
    expect(one(container, 'input.mkp-field').getAttribute('data-tone')).toBe('ok');
    expect(one(container, 'input.mkp-field').getAttribute('aria-invalid')).toBeNull();
  });

  it('a pickable listing raises pick with the line pressed, by pointer or key (GAPS 68, 96)', () => {
    const { container } = draw(doc(['var at int = 0', 'code src="a = 1\\nb = 2\\nc = 3" pickable=true', '  @pick set at=(pick.line)', 'text "picked \\val{at}"']));
    const lines = container.querySelectorAll<HTMLElement>('.mkp-code-line[data-pick]');
    expect(lines).toHaveLength(3);
    expect(lines[1].getAttribute('role')).toBe('button');
    fireEvent.click(lines[1]);
    expect(container.textContent).toContain('picked 2');
    fireEvent.keyDown(container.querySelectorAll('.mkp-code-line')[2], { key: 'Enter' });
    expect(container.textContent).toContain('picked 3');
    // a listing that isn't pickable has no buttons
    cleanup();
    const plain = draw(doc(['code src="x" line=1']));
    expect(plain.container.querySelector('.mkp-code-line[data-pick]')).toBeNull();
  });

  it('a formula colours its marked parts by tone and lists their notes under it', () => {
    const { container } = draw(doc(['math tex=$\\mark{a}{x^2} + \\mark{b}{1}$ marks=[{id: "a", tone: ok, note: "the square"}, {id: "b", tone: c2, note: ""}]']));
    const math = one(container, '[data-mkp=math]');
    const rules = math.querySelector('style')!.textContent!;
    expect(rules).toContain('.mkp-mark-a { color: var(--mkp-color-ok);');
    expect(rules).toContain('.mkp-mark-b { color: var(--mkp-color-c2);');
    expect(rules).toContain(`[data-mkp-key="${math.getAttribute('data-mkp-key')}"] .mkp-mark-a`);
    const notes = [...math.querySelectorAll('.mkp-math-notes > li')];
    expect(notes.map((l) => l.textContent)).toEqual(['the square']);
    expect((notes[0] as HTMLElement).style.getPropertyValue('--mkp-mark-tone')).toBe('var(--mkp-color-ok)');
  });
});

describe('the runtime’s control rows', () => {
  it('steps and a clock are rows with their roles, and steps can show no step', () => {
    const { getByRole, container } = draw(doc(['at = steps 3 none=true "step"', 't = clock "elapsed"', 'text "at \\val{at}"']));
    const steps = getByRole('group', { name: 'step' });
    expect(steps.getAttribute('data-mkp')).toBe('row');
    expect(steps.getAttribute('data-control')).toBe('steps');
    expect(steps.textContent).toContain('—/3');
    // a track only when the widget asks for one (GAPS 124)
    expect(steps.querySelector('[data-mkp=range]')).toBeNull();
    fireEvent.click(getByRole('button', { name: 'next: step' }));
    expect(container.textContent).toContain('at 0');
    expect(getByRole('group', { name: 'elapsed' }).getAttribute('data-control')).toBe('clock');
    expect(getByRole('toolbar', { name: 'controls' })).toBeTruthy();
  });
});

describe('the canvas', () => {
  const canvas = (extra = '') => ['canvas x=0..10 y=0..10 size=s' + extra, '  layer', '    circle (5, 5) 1 px=6 fill=accent opacity=0.5', '    circle (2, 2) 1', '    path [(0, 0), (10, 10)] head=arrow width=2 opacity=0.4', '    path [(0, 10), (10, 0)] head=dot', '    label (5, 5) "big" size=large halo=true dx=4 dy=2'];
  it('draws circles in px, paths with heads, and labels with their sizes, halos and offsets (GAPS 106, 108, 109, 113)', () => {
    const { container } = draw(doc(canvas()));
    const svg = one(container, '.mkp-canvas svg');
    const circles = [...svg.querySelectorAll(':scope > g > circle')];
    expect(circles[0].getAttribute('r')).toBe('6');
    expect(circles[0].getAttribute('opacity')).toBe('0.5');
    // 1 in data units is 16px at 160 wide
    expect(circles[1].getAttribute('r')).toBe('16');
    const [arrow, dot] = svg.querySelectorAll<SVGGElement>('g[data-head]');
    expect(arrow.getAttribute('opacity')).toBe('0.4');
    expect(arrow.querySelector('polygon')).toBeTruthy();
    // the shaft stops under the head, short of the tip
    const d = arrow.querySelector('path')!.getAttribute('d')!;
    const end = d.split(' ').pop()!.slice(1).split(',').map(Number);
    expect(end[0]).toBeLessThan(160);
    expect(dot.querySelector('circle')).toBeTruthy();
    const label = one(container, '.mkp-overlay-label');
    expect(label.getAttribute('data-size')).toBe('large');
    expect(label.hasAttribute('data-halo')).toBe(true);
    expect(label.style.left).toBe('84px');
    expect(label.style.top).toBe('78px');
  });

  it('a height in a size token fixes the canvas’s height (GAPS 18, 104)', () => {
    const { container } = draw(doc(canvas(' height=m')));
    const box = one(container, '.mkp-canvas');
    expect(box.style.height).toBe('var(--mkp-size-m)');
    expect(one(box, 'svg').getAttribute('height')).toBe('320');
    expect(one(box, 'svg').getAttribute('width')).toBe('160');
  });

  it('keeps labels inside the canvas and clear of each other (GAPS 107)', () => {
    const placed = placeCanvasLabels(
      [
        { x: 50, y: 50, w: 40, h: 16, anchor: 'center' },
        { x: 55, y: 52, w: 40, h: 16, anchor: 'center' },
        { x: 198, y: 2, w: 30, h: 16, anchor: 'ne' },
      ],
      200,
      100,
    );
    const [a, b, c] = placed;
    const clear = a[0] + a[2] <= b[0] || b[0] + b[2] <= a[0] || a[1] + a[3] <= b[1] || b[1] + b[3] <= a[1];
    expect(clear).toBe(true);
    expect(c[0] + c[2]).toBeLessThanOrEqual(200);
    expect(c[1]).toBeGreaterThanOrEqual(0);
  });
});

describe('the reader’s width', () => {
  it('is narrow under 600px, medium under 1000px, wide from there', () => {
    expect([390, 599, 600, 999, 1000, 1440].map(widthClass)).toEqual(['narrow', 'narrow', 'medium', 'medium', 'wide', 'wide']);
  });

  it('follows the document root’s width, measured as it changes', () => {
    const observers: { cb: () => void; els: Element[] }[] = [];
    const RO = globalThis.ResizeObserver;
    globalThis.ResizeObserver = class {
      els: Element[] = [];
      constructor(cb: () => void) {
        observers.push({ cb, els: this.els });
      }
      observe(el: Element): void {
        this.els.push(el);
      }
      unobserve(): void {}
      disconnect(): void {}
    } as unknown as typeof ResizeObserver;
    try {
      const { container, rt } = draw(doc(['text "\\val{width}"']));
      const root = one(container, '.mkp-root');
      const shown = (): string | null => one(container, '[data-mkp=text]').textContent;
      expect(shown()).toBe('wide');
      Object.defineProperty(root, 'clientWidth', { configurable: true, value: 390 });
      act(() => observers.filter((o) => o.els.includes(root)).forEach((o) => o.cb()));
      expect(shown()).toBe('narrow');
      Object.defineProperty(root, 'clientWidth', { configurable: true, value: 800 });
      act(() => observers.filter((o) => o.els.includes(root)).forEach((o) => o.cb()));
      expect(shown()).toBe('medium');
      expect(rt.view()).toBeTruthy();
    } finally {
      globalThis.ResizeObserver = RO;
    }
  });
});

describe('the stylesheet', () => {
  it('is all in the mkp cascade layer, so any unlayered host rule wins (GAPS 5)', () => {
    for (const css of [BASE_CSS, NEUTRAL_CSS, SHELL_CSS, tokenCss([])]) expect(css.trimStart().startsWith('@layer mkp {')).toBe(true);
    // outlines and rules are the line token (GAPS 62)
    expect(SHELL_CSS).not.toContain('--mkp-stroke-muted');
    expect(SHELL_CSS).toContain('var(--mkp-color-line)');
  });

  it('holds inline maths, list markers and footnote markers against a reset (GAPS 2, 3, 33)', () => {
    expect(BASE_CSS).toContain('.mkp-math svg { display: inline !important;');
    expect(BASE_CSS).toMatch(/\.mkp-root sup \{[^}]*position: static !important; top: auto !important;/);
    const { container } = draw(doc(['text "x"'], '\n- one\n- two\n\n1. first\n\nA note.[^n]\n\n[^n]: The note.\n'));
    const ul = one(container, 'ul');
    expect(ul.style.listStyleType).toBe('disc');
    expect(ul.style.paddingLeft).toBe('1.5em');
    expect(one(ul, 'li').style.display).toBe('list-item');
    expect(one(container, 'ol').style.listStyleType).toBe('decimal');
    for (const sup of container.querySelectorAll<HTMLElement>('sup')) {
      expect(sup.style.position).toBe('static');
      expect(sup.style.verticalAlign).toBe('super');
    }
    expect(container.querySelectorAll('sup').length).toBe(2);
    expect(screen.getByText('The note.')).toBeTruthy();
  });

  it('gives the categorical tones and the line colour as tokens (GAPS 158)', () => {
    const b = doc(['text "x"']);
    const css = tokenCss(b.tokens);
    for (const n of ['line', 'c1', 'c2', 'c3', 'c4', 'c5', 'c6']) expect(css).toContain(`--mkp-color-${n}:`);
  });
});

describe('what a host styles and traces', () => {
  const kinds = ['button', 'toggle', 'switch', 'check', 'radio', 'option', 'plain', 'tab'];
  it('gives every press mkp-press and a class for its own kind, so a host can style buttons alone', () => {
    const { container } = draw(doc(kinds.map((k) => `press kind=${k} label="${k}"\n    text "${k}"`)));
    for (const k of kinds) {
      const el = one(container, `.mkp-press-${k}`);
      expect(el.classList.contains('mkp-press')).toBe(true);
      expect(el.getAttribute('data-kind')).toBe(k);
    }
    expect(container.querySelectorAll('.mkp-press-button').length).toBe(1);
  });
  it("draws a switch's thumb as an element that moves when it is on, with no transition of MKP's own", () => {
    const { container } = draw(doc(['var on bool = false', 'press kind=switch selected=on label="on" id=sw', '  text "Wi-Fi"', '  @click set on=(not on)']));
    const sw = one(container, '[data-mkp-id=sw]');
    const thumb = sw.querySelector('.mkp-switch > .mkp-switch-thumb');
    expect(thumb).not.toBeNull();
    expect(sw.querySelector('.mkp-switch')?.getAttribute('aria-hidden')).toBe('true');
    expect(sw.textContent).toBe('Wi-Fi');
    fireEvent.click(sw);
    expect(one(container, '[data-mkp-id=sw]').getAttribute('aria-checked')).toBe('true');
    expect(NEUTRAL_CSS).toContain('.mkp-press[aria-checked=true] > .mkp-switch > .mkp-switch-thumb { transform: translateX(16px); }');
    expect(NEUTRAL_CSS).not.toMatch(/::before[^}]*switch|switch[^}]*::before/);
    // other kinds draw no thumb
    const other = draw(doc(['press kind=check label="c"', '  text "c"']));
    expect(other.container.querySelector('.mkp-switch')).toBeNull();
  });
  it('names each icon, and rings help as info is ringed', () => {
    const { container } = draw(doc(['row', '  icon name=help', '  icon name=info']));
    expect(one(container, '.mkp-icon[data-name=help]').textContent).toBe('?');
    expect(one(container, '.mkp-icon[data-name=info]').textContent).toBe('ⓘ');
    expect(SHELL_CSS).toMatch(/\.mkp-icon\[data-name=help\] \{[^}]*border-radius: 50%/);
  });
});

describe('the pointer on what is inside a widget', () => {
  const pie = [
    'var hover int = -1',
    'var chosen int = -1',
    'column',
    '  canvas -1..1 -1..1 size=s label="shares"',
    '    layer',
    '      each k in 0..1 key=k',
    '        path [(0, 0), (1, k), (k, 1)] closed=true fill=(if(hover == k, accent, muted)) label=("part " + format(k + 1, 0))',
    '          @enter set hover=k',
    '          @leave set hover=-1',
    '          @click set chosen=k',
    '      circle (0, 0) 0.1 fill=ink',
    '  text "on \\val{hover} chose \\val{chosen}"',
  ];
  it('reports enter, leave and click on a canvas shape, and nothing on one that does not listen', () => {
    const { container } = draw(doc(pie));
    const parts = [...container.querySelectorAll<SVGElement>('[data-pointed]')];
    expect(parts.length).toBe(2);
    expect(container.querySelectorAll('circle[data-pointed]').length).toBe(0);
    fireEvent.pointerEnter(parts[1]);
    expect(container.textContent).toContain('on 1 chose -1');
    fireEvent.pointerLeave(parts[1]);
    expect(container.textContent).toContain('on -1 chose -1');
    fireEvent.click(parts[0]);
    expect(container.textContent).toContain('chose 0');
  });
  it('makes a shape that takes a press a named control, pressed from the keyboard too', () => {
    const { container } = draw(doc(pie));
    const canvas = one(container, '.mkp-canvas');
    expect(canvas.getAttribute('role')).toBe('group');
    const part = container.querySelectorAll<SVGElement>('[data-press]')[1];
    expect(part.getAttribute('role')).toBe('button');
    expect(part.getAttribute('tabindex')).toBe('0');
    expect(part.getAttribute('aria-label')).toBe('part 2');
    fireEvent.keyDown(part, { key: 'Enter' });
    expect(container.textContent).toContain('chose 1');
    fireEvent.focus(part);
    expect(container.textContent).toContain('on 1');
  });
  it('keeps a figure with nothing to press an image', () => {
    const { container } = draw(doc(['canvas -1..1 -1..1 label="a dot"', '  layer', '    circle (0, 0) 0.5 fill=accent']));
    expect(one(container, '.mkp-canvas').getAttribute('role')).toBe('img');
    expect(container.querySelector('[data-pointed]')).toBeNull();
  });
  it('reports the pointer onto and off a container', () => {
    const { container } = draw(doc(['var on bool = false', 'column pad=m id=card', '  @enter set on=true', '  @leave set on=false', '  text "lit \\val{on}"']));
    fireEvent.pointerEnter(one(container, '[data-mkp-id=card]'));
    expect(container.textContent).toContain('lit true');
    fireEvent.pointerLeave(one(container, '[data-mkp-id=card]'));
    expect(container.textContent).toContain('lit false');
  });
});

describe('the second consumer', () => {
  it('pads a box by padx at the sides and pady top and bottom, pad elsewhere', () => {
    const { container } = draw(doc(['column pad=l padx=m id=x', '  text "a"', 'row pady=s id=y', '  text "b"']));
    const x = one(container, '[data-mkp-id=x]').style;
    expect([x.paddingTop, x.paddingLeft]).toEqual(['var(--mkp-space-l)', 'var(--mkp-space-m)']);
    const y = one(container, '[data-mkp-id=y]').style;
    expect([y.paddingTop, y.paddingLeft]).toEqual(['var(--mkp-space-s)', '']);
  });
  it('places a stack or grid child on both axes with self=, and positions every layer', () => {
    const { container } = draw(doc(['stack', '  column pad=l id=back', '    text "back"', '  column self=start id=badge', '    text "3"']));
    const s = one(container, '[data-mkp-id=badge]').style;
    expect([s.alignSelf, s.justifySelf]).toEqual(['flex-start', 'start']);
    expect(BASE_CSS).toContain('.mkp-root [data-layers] > * { grid-area: 1 / 1; min-width: 0; position: relative; }');
  });
  it('tells the document its theme: dark when given, and redraws what reads it', () => {
    const b = doc(['text "now \\val{theme}"']);
    const rt = new Runtime(b, { now: () => 0 });
    const { container, rerender } = render(<MkpDocument bundle={b} runtime={rt} theme="dark" />);
    expect(container.textContent).toContain('now dark');
    rerender(<MkpDocument bundle={b} runtime={rt} theme="light" />);
    expect(container.textContent).toContain('now light');
  });
  it('clips a layer to its rectangle', () => {
    const { container } = draw(doc(['canvas 0..10 0..10 label="plot"', '  layer clip=[(1, 1), (9, 9)]', '    path [(0, 0), (10, 10)]', '  layer', '    circle (5, 5) 1']));
    const g = container.querySelectorAll('.mkp-canvas svg > g');
    const id = g[0].getAttribute('clip-path')!;
    expect(id).toMatch(/^url\(#mkp-clip-/);
    expect(container.querySelector(`clipPath${id.slice(4, -1).replace(/:/g, '\\:')} rect`)).not.toBeNull();
    expect(g[1].getAttribute('clip-path')).toBeNull();
  });
});
