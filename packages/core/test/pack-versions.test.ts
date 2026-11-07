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

// migrate statuslist@1 -> rows@1: another widget, a record list's fields, and a choice's values
const packOf = (label: string, manifest: string, files: Record<string, string | object>) => ({
  label,
  files: new Map<string, Uint8Array>([['manifest.mkp', enc.encode(manifest)], ...Object.entries(files).map(([k, v]) => [k, enc.encode(typeof v === 'string' ? v : JSON.stringify(v))] as [string, Uint8Array])]),
});
const LIST = [
  'statuslist@1 "Items with a state."',
  '  in items list(record item {name: text, state: choice(done|todo|late) = todo, icon: text = ""})',
  '  column',
  '    each it in items key=it.name',
  '      text "\\val{it.name}: \\val{it.state}"',
  '  project md = join(map(items, i => i.name), ", ")',
  '',
].join('\n');
const ROWS = [
  'rows@1 "Rows with a tone."',
  '  in rows list(record row {title: text, tone: choice(ok|muted|bad) = muted, note: text = ""})',
  '  in dense bool = false',
  '  column',
  '    each r in rows key=r.title',
  '      text "\\val{r.title}" tone=(r.tone)',
  '  project md = join(map(rows, r => r.title), ", ")',
  '',
].join('\n');
const TO_ROWS = [
  'migrate statuslist@1 -> rows@1',
  '  rename items -> rows',
  '  rename items.name -> rows.title',
  '  rename items.state -> rows.tone',
  '  drop items.icon "rows show no icon"',
  '  map items.state: done -> ok, todo -> muted, late -> bad',
  '',
].join('\n');
const listFixture = { widget: 'statuslist@1', cases: { some: { props: { items: [{ name: 'Tea', state: 'done', icon: 'cup' }, { name: 'Post', state: 'late' }] }, summary: 'Two.' } } };
const board = (move = TO_ROWS) =>
  packOf('board', 'pack board@1 "Boards."\n  requires core@1\n  provides statuslist rows\n', { 'list.mkp': LIST + '\n' + ROWS + '\n' + move, 'statuslist.fixture.json': listFixture });
const listDoc = '# Today\n\n```statuslist\nitems:\n  - {name: Tea, state: done, icon: cup}\n  - {name: Post, state: late}\n  - {name: Bins}\nsummary: s\n```\n';

