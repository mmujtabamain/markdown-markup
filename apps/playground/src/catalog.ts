/// <reference types="vite/client" />
// What the sidebar lists, read at build time by Vite so the site is static: the examples of
// doc #1129 §9 in their groups and order, the limits (each fails on purpose, at a known line), and
// the conformance cases (bundles to draw, loaded when picked).

import YAML from 'yaml';
import type { IRBundle, PlayStep } from '@mkp/core';

const ROOT = '../../../';

// every text file of every example and limit, but not the committed exported Markdown (doc.md)
const texts = import.meta.glob(['../../../examples/**/*.{mkp,md,json}', '!../../../examples/**/doc.md'], { query: '?raw', import: 'default', eager: true }) as Record<string, string>;
// pictures a document links to, served beside the site
const pictures = import.meta.glob('../../../examples/**/*.{svg,png,jpg,jpeg,webp,gif}', { query: '?url', import: 'default', eager: true }) as Record<string, string>;
const caseIndex = import.meta.glob('../../../conformance/index.json', { import: 'default', eager: true }) as Record<string, { cases: string[] }>;
const caseFiles = import.meta.glob('../../../conformance/cases/*.json', { import: 'default' }) as Record<string, () => Promise<ConfCase>>;

/** One file of a document's source: the document, its own file (name.mkp) or a pack's file. */
export interface SourceFile {
  /** the path a diagnostic names (pos.file), from the repository's root */
  path: string;
  text: string;
  role: 'doc' | 'docFile' | 'pack';
  /** a pack file: the pack's folder (its label), and the file's path inside it */
  pack?: string;
  inPack?: string;
}

/** A conformance case (conformance/cases/*.json): a bundle, play steps and what they give. */
export interface ConfCase {
  id: string;
  bundle: IRBundle;
  hosts?: Record<string, unknown>;
  steps: PlayStep[];
  md: { plain: string; all: string };
}

export type EntryKind = 'example' | 'limit' | 'case' | 'opened';

export interface Entry {
  /** ex:05-counter, limit:01-yaml-item-type, case:base.actions.1.bumped, open:name.mkp.md */
  id: string;
  kind: EntryKind;
  group: string;
  /** 05, L01; empty for cases */
  num: string;
  title: string;
  /** what it teaches (examples), or what is wrong (limits), in one line */
  teaches?: string;
  /** a limit: the error it must give, and where (line 0: while drawing) */
  expect?: { code: string; line: number };
  /** capabilities it needs, such as gfx@1 */
  needs?: string[];
  /** its editable files, the document first; none for a case */
  files: SourceFile[];
  /** pictures by the name the document uses, relative to its folder */
  assets: Record<string, string>;
  /** a case's bundle, loaded when it is picked */
  load?: () => Promise<ConfCase>;
  /** a fixture case of a pack opened from disk: it may use the pack's private parts */
  build?: { allowParts?: boolean; privateOf?: string };
}

/** The groups of §9.3, by the examples' numbers. */
export const GROUPS: { name: string; from: number; to: number }[] = [
  { name: 'Markdown', from: 1, to: 3 },
  { name: 'First definitions', from: 4, to: 7 },
  { name: 'Layout', from: 8, to: 11 },
  { name: 'Controls and events', from: 12, to: 16 },
  { name: 'Overlays and shells', from: 17, to: 18 },
  { name: 'Canvas', from: 19, to: 21 },
  { name: 'Composition', from: 22, to: 31 },
];

/** The front matter of a .mkp.md, read loosely (a document that doesn't parse has none). */
export function frontMatter(text: string): Record<string, unknown> {
  const m = /^---\r?\n([\s\S]*?)\r?\n---/.exec(text);
  if (!m) return {};
  try {
    const v = YAML.parse(m[1]) as unknown;
    return v && typeof v === 'object' ? (v as Record<string, unknown>) : {};
  } catch {
    return {};
  }
}

/** The document's first heading, without "Limit: ". */
export function titleOf(text: string, fallback: string): string {
  const h = /^#\s+(.+)$/m.exec(text.replace(/^---\r?\n[\s\S]*?\r?\n---/, ''));
  return h ? h[1].replace(/^Limit:\s*/, '').trim() : fallback;
}

function groupOf(n: number): string {
  return GROUPS.find((g) => n >= g.from && n <= g.to)?.name ?? 'More examples';
}

const rel = (p: string): string => p.slice(ROOT.length);

