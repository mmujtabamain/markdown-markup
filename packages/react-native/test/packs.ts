// Every pack in the workspace, read from disk like the core's own tests do (packs/* and the
// section-18 example), so packs and fixtures added later are picked up without changes here.
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import type { PackSource } from '@mkp/core';

export const ROOT = join(__dirname, '../../..');

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
  const packs = readdirSync(join(ROOT, 'packs'))
    .filter((n) => statSync(join(ROOT, 'packs', n)).isDirectory())
    .map((n) => folder(join(ROOT, 'packs', n)));
  const examples = readdirSync(join(ROOT, 'examples')).map((n) => folder(join(ROOT, 'examples', n)));
  return [...packs, ...examples];
}
