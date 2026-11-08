// minwidth, minheight and aspect: a widget's size before it is drawn, written as it is (like an HTML
// img tag's width and height), with its widget's own defaults filling in.

import { describe, expect, it } from 'vitest';
import { compile, type PackSource } from '../src/build';
import { formatDiagnostic } from '../src/diag';
import { Runtime } from '../src/runtime/runtime';
import { walk, type VNode } from '../src/runtime/view';
import { mergeSize, sizeDefaults, sizeOf, sizeStyle, sizeVars } from '../src/size';

const enc = new TextEncoder();
const pack: PackSource = {
  label: 'p',
  files: new Map(
    Object.entries({
      'manifest.mkp': 'pack p@1 "P."\n  requires core@1\n  provides note chart panel\n',
      'w.mkp': [
        'note@1 "A note."',
        '  in word text = "hi"',
        '  text word',
        '  project md = word',
        '',
        'chart@1 "A chart that keeps its shape."',
        '  in aspect num = 16/9 "width over height"',
        '  in minheight int = 200',
        '  canvas aspect=aspect',
        '  project md = "chart"',
        '',
        'extern panel@1 "A panel, drawn by the host."',
        '  in body slot',
        '',
      ].join('\n'),
      'note.fixture.json': JSON.stringify({ widget: 'note@1', cases: { one: { props: {}, summary: 'One.' } } }),
      'chart.fixture.json': JSON.stringify({ widget: 'chart@1', cases: { one: { props: {}, summary: 'One.' } } }),
    }).map(([k, v]) => [k, enc.encode(v)]),
  ),
};
const doc = (text: string) => {
  const c = compile({ packs: [pack] });
  const b = c.document(text, 'doc.mkp.md');
  return { b, errors: c.diags.errors.map(formatDiagnostic), warnings: c.diags.warnings.map(formatDiagnostic), codes: [...c.diags.errors, ...c.diags.warnings].map((d) => d.code) };
};
const sizes = (b: ReturnType<typeof doc>['b']): (VNode['size'] | undefined)[] => {
  const out: (VNode['size'] | undefined)[] = [];
  walk(new Runtime(b!).view(), (n) => void (typeof n.p.place === 'number' && out.push(n.size)));
  return out;
};

describe('a size as written', () => {
  it('reads px, and a ratio as 16/9, 16:9 or 1.6; none, 0 and words are no size', () => {
    expect(sizeOf('minwidth', '320')).toBe(320);
    expect(sizeOf('aspect', '16/9')).toBeCloseTo(1.7778);
    expect(sizeOf('aspect', '16:9')).toBeCloseTo(1.7778);
    expect(sizeOf('aspect', '(1.6)')).toBe(1.6);
    expect(sizeOf('minheight', 'none')).toBeUndefined();
    expect(sizeOf('minheight', '0')).toBeUndefined();
    expect(sizeOf('minheight', '16/9')).toBeUndefined();
    expect(sizeOf('minheight', 'm')).toBeUndefined();
  });
  it('takes two of three, what the use wrote before the widget’s defaults, as CSS minimums and a shape', () => {
    expect(mergeSize({ aspect: 2 }, { minheight: 100, aspect: 1, minwidth: 50 })).toEqual({ aspect: 2, minwidth: 50 });
    // an empty box (a placeholder) never wider than its column: a minheight through an aspect would widen it
    expect(sizeStyle({ minheight: 100, aspect: 16 / 9 })).toEqual({ minHeight: '100px', aspectRatio: '1.7778', maxWidth: '100%' });
    expect(sizeStyle({ minwidth: 300, minheight: 150 })).toEqual({ minWidth: 'min(300px, 100%)', minHeight: '150px', maxWidth: '100%' });
    expect(sizeStyle({})).toEqual({});
    // a drawn widget: minheight and aspect on a spacer that only reserves room, so bigger content grows it
    expect(sizeVars({ minwidth: 300, minheight: 240, aspect: 3 })).toEqual({ minWidth: 'min(300px, 100%)', '--mkp-minheight': '240px', '--mkp-aspect': '3' });
  });
});

describe('minwidth, minheight and aspect on a use', () => {
  it('are taken in YAML, on a ::: line and on the {…} line under a block, by any widget', () => {
    const r = doc('```note\nminwidth: 480\naspect: 16/9\nsummary: s\n```\n\n:::panel minheight=120 aspect=1.5\nHi.\n:::\n\n```note\nsummary: s\n```\n{minwidth=300 minheight=100}\n');
    expect(r.errors).toEqual([]);
    expect(r.warnings).toEqual([]);
    expect(r.b!.doc.body.filter((n) => n.meta?.place !== undefined).map((n) => [n.meta!.minwidth, n.meta!.minheight, n.meta!.aspect])).toEqual([
      [480, undefined, 16 / 9],
      [undefined, 120, 1.5],
      [300, 100, undefined],
    ]);
  });
  it('reach the view, for the renderers and a host’s extern: the widget’s own defaults filling in', () => {
    const r = doc('```note\nminwidth: 480\naspect: 2\nsummary: s\n```\n\n```chart\nsummary: s\n```\n\n```chart\naspect: 3\nsummary: s\n```\n\n:::panel aspect=1.5 minheight=100\nHi.\n:::\n\n```note\nsummary: s\n```\n');
    expect(r.errors).toEqual([]);
    expect(sizes(r.b)).toEqual([{ minwidth: 480, aspect: 2 }, { aspect: 16 / 9, minheight: 200 }, { aspect: 3, minheight: 200 }, { aspect: 1.5, minheight: 100 }, undefined]);
  });
  it('warns of one alone, the widget’s defaults counted', () => {
    expect(doc('```note\nminheight: 300\nsummary: s\n```\n').warnings.join('\n')).toMatch(/minheight alone.*Give minwidth or aspect as well/);
    expect(doc(':::panel aspect=2\nHi.\n:::\n').codes).toEqual(['mkp.size']);
    // the chart's own minheight makes two
    expect(doc('```chart\naspect: 3\nsummary: s\n```\n').codes).toEqual([]);
  });
  it('refuses all three, which can disagree', () => {
    const r = doc('```note\nminwidth: 400\nminheight: 200\naspect: 1\nsummary: s\n```\n');
    expect(r.codes).toEqual(['mkp.size']);
    expect(r.errors.join('\n')).toMatch(/minwidth, minheight and aspect.*Remove one/);
  });
  it('refuses a size that is not one, saying how it is written', () => {
    expect(doc('```note\nminheight: tall\naspect: 2\nsummary: s\n```\n').errors.join('\n')).toMatch(/minheight takes a number of px/);
    expect(doc(':::panel aspect=wide minheight=100\nHi.\n:::\n').errors.join('\n')).toMatch(/aspect takes a ratio of width to height, e\.g\. aspect=16\/9/);
  });
});

describe('a widget’s own sizes', () => {
  it('are its minwidth, minheight and aspect inputs’ defaults, for outline(), made once from the packs', () => {
    const c = compile({ packs: [pack] });
    expect(sizeDefaults(c)).toEqual({ chart: { aspect: 16 / 9, minheight: 200 } });
  });
});
