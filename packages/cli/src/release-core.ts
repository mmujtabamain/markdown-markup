// An older release's core (mkp.js from its web zip), to compile what was written for that release
// with the compiler it was written for: the first step of migrating a source. Found, in order: the
// one given (--core: its mkp.js, its folder, or its zip), the cache (MKP_CACHE, else
// ~/.cache/mkp/<version>/), or the release itself, downloaded once and checked against its SHA256SUMS.

import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { Diagnostics, readZip } from '@mkp/core';

/** What migrating needs of a release's core: its compiler, its file items and its version. */
export interface ReleaseCore {
  VERSION: string;
  compile: (opts: { packs: unknown[]; lock?: unknown }) => {
    diags: { errors: { code: string; message: string; pos?: { file: string; line: number; col: number } }[] };
    defs: Map<string, unknown>;
    prog: { packs: Map<string, { name: string; files: { file: string }[]; manifest: unknown }>; typeEnv(pack: string): unknown };
    tokens: { name: string; pack: string }[];
    document(text: string, file: string, diags?: unknown, opts?: unknown): Record<string, unknown> | null;
    documentDefs(text: string, file: string, opts?: unknown): string | null;
    /** 0.2.2 on: the document's own definitions as items */
    documentItems?(text: string, file: string, opts?: unknown): { items: unknown[][]; defs: Map<string, unknown>; env: unknown } | null;
    tokenNameFn(): unknown;
    lockedFn(): unknown;
    sigs: unknown;
  };
  /** 0.2.1: what documentItems does, by hand */
  checkDocument?: (prog: unknown, text: string, file: string, diags: unknown, opts: unknown) => { prog: { packs: Map<string, { files: unknown[] }>; typeEnv(p: string): unknown }; defs: { id: string }[] };
  Diagnostics: new () => { ok: boolean };
  fileItems: (file: unknown, defs: Map<string, unknown>, pack: string, tokenIR: (name: string) => unknown) => unknown[];
}

export const RELEASES_URL = 'https://github.com/mmujtabamain/markdown-markup/releases/download';

export function cacheDir(version: string): string {
  return join(process.env.MKP_CACHE ?? join(homedir(), '.cache', 'mkp'), version);
}

/** The web files of a zip (one folder inside it, as a release has) written into `dir`. */
function unpack(zip: Uint8Array, label: string, dir: string): void {
  const d = new Diagnostics();
  const pf = readZip(zip, label, d);
  if (!pf) throw new Error(d.errors.map((e) => e.message).join('\n'));
  mkdirSync(dir, { recursive: true });
  for (const [path, bytes] of pf.files) writeFileSync(join(dir, path.slice(path.indexOf('/') + 1)), bytes);
}

/** mkp.js in a given place: the file, a folder holding it (directly or in mkp-web-<v>/), or a zip. */
function given(path: string, version: string): string {
  const p = resolve(path);
  if (!existsSync(p)) throw new Error(`--core ${path}: there is no such file or folder`);
  if (statSync(p).isDirectory()) {
    for (const c of [join(p, 'mkp.js'), join(p, `mkp-web-${version}`, 'mkp.js')]) if (existsSync(c)) return c;
    const inner = readdirSync(p).find((n) => existsSync(join(p, n, 'mkp.js')));
    if (inner) return join(p, inner, 'mkp.js');
    throw new Error(`--core ${path}: found no mkp.js in that folder; give the unzipped mkp-web-${version} folder, or its zip`);
  }
  if (p.endsWith('.zip')) {
    const dir = cacheDir(version);
    unpack(new Uint8Array(readFileSync(p)), p, dir);
    return join(dir, 'mkp.js');
  }
  return p;
}

/** Downloads a release's web zip into the cache, after checking it against the release's SHA256SUMS. */
async function download(version: string, dir: string): Promise<void> {
  const base = `${RELEASES_URL}/v${version}`;
  const get = async (name: string): Promise<Uint8Array> => {
    const r = await fetch(`${base}/${name}`);
    if (!r.ok) throw new Error(`couldn't download ${base}/${name}: ${r.status} ${r.statusText}`);
    return new Uint8Array(await r.arrayBuffer());
  };
  const zipName = `mkp-web-${version}.zip`;
  let sums: string;
  let zip: Uint8Array;
  try {
    sums = new TextDecoder().decode(await get('SHA256SUMS'));
    zip = await get(zipName);
  } catch (e) {
    throw new Error(`${(e as Error).message}. To migrate offline, download ${zipName} from ${base}/ elsewhere and pass it with --core ${zipName}`);
  }
  const want = sums.split('\n').map((l) => l.trim().split(/\s+/)).find((x) => x[1] === zipName)?.[0];
  const got = createHash('sha256').update(zip).digest('hex');
  if (!want) throw new Error(`${base}/SHA256SUMS lists no ${zipName}, so it can't be checked`);
  if (want !== got) throw new Error(`${zipName} doesn't match the release's SHA256SUMS (expected ${want}, got ${got}); it was not used`);
  unpack(zip, zipName, dir);
}

/** The core of `version`: its mkp.js, imported. */
export async function releaseCore(version: string, opts: { core?: string } = {}): Promise<ReleaseCore> {
  let file: string;
  if (opts.core) file = given(opts.core, version);
  else {
    const dir = cacheDir(version);
    file = join(dir, 'mkp.js');
    if (!existsSync(file)) await download(version, dir);
  }
  const mod = (await import(pathToFileURL(file).href)) as ReleaseCore;
  if (mod.VERSION !== version) throw new Error(`${file} is MKP ${mod.VERSION}, not ${version}; give the core of ${version}`);
  return mod;
}

/** A document's own definitions as the printer's items, from any release's core (0.2.1 has no documentItems). */
export function documentItemsOf(core: ReleaseCore, c: ReturnType<ReleaseCore['compile']>, text: string, file: string, docFile?: unknown): { items: unknown[][]; defs: Map<string, unknown>; env: unknown } | null {
  if (c.documentItems) return c.documentItems(text, file, docFile ? { docFile } : {});
  if (!core.checkDocument) return null;
  const d = new core.Diagnostics();
  const cd = core.checkDocument(c.prog, text, file, d, { tokenNames: c.tokenNameFn(), sigs: c.sigs, locked: c.lockedFn(), docFile });
  const own = cd.prog.packs.get('$doc');
  if (!d.ok || !own || own === c.prog.packs.get('$doc') || !own.files.length) return null;
  const defs = new Map<string, unknown>([...c.defs, ...cd.defs.map((x) => [x.id, x] as const)]);
  return { items: own.files.map((f) => core.fileItems(f, defs, '$doc', () => undefined)), defs, env: cd.prog.typeEnv('$doc') };
}
