#!/usr/bin/env node
// migrate-0.2: an MKP 0.2 bundle (IR shape 1) to an MKP 0.3 document and the pack shims it imports.
//
//   node bin/migrate.mjs doc.ir.json [--source doc.mkp.md] [--out dir] [--name doc] [--pack-widgets]
//                        [--html-comments prose|header|inline]
//
// --source reads the 0.2 document beside its IR for what the IR drops: HTML comments (to the header,
// or with --html-comments inline in place, where 0.3 shows them as text), link reference definitions,
// YAML comments, the YAML's key order and the front matter as written.
// --pack-widgets writes each widget of a pack the document uses with a 0.3 view where its 0.2
// definition migrates, instead of as an extern widget with a markdown block (the default).
// Writes <out>/<name>.mkp.md, <out>/packs/<pack>/<pack>.mkp for each pack it uses, and
// <out>/<name>.notes.json (every TODO, change and fallback, by 0.2 line). Formatting and checking are
// separate steps: `mkp fmt` and `mkp check --pack <out>/packs/<pack>` (corpus/run.mjs does all three).

import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { basename, join } from 'node:path';
import { migrate } from '../src/migrate.mjs';

const args = process.argv.slice(2);
const opt = (name) => {
  const i = args.indexOf(name);
  return i === -1 ? undefined : args.splice(i, 2)[1];
};
const source = opt('--source');
const out = opt('--out') ?? '.';
const name = opt('--name');
const htmlComments = opt('--html-comments') ?? 'prose';
const packWidgets = args.includes('--pack-widgets');
if (packWidgets) args.splice(args.indexOf('--pack-widgets'), 1);
const [input] = args;
if (!input) {
  console.error('usage: node bin/migrate.mjs doc.ir.json [--source doc.mkp.md] [--out dir] [--name doc] [--pack-widgets] [--html-comments prose|header|inline]');
  process.exit(2);
}
const raw = JSON.parse(readFileSync(input, 'utf8'));
// a conformance case carries its bundle inside it
const bundle = raw.bundle && raw.id ? raw.bundle : raw;
const r = migrate(bundle, { source: source ? readFileSync(source, 'utf8') : undefined, packWidgets, htmlComments });
const stem = name ?? basename(input).replace(/\.ir\.json$|\.json$/, '');
mkdirSync(out, { recursive: true });
writeFileSync(join(out, `${stem}.mkp.md`), r.doc);
for (const [pack, text] of r.packs) {
  mkdirSync(join(out, 'packs', pack), { recursive: true });
  writeFileSync(join(out, 'packs', pack, `${pack}.mkp`), text);
}
writeFileSync(join(out, `${stem}.notes.json`), JSON.stringify({ counts: r.counts, notes: r.notes }, null, 1) + '\n');
console.log(`wrote ${join(out, stem + '.mkp.md')}: ${r.counts.widgets}/${r.counts.blocks} blocks, ${r.counts.defsMigrated}/${r.counts.defs} definitions, ${r.notes.length} notes`);
