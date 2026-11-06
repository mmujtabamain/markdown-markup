// Pictures a document names by a path beside it (`tide.svg`) are served under another URL: by a site
// (the playground), or as data: URLs inside a standalone page (mkp build --target html). The drawing
// gets a copy of the bundle with those paths swapped; the IR itself keeps what the document wrote.

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

/** The paths a bundle names that could be pictures beside its document: plain values (`plan.svg`)
 * and Markdown images in text (`![alt](tide.svg)`). */
export function pictureNames(b: IRBundle): string[] {
  const out = new Set<string>();
  const pic = /^(?!\w+:)(?!\/)[^\s"'()<>]+\.(svg|png|jpe?g|gif|webp|avif)$/i;
  const walk = (v: unknown): void => {
    if (typeof v === 'string') {
      if (pic.test(v)) out.add(clean(v));
      for (const m of v.matchAll(/\]\((\.\/)?([^)\s"]+)/g)) if (pic.test(m[2])) out.add(m[2]);
    } else if (Array.isArray(v)) v.forEach(walk);
    else if (v && typeof v === 'object') for (const [k, x] of Object.entries(v)) if (k !== 'svg') walk(x);
  };
  walk(b.doc);
  walk(b.defs);
  return [...out];
}
