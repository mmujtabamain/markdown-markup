// Migrations, proven on every example: (a) the core of the release it was written for compiles it and
// the steps run on that IR; (b) the source is migrated (old core, steps, printed back, stamped) and
// this release compiles it. (a) and (b) must be the same IR. The old core is the release's own
// mkp.js, downloaded once into MKP_CACHE (or given with MKP_CORE_0_2_1, for working offline).
import { beforeAll, describe, expect, it } from 'vitest';
import { cpSync, existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { compile, formatDiagnostic, migrateBundle, readStamp, RELEASE, stepsBetween, stripPos, type IRBundle, type PackSource } from '@mkp/core';
import { migrateDocument, migratePack, packAfter } from '../src/migrate';
import { releaseCore, type ReleaseCore } from '../src/release-core';

const root = fileURLToPath(new URL('../../../', import.meta.url));
const OLD = '0.2.1';
let old: ReleaseCore;

function folder(dir: string): PackSource {
  const files = new Map<string, Uint8Array>();
  const walk = (d: string): void => {
    for (const n of readdirSync(d)) {
      const p = join(d, n);
      if (statSync(p).isDirectory()) walk(p);
      else files.set(relative(dir, p).split('\\').join('/'), new Uint8Array(readFileSync(p)));
    }
  };
  walk(dir);
  return { label: relative(process.cwd(), dir) || '.', files };
}

const examples = readdirSync(join(root, 'examples'))
  .filter((n) => /^\d\d-/.test(n))
  .map((n) => {
    const dir = join(root, 'examples', n);
    return { name: n, dir, packs: ['pack', 'host'].filter((p) => existsSync(join(dir, p))).map((p) => folder(join(dir, p))) };
  });

/** What must agree: the document's body and its own definitions, without positions and digests. */
const shape = (b: IRBundle) => ({
  front: Object.fromEntries(Object.entries(b.doc.front).filter(([k]) => k !== 'mkp' && k !== 'ir')),
  body: stripPos(b.doc.body),
  own: Object.values(b.defs)
    .filter((d) => d.pack === '$doc' || !d.id.startsWith('core:'))
    .map((d) => stripPos({ ...d, digest: undefined, file: undefined, ir: undefined }))
    .sort((x, y) => (x.id < y.id ? -1 : 1)),
});

beforeAll(async () => {
  expect(process.cwd() + "/").toBe(root);
  old = await releaseCore(OLD, { core: process.env.MKP_CORE_0_2_1 });
}, 120000);

describe('the steps', () => {
  it('run from 0.2.1 to this release, with no hole in the chain', () => {
    const chain = stepsBetween(OLD).map((s) => `${s.from} -> ${s.to}`);
    expect(chain[0]).toBe('0.2.1 -> 0.2.2');
    expect(chain.at(-1)!.endsWith(`-> ${RELEASE}`)).toBe(true);
    for (let i = 1; i < chain.length; i++) expect(chain[i].split(' -> ')[0]).toBe(chain[i - 1].split(' -> ')[1]);
    expect(stepsBetween(RELEASE)).toEqual([]);
    expect(() => stepsBetween('0.2.2', '0.2.1')).toThrow(/can't migrate back/);
  });
});

describe('every example migrated from 0.2.1: the IR route and the source route agree', () => {
  it.each(examples.map((e) => [e.name, e] as const))('%s', async (_n, ex) => {
    const path = join('examples', ex.name, 'doc.mkp.md');
    const text = readFileSync(path, 'utf8');
    const beside = existsSync(path.replace(/\.mkp\.md$/, '.mkp')) ? { text: readFileSync(path.replace(/\.mkp\.md$/, '.mkp'), 'utf8'), file: path.replace(/\.mkp\.md$/, '.mkp') } : undefined;
    // (a) the old compiler, then the IR steps
    const c = old.compile({ packs: ex.packs });
    const b0 = c.document(text, path, undefined, beside ? { docFile: beside } : {}) as IRBundle | null;
    expect(c.diags.errors.map((d) => d.message)).toEqual([]);
    const a = migrateBundle(b0!, { keep: [] });
    expect(a.bundle.mkp).toBe(RELEASE);
    // (b) the source migrated, then this release's compiler
    const m = await migrateDocument(path, { from: OLD, packs: ex.packs, keep: [], current: undefined, core: process.env.MKP_CORE_0_2_1 });
    expect(m.errors).toEqual([]);
    const docText = m.files.get(path)!;
    expect(readStamp(docText, path)).toEqual({ mkp: RELEASE, ir: 1 });
    const besideNew = beside ? { text: m.files.get(beside.file)!, file: beside.file } : undefined;
    const c2 = compile({ packs: ex.packs });
    const b2 = c2.document(docText, path, undefined, besideNew ? { docFile: besideNew } : {});
    expect(c2.diags.errors.map(formatDiagnostic)).toEqual([]);
    const [x, y] = [shape(b2!), shape(a.bundle)];
    if (JSON.stringify(x) !== JSON.stringify(y) && process.env.MKP_DIFF) {
      const { writeFileSync } = await import('node:fs');
      writeFileSync(`${process.env.MKP_DIFF}/${ex.name}.b.json`, JSON.stringify(x, null, 1));
      writeFileSync(`${process.env.MKP_DIFF}/${ex.name}.a.json`, JSON.stringify(y, null, 1));
    }
    expect(x).toEqual(y);
  }, 60000);
});

describe('a 0.2.1 pack with a widget whose input is called theme', () => {
  const pack = (): string => {
    const dir = mkdtempSync(join(tmpdir(), 'mkp-mig-'));
    const p = join(dir, 'looks');
    cpSync(join(root, 'examples/29-a-pack/pack'), p, { recursive: true });
    writeFileSync(join(p, 'manifest.mkp'), 'pack looks@1 "Looks."\n  requires core@1\n  provides badge\n');
    for (const f of readdirSync(p)) if (f !== 'manifest.mkp') rmSync(join(p, f), { recursive: true });
    writeFileSync(join(p, 'badge.mkp'), '# a badge\nbadge@1 "A word on a coloured ground."\n  in word text\n  in theme choice(calm|loud) = calm "how it stands out"\n  row pad=s fill=(if(theme == loud, bad, muted)) radius=pill\n    text "\\val{word}"\n  project md = word\n');
    writeFileSync(join(p, 'badge.fixture.json'), JSON.stringify({ widget: 'badge@1', cases: { loud: { props: { word: 'new', theme: 'loud' }, summary: 'A loud badge.' } } }, null, 2));
    writeFileSync(join(dir, 'note.mkp.md'), '# A note\n\n```badge\nword: hi\ntheme: loud\nsummary: s\n```\n');
    return dir;
  };

  it('migrates the pack: the input renamed in the widget and its fixture, stamped, and it checks', async () => {
    const dir = pack();
    const m = await migratePack(relative(process.cwd(), join(dir, 'looks')), { keep: [], core: process.env.MKP_CORE_0_2_1 });
    expect(m.errors).toEqual([]);
    const at = (f: string) => [...m.files].find(([p]) => p.endsWith(f))![1];
    expect(at('badge.mkp').split('\n')[0]).toBe(`# mkp ${RELEASE} ir 1`);
    expect(at('badge.mkp')).toContain('in look choice(calm|loud) = calm');
    expect(at('badge.mkp')).toContain('if(look == loud, bad, muted)');
    expect(at('badge.mkp')).toContain('# a badge');
    expect(JSON.parse(at('badge.fixture.json')).cases.loud.props).toEqual({ word: 'new', look: 'loud' });
    expect(at('manifest.mkp').split('\n')[0]).toBe(`# mkp ${RELEASE} ir 1`);
    expect(m.result!.warnings.map((w) => w.code)).toEqual(['mkp.migrate-renamed']);
    expect(m.result!.warnings[0].message).toContain('Documents elsewhere that set theme: on badge must be migrated too');
  }, 60000);

  it('migrates a document that uses it, compiled against the pack as it was and checked against it migrated', async () => {
    const dir = pack();
    const before = folder(join(dir, 'looks'));
    const p = await migratePack(relative(process.cwd(), join(dir, 'looks')), { keep: [], core: process.env.MKP_CORE_0_2_1 });
    // checked against the pack as it was, the result can't compile: say so, write nothing
    const alone = await migrateDocument(relative(process.cwd(), join(dir, 'note.mkp.md')), { keep: [], core: process.env.MKP_CORE_0_2_1, packs: [before] });
    expect(alone.errors.join('\n')).toMatch(/has no input "look"/);
    const m = await migrateDocument(relative(process.cwd(), join(dir, 'note.mkp.md')), { keep: [], core: process.env.MKP_CORE_0_2_1, packs: [before], packsAfter: [packAfter(before, p)] });
    expect(m.errors).toEqual([]);
    const text = [...m.files.values()][0];
    expect(text).toContain('look: loud');
    expect(text).not.toMatch(/^theme:/m);
  }, 60000);
});

describe('a stored 0.2.1 bundle', () => {
  it('is migrated by its stamp, renamed, stamped and drawn by this runtime; kept looks are pinned', async () => {
    const src = '```mkp\nq "A widget."\n  in theme text = "x"\n  zoom\n    text (theme)\n  project md = theme\n```\n\n```q\ntheme: dark\nsummary: s\n```\n';
    const c = old.compile({ packs: [] });
    const b = c.document(src, 'q.mkp.md') as IRBundle;
    expect(b.mkp).toBeUndefined();
    const plain = migrateBundle(b);
    expect(plain.from).toBe(OLD);
    expect(plain.bundle.mkp).toBe(RELEASE);
    const q = Object.values(plain.bundle.defs).find((d) => d.name === 'q')!;
    expect(q.inputs.map((i) => i.name)).toEqual(['look']);
    expect(Object.keys(plain.bundle.doc.body[0].props!)).toContain('look');
    expect(JSON.stringify(q.view)).not.toMatch(/minscale/);
    const kept = migrateBundle(b, { keep: ['zoom-minscale'] });
    expect(JSON.stringify(Object.values(kept.bundle.defs).find((d) => d.name === 'q')!.view)).toContain('"minscale":{"lit":0}');
    expect(kept.kept).toEqual(['zoom-minscale']);
    // the original is untouched
    expect(Object.values(b.defs).find((d) => d.name === 'q')!.inputs[0].name).toBe('theme');
  });
});

describe('mkp migrate, the command', () => {
  it('migrates a pack and the documents using it in one run; --check fails until it is done', async () => {
    const { execFileSync, spawnSync } = await import('node:child_process');
    execFileSync(process.execPath, [join(root, 'packages/cli/scripts/build.mjs')], { stdio: 'ignore', timeout: 120000 });
    const main = async (argv: string[]): Promise<number> => spawnSync(process.execPath, [join(root, 'packages/cli/dist/mkp.cjs'), ...argv], { cwd: root, encoding: 'utf8', timeout: 120000, env: process.env }).status ?? -1;
    const dir = mkdtempSync(join(tmpdir(), 'mkp-mig-cli-'));
    const p = join(dir, 'looks');
    cpSync(join(root, 'examples/29-a-pack/pack'), p, { recursive: true });
    for (const f of readdirSync(p)) rmSync(join(p, f), { recursive: true });
    writeFileSync(join(p, 'manifest.mkp'), 'pack looks@1 "Looks."\n  requires core@1\n  provides badge\n');
    writeFileSync(join(p, 'badge.mkp'), 'badge@1 "A word."\n  in word text\n  in theme choice(calm|loud) = calm\n  zoom\n    text "\\val{word}"\n  project md = word\n');
    writeFileSync(join(p, 'badge.fixture.json'), JSON.stringify({ widget: 'badge@1', cases: { one: { props: { word: 'a', theme: 'loud' }, summary: 'One.' } } }));
    writeFileSync(join(dir, 'note.mkp.md'), '# A note\n\n```badge\nword: hi\ntheme: loud\nsummary: s\n```\n');
    const core = process.env.MKP_CORE_0_2_1 ? ['--core', process.env.MKP_CORE_0_2_1] : [];
    const args = [relative(process.cwd(), p), relative(process.cwd(), join(dir, 'note.mkp.md')), '--keep', 'zoom-minscale', ...core];
    expect(await main(['migrate', ...args, '--check'])).toBe(1);
    expect(await main(['migrate', ...args, '--write'])).toBe(0);
    expect(readFileSync(join(p, 'badge.mkp'), 'utf8')).toContain('zoom minscale=0');
    expect(readFileSync(join(dir, 'note.mkp.md'), 'utf8')).toMatch(new RegExp(`^---\\nmkp: ${RELEASE.replace(/\./g, '\\.')}\\nir: 1\\n---\\n[\\s\\S]*look: loud`));
    // now written for this release: nothing to do
    expect(await main(['migrate', ...args.slice(0, 2), '--check'])).toBe(0);
  }, 120000);
});

describe('a pack’s own new version', () => {
  it('moves a current document’s uses of walk@1 to walk@2 as the pack declares, keeping the old look when asked', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'mkp-mig-move-'));
    const p = join(dir, 'trips');
    cpSync(join(root, 'examples/29-a-pack/pack'), p, { recursive: true });
    for (const f of readdirSync(p)) rmSync(join(p, f), { recursive: true });
    writeFileSync(join(p, 'manifest.mkp'), 'pack trips@1 "Trips."\n  requires core@1\n  provides walk\n');
    writeFileSync(join(p, 'walk.mkp'), 'walk@1 "A walk."\n  deprecated "use walk@2"\n  in from text\n  in speed num = 1\n  text "from \\val{from}"\n  project md = from\n\nwalk@2 "A walk."\n  in start text\n  in look choice(classic|new) = new\n  text "from \\val{start} (\\val{look})"\n  project md = start\n\nmigrate walk@1 -> walk@2\n  rename from -> start\n  drop speed "walk@2 sets its own pace"\n  keep look = classic "walk@1\'s look"\n');
    writeFileSync(join(p, 'walk.fixture.json'), JSON.stringify({ widget: 'walk@1', cases: { one: { props: { from: 'home' }, summary: 'One.' } } }));
    const doc = join(dir, 'trip.mkp.md');
    writeFileSync(doc, `---\nmkp: ${RELEASE}\nir: 1\n---\n# Trip\n\n\`\`\`walk@1\nfrom: home\nspeed: 3\nsummary: s\n\`\`\`\n`);
    const m = await migrateDocument(relative(process.cwd(), doc), { keep: ['walk@2'], packs: [folder(p)] });
    expect(m.errors).toEqual([]);
    const text = [...m.files.values()][0];
    expect(text).toContain('```walk@2\nstart: home\nlook: classic\nsummary: s\n```');
    expect(m.result!.warnings.map((w) => w.code)).toEqual(['mkp.migrate-moved']);
    expect(m.result!.warnings[0].message).toContain('from is now start; speed is gone (walk@2 sets its own pace). Kept the old look');
    // taking the new look: no look line
    const t = await migrateDocument(relative(process.cwd(), doc), { keep: [], packs: [folder(p)] });
    expect([...t.files.values()][0]).toContain('```walk@2\nstart: home\nsummary: s\n```');
  });
});

