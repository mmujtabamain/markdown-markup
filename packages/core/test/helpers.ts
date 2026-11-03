import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { PackSource } from '../src/build';

export const ROOT = fileURLToPath(new URL('../../../', import.meta.url));

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

export function allPacks(): PackSource[] {
  const packs = readdirSync(join(ROOT, 'packs')).map((n) => folder(join(ROOT, 'packs', n)));
  return [...packs, folder(join(ROOT, 'examples/spec18'))];
}
