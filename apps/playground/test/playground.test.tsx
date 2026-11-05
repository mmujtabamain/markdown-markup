// The playground's own logic, without a browser: what the sidebar lists (read by Vite's glob, as
// the site is), that each example compiles the way `mkp check` compiles it and each limit fails
// as it says, the share link's encoding, pictures beside a document, the editor's underline
// ranges, and files opened from disk. The Markdown preview is in markdown-preview.test.tsx.
import { describe, expect, it } from 'vitest';
import { MathsEngine, Runtime, writeZip } from '@mkp/core';
import { assetUrl, withAssets } from '../src/assets';
import { build, drawnErrors, jsonLine } from '../src/build';
import { catalog, frontMatter, GROUPS, groupNames, titleOf } from '../src/catalog';
import { markRange } from '../src/editor/Editor';
import { openFiles } from '../src/opened';
import { packFiles, readHash, unpackFiles, writeHash } from '../src/share';

const entries = catalog();
const examples = entries.filter((e) => e.kind === 'example');
const limits = entries.filter((e) => e.kind === 'limit');

describe('the catalog', () => {
  it('has the 31 examples in reading order, in the groups of §9.3, each with what it teaches', () => {
    expect(examples.map((e) => e.num)).toEqual(Array.from({ length: 31 }, (_, i) => String(i + 1).padStart(2, '0')));
    for (const e of examples) expect(e.teaches, e.id).toBeTruthy();
    expect(groupNames(entries)).toEqual([...GROUPS.map((g) => g.name), 'Limits', 'Cases']);
    expect(examples.find((e) => e.num === '12')!.group).toBe('Controls and events');
    expect(examples.find((e) => e.num === '22')!.group).toBe('Composition');
  });

  it('finds each example’s own file and packs, and the pictures beside it', () => {
    const own = examples.find((e) => e.num === '27')!;
    expect(own.files.map((f) => f.role)).toEqual(['doc', 'docFile']);
    const pack = examples.find((e) => e.num === '29')!;
    expect(pack.files.filter((f) => f.role === 'pack').map((f) => f.inPack)).toEqual(['manifest.mkp', 'distance.fixture.json', 'distance.mkp']);
    expect(pack.files[1].pack).toBe('examples/29-a-pack/pack');
    expect(examples.find((e) => e.num === '30')!.files.some((f) => f.pack === 'examples/30-interface/host')).toBe(true);
    expect(Object.keys(examples.find((e) => e.num === '02')!.assets)).toEqual(['tide.svg']);
  });

  it('lists the limits last of the documents, each with the error it expects', () => {
    expect(limits.length).toBeGreaterThanOrEqual(14);
    for (const l of limits) expect(l.expect?.code, l.id).toMatch(/^mkp\./);
    const nd = limits.find((l) => l.id === 'limit:14-no-depends')!;
    expect(new Set(nd.files.filter((f) => f.role === 'pack').map((f) => f.pack))).toEqual(new Set(['examples/limits/14-no-depends/badges', 'examples/limits/14-no-depends/chips']));
  });

  it('lists the conformance cases, each loaded when picked', async () => {
    const cases = entries.filter((e) => e.kind === 'case');
    expect(cases.length).toBeGreaterThan(30);
    const c = await cases[0].load!();
    expect(c.bundle.level).toBe('bundle');
    // with the pictures beside what it was made from
    expect(Object.keys(cases.find((e) => e.id === 'case:base.shapes.1.moved')!.assets)).toContain('dot.svg');
    expect(Object.keys(cases.find((e) => e.id === 'case:examples.18-frame-pane-zoom')!.assets)).toContain('plan.svg');
  });

  it('reads titles and front matter loosely', () => {
    expect(titleOf('---\na: 1\n---\n# Limit: a thing\n', 'x')).toBe('a thing');
    expect(titleOf('no heading', 'fallback')).toBe('fallback');
    expect(frontMatter('---\nexpect: {code: mkp.x, line: 3}\n---\n')).toEqual({ expect: { code: 'mkp.x', line: 3 } });
    expect(frontMatter('---\n: : bad\n---\n')).toEqual({});
  });
});