describe('migrate to another widget, into record lists, mapping values', () => {
  it('checks the block: fields and values all go somewhere, and it holds on the old widget’s fixtures', () => {
    const c = compile({ packs: [board()] });
    expect(c.diags.errors.map(formatDiagnostic)).toEqual([]);
    expect(c.moves[0]).toMatchObject({
      from: 'board:statuslist@1',
      to: 'board:rows@1',
      rename: { items: 'rows' },
      fields: { items: { rename: { name: 'title' }, drop: [{ name: 'icon', why: 'rows show no icon' }] } },
      map: { 'items.state': { done: 'ok', todo: 'muted', late: 'bad' } },
      records: { rows: { kind: 'row', fill: { note: { text: '' } } } },
    });
    expect(checkMoves(c, c.moves)).toEqual([]);
  });

  it('leaves a fixture case meant to fail out of the proof: it has nothing to move', () => {
    const withBad = { widget: 'statuslist@1', cases: { ...listFixture.cases, broken: { props: { items: [{ name: 'X', state: 'broken' }] }, expect: { errors: ['mkp.enum'] } } } };
    const p = packOf('board', 'pack board@1 "Boards."\n  requires core@1\n  provides statuslist rows\n', { 'list.mkp': LIST + '\n' + ROWS + '\n' + TO_ROWS, 'statuslist.fixture.json': withBad });
    const c = compile({ packs: [p] });
    expect(c.diags.errors.map(formatDiagnostic)).toEqual([]);
    expect(checkMoves(c, c.moves)).toEqual([]);
  });

  it('writes a moved use’s items as the author would: no field that only holds its default', () => {
    const c = compile({ packs: [board()] });
    const b = c.document(listDoc, 'today.mkp.md')!;
    applyMove([b], c.moves[0], false, c.defs.get('board:rows@1')!);
    const text = new DocPrinter({ defs: b.defs, env: c.prog.typeEnv('$doc') }).doc(b.doc.front, b.doc.body);
    // note: "" is rows@1's default, and Bins' state (todo) maps to muted, its tone's default
    expect(text).toContain('```rows\nrows:\n  - title: Tea\n    tone: ok\n  - title: Post\n    tone: bad\n  - title: Bins\nsummary: s\n```');
    expect(text).not.toContain('note');
  });

  it('refuses a field with nowhere to go, a value with nowhere to go, and a path that isn’t there', () => {
    const msgs = (move: string) => compile({ packs: [board(move)] }).diags.errors.map((d) => d.message);
    const noIcon = msgs(TO_ROWS.replace('  drop items.icon "rows show no icon"\n', ''));
    expect(noIcon.some((m) => m.includes("the items of statuslist@1's items have a field icon that those of rows@1's rows don't"))).toBe(true);
    const noLate = msgs(TO_ROWS.replace(', late -> bad', ''));
    expect(noLate.some((m) => m.includes('items.state in rows@1 is one of ok, muted, bad, so late from statuslist@1 has nowhere to go'))).toBe(true);
    const noTitle = msgs(TO_ROWS.replace('  rename items.name -> rows.title\n', '  drop items.name "gone"\n'));
    expect(noTitle.some((m) => m.includes("the items of rows@1's rows need title"))).toBe(true);
    const typo = msgs(TO_ROWS.replace('rows.title', 'rows.tilte'));
    expect(typo.some((m) => m.includes("the items of rows@1's rows have no field tilte"))).toBe(true);
    const wrongList = msgs(TO_ROWS.replace('rename items.name -> rows.title', 'rename items.name -> items.title'));
    expect(wrongList.some((m) => m.includes("items's items become rows's"))).toBe(true);
    const badValue = msgs(TO_ROWS.replace('done -> ok', 'finished -> ok'));
    expect(badValue.some((m) => m.includes('found finished on the left of map'))).toBe(true);
  });

  it('fails the proof when a mapped value isn’t one the new widget takes', () => {
    const c = compile({ packs: [board(TO_ROWS.replace('late -> bad', 'late -> red'))] });
    expect(c.diags.errors.map((d) => d.message).join('\n')).toContain('so red from statuslist@1 has nowhere to go');
  });

  it('moves a document’s uses: the widget, its items’ fields and values; the result compiles against rows@1', () => {
    const c = compile({ packs: [board()] });
    const b = c.document(listDoc, 'today.mkp.md')!;
    expect(c.diags.errors).toEqual([]);
    applyMove([b], c.moves[0], false, c.defs.get('board:rows@1')!);
    const text = new DocPrinter({ defs: b.defs, env: c.prog.typeEnv('$doc') }).doc(b.doc.front, b.doc.body);
    expect(text).toContain('```rows');
    expect(text).not.toContain('icon');
    expect(text).not.toContain('statuslist');
    const c2 = compile({ packs: [board()] });
    const b2 = c2.document(text, 'today.mkp.md')!;
    expect(c2.diags.errors.map(formatDiagnostic)).toEqual([]);
    const rows = (b2.doc.body.find((n) => n.def === 'board:rows@1')!.records ?? []).map((r) => [r.props?.title, r.props?.tone]);
    expect(rows).toEqual([
      [{ text: 'Tea' }, { lit: 'ok' }],
      [{ text: 'Post' }, { lit: 'bad' }],
      [{ text: 'Bins' }, { lit: 'muted' }],
    ]);
  });

  it('moves a use inside the pack’s own definitions, written as record lines', () => {
    const today = 'today@1 "Today."\n  statuslist\n    item "Tea" done\n    item "Post" late icon="mail"\n  project md = "today"\n';
    const p = packOf('board', 'pack board@1 "Boards."\n  requires core@1\n  provides statuslist rows today\n', { 'list.mkp': LIST + '\n' + ROWS + '\n' + TO_ROWS, 'today.mkp': today, 'statuslist.fixture.json': listFixture, 'today.fixture.json': { widget: 'today@1', cases: { one: { props: {}, summary: 'One.' } } } });
    const c = compile({ packs: [p] });
    expect(c.diags.errors.map(formatDiagnostic)).toEqual([]);
    const f = c.prog.packs.get('board')!.files.find((x) => x.file.endsWith('today.mkp'))!;
    const items = fileItems(f, c.defs, 'board', () => undefined);
    const hits = applyMove([items], c.moves[0], false, c.defs.get('board:rows@1')!);
    expect(hits).toHaveLength(1);
    const text = printFile(items, { defs: Object.fromEntries(c.defs), env: c.prog.typeEnv('board') });
    expect(text).toContain('  rows\n    row "Tea" tone=ok\n    row "Post" tone=bad');
    expect(text).not.toContain('mail');
  });

  it('moves to a widget of a pack it depends on, and refuses one it doesn’t', () => {
    const ui = packOf('ui', 'pack ui@1 "UI."\n  requires core@1\n  provides rows\n', { 'rows.mkp': ROWS, 'rows.fixture.json': { widget: 'rows@1', cases: { one: { props: { rows: [{ title: 'A' }] }, summary: 'One.' } } } });
    const mk = (depends: boolean) => packOf('board', `pack board@1 "Boards."\n  requires core@1\n${depends ? '  depends ui@1\n' : ''}  provides statuslist\n`, { 'list.mkp': LIST + '\n' + TO_ROWS.replace('-> rows@1', '-> ui:rows@1'), 'statuslist.fixture.json': listFixture });
    const c = compile({ packs: [mk(true), ui] });
    expect(c.diags.errors.map(formatDiagnostic)).toEqual([]);
    expect(c.moves[0]).toMatchObject({ from: 'board:statuslist@1', to: 'ui:rows@1' });
    expect(checkMoves(c, c.moves)).toEqual([]);
    const refused = compile({ packs: [mk(false), ui] }).diags.errors.map((d) => d.message);
    expect(refused.some((m) => m.includes("from pack ui, which pack board doesn't depend on"))).toBe(true);
  });

  it('round-trips: paths and map lines print back as written', () => {
    const c = compile({ packs: [board()] });
    const f = c.prog.packs.get('board')!.files.find((x) => x.file.endsWith('list.mkp'))!;
    const text = printFile(fileItems(f, c.defs, 'board', () => undefined), { defs: Object.fromEntries(c.defs), env: c.prog.typeEnv('board') });
    expect(text).toContain(TO_ROWS.trim());
    const c2 = compile({ packs: [packOf('board', 'pack board@1 "Boards."\n  requires core@1\n  provides statuslist rows\n', { 'list.mkp': text, 'statuslist.fixture.json': listFixture })] });
    expect(c2.diags.errors).toEqual([]);
    expect(stripPos(c2.moves)).toEqual(stripPos(c.moves));
  });
});
