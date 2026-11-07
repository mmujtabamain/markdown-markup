// The site's docs, compiled once. Each page is written in MKP (docs-src/<slug>.mkp.md); this checks
// it, writes its Markdown and draws that as HTML, maths as SVG, into a static page in public/docs/
// that the site serves as it is. The pages carry no MKP: no bundle, no runtime, no maths engine,
// no React; only a few lines of script for the theme and for links from before the docs moved.
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { compile, Diagnostics, formatDiagnostic, MathsEngine, writeMarkdown } from '../../../packages/core/src/index';
import { markdownToHtml } from '../../../packages/page/src/markdown';

// the site's folder, given by scripts/docs.mjs (this runs bundled, from elsewhere)
const site = resolve(process.argv[2]);
const src = join(site, 'docs-src');
const out = join(site, 'public/docs');
const REPO = 'https://github.com/mmujtabamain/markdown-markup';

/** The pages in reading order; the first is docs/index.html. */
const PAGES = [
  { slug: 'getting-started', label: 'Getting started' },
  { slug: 'writing', label: 'Writing documents' },
  { slug: 'widgets', label: 'Your own widgets' },
  { slug: 'base-set', label: 'The base set' },
  { slug: 'in-your-app', label: 'In your app' },
  { slug: 'recipes', label: 'Recipes' },
  { slug: 'cli', label: 'The CLI' },
];
const fileOf = (i: number): string => (i === 0 ? 'index.html' : `${PAGES[i].slug}.html`);

const esc = (s: string): string => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const idOf = (html: string): string =>
  html
    .replace(/<[^>]+>/g, '')
    .replace(/&[a-z]+;|&#\d+;/g, '')
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, '-')
    .replace(/^-|-$/g, '');

/** Ids on the ## and ### headings, and the outline they make. */
function headings(html: string): { html: string; outline: { depth: number; id: string; text: string }[]; title: string } {
  const outline: { depth: number; id: string; text: string }[] = [];
  let title = '';
  const seen = new Set<string>();
  const drawn = html.replace(/<h([1-3])>([\s\S]*?)<\/h\1>/g, (_, d: string, inner: string) => {
    if (d === '1') {
      title ||= inner.replace(/<[^>]+>/g, '');
      return `<h1>${inner}</h1>`;
    }
    let id = idOf(inner);
    for (let n = 2; seen.has(id); n++) id = `${idOf(inner)}-${n}`;
    seen.add(id);
    outline.push({ depth: Number(d), id, text: inner.replace(/<[^>]+>/g, '') });
    return `<h${d} id="${id}"><a class="anchor" href="#${id}" aria-hidden="true">#</a>${inner}</h${d}>`;
  });
  return { html: drawn, outline, title };
}

/** A link in a page: another page here (`writing.mkp.md`), a repository path (on GitHub), or as written. */
function links(html: string): string {
  // links within the site open in place; markdownToHtml opens every other link in a new tab
  const here = (href: string): string => `<a href="${href}">`;
  return html.replace(/<a href="([^"]+)"( target="_blank" rel="noreferrer noopener")?>/g, (m, href: string) => {
    if (/^[a-z]+:|^#|^\/\//i.test(href)) return m;
    const [path, hash = ''] = href.split('#');
    const page = PAGES.findIndex((p) => path === `${p.slug}.mkp.md`);
    if (page >= 0) return here(`${fileOf(page)}${hash ? `#${hash}` : ''}`);
    if (path.startsWith('../examples/')) return here(href);
    const clean = path.replace(/^(\.\.\/)+/, '');
    return `<a href="${REPO}/${clean.endsWith('/') ? 'tree' : 'blob'}/main/${clean}${hash ? `#${hash}` : ''}" target="_blank" rel="noreferrer noopener">`;
  });
}

const LOGO = '<span class="logo-mark" aria-hidden="true">M↓</span><span class="logo-name">MKP</span><span class="logo-sub">Markdown Markup</span>';
const SUN = '<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4"/></svg>';
const MOON = '<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><path d="M12 3a6 6 0 0 0 9 9 9 9 0 1 1-9-9"/></svg>';
const GITHUB = '<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M15 22v-4a4.8 4.8 0 0 0-1-3.5c3 0 6-2 6-5.5.08-1.25-.27-2.48-1-3.5.28-1.15.28-2.35 0-3.5 0 0-1 0-3 1.5-2.64-.5-5.36-.5-8 0C6 2 5 2 5 2c-.3 1.15-.3 2.35 0 3.5A5.403 5.403 0 0 0 4 9c0 3.5 3 5.5 6 5.5-.39.49-.68 1.05-.85 1.65-.17.6-.22 1.23-.15 1.85v4"/><path d="M9 18c-4.51 2-5-2-7-2"/></svg>';

