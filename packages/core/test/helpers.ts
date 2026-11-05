import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { PackSource } from '../src/build';

const here = new URL('../../../', import.meta.url);
// under jsdom import.meta.url is not a file: URL; tests run from the workspace root
export const ROOT = here.protocol === 'file:' ? fileURLToPath(here) : process.cwd() + '/';

export function folder(dir: string): PackSource {
  const files = new Map<string, Uint8Array>();
  const walk = (d: string): void => {
    for (const n of readdirSync(d)) {
      const p = join(d, n);
      if (statSync(p).isDirectory()) walk(p);
      else files.set(relative(dir, p).split('\\').join('/'), new Uint8Array(readFileSync(p)));
    }
  };
  walk(dir);
  return { files, label: relative(ROOT, dir) };
}

/** The test-only packs under conformance/packs: MKP ships no packs of its own. */
export function testPacks(): PackSource[] {
  const dir = join(ROOT, 'conformance', 'packs');
  try {
    return readdirSync(dir).filter((n) => statSync(join(dir, n)).isDirectory()).map((n) => folder(join(dir, n)));
  } catch {
    return [];
  }
}

/** @deprecated the packs are gone; kept for tests not yet moved to examples and test packs */
export const allPacks = testPacks;
