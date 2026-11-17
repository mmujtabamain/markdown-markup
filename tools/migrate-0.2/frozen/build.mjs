// Builds migrate-0.2.cjs, the frozen 0.2 → 0.3 step: entry.mjs with MKP 0.2.10's compiler (the 0.2
// tree's packages/core) and the migrator, in one file for Node 20 or later. It is built once, for
// MKP 0.3.0, and never again:
//
//   node frozen/build.mjs --root02 <the 0.2.10 tree> --commit <the commit it is>
//
// The tree is `git archive` of main at 0.2.10, installed (pnpm install). The bundler is the 0.2
// tree's own esbuild. migrate-0.2.lock records what went in and the file's SHA-256, which mkp
// checks before it runs the file.

import { createHash } from 'node:crypto';
import { createRequire } from 'node:module';
import { readFileSync, statSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const args = process.argv.slice(2);
const opt = (name) => {
  const i = args.indexOf(name);
  return i === -1 ? undefined : args[i + 1];
};
const root02 = opt('--root02');
const commit = opt('--commit');
if (!root02 || !commit) {
  console.error('usage: node frozen/build.mjs --root02 <the 0.2.10 tree> --commit <its commit>');
  process.exit(2);
}
const release = /RELEASE = '([^']+)'/.exec(readFileSync(join(root02, 'packages/core/src/version.ts'), 'utf8'))?.[1];
if (release !== '0.2.10') {
  console.error(`${root02} is MKP ${release}, not 0.2.10`);
  process.exit(1);
}
const require = createRequire(join(resolve(root02), 'packages/cli/package.json'));
const esbuild = require('esbuild');
const outfile = join(here, 'migrate-0.2.cjs');
await esbuild.build({
  entryPoints: [join(here, 'entry.mjs')],
  bundle: true,
  platform: 'node',
  format: 'cjs',
  target: 'node20',
  outfile,
  alias: { '@mkp/core': resolve(root02, 'packages/core/src/index.ts') },
  define: { __MKP_VERSION__: JSON.stringify(release) },
  minify: true,
  legalComments: 'none',
  logLevel: 'warning',
});
const bytes = readFileSync(outfile);
const sha256 = createHash('sha256').update(bytes).digest('hex');
writeFileSync(
  join(here, 'migrate-0.2.lock'),
  [
    '# The frozen 0.2 → 0.3 step, built once by frozen/build.mjs for MKP 0.3.0. mkp checks the file',
    '# against sha256 before it runs it.',
    `file = "migrate-0.2.cjs"`,
    `sha256 = "${sha256}"`,
    `mkp02 = "${release}"`,
    `mkp02_commit = "${commit}"`,
    `esbuild = "${esbuild.version}"`,
    '',
  ].join('\n'),
);
console.log(`migrate-0.2.cjs: ${(statSync(outfile).size / 1e6).toFixed(2)} MB, sha256 ${sha256}`);
