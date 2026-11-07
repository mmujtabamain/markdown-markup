// mkp migrate: a source written for an older release, or a bundle an older release built, brought up
// to this one. A source goes through the IR: compiled by the core of the release it was written for
// (release-core.ts), the steps run on that IR, then printed back by this release's printer in
// canonical form and stamped. The result is compiled again by this release before it is written: a
// migration that doesn't compile is never written. Nothing is changed silently: each change is a
// warning at its line.

import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { basename, join, relative, resolve } from 'node:path';
import {
  choicesFor,
  compile,
  DocPrinter,
  IR_VERSION,
  migrateBundle,
  migrateRoots,
  printFile,
  readStamp,
  RELEASE,
  UNSTAMPED,
  writeStamp,
  type Choice,
  type Diagnostic,
  type IRBundle,
  type MigrateResult,
  type PackSource,
} from '@mkp/core';
import { documentItemsOf, releaseCore, type ReleaseCore } from './release-core';

export interface Migrated {
  /** the files to write: path → new text */
  files: Map<string, string>;
  /** paths whose text changes */
  changed: string[];
  from: string;
  result: MigrateResult | null;
  /** problems that stop it: nothing is written */
  errors: string[];
}

export interface SourceOptions {
  /** the changes whose old look to keep, or 'all' */
  keep?: string[] | 'all';
  /** asks about the changes that can be kept, when keep isn't given */
  choose?: (choices: Choice[]) => Promise<string[]>;
  /** --core: the older release's core, for migrating offline */
  core?: string;
  /** --from: the release the files were written for, when they carry no stamp */
  from?: string;
  /** the packs the documents use, as they were (what the older core compiles them with) */
  packs?: PackSource[];
  /** the same packs migrated, when they are migrated in the same run: what the result is checked against */
  packsAfter?: PackSource[];
  /** this release's core, for files already written for it */
  current?: ReleaseCore;
}

const stampNow = { mkp: RELEASE, ir: IR_VERSION };

/** Files already written for this release: left as they are, but for a stamp they lack. */
function current(out: Migrated, files: [string, string][]): Migrated {
  for (const [p, t] of files) {
    if (readStamp(t, p)) continue;
    out.files.set(p, writeStamp(t, p, stampNow));
    out.changed.push(p);
  }
  return out;
}

async function coreFor(version: string, opts: SourceOptions): Promise<ReleaseCore> {
  if (version === RELEASE && opts.current) return opts.current;
  return releaseCore(version, { core: opts.core });
}

/** The keep answers: given, or asked, or none (the new behaviour, with how to keep the old in the warnings). */
async function answers(roots: unknown[], from: string, opts: SourceOptions): Promise<string[] | 'all'> {
  if (opts.keep) return opts.keep;
  const keepable = choicesFor(roots, from).filter((c) => c.how);
  return keepable.length && opts.choose ? opts.choose(keepable) : [];
}

/** Compiles the migrated files with this release: their errors, which stop the migration. */
function recheck(files: Map<string, string>, packs: PackSource[], packFolder?: { label: string; files: Map<string, Uint8Array> }): string[] {
  const enc = new TextEncoder();
  const all = packFolder ? [{ label: packFolder.label, files: new Map([...packFolder.files, ...[...files].filter(([p]) => p.startsWith(packFolder.label + '/')).map(([p, t]) => [p.slice(packFolder.label.length + 1), enc.encode(t)] as const)]) }, ...packs] : packs;
  const c = compile({ packs: all });
  const errs = c.diags.errors.map((d) => fmtD(d));
  for (const [path, text] of files) {
    if (!path.endsWith('.mkp.md')) continue;
    const beside = files.get(path.replace(/\.mkp\.md$/, '.mkp'));
    c.document(text, path, undefined, beside !== undefined ? { docFile: { text: beside, file: path.replace(/\.mkp\.md$/, '.mkp') } } : {});
  }
  return [...new Set([...errs, ...c.diags.errors.map((d) => fmtD(d))])];
}

