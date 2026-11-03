// pnpm hermes: the conformance suite under the Hermes CLI (spec 15: core runs on Hermes).
// Bundles the core with the golden cases, lowers it to ES5 with SWC (as React Native's Babel
// preset does: Hermes has no classes, async functions or block scoping), and runs `hermes`.
import { build } from 'esbuild';
import { transformSync } from '@swc/core';
import { execFileSync, spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, '..');
const work = join(here, '.hermes');
mkdirSync(work, { recursive: true });

function hermesBin() {
  if (process.env.HERMES && existsSync(process.env.HERMES)) return process.env.HERMES;
  const dir = join(homedir(), '.cache', 'mkp-hermes-0.13.0');
  const bin = join(dir, 'hermes');
  if (!existsSync(bin)) {
    mkdirSync(dir, { recursive: true });
    const tgz = join(dir, 'hermes.tgz');
    execFileSync('curl', ['-sSL', '--fail', '-o', tgz, 'https://github.com/facebook/hermes/releases/download/v0.13.0/hermes-cli-linux.tar.gz'], { stdio: 'inherit' });
    execFileSync('tar', ['xzf', tgz, '-C', dir]);
  }
  return bin;
}

// the data: golden cases, pack sources and the section-18 document with its Node digest
const index = JSON.parse(readFileSync(join(root, 'conformance/index.json'), 'utf8'));
const cases = index.cases.map((id) => JSON.parse(readFileSync(join(root, 'conformance/cases', `${id}.json`), 'utf8')));
const folder = (d) => {
  const files = {};
  const walk = (x) => {
    for (const n of readdirSync(x)) {
      const p = join(x, n);
      if (statSync(p).isDirectory()) walk(p);
      else files[relative(d, p)] = readFileSync(p, 'utf8');
    }
  };
  walk(d);
  return { label: relative(root, d), files };
};
const packs = [...readdirSync(join(root, 'packs')).map((n) => folder(join(root, 'packs', n))), ...readdirSync(join(root, 'examples')).map((n) => folder(join(root, 'examples', n)))];
const docCase = cases.find((c) => c.id === 'spec18.roots.doc');
const doc = { path: 'spec18/roots.mkp.md', text: readFileSync(join(root, 'examples/spec18/roots.mkp.md'), 'utf8'), digest: docCase?.bundle.doc.digest };
writeFileSync(join(work, 'data.json'), JSON.stringify({ cases, packs, doc }));

const t0 = Date.now();
await build({
  entryPoints: [join(here, 'hermes-entry.ts')],
  bundle: true,
  platform: 'neutral',
  mainFields: ['module', 'main'],
  format: 'iife',
  outfile: join(work, 'bundle.js'),
  define: { 'process.env.NODE_ENV': '"production"', global: 'globalThis' },
  banner: { js: HERMES_PRELUDE() },
  logLevel: 'warning',
  target: 'es2020',
});
const es5 = transformSync(readFileSync(join(work, 'bundle.js'), 'utf8'), { jsc: { target: 'es5', parser: { syntax: 'ecmascript' }, loose: false }, isModule: false, minify: false });
writeFileSync(join(work, 'bundle.es5.js'), es5.code);
const size = statSync(join(work, 'bundle.es5.js')).size;
console.log(`hermes bundle: ${(size / 1e6).toFixed(1)} MB ES5 (built in ${Date.now() - t0} ms)`);

const bin = hermesBin();
const ver = spawnSync(bin, ['-version'], { encoding: 'utf8' }).stdout.match(/Hermes release version: (\S+)/)?.[1] ?? '?';
const t1 = Date.now();
const r = spawnSync(bin, ['-w', '-Xmicrotask-queue', join(work, 'bundle.es5.js')], { encoding: 'utf8', maxBuffer: 1 << 28, timeout: 900000 });
const results = (r.stdout ?? '').split('\n').filter((l) => l.startsWith('MKP-RESULT ')).map((l) => JSON.parse(l.slice(11)));
const bad = results.filter((x) => x.ok === false);
for (const b of bad) console.error(`✗ ${b.kind} ${b.id ?? ''}: ${JSON.stringify(b.diffs ?? b.error ?? b)}`);
const ran = results.filter((x) => x.kind === 'case').length;
const comp = results.find((x) => x.kind === 'compile');
const maths = results.find((x) => x.kind === 'maths');
const done = results.find((x) => x.kind === 'done');
console.log(`hermes ${ver}: ${ran - bad.filter((b) => b.kind === 'case').length}/${cases.length} conformance cases agree; compiler ${comp?.ok ? 'ok' : 'FAILED'} (${comp?.defs ?? 0} definitions); maths ${maths?.ok ? `ok (${maths.ms} ms)` : 'FAILED'}; ${((Date.now() - t1) / 1000).toFixed(1)} s`);
if (r.status !== 0 || r.stderr?.trim()) console.error(r.stderr?.split('\n').slice(0, 20).join('\n'));
if (!done || bad.length || ran !== cases.length || r.status !== 0) process.exit(1);

function HERMES_PRELUDE() {
  // what the Hermes CLI lacks and React Native supplies: console, TextEncoder and TextDecoder
  return `
var globalThis = this || (function () { return this; })();
if (typeof globalThis.console === 'undefined') { globalThis.console = { log: function () { print([].slice.call(arguments).join(' ')); }, warn: function () {}, error: function () { print('error ' + [].slice.call(arguments).join(' ')); }, info: function () {}, debug: function () {} }; }
if (typeof globalThis.TextEncoder === 'undefined') { globalThis.TextEncoder = function () {}; globalThis.TextEncoder.prototype.encode = function (s) { s = String(s); var out = []; for (var i = 0; i < s.length; i++) { var c = s.charCodeAt(i); if (c >= 0xd800 && c < 0xdc00 && i + 1 < s.length) { var d = s.charCodeAt(i + 1); if (d >= 0xdc00 && d < 0xe000) { c = 0x10000 + ((c - 0xd800) << 10) + (d - 0xdc00); i++; } } if (c < 0x80) out.push(c); else if (c < 0x800) out.push(0xc0 | (c >> 6), 0x80 | (c & 63)); else if (c < 0x10000) out.push(0xe0 | (c >> 12), 0x80 | ((c >> 6) & 63), 0x80 | (c & 63)); else out.push(0xf0 | (c >> 18), 0x80 | ((c >> 12) & 63), 0x80 | ((c >> 6) & 63), 0x80 | (c & 63)); } return new Uint8Array(out); }; }
if (typeof globalThis.TextDecoder === 'undefined') { globalThis.TextDecoder = function () {}; globalThis.TextDecoder.prototype.decode = function (b) { if (!b) return ''; var s = ''; for (var i = 0; i < b.length; ) { var c = b[i++]; if (c >= 0xf0) { c = ((c & 7) << 18) | ((b[i++] & 63) << 12) | ((b[i++] & 63) << 6) | (b[i++] & 63); c -= 0x10000; s += String.fromCharCode(0xd800 + (c >> 10), 0xdc00 + (c & 1023)); continue; } if (c >= 0xe0) c = ((c & 15) << 12) | ((b[i++] & 63) << 6) | (b[i++] & 63); else if (c >= 0xc0) c = ((c & 31) << 6) | (b[i++] & 63); s += String.fromCharCode(c); } return s; }; }
`;
}
