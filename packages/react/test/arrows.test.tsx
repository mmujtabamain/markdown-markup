// @vitest-environment jsdom
// The web renderer's arrows: routing through waypoints, the ends (dot, ring), behind the content,
// label chips placed clear of other lines, the least bend of a curve, and the layer each arrow is
// drawn in (a pane's body, a zoom's moving layer, a frame in full screen). jsdom does no layout, so
// the elements' boxes are given here, by id.
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { cleanup, fireEvent, render, waitFor } from '@testing-library/react';
import { compile, formatDiagnostic } from '@mkp/core';
import { MIN_BEND, MkpDocument } from '../src/index';

afterEach(cleanup);

const fence = (b: string): string => '```mkp\n' + b + '\n```\n';
function bundle(lines: string[]) {
  const text = fence(['w "Boxes and arrows."', ...lines.map((l) => '  ' + l), '  project md = "w"'].join('\n')) + '```w\nsummary: s\n```\n';
  const c = compile({ packs: [] });
  const b = c.document(text, 'doc.mkp.md');
  if (!b || c.diags.errors.length) throw new Error(c.diags.errors.map(formatDiagnostic).join('\n'));
  return b;
}
const box = (id: string, inner = ''): string[] => [`  column id=${id}`, ...(inner ? [`    text "${inner}"`] : [])];

// boxes by element id: [x, y, w, h]
let BOXES: Record<string, [number, number, number, number]> = {};
const rect = HTMLElement.prototype.getBoundingClientRect;
const parent = Object.getOwnPropertyDescriptor(HTMLElement.prototype, 'offsetParent');
beforeAll(() => {
  HTMLElement.prototype.getBoundingClientRect = function (this: HTMLElement) {
    const [x, y, w, h] = BOXES[this.getAttribute('data-mkp-id') ?? ''] ?? [0, 0, 0, 0];
    return { x, y, left: x, top: y, width: w, height: h, right: x + w, bottom: y + h, toJSON: () => ({}) } as DOMRect;
  };
  Object.defineProperty(HTMLElement.prototype, 'offsetParent', { configurable: true, get: () => document.body });
});
afterAll(() => {
  HTMLElement.prototype.getBoundingClientRect = rect;
  if (parent) Object.defineProperty(HTMLElement.prototype, 'offsetParent', parent);
});

const shafts = (el: Element): string[] => [...el.querySelectorAll('g[data-mkp-arrow] > path:first-child')].map((p) => p.getAttribute('d') ?? '');

describe('@mkp/react arrows', () => {
  it('draws an arrow through its waypoints, and a plain one straight, in the first commit', () => {
    BOXES = { a: [0, 0, 40, 20], m: [100, 60, 0, 80], b: [0, 200, 40, 20] };
    const { container } = render(<MkpDocument bundle={bundle(['column', ...box('a', 'a'), ...box('m'), ...box('b', 'b'), 'arrow from=a to=b via=["m"]', 'arrow from=b to=a label="back"'])} />);
    const ds = shafts(container);
    expect(ds.length).toBe(2);
    const routed = ds.find((d) => d.includes('Q'))!;
    // along the lane from its top end (100, 60) to its bottom end (100, 140), corners rounded
    expect(routed.indexOf('Q100.0,60.0')).toBeGreaterThan(0);
    expect(routed.indexOf('Q100.0,140.0')).toBeGreaterThan(routed.indexOf('Q100.0,60.0'));
    expect(ds.filter((d) => !d.includes('Q'))).toHaveLength(1);
  });

  it('puts a label in a chip on the surface colour, so its own line does not strike it through (GAPS 141)', () => {
    BOXES = { a: [0, 0, 40, 20], b: [0, 200, 40, 20] };
    const { container } = render(<MkpDocument bundle={bundle(['column', ...box('a', 'a'), ...box('b', 'b'), 'arrow from=b to=a label="back"'])} />);
    const label = container.querySelector<HTMLElement>('.mkp-arrow-label')!;
    expect(label.textContent).toBe('back');
    expect(label.closest('[aria-hidden]')).toBeTruthy();
    expect(label.style.left).toBe('20px');
  });

  it('moves a label along its line until it crosses no other line', () => {
    BOXES = { v1: [95, 0, 10, 10], v2: [95, 190, 10, 10], h1: [0, 95, 10, 10], h2: [190, 95, 10, 10] };
    const { container } = render(<MkpDocument bundle={bundle(['column', ...box('v1', 'v'), ...box('v2', 'v'), ...box('h1', 'h'), ...box('h2', 'h'), 'arrow from=v1 to=v2', 'arrow from=h1 to=h2 label="xx"'])} />);
    const label = container.querySelector<HTMLElement>('.mkp-arrow-label')!;
    const x = parseFloat(label.style.left);
    // its chip (estimated 27px wide before it is measured) is clear of the upright line at x = 100
    expect(Math.abs(x - 100)).toBeGreaterThan(13.5);
    expect(parseFloat(label.style.top)).toBeCloseTo(100, 0);
  });

  it('draws dot and ring ends, behind the content and at its own opacity (GAPS 100, 122, 140)', () => {
    BOXES = { a: [0, 0, 40, 20], b: [0, 200, 40, 20] };
    const { container } = render(<MkpDocument bundle={bundle(['column', ...box('a', 'a'), ...box('b', 'b'), 'arrow from=a to=b head=dot tail=ring layer=behind opacity=0.5'])} />);
    const scope = container.querySelector('.mkp-scope')!;
    expect(scope.hasAttribute('data-mkp-behind')).toBe(true);
    const g = container.querySelector<SVGGElement>('svg.mkp-arrows[data-layer=behind] g[data-mkp-arrow]')!;
    expect(g.style.opacity).toBe('0.5');
    expect(g.querySelector('polygon')).toBeNull();
    const marks = [...g.querySelectorAll('path')].slice(1);
    expect(marks.map((m) => /a(\d\.5),/.exec(m.getAttribute('d')!)?.[1])).toEqual(['3.5', '4.5']);
    expect(marks[1].getAttribute('fill')).toBe('var(--mkp-color-surface)');
    // the shaft runs on to the dot
    expect(shafts(container)[0]).toMatch(/L20\.0,200\.0$/);
    expect(container.querySelector('svg.mkp-arrows:not([data-layer])')).toBeNull();
  });

  it('bends a curve between adjacent rows at least MIN_BEND (GAPS 52)', () => {
    BOXES = { a: [0, 0, 40, 20], c: [0, 60, 40, 20] };
    const { container } = render(<MkpDocument bundle={bundle(['column', ...box('a', 'a'), ...box('c', 'c'), 'arrow from=a to=c', 'arrow from=c to=a curve'])} />);
    const curved = shafts(container).find((d) => d.includes('Q'))!;
    const [cx, cy] = /Q(-?[\d.]+),(-?[\d.]+)/.exec(curved)!.slice(1).map(Number);
    // the chord runs from (20, 70) to (20, 10): the control point stands MIN_BEND off its middle
    expect(Math.abs(cx - 20)).toBeCloseTo(MIN_BEND, 0);
    expect(cy).toBeCloseTo(40, 0);
  });
});