describe('a pack’s move to another widget', () => {
  it('moves a document’s uses of statuslist@1 to rows@1: its items’ fields renamed and dropped, their values mapped', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'mkp-mig-rows-'));
    const p = join(dir, 'board');
    mkdirSync(p);
    writeFileSync(join(p, 'manifest.mkp'), 'pack board@1 "Boards."\n  requires core@1\n  provides statuslist rows\n');
    writeFileSync(
      join(p, 'list.mkp'),
      [
        'statuslist@1 "Items with a state."',
        '  deprecated "use rows@1"',
        '  in items list(record item {name: text, state: choice(done|todo|late) = todo, icon: text = ""})',
        '  column',
        '    each it in items key=it.name',
        '      text "\\val{it.name}: \\val{it.state}"',
        '  project md = join(map(items, i => i.name), ", ")',
        '',
        'rows@1 "Rows with a tone."',
        '  in rows list(record row {title: text, tone: choice(ok|muted|bad) = muted})',
        '  column',
        '    each r in rows key=r.title',
        '      text "\\val{r.title}" tone=(r.tone)',
        '  project md = join(map(rows, r => r.title), ", ")',
        '',
        'migrate statuslist@1 -> rows@1',
        '  rename items -> rows',
        '  rename items.name -> rows.title',
        '  rename items.state -> rows.tone',
        '  drop items.icon "rows show no icon"',
        '  map items.state: done -> ok, todo -> muted, late -> bad',
        '',
      ].join('\n'),
    );
    writeFileSync(join(p, 'statuslist.fixture.json'), JSON.stringify({ widget: 'statuslist@1', cases: { two: { props: { items: [{ name: 'Tea', state: 'done', icon: 'cup' }, { name: 'Post' }] }, summary: 'Two.' } } }));
    writeFileSync(join(p, 'rows.fixture.json'), JSON.stringify({ widget: 'rows@1', cases: { one: { props: { rows: [{ title: 'Tea' }] }, summary: 'One.' } } }));
    const doc = join(dir, 'today.mkp.md');
    writeFileSync(doc, `---\nmkp: ${RELEASE}\nir: 1\n---\n# Today\n\n\`\`\`statuslist\nitems:\n  - {name: Tea, state: done, icon: cup}\n  - {name: Post, state: late}\nsummary: s\n\`\`\`\n`);
    const { execFileSync, spawnSync } = await import('node:child_process');
    execFileSync(process.execPath, [join(root, 'packages/cli/scripts/build.mjs')], { stdio: 'ignore', timeout: 120000 });
    const main = (argv: string[]): number => {
      const r = spawnSync(process.execPath, [join(root, 'packages/cli/dist/mkp.cjs'), ...argv], { cwd: root, encoding: 'utf8', timeout: 120000, env: process.env });
      if (r.status) console.log(r.stdout, r.stderr);
      return r.status ?? -1;
    };
    expect(main(['check', '--pack', p])).toBe(0);
    const m = await migrateDocument(relative(process.cwd(), doc), { packs: [folder(p)] });
    expect(m.errors).toEqual([]);
    const text = [...m.files.values()][0];
    expect(text).toMatch(/```rows\nrows:\n  - title: Tea\n    tone: ok\n  - title: Post\n    tone: bad\nsummary: s\n```/);
    expect(m.result!.warnings.map((w) => w.message)).toEqual([
      'this use of statuslist@1 moved to rows@1: items is now rows; items.name is now rows.title; items.state is now rows.tone; items.icon is gone (rows show no icon); items.state: done is now ok, todo is now muted, late is now bad.',
    ]);
    expect(main(['migrate', doc, '--pack', p, '--take', 'all', '--write'])).toBe(0);
    expect(readFileSync(doc, 'utf8')).toContain('```rows\n');
    expect(main(['migrate', doc, '--pack', p, '--check'])).toBe(0);
  }, 120000);

  it('says what --check would change when a pack file only lacks its stamp, and says when everything is up to date', async () => {
    const { execFileSync, spawnSync } = await import('node:child_process');
    execFileSync(process.execPath, [join(root, 'packages/cli/scripts/build.mjs')], { stdio: 'ignore', timeout: 120000 });
    const run = (argv: string[]) => spawnSync(process.execPath, [join(root, 'packages/cli/dist/mkp.cjs'), ...argv], { cwd: root, encoding: 'utf8', timeout: 120000, env: process.env });
    const dir = mkdtempSync(join(tmpdir(), 'mkp-mig-stamp-'));
    const p = join(dir, 'looks');
    mkdirSync(p);
    writeFileSync(join(p, 'manifest.mkp'), `# mkp ${RELEASE} ir 1\npack looks@1 "Looks."\n  requires core@1\n  provides badge\n`);
    writeFileSync(join(p, 'badge.mkp'), 'badge@1 "A word."\n  in word text\n  text word\n  project md = word\n');
    writeFileSync(join(p, 'badge.fixture.json'), JSON.stringify({ widget: 'badge@1', cases: { one: { props: { word: 'a' }, summary: 'One.' } } }));
    const check = run(['migrate', p, '--check']);
    expect(check.status).toBe(1);
    expect(check.stderr).toContain(`warning mkp.migrate-stamp: ${join(relative(root, p), 'badge.mkp')} has no stamp of its own; the file that sets its release says ${RELEASE}, so the only change would be its stamp: # mkp ${RELEASE} ir 1 as its first line`);
    const json = run(['migrate', p, '--check', '--format', 'json']);
    expect(json.stderr.split('\n').filter(Boolean).map((l) => JSON.parse(l).code)).toEqual(['mkp.migrate-stamp']);
    expect(run(['migrate', p, '--write']).status).toBe(0);
    expect(readFileSync(join(p, 'badge.mkp'), 'utf8').startsWith(`# mkp ${RELEASE} ir 1\n`)).toBe(true);
    const again = run(['migrate', p, '--check']);
    expect(again.status).toBe(0);
    expect(again.stderr).toContain(`up to date (${RELEASE})`);
  }, 120000);
});

