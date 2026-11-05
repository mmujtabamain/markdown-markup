// @vitest-environment jsdom
// The Markdown preview: what a reader without MKP sees, drawn by a plain GitHub-style renderer.
import { describe, expect, it } from 'vitest';
import { MathsEngine, writeMarkdown } from '@mkp/core';
import { build } from '../src/build';
import { catalog } from '../src/catalog';
import { markdownToHtml } from '../src/markdown-preview';

const examples = catalog().filter((e) => e.kind === 'example');

describe('the Markdown preview', () => {
  it('draws GitHub’s alerts, tables, task lists and footnotes', () => {
    const html = markdownToHtml('> [!TIP]\n> Walk the sand.\n\n| a | b |\n|---|--:|\n| 1 | 2 |\n\n- [x] done\n- [ ] not yet\n\nA note.[^n]\n\n[^n]: The note.\n');
    const d = document.createElement('div');
    d.innerHTML = html;
    expect(d.querySelector('.markdown-alert-tip .markdown-alert-title')!.textContent).toBe('Tip');
    expect(d.querySelector('.markdown-alert-tip p:not(.markdown-alert-title)')!.textContent).toBe('Walk the sand.');
    expect(d.querySelectorAll('td')).toHaveLength(2);
    expect(d.querySelectorAll('input[type=checkbox]')).toHaveLength(2);
    expect(d.querySelector('sup a')!.textContent).toBe('1');
    expect(d.querySelector('.footnotes li')!.textContent).toContain('The note.');
  });

  it('typesets $…$, $$…$$ and ```math with the core’s engine, and leaves \\$ alone', async () => {
    const maths = await MathsEngine.create({ speech: false });
    const html = markdownToHtml('Costs \\$5, and $x^2$ is a square.\n\n$$\n\\frac{a}{b}\n$$\n\n```math\ny = 1\n```\n', { maths });
    const d = document.createElement('div');
    d.innerHTML = html;
    expect(d.querySelectorAll('.pg-math svg')).toHaveLength(3);
    expect(d.querySelectorAll('.pg-math-display')).toHaveLength(2);
    expect(d.textContent).toContain('Costs $5');
  });

  it('draws what each example exports', async () => {
    const maths = await MathsEngine.create({ speech: false });
    for (const e of examples) {
      const b = build(e.files).bundle!;
      const md = writeMarkdown(b, { toggles: ['gfm', 'math', 'mermaid', 'html'] }).md;
      expect(() => markdownToHtml(md, { maths }), e.id).not.toThrow();
    }
  });

  it('is sanitised: a shared link can carry any document', () => {
    const html = markdownToHtml('<script>alert(1)</script>\n\n<img src=x onerror="alert(1)">\n\n[x](javascript:alert(1))\n');
    expect(html).not.toMatch(/<script|onerror|javascript:/);
  });

  it('finds pictures beside the document', () => {
    const html = markdownToHtml('![a beach](tide.svg)', { image: (h) => (h === 'tide.svg' ? '/assets/tide-123.svg' : undefined) });
    expect(html).toContain('src="/assets/tide-123.svg"');
  });
});
