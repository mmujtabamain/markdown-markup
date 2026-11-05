// Round trip (spec 13): .mkp → IR → .mkp → IR is identical (positions aside) for every pack file,
// and the same for every document with its own definitions: the examples' and the test packs'.
import { describe, expect, it } from 'vitest';
import { compile, stripPos, type PackSource } from '../src/build';
import { Diagnostics, formatDiagnostic } from '../src/diag';
import { DocPrinter, fileItems, printFile } from '../src/print';
import { examples } from './examples.test';
import { testPacks } from './helpers';

const packs: PackSource[] = [...testPacks(), ...examples().flatMap((e) => e.packs)];
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
  for (const pk of packs) {
    const c1 = compile({ packs: [pk, ...packs.filter((x) => x !== pk)] });
    const files = [...pk.files!.keys()].filter((p) => p.endsWith('.mkp'));
    it.each(files.map((f) => [`${pk.label}/${f}`, f] as const))('%s', (_n, path) => {
      const items1 = itemsOf(c1, pk.label, path);
      const ctx = { defs: Object.fromEntries(c1.defs), env: c1.prog.typeEnv('$doc') };
      const text2 = printFile(items1, ctx);
      const packs2 = packs.map((p) => (p === pk ? { label: p.label, files: new Map([...p.files!, [path, enc.encode(text2)]]) } : p));
      const c2 = compile({ packs: packs2 });
      expect(c2.diags.errors.map(formatDiagnostic), text2).toEqual(c1.diags.errors.map(formatDiagnostic));
      const items2 = itemsOf(c2, pk.label, path);
      expect(stripPos(items2)).toEqual(stripPos(items1));
      expect(printFile(items2, ctx)).toBe(text2);
    });
  }
});

describe('round trip of documents, with their own definitions', () => {
  it.each(examples().map((e) => [e.name, e] as const))('%s', (_n, ex) => {
    const c = compile({ packs: ex.packs });
    const name = `examples/${ex.name}/doc.mkp.md`;
    const b1 = c.document(ex.text, name, new Diagnostics(), { docFile: ex.docFile });
    expect(b1).not.toBeNull();
    const defs = c.documentDefs(ex.text, name, { docFile: ex.docFile }) ?? undefined;
    const docDef = Object.values(b1!.defs).find((d) => d.pack === '$doc' && d.name === 'document');
    const text2 = new DocPrinter({ defs: b1!.defs, env: c.prog.typeEnv('$doc') }).doc(b1!.doc.front, b1!.doc.body, docDef, defs);
    const d2 = new Diagnostics();
    // printed back, the document holds its definitions itself: no file beside it is needed
    const b2 = c.document(text2, name, d2);
    expect(d2.errors.map(formatDiagnostic), text2).toEqual([]);
    expect(stripPos({ front: b2!.doc.front, body: b2!.doc.body })).toEqual(stripPos({ front: b1!.doc.front, body: b1!.doc.body }));
    const own = (b: typeof b1) => Object.values(b!.defs).filter((d) => d.inline).map((d) => stripPos({ ...d, digest: undefined, file: undefined }));
    expect(own(b2)).toEqual(own(b1));
  });
});
