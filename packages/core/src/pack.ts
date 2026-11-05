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

/** Why a path can't be a file's path in a pack, or null when it can. */
function pathProblem(p: string): string | null {
  if (!p) return 'an empty name';
  if (p.startsWith('/') || p.startsWith('\\')) return 'an absolute path (it starts with a slash)';
  if (/^[A-Za-z]:/.test(p)) return 'an absolute path (it starts with a drive letter)';
  if (p.includes('\\')) return 'a path with a backslash (packs use / between folders)';
  const parts = p.split('/');
  if (parts.includes('..')) return 'a path that goes up out of the pack with ".."';
  if (parts.includes('.')) return 'a path with a "." folder in it';
  return null;
}

/** The same path made relative and inside the pack, for a suggestion. */
function insidePath(p: string): string {
  const parts = p.replace(/^[A-Za-z]:/, '').split(/[\\/]+/).filter((x) => x && x !== '.' && x !== '..');
  return parts.join('/') || 'name.mkp';
}

const MB = 1024 * 1024;
function mb(n: number): string {
  return `${(n / MB).toFixed(1)} MB`;
}

/** The largest files, for "mostly a.png (9.0 MB), b.png (9.0 MB)". */
function heaviest(sizes: [string, number][]): string {
  return [...sizes].sort((a, b) => b[1] - a[1]).slice(0, 3).map(([n, z]) => `${n} (${mb(z)})`).join(', ');
}

