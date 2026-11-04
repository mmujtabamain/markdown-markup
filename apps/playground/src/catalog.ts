/// <reference types="vite/client" />
// Every pack folder and example in the repository, read at build time by Vite.

const raw = import.meta.glob(['../../../packs/**/*.{mkp,json,md}', '../../../examples/**/*.{mkp,json,md}'], { query: '?raw', import: 'default', eager: true }) as Record<string, string>;

export interface PackFolder {
  label: string;
  files: Map<string, Uint8Array>;
}

const enc = new TextEncoder();

export function packFolders(): PackFolder[] {
  const byPack = new Map<string, Map<string, Uint8Array>>();
  for (const [path, text] of Object.entries(raw)) {
    const m = /\.\.\/\.\.\/\.\.\/((?:packs|examples)\/[^/]+)\/(.+)$/.exec(path);
    if (!m) continue;
    const files = byPack.get(m[1]) ?? new Map<string, Uint8Array>();
    files.set(m[2], enc.encode(text));
    byPack.set(m[1], files);
  }
  return [...byPack.entries()].sort(([a], [b]) => (a < b ? -1 : 1)).map(([label, files]) => ({ label, files }));
}
