// pnpm hermes: the conformance suite under the Hermes CLI (spec 15: core runs on Hermes).
// Bundles the core with the golden cases, lowers it to ES5 with SWC (as React Native's Babel
// preset does: Hermes has no classes, async functions or block scoping), and runs `hermes`.
import { build } from 'esbuild';
import { transformSync } from '@swc/core';
import { execFileSync, spawn, spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { cpus, homedir } from 'node:os';
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
const only = process.env.MKP_CASES ? new RegExp(process.env.MKP_CASES) : null;
const cases = index.cases.filter((id) => !only || only.test(id)).map((id) => JSON.parse(readFileSync(join(root, 'conformance/cases', `${id}.json`), 'utf8')));
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
// the compiler runs too: the test packs, and a document with its own definitions
const packs = readdirSync(join(root, 'conformance/packs')).map((n) => folder(join(root, 'conformance/packs', n)));
const docCase = cases.find((c) => c.id === 'examples.25-roots-of-unity');
const doc = { path: 'examples/25-roots-of-unity/doc.mkp.md', text: readFileSync(join(root, 'examples/25-roots-of-unity/doc.mkp.md'), 'utf8'), digest: docCase?.bundle.doc.digest };

// Hermes has a 1 GB heap, so the cases run in batches, each a separate process: the first batch
// also compiles a document with its own definitions and renders maths.
const BATCH = 8;
const batches = [];
for (let i = 0; i < cases.length; i += BATCH) batches.push(cases.slice(i, i + BATCH));
const bin = hermesBin();
const ver = spawnSync(bin, ['-version'], { encoding: 'utf8' }).stdout.match(/Hermes release version: (\S+)/)?.[1] ?? '?';
const t0 = Date.now();
let largest = 0;
const files = [];
for (let b = 0; b < batches.length; b++) {
  const dir = join(work, `batch-${b}`);
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(work, 'data.json'), JSON.stringify(b === 0 ? { cases: batches[b], packs, doc } : { cases: batches[b], packs: [], doc: null }));
  await build({
    entryPoints: [join(here, 'hermes-entry.ts')],
    bundle: true,
    platform: 'neutral',
    mainFields: ['module', 'main'],
    format: 'iife',
    outfile: join(dir, 'bundle.js'),
    define: { 'process.env.NODE_ENV': '"production"', global: 'globalThis' },
    banner: { js: HERMES_PRELUDE() },
    logLevel: 'warning',
    target: 'es2020',
  });
  // lower only what Hermes lacks (classes, block scoping, async functions), as React Native's
  // Babel preset does; for-of, spread and destructuring stay native, which is ~3x faster than ES5
  const es5 = transformSync(readFileSync(join(dir, 'bundle.js'), 'utf8'), {
    env: { targets: { chrome: '70' }, include: ['transform-classes', 'transform-block-scoping', 'transform-async-to-generator', 'transform-parameters'] },
    jsc: { parser: { syntax: 'ecmascript' } },
    isModule: false,
  });
  writeFileSync(join(dir, 'bundle.es5.js'), es5.code);
  largest = Math.max(largest, statSync(join(dir, 'bundle.es5.js')).size);
  files.push(join(dir, 'bundle.es5.js'));
}
console.log(`hermes: ${batches.length} bundles (largest ${(largest / 1e6).toFixed(1)} MB), built in ${((Date.now() - t0) / 1000).toFixed(1)} s`);

const run = (file) =>
  new Promise((resolve) => {
    const started = Date.now();
    const p = spawn(bin, ['-w', '-Xmicrotask-queue', '-gc-max-heap=3G', file], { stdio: ['ignore', 'pipe', 'pipe'] });
    let out = '';
    let err = '';
    // a batch that runs past 15 minutes is a failure, not a hang
    const limit = setTimeout(() => {
      err += `timed out after 900 s: ${file}`;
      p.kill('SIGKILL');
    }, 900_000);
    p.stdout.on('data', (d) => (out += d));
    p.stderr.on('data', (d) => (err += d));
    p.on('close', (code) => {
      clearTimeout(limit);
      console.log(`  ${file.split('/').slice(-2, -1)[0]}: ${((Date.now() - started) / 1000).toFixed(1)} s`);
      resolve({ code, out, err });
    });
  });