/** Pictures in a folder, by their path relative to it. */
function assetsIn(folder: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [p, url] of Object.entries(pictures)) if (rel(p).startsWith(folder + '/')) out[rel(p).slice(folder.length + 1)] = url;
  return out;
}

/** The pack files under a folder: each direct subfolder named in `packs` (or each one) is a pack. */
function packFiles(folder: string, only?: string[]): SourceFile[] {
  const out: SourceFile[] = [];
  for (const [p, text] of Object.entries(texts)) {
    const path = rel(p);
    if (!path.startsWith(folder + '/')) continue;
    const inner = path.slice(folder.length + 1);
    const slash = inner.indexOf('/');
    if (slash < 0) continue;
    const name = inner.slice(0, slash);
    if (only && !only.includes(name)) continue;
    out.push({ path, text, role: 'pack', pack: `${folder}/${name}`, inPack: inner.slice(slash + 1) });
  }
  // manifests first, then by path, so a pack reads top down
  return out.sort((a, b) => (a.pack !== b.pack ? (a.pack! < b.pack! ? -1 : 1) : a.inPack === 'manifest.mkp' ? -1 : b.inPack === 'manifest.mkp' ? 1 : a.inPack! < b.inPack! ? -1 : 1));
}

function examples(): Entry[] {
  const out: Entry[] = [];
  for (const [p, text] of Object.entries(texts)) {
    const m = /^examples\/((\d\d)-[^/]+)\/doc\.mkp\.md$/.exec(rel(p));
    if (!m) continue;
    const [, name, nn] = m;
    const folder = `examples/${name}`;
    const fm = frontMatter(text);
    const files: SourceFile[] = [{ path: `${folder}/doc.mkp.md`, text, role: 'doc' }];
    const own = texts[`${ROOT}${folder}/doc.mkp`];
    if (own !== undefined) files.push({ path: `${folder}/doc.mkp`, text: own, role: 'docFile' });
    files.push(...packFiles(folder, ['pack', 'host']));
    out.push({
      id: `ex:${name}`,
      kind: 'example',
      group: groupOf(Number(nn)),
      num: nn,
      title: titleOf(text, name),
      teaches: typeof fm.teaches === 'string' ? fm.teaches : undefined,
      needs: Array.isArray(fm.needs) ? fm.needs.map(String) : undefined,
      files,
      assets: assetsIn(folder),
    });
  }
  return out.sort((a, b) => (a.num < b.num ? -1 : 1));
}

function limits(): Entry[] {
  const out: Entry[] = [];
  for (const [p, text] of Object.entries(texts)) {
    const m = /^examples\/limits\/((\d\d)-[^/]+)\.mkp\.md$/.exec(rel(p));
    if (!m) continue;
    const [, name, nn] = m;
    const fm = frontMatter(text);
    const ex = fm.expect as { code?: string; line?: number } | undefined;
    out.push({
      id: `limit:${name}`,
      kind: 'limit',
      group: 'Limits',
      num: `L${nn}`,
      title: titleOf(text, name),
      teaches: typeof fm.fails === 'string' ? fm.fails : undefined,
      expect: ex?.code ? { code: ex.code, line: Number(ex.line ?? 0) } : undefined,
      // the packs a limit needs are in the folder named after it
      files: [{ path: `examples/limits/${name}.mkp.md`, text, role: 'doc' }, ...packFiles(`examples/limits/${name}`)],
      assets: assetsIn(`examples/limits/${name}`),
    });
  }
  return out.sort((a, b) => (a.num < b.num ? -1 : 1));
}

function cases(): Entry[] {
  const index = Object.values(caseIndex)[0]?.cases ?? [];
  return index.flatMap((id) => {
    const load = caseFiles[`${ROOT}conformance/cases/${id}.json`];
    if (!load) return [];
    return [{ id: `case:${id}`, kind: 'case' as const, group: 'Cases', num: '', title: id, files: [], assets: {}, load }];
  });
}

let cached: Entry[] | null = null;

/** Every built-in entry, in the sidebar's order: the examples, then the limits, then the cases. */
export function catalog(): Entry[] {
  return (cached ??= [...examples(), ...limits(), ...cases()]);
}

/** The groups in order, as the sidebar shows them. */
export function groupNames(entries: Entry[]): string[] {
  const names = [...GROUPS.map((g) => g.name), 'More examples', 'Limits', 'Cases', 'Opened'];
  const present = new Set(entries.map((e) => e.group));
  return names.filter((n) => present.has(n));
}
