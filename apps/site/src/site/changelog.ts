// A release's changelog (changelog/<version>.mkp.md) read into what the What's new page shows and
// filters: its front matter, its intro, and its sections, each a list of items. An item is a list
// item with what follows it until the next item or heading: its continuation lines, code, and the
// widget blocks that demonstrate it (counted in order, to match the compiled document's widgets).
// Under ## API, ### kinds and **surface** lines label the items that follow them.

export const KINDS = ['Breaking', 'New', 'Changed', 'Fixed', 'API', 'Migration'] as const;
export type Kind = (typeof KINDS)[number];

/** Headings people write instead, read as the section they mean (the check warns about them). */
const ALIASES: Record<string, Kind> = { Added: 'New', Improved: 'Changed', Updated: 'Changed', Fixes: 'Fixed', 'Bug fixes': 'Fixed', Removed: 'Breaking', 'Breaking changes': 'Breaking', Upgrading: 'Migration' };

/** Fence labels that are code or maths, never a widget (MKP reads them so: fences go to Markdown first). */
const CODE = new Set(['sh', 'bash', 'shell', 'console', 'txt', 'text', 'plaintext', 'js', 'javascript', 'ts', 'typescript', 'tsx', 'jsx', 'json', 'yaml', 'yml', 'md', 'markdown', 'html', 'css', 'xml', 'diff', 'math', 'latex', 'python', 'py', 'go', 'rust', 'java', 'kotlin', 'swift', 'sql', 'toml', 'ini', '']);

export interface Item {
  /** the item's Markdown, its widget blocks and definitions taken out */
  md: string;
  /** what a word filter searches: its words, no Markdown */
  text: string;
  /** the widget blocks under it, as indices into the document's widget blocks in order */
  demos: number[];
  /** under ## API: "Added · JavaScript" */
  group?: string;
}

export interface Section {
  kind: Kind | string;
  title: string;
  items: Item[];
}

export interface Release {
  version: string;
  date: string;
  summary: string;
  /** the Markdown between the title and the first section */
  intro: string;
  sections: Section[];
  /** how many widget blocks the changelog holds */
  widgets: number;
  /** the source, for compiling its widgets */
  source: string;
}

const unquote = (v: string): string => (v.length > 1 && ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) ? v.slice(1, -1) : v);

