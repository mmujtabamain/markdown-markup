#!/usr/bin/env node
// Runs the migration over a corpus of real MKP 0.2 documents and writes a table of the results.
//
//   node corpus/run.mjs --root02 <0.2 tree> --mkp02 <0.2 cli> [--docs <dir of 0.2 documents as .md>]
//        [--pack <0.2 pack they use>] [--mkp03 <0.3 mkp>] [--work <dir>] [--table RESULTS.md]
//        [--cases <dir of mkp cases output>] [--extra <dir of .mkp.md>] [--pack-widgets] [--no-source]
//
// For each document: 0.2 builds its bundle (mkp build --target ir) and its Markdown (--target md); the
// migration writes the 0.3 document and pack shims from the bundle alone; 0.3's `mkp fmt` formats it
// and `mkp check --json` checks it; `mkp md` writes its Markdown. The result is classified as clean,
// warnings or fails, and the share of the 0.2 Markdown's words that the 0.3 Markdown still has is
// measured (word recall), as a rough check that nothing was dropped.

import { spawnSync } from 'node:child_process';
import { copyFileSync, existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync, rmSync } from 'node:fs';
import { basename, dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { tmpdir } from 'node:os';
import { migrate } from '../src/migrate.mjs';
import { sourceComments, kept } from '../src/source.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const args = process.argv.slice(2);
const opt = (name, d) => {
  const i = args.indexOf(name);
  return i === -1 ? d : args[i + 1];
};
const root02 = opt('--root02');
const mkp02 = opt('--mkp02');
const docsDir = opt('--docs');
// the pack --docs and --extra documents are built with
const docsPack = opt('--pack');
// cases 0.2 made from a pack's fixtures (mkp cases --pack <pack> --out <dir>): one bundle per widget
const casesDir = opt('--cases');
const mkp03 = resolve(opt('--mkp03', join(here, '../../../targets/rust/target/release/mkp')));
const work = resolve(opt('--work', join(tmpdir(), 'migrate-0.2')));
const table = opt('--table', join(here, '..', 'RESULTS.md'));
const packWidgets = args.includes('--pack-widgets');
// --no-source: migrate from the IR alone, as the first prototype did
const noSource = args.includes('--no-source');
if (!root02 || !mkp02) {
  console.error('usage: node corpus/run.mjs --root02 <0.2 tree> --mkp02 <0.2 cli> [--docs dir] [--pack dir] [--mkp03 mkp] [--work dir] [--table file]');
  process.exit(2);
}

// ---------------------------------------------------------------------------------------------
// The corpus

const corpus = [];
for (const d of readdirSync(join(root02, 'examples')).filter((x) => /^\d\d-/.test(x)).sort()) {
  const dir = join(root02, 'examples', d);
  const packs = ['pack', 'host'].map((p) => join(dir, p)).filter(existsSync);
  corpus.push({ id: `example ${d}`, group: 'examples', src: join(dir, 'doc.mkp.md'), packs });
}
for (const k of ['base', 'derived'])
  for (const f of readdirSync(join(root02, 'widgets', k)).filter((x) => x.endsWith('.mkp.md')).sort())
    corpus.push({ id: `widgets/${k} ${f.replace('.mkp.md', '')}`, group: 'widget docs', src: join(root02, 'widgets', k, f), packs: [] });
// the release notes, the site's pages and the recipe: 0.2 documents too
for (const [dir, label] of [['changelog', 'changelog'], ['apps/site/docs-src', 'site'], ['apps/site/migrations/0.2.2', 'site migrations/0.2.2'], ['recipes', 'recipes']])
  if (existsSync(join(root02, dir)))
    for (const f of readdirSync(join(root02, dir)).filter((x) => x.endsWith('.mkp.md')).sort())
      corpus.push({ id: `${label} ${f.replace('.mkp.md', '')}`, group: 'changelog, site and recipe', src: join(root02, dir, f), packs: [] });
const extra = opt('--extra');
if (extra)
  for (const f of readdirSync(extra).filter((x) => x.endsWith('.mkp.md')).sort())
    corpus.push({ id: `extra ${f.replace('.mkp.md', '')}`, group: 'written for this test', src: join(extra, f), packs: docsPack ? [docsPack] : [] });
for (const f of readdirSync(join(root02, 'docs')).filter((x) => x.endsWith('.md')).sort())
  corpus.push({ id: `docs ${f.replace('.md', '')}`, group: 'guides', src: join(root02, 'docs', f), packs: [], rename: true });
for (const f of readdirSync(join(root02, 'conformance', 'cases')).filter((x) => /^base\..*\.json$/.test(x)).sort())
  corpus.push({ id: `conformance ${f.replace('.json', '')}`, group: 'conformance (IR only)', bundle: join(root02, 'conformance', 'cases', f) });
if (casesDir)
  for (const f of readdirSync(casesDir).filter((x) => x.endsWith('.cases.json')).sort())
    corpus.push({ id: `fixture ${f.replace('.cases.json', '')}`, group: 'pack fixtures (IR only)', cases: join(casesDir, f) });
if (docsDir)
  for (const f of readdirSync(docsDir).filter((x) => x.endsWith('.md')).sort())
    corpus.push({ id: `doc ${f.replace(/(\.mkp)?\.md$/, '')}`, group: 'more documents', src: join(docsDir, f), packs: docsPack ? [docsPack] : [], rename: !f.endsWith('.mkp.md') });

// ---------------------------------------------------------------------------------------------

const run = (cmd, argv, cwd) => spawnSync(cmd, argv, { cwd, encoding: 'utf8', maxBuffer: 64 << 20 });
const words = (s) => (s.toLowerCase().match(/[\p{L}\p{N}]+/gu) ?? []).filter((w) => w.length > 1);

function recall(a, b) {
  const have = new Map();
  for (const w of words(b)) have.set(w, (have.get(w) ?? 0) + 1);
  // 0.2's Markdown opens with a comment naming the file it was made from: not content
  const want = words(a.replace(/<!--[\s\S]*?-->/g, ''));
  if (!want.length) return null;
  let hit = 0;
  for (const w of want) {
    const n = have.get(w) ?? 0;
    if (n > 0) {
      hit++;
      have.set(w, n - 1);
    }
  }
  return hit / want.length;
}

const results = [];
for (const c of corpus) {
  const slug = c.id.replace(/[^A-Za-z0-9.-]+/g, '_');
  const dir = join(work, slug);
  mkdirSync(dir, { recursive: true });
  for (const f of readdirSync(dir)) if (f !== '02' && f !== 'source.mkp.md') rmSync(join(dir, f), { recursive: true, force: true });
  const r = { id: c.id, group: c.group };
  results.push(r);
  let bundle;
  let source;
  let md02 = null;
  if (c.cases) {
    const first = JSON.parse(readFileSync(c.cases, 'utf8'))[0];
    bundle = first.bundle;
  } else if (c.bundle) {
    const kase = JSON.parse(readFileSync(c.bundle, 'utf8'));
    bundle = kase.bundle;
    md02 = typeof kase.md === 'string' ? kase.md : typeof kase.md?.md === 'string' ? kase.md.md : null;
  } else {
    // a 0.2 document is named .mkp.md; the guides and --docs' documents may be plain .md
    const src = c.rename ? join(dir, 'source.mkp.md') : c.src;
    if (c.rename) copyFileSync(c.src, src);
    source = readFileSync(src, 'utf8');
    const packArgs = c.packs.flatMap((p) => ['--pack', p]);
    // 0.2's build is slow and doesn't change: kept between runs
    let b = { stdout: '', stderr: '' };
    if (!existsSync(join(dir, '02'))) b = run('node', [mkp02, 'build', src, ...packArgs, '--target', 'ir,md', '--out', join(dir, '02')]);
    const out = existsSync(join(dir, '02')) ? readdirSync(join(dir, '02')) : [];
    const irFile = out.find((f) => f.endsWith('.ir.json'));
    if (!irFile) {
      r.result = 'not built by 0.2';
      // 0.2 names the file from where this runs: named here from the 0.2 tree, wherever that is
      r.why = (b.stdout + b.stderr).trim().split('\n')[0].replaceAll(relative(process.cwd(), root02) + '/', '');
      continue;
    }
    bundle = JSON.parse(readFileSync(join(dir, '02', irFile), 'utf8'));
    const mdFile = out.find((f) => f.endsWith('.md') && !f.endsWith('.mkp.md'));
    md02 = mdFile ? readFileSync(join(dir, '02', mdFile), 'utf8') : null;
  }
  let m;
  try {
    m = migrate(bundle, { source: noSource ? undefined : source, packWidgets });
  } catch (e) {
    r.result = 'fails';
    r.why = `the migration threw: ${e.message}`;
    continue;
  }
  const doc = join(dir, 'doc.mkp.md');
  writeFileSync(doc, m.doc);
  const packDirs = [];
  for (const [p, text] of m.packs) {
    mkdirSync(join(dir, 'packs', p), { recursive: true });
    writeFileSync(join(dir, 'packs', p, `${p}.mkp`), text);
    packDirs.push(join(dir, 'packs', p));
  }
  writeFileSync(join(dir, 'notes.json'), JSON.stringify({ counts: m.counts, notes: m.notes }, null, 1));
  // comments: how many the source had, and how many the output still has, as comments or in place
  if (source) {
    const cs = sourceComments(source);
    const outs = [m.doc, ...m.packs.values()];
    r.comments = cs.length;
    r.commentsKept = cs.filter((c) => kept(c, outs)).length;
    r.lost = cs.filter((c) => !kept(c, outs)).map((c) => `${c.kind}: ${c.text.slice(0, 50)}`);
  }
  Object.assign(r, m.counts);
  r.todo = m.notes.filter((n) => n.kind === 'todo').length;
  r.fallback = m.notes.filter((n) => n.kind === 'fallback').length;
  r.changed = m.notes.filter((n) => n.kind === 'lossy').length;
  r.lines = m.doc.split('\n').length;
  // mkp fmt: the canonical layout, in place
  const before = m.doc;
  const files = [doc, ...packDirs.map((p) => join(p, `${basename(p)}.mkp`))];
  const f = run(mkp03, ['fmt', ...files]);
  r.fmt = f.status === 0 ? (readFileSync(doc, 'utf8') === before ? 'as written' : 'reformatted') : 'refused';
  if (f.status !== 0) r.fmtError = (f.stdout + f.stderr).trim().split('\n')[0];
  // mkp check
  const k = run(mkp03, ['check', '--json', ...(packDirs.length ? ['--pack', packDirs.join(',')] : []), doc]);
  let diags = [];
  try {
    diags = JSON.parse(k.stdout || '[]');
  } catch {
    diags = [{ severity: 'error', code: 'mkp.crash', message: (k.stdout + k.stderr).trim().split('\n')[0] }];
  }
  const errors = diags.filter((d) => d.severity === 'error');
  const warns = diags.filter((d) => d.severity !== 'error');
  r.errors = errors.length;
  r.warnings = warns.length;
  r.errorCodes = [...new Set(errors.map((d) => d.code))];
  r.warnCodes = [...new Set(warns.map((d) => d.code))];
  r.firstError = errors[0] ? `${basename(errors[0].file ?? '')}:${errors[0].line}: ${errors[0].code}: ${errors[0].message}` : undefined;
  r.result = errors.length ? 'fails' : warns.length ? 'warnings' : 'clean';
  // Markdown, 0.2 against 0.3: how many of 0.2's words are still there
  if (!errors.length && md02) {
    const md = run(mkp03, ['md', ...(packDirs.length ? ['--pack', packDirs.join(',')] : []), doc]);
    if (md.status === 0) {
      writeFileSync(join(dir, 'doc.03.md'), md.stdout);
      r.recall = recall(md02, md.stdout);
    }
  }
  if (r.fmt === 'refused' && r.result !== 'fails') r.result = 'fails';
}

writeFileSync(join(work, 'results.json'), JSON.stringify(results, null, 1));

// ---------------------------------------------------------------------------------------------
// The table

const pct = (x) => (x == null ? '' : `${Math.round(x * 100)}%`);
const count = (rs, res) => rs.filter((r) => r.result === res).length;
const groups = [...new Set(results.map((r) => r.group))];
const lines = [];
lines.push('# Migrating the 0.2 corpus: results', '');
lines.push(`Generated by \`node tools/migrate-0.2/corpus/run.mjs\` on ${new Date().toISOString().slice(0, 10)}. Each document was built by MKP 0.2.10, migrated from its IR alone, formatted by \`mkp fmt\` and checked by \`mkp check\` (0.3). Recall is the share of the words in 0.2's Markdown output that 0.3's \`mkp md\` output of the migrated document still has.`, '');
lines.push(`Packs: ${packWidgets ? "each pack widget written with a 0.3 view where its 0.2 definition migrates (--pack-widgets), an extern widget otherwise" : 'each pack widget an extern widget with a markdown block (the shim)'}.`, '');
lines.push(`Source: ${noSource ? 'not read (the IR alone)' : "read beside the IR, for its comments, link definitions and key order"}.`, '');
lines.push('| Group | Documents | Clean | Warnings | Fails | Not built by 0.2 | Blocks migrated | Definitions migrated | Pack widgets with a view | Comments kept | Median recall |', '|---|---|---|---|---|---|---|---|---|---|---|');
const row = (name, rs) => {
  const built = rs.filter((r) => r.blocks !== undefined);
  const rec = built.map((r) => r.recall).filter((x) => x != null).sort((a, b) => a - b);
  const sum = (k) => built.reduce((s, r) => s + (r[k] ?? 0), 0);
  lines.push(`| ${name} | ${rs.length} | ${count(rs, 'clean')} | ${count(rs, 'warnings')} | ${count(rs, 'fails')} | ${count(rs, 'not built by 0.2')} | ${sum('widgets')}/${sum('blocks')} | ${sum('defsMigrated')}/${sum('defs')} | ${sum('packWidgetsWritten')}/${sum('packWidgets')} | ${sum('commentsKept')}/${sum('comments')} | ${pct(rec[Math.floor(rec.length / 2)])} |`);
};
for (const g of groups) row(g, results.filter((r) => r.group === g));
row('**All**', results);
lines.push('', '## Per document', '');
lines.push('| Document | Result | Blocks | Definitions | TODO | Kept as Markdown | Changed | Comments kept | Recall | `mkp fmt` | First error or warning codes |', '|---|---|---|---|---|---|---|---|---|---|---|');
for (const r of results) {
  const detail = r.result === 'fails' ? (r.firstError ?? r.why ?? r.fmtError ?? '') : r.result === 'not built by 0.2' ? r.why : (r.warnCodes ?? []).join(', ');
  lines.push(
    `| ${r.id} | ${r.result} | ${r.blocks !== undefined ? `${r.widgets}/${r.blocks}` : ''} | ${r.defs !== undefined ? `${r.defsMigrated}/${r.defs}` : ''} | ${r.todo ?? ''} | ${r.fallback ?? ''} | ${r.changed ?? ''} | ${r.comments ? `${r.commentsKept}/${r.comments}` : ''} | ${pct(r.recall)} | ${r.fmt ?? ''} | ${String(detail ?? '').replace(/\|/g, '\\|').replace(/\n/g, ' ').slice(0, 160)} |`,
  );
}
const codes = new Map();
for (const r of results) for (const c of r.errorCodes ?? []) codes.set(c, (codes.get(c) ?? 0) + 1);
if (codes.size) {
  lines.push('', '## Error codes, by documents that have them', '', '| Code | Documents |', '|---|---|');
  for (const [c, n] of [...codes].sort((a, b) => b[1] - a[1])) lines.push(`| ${c} | ${n} |`);
}
writeFileSync(table, lines.join('\n') + '\n');
console.log(`${results.length} documents: ${count(results, 'clean')} clean, ${count(results, 'warnings')} with warnings, ${count(results, 'fails')} fail, ${count(results, 'not built by 0.2')} not built by 0.2. Table: ${table}`);