describe('compiling what the source pane holds', () => {
  for (const e of examples) {
    it(`${e.id} compiles clean and draws without an error`, () => {
      const r = build(e.files);
      expect(r.diags.map(jsonLine)).toEqual([]);
      expect(r.bundle).not.toBeNull();
      const rt = new Runtime(r.bundle!, { now: () => 0, capabilities: ['core@1', 'gfx@1'] });
      expect(drawnErrors(rt)).toEqual([]);
    });
  }

  for (const l of limits) {
    it(`${l.id} fails with ${l.expect!.code} ${l.expect!.line ? `at line ${l.expect!.line}` : 'while drawing'}`, () => {
      const r = build(l.files);
      const { code, line } = l.expect!;
      if (line === 0) {
        expect(r.bundle).not.toBeNull();
        const drawn = drawnErrors(new Runtime(r.bundle!, { now: () => 0 }));
        expect(drawn.map((d) => d.code)).toContain(code);
        expect(drawn.find((d) => d.code === code)!.pos?.file).toBe(l.files[0].path);
      } else {
        expect(r.bundle).toBeNull();
        expect(r.diags[0].code).toBe(code);
        expect(r.diags.filter((d) => d.code === code).map((d) => d.pos?.line)).toContain(line);
        // every position names a file the source pane has, so a click can go there
        for (const d of r.diags) expect(l.files.map((f) => f.path)).toContain(d.pos?.file);
      }
    });
  }

  it('writes a diagnostic as mkp check --format json does', () => {
    expect(jsonLine({ severity: 'error', code: 'mkp.x', message: 'm', pos: { file: 'a.mkp.md', line: 2, col: 3 } })).toBe('{"severity":"error","code":"mkp.x","message":"m","file":"a.mkp.md","line":2,"col":3}');
    expect(jsonLine({ severity: 'warning', code: 'mkp.y', message: 'm', path: ['a', 'b'] })).toBe('{"severity":"warning","code":"mkp.y","message":"m","path":["a","b"]}');
  });

  it('typesets the maths with the engine, and reports a formula that is wrong', async () => {
    const maths = await MathsEngine.create({ speech: false });
    const ok = build(examples.find((e) => e.num === '03')!.files, { maths });
    expect(ok.diags).toEqual([]);
    const bad = build([{ path: 'x.mkp.md', text: 'Some $\\frac{1}$ maths.\n', role: 'doc' }], { maths });
    expect(bad.bundle).toBeNull();
    expect(bad.diags[0].code).toBe('mkp.maths');
  });
});

describe('the share link', () => {
  it('carries edited files, compressed, and reads them back', async () => {
    const files = { 'examples/04-hello/doc.mkp.md': examples[3].files[0].text + '\nMore.\n', 'other.mkp': 'é ünïcode ✓ '.repeat(50) };
    const src = await packFiles(files);
    expect(src).toMatch(/^[A-Za-z0-9_-]+$/);
    expect(src.length).toBeLessThan(JSON.stringify(files).length);
    expect(await unpackFiles(src)).toEqual(files);
    expect(await unpackFiles('not-a-link')).toBeNull();
  });

  it('keeps the entry and settings in the hash, in a fixed order', () => {
    const h = writeHash({ src: 'abc', e: 'ex:05-counter', theme: 'dark', pane: undefined });
    expect(h).toBe('e=ex%3A05-counter&theme=dark&src=abc');
    expect(readHash('#' + h)).toEqual({ e: 'ex:05-counter', theme: 'dark', src: 'abc' });
  });
});

describe('pictures beside a document', () => {
  it('swaps their paths for the site’s URLs in the drawn copy only', () => {
    const e = examples.find((x) => x.num === '02')!;
    const b = build(e.files).bundle!;
    const drawn = withAssets(b, { 'tide.svg': '/assets/tide-1.svg' });
    expect(JSON.stringify(drawn.doc)).toContain('](/assets/tide-1.svg)');
    expect(JSON.stringify(b.doc)).toContain('](tide.svg)');
    expect(withAssets(b, {})).toBe(b);
    expect(assetUrl({ 'plan.svg': '/p.svg' }, './plan.svg')).toBe('/p.svg');
  });
});

describe('the editor', () => {
  it('underlines the word a diagnostic points at, or its line', () => {
    const text = 'one\n  text "x" wieght=bold\n\n';
    const r = markRange(text, 2, 12);
    expect(text.slice(r.from, r.to)).toBe('wieght=bold');
    const whole = markRange(text, 2, 1);
    expect(text.slice(whole.from, whole.to)).toBe('text "x" wieght=bold');
    const blank = markRange(text, 3, 1);
    expect(blank.from).toBe(blank.to);
    // a line past the end is the last line
    expect(markRange(text, 99, 1).from).toBe(text.length);
  });
});

describe('files opened from disk', () => {
  it('a .mkp.md with its .mkp is one entry; a .mkpack gives its fixture cases', async () => {
    const ex = examples.find((e) => e.num === '27')!;
    const doc = new File([ex.files[0].text], 'doc.mkp.md');
    const own = new File([ex.files[1].text], 'doc.mkp');
    const pack = examples.find((e) => e.num === '29')!;
    const zip = writeZip(new Map(pack.files.filter((f) => f.role === 'pack').map((f) => [f.inPack!, new TextEncoder().encode(f.text)])));
    const r = await openFiles([doc, own, new File([zip as BlobPart], 'units.mkpack'), new File(['x'], 'notes.txt')], { entries: [], packs: [] });
    expect(r.first).toBeTruthy();
    const opened = r.opened.entries.find((e) => e.id === 'open:doc.mkp.md')!;
    expect(opened.files.map((f) => f.path)).toEqual(['opened/doc.mkp.md', 'opened/doc.mkp']);
    expect(build(opened.files).diags).toEqual([]);
    expect(r.opened.packs.map((p) => p.label)).toEqual(['units.mkpack']);
    const fc = r.opened.entries.find((e) => e.id.startsWith('open:units.mkpack#'))!;
    expect(fc).toBeTruthy();
    const built = build(fc.files, { extraPacks: r.opened.packs, ...fc.build });
    expect(built.diags.map(jsonLine)).toEqual([]);
    expect(r.notes.join(' ')).toContain('notes.txt');
  });
});
