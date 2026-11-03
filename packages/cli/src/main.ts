// mkp: the command-line tool (spec 12). One executable built from the TypeScript implementation,
// so hosts in any language call it at write time, in an editor or in CI.
//
//   mkp build <docs or folders…> --pack <folder|file.mkpack> … [--profile name]
//             [--target ir|ir-expanded|md] [--md gfm,math,mermaid,html,images] [--out dir] [--lock mkp.lock]
//   mkp check --pack …            packs, fixtures and the section-18 rules (every definition has a valid case)
//   mkp index --pack …            one line per widget: the catalog an agent keeps in context
//   mkp show <name> --pack …      the full signature and the first valid fixture case
//   mkp schema <name|ir/…|fixture> [--pack …]   JSON Schema of a widget's inputs, or of the IR
//   mkp fmt <file.mkp|file.mkp.md…> --pack … [--write]   canonical form
//   mkp pack <folder> [-o name.mkpack]           a pack folder as a .mkpack zip

import { existsSync, mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { basename, dirname, extname, join, relative, resolve } from 'node:path';
import {
  canonicalJson,
  caseDocument,
  compile,
  compileCase,
  Diagnostics,
  DocPrinter,
  expand,
  fileItems,
  fixtureCases,
  formatDiagnostic,
  IR_SCHEMAS,
  indexLine,
  inputSchema,
  MathsEngine,
  missingFixtures,
  prerender,
  printFile,
  signatureText,
  stripPos,
  writeMarkdown,
  writeZip,
  type Compiled,
  type IRLock,
  type MdToggle,
  type PackSource,
} from '@mkp/core';

export const VERSION = '0.2.0';

interface Args {
  cmd: string;
  pos: string[];
  packs: string[];
  opts: Record<string, string | true>;
}

function parseArgs(argv: string[]): Args {
  const out: Args = { cmd: argv[0] ?? 'help', pos: [], packs: [], opts: {} };
  for (let i = 1; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--pack' || a === '-p') out.packs.push(argv[++i]);
    else if (a.startsWith('--')) {
      const [k, v] = a.slice(2).split('=', 2);
      if (v !== undefined) out.opts[k] = v;
      else if (['target', 'md', 'out', 'lock', 'profile', 'o'].includes(k) && i + 1 < argv.length && !argv[i + 1].startsWith('-')) out.opts[k] = argv[++i];
      else out.opts[k] = true;
    } else if (a === '-o') out.opts.o = argv[++i];
    else out.pos.push(a);
  }
  return out;
}

function readFolder(dir: string): Map<string, Uint8Array> {
  const files = new Map<string, Uint8Array>();
  const walk = (d: string): void => {
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

function packSource(p: string): PackSource {
  const abs = resolve(p);
  if (!existsSync(abs)) throw new Error(`no pack at ${p}`);
  if (statSync(abs).isDirectory()) return { label: relative(process.cwd(), abs) || '.', files: readFolder(abs) };
  return { label: basename(abs), zip: new Uint8Array(readFileSync(abs)) };
}

function report(d: Diagnostics, quiet = false): boolean {
  for (const x of d.items) if (!quiet || x.severity === 'error') process.stderr.write(formatDiagnostic(x) + '\n');
  return d.ok;
}

function compiled(a: Args): Compiled {
  let lock: IRLock | undefined;
  const lockPath = typeof a.opts.lock === 'string' ? a.opts.lock : 'mkp.lock';
  if (existsSync(lockPath)) lock = JSON.parse(readFileSync(lockPath, 'utf8')) as IRLock;
  return compile({ packs: a.packs.map(packSource), lock, profile: typeof a.opts.profile === 'string' ? a.opts.profile : undefined });
}

function docFiles(paths: string[]): string[] {
  const out: string[] = [];
  for (const p of paths) {
    const st = statSync(p, { throwIfNoEntry: false });
    if (!st) throw new Error(`no such file or folder: ${p}`);
    if (st.isDirectory()) {
      for (const n of readdirSync(p)) out.push(...docFiles([join(p, n)]).filter((f) => f.endsWith('.mkp.md')));
    } else out.push(p);
  }
  return out;
}

async function build(a: Args): Promise<number> {
  const c = compiled(a);
  let ok = report(c.diags);
  const target = String(a.opts.target ?? 'ir');
  const toggles = (typeof a.opts.md === 'string' ? a.opts.md.split(',').filter(Boolean) : []) as MdToggle[];
  const outDir = typeof a.opts.out === 'string' ? a.opts.out : null;
  const maths = a.opts['no-maths'] ? null : await MathsEngine.create({ speech: !a.opts['no-speech'] });
  for (const file of docFiles(a.pos)) {
    const d = new Diagnostics();
    const bundle = c.document(readFileSync(file, 'utf8'), relative(process.cwd(), file), d);
    if (bundle && maths) prerender(bundle, maths, d);
    ok = report(d) && ok;
    if (!bundle || !d.ok) continue;
    const stem = basename(file).replace(/\.mkp\.md$/, '');
    let text: string;
    let ext: string;
    const files = new Map<string, string>();
    if (target === 'md') {
      const r = writeMarkdown(bundle, { toggles, maths: maths ?? undefined, imageBase: stem });
      text = r.md;
      ext = '.md';
      for (const [k, v] of r.files) files.set(k, v);
    } else {
      text = JSON.stringify(target === 'ir-expanded' ? expand(bundle) : bundle, null, a.opts.compact ? undefined : 1);
      ext = target === 'ir-expanded' ? '.expanded.json' : '.ir.json';
    }
    if (outDir) {
      mkdirSync(outDir, { recursive: true });
      writeFileSync(join(outDir, stem + ext), text);
      for (const [k, v] of files) writeFileSync(join(outDir, k), v);
      process.stderr.write(`wrote ${join(outDir, stem + ext)}\n`);
    } else process.stdout.write(text + (text.endsWith('\n') ? '' : '\n'));
  }
  // the lock: written on every successful build, pinning versions and digests (6.17)
  if (ok && !a.opts['no-lock']) writeFileSync(typeof a.opts.lock === 'string' ? a.opts.lock : 'mkp.lock', JSON.stringify(c.lock, null, 1) + '\n');
  return ok ? 0 : 1;
}

function check(a: Args): number {
  const c = compiled(a);
  let ok = report(c.diags);
  const cases = fixtureCases(c);
  let n = 0;
  for (const fc of cases) {
    const r = compileCase(c, fc);
    n++;
    if (!r.ok) {
      ok = false;
      process.stderr.write(`fixture ${fc.pack}/${fc.file} case ${fc.name}: ${fc.expect?.errors?.length ? `expected ${fc.expect.errors.join(', ')}` : 'is not valid'}\n`);
      for (const d of r.diags.errors) process.stderr.write('  ' + formatDiagnostic(d) + '\n');
    }
  }
  const missing = missingFixtures(c);
  for (const m of missing) process.stderr.write(`${m} has no valid fixture case; a definition needs one before it can be published\n`);
  ok = ok && !missing.length;
  process.stdout.write(`${c.defs.size} definitions, ${n} fixture cases: ${ok ? 'ok' : 'problems above'}\n`);
  return ok ? 0 : 1;
}

function findDef(c: Compiled, name: string) {
  const [bare, ver] = name.split('@');
  const hits = [...c.defs.values()].filter((d) => (d.name === bare || `${d.pack}:${d.name}` === bare) && (!ver || d.version === Number(ver)) && d.pack !== '$doc');
  if (!hits.length) throw new Error(`no definition named ${name}`);
  return hits.sort((x, y) => y.version - x.version)[0];
}

function index(a: Args): number {
  const c = compiled(a);
  report(c.diags, true);
  const defs = [...c.defs.values()].filter((d) => d.kind !== 'extern' && d.pack !== '$doc').sort((x, y) => (x.pack + x.name < y.pack + y.name ? -1 : 1));
  for (const d of defs) process.stdout.write(indexLine(d, c.prog.typeEnv(d.pack)) + '\n');
  return 0;
}

function show(a: Args): number {
  const c = compiled(a);
  const d = findDef(c, a.pos[0] ?? '');
  process.stdout.write(signatureText(d, c.prog.typeEnv(d.pack)) + '\n');
  const first = fixtureCases(c).find((fc) => fc.pack === d.pack && fc.widget === `${d.name}@${d.version}` && !fc.expect?.errors?.length);
  if (first) process.stdout.write(`\nexample (fixture ${first.name}):\n${caseDocument(first)}`);
  return 0;
}

function schema(a: Args): number {
  const what = a.pos[0] ?? '';
  if (what in IR_SCHEMAS) {
    process.stdout.write(JSON.stringify(IR_SCHEMAS[what as keyof typeof IR_SCHEMAS], null, 2) + '\n');
    return 0;
  }
  const c = compiled(a);
  const d = findDef(c, what);
  process.stdout.write(JSON.stringify(inputSchema(d, c.prog.typeEnv(d.pack)), null, 2) + '\n');
  return 0;
}

function fmt(a: Args): number {
  const c = compiled(a);
  let ok = true;
  for (const file of a.pos) {
    const abs = resolve(file);
    let text: string;
    if (file.endsWith('.mkp.md')) {
      const d = new Diagnostics();
      const b = c.document(readFileSync(abs, 'utf8'), file, d, { allowParts: true });
      if (!b) {
        report(d);
        ok = false;
        continue;
      }
      const docDef = Object.values(b.defs).find((x) => x.pack === '$doc');
      text = new DocPrinter({ defs: b.defs, env: c.prog.typeEnv('$doc') }).doc(b.doc.front, b.doc.body, docDef);
    } else {
      let found: string | null = null;
      for (const p of c.prog.packs.values()) {
        const f = p.files.find((x) => resolve(x.file) === abs || x.file.endsWith('/' + relative(process.cwd(), abs)) || resolve(dirname(abs), basename(x.file)) === abs);
        if (f) {
          found = printFile(fileItems(f, c.defs, p.name, (n) => c.tokens.find((t) => t.name === n && t.pack === p.name)), { defs: Object.fromEntries(c.defs), env: c.prog.typeEnv(p.name) });
          break;
        }
      }
      if (found === null) {
        process.stderr.write(`${file} is not in any pack given with --pack\n`);
        ok = false;
        continue;
      }
      text = found;
    }
    if (a.opts.write) writeFileSync(abs, text);
    else process.stdout.write(text);
  }
  return ok ? 0 : 1;
}

function pack(a: Args): number {
  const dir = a.pos[0];
  if (!dir) throw new Error('mkp pack <folder> [-o name.mkpack]');
  const files = readFolder(resolve(dir));
  const d = new Diagnostics();
  const c = compile({ packs: [{ label: dir, files }] });
  for (const x of c.diags.items) if (x.code.startsWith('mkp.pack')) d.add(x);
  if (!report(d)) return 1;
  const keep = new Map([...files].filter(([p]) => p === 'manifest.mkp' || /\.(mkp|fixture\.json|png|jpe?g|webp|svg|woff2)$/i.test(p)));
  const zip = writeZip(keep);
  const name = typeof a.opts.o === 'string' ? a.opts.o : `${basename(resolve(dir))}.mkpack`;
  writeFileSync(name, zip);
  process.stdout.write(`${name} (${keep.size} files, ${zip.length} bytes)\n`);
  return 0;
}

const HELP = `mkp ${VERSION}: Markdown Markup

  mkp build <docs|folders…> --pack <folder|file.mkpack> … [--profile name]
            [--target ir|ir-expanded|md] [--md gfm,math,mermaid,html,images] [--out dir] [--lock mkp.lock]
  mkp check --pack …
  mkp index --pack …
  mkp show <name> --pack …
  mkp schema <name | ir/bundle | ir/definition | ir/node | ir/expr | ir/tokens | fixture> [--pack …]
  mkp fmt <files…> --pack … [--write]
  mkp pack <folder> [-o name.mkpack]
`;

export async function main(argv: string[]): Promise<number> {
  const a = parseArgs(argv);
  try {
    switch (a.cmd) {
      case 'build':
        return await build(a);
      case 'check':
        return check(a);
      case 'index':
        return index(a);
      case 'show':
        return show(a);
      case 'schema':
        return schema(a);
      case 'fmt':
        return fmt(a);
      case 'pack':
        return pack(a);
      case 'version':
      case '--version':
        process.stdout.write(VERSION + '\n');
        return 0;
      default:
        process.stdout.write(HELP);
        return a.cmd === 'help' || a.cmd === '--help' ? 0 : 2;
    }
  } catch (e) {
    process.stderr.write(`mkp: ${(e as Error).message}\n`);
    return 2;
  }
}

void canonicalJson;
void stripPos;
void extname;
