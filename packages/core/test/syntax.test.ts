import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { Diagnostics, formatDiagnostic } from '../src/diag';
import { parseMkp, parseExprString } from '../src/syntax/mkp';

const where: Record<string, string> = { 'roots.mkp': 'examples/spec18', 'acme.mkp': 'examples/spec18', 'tree.mkp': 'packs/mkp-diagrams', 'graph.mkp': 'packs/mkp-diagrams', 'tabs.mkp': 'packs/mkp-ui' };
const ex = (n: string) => readFileSync(new URL(`../../../${where[n]}/${n}`, import.meta.url), 'utf8');

describe('mkp parser', () => {
  for (const f of ['roots.mkp', 'tree.mkp', 'graph.mkp', 'tabs.mkp', 'acme.mkp']) {
    it(`parses ${f}`, () => {
      const d = new Diagnostics();
      const file = parseMkp(ex(f), f, d);
      expect(d.items.map(formatDiagnostic)).toEqual([]);
      expect(file.items.length).toBeGreaterThan(0);
    });
  }
  it('precedence', () => {
    const show = (s: string): string => {
      const e = parseExprString(s);
      const go = (x: any): string => {
        switch (x.k) {
          case 'num': return String(x.v);
          case 'id': return x.name;
          case 'bin': return `(${go(x.a)} ${x.juxt ? '·' : x.op} ${go(x.b)})`;
          case 'neg': return `(-${go(x.a)})`;
          case 'call': return `${x.f}(${x.args.map(go).join(', ')})`;
          default: return x.k;
        }
      };
      return go(e);
    };
    expect(show('2^3^2')).toBe('(2 ^ (3 ^ 2))');
    expect(show('-x^2')).toBe('(-(x ^ 2))');
    expect(show('a/b c')).toBe('(a / (b · c))');
    expect(show('1/2x')).toBe('(1 / (2 · x))');
    expect(show('2 pi i k/n')).toBe('((((2 · pi) · i) · k) / n)');
    expect(show('exp(a) cos(b)')).toBe('(exp(a) · cos(b))');
    expect(show('f (x)')).toBe('(f · x)');
    expect(show('x^-1')).toBe('(x ^ (-1))');
    expect(show('0.5i')).toBe('(0.5 · i)');
  });
});

describe('Markdown blocks', () => {
  it('a multi-line paragraph in a quote or an alert loses its "> " markers', async () => {
    const { markdownToNodes } = await import('../src/markdown');
    const [alert] = markdownToNodes('> [!NOTE]\n> A note: background\n> worth knowing.\n', 1, []);
    expect(alert.props?.alert).toEqual({ lit: 'note' });
    expect(alert.children?.[0].props?.text).toEqual({ text: 'A note: background\nworth knowing.' });
    const [quote] = markdownToNodes('> one line\n> and the next\n', 1, []);
    expect(quote.children?.[0].props?.text).toEqual({ text: 'one line\nand the next' });
    const [nested] = markdownToNodes('> > deep\n> > deeper\n', 1, []);
    expect(nested.children?.[0].children?.[0].props?.text).toEqual({ text: 'deep\ndeeper' });
  });
});

describe('footnotes', () => {
  it('a reference is a footnote run though its definition is elsewhere in the document', async () => {
    const { inlineRuns } = await import('../src/markdown');
    expect(inlineRuns('Maths, with a footnote[^engine].')).toEqual([{ t: 'text', v: 'Maths, with a footnote' }, { t: 'fnref', label: 'engine' }, { t: 'text', v: '.' }]);
    expect(inlineRuns('Not one: `[^x]` in code.')).toEqual([{ t: 'text', v: 'Not one: ' }, { t: 'code', v: '[^x]' }, { t: 'text', v: ' in code.' }]);
  });
});
