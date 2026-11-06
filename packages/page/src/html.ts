// The HTML of a standalone page (mkp build --target html and --target html-md): one file that opens
// offline in any browser, showing only the document. No DOM: the CLI writes these in Node.
//
// --target html: the document's IR bundle in a JSON script tag, and the page script (dist/page.js,
// src/page.tsx: @mkp/react's neutral renderer with the core runtime and maths engine) inlined after
// it. The document's Markdown, drawn as HTML, is in the page too: it is what a reader sees with
// scripts off, and what the page shows if the renderer can't start.
// --target html-md: only that Markdown, drawn as HTML. No script at all.

/** The page's own styles: the page around the document, and the Markdown's look. */
export const PAGE_CSS = `
:root { color-scheme: light dark; }
html, body { margin: 0; }
body { background: var(--mkp-page-bg, #fff); color: var(--mkp-page-ink, #1a1c1f); }
@media (prefers-color-scheme: dark) { :root:not([data-theme=light]) body { --mkp-page-bg: #15171a; --mkp-page-ink: #eceef1; } }
:root[data-theme=dark] body { --mkp-page-bg: #15171a; --mkp-page-ink: #eceef1; }
.mkp-page { box-sizing: border-box; max-width: 960px; margin: 0 auto; padding: 24px 16px 48px; }
.mkp-js .mkp-page > .mkp-md { display: none; }
.mkp-page-error { margin: 0 0 16px; padding: 8px 12px; border: 1px solid #c62828; border-radius: 8px; font: 14px system-ui, sans-serif; }
.mkp-md { --md-line: #d8dadd; --md-soft: #f3f4f5; --md-muted: #5f646b; --md-link: #1f6feb;
  --md-note: #1f6feb; --md-tip: #1a7f37; --md-important: #8250df; --md-warning: #9a6700; --md-caution: #cf222e;
  font: 16px/1.6 system-ui, -apple-system, "Segoe UI", sans-serif; overflow-wrap: break-word; }
@media (prefers-color-scheme: dark) { :root:not([data-theme=light]) .mkp-md { --md-line: #3a3d42; --md-soft: #1e2023; --md-muted: #a1a6ad; --md-link: #58a6ff;
  --md-note: #58a6ff; --md-tip: #3fb950; --md-important: #a371f7; --md-warning: #d29922; --md-caution: #f85149; } }
:root[data-theme=dark] .mkp-md { --md-line: #3a3d42; --md-soft: #1e2023; --md-muted: #a1a6ad; --md-link: #58a6ff;
  --md-note: #58a6ff; --md-tip: #3fb950; --md-important: #a371f7; --md-warning: #d29922; --md-caution: #f85149; }
.mkp-md > :first-child { margin-top: 0; }
.mkp-md :is(p, ul, ol, blockquote, table, pre, details, .markdown-alert, .mkp-math-display) { margin: 0 0 1rem; }
.mkp-md :is(h1, h2) { padding-bottom: .3em; border-bottom: 1px solid var(--md-line); }
.mkp-md h1 { margin: 1.5rem 0 1rem; font-size: 1.9em; line-height: 1.25; }
.mkp-md h2 { margin: 1.5rem 0 1rem; font-size: 1.45em; line-height: 1.3; }
.mkp-md h3 { margin: 1.25rem 0 .75rem; font-size: 1.15em; }
.mkp-md :is(h4, h5, h6) { margin: 1rem 0 .5rem; font-size: 1em; }
.mkp-md a { color: var(--md-link); text-underline-offset: 2px; }
.mkp-md :is(ul, ol) { padding-left: 1.6em; }
.mkp-md li + li { margin-top: .25rem; }
.mkp-md li:has(> input[type=checkbox]) { list-style: none; margin-left: -1.25rem; }
.mkp-md li > input[type=checkbox] { margin-right: .4rem; }
.mkp-md blockquote { margin-left: 0; padding-left: 1em; border-left: 4px solid var(--md-line); color: var(--md-muted); }
.mkp-md code { padding: .15em .35em; border-radius: 4px; background: var(--md-soft); font: .875em ui-monospace, SFMono-Regular, Menlo, monospace; }
.mkp-md pre { overflow-x: auto; padding: 12px 14px; border-radius: 8px; background: var(--md-soft); line-height: 1.45; }
.mkp-md pre code { padding: 0; background: none; }
.mkp-md .mkp-code-label { margin-bottom: 4px; font-size: .8em; color: var(--md-muted); }
.mkp-md table { display: block; width: max-content; max-width: 100%; overflow-x: auto; border-collapse: collapse; }
.mkp-md :is(th, td) { padding: 6px 12px; border: 1px solid var(--md-line); }
.mkp-md tr:nth-child(2n) td { background: var(--md-soft); }
.mkp-md hr { height: 4px; margin: 1.5rem 0; border: 0; border-radius: 2px; background: var(--md-line); }
.mkp-md img { max-width: 100%; }
.mkp-md details { padding: 8px 12px; border: 1px solid var(--md-line); border-radius: 8px; }
.mkp-md summary { cursor: pointer; font-weight: 600; }
.mkp-md .mkp-math svg { display: inline-block; }
.mkp-md .mkp-math-display { overflow-x: auto; text-align: center; }
.mkp-md .mkp-math-error { color: var(--md-caution); }
.mkp-md .markdown-alert { padding: 2px 0 2px 14px; border-left: 4px solid var(--md-alert); }
.mkp-md .markdown-alert > :last-child { margin-bottom: 0; }
.mkp-md .markdown-alert-title { display: flex; align-items: center; gap: 8px; margin: 0 0 4px; font-weight: 600; color: var(--md-alert); }
.mkp-md .markdown-alert-note { --md-alert: var(--md-note); }
.mkp-md .markdown-alert-tip { --md-alert: var(--md-tip); }
.mkp-md .markdown-alert-important { --md-alert: var(--md-important); }
.mkp-md .markdown-alert-warning { --md-alert: var(--md-warning); }
.mkp-md .markdown-alert-caution { --md-alert: var(--md-caution); }
.mkp-md .footnotes { margin-top: 2rem; padding-top: .5rem; border-top: 1px solid var(--md-line); font-size: .9em; color: var(--md-muted); }
.mkp-md .sr-only { position: absolute; width: 1px; height: 1px; overflow: hidden; clip: rect(0 0 0 0); white-space: nowrap; }
`;