/** The words of some Markdown, for searching: no markers, code kept as text. */
export function plain(md: string): string {
  return md
    .replace(/```[\s\S]*?```/g, (f) => f.replace(/^```.*$/gm, ''))
    .replace(/`([^`]*)`/g, '$1')
    .replace(/\*\*|__|\*|_/g, '')
    .replace(/\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/^\s*[-*]\s+/gm, '')
    .replace(/\s+/g, ' ')
    .trim();
}

/** A changelog's text, read. */
export function readChangelog(source: string, file = ''): Release {
  const lines = source.replace(/^﻿/, '').split(/\r?\n/);
  const front: Record<string, string> = {};
  let i = 0;
  if (lines[0]?.trim() === '---') {
    for (i = 1; i < lines.length && lines[i].trim() !== '---'; i++) {
      const m = /^([A-Za-z][\w-]*)\s*:\s*(.*)$/.exec(lines[i]);
      if (m) front[m[1]] = unquote(m[2].trim());
    }
    i++;
  }
  const version = front.version ?? /([\d.]+)\.mkp\.md$/.exec(file)?.[1] ?? '';
  const sections: Section[] = [];
  const intro: string[] = [];
  let section: Section | null = null;
  let item: { md: string[]; demos: number[]; group?: string } | null = null;
  let group: { kind?: string; surface?: string } = {};
  let widgets = 0;
  const close = (): void => {
    if (item && section) {
      const md = item.md.join('\n').replace(/^- /, '').trim();
      if (md || item.demos.length) section.items.push({ md, text: plain(md), demos: item.demos, ...(item.group ? { group: item.group } : {}) });
    }
    item = null;
  };
  const groupLabel = (): string | undefined => (group.kind || group.surface ? [group.kind, group.surface].filter(Boolean).join(' · ') : undefined);
  for (; i < lines.length; i++) {
    const l = lines[i];
    // a fence: code stays in the item's Markdown; a widget block is a demo; mkp (definitions) is left out
    const f = /^(`{3,}|~{3,})\s*([^\s`]*)/.exec(l);
    if (f) {
      const fence = f[1];
      const label = f[2].toLowerCase();
      const body: string[] = [l];
      for (i++; i < lines.length && !lines[i].trimStart().startsWith(fence); i++) body.push(lines[i]);
      body.push(lines[i] ?? fence);
      const isCode = CODE.has(label) || label === 'mkp' || label === 'state';
      if (!isCode) {
        if (item) item.demos.push(widgets);
        widgets++;
        continue;
      }
      if (label === 'mkp' || label === 'state') continue;
      if (item) item.md.push(...body);
      else if (section) {
        item = { md: [...body], demos: [], group: groupLabel() };
      } else intro.push(...body);
      continue;
    }
    // a container block (:::name … :::) is a widget too
    if (/^:::\s*[A-Za-z]/.test(l)) {
      let depth = 1;
      for (i++; i < lines.length && depth; i++) {
        if (/^:::\s*[A-Za-z]/.test(lines[i])) depth++;
        else if (/^:::\s*$/.test(lines[i])) depth--;
      }
      i--;
      if (item) item.demos.push(widgets);
      widgets++;
      continue;
    }
    const h2 = /^##\s+(.+?)\s*$/.exec(l);
    if (h2) {
      close();
      const title = h2[1];
      section = { kind: (KINDS as readonly string[]).includes(title) ? title : (ALIASES[title] ?? title), title, items: [] };
      sections.push(section);
      group = {};
      continue;
    }
    if (/^#\s/.test(l) && !section) continue;
    const h3 = /^###\s+(.+?)\s*$/.exec(l);
    if (h3 && section) {
      close();
      group = { kind: h3[1] };
      continue;
    }
    const surface = /^\*\*([^*]+)\*\*\s*$/.exec(l);
    if (surface && section?.kind === 'API') {
      close();
      group = { ...group, surface: surface[1] };
      continue;
    }
    if (!section) {
      intro.push(l);
      continue;
    }
    if (/^[-*]\s/.test(l)) {
      close();
      item = { md: [l], demos: [], group: groupLabel() };
      continue;
    }
    if (!l.trim()) {
      if (item) item.md.push(l);
      continue;
    }
    // a paragraph of its own (a migration section, say) is an item too
    if (!item) item = { md: [], demos: [], group: groupLabel() };
    item.md.push(l);
  }
  close();
  return { version, date: front.date ?? '', summary: front.summary ?? '', intro: intro.join('\n').trim(), sections: sections.filter((s) => s.items.length), widgets, source };
}

/** Versions compared number by number, newest first. */
export const newestFirst = (a: Release, b: Release): number => b.version.localeCompare(a.version, undefined, { numeric: true });

/** A date written out: 7 November 2026. */
export function longDate(iso: string): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso);
  if (!m) return iso;
  const months = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
  return `${Number(m[3])} ${months[Number(m[2]) - 1]} ${m[1]}`;
}

/** What a filter keeps: a kind (or all) and words, all of which an item must contain. */
export interface Filter {
  kind: Kind | 'All';
  words: string;
}

export const wordsOf = (s: string): string[] => s.toLowerCase().split(/\s+/).filter(Boolean);

/**
 * A release under a filter: its sections with only the items kept, and whether its head (its number
 * or its summary) matched. A summary names a release's main changes, so a match there keeps the
 * version in the list, but its notes are still filtered: every note shown has the words.
 */
export function filtered(r: Release, f: Filter): { sections: Section[]; count: number; head: boolean } {
  const words = wordsOf(f.words);
  const head = words.length > 0 && words.every((w) => `${r.version} ${r.summary}`.toLowerCase().includes(w));
  const sections = r.sections
    .filter((s) => f.kind === 'All' || s.kind === f.kind)
    .map((s) => ({ ...s, items: !words.length ? s.items : s.items.filter((it) => words.every((w) => `${it.text} ${it.group ?? ''}`.toLowerCase().includes(w))) }))
    .filter((s) => s.items.length);
  return { sections, count: sections.reduce((n, s) => n + s.items.length, 0), head };
}
