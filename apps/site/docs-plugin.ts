// The docs at docs/ are the repository's docs/*.md, compiled as MKP when the site is built (or the
// dev server starts): `virtual:mkp-docs` lists them with their outlines, and each document's bundle,
// its maths already drawn, is its own module (`virtual:mkp-doc/<slug>`), loaded when it is opened.
// A document with errors stops the build.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { Plugin } from 'vite';
import { compile, Diagnostics, formatDiagnostic, MathsEngine, prerender } from '../../packages/core/src/index';

/** The docs in the order the sidebar lists them, each with a short label. */
export const DOCS = [
  { slug: 'integration-guide', label: 'Adding MKP to a project' },
  { slug: 'recipes', label: 'Recipes' },
  { slug: 'authoring-guide', label: 'Writing MKP' },
  { slug: 'runtime-spec', label: 'The runtime spec' },
  { slug: 'error-style', label: 'Error messages' },
];

export interface DocHeading {
  depth: number;
  text: string;
  id: string;
}

/** A heading's id: its words, lower case, joined by dashes. */
export const headingId = (text: string): string =>
  text
    .toLowerCase()
    .replace(/[`*_]/g, '')
    .replace(/[^\p{L}\p{N}]+/gu, '-')
    .replace(/^-|-$/g, '');

/** The document's ## and ### headings, outside fenced code. */
export function outline(src: string): { title: string; headings: DocHeading[] } {
  let fence: string | null = null;
  let title = '';
  const headings: DocHeading[] = [];
  for (const line of src.split('\n')) {
    const f = /^\s*(`{3,}|~{3,})/.exec(line);
    if (f) {
      if (!fence) fence = f[1];
      else if (line.trim().startsWith(fence) && line.trim().replace(/^[`~]+/, '') === '') fence = null;
      continue;
    }
    if (fence) continue;
    const h = /^(#{1,3})\s+(.+?)\s*#*\s*$/.exec(line);
    if (!h) continue;
    const text = h[2].replace(/`([^`]*)`/g, '$1');
    if (h[1].length === 1) title ||= text;
    else headings.push({ depth: h[1].length, text, id: headingId(text) });
  }
  return { title, headings };
}

export function mkpDocs(root: string): Plugin {
  const LIST = 'virtual:mkp-docs';
  const ONE = 'virtual:mkp-doc/';
  const file = (slug: string): string => join(root, 'docs', `${slug}.md`);
  let maths: Promise<MathsEngine | null> | null = null;
  return {
    name: 'mkp-docs',
    resolveId: (id) => (id === LIST || id.startsWith(ONE) ? `\0${id}` : undefined),
    async load(id) {
      if (id === `\0${LIST}`) {
        const list = DOCS.map((d) => {
          const src = readFileSync(file(d.slug), 'utf8');
          this.addWatchFile(file(d.slug));
          return { ...d, ...outline(src) };
        });
        const loaders = DOCS.map((d) => `  ${JSON.stringify(d.slug)}: () => import(${JSON.stringify(ONE + d.slug)}),`).join('\n');
        return `export const docs = ${JSON.stringify(list)};\nexport const load = {\n${loaders}\n};\n`;
      }
      if (!id.startsWith(`\0${ONE}`)) return undefined;
      const slug = id.slice(ONE.length + 1);
      const path = file(slug);
      this.addWatchFile(path);
      const c = compile({ packs: [] });
      const bundle = c.document(readFileSync(path, 'utf8'), `docs/${slug}.md`);
      if (!bundle || c.diags.errors.length) throw new Error(`docs/${slug}.md does not compile:\n${c.diags.errors.map(formatDiagnostic).join('\n')}`);
      maths ??= MathsEngine.create().catch(() => null);
      const engine = await maths;
      if (engine) prerender(bundle, engine, new Diagnostics());
      return `export default ${JSON.stringify(bundle)};\n`;
    },
  };
}
