// Markdown drawn as HTML: an MKP document's Markdown output the way a plain GitHub-style renderer
// shows it, which is what a reader without MKP sees. GFM (tables, task lists, strikethrough),
// footnotes, GitHub's alerts (> [!TIP]), and maths ($…$, $$…$$ and ```math) typeset by the core's
// own engine as SVG. Mermaid fences stay code, as on a renderer without diagrams. Raw HTML in the
// Markdown is shown as text, never run; a host that wants HTML through passes its own sanitiser.
// No DOM: it runs in Node (mkp build --target html-md) and in browsers (the playground).

import { Marked, type RendererObject, type TokenizerAndRendererExtension, type Tokens } from 'marked';
import type { MathsRenderer } from '@mkp/core';

export interface PreviewOptions {
  maths?: MathsRenderer | null;
  /** a URL for an image the Markdown names (a picture beside the document, or a written file) */
  image?: (href: string) => string | undefined;
  /** raw HTML in the Markdown goes through this (a DOM sanitiser); without it, it shows as text */
  sanitize?: (html: string) => string;
}

const ALERTS: Record<string, { title: string; icon: string }> = {
  note: { title: 'Note', icon: '<path d="M12 16v-4M12 8h.01"/><circle cx="12" cy="12" r="10"/>' },
  tip: { title: 'Tip', icon: '<path d="M9 18h6M10 22h4M12 2a7 7 0 0 0-4 12.7V17h8v-2.3A7 7 0 0 0 12 2z"/>' },
  important: { title: 'Important', icon: '<path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/><path d="M12 7v4M12 15h.01"/>' },
  warning: { title: 'Warning', icon: '<path d="m21.7 18-8-14a2 2 0 0 0-3.4 0l-8 14A2 2 0 0 0 4 21h16a2 2 0 0 0 1.7-3z"/><path d="M12 9v4M12 17h.01"/>' },
  caution: { title: 'Caution', icon: '<path d="M7.9 2h8.2L22 7.9v8.2L16.1 22H7.9L2 16.1V7.9z"/><path d="M12 8v4M12 16h.01"/>' },
};

const esc = (s: string): string => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

function mathHtml(tex: string, display: boolean, maths?: MathsRenderer | null): string {
  const r = maths?.render(tex, display);
  if (!r) return display ? `<pre class="mkp-math-error"><code>${esc(tex)}</code></pre>` : `<code class="mkp-math-error">${esc(tex)}</code>`;
  return display ? `<div class="mkp-math mkp-math-display" role="img" aria-label="${esc(tex)}">${r.svg}</div>` : `<span class="mkp-math" role="img" aria-label="${esc(tex)}">${r.svg}</span>`;
}

