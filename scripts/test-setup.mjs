// Vitest's global setup: the CLI (packages/cli/dist/mkp.cjs) built once, before any test runs. The
// tests that spawn it share that one file; none rebuilds it while another may be running it (a
// half-written bundle runs as an empty program, and a test reads nothing on stderr).
import { execFileSync } from 'node:child_process';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

export default function setup() {
  const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
  execFileSync(process.execPath, [join(root, 'packages/cli/scripts/build.mjs')], { stdio: 'ignore', timeout: 180000 });
}
