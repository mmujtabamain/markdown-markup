// What's new, built once with the site: every changelog's text as plain HTML in the page (for search
// engines and readers with scripts off; the page takes over when it loads), and an Atom feed with an
// entry per release. Both go in apps/site/.generated/, which vite.config.ts puts in the build.
import { mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { compile, writeMarkdown } from '../../../packages/core/src/index';
import { markdownToHtml } from '../../../packages/page/src/markdown';
import { longDate, newestFirst, readChangelog } from '../src/site/changelog';

export const SITE = 'https://mmujtabamain.github.io/markdown-markup/';

const esc = (s: string): string => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

/** A changelog as plain HTML: its Markdown (each widget's own Markdown in its place), drawn. */
export function changelogHtml(source: string, file: string): string {
  const b = compile({ packs: [] }).document(source, file);
  const md = b ? writeMarkdown(b, { toggles: ['gfm'] }).md.replace(/^<!--[\s\S]*?-->\s*/, '') : source.replace(/^---[\s\S]*?\n---\n/, '');
  return markdownToHtml(md, { maths: null });
}

export function build(repo: string, out: string): void {
  const dir = join(repo, 'changelog');
  const list = readdirSync(dir)
    .filter((f) => f.endsWith('.mkp.md'))
    .map((f) => ({ file: `changelog/${f}`, source: readFileSync(join(dir, f), 'utf8') }))
    .map((x) => ({ ...x, r: readChangelog(x.source, x.file) }))
    .sort((a, b) => newestFirst(a.r, b.r));
  mkdirSync(out, { recursive: true });
  // the page's content before its script runs
  const body = list
    .map(({ r, source, file }) => `<article id="${esc(r.version)}"><h2><a href="#${esc(r.version)}">Version ${esc(r.version)}</a></h2><p><time datetime="${esc(r.date)}">${esc(longDate(r.date))}</time></p><p>${esc(r.summary)}</p>${changelogHtml(source, file).replace(/<h1[^>]*>[\s\S]*?<\/h1>/, '')}</article>`)
    .join('\n');
  writeFileSync(join(out, 'whats-new.html'), `<main class="whats-new-static" style="max-width:48rem;margin:0 auto;padding:2.5rem 1rem;font-family:system-ui,sans-serif"><h1>What's new</h1><p>What changed in each version of MKP, newest first.</p><p><a href="feed.xml">Feed</a></p>\n${body}</main>`);
  // the feed: one entry per release, newest first
  const updated = list[0]?.r.date ?? '1970-01-01';
  const entries = list
    .map(({ r, source, file }) => `  <entry>\n    <title>MKP ${esc(r.version)}</title>\n    <id>${SITE}whats-new/#${esc(r.version)}</id>\n    <link href="${SITE}whats-new/#${esc(r.version)}"/>\n    <updated>${esc(r.date)}T00:00:00Z</updated>\n    <summary>${esc(r.summary)}</summary>\n    <content type="html">${esc(changelogHtml(source, file))}</content>\n  </entry>`)
    .join('\n');
  writeFileSync(join(out, 'feed.xml'), `<?xml version="1.0" encoding="utf-8"?>\n<feed xmlns="http://www.w3.org/2005/Atom">\n  <title>What's new in MKP</title>\n  <id>${SITE}whats-new/</id>\n  <link href="${SITE}whats-new/"/>\n  <link rel="self" href="${SITE}whats-new/feed.xml"/>\n  <updated>${esc(updated)}T00:00:00Z</updated>\n  <author><name>MKP</name></author>\n${entries}\n</feed>\n`);
  console.log(`what's new: ${list.length} releases, page and feed written to ${out}`);
}

// run by scripts/whats-new.mjs with the site's folder
const site = resolve(process.argv[2] ?? '.');
build(resolve(site, '../..'), join(site, '.generated'));