describe('the layer an arrow is drawn in', () => {
  it('a pane’s body, when both ends are in it, so it scrolls with them (GAPS 93, 143)', () => {
    BOXES = { a: [0, 0, 40, 20], b: [0, 100, 40, 20], c: [200, 0, 40, 20] };
    const { container } = render(<MkpDocument bundle={bundle(['row', '  pane title="P"', ...box('a', 'a').map((l) => '  ' + l), ...box('b', 'b').map((l) => '  ' + l), ...box('c', 'c'), 'arrow from=a to=b', 'arrow from=a to=c'])} />);
    const body = container.querySelector('.mkp-pane-body')!;
    expect(body.querySelectorAll('g[data-mkp-arrow]')).toHaveLength(1);
    const scope = container.querySelector('.mkp-scope')!;
    expect(scope.querySelectorAll(':scope > svg.mkp-arrows g[data-mkp-arrow]')).toHaveLength(1);
  });

  it('measures again when a pane scrolls, for a line out of it', async () => {
    BOXES = { a: [0, 0, 40, 20], c: [200, 0, 40, 20] };
    const { container } = render(<MkpDocument bundle={bundle(['row', '  pane title="P"', ...box('a', 'a').map((l) => '  ' + l), ...box('c', 'c'), 'arrow from=a to=c'])} />);
    const before = shafts(container)[0];
    BOXES.a = [0, -50, 40, 20];
    fireEvent.scroll(container.querySelector('.mkp-pane-body')!);
    await waitFor(() => expect(shafts(container)[0]).not.toBe(before));
  });

  it('a zoom’s moving layer, so lines follow its pan and scale (GAPS 126)', () => {
    BOXES = { a: [0, 0, 40, 20], b: [0, 100, 40, 20] };
    const { container } = render(<MkpDocument bundle={bundle(['zoom', ...box('a', 'a'), ...box('b', 'b'), 'arrow from=a to=b'])} />);
    expect(container.querySelector('.mkp-zoom-content > svg.mkp-arrows g[data-mkp-arrow]')).toBeTruthy();
  });

  it('a frame’s stage, full screen or not, so a line behind sits over its surface (GAPS 92, 175)', () => {
    BOXES = { a: [0, 0, 40, 20], b: [0, 100, 40, 20] };
    const { container, getByRole } = render(<MkpDocument bundle={bundle(['frame title="F"', ...box('a', 'a'), ...box('b', 'b'), 'arrow from=a to=b layer=behind'])} />);
    const inStage = () => container.querySelector('.mkp-frame-stage > svg.mkp-arrows[data-layer=behind] g[data-mkp-arrow]');
    expect(inStage()).toBeTruthy();
    expect(container.querySelector('.mkp-scope > svg.mkp-arrows')).toBeNull();
    fireEvent.click(getByRole('button', { name: 'Full screen' }));
    expect(container.querySelector('.mkp-frame[data-full] .mkp-frame-stage > svg.mkp-arrows g[data-mkp-arrow]')).toBeTruthy();
    fireEvent.click(getByRole('button', { name: 'Leave full screen' }));
    expect(inStage()).toBeTruthy();
  });
});

describe('tails on a combined trunk', () => {
  it('draws a shared tail once, however many lines leave by it', () => {
    BOXES = { p: [100, 0, 60, 30], a: [0, 100, 60, 30], b: [200, 100, 60, 30] };
    const { container } = render(<MkpDocument bundle={bundle(['column', ...box('p', 'p'), ...box('a', 'a'), ...box('b', 'b'), 'arrow from=p to=a route=down tail=dot', 'arrow from=p to=b route=down tail=dot'])} />);
    const dots = [...container.querySelectorAll('svg.mkp-arrows g[data-mkp-arrow] path')].filter((m) => /a3\.5,/.test(m.getAttribute('d')!));
    expect(dots).toHaveLength(1);
  });
});
