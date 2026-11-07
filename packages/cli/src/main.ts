// mkp: the command-line tool (spec 12). One executable built from the TypeScript implementation,
// so hosts in any language call it at write time, in an editor or in CI.
//
//   mkp build <docs or folders… | -> --pack <folder|file.mkpack> … [--profile name] [--name file.mkp.md]
//             [--target ir|ir-expanded|md|html|html-md|fragment[,…]] [--md gfm,math,mermaid,html,images] [--out dir]
//             [--lock mkp.lock] [--diagnostics json]
//             html: a standalone page that draws the document (name.html: one file, offline, the
//             renderer inlined, the Markdown inside it for readers with scripts off); html-md: the
//             document's Markdown drawn as HTML, with no script (name.md.html); fragment: the
//             document's first paint (name.fragment.html), for the element that mount(el, bundle,
//             { hydrate: true }) takes over in place, with the bundle from the same build's ir
//             `-` reads one document from stdin (named by --name); several targets need --out;
//             --diagnostics json writes each diagnostic to stderr as a line of JSON, for a host to read
//   mkp check [docs…] --pack … [--format json]   packs and their fixtures (every definition has a
//             valid case), or documents with their own definitions; json: one diagnostic a line
//   mkp index --pack …            one line per widget: the catalog an agent keeps in context
//   mkp show <name> --pack … [--source [--as new-name]]   the full signature and the first valid
//             fixture case; --source prints its source with the private parts and fns it uses,
//             ready to paste into a document and edit
//   mkp schema <name|ir/…|fixture> [--pack …]   JSON Schema of a widget's inputs, or of the IR
//   mkp fmt <file.mkp|file.mkp.md…> --pack … [--write]   canonical form
//   mkp pack <folder> [-o name.mkpack]           a pack folder as a .mkpack zip
//   mkp cases --pack … --out dir [--only pack]  every valid fixture case's bundle, one file per
//             definition (<pack>.<name>.cases.json: [{case, summary, bundle}]), for a host's gallery