describe('a released .mkpack from 0.2.1', () => {
  it('is migrated as the pack it holds, and written back as a .mkpack', async () => {
    const { writeZip, readZip, Diagnostics } = await import('@mkp/core');
    const { execFileSync, spawnSync } = await import('node:child_process');
    const dir = mkdtempSync(join(tmpdir(), 'mkp-mig-zip-'));
    const enc = new TextEncoder();
    const zip = join(dir, 'looks.mkpack');
    writeFileSync(zip, writeZip(new Map([
      ['manifest.mkp', enc.encode('pack looks@1 "Looks."\n  requires core@1\n  provides badge\n')],
      ['badge.mkp', enc.encode('badge@1 "A word."\n  in word text\n  in theme text = "x"\n  text "\\val{word} \\val{theme}"\n  project md = word\n')],
      ['badge.fixture.json', enc.encode(JSON.stringify({ widget: 'badge@1', cases: { one: { props: { word: 'a', theme: 'y' }, summary: 'One.' } } }))],
    ])));
    execFileSync(process.execPath, [join(root, 'packages/cli/scripts/build.mjs')], { stdio: 'ignore', timeout: 120000 });
    const core = process.env.MKP_CORE_0_2_1 ? ['--core', process.env.MKP_CORE_0_2_1] : [];
    const r = spawnSync(process.execPath, [join(root, 'packages/cli/dist/mkp.cjs'), 'migrate', relative(root, zip), '--write', '--take', 'all', ...core], { cwd: root, encoding: 'utf8', env: process.env, timeout: 120000 });
    expect(r.status, r.stderr).toBe(0);
    const files = readZip(new Uint8Array(readFileSync(zip)), 'looks.mkpack', new Diagnostics())!.files;
    const text = (f: string) => new TextDecoder().decode(files.get(f));
    expect(text('badge.mkp').startsWith(`# mkp ${RELEASE} ir 1\n`)).toBe(true);
    expect(text('badge.mkp')).toContain('in look text = "x"');
    expect(JSON.parse(text('badge.fixture.json')).cases.one.props).toEqual({ word: 'a', look: 'y' });
  }, 120000);
});

