// @vitest-environment jsdom
// The web renderer's arrows: it measures each arrow's waypoints (via=) along with its ends and
// draws the path through them. jsdom does no layout, so the elements' boxes are given here.
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { cleanup, render } from '@testing-library/react';
import { compile, type PackSource } from '@mkp/core';
import { MkpDocument } from '../src/index';

afterEach(cleanup);

const enc = new TextEncoder();
const src = `w@1 "w"
  stack
    stack id=a
      text "a"
    stack id=m
    stack id=b
      text "b"
  arrow from=a to=b via=["m"]
  arrow from=b to=a
`;

function bundle() {
  const files = new Map<string, Uint8Array>([
    ['manifest.mkp', enc.encode('pack t@1 "test"\n  requires core@1\n  provides w\n')],
    ['w.mkp', enc.encode(src)],
  ]);
  const c = compile({ packs: [{ label: 't', files } as PackSource] });
  return c.document('```w\nsummary: s\n```\n', 'doc.mkp.md')!;
}

// boxes by element id: two boxes one above the other, and a lane (no width) off to the side
const BOXES: Record<string, [number, number, number, number]> = { a: [0, 0, 40, 20], m: [100, 60, 0, 80], b: [0, 200, 40, 20] };
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

describe('@mkp/react arrows', () => {
  it('draws an arrow through its waypoints, and a plain one straight, in the first commit', () => {
    const { container } = render(<MkpDocument bundle={bundle()} />);
    const ds = [...container.querySelectorAll('svg.mkp-arrows path')].map((p) => p.getAttribute('d') ?? '');
    expect(ds.length).toBe(2);
    const routed = ds.find((d) => d.includes('Q'))!;
    // along the lane from its top end (100, 60) to its bottom end (100, 140), corners rounded
    expect(routed.indexOf('Q100.0,60.0')).toBeGreaterThan(0);
    expect(routed.indexOf('Q100.0,140.0')).toBeGreaterThan(routed.indexOf('Q100.0,60.0'));
    expect(ds.filter((d) => !d.includes('Q'))).toHaveLength(1);
  });
});