export function markdownToHtml(md: string, opts: PreviewOptions = {}): string {
  const notes = new Map<string, string>();
  const order: string[] = [];
  const marked = new Marked({ gfm: true, breaks: false });

  const inlineMath: TokenizerAndRendererExtension = {
    name: 'inlineMath',
    level: 'inline',
    start: (src) => {
      const i = src.search(/(?<!\\)\$/);
      return i < 0 ? undefined : i;
    },
    tokenizer(src) {
      const m = /^\$(?!\s)((?:\\.|[^\\$\n])+?)(?<!\s)\$(?!\d)/.exec(src);
      return m ? { type: 'inlineMath', raw: m[0], text: m[1] } : undefined;
    },
    renderer: (t) => mathHtml(String(t.text), false, opts.maths),
  };
  const blockMath: TokenizerAndRendererExtension = {
    name: 'blockMath',
    level: 'block',
    start: (src) => {
      const i = src.search(/^\$\$/m);
      return i < 0 ? undefined : i;
    },
    tokenizer(src) {
      const m = /^\$\$[ \t]*\n?([\s\S]+?)\n?\$\$[ \t]*(?:\n+|$)/.exec(src);
      return m ? { type: 'blockMath', raw: m[0], text: m[1].trim() } : undefined;
    },
    renderer: (t) => mathHtml(String(t.text), true, opts.maths),
  };
  const alert: TokenizerAndRendererExtension = {
    name: 'alert',
    level: 'block',
    start: (src) => {
      const i = src.search(/^ {0,3}> ?\[!/m);
      return i < 0 ? undefined : i;
    },
    tokenizer(src) {
      const m = /^ {0,3}> ?\[!(NOTE|TIP|IMPORTANT|WARNING|CAUTION)\][ \t]*\n((?: {0,3}>.*(?:\n|$))*)/i.exec(src);
      if (!m) return undefined;
      const body = m[2].replace(/^ {0,3}> ?/gm, '');
      return { type: 'alert', raw: m[0], kind: m[1].toLowerCase(), tokens: this.lexer.blockTokens(body, []) };
    },
    renderer(t) {
      const a = ALERTS[String(t.kind)] ?? ALERTS.note;
      const icon = `<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${a.icon}</svg>`;
      return `<div class="markdown-alert markdown-alert-${String(t.kind)}"><p class="markdown-alert-title">${icon}${a.title}</p>${this.parser.parse(t.tokens ?? [])}</div>\n`;
    },
  };
  const footnoteDef: TokenizerAndRendererExtension = {
    name: 'footnoteDef',
    level: 'block',
    start: (src) => {
      const i = src.search(/^\[\^[^\]\s]+\]:/m);
      return i < 0 ? undefined : i;
    },
    tokenizer(src) {
      const m = /^\[\^([^\]\s]+)\]:[ \t]*((?:.*)(?:\n(?: {2,}|\t).*)*)(?:\n+|$)/.exec(src);
      if (!m) return undefined;
      notes.set(m[1], m[2].replace(/\n(?: {2,}|\t)/g, ' ').trim());
      return { type: 'footnoteDef', raw: m[0] };
    },
    renderer: () => '',
  };
  const footnoteRef: TokenizerAndRendererExtension = {
    name: 'footnoteRef',
    level: 'inline',
    start: (src) => {
      const i = src.indexOf('[^');
      return i < 0 ? undefined : i;
    },
    tokenizer(src) {
      const m = /^\[\^([^\]\s]+)\]/.exec(src);
      return m ? { type: 'footnoteRef', raw: m[0], id: m[1] } : undefined;
    },
    renderer(t) {
      const id = String(t.id);
      if (!notes.has(id)) return esc(String(t.raw));
      // numbered by first reference, as GitHub does
      if (!order.includes(id)) order.push(id);
      const n = order.indexOf(id) + 1;
      const slug = encodeURIComponent(id);
      return `<sup><a href="#fn-${slug}" id="fnref-${slug}" class="mkp-fnref">${n}</a></sup>`;
    },
  };

  const renderer: RendererObject = {
    html(t: Tokens.HTML | Tokens.Tag) {
      // a comment (the writer's "generated by mkp" line) stays a comment; other HTML shows as text
      if (/^\s*<!--(?:(?!-->)[\s\S])*-->\s*$/.test(t.text)) return t.text;
      return opts.sanitize ? t.text : esc(t.text);
    },
    code(t: Tokens.Code) {
      const lang = (t.lang ?? '').trim().split(/\s+/)[0];
      if (lang === 'math') return mathHtml(t.text, true, opts.maths);
      const label = lang === 'mermaid' ? '<div class="mkp-code-label">mermaid: a diagram where the renderer draws Mermaid</div>' : '';
      return `${label}<pre${lang ? ` data-lang="${esc(lang)}"` : ''}><code>${esc(t.text)}</code></pre>\n`;
    },
    image(t: Tokens.Image) {
      const src = opts.image?.(t.href) ?? t.href;
      return `<img src="${esc(src)}" alt="${esc(t.text)}"${t.title ? ` title="${esc(t.title)}"` : ''}>`;
    },
    link(t: Tokens.Link) {
      const inner = this.parser.parseInline(t.tokens);
      if (t.href.startsWith('#')) return `<a href="${esc(t.href)}">${inner}</a>`;
      return `<a href="${esc(t.href)}" target="_blank" rel="noreferrer noopener"${t.title ? ` title="${esc(t.title)}"` : ''}>${inner}</a>`;
    },
  };

  marked.use({ extensions: [blockMath, alert, footnoteDef, inlineMath, footnoteRef], renderer });
  let html = marked.parse(md, { async: false });
  if (order.length) {
    const items = order.map((id) => {
      const slug = encodeURIComponent(id);
      return `<li id="fn-${slug}">${marked.parseInline(notes.get(id) ?? '', { async: false })} <a href="#fnref-${slug}" class="mkp-fnback" aria-label="Back to the reference">↩</a></li>`;
    });
    html += `<section class="footnotes" data-footnotes><h2 class="sr-only">Footnotes</h2><ol>${items.join('')}</ol></section>`;
  }
  return opts.sanitize ? opts.sanitize(html) : html;
}