const fmtD = (d: { code: string; message: string; pos?: { file: string; line: number; col: number } }): string => `${d.pos ? `${d.pos.file}:${d.pos.line}:${d.pos.col} ` : ''}${d.code}: ${d.message}`;

/** A document (and the .mkp beside it, if it has one), migrated. */
export async function migrateDocument(path: string, opts: SourceOptions = {}): Promise<Migrated> {
  const text = readFileSync(path, 'utf8');
  const file = relative(process.cwd(), path) || path;
  const besidePath = path.replace(/\.mkp\.md$/, '.mkp');
  const beside = besidePath !== path && existsSync(besidePath) ? { text: readFileSync(besidePath, 'utf8'), file: relative(process.cwd(), besidePath) || besidePath } : undefined;
  const from = opts.from ?? readStamp(text, file)?.mkp ?? UNSTAMPED;
  const out: Migrated = { files: new Map(), changed: [], from, result: null, errors: [] };
  if (from === RELEASE) return current(out, [[file, text], ...(beside ? [[beside.file, beside.text] as [string, string]] : [])]);
  const core = await coreFor(from, opts);
  const c = core.compile({ packs: opts.packs ?? [] });
  const bundle = c.document(text, file, undefined, beside ? { docFile: beside } : {}) as IRBundle | null;
  const errs = c.diags.errors;
  if (!bundle || errs.length) {
    out.errors.push(`${file} doesn't compile as MKP ${from}${readStamp(text, file) ? '' : ' (it has no stamp, so it is taken as ' + UNSTAMPED + '; pass --from if it was written for another release)'}:`, ...errs.map(fmtD));
    return out;
  }
  // its own definitions as IR, so the steps reach them, printed back afterwards
  const own = documentItemsOf(core, c, text, file, beside);
  const roots = [bundle, own?.items];
  out.result = migrateRoots(roots, from, { keep: await answers(roots, from, opts) });
  // what is said about the packs it uses belongs to migrating them: here, only its own files
  const mine = new Set([file, beside?.file]);
  out.result.warnings = out.result.warnings.filter((w) => !w.pos || mine.has(w.pos.file));
  const env = (own?.env ?? c.prog.typeEnv('$doc')) as never;
  const defs = (own ? Object.fromEntries(own.defs) : bundle.defs) as never;
  const docDef = Object.values(bundle.defs).find((d) => d.pack === '$doc' && d.name === 'document');
  const ownText = own ? own.items.map((items) => printFile(items as never, { defs, env })).join('\n') : undefined;
  if (beside) {
    out.files.set(file, writeStamp(new DocPrinter({ defs: bundle.defs, env }).doc(bundle.doc.front, bundle.doc.body, docDef), file, stampNow));
    if (ownText !== undefined) out.files.set(beside.file, writeStamp(ownText, beside.file, stampNow));
  } else out.files.set(file, writeStamp(new DocPrinter({ defs: bundle.defs, env }).doc(bundle.doc.front, bundle.doc.body, docDef, ownText), file, stampNow));
  out.errors.push(...recheck(out.files, opts.packsAfter ?? opts.packs ?? []));
  const before = new Map([[file, text], ...(beside ? [[beside.file, beside.text] as const] : [])]);
  out.changed = [...out.files].filter(([p, t]) => before.get(p) !== t).map(([p]) => p);
  return out;
}

/** A pack as it will be once `m` is written: its files with the migrated ones in their place. */
export function packAfter(src: PackSource, m: Migrated): PackSource {
  const files = new Map(src.files);
  const enc = new TextEncoder();
  for (const [p, t] of m.files) if (p.startsWith(src.label + '/')) files.set(p.slice(src.label.length + 1), enc.encode(t));
  return { label: src.label, files };
}