describe('a pack given to migrate and with --pack', () => {
  it('is compiled once by the older release’s core; a document in a run whose pack fails is left as it is', async () => {
    const { execFileSync, spawnSync } = await import('node:child_process');
    execFileSync(process.execPath, [join(root, 'packages/cli/scripts/build.mjs')], { stdio: 'ignore', timeout: 120000 });
    const core = process.env.MKP_CORE_0_2_1 ? ['--core', process.env.MKP_CORE_0_2_1] : [];
    const run = (argv: string[], cwd: string) => spawnSync(process.execPath, [join(root, 'packages/cli/dist/mkp.cjs'), ...argv, ...core], { cwd, encoding: 'utf8', timeout: 120000, env: process.env });
    const dir = mkdtempSync(join(tmpdir(), 'mkp-mig-twice-'));
    // DevBench's repro: a pack with no stamp (so written for 0.2.1), given both ways
    mkdirSync(join(dir, 'tiny'));
    writeFileSync(join(dir, 'tiny/manifest.mkp'), 'pack tiny@1 "A one-widget pack."\n  requires core@1\n  provides hello\n  unpublished\n');
    writeFileSync(join(dir, 'tiny/hello.mkp'), 'hello@1 "Says hello."\n  in who text = "world" "who to greet"\n  text "hello"\n  project md = "hello"\n');
    writeFileSync(join(dir, 'note.mkp.md'), '# A note\n\n```hello\nwho: you\nsummary: s\n```\n');
    const check = run(['migrate', 'tiny', 'note.mkp.md', '--pack', 'tiny', '--check'], dir);
    expect(check.stderr).not.toContain('mkp.pack-duplicate');
    expect(check.stderr).toContain('tiny: 0.2.1 -> 0.2.2');
    expect(check.status).toBe(1);
    expect(run(['migrate', 'tiny', 'note.mkp.md', '--pack', join(dir, 'tiny'), '--take', 'all', '--write'], dir).status).toBe(0);
    expect(readFileSync(join(dir, 'tiny/manifest.mkp'), 'utf8').startsWith(`# mkp ${RELEASE} ir 1`)).toBe(true);
    expect(readFileSync(join(dir, 'note.mkp.md'), 'utf8').startsWith(`---\nmkp: ${RELEASE}`)).toBe(true);
    // a pack that fails: the document with it isn't written for a pack that stays as it was
    mkdirSync(join(dir, 'bad'));
    writeFileSync(join(dir, 'bad/manifest.mkp'), 'pack bad@1 "A pack that doesn\'t compile."\n  requires core@1\n  provides oops\n');
    writeFileSync(join(dir, 'bad/oops.mkp'), 'oops@1 "Broken."\n  text (nothing_here)\n  project md = "x"\n');
    const before = '# Another\n\nSome text.\n';
    writeFileSync(join(dir, 'other.mkp.md'), before);
    const failed = run(['migrate', 'bad', 'other.mkp.md', '--take', 'all', '--write'], dir);
    expect(failed.status).toBe(1);
    expect(failed.stderr).toContain("other.mkp.md is left as it is: bad didn't migrate in this run");
    expect(readFileSync(join(dir, 'other.mkp.md'), 'utf8')).toBe(before);
  }, 120000);
});