const t1 = Date.now();
const results = [];
let failedRuns = 0;
const parallel = Math.max(1, Math.min(10, cpus().length));
for (let i = 0; i < files.length; i += parallel) {
  const outs = await Promise.all(files.slice(i, i + parallel).map(run));
  for (const o of outs) {
    results.push(...o.out.split('\n').filter((l) => l.startsWith('MKP-RESULT ')).map((l) => JSON.parse(l.slice(11))));
    if (o.code !== 0 || o.err.trim()) {
      failedRuns++;
      console.error(o.err.split('\n').slice(0, 10).join('\n'));
    }
  }
}
const bad = results.filter((x) => x.ok === false);
for (const r of results.filter((x) => x.kind === 'case').sort((a, b) => b.ms - a.ms).slice(0, 8)) console.log(`  ${(r.ms / 1000).toFixed(1)} s ${r.id}`);
for (const b of bad) console.error(`✗ ${b.kind} ${b.id ?? ''}: ${JSON.stringify(b.diffs ?? b.error ?? b)}`);
const ran = results.filter((x) => x.kind === 'case').length;
const comp = results.find((x) => x.kind === 'compile');
const maths = results.find((x) => x.kind === 'maths');
const done = results.filter((x) => x.kind === 'done').length;
console.log(`hermes ${ver} (release v0.13.0): ${ran - bad.filter((b) => b.kind === 'case').length}/${cases.length} conformance cases agree; compiler ${comp?.ok ? 'ok' : 'FAILED'} (${comp?.defs ?? 0} definitions); maths ${maths?.ok ? `ok (${maths.ms} ms)` : 'FAILED'}; ${((Date.now() - t1) / 1000).toFixed(1)} s in ${files.length} processes`);
if (failedRuns || bad.length || ran !== cases.length || done !== files.length || !comp?.ok || !maths?.ok) process.exit(1);

function HERMES_PRELUDE() {
  // what the Hermes CLI lacks and React Native supplies: console, TextEncoder and TextDecoder
  return `
var globalThis = this || (function () { return this; })();
if (typeof globalThis.console === 'undefined') { globalThis.console = { log: function () { print([].slice.call(arguments).join(' ')); }, warn: function () {}, error: function () { print('error ' + [].slice.call(arguments).join(' ')); }, info: function () {}, debug: function () {} }; }
if (typeof globalThis.TextEncoder === 'undefined') { globalThis.TextEncoder = function () {}; globalThis.TextEncoder.prototype.encode = function (s) { s = String(s); var out = []; for (var i = 0; i < s.length; i++) { var c = s.charCodeAt(i); if (c >= 0xd800 && c < 0xdc00 && i + 1 < s.length) { var d = s.charCodeAt(i + 1); if (d >= 0xdc00 && d < 0xe000) { c = 0x10000 + ((c - 0xd800) << 10) + (d - 0xdc00); i++; } } if (c < 0x80) out.push(c); else if (c < 0x800) out.push(0xc0 | (c >> 6), 0x80 | (c & 63)); else if (c < 0x10000) out.push(0xe0 | (c >> 12), 0x80 | ((c >> 6) & 63), 0x80 | (c & 63)); else out.push(0xf0 | (c >> 18), 0x80 | ((c >> 12) & 63), 0x80 | ((c >> 6) & 63), 0x80 | (c & 63)); } return new Uint8Array(out); }; }
if (typeof globalThis.TextDecoder === 'undefined') { globalThis.TextDecoder = function () {}; globalThis.TextDecoder.prototype.decode = function (b) { if (!b) return ''; var s = ''; for (var i = 0; i < b.length; ) { var c = b[i++]; if (c >= 0xf0) { c = ((c & 7) << 18) | ((b[i++] & 63) << 12) | ((b[i++] & 63) << 6) | (b[i++] & 63); c -= 0x10000; s += String.fromCharCode(0xd800 + (c >> 10), 0xdc00 + (c & 1023)); continue; } if (c >= 0xe0) c = ((c & 15) << 12) | ((b[i++] & 63) << 6) | (b[i++] & 63); else if (c >= 0xc0) c = ((c & 31) << 6) | (b[i++] & 63); s += String.fromCharCode(c); } return s; }; }
`;
}
