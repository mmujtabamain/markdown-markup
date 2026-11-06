// Builds dist/page.js: the page script of mkp build --target html (src/page.tsx), one minified
// script with React, @mkp/react, the core and the maths engine in it, for inlining into a page.
import { build } from 'esbuild';
import { mkdirSync, statSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const pkg = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const out = join(pkg, 'dist/page.js');
mkdirSync(dirname(out), { recursive: true });
const t0 = Date.now();
await build({
  entryPoints: [join(pkg, 'src/page.tsx')],
  bundle: true,
  format: 'iife',
  platform: 'browser',
  target: 'es2022',
  jsx: 'automatic',
  minify: true,
  outfile: out,
  alias: {
    '@mkp/core': resolve(pkg, '../core/src/index.ts'),
    '@mkp/react': resolve(pkg, '../react/src/index.tsx'),
  },
  define: { 'process.env.NODE_ENV': '"production"' },
  legalComments: 'none',
  logLevel: 'warning',
});
console.log(`dist/page.js: ${(statSync(out).size / 1e6).toFixed(2)} MB in ${Date.now() - t0} ms`);
