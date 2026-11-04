// Runs a TypeScript entry in Node by bundling it with esbuild (the workspace has no ts loader).
import { build } from 'esbuild';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

export async function runTs(entry, args = []) {
  const out = join(mkdtempSync(join(tmpdir(), 'mkp-run-')), 'entry.mjs');
  await build({ entryPoints: [resolve(entry)], bundle: true, platform: 'node', format: 'esm', target: 'node20', outfile: out, logLevel: 'warning', banner: { js: "import { createRequire as __cr } from 'module'; const require = __cr(import.meta.url);" } });
  process.argv = [process.argv[0], out, ...args];
  return import(pathToFileURL(out).href);
}
