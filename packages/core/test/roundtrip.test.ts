// Round trip (spec 13): .mkp → IR → .mkp → IR is identical (positions aside) for every file, and
// the same for every document and fixture case document.
import { describe, expect, it } from 'vitest';
import { compile, stripPos, type PackSource } from '../src/build';
import { formatDiagnostic } from '../src/diag';
import { caseDocument, fixtureCases } from '../src/fixtures';
import { DocPrinter, fileItems, printFile } from '../src/print';
import { allPacks } from './helpers';

const packs = allPacks();
const c1 = compile({ packs });
const files: { pack: string; label: string; path: string }[] = [];
for (const src of packs) {
  for (const path of src.files!.keys()) if (path.endsWith('.mkp')) files.push({ pack: '', label: src.label, path });
}
const enc = new TextEncoder();

function itemsOf(c: ReturnType<typeof compile>, label: string, path: string) {
  for (const p of c.prog.packs.values()) {
    const f = p.files.find((x) => x.file === `${label}/${path}`);
    if (f) return fileItems(f, c.defs, p.name, (n) => c.tokens.find((t) => t.name === n && t.pack === p.name));
    if (path === 'manifest.mkp' && p.manifest.p.file === `${label}/manifest.mkp`) return fileItems({ file: path, items: [p.manifest] }, c.defs, p.name, () => undefined);
  }
  throw new Error(`no file ${label}/${path}`);
}

describe('round trip of .mkp files', () => {
  it.each(files.map((f) => [`${f.label}/${f.path}`, f] as const))('%s', (_n, f) => {
    const items1 = itemsOf(c1, f.label, f.path);
    const ctx = { defs: Object.fromEntries(c1.defs), env: c1.prog.typeEnv('$doc') };
    const text2 = printFile(items1, ctx);
    const packs2: PackSource[] = packs.map((p) => (p.label === f.label ? { label: p.label, files: new Map([...p.files!, [f.path, enc.encode(text2)]]) } : p));
    const c2 = compile({ packs: packs2 });
    // reprinting adds no errors (the build as a whole must be clean too: see fixtures.test.ts)
    expect(c2.diags.errors.map(formatDiagnostic), text2).toEqual(c1.diags.errors.map(formatDiagnostic));
    const items2 = itemsOf(c2, f.label, f.path);
    expect(stripPos(items2)).toEqual(stripPos(items1));
    // and printing again is stable
    expect(printFile(items2, ctx)).toBe(text2);
  });
});

describe('round trip of documents', () => {
  const docs: [string, string][] = [];
  for (const p of c1.prog.packs.values()) for (const d of p.documents) docs.push([`${p.name}/${d.path}`, d.text]);
  for (const fc of fixtureCases(c1)) if (!fc.expect?.errors?.length) docs.push([`${fc.pack}/${fc.widget}/${fc.name}`, caseDocument(fc)]);
  it.each(docs)('%s', (name, text) => {
    const b1 = c1.document(text, name, new (c1.diags.constructor as new () => typeof c1.diags)(), { allowParts: true });
    if (!b1) return;
    const docDef = Object.values(b1!.defs).find((d) => d.pack === '$doc');
    const printer = new DocPrinter({ defs: b1!.defs, env: c1.prog.typeEnv('$doc') });
    const text2 = printer.doc(b1!.doc.front, b1!.doc.body, docDef);
    const d2 = new (c1.diags.constructor as new () => typeof c1.diags)();
    const b2 = c1.document(text2, name, d2, { allowParts: true });
    expect(d2.errors.map(formatDiagnostic), text2).toEqual([]);
    expect(b2, text2).not.toBeNull();
    expect(stripPos({ front: b2!.doc.front, body: b2!.doc.body })).toEqual(stripPos({ front: b1!.doc.front, body: b1!.doc.body }));
  });
});
