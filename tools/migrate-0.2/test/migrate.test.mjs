// node --test test/  — the migration on two real 0.2 bundles (built by mkp 0.2.10), and the prose
// escapes. Where the 0.3 compiler is built (targets/rust/target/release/mkp), its output is also
// formatted and checked by it.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { migrate } from '../src/migrate.mjs';
import { inlineProse, tex } from '../src/prose.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const mkp = join(here, '../../../targets/rust/target/release/mkp');
const bundle = (name) => JSON.parse(readFileSync(join(here, 'fixtures', name), 'utf8'));

/** Writes a migration's files, then runs mkp fmt --check and mkp check on them. */
function check03(r) {
  if (!existsSync(mkp)) return null;
  const dir = mkdtempSync(join(tmpdir(), 'migrate-0.2-'));
  writeFileSync(join(dir, 'doc.mkp.md'), r.doc);
  const packs = [];
  for (const [p, text] of r.packs) {
    mkdirSync(join(dir, p));
    writeFileSync(join(dir, p, `${p}.mkp`), text);
    packs.push(join(dir, p));
  }
  const fmt = spawnSync(mkp, ['fmt', '--check', join(dir, 'doc.mkp.md'), ...packs.map((p) => join(p, `${p.split('/').pop()}.mkp`))], { encoding: 'utf8' });
  const check = spawnSync(mkp, ['check', ...(packs.length ? ['--pack', packs.join(',')] : []), join(dir, 'doc.mkp.md')], { encoding: 'utf8' });
  return { fmt: fmt.status, check: check.status, out: check.stdout + check.stderr };
}

test('prose: what 0.3 reads differently is escaped, the rest passes through', () => {
  assert.equal(inlineProse('@ops is on call'), '\\@ops is on call');
  assert.equal(inlineProse('a\n}\nb'), 'a\n\\}\nb');
  assert.equal(inlineProse('CommonMark \\{brace\\}'), 'CommonMark {brace\\}');
  assert.equal(inlineProse('code `\\{x}` stays'), 'code `\\{x}` stays');
  assert.equal(inlineProse('set $\\{ x \\}$ in maths'), 'set $\\\\{ x \\}$ in maths');
  assert.equal(inlineProse('a hard break\\\nnext'), 'a hard break\\\nnext');
  assert.equal(tex('\\{ x \\}'), '\\\\{ x \\}');
});

test('a document using a pack: blocks become calls, YAML becomes record literals, containers take prose', () => {
  const r = migrate(bundle('pack-small.bundle.json'));
  assert.match(r.doc, /^import kit;/);
  assert.match(r.doc, /@callout\(title = "Deploys", tone = color\.WARN\) \{\nWe shipped \*\*42\*\* times\.\n\}/);
  assert.match(r.doc, /stat \{ label = "Rollbacks", value = "1", tone = color\.BAD \}/);
  assert.match(r.doc, /summary = "Two numbers from this week\."/);
  assert.match(r.doc, /@tabs \{\n@tab\(title = "Web"\) \{\nThe web app\.\n\}/);
  assert.match(r.doc, /\\@ops is on call/);
  assert.match(r.packs.get('kit'), /extern widget stats\(items: list<stat>, summary: text = ""\)/);
  assert.equal(r.counts.fallbacks, 0);
  const c = check03(r);
  if (c) assert.deepEqual([c.fmt, c.check], [0, 0], c.out);
});

test("a document's own widget: inputs, a mut, events as fns, project md as a markdown block", () => {
  const r = migrate(bundle('counter.bundle.json'));
  assert.match(r.doc, /widget counter\(start: int = 0\) \{/);
  assert.match(r.doc, /mut n: int = start;/);
  assert.match(r.doc, /@press\(label = "one less", click = fn\(\) \{ n = n - 1; \}\)/);
  assert.match(r.doc, /markdown \{\n\s+Count: \\\{n\.fmt\(0\)\}/);
  assert.match(r.doc, /@counter\(start = 3\);/);
  assert.equal(r.counts.defsMigrated, 1);
  const c = check03(r);
  if (c) assert.deepEqual([c.fmt, c.check], [0, 0], c.out);
});

test('the pack widgets mode writes a view where the definition migrates', () => {
  const r = migrate(bundle('pack-small.bundle.json'), { packWidgets: true });
  assert.match(r.packs.get('kit'), /^widget callout\(/m);
  assert.ok(r.counts.packWidgetsWritten >= 1);
  const c = check03(r);
  if (c) assert.deepEqual([c.fmt, c.check], [0, 0], c.out);
});

test('with the 0.2 source beside the IR, every comment and link definition is kept', async () => {
  const { sourceComments, kept } = await import('../src/source.mjs');
  const source = readFileSync(join(here, 'fixtures', 'comments.mkp.md'), 'utf8');
  const r = migrate(bundle('comments.bundle.json'), { source });
  const cs = sourceComments(source);
  assert.equal(cs.length, 16);
  assert.deepEqual(cs.filter((c) => !kept(c, [r.doc, ...r.packs.values()])), []);
  // YAML comments sit beside what they described, in the author's key order
  assert.match(r.doc, /\/\/ deploys first\n\s+stat \{ label = "Deploys", value = "42", change = "\+12%" \}, \/\/ up from 37/);
  assert.match(r.doc, /summary = "Two numbers from this week\.", \/\/ the alt text/);
  // link definitions stay in the prose; HTML comments stay in place as `@//`, prose's comment
  assert.match(r.doc, /\n\[p\]: https:\/\/example\.com\/plan\n/);
  assert.match(r.doc, /\n *@\/\/ /);
  assert.doesNotMatch(r.doc, /<!--/);
  // or go to the header, with where they stood, when asked
  const header = migrate(bundle('comments.bundle.json'), { source, htmlComments: 'header' });
  assert.match(header.doc, /\/\/ line 54, at the end of the callout block:/);
  // code comments come from the IR itself
  assert.match(r.doc, /\/\/ what the tile is for, above the definition\n\/\/@about One number in a box\./);
  const c = check03(r);
  if (c) assert.deepEqual([c.fmt, c.check], [0, 0], c.out);
});