const PACK_TYPES = '.mkp, .mkp.md and .fixture.json files and png, jpg, webp, svg or woff2 assets';

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
    diags.error('mkp.pack-size', `${label} is larger than a pack may be (at most 25 MB); found ${mb(bytes.length)}. Remove or shrink its largest files (images, fonts) and zip the pack again`, where);
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
    const head = new TextDecoder().decode(bytes.subarray(0, 200));
    const text = bytes.length > 0 && !/[\x00-\x08\x0e-\x1f\ufffd]/.test(head);
    const firstLine = head.split('\n').find((l) => l.trim())?.trim() ?? '';
    const found = !bytes.length ? 'an empty file' : text ? `plain text starting "${firstLine.length > 40 ? firstLine.slice(0, 40) + '…' : firstLine}"` : 'no zip directory at its end';
    diags.error('mkp.pack-zip', `${label} is not a zip file, and a .mkpack must be one; found ${found}. Zip the pack folder's files (manifest.mkp at the top), e.g. with mkp pack <folder>, or give the folder itself instead of the .mkpack`, where);
    return null;
  }
  const count = dv.getUint16(eocd + 10, true);
  let off = dv.getUint32(eocd + 16, true);
  let total = 0;
  const allowed = new Set<string>();
  let ok = true;
  const sizes: [string, number][] = [];
  for (let n = 0; n < count; n++) {
    if (off + 46 > bytes.length || dv.getUint32(off, true) !== 0x02014b50) {
      diags.error('mkp.pack-zip', `${label} is a damaged zip: its list of files (the central directory) breaks off; found ${off + 46 > bytes.length ? 'the file ending' : 'bytes that are not a file entry'} at entry ${n + 1} of ${count}. Make the .mkpack again from the pack folder (mkp pack <folder>)`, where);
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
      diags.error('mkp.pack-path', `${label}: every file in a pack must sit inside it, at a relative path; found "${name}", ${pathProblem(name)}. Move the file into the pack folder (e.g. as ${insidePath(name)}) and zip the pack again`, where);
      ok = false;
      continue;
    }
    if (madeBy >> 8 === 3 && ((attr >>> 16) & 0o170000) === 0o120000) {
      diags.error('mkp.pack-symlink', `${label}: a pack may hold only real files, not links; found "${name}", a symbolic link. Replace it with a copy of the file it points to, and zip the pack again`, { ...where, file: `${label}/${name}` });
      ok = false;
      continue;
    }
    if (size > PACK_LIMITS.file) {
      diags.error('mkp.pack-size', `${label}: a file in a pack may be at most 10 MB; found "${name}" at ${mb(size)} unpacked. Shrink it (e.g. compress the image or lower its resolution) or remove it`, { ...where, file: `${label}/${name}` });
      ok = false;
      continue;
    }
    total += size;
    sizes.push([name, size]);
    allowed.add(name);
  }
  if (total > PACK_LIMITS.pack) {
    diags.error('mkp.pack-size', `${label} unpacks to more than a pack may hold (at most 25 MB in all, however well it compresses); found ${mb(total)} unpacked, mostly ${heaviest(sizes)}. Remove or shrink some of those files`, where);
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

/** What is wrong with an SVG sanitizeSvg refuses, the line it is on, and the fix. */
function svgProblem(svg: string): { found: string; fix: string; line: number } {
  const lineOf = (i: number): number => (i < 0 ? 1 : svg.slice(0, i).split('\n').length);
  const doctype = svg.search(/<!DOCTYPE/i);
  if (doctype >= 0) return { found: 'a <!DOCTYPE …> line', fix: 'Remove the <!DOCTYPE …> line; an SVG needs none', line: lineOf(doctype) };
  const entity = svg.search(/<!ENTITY/i);
  if (entity >= 0) return { found: 'an <!ENTITY …> declaration', fix: 'Remove the <!ENTITY …> declarations and write their text out where they are used', line: lineOf(entity) };
  const root = /<([A-Za-z][\w:.-]*)/.exec(svg.replace(/<\?[\s\S]*?\?>|<!--[\s\S]*?-->/g, (m) => ' '.repeat(m.length)));
  if (root && root[1].toLowerCase() !== 'svg') return { found: `an outer element <${root[1]}> rather than <svg>`, fix: 'Save it as a plain SVG whose outer element is <svg>', line: lineOf(root.index) };
  return { found: root ? 'markup that does not read as XML' : 'no <svg> element at all', fix: 'Save it again from an editor as a plain SVG, and check that its tags are closed', line: 1 };
}

/** Where JSON.parse stopped, in words, with a fix for the usual causes. */
function jsonProblem(text: string, message: string): { why: string; line: number; col: number; fix: string } {
  const lc = /line (\d+) column (\d+)/.exec(message);
  const atPos = /at position (\d+)/.exec(message);
  let offset = atPos ? Number(atPos[1]) : -1;
  let line = 1;
  let col = 1;
  if (lc) {
    line = Number(lc[1]);
    col = Number(lc[2]);
    if (offset < 0) offset = text.split('\n').slice(0, line - 1).reduce((n, l) => n + l.length + 1, 0) + col - 1;
  } else if (offset >= 0) {
    const before = text.slice(0, offset).split('\n');
    line = before.length;
    col = before[before.length - 1].length + 1;
  }
  const why = message.replace(/\s*(in JSON )?at position \d+.*$/, '').replace(/\s*\(line \d+ column \d+\)/, '').replace(/^JSON\.parse: /, '').trim() || 'a mistake';
  const prev = offset > 0 ? text.slice(0, offset).trimEnd().slice(-1) : '';
  const here = offset >= 0 ? text.slice(offset).trimStart()[0] : undefined;
  let fix = 'Fix the JSON there: keys and text need double quotes, and nothing may follow the last item of a list or object';
  if (prev === ',' && (here === '}' || here === ']')) fix = `Remove that comma: JSON allows none after the last item`;
  else if (here === "'") fix = 'Use double quotes ("…"), not single quotes';
  else if (offset >= text.trimEnd().length) fix = 'The file ends too soon: close every { and [ it opens';
  const lower = why.charAt(0).toLowerCase() + why.slice(1);
  const found = prev === ',' && (here === '}' || here === ']') ? `a comma just before \`${here}\`` : here === "'" ? 'a single quote' : here ? `\`${here}\`` : 'the end of the file';
  return { why: `${found} at line ${line} column ${col} (${lower})`, line, col, fix };
}

/** Reads a pack's manifest and sources into a PackInfo, enforcing the file rules. */
export function loadPack(pf: PackFiles, diags: Diagnostics): PackInfo | null {
  const manifestBytes = pf.files.get('manifest.mkp');
  const where = { file: `${pf.label}/manifest.mkp`, line: 1, col: 1 };
  if (!manifestBytes) {
    const nested = [...pf.files.keys()].filter((k) => k.endsWith('/manifest.mkp')).sort((a, b) => a.length - b.length)[0];
    if (nested) {
      const folder = nested.slice(0, -'/manifest.mkp'.length);
      const fix = pf.origin === 'zip' ? `Zip the contents of the ${folder} folder, not the folder itself, so manifest.mkp is at the top` : `Give ${pf.label}/${folder} as the pack instead, or move manifest.mkp to the top of ${pf.label}`;
      diags.error('mkp.pack-manifest', `${pf.label} has no manifest.mkp at its top, the file that names a pack; found one in a folder inside it, at ${nested}. ${fix}`, { file: `${pf.label}/${nested}`, line: 1, col: 1 });
    } else {
      const names = [...pf.files.keys()].sort();
      const found = names.length ? `only ${names.slice(0, 3).join(', ')}${names.length > 3 ? ', …' : ''}` : 'no files at all';
      diags.error('mkp.pack-manifest', `${pf.label} has no manifest.mkp, the file that names a pack and what it provides; found ${found}. Add manifest.mkp at the top of the pack, e.g. pack notes@1 "What the pack holds." and, under it, requires core@1`, { file: `${pf.label}/manifest.mkp`, line: 1, col: 1 });
    }
    return null;
  }
  const manifestText = decoder.decode(manifestBytes);
  const mfile = parseMkp(manifestText, `${pf.label}/manifest.mkp`, diags);
  const manifest = mfile.items.find((i) => i.item === 'manifest') as ManifestSyn | undefined;
  if (!manifest) {
    const lines = manifestText.split('\n');
    const n = lines.findIndex((l) => l.trim() && !l.trim().startsWith('#'));
    const first = n >= 0 ? lines[n].trim() : '';
    const shown = first.length > 60 ? first.slice(0, 60) + '…' : first;
    const fix = /^[A-Za-z_][\w.-]*@\d+/.test(first)
      ? `Add the word pack before it: pack ${shown}`
      : /^(pack|profile)\b/.test(first)
        ? 'Write the name with its version, e.g. pack notes@1 "What the pack holds."'
        : 'Make the first line name the pack, e.g. pack notes@1 "What the pack holds."';
    diags.error('mkp.pack-manifest', `manifest.mkp must start with a line "pack name@N" (or "profile name@N" for a profile); found ${first ? shown : 'no line at all'}. ${fix}`, { ...where, line: n >= 0 ? n + 1 : 1 });
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
    manifestText,
  };
  if (manifest.name !== 'core' && !manifest.requires.some((r) => r.startsWith('core@'))) diags.warn('mkp.pack-requires', `the manifest of pack ${manifest.name} should say requires core@1, since every pack builds on the base set; found ${manifest.requires.length ? `requires ${manifest.requires.join(' ')}` : 'no requires line'}. Add requires core@1 on the line under pack ${manifest.name}@${manifest.version}`, where);
  const listing: Record<string, string> = {};
  let total = 0;
  const sizes: [string, number][] = [];
  for (const [path, bytes] of [...pf.files].sort(([a], [b]) => (a < b ? -1 : 1))) {
    const at = { file: `${pf.label}/${path}`, line: 1, col: 1 };
    if (!safePath(path)) {
      diags.error('mkp.pack-path', `every file in a pack must sit inside it, at a relative path; found "${path}", ${pathProblem(path)}. Use a path inside the pack with / between folders, e.g. ${insidePath(path)}`, at);
      continue;
    }
    if (bytes.length > PACK_LIMITS.file) {
      diags.error('mkp.pack-size', `a file in a pack may be at most 10 MB; found ${path} at ${mb(bytes.length)}. Shrink it (e.g. compress the image or lower its resolution) or remove it from the pack`, at);
      continue;
    }
    total += bytes.length;
    sizes.push([path, bytes.length]);
    listing[path] = sha256(bytes);
    if (path === 'manifest.mkp') continue;
    const e = ext(path);
    if (path.endsWith('.fixture.json')) {
      const text = decoder.decode(bytes);
      try {
        info.fixtures.push({ path, json: JSON.parse(text) });
      } catch (err) {
        const j = jsonProblem(text, (err as Error).message);
        diags.error('mkp.fixture-json', `${path} is not valid JSON; found ${j.why}. ${j.fix}`, { ...at, line: j.line, col: j.col });
      }
    } else if (path.endsWith('.mkp.md')) {
      info.documents.push({ path, text: decoder.decode(bytes) });
    } else if (e === 'mkp') {
      info.files.push(parseMkp(decoder.decode(bytes), `${pf.label}/${path}`, diags));
    } else if (ASSET_EXT.has(e)) {
      if (e === 'svg') {
        const svg = decoder.decode(bytes);
        const clean = sanitizeSvg(svg);
        if (clean === null) {
          const why = svgProblem(svg);
          diags.error('mkp.pack-svg', `${path} can't be used: a pack takes only plain SVGs, with an <svg> root and no DOCTYPE or entities; found ${why.found}. ${why.fix}`, { ...at, line: why.line });
          continue;
        }
        info.assets.set(path, utf8(clean));
      } else info.assets.set(path, bytes);
    } else if (pf.origin === 'zip') {
      diags.error('mkp.pack-file-type', `${path} can't go in a pack, which holds only ${PACK_TYPES}; found ${e ? `a .${e} file` : 'a file with no extension'}. Remove it from the zip`, at);
    } else if (!/(^|\/)(README|LICENSE|CHANGELOG)(\.md|\.txt)?$/i.test(path)) {
      diags.warn('mkp.pack-file-type', `${path} is left out of the pack, which holds only ${PACK_TYPES} (and a README, LICENSE or CHANGELOG); found ${e ? `a .${e} file` : 'a file with no extension'}. Move it out of the pack folder, or leave it if it is only for you`, at);
    }
  }
  if (total > PACK_LIMITS.pack) diags.error('mkp.pack-size', `${pf.label} holds more than a pack may (at most 25 MB in all); found ${mb(total)}, mostly ${heaviest(sizes)}. Remove or shrink some of those files`, where);
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