// before the page draws: the site's theme (shared with the landing page and the examples), and
// links from when the examples lived at docs/ (#e=…) sent on to them
const HEAD_SCRIPT = `(function(){var h=location.hash;if(/(^#|&)(e|src|out|pane)=/.test(h)){location.replace('../examples/'+h);return}var t=null;try{t=localStorage.getItem('site/theme')}catch(e){}if(t!=='light'&&t!=='dark')t=matchMedia('(prefers-color-scheme: dark)').matches?'dark':'light';document.documentElement.classList.toggle('dark',t==='dark')})();`;
const THEME_SCRIPT = `document.querySelector('[data-theme-toggle]').addEventListener('click',function(){var d=document.documentElement.classList.toggle('dark');try{localStorage.setItem('site/theme',d?'dark':'light');localStorage.setItem('pg/theme',d?'dark':'light')}catch(e){}});`;

function page(i: number, body: string, outline: { depth: number; id: string; text: string }[], title: string, description: string): string {
  const nav = PAGES.map((p, j) => `<a href="${fileOf(j)}"${i === j ? ' aria-current="page"' : ''}>${esc(p.label)}</a>`).join('\n        ');
  const toc = outline.map((h) => `<li class="d${h.depth}"><a href="#${h.id}">${esc(h.text)}</a></li>`).join('\n          ');
  const prev = i > 0 ? `<a class="prev" href="${fileOf(i - 1)}">← ${esc(PAGES[i - 1].label)}</a>` : '<span></span>';
  const next = i < PAGES.length - 1 ? `<a class="next" href="${fileOf(i + 1)}">${esc(PAGES[i + 1].label)} →</a>` : '';
  return `<!doctype html>
<!-- generated by pnpm site:docs from apps/site/docs-src/${PAGES[i].slug}.mkp.md: edit that, not this -->
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>${esc(PAGES[i].label)} · MKP docs</title>
  <meta name="description" content="${esc(description)}">
  <link rel="stylesheet" href="docs.css">
  <script>${HEAD_SCRIPT}</script>
</head>
<body>
  <header class="top">
    <a class="logo" href="../" aria-label="MKP home">${LOGO}</a>
    <nav class="sections" aria-label="Site">
      <a href="./" aria-current="page">Docs</a>
      <a href="../examples/">Examples</a>
      <a href="../whats-new/"><span class="long">What's new</span><span class="short">New</span></a>
      <a href="../migrations/"><span class="long">Migrations</span><span class="short">Migrate</span></a>
      <a class="wide" href="${REPO}/releases">Releases</a>
      <a class="icon" href="${REPO}" aria-label="MKP on GitHub">${GITHUB}</a>
      <button class="icon" type="button" data-theme-toggle aria-label="Light or dark">${MOON}${SUN}</button>
    </nav>
  </header>
  <div class="layout">
    <aside class="pages">
      <details class="pages-menu">
        <summary>${esc(PAGES[i].label)}</summary>
        <nav aria-label="Docs">
        ${nav}
        </nav>
      </details>
      <nav class="pages-list" aria-label="Docs">
        ${nav}
      </nav>
    </aside>
    <main>
      <article class="doc" data-doc="${PAGES[i].slug}">
${body}
      </article>
      <nav class="prev-next" aria-label="Previous and next">${prev}${next}</nav>
    </main>
    <aside class="outline" aria-label="On this page">
      <p>On this page</p>
      <ul>
          ${toc}
      </ul>
    </aside>
  </div>
  <script>${THEME_SCRIPT}</script>
</body>
</html>
`;
}

const check = process.argv.includes('--check');
const maths = await MathsEngine.create({ speech: false });
let bad = 0;
mkdirSync(out, { recursive: true });
for (const [i, p] of PAGES.entries()) {
  const file = join(src, `${p.slug}.mkp.md`);
  const text = readFileSync(file, 'utf8');
  const c = compile({ packs: [] });
  const d = new Diagnostics();
  const bundle = c.document(text, `apps/site/docs-src/${p.slug}.mkp.md`, d);
  if (!bundle || !d.ok || d.warnings.length) {
    console.error([...d.errors, ...d.warnings].map(formatDiagnostic).join('\n'));
    bad++;
    continue;
  }
  const description = typeof bundle.doc.front?.description === 'string' ? bundle.doc.front.description : `${p.label}: the MKP docs.`;
  const md = writeMarkdown(bundle, { toggles: ['gfm', 'math'], maths }).md;
  const h = headings(links(markdownToHtml(md, { maths })));
  const html = page(i, h.html, h.outline, h.title, description);
  const target = join(out, fileOf(i));
  if (check) {
    if (!existsSync(target) || readFileSync(target, 'utf8') !== html) {
      console.error(`public/docs/${fileOf(i)} is not what docs-src/${p.slug}.mkp.md compiles to: run pnpm site:docs`);
      bad++;
    }
  } else writeFileSync(target, html);
}
if (!bad) console.log(`site docs: ${PAGES.length} pages ${check ? 'match their sources' : 'written to public/docs/'}`);
process.exit(bad ? 1 : 0);