import { existsSync, mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { basename, dirname, extname, join, relative, resolve } from 'node:path';
import { createInterface } from 'node:readline/promises';
import {
  canonicalJson,
  caseDocument,
  copySource,
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
  VERSION,
  writeMarkdown,
  writeStamp,
  writeZip,
  checkMoves,
  readZip,
  type Choice,
  type Compiled,
  type IRLock,
  type IRBundle,
  type MdToggle,
  type PackSource,
} from '@mkp/core';
import { migrateBundleFile, migrateDocument, migratePack, packAfter, zipped, type Migrated } from './migrate';
import { firstPaint, htmlPage, markdownPage, markdownToHtml, pageTitle, pictureNames, withAssets } from '@mkp/page';
// the page script of --target html (packages/page/dist/page.js), built in by scripts/build.mjs
import PAGE_SCRIPT from 'mkp:page-script';

// VERSION: the repository's VERSION file, put in by the build (scripts/build.mjs)
export { VERSION };

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
      else if (['target', 'md', 'out', 'lock', 'profile', 'o', 'name', 'diagnostics', 'format', 'as', 'only', 'keep', 'take', 'from', 'core'].includes(k) && i + 1 < argv.length && !argv[i + 1].startsWith('-')) out.opts[k] = argv[++i];
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

let jsonDiagnostics = false;

function report(d: Diagnostics, quiet = false): boolean {
  for (const x of d.items) {
    if (quiet && x.severity !== 'error') continue;
    if (jsonDiagnostics) {
      const { severity, code, message, pos, path } = x;
      process.stderr.write(JSON.stringify({ severity, code, message, file: pos?.file, line: pos?.line, col: pos?.col, ...(path ? { path } : {}) }) + '\n');
    } else process.stderr.write(formatDiagnostic(x) + '\n');
  }
  return d.ok;
}

/**
 * The lock a build reads and writes (GAPS 14): --lock, or the nearest mkp.lock at or above the
 * first document's folder, or a new one beside it.
 */
function lockPath(a: Args): string {
  if (typeof a.opts.lock === 'string') return a.opts.lock;
  const first = a.pos.find((p) => p !== '-');
  let dir = first ? resolve(statSync(first, { throwIfNoEntry: false })?.isDirectory() ? first : dirname(first)) : process.cwd();
  const start = dir;
  for (;;) {
    if (existsSync(join(dir, 'mkp.lock'))) return relative(process.cwd(), join(dir, 'mkp.lock')) || 'mkp.lock';
    // never past the project the document is in
    const up = dirname(dir);
    if (up === dir || existsSync(join(dir, '.git'))) break;
    dir = up;
  }
  return relative(process.cwd(), join(start, 'mkp.lock')) || 'mkp.lock';
}

function compiled(a: Args): Compiled {
  let lock: IRLock | undefined;
  const lp = lockPath(a);
  // --relock: record what the packs are now, refusing nothing the old lock pinned; a build
  // with no pack has nothing to lock
  if (a.packs.length && existsSync(lp) && !a.opts.relock) lock = JSON.parse(readFileSync(lp, 'utf8')) as IRLock;
  return compile({ packs: a.packs.map(packSource), lock, profile: typeof a.opts.profile === 'string' ? a.opts.profile : undefined });
}

/** The document's own file, name.mkp beside name.mkp.md (6.25), when there is one. */
function docFileOf(file: string): { text: string; file: string } | undefined {
  const p = file.replace(/\.mkp\.md$/, '.mkp');
  return p !== file && existsSync(p) ? { text: readFileSync(p, 'utf8'), file: relative(process.cwd(), p) || p } : undefined;
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

const PICTURE_TYPES: Record<string, string> = { '.svg': 'image/svg+xml', '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.gif': 'image/gif', '.webp': 'image/webp', '.avif': 'image/avif' };

function dataUrl(name: string, bytes: Buffer): string {
  return `data:${PICTURE_TYPES[extname(name).toLowerCase()] ?? 'application/octet-stream'};base64,${bytes.toString('base64')}`;
}

/** The pictures a bundle names that are files beside its document, as data: URLs, by name. */
function docPictures(bundle: IRBundle, dir: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const name of pictureNames(bundle)) {
    const f = resolve(dir, name);
    if (existsSync(f) && statSync(f).isFile()) out[name] = dataUrl(name, readFileSync(f));
  }
  return out;
}

async function build(a: Args): Promise<number> {
  const c = compiled(a);
  let ok = report(c.diags);
  const targets = String(a.opts.target ?? 'ir').split(',').filter(Boolean);
  const toggles = (typeof a.opts.md === 'string' ? a.opts.md.split(',').filter(Boolean) : []) as MdToggle[];
  const outDir = typeof a.opts.out === 'string' ? a.opts.out : null;
  if (targets.length > 1 && !outDir) throw new Error('several targets need --out');
  const known = ['ir', 'ir-expanded', 'md', 'html', 'html-md', 'fragment'];
  for (const t of targets) if (!known.includes(t)) throw new Error(`--target takes ${known.join(', ')}; found ${t}`);
  const maths = a.opts['no-maths'] ? null : await MathsEngine.create({ speech: !a.opts['no-speech'] });
  // a document from stdin (-), named by --name
  const docs = a.pos.includes('-')
    ? [{ file: typeof a.opts.name === 'string' ? a.opts.name : 'stdin.mkp.md', text: readFileSync(0, 'utf8') }]
    : docFiles(a.pos).map((file) => ({ file: relative(process.cwd(), file), text: readFileSync(file, 'utf8') }));
  for (const { file, text: src } of docs) {
    const d = new Diagnostics();
    const bundle = c.document(src, file, d, { docFile: a.pos.includes('-') ? undefined : docFileOf(file) });
    if (bundle && maths) prerender(bundle, maths, d);
    ok = report(d) && ok;
    if (!bundle || !d.ok) continue;
    const stem = basename(file).replace(/\.mkp\.md$/, '');
    for (const target of targets) {
      let text: string;
      let ext: string;
      const files = new Map<string, string>();
      if (target === 'md') {
        // --no-answers: what a reader sees before answering, for search and previews (GAPS 166)
        const r = writeMarkdown(bundle, { toggles, maths: maths ?? undefined, imageBase: stem, answers: !a.opts['no-answers'] });
        text = r.md;
        ext = '.md';
        for (const [k, v] of r.files) files.set(k, v);
      } else if (target === 'html' || target === 'html-md') {
        // the Markdown drawn as HTML: the whole of html-md, and html's fallback for readers with
        // scripts off; GitHub's flavour and maths unless --md says otherwise
        const r = writeMarkdown(bundle, { toggles: toggles.length ? toggles : ['gfm', 'math'], maths: maths ?? undefined, imageBase: stem, answers: !a.opts['no-answers'] });
        // one file: the pictures beside the document, and those the Markdown writer drew, go inside
        // the page as data: URLs
        const pictures = docPictures(bundle, a.pos.includes('-') ? process.cwd() : dirname(file));
        for (const [k, v] of r.files) pictures[k] = dataUrl(k, Buffer.from(v));
        const drawn = markdownToHtml(r.md, { maths, image: (href) => pictures[href.replace(/^\.\//, '')] });
        const title = pageTitle(r.md, stem);
        if (target === 'html') {
          text = htmlPage({ title, bundleJson: JSON.stringify(withAssets(bundle, pictures)), script: PAGE_SCRIPT, fallbackHtml: drawn });
          ext = '.html';
        } else {
          text = markdownPage({ title, html: drawn });
          ext = '.md.html';
        }
      } else if (target === 'fragment') {
        // the document's first paint, for the element mount(el, bundle, { hydrate: true }) takes over;
        // the bundle to mount is this build's (--target ir,fragment)
        text = firstPaint(bundle, { maths: maths ?? undefined });
        ext = '.fragment.html';
      } else {
        text = JSON.stringify(target === 'ir-expanded' ? expand(bundle) : bundle, null, a.opts.compact ? undefined : 1);
        ext = target === 'ir-expanded' ? '.expanded.json' : '.ir.json';
      }
      if (outDir) {
        mkdirSync(outDir, { recursive: true });
        writeFileSync(join(outDir, stem + ext), text);
        for (const [k, v] of files) writeFileSync(join(outDir, k), v);
        if (!jsonDiagnostics) process.stderr.write(`wrote ${join(outDir, stem + ext)}\n`);
      } else process.stdout.write(text + (text.endsWith('\n') ? '' : '\n'));
    }
  }
  // the lock: written on every successful build that used packs, pinning versions and digests (6.17)
  if (ok && !a.opts['no-lock'] && a.packs.length) writeFileSync(lockPath(a), JSON.stringify(c.lock, null, 1) + '\n');
  return ok ? 0 : 1;
}

async function check(a: Args): Promise<number> {
  const c = compiled(a);
  if (a.pos.length) return checkDocs(a, c);
  // read the fixture files first, so a malformed one (mkp.fixture-shape) is reported with the rest
  const cases = fixtureCases(c);
  let ok = report(c.diags);
  // maths is checked with the same engine that renders it (6.15)
  const maths = a.opts['no-maths'] ? null : await MathsEngine.create({ speech: false });
  let n = 0;
  for (const fc of cases) {
    const r = compileCase(c, fc);
    if (r.bundle && maths && !fc.expect?.errors?.length) {
      prerender(r.bundle, maths, r.diags);
      if (!r.diags.ok) r.ok = false;
    }
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
  // a pack's migrate blocks, proven: every case of the old version, moved, compiles against the new
  const moved = new Diagnostics();
  for (const d of checkMoves(c, c.moves)) moved.add(d);
  ok = report(moved) && ok;
  process.stdout.write(`${c.defs.size} definitions, ${n} fixture cases: ${ok ? 'ok' : 'problems above'}\n`);
  return ok ? 0 : 1;
}

/**
 * Documents, checked with their own definitions and maths: the loop an agent runs until it is
 * clean (--format json gives one diagnostic a line, with file, line, column and a fix).
 */
async function checkDocs(a: Args, c: Compiled): Promise<number> {
  let ok = report(c.diags, true);
  const maths = a.opts['no-maths'] ? null : await MathsEngine.create({ speech: false });
  for (const file of docFiles(a.pos)) {
    const d = new Diagnostics();
    const b = c.document(readFileSync(file, 'utf8'), relative(process.cwd(), file), d, { docFile: docFileOf(file) });
    if (b && maths) prerender(b, maths, d);
    ok = report(d) && ok;
  }
  if (!jsonDiagnostics) process.stderr.write(ok ? 'ok\n' : '');
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
  if (a.opts.source) {
    // a copy to edit, never a link: the agent changes a widget by copying it (doc #1129 §3.3)
    process.stdout.write(copySource(c, d, typeof a.opts.as === 'string' ? a.opts.as : d.name));
    return 0;
  }
  process.stdout.write(signatureText(d, c.prog.typeEnv(d.pack)) + '\n');
  const first = fixtureCases(c).find((fc) => fc.pack === d.pack && fc.widget === `${d.name}@${d.version}` && !fc.expect?.errors?.length);
  if (first) process.stdout.write(`\nexample (fixture ${first.name}):\n${caseDocument(first, c)}`);
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

/** Asks, one change at a time, whether to keep its old look: on a terminal, when --keep and --take aren't given. */
async function ask(choices: Choice[]): Promise<string[]> {
  const rl = createInterface({ input: process.stdin, output: process.stderr });
  const keep: string[] = [];
  try {
    for (const c of choices) {
      const said = await rl.question(`\n${c.step}: ${c.what} (${c.places} place${c.places === 1 ? '' : 's'}).\n  Keep the old look (${c.how})? [y/N] `);
      if (/^y(es)?$/i.test(said.trim())) keep.push(c.id);
    }
  } finally {
    rl.close();
  }
  return keep;
}

async function migrate(a: Args): Promise<number> {
  if (!a.pos.length) throw new Error('migrate takes the documents, pack folders or bundles (name.ir.json) to migrate');
  const keep = a.opts.take === 'all' || a.opts.take === true ? [] : typeof a.opts.keep === 'string' ? (a.opts.keep === 'all' ? ('all' as const) : a.opts.keep.split(',').filter(Boolean)) : undefined;
  const opts = {
    keep,
    choose: keep === undefined && process.stdin.isTTY && !jsonDiagnostics ? ask : undefined,
    core: typeof a.opts.core === 'string' ? a.opts.core : undefined,
    from: typeof a.opts.from === 'string' ? a.opts.from : undefined,
    packs: a.packs.map(packSource),
  };
  const targets: string[] = [];
  const packTargets: string[] = [];
  for (const p of a.pos) {
    const st = statSync(p, { throwIfNoEntry: false });
    if (!st) throw new Error(`no such file or folder: ${p}`);
    if ((st.isDirectory() && existsSync(join(p, 'manifest.mkp'))) || p.endsWith('.mkpack')) packTargets.push(p);
    else if (st.isDirectory()) targets.push(...docFiles([p]));
    else targets.push(p);
  }
  // packs first: the documents that use them compile against them as they were, and are checked
  // against them as they will be
  const migratedPacks = new Map<string, Migrated>();
  for (const p of packTargets) migratedPacks.set(resolve(p), await migratePack(p, opts));
  const sources = [...packTargets.map(packSource), ...opts.packs.filter((x) => !packTargets.some((p) => resolve(p) === resolve(x.label)))];
  Object.assign(opts, { packs: sources, packsAfter: sources.map((s) => (migratedPacks.has(resolve(s.label)) ? packAfter(s, migratedPacks.get(resolve(s.label))!) : s)) });
  targets.unshift(...packTargets);
  if (targets.length > 1 && !a.opts.write && !a.opts.check) throw new Error('several files need --write (or --check)');
  let ok = true;
  let pending = false;
  for (const t of targets) {
    const m = t.endsWith('.json') ? migrateBundleFile(t, { keep: keep ?? [] }) : migratedPacks.get(resolve(t)) ?? (await migrateDocument(t, opts));
    const d = new Diagnostics();
    for (const w of m.result?.warnings ?? []) d.add(w);
    if (m.errors.length) {
      for (const e of m.errors) d.error('mkp.migrate-failed', e);
      ok = false;
    }
    if (!m.errors.length && m.result && m.result.steps.length && !jsonDiagnostics) process.stderr.write(`${t}: ${m.result.steps.join(', ')}${m.result.kept.length ? ` (kept: ${m.result.kept.join(', ')})` : ''}; rewritten in canonical form\n`);
    report(d);
    if (m.errors.length) continue;
    if (m.changed.length) pending = true;
    if (a.opts.check) continue;
    if (a.opts.write && t.endsWith('.mkpack')) {
      // a .mkpack is written back as a zip of the migrated pack
      const label = relative(process.cwd(), resolve(t)) || t;
      const before = readZip(new Uint8Array(readFileSync(t)), label, new Diagnostics())?.files ?? new Map<string, Uint8Array>();
      writeFileSync(t, zipped(label, m, before)!);
    } else if (a.opts.write) for (const p of m.changed) writeFileSync(p, m.files.get(p)!);
    else for (const text of m.files.values()) process.stdout.write(text.endsWith('\n') ? text : text + '\n');
  }
  // --check: 1 when anything would change, as a CI gate
  return !ok ? 1 : a.opts.check && pending ? 1 : 0;
}

function fmt(a: Args): number {
  const c = compiled(a);
  let ok = true;
  for (const file of a.pos) {
    const abs = resolve(file);
    let text: string;
    if (file.endsWith('.mkp.md')) {
      const d = new Diagnostics();
      const src = readFileSync(abs, 'utf8');
      const docFile = docFileOf(file);
      const b = c.document(src, file, d, { allowParts: true, docFile });
      if (!b) {
        report(d);
        ok = false;
        continue;
      }
      const docDef = Object.values(b.defs).find((x) => x.pack === '$doc' && x.name === 'document');
      // its own definitions stay in their fence; with a file beside it, they stay in the file
      const defs = docFile ? undefined : c.documentDefs(src, file) ?? undefined;
      text = new DocPrinter({ defs: b.defs, env: c.prog.typeEnv('$doc') }).doc(b.doc.front, b.doc.body, docDef, defs);
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
    // fmt writes the release it formats for at the file's head (stamp.ts)
    text = writeStamp(text, file);
    if (a.opts.write) writeFileSync(abs, text);
    else process.stdout.write(text);
  }
  return ok ? 0 : 1;
}

/** Every valid fixture case compiled to its bundle, a file per definition, for a host to draw. */
async function cases(a: Args): Promise<number> {
  const c = compiled(a);
  // maths drawn at build, as mkp build draws it, so a host needs no maths engine to show a case
  const maths = a.opts['no-maths'] ? null : await MathsEngine.create({ speech: !a.opts['no-speech'] });
  // read the fixture files first, so a malformed one (mkp.fixture-shape) is reported with the rest
  const all = fixtureCases(c);
  if (!report(c.diags, true)) return 1;
  const outDir = typeof a.opts.out === 'string' ? a.opts.out : null;
  if (!outDir) throw new Error('mkp cases needs --out <dir>');
  const only = typeof a.opts.only === 'string' ? a.opts.only : null;
  const byDef = new Map<string, { case: string; summary: string; bundle: unknown }[]>();
  let ok = true;
  for (const fc of all) {
    if (fc.expect?.errors?.length || (only && fc.pack !== only)) continue;
    const r = compileCase(c, fc);
    if (!r.bundle) {
      ok = false;
      for (const d of r.diags.errors) process.stderr.write(formatDiagnostic(d) + '\n');
      continue;
    }
    if (maths) prerender(r.bundle, maths, r.diags);
    const key = `${fc.pack}.${fc.widget.replace(/@\d+$/, '')}`;
    const list = byDef.get(key) ?? [];
    list.push({ case: fc.name, summary: fc.summary ?? '', bundle: stripPos(r.bundle) });
    byDef.set(key, list);
  }
  mkdirSync(outDir, { recursive: true });
  for (const [key, list] of byDef) writeFileSync(join(outDir, `${key}.cases.json`), JSON.stringify(list) + '\n');
  process.stdout.write(`${[...byDef.values()].reduce((n, l) => n + l.length, 0)} cases of ${byDef.size} definitions in ${outDir}\n`);
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

  mkp build <docs|folders…|-> --pack <folder|file.mkpack> … [--profile name] [--name file.mkp.md]
            [--target ir|ir-expanded|md|html|html-md|fragment[,…]] [--md gfm,math,mermaid,html,images] [--out dir]
            [--lock mkp.lock] [--diagnostics json]
  mkp check [docs…] --pack … [--format json]
  mkp index --pack …
  mkp show <name> --pack … [--source [--as new-name]]
  mkp schema <name | ir/bundle | ir/definition | ir/node | ir/expr | ir/tokens | fixture> [--pack …]
  mkp fmt <files…> --pack … [--write]
  mkp pack <folder> [-o name.mkpack]
  mkp cases --pack … --out dir [--only pack]
  mkp migrate <docs|pack folders|bundle.ir.json…> [--pack …] [--keep id,…|all | --take all] [--write | --check]
            [--from 0.2.1] [--core mkp-web-0.2.1.zip] [--format json]
`;

export async function main(argv: string[]): Promise<number> {
  const a = parseArgs(argv);
  jsonDiagnostics = a.opts.diagnostics === 'json' || a.opts.format === 'json';
  try {
    switch (a.cmd) {
      case 'build':
        return await build(a);
      case 'check':
        return await check(a);
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
      case 'cases':
        return await cases(a);
      case 'migrate':
        return await migrate(a);
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
void extname;
