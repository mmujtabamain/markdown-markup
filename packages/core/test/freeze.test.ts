// A pack's images carried in the bundle (assets): drawn from it, never fetched, so a bundle's design is
// frozen with it, a release note's frames among them.

import { describe, expect, it } from 'vitest';
import { compile } from '../src/build';
import { enc, frame, pack } from './freeze-pack';
import { formatDiagnostic } from '../src/diag';
import { writeMarkdown } from '../src/md';
import { Runtime } from '../src/runtime/runtime';
import { walk, type VNode, type VShape } from '../src/runtime/view';
import { sha256 } from '../src/util/sha256';

const bundle = (doc: string) => {
  const c = compile({ packs: [pack] });
  const b = c.document(doc, 'notes.mkp.md');
  expect(c.diags.errors.map(formatDiagnostic)).toEqual([]);
  return b!;
};
const shapes = (rt: Runtime): VShape[] => {
  const out: VShape[] = [];
  walk(rt.view(), (n) => n.layers?.forEach((l) => out.push(...l.shapes)));
  return out;
};

describe('a bundle carries the images its widgets name', () => {
  it('carries each pack image a definition names, cleaned, with its digest in the lock, and nothing else', () => {
    const b = bundle('```scene\nsummary: s\n```\n');
    expect(Object.keys(b.assets!)).toEqual(['notes/frames/closed.svg', 'notes/frames/open.svg']);
    const open = b.assets!['notes/frames/open.svg'];
    expect(open.type).toBe('image/svg+xml');
    // as the pack cleaned it: no script
    expect(open.data).toContain('>open<');
    expect(open.data).not.toContain('<script');
    expect(open.digest).toBe('sha256:' + sha256(open.data));
    expect(b.lock.assets).toEqual({ 'notes/frames/closed.svg': b.assets!['notes/frames/closed.svg'].digest, 'notes/frames/open.svg': open.digest });
  });
  it('carries a picture as base64, and none for a document that uses no widget naming one', () => {
    const b = bundle('```still\nsummary: s\n```\n');
    expect(Object.keys(b.assets!)).toEqual(['notes/frames/still.svg', 'notes/shot.png']);
    expect(b.assets!['notes/shot.png']).toMatchObject({ type: 'image/png', base64: true, data: 'iVBORw0KGgoAAAAN' });
    expect(bundle('# Plain\n\nText.\n').assets).toBeUndefined();
  });
  it('draws them from the bundle, never fetched: a frame swapped by state is the other carried one', () => {
    const b = bundle('```scene\nsummary: s\n```\n');
    const rt = new Runtime(b);
    const img = (): Extract<VShape, { t: 'image' }> => shapes(rt).find((s) => s.t === 'image') as Extract<VShape, { t: 'image' }>;
    expect(img().asset).toBe('notes/frames/closed.svg');
    expect(decodeURIComponent(img().src.replace(/^data:image\/svg\+xml;charset=utf-8,/, ''))).toBe(b.assets!['notes/frames/closed.svg'].data);
    const hot = shapes(rt).find((s) => s.t === 'path' && s.ev)!;
    rt.dispatch(hot.key, 'click');
    expect(img().asset).toBe('notes/frames/open.svg');
    expect(img().src.startsWith('data:image/svg+xml;charset=utf-8,')).toBe(true);
  });
  it('freezes the design: the bundle draws the same when the pack’s files change later', () => {
    const b = bundle('```still\nsummary: s\n```\n');
    const before = JSON.stringify(new Runtime(b).view());
    pack.files!.set('frames/still.svg', enc.encode(frame('redesigned')));
    try {
      expect(JSON.stringify(new Runtime(b).view())).toBe(before);
      // a bundle made now carries the new design, under a new digest
      const again = bundle('```still\nsummary: s\n```\n');
      expect(again.assets!['notes/frames/still.svg'].digest).not.toBe(b.assets!['notes/frames/still.svg'].digest);
    } finally {
      pack.files!.set('frames/still.svg', enc.encode(frame('still')));
    }
  });
  it('writes a carried SVG beside the Markdown as a file, and keeps a picture as its data URI', () => {
    // a widget with no project md is written as what it draws
    const r = writeMarkdown(bundle('```still\nsummary: s\n```\n'));
    expect(r.md).toContain('![A still](frames-still.svg)');
    expect(r.files.get('frames-still.svg')).toContain('>still<');
    expect(r.md).toContain('![A shot](data:image/png;base64,');
  });
});

describe('an image no pack carries', () => {
  it('keeps its src as written', () => {
    const srcs: string[] = [];
    walk(new Runtime(bundle('```still\nsummary: s\n```\n')).view(), (n: VNode) => void (n.t === 'image' && srcs.push(String(n.p.src).slice(0, 22))));
    expect(srcs).toEqual(['data:image/svg+xml;cha', 'data:image/png;base64,', 'elsewhere.svg']);
  });
});