const esc = (s: string): string => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

/** Text safe inside a <script> element: a `</script` in it would end the element early. */
const scriptSafe = (s: string): string => s.replace(/<\/(script)/gi, '<\\/$1').replace(/<!--/g, '<\\!--');

/** JSON safe inside <script type="application/json">: `<` written as <, which JSON reads back. */
const jsonSafe = (json: string): string => json.replace(/</g, '\\u003c');

/** A document's title: its first `# heading` in the Markdown, else the file's name. */
export function pageTitle(md: string, fallback: string): string {
  const h = /^#[ \t]+(.+?)[ \t#]*$/m.exec(md.replace(/^<!--[\s\S]*?-->\s*/, ''));
  return (h?.[1] ?? fallback).replace(/[*_`$\\]/g, '').trim() || fallback;
}

/** Sets the theme from #theme=dark|light before anything is drawn, so a page never flashes. */
const THEME_JS = `(function(){var m=/(?:^#|&)theme=(dark|light)\\b/.exec(location.hash);if(m)document.documentElement.setAttribute('data-theme',m[1]);document.documentElement.classList.add('mkp-js')})();`;

export interface HtmlPageOptions {
  /** the page's title */
  title: string;
  /** the IR bundle, as JSON text */
  bundleJson: string;
  /** the page script (dist/page.js) */
  script: string;
  /** the document's Markdown drawn as HTML: shown with scripts off, and if the renderer can't start */
  fallbackHtml: string;
  lang?: string;
}

/** A standalone page that draws an MKP document (mkp build --target html). */
export function htmlPage(o: HtmlPageOptions): string {
  return `<!doctype html>
<html lang="${esc(o.lang ?? 'en')}">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="generator" content="mkp">
<title>${esc(o.title)}</title>
<script>${THEME_JS}</script>
<style>${PAGE_CSS}</style>
</head>
<body>
<main class="mkp-page" id="mkp-page">
<article class="mkp-md">
${o.fallbackHtml}
</article>
</main>
<script type="application/json" id="mkp-bundle">${jsonSafe(o.bundleJson)}</script>
<script>${scriptSafe(o.script)}</script>
</body>
</html>
`;
}

export interface MarkdownPageOptions {
  title: string;
  /** the Markdown drawn as HTML (markdownToHtml) */
  html: string;
  lang?: string;
}

/** A standalone page of a document's Markdown, drawn as HTML (mkp build --target html-md). */
export function markdownPage(o: MarkdownPageOptions): string {
  return `<!doctype html>
<html lang="${esc(o.lang ?? 'en')}">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="generator" content="mkp">
<title>${esc(o.title)}</title>
<script>${THEME_JS.replace("document.documentElement.classList.add('mkp-js')", '')}</script>
<style>${PAGE_CSS}</style>
</head>
<body>
<main class="mkp-page">
<article class="mkp-md">
${o.html}
</article>
</main>
</body>
</html>
`;
}