/** A pack folder, every file of it, migrated; its fixtures follow the inputs renamed. */
export async function migratePack(folder: string, opts: SourceOptions = {}): Promise<Migrated> {
  const abs = resolve(folder);
  const label = relative(process.cwd(), abs) || '.';
  const files = new Map<string, Uint8Array>();
  const read = (d: string): void => {
    for (const n of readdirSync(d)) {
      if (n.startsWith('.') || n === 'node_modules') continue;
      const p = join(d, n);
      if (statSync(p).isDirectory()) read(p);
      else files.set(relative(abs, p).split('\\').join('/'), new Uint8Array(readFileSync(p)));
    }
  };
  read(abs);
  const dec = new TextDecoder();
  const manifest = files.get('manifest.mkp');
  const from = opts.from ?? (manifest ? readStamp(dec.decode(manifest), 'manifest.mkp')?.mkp : undefined) ?? UNSTAMPED;
  const out: Migrated = { files: new Map(), changed: [], from, result: null, errors: [] };
  if (from === RELEASE)
    return current(
      out,
      [...files].filter(([p]) => p.endsWith('.mkp')).map(([p, b]) => [`${label}/${p}`, dec.decode(b)] as [string, string]),
    );
  if (!manifest) {
    out.errors.push(`${label} has no manifest.mkp, so it isn't a pack folder`);
    return out;
  }
  const core = await coreFor(from, opts);
  const c = core.compile({ packs: [{ label, files }, ...(opts.packs ?? [])] });
  if (c.diags.errors.length) {
    out.errors.push(`${label} doesn't compile as MKP ${from}:`, ...c.diags.errors.map(fmtD));
    return out;
  }
  const pk = [...c.prog.packs.values()].find((p) => p.files.some((f) => f.file.startsWith(label + '/')));
  if (!pk) {
    out.errors.push(`${label}: found no pack in it`);
    return out;
  }
  const itemsOf = new Map<string, unknown[]>();
  for (const f of pk.files) if (f.file.endsWith('.mkp')) itemsOf.set(f.file, core.fileItems(f, c.defs, pk.name, (n) => c.tokens.find((t) => t.name === n && t.pack === pk.name)));
  const roots = [[...itemsOf.values()], [...c.defs.values()]];
  out.result = migrateRoots(roots, from, { keep: await answers(roots, from, opts) });
  const env = c.prog.typeEnv(pk.name) as never;
  const defs = Object.fromEntries(c.defs) as never;
  for (const [file, items] of itemsOf) out.files.set(file, writeStamp(printFile(items as never, { defs, env }), file, stampNow));
  out.files.set(`${label}/manifest.mkp`, writeStamp(dec.decode(manifest), 'manifest.mkp', stampNow));
  // fixtures set inputs (and expect values) by name: they follow the renames
  for (const [path, bytes] of files) {
    if (!path.endsWith('.fixture.json')) continue;
    const fx = JSON.parse(dec.decode(bytes)) as { widget: string; cases: Record<string, { props?: Record<string, unknown>; expect?: { values?: Record<string, unknown> } }> };
    const id = `${pk.name}:${fx.widget.includes('@') ? fx.widget : `${fx.widget}@1`}`;
    const rn = out.result.renamed.filter((r) => r.def === id);
    if (!rn.length) continue;
    for (const cs of Object.values(fx.cases))
      for (const r of rn)
        for (const m of [cs.props, cs.expect?.values])
          if (m && r.from in m) {
            m[r.to] = m[r.from];
            delete m[r.from];
          }
    out.files.set(`${label}/${path}`, JSON.stringify(fx, null, 2) + '\n');
  }
  out.errors.push(...recheck(out.files, opts.packs ?? [], { label, files }));
  out.changed = [...out.files].filter(([p, t]) => dec.decode(files.get(p.slice(label.length + 1)) ?? new Uint8Array()) !== t).map(([p]) => p);
  return out;
}

/** A stored bundle (name.ir.json), migrated. */
export function migrateBundleFile(path: string, opts: { keep?: string[] | 'all' } = {}): Migrated {
  const text = readFileSync(path, 'utf8');
  const b = JSON.parse(text) as IRBundle;
  const r = migrateBundle(b, { keep: opts.keep });
  const next = JSON.stringify(r.bundle, null, text.includes('\n ') ? 1 : undefined);
  const file = relative(process.cwd(), path) || basename(path);
  return { files: new Map([[file, next]]), changed: next === text ? [] : [file], from: r.from, result: r, errors: [] };
}

export type { Diagnostic };
