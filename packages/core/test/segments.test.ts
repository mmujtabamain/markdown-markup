// A document in its pieces, and \val{} in its prose.

import { describe, expect, it } from 'vitest';
import { compile } from '../src/build';
import { formatDiagnostic } from '../src/diag';
import { segments } from '../src/syntax/segments';

const src = [
  '---',
  'title: T',
  '---',
  '# Intro',
  '',
  'Some prose.',
  '',
  '```mkp',
  'note "A note."',
  '  in word text',
  '  text word',
  '  project md = word',
  '```',
  '',
  '```state',
  'n = slider 1..5 "n"',
  '```',
  '',
  '```note',
  'word: one',
  'summary: s',
  '```',
  '{minheight=40}',
  '',
  'Between.',
  '',
  ':::lib:card@1 title="x"',
  'Inside.',
  ':::',
  '',
].join('\n');

describe('segments', () => {
  it('gives the document’s pieces in order, each its lines as written', () => {
    const s = segments(src);
    expect(s.map((x) => [x.kind, x.lines, x.kind === 'widget' ? `${x.place}:${x.name}` : x.kind === 'state' ? `${x.place}` : ''])).toEqual([
      ['front', [1, 3], ''],
      ['prose', [4, 6], ''],
      ['defs', [8, 13], ''],
      ['state', [15, 17], '0'],
      ['widget', [19, 23], '1:note'],
      ['prose', [25, 25], ''],
      ['widget', [27, 29], '2:card'],
    ]);
    const lines = src.split('\n');
    for (const x of s) expect(x.text).toBe(lines.slice(x.lines[0] - 1, x.lines[1]).join('\n'));
    // the widget's attribute line goes with it
    expect(s[4].text.endsWith('{minheight=40}')).toBe(true);
  });
  it('numbers widgets and state blocks as the compiler places them, and a document without front matter has none', () => {
    const doc = src.split('\n').slice(3).join('\n').replace(':::lib:card@1 title="x"\nInside.\n:::\n', '');
    const c = compile({ packs: [] });
    const b = c.document(doc, 'doc.mkp.md')!;
    expect(c.diags.errors.map(formatDiagnostic)).toEqual([]);
    const placed = b.doc.body.filter((n) => n.meta?.place !== undefined).map((n) => n.meta!.place);
    expect(segments(doc).flatMap((x) => (x.kind === 'widget' || x.kind === 'state' ? [x.place] : []))).toEqual(placed);
    expect(segments(doc)[0].kind).toBe('prose');
  });
});

describe('\\val{} in prose', () => {
  const warned = (text: string) => {
    const c = compile({ packs: [] });
    c.document(text, 'doc.mkp.md');
    return c.diags.warnings.filter((d) => d.code === 'mkp.val-in-prose').map((d) => [d.pos?.line, d.pos?.col, d.message]);
  };
  it('is warned of, where it is: shown as written, not as a value', () => {
    const w = warned('# T\n\nThe value is \\val{n} now.\n');
    expect(w).toHaveLength(1);
    expect(w[0][0]).toBe(3);
    expect(w[0][1]).toBe(14);
    expect(String(w[0][2])).toMatch(/\\val\{n\} in the document's text is shown as written/);
  });
  it('is not warned of in code, inline or fenced, nor in a widget’s own text', () => {
    expect(warned('Write `\\val{n}` in a widget.\n\n```text\n\\val{n}\n```\n\n```mkp\nw "w"\n  in n int = 1\n  text "\\val{n}"\n  project md = "w"\n```\n\n```w\nsummary: s\n```\n')).toEqual([]);
  });
  it('is warned of inside a container’s prose too', () => {
    expect(warned('```mkp\nbox "b"\n  in body slot\n  slot body\n  project md = "b"\n```\n\n:::box\nIn \\val{x}.\n:::\n')).toHaveLength(1);
  });
});
