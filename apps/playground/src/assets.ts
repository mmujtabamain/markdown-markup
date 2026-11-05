// Pictures a document names by a path beside it (`tide.svg`) are served by the site under another
// URL. The drawing gets a copy of the bundle with those paths swapped for their URLs; the IR the
// output pane shows keeps what the document wrote.

import type { IRBundle } from '@mkp/core';

const clean = (href: string): string => href.replace(/^\.\//, '');

export function assetUrl(assets: Record<string, string>, href: string): string | undefined {
  return assets[clean(href)];
}

function swap(s: string, assets: Record<string, string>, names: string[]): string {
  const exact = assets[clean(s)];
  if (exact) return exact;
  if (!s.includes('](')) return s;
  // Markdown images in text: ![alt](tide.svg) or ![alt](tide.svg "title")
  return s.replace(/\]\((\.\/)?([^)\s"]+)/g, (m, _dot: string | undefined, name: string) => (names.includes(name) ? `](${assets[name]}` : m));
}

export function withAssets(b: IRBundle, assets: Record<string, string>): IRBundle {
  const names = Object.keys(assets);
  if (!names.length) return b;
  const walk = (v: unknown): unknown => {
    if (typeof v === 'string') return swap(v, assets, names);
    if (Array.isArray(v)) return v.map(walk);
    if (v && typeof v === 'object') {
      const o: Record<string, unknown> = {};
      for (const [k, x] of Object.entries(v)) o[k] = k === 'svg' ? x : walk(x);
      return o;
    }
    return v;
  };
  return { ...b, doc: walk(b.doc) as IRBundle['doc'], defs: walk(b.defs) as IRBundle['defs'] };
}
