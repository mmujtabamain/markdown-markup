// Builds dist/mkp.cjs (one file, Node 20+), and with --sea the single executable dist/mkp
// (Node's single-executable applications: the bundle injected into a copy of the node binary).
// The page script of --target html (packages/page, built first) goes inside it as text.
import { build } from 'esbuild';
import { execFileSync } from 'node:child_process';
import { copyFileSync, chmodSync, mkdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const pkg = resolve(here, '..');
// MKP_CLI_DIST: another folder for it (scripts/dist.mjs builds a release's CLI there, so the tests'
// own build in dist/ is never rewritten while a test is running it)
const dist = process.env.MKP_CLI_DIST ? resolve(process.env.MKP_CLI_DIST) : join(pkg, 'dist');
mkdirSync(dist, { recursive: true });
const t0 = Date.now();
const page = resolve(pkg, '../page');
execFileSync(process.execPath, [join(page, 'scripts/build.mjs')], { stdio: 'ignore' });
const pageScript = {
  name: 'page-script',
  setup(b) {
    b.onResolve({ filter: /^mkp:page-script$/ }, () => ({ path: join(page, 'dist/page.js'), namespace: 'page-script' }));
    b.onLoad({ filter: /.*/, namespace: 'page-script' }, (a) => ({ contents: readFileSync(a.path, 'utf8'), loader: 'text' }));
  },
};
await build({
  entryPoints: [join(pkg, 'src/bin.ts')],
  bundle: true,
  platform: 'node',
  format: 'cjs',
  target: 'node20',
  outfile: join(dist, 'mkp.cjs'),
  alias: { '@mkp/core': resolve(pkg, '../core/src/index.ts'), '@mkp/page': resolve(page, 'src/index.ts'), '@mkp/react': resolve(pkg, '../react/src/index.tsx') },
  plugins: [pageScript],
  // --target fragment draws the document with @mkp/react on the server: React's production build
  jsx: 'automatic',
  // the version: MKP_VERSION when scripts/dist.mjs builds a release, else the repository's VERSION
  define: { __MKP_VERSION__: JSON.stringify(process.env.MKP_VERSION ?? readFileSync(resolve(pkg, '../../VERSION'), 'utf8').trim()), 'process.env.NODE_ENV': '"production"' },
  banner: { js: '#!/usr/bin/env node' },
  legalComments: 'none',
  logLevel: 'warning',
});
chmodSync(join(dist, 'mkp.cjs'), 0o755);
console.log(`dist/mkp.cjs: ${(statSync(join(dist, 'mkp.cjs')).size / 1e6).toFixed(2)} MB in ${Date.now() - t0} ms`);

if (process.argv.includes('--sea')) {
  const cfg = join(dist, 'sea-config.json');
  writeFileSync(cfg, JSON.stringify({ main: join(dist, 'mkp.cjs'), output: join(dist, 'sea-prep.blob'), disableExperimentalSEAWarning: true, useCodeCache: false }));
  execFileSync(process.execPath, ['--experimental-sea-config', cfg], { stdio: 'inherit' });
  const exe = join(dist, process.platform === 'win32' ? 'mkp.exe' : 'mkp');
  copyFileSync(process.execPath, exe);
  chmodSync(exe, 0o755);
  const postject = join(pkg, 'node_modules/.bin/postject');
  const args = [exe, 'NODE_SEA_BLOB', join(dist, 'sea-prep.blob'), '--sentinel-fuse', 'NODE_SEA_FUSE_fce680ab2cc467b6e072b8b5df1996b2'];
  if (process.platform === 'darwin') args.push('--macho-segment-name', 'NODE_SEA');
  execFileSync(postject, args, { stdio: 'inherit' });
  console.log(`dist/mkp: ${(statSync(exe).size / 1e6).toFixed(1)} MB single executable`);
}
