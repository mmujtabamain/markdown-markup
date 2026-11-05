// Files opened from disk: a .mkp.md (with its .mkp beside it, when both are picked) becomes an
// entry of its own; a .mkpack joins the opened documents' packs, and each of its fixture cases
// becomes an entry whose source is the case's document.

import { caseDocument, compile, fixtureCases, type PackSource } from '@mkp/core';
import type { Entry, SourceFile } from './catalog';
import { titleOf, frontMatter } from './catalog';

export interface Opened {
  entries: Entry[];
  packs: PackSource[];
}

/** An entry for a document opened from disk (or carried by a shared link), from its files. */
export function openedDoc(name: string, files: Record<string, string>): Entry | null {
  const paths = Object.keys(files);
  const doc = paths.find((p) => /\.md$/.test(p));
  if (!doc) return null;
  const own = doc.replace(/\.mkp\.md$/, '.mkp');
  const list: SourceFile[] = [{ path: doc, text: files[doc], role: 'doc' }];
  if (own !== doc && files[own] !== undefined) list.push({ path: own, text: files[own], role: 'docFile' });
  const fm = frontMatter(files[doc]);
  return { id: `open:${name}`, kind: 'opened', group: 'Opened', num: '', title: titleOf(files[doc], name), teaches: typeof fm.teaches === 'string' ? fm.teaches : name, files: list, assets: {} };
}

export async function openFiles(picked: File[], before: Opened): Promise<{ opened: Opened; first?: string; notes: string[] }> {
  const entries = [...before.entries];
  const packs = [...before.packs];
  const notes: string[] = [];
  let first: string | undefined;
  const add = (e: Entry): void => {
    const i = entries.findIndex((x) => x.id === e.id);
    if (i >= 0) entries[i] = e;
    else entries.push(e);
    first ??= e.id;
  };
  const texts = new Map<string, string>();
  for (const f of picked) {
    if (f.name.endsWith('.mkpack')) {
      const pack: PackSource = { label: f.name, zip: new Uint8Array(await f.arrayBuffer()) };
      const c = compile({ packs: [pack] });
      if (!c.diags.ok) notes.push(`${f.name}: ${c.diags.errors.length} errors in the pack`);
      packs.splice(0, packs.length, ...packs.filter((p) => p.label !== f.name), pack);
      for (const fc of fixtureCases(c)) {
        const path = `${fc.pack}/${fc.file}#${fc.name}`;
        add({ id: `open:${f.name}#${fc.widget}/${fc.name}`, kind: 'opened', group: 'Opened', num: '', title: `${fc.widget} · ${fc.name}`, teaches: fc.summary ?? `a fixture case of ${f.name}`, files: [{ path, text: caseDocument(fc), role: 'doc' }], assets: {}, build: { allowParts: true, privateOf: fc.pack } });
      }
    } else if (/\.(md|mkp)$/.test(f.name)) texts.set(f.name, await f.text());
    else notes.push(`${f.name}: open a .mkp.md, its .mkp, or a .mkpack`);
  }
  for (const [name, text] of texts) {
    if (!name.endsWith('.md')) continue;
    const own = name.replace(/\.mkp\.md$/, '.mkp');
    const files: Record<string, string> = { [`opened/${name}`]: text };
    if (own !== name && texts.has(own)) files[`opened/${own}`] = texts.get(own)!;
    const e = openedDoc(name, files);
    if (e) add(e);
  }
  for (const name of texts.keys()) {
    if (name.endsWith('.mkp') && !texts.has(name.replace(/\.mkp$/, '.mkp.md'))) notes.push(`${name}: a document's own file opens together with its .mkp.md`);
  }
  return { opened: { entries, packs }, first, notes };
}
