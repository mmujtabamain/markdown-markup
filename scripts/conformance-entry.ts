// Generates (--generate [filter]) or checks the conformance suite in conformance/. The cases come
// from the test-only packs under conformance/packs (every extern, every prop, with play steps) and
// from every example. Checking compiles them again and compares the bundle with the one stored,
// so a compiler change shows (GAPS 48); then it replays each case. --generate with a filter (a
// regular expression on case ids) rewrites only those (GAPS 49).
import { existsSync, readdirSync, readFileSync, writeFileSync, mkdirSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { compile, compileCase, fixtureCases, omitPos, stripPos, type IRBundle, type PackSource } from '../packages/core/src/index';
import { checkCase, makeCase, type ConfCase } from '../packages/core/src/conformance';
import { diffValues } from '../packages/core/src/conformance';

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

export function testPacks(): PackSource[] {
  const d = join(root, 'conformance', 'packs');
  return readdirSync(d).filter((n) => statSync(join(d, n)).isDirectory()).map((n) => folder(join(d, n)));
}

interface Source {
  id: string;
  build: () => { bundle: IRBundle | null; steps: ConfCase['steps']; hosts?: ConfCase['hosts']; tolerance?: number };
}

/** Every case's id and how to build it from source. */
function sources(): Source[] {
  const out: Source[] = [];
  const c = compile({ packs: testPacks() });
  if (!c.diags.ok) {
    console.error(c.diags.errors.map((d) => `${d.pos?.file}:${d.pos?.line} ${d.message}`).join('\n'));
    process.exit(1);
  }
  for (const fc of fixtureCases(c)) {
    if (fc.expect?.errors?.length) continue;
    out.push({ id: `${fc.pack}.${fc.widget.replace('@', '.')}.${fc.name}`, build: () => ({ bundle: compileCase(c, fc).bundle, steps: fc.play ?? [], hosts: fc.hosts, tolerance: fc.expect?.tolerance }) });
  }
  const exDir = join(root, 'examples');
  for (const name of readdirSync(exDir).filter((n) => /^\d\d-/.test(n) && existsSync(join(exDir, n, 'doc.mkp.md'))).sort()) {
    const d = join(exDir, name);
    const packs = ['pack', 'host'].filter((p) => existsSync(join(d, p))).map((p) => folder(join(d, p)));
    const own = join(d, 'doc.mkp');
    out.push({
      id: `examples.${name}`,
      build: () => {
        const ce = compile({ packs });
        const docFile = existsSync(own) ? { text: readFileSync(own, 'utf8'), file: `examples/${name}/doc.mkp` } : undefined;
        return { bundle: ce.document(readFileSync(join(d, 'doc.mkp.md'), 'utf8'), `examples/${name}/doc.mkp.md`, undefined, { docFile }), steps: [] };
      },
    });
  }
  return out;
}

const gi = process.argv.indexOf('--generate');
if (gi >= 0) {
  const filter = process.argv[gi + 1] && !process.argv[gi + 1].startsWith('-') ? new RegExp(process.argv[gi + 1]) : null;
  mkdirSync(dir, { recursive: true });
  const all = sources();
  let n = 0;
  for (const s of all) {
    if (filter && !filter.test(s.id)) continue;
    const r = s.build();
    if (!r.bundle) throw new Error(`${s.id} does not compile`);
    writeFileSync(join(dir, `${s.id}.json`), JSON.stringify(makeCase(s.id, omitPos(r.bundle), r.steps, r.hosts, r.tolerance)));
    n++;
  }
  // the index lists every case there is a source for
  writeFileSync(join(root, 'conformance', 'index.json'), JSON.stringify({ ir: 1, cases: all.map((s) => s.id).sort() }, null, 1) + '\n');
  console.log(`conformance: generated ${n} of ${all.length} cases`);
} else {
  const index = JSON.parse(readFileSync(join(root, 'conformance', 'index.json'), 'utf8')) as { cases: string[] };
  const all = new Map(sources().map((s) => [s.id, s]));
  let bad = 0;
  const report = (id: string, lines: string[]): void => {
    bad++;
    console.error(`✗ ${id}\n  ${lines.slice(0, 5).join('\n  ')}`);
  };
  for (const id of all.keys()) if (!index.cases.includes(id)) report(id, ['has a source but no case: pnpm conformance --generate']);
  for (const id of index.cases) {
    const file = join(dir, `${id}.json`);
    if (!existsSync(file)) {
      report(id, ['is in the index but has no case file']);
      continue;
    }
    const c = JSON.parse(readFileSync(file, 'utf8')) as ConfCase;
    const src = all.get(id);
    if (!src) {
      report(id, ['has no source any more: pnpm conformance --generate']);
      continue;
    }
    // compiled again from source, the bundle is the one stored
    const now = src.build().bundle;
    const diffs = now ? diffValues(stripPos(c.bundle), stripPos(omitPos(now)), 'bundle').slice(0, 3) : ['no longer compiles'];
    diffs.push(...checkCase(c));
    if (diffs.length) report(id, diffs);
  }
  console.log(`conformance (node ${process.version}): ${index.cases.length - bad}/${index.cases.length} cases agree, compiled from source and replayed`);
  if (bad) process.exit(1);
}
