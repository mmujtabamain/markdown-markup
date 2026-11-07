// A pack's own versions: deprecated, and migrate walk@1 -> walk@2 (checked, proven on fixtures, applied).
import { describe, expect, it } from 'vitest';
import { compile, stripPos } from '../src/build';
import { formatDiagnostic } from '../src/diag';
import { applyMove, checkMoves } from '../src/migrate/packs';
import { DocPrinter, fileItems, printFile } from '../src/print';

const enc = new TextEncoder();
const pack = (walk: string, fixture?: object) => ({
  label: 'trips',
  files: new Map<string, Uint8Array>([
    ['manifest.mkp', enc.encode('pack trips@1 "Trips."\n  requires core@1\n  provides walk\n')],
    ['walk.mkp', enc.encode(walk)],
    ...(fixture ? [['walk.fixture.json', enc.encode(JSON.stringify(fixture))] as [string, Uint8Array]] : []),
  ]),
});

const V1 = 'walk@1 "A walk."\n  deprecated "use walk@2: from is now start, and speed is gone"\n  in from text\n  in speed num = 1\n  text "from \\val{from}"\n  project md = from\n';
const V2 = 'walk@2 "A walk."\n  in start text\n  in look choice(classic|new) = new\n  text "from \\val{start} (\\val{look})"\n  project md = start\n';
const MOVE = 'migrate walk@1 -> walk@2\n  rename from -> start\n  drop speed "walk@2 sets its own pace"\n  keep look = classic "walk@1\'s look"\n';
const fixture1 = { widget: 'walk@1', cases: { one: { props: { from: 'home', speed: 2 }, summary: 'One.' } } };
const doc = '# Trip\n\n```walk@1\nfrom: home\nspeed: 3\nsummary: s\n```\n';

describe('a pack’s versions', () => {
  it('warns every use of a deprecated version with what to use instead', () => {
    const c = compile({ packs: [pack(V1 + '\n' + V2 + '\n' + MOVE, fixture1)] });
    expect(c.diags.errors.map(formatDiagnostic)).toEqual([]);
    c.document(doc, 'trip.mkp.md');
    const w = c.diags.warnings.filter((d) => d.code === 'mkp.deprecated');
    expect(w).toHaveLength(1);
    expect(w[0].message).toContain('walk@1 is deprecated');
    expect(w[0].message).toContain('use walk@2: from is now start');
    expect(w[0].pos?.file).toBe('trip.mkp.md');
  });

  it('checks a migrate block against both versions, and proves it on the old one’s fixtures', () => {
    const c = compile({ packs: [pack(V1 + '\n' + V2 + '\n' + MOVE, fixture1)] });
    expect(c.moves).toHaveLength(1);
    expect(c.moves[0]).toMatchObject({ from: 'trips:walk@1', to: 'trips:walk@2', rename: { from: 'start' }, drop: [{ name: 'speed' }] });
    expect(checkMoves(c, c.moves)).toEqual([]);
  });

  it('refuses a block that leaves an input with nowhere to go, or one that the new version can’t take', () => {
    const c = compile({ packs: [pack(V1 + '\n' + V2 + '\nmigrate walk@1 -> walk@2\n  rename from -> start\n  keep colour = red "no such input"\n')] });
    const msgs = c.diags.errors.map((d) => d.message);
    expect(msgs.some((m) => m.includes("walk@1's input speed isn't in walk@2"))).toBe(true);
    expect(msgs.some((m) => m.includes('walk@2 has no input colour'))).toBe(true);
  });

  it('fails the proof when a moved case doesn’t compile against the new version', () => {
    const bad = V2.replace('in look choice(classic|new) = new', 'in look choice(classic|new) = new\n  in count int');
    const c = compile({ packs: [pack(V1 + '\n' + bad + '\n' + MOVE, fixture1)] });
    expect(c.diags.errors.map((d) => d.message).join('\n')).toContain('walk@2 needs count');
  });

  it('moves a document’s uses: renamed, dropped, the old look kept when asked; printed as walk@2', () => {
    const c = compile({ packs: [pack(V1 + '\n' + V2 + '\n' + MOVE, fixture1)] });
    const b = c.document(doc, 'trip.mkp.md')!;
    const to = c.defs.get('trips:walk@2')!;
    const hits = applyMove([b], c.moves[0], true, to);
    expect(hits).toHaveLength(1);
    const text = new DocPrinter({ defs: b.defs, env: c.prog.typeEnv('$doc') }).doc(b.doc.front, b.doc.body);
    expect(text).toContain('```walk@2\nstart: home\nlook: classic\nsummary: s\n```');
    const c2 = compile({ packs: [pack(V1 + '\n' + V2 + '\n' + MOVE, fixture1)] });
    c2.document(text, 'trip.mkp.md');
    expect(c2.diags.errors).toEqual([]);
    expect(c2.diags.warnings.filter((d) => d.code === 'mkp.deprecated')).toEqual([]);
  });

  it('round-trips: deprecated and migrate print back as written', () => {
    const c = compile({ packs: [pack(V1 + '\n' + V2 + '\n' + MOVE, fixture1)] });
    const p = c.prog.packs.get('trips')!;
    const f = p.files.find((x) => x.file.endsWith('walk.mkp'))!;
    const text = printFile(fileItems(f, c.defs, 'trips', () => undefined), { defs: Object.fromEntries(c.defs), env: c.prog.typeEnv('trips') });
    expect(text).toContain('  deprecated "use walk@2: from is now start, and speed is gone"');
    expect(text).toContain('migrate walk@1 -> walk@2\n  rename from -> start\n  drop speed "walk@2 sets its own pace"\n  keep look = classic "walk@1\'s look"');
    const c2 = compile({ packs: [pack(text, fixture1)] });
    expect(c2.diags.errors).toEqual([]);
    expect(stripPos(c2.moves)).toEqual(stripPos(c.moves));
  });
});
