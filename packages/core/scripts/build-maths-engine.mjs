// Builds packages/core/vendor/maths-engine.{js,cjs}: one self-contained file that runs the same way
// in Node, browsers, React Native and the Hermes CLI. Run by the workspace's postinstall.
import { build } from 'esbuild';
import { createRequire } from 'node:module';
import { mkdirSync, statSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const core = resolve(here, '..');
const require = createRequire(resolve(core, 'package.json'));
const shim = resolve(here, 'sre-system-external.cjs');
const sreShim = {
  name: 'sre-system-external',
  setup(b) {
    b.onResolve({ filter: /system_external(\.js)?$/ }, (args) =>
      args.importer.includes('speech-rule-engine') ? { path: shim } : undefined,
    );
  },
};
mkdirSync(resolve(core, 'vendor'), { recursive: true });
const common = {
  entryPoints: [resolve(here, 'maths-engine-entry.cjs')],
  bundle: true,
  platform: 'neutral',
  mainFields: ['main', 'module'],
  loader: { '.json': 'text' },
  plugins: [sreShim],
  nodePaths: [resolve(core, 'node_modules')],
  define: { 'process.env.NODE_ENV': '"production"', global: 'globalThis' },
  target: 'es2018',
  minify: true,
  legalComments: 'none',
  logLevel: 'warning',
  absWorkingDir: core,
};
void require;
const t0 = Date.now();
await build({ ...common, format: 'cjs', outfile: resolve(core, 'vendor/maths-engine.cjs') });
await build({ ...common, format: 'esm', outfile: resolve(core, 'vendor/maths-engine.js') });
const size = statSync(resolve(core, 'vendor/maths-engine.js')).size;
console.log(`maths engine built in ${Date.now() - t0} ms (${(size / 1e6).toFixed(2)} MB)`);
