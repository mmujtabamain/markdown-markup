// The 0.2 → 0.3 step, frozen into one file: MKP 0.2.10's own compiler reads a 0.2 document, and the
// migrator writes it as 0.3. `mkp migrate` runs it with Node, once for each 0.2 document; it ships in
// MKP 0.3.0 only. build.mjs makes it, and migrate-0.2.lock holds its SHA-256.
//
//   node migrate-0.2.cjs <doc.mkp.md> [--pack <0.2 pack folder or .zip>]…
//
// Prints one JSON object: {release, doc, packs: {name: text}, notes, counts} for the migrated
// document and the stand-ins of the packs it uses, or {release, error, diagnostics} when 0.2.10
// doesn't build it.

import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { basename, join, relative, resolve } from 'node:path';
import { compile, Diagnostics, formatDiagnostic, RELEASE } from '@mkp/core';
import { migrate } from '../src/migrate.mjs';

/** A 0.2 pack's folder as 0.2's CLI reads it: every file but links, dot files and node_modules. */
function readFolder(dir) {
  const files = new Map();
  const walk = (d) => {
    for (const n of readdirSync(d)) {
      if (n === 'node_modules' || n.startsWith('.')) continue;
      const p = join(d, n);
      const st = statSync(p, { throwIfNoEntry: false });
      if (!st) continue;
      if (st.isSymbolicLink()) throw new Error(`${p} is a symlink; packs may not hold links`);
      if (st.isDirectory()) walk(p);
      else files.set(relative(dir, p).split('\\').join('/'), new Uint8Array(readFileSync(p)));
    }
  };
  walk(dir);
  return files;
}

function packSource(p) {
  const abs = resolve(p);
  if (!existsSync(abs)) throw new Error(`no pack at ${p}`);
  if (statSync(abs).isDirectory()) return { label: relative(process.cwd(), abs) || '.', files: readFolder(abs) };
  return { label: basename(abs), zip: new Uint8Array(readFileSync(abs)) };
}

function main(args) {
  const packs = [];
  let file;
  for (let k = 0; k < args.length; k++) {
    if (args[k] === '--pack') packs.push(args[++k]);
    else file = args[k];
  }
  if (!file) return { release: RELEASE, error: 'usage: node migrate-0.2.cjs <doc.mkp.md> [--pack <0.2 pack>]…' };
  const text = readFileSync(file, 'utf8');
  const c = compile({ packs: packs.map(packSource) });
  const d = new Diagnostics();
  for (const x of c.diags.items) d.items.push(x);
  // the document's own file, name.mkp beside name.mkp.md, as 0.2 reads it
  const own = file.replace(/\.mkp\.md$/, '.mkp');
  const docFile = own !== file && existsSync(own) ? { text: readFileSync(own, 'utf8'), file: own } : undefined;
  const bundle = c.document(text, file, d, { docFile });
  const diagnostics = d.items.map((x) => formatDiagnostic(x));
  if (!bundle || !d.ok) return { release: RELEASE, error: `${RELEASE} doesn't build it`, diagnostics };
  const r = migrate(bundle, { source: text });
  return { release: RELEASE, doc: r.doc, packs: Object.fromEntries(r.packs), notes: r.notes, counts: r.counts, diagnostics };
}

let out;
try {
  out = main(process.argv.slice(2));
} catch (e) {
  out = { release: RELEASE, error: e?.message ?? String(e) };
}
process.stdout.write(JSON.stringify(out) + '\n');
process.exitCode = out.error ? 1 : 0;