describe('a document migrated after its pack', () => {
  it('says the order is the cause when a pack is already newer than the document', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'mkp-mig-order-'));
    const p = join(dir, 'looks');
    mkdirSync(p);
    // migrated in an earlier run: stamped for this release, and using what 0.2.1 doesn't have (padx)
    writeFileSync(join(p, 'manifest.mkp'), `# mkp ${RELEASE} ir 1\npack looks@1 "Looks."\n  requires core@1\n  provides badge\n`);
    writeFileSync(join(p, 'badge.mkp'), `# mkp ${RELEASE} ir 1\nbadge@1 "A word."\n  in word text\n  column padx=s\n    text word\n  project md = word\n`);
    writeFileSync(join(p, 'badge.fixture.json'), JSON.stringify({ widget: 'badge@1', cases: { one: { props: { word: 'a' }, summary: 'One.' } } }));
    const doc = join(dir, 'note.mkp.md');
    writeFileSync(doc, '# A note\n\n```badge\nword: hi\nsummary: s\n```\n');
    const m = await migrateDocument(relative(process.cwd(), doc), { packs: [folder(p)], core: process.env.MKP_CORE_0_2_1 });
    expect(m.errors[0]).toContain(`is written for MKP ${OLD}, but ${relative(process.cwd(), p)} is already migrated to ${RELEASE}`);
    expect(m.errors[0]).toContain('migrate it in the same run as its packs');
    // the same pack as it was for 0.2.1, in one run with the document: no such line
    writeFileSync(join(p, 'manifest.mkp'), 'pack looks@1 "Looks."\n  requires core@1\n  provides badge\n');
    writeFileSync(join(p, 'badge.mkp'), 'badge@1 "A word."\n  in word text\n  column pad=s\n    text word\n  project md = word\n');
    const ok = await migrateDocument(relative(process.cwd(), doc), { packs: [folder(p)], core: process.env.MKP_CORE_0_2_1 });
    expect(ok.errors).toEqual([]);
  }, 120000);
});

describe('the Migrations tab’s example', () => {
  it('is what mkp migrate writes and says', async () => {
    const dir = 'apps/site/migrations/0.2.2';
    const m = await migrateDocument(join(dir, 'before.mkp.md'), { keep: [], core: process.env.MKP_CORE_0_2_1 });
    expect(m.errors).toEqual([]);
    // the after is as that release wrote it: today's mkp migrate stamps this release, and does the same otherwise
    expect([...m.files.values()][0].replace(`mkp: ${RELEASE}\n`, 'mkp: 0.2.2\n')).toBe(readFileSync(join(dir, 'after.mkp.md'), 'utf8'));
    const said = readFileSync(join(dir, 'said.txt'), 'utf8');
    for (const w of m.result!.warnings) expect(said).toContain(`before.mkp.md:${w.pos!.line}:${w.pos!.col} warning ${w.code}: ${w.message}`);
  });
});
