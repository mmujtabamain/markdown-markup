// Packs (spec 10): folders and .mkpack zips, the manifest, and the safety rules: no absolute
// paths or "..", no symlinks, 25 MB per pack and 10 MB per file, only listed asset types, and
// SVGs sanitised.

import { unzipSync, zipSync } from 'fflate';
import { DOMParser, XMLSerializer } from '@xmldom/xmldom';
import { Diagnostics } from './diag';
import type { PackInfo } from './check/program';
import { parseMkp, type ManifestSyn } from './syntax/mkp';
import { canonicalJson } from './util/jcs';
import { sha256, utf8 } from './util/sha256';

export const PACK_LIMITS = { pack: 25 * 1024 * 1024, file: 10 * 1024 * 1024 };
const ASSET_EXT = new Set(['png', 'jpg', 'jpeg', 'webp', 'svg', 'woff2']);

export interface PackFiles {
  label: string;
  origin: 'folder' | 'zip';
  files: Map<string, Uint8Array>;
}

function ext(p: string): string {
  const m = /\.([A-Za-z0-9]+)$/.exec(p);
  return m ? m[1].toLowerCase() : '';
}

export function safePath(p: string): string | null {
  if (!p || p.startsWith('/') || p.startsWith('\\') || /^[A-Za-z]:/.test(p) || p.includes('\\')) return null;
  const parts = p.split('/');
  if (parts.some((s) => s === '..' || s === '.')) return null;
  return p;
}

/** Reads a .mkpack zip, checking the central directory before inflating anything. */
export function readZip(bytes: Uint8Array, label: string, diags: Diagnostics): PackFiles | null {
  const where = { file: label, line: 1, col: 1 };
  if (bytes.length > PACK_LIMITS.pack) {
    diags.error('mkp.pack-size', `${label} is ${(bytes.length / 1e6).toFixed(1)} MB; a pack may be at most 25 MB`, where);
    return null;
  }
  const dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  let eocd = -1;
  for (let i = bytes.length - 22; i >= Math.max(0, bytes.length - 65557); i--) {
    if (dv.getUint32(i, true) === 0x06054b50) {
      eocd = i;
      break;
    }
  }
  if (eocd < 0) {
    diags.error('mkp.pack-zip', `${label} is not a zip file`, where);
    return null;
  }
  const count = dv.getUint16(eocd + 10, true);
  let off = dv.getUint32(eocd + 16, true);
  let total = 0;
  const allowed = new Set<string>();
  let ok = true;
  for (let n = 0; n < count; n++) {
    if (off + 46 > bytes.length || dv.getUint32(off, true) !== 0x02014b50) {
      diags.error('mkp.pack-zip', `${label} has a damaged central directory`, where);
      return null;
    }
    const madeBy = dv.getUint16(off + 4, true);
    const size = dv.getUint32(off + 24, true);
    const nameLen = dv.getUint16(off + 28, true);
    const extraLen = dv.getUint16(off + 30, true);
    const commentLen = dv.getUint16(off + 32, true);
    const attr = dv.getUint32(off + 38, true);
    const name = new TextDecoder().decode(bytes.subarray(off + 46, off + 46 + nameLen));
    off += 46 + nameLen + extraLen + commentLen;
    if (name.endsWith('/')) continue;
    if (!safePath(name)) {
      diags.error('mkp.pack-path', `${label}: "${name}" is an absolute path or uses ".."; packs hold relative paths only`, where);
      ok = false;
      continue;
    }
    if (madeBy >> 8 === 3 && ((attr >>> 16) & 0o170000) === 0o120000) {
      diags.error('mkp.pack-symlink', `${label}: "${name}" is a symlink; packs may not hold links`, where);
      ok = false;
      continue;
    }
    if (size > PACK_LIMITS.file) {
      diags.error('mkp.pack-size', `${label}: "${name}" is ${(size / 1e6).toFixed(1)} MB; files may be at most 10 MB`, where);
      ok = false;
      continue;
    }
    total += size;
    allowed.add(name);
  }
  if (total > PACK_LIMITS.pack) {
    diags.error('mkp.pack-size', `${label} unpacks to ${(total / 1e6).toFixed(1)} MB; a pack may be at most 25 MB`, where);
    return null;
  }
  if (!ok) return null;
  const files = new Map<string, Uint8Array>();
  const out = unzipSync(bytes, { filter: (f) => allowed.has(f.name) && f.originalSize <= PACK_LIMITS.file });
  for (const [k, v] of Object.entries(out)) files.set(k, v);
  return { label, origin: 'zip', files };
}

/** Writes a pack folder's files as a .mkpack zip (deterministic: sorted, fixed times). */
export function writeZip(files: Map<string, Uint8Array>): Uint8Array {
  const entries: Record<string, [Uint8Array, { mtime: Date }]> = {};
  for (const k of [...files.keys()].sort()) entries[k] = [files.get(k)!, { mtime: new Date(Date.UTC(1980, 0, 1)) }];
  return zipSync(entries, { level: 9 });
}

