import { describe, expect, it } from 'vitest';
import { Diagnostics, formatDiagnostic } from '../src/diag';
import { parseMkp, parseExprString } from '../src/syntax/mkp';
import { parseDoc } from '../src/syntax/doc';
import { compile } from '../src/build';
import { examples } from './examples.test';

const files = examples().flatMap((e) => [
  ...e.packs.flatMap((p) => [...p.files!].filter(([n]) => n.endsWith('.mkp')).map(([n, b]) => [`${p.label}/${n}`, new TextDecoder().decode(b), false] as const)),
  ...(e.docFile ? [[e.docFile.file, e.docFile.text, true] as const] : []),
]);

describe('mkp parser', () => {
  for (const [f, text, inline] of files) {
    it(`parses ${f}`, () => {
      const d = new Diagnostics();
      const file = parseMkp(text, f, d, { inline });
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

describe('fences: Markdown first (SN 139)', () => {
  const items = (src: string) => parseDoc(src, 'doc.mkp.md', new Diagnostics()).items.map((it) => (it.k === 'block' ? `block:${it.name}` : it.k));
  const fence = (label: string, body: string) => `# T\n\n\`\`\`${label}\n${body}\n\`\`\`\n`;

  it('a code language, plain text or math is Markdown, even when the body looks like a widget', () => {
    for (const label of ['text', 'txt', 'yaml', 'YAML', 'markdown', 'sh', 'ts title="a.ts"', 'math']) {
      expect(items(fence(label, 'label: Next\nvalue: 3')), label).not.toContain(`block:${label.split(' ')[0]}`);
      expect(items(fence(label, 'label: Next\nvalue: 3')).some((k) => k.startsWith('block:')), label).toBe(false);
    }
  });

  it('a label Markdown has no meaning for names a widget', () => {
    expect(items(fence('pager', 'label: Next'))).toContain('block:pager');
    expect(items(fence('pager #intro', 'label: Next'))).toContain('block:pager');
    // the base widget `text` shares a label with plain text: Markdown has it
    expect(items(fence('text #intro', 'value: hi'))).toEqual(['md']);
  });

  it('a document of code fences compiles clean: no unknown widgets, no maths in code', () => {
    const src = '# Setup\n\n```yaml\nlabel: Next\nsteps: 3\n```\n\n```sh\necho $HOME and $PATH\n```\n\n<!-- a note -->\n';
    const c = compile({ packs: [] });
    c.document(src, 'doc.mkp.md');
    expect(c.diags.errors.map(formatDiagnostic)).toEqual([]);
    expect(c.diags.warnings.map((d) => d.code)).toEqual([]);
  });
});
