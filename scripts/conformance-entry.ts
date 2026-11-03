// Generates (--generate) or checks the conformance suite in conformance/.
import { readdirSync, readFileSync, writeFileSync, mkdirSync, rmSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { compile, compileCase, fixtureCases, omitPos, type PackSource } from '../packages/core/src/index';
import { checkCase, makeCase, type ConfCase } from '../packages/core/src/conformance';

const root = process.cwd();
const dir = join(root, 'conformance', 'cases');

function folder(d: string): PackSource {
  const files = new Map<string, Uint8Array>();
  const walk = (x: string): void => {
    for (const n of readdirSync(x)) {
      const p = join(x, n);
      if (statSync(p).isDirectory()) walk(p);
      else files.set(relative(d, p).split('\\').join('/'), new Uint8Array(readFileSync(p)));
    }
  };
  walk(d);
  return { files, label: relative(root, d) };
}

export function packsOf(): PackSource[] {
  return [...readdirSync(join(root, 'packs')).map((n) => folder(join(root, 'packs', n))), ...readdirSync(join(root, 'examples')).map((n) => folder(join(root, 'examples', n)))];
}

const generate = process.argv.includes('--generate');
if (generate) {
  const c = compile({ packs: packsOf() });
  if (!c.diags.ok) {
    console.error(c.diags.errors.map((d) => `${d.pos?.file}:${d.pos?.line} ${d.message}`).join('\n'));
    process.exit(1);
  }
  rmSync(dir, { recursive: true, force: true });
  mkdirSync(dir, { recursive: true });
  const ids: string[] = [];
  for (const fc of fixtureCases(c)) {
    if (fc.expect?.errors?.length) continue;
    const r = compileCase(c, fc);
    if (!r.bundle) throw new Error(`${fc.pack}/${fc.widget}/${fc.name} does not compile`);
    const id = `${fc.pack}.${fc.widget.replace('@', '.')}.${fc.name}`;
    const cc = makeCase(id, omitPos(r.bundle), fc.play ?? [], fc.hosts);
    writeFileSync(join(dir, `${id}.json`), JSON.stringify(cc));
    ids.push(id);
  }
  for (const p of c.prog.packs.values()) {
    for (const d of p.documents) {
      const b = c.document(d.text, `${p.name}/${d.path}`);
      if (!b) throw new Error(`${p.name}/${d.path} does not compile`);
      const id = `${p.name}.${d.path.replace(/\.mkp\.md$/, '').replace(/[/]/g, '.')}.doc`;
      writeFileSync(join(dir, `${id}.json`), JSON.stringify(makeCase(id, omitPos(b), [])));
      ids.push(id);
    }
  }
  writeFileSync(join(root, 'conformance', 'index.json'), JSON.stringify({ ir: 1, cases: ids.sort() }, null, 1) + '\n');
  console.log(`conformance: generated ${ids.length} cases`);
} else {
  const index = JSON.parse(readFileSync(join(root, 'conformance', 'index.json'), 'utf8')) as { cases: string[] };
  let bad = 0;
  for (const id of index.cases) {
    const c = JSON.parse(readFileSync(join(dir, `${id}.json`), 'utf8')) as ConfCase;
    const diffs = checkCase(c);
    if (diffs.length) {
      bad++;
      console.error(`✗ ${id}\n  ${diffs.slice(0, 5).join('\n  ')}`);
    }
  }
  console.log(`conformance (node ${process.version}): ${index.cases.length - bad}/${index.cases.length} cases agree`);
  if (bad) process.exit(1);
}