/** Removes scripts, event handlers, foreignObject and external references from an SVG. */
export function sanitizeSvg(svg: string): string | null {
  if (/<!DOCTYPE|<!ENTITY/i.test(svg)) return null;
  let doc: Document;
  try {
    doc = new DOMParser({ onError: () => undefined }).parseFromString(svg, 'image/svg+xml') as unknown as Document;
  } catch {
    return null;
  }
  const root = doc.documentElement;
  if (!root || root.nodeName.toLowerCase() !== 'svg') return null;
  const walk = (el: Element): void => {
    for (const child of Array.from(el.childNodes) as Element[]) {
      if (child.nodeType !== 1) continue;
      const n = child.nodeName.toLowerCase();
      if (n === 'script' || n === 'foreignobject' || n === 'iframe' || n === 'embed' || n === 'object') {
        el.removeChild(child);
        continue;
      }
      for (const a of Array.from(child.attributes ?? [])) {
        const an = a.name.toLowerCase();
        const v = a.value.trim().toLowerCase();
        if (an.startsWith('on')) child.removeAttribute(a.name);
        else if ((an === 'href' || an === 'xlink:href' || an === 'src') && !v.startsWith('#')) child.removeAttribute(a.name);
        else if (an === 'style' && /url\(|expression\(|javascript:/.test(v)) child.removeAttribute(a.name);
      }
      walk(child);
    }
  };
  for (const a of Array.from(root.attributes ?? [])) if (a.name.toLowerCase().startsWith('on')) root.removeAttribute(a.name);
  walk(root);
  return new XMLSerializer().serializeToString(doc as unknown as Parameters<XMLSerializer['serializeToString']>[0]);
}

const decoder = new TextDecoder();

/** Reads a pack's manifest and sources into a PackInfo, enforcing the file rules. */
export function loadPack(pf: PackFiles, diags: Diagnostics): PackInfo | null {
  const manifestBytes = pf.files.get('manifest.mkp');
  const where = { file: `${pf.label}/manifest.mkp`, line: 1, col: 1 };
  if (!manifestBytes) {
    diags.error('mkp.pack-manifest', `${pf.label} has no manifest.mkp`, { file: pf.label, line: 1, col: 1 });
    return null;
  }
  const mfile = parseMkp(decoder.decode(manifestBytes), `${pf.label}/manifest.mkp`, diags);
  const manifest = mfile.items.find((i) => i.item === 'manifest') as ManifestSyn | undefined;
  if (!manifest) {
    diags.error('mkp.pack-manifest', 'manifest.mkp must start with "pack name@N" (or "profile name@N")', where);
    return null;
  }
  const info: PackInfo = {
    name: manifest.name,
    version: manifest.version,
    about: manifest.about,
    kind: manifest.kind,
    requires: manifest.requires,
    depends: manifest.depends,
    provides: new Set(manifest.provides),
    manifest,
    files: [],
    fixtures: [],
    assets: new Map(),
    documents: [],
    digest: '',
    label: pf.label,
  };
  if (manifest.name !== 'core' && !manifest.requires.some((r) => r.startsWith('core@'))) diags.warn('mkp.pack-requires', `${manifest.name}: the manifest should say "requires core@1"`, where);
  const listing: Record<string, string> = {};
  let total = 0;
  for (const [path, bytes] of [...pf.files].sort(([a], [b]) => (a < b ? -1 : 1))) {
    const at = { file: `${pf.label}/${path}`, line: 1, col: 1 };
    if (!safePath(path)) {
      diags.error('mkp.pack-path', `"${path}" is not a safe relative path`, at);
      continue;
    }
    if (bytes.length > PACK_LIMITS.file) {
      diags.error('mkp.pack-size', `${path} is over 10 MB`, at);
      continue;
    }
    total += bytes.length;
    listing[path] = sha256(bytes);
    if (path === 'manifest.mkp') continue;
    const e = ext(path);
    if (path.endsWith('.fixture.json')) {
      try {
        info.fixtures.push({ path, json: JSON.parse(decoder.decode(bytes)) });
      } catch (err) {
        diags.error('mkp.fixture-json', `${path} is not valid JSON: ${(err as Error).message}`, at);
      }
    } else if (path.endsWith('.mkp.md')) {
      info.documents.push({ path, text: decoder.decode(bytes) });
    } else if (e === 'mkp') {
      info.files.push(parseMkp(decoder.decode(bytes), `${pf.label}/${path}`, diags));
    } else if (ASSET_EXT.has(e)) {
      if (e === 'svg') {
        const clean = sanitizeSvg(decoder.decode(bytes));
        if (clean === null) {
          diags.error('mkp.pack-svg', `${path} is not a safe SVG (DOCTYPE, entities or no <svg> root)`, at);
          continue;
        }
        info.assets.set(path, utf8(clean));
      } else info.assets.set(path, bytes);
    } else if (pf.origin === 'zip') {
      diags.error('mkp.pack-file-type', `${path}: packs hold .mkp, .fixture.json and png, jpg, webp, svg or woff2 assets only`, at);
    } else if (!/(^|\/)(README|LICENSE|CHANGELOG)(\.md|\.txt)?$/i.test(path)) {
      diags.warn('mkp.pack-file-type', `${path} is not part of a pack and is left out`, at);
    }
  }
  if (total > PACK_LIMITS.pack) diags.error('mkp.pack-size', `${pf.label} holds ${(total / 1e6).toFixed(1)} MB; a pack may be at most 25 MB`, where);
  info.digest = 'sha256:' + sha256(canonicalJson(listing));
  return info;
}

/** The built-in core@1 pack. */
export function corePack(src: string, diags: Diagnostics): PackInfo {
  const files = new Map<string, Uint8Array>([['manifest.mkp', utf8(src.split('\n\n')[0] + '\n')], ['core.mkp', utf8(src.split('\n').slice(src.split('\n\n')[0].split('\n').length).join('\n'))]]);
  const p = loadPack({ label: 'core', origin: 'folder', files }, diags)!;
  p.builtin = true;
  return p;
}
