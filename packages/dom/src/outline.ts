// mkp-outline: a document's first paint before any of MKP has loaded, made in the page from the
// document's source alone. Each top-level widget gets a quiet placeholder of the height it was last
// drawn at (sizes that mount() measured and the host kept with the document), so when MKP draws the
// widgets into them (mount(el, bundle, { places: true })) nothing outside their boxes moves.
//
//   const sizes = saved[docId];                                     // what onSizes reported before
//   el.innerHTML = outline(source, sizes, { width: el.clientWidth, prose: (md) => myMarkdown(md) });
//   mount(el, bundle, { places: true, onSizes: (s) => save(docId, mergeSizes(sizes, s)) });
//
// No compiler and no React: it finds the widgets with the compiler's own document splitter.

import { Diagnostics } from '../../core/src/diag';
import { parseDoc } from '../../core/src/syntax/doc';

/** A top-level widget's measured height at the widths it was drawn at: [width, height] pairs. */
export interface PlaceSize {
  place: number;
  /** its widget's name (no pack, no version), so a size is never used for another widget */
  name: string;
  at: [number, number][];
}

/** A top-level widget of a document, fenced or ::: , in source order. */
export interface Place {
  place: number;
  name: string;
  line: number;
}

const bare = (name: string): string => name.replace(/^.*:/, '').replace(/@\d+$/, '');

/** The document's top-level widgets, numbered as the compiler numbers them (meta.place). */
export function places(source: string): Place[] {
  const doc = parseDoc(source, 'doc.mkp.md', new Diagnostics());
  return doc.items
    .filter((it): it is Extract<typeof it, { k: 'block' | 'container' }> => it.k === 'block' || it.k === 'container')
    .map((it, place) => ({ place, name: bare(it.name), line: it.line }));
}

/** The height a widget will have at `width`: from the widths it was drawn at, in between taken
 *  along a line, outside taken from the nearest. Undefined when it has never been drawn. */
export function heightAt(size: PlaceSize | undefined, width: number): number | undefined {
  const at = [...(size?.at ?? [])].sort((a, b) => a[0] - b[0]);
  if (!at.length) return undefined;
  if (width <= at[0][0]) return at[0][1];
  if (width >= at[at.length - 1][0]) return at[at.length - 1][1];
  for (let i = 1; i < at.length; i++) {
    const [w0, h0] = at[i - 1];
    const [w1, h1] = at[i];
    if (width <= w1) return Math.round(h0 + ((h1 - h0) * (width - w0)) / (w1 - w0 || 1));
  }
  return at[at.length - 1][1];
}

/** Sizes measured now merged into those kept: per widget, a width drawn again replaces the old one
 *  (within 8 px), and the four most recent widths are kept. */
export function mergeSizes(kept: PlaceSize[] | undefined, fresh: PlaceSize[]): PlaceSize[] {
  const out = new Map<string, PlaceSize>();
  for (const s of kept ?? []) out.set(`${s.place}:${s.name}`, { ...s, at: [...s.at] });
  for (const s of fresh) {
    const k = `${s.place}:${s.name}`;
    const was = out.get(k)?.at ?? [];
    const at = [...was.filter(([w]) => !s.at.some(([w2]) => Math.abs(w2 - w) < 8)), ...s.at].slice(-4);
    out.set(k, { place: s.place, name: s.name, at });
  }
  return [...out.values()].sort((a, b) => a.place - b.place);
}

/** A widget's placeholder: an empty box, nothing a screen reader reads, of its last height. */
export function placeholder(p: Place, height: number | undefined, className = ''): string {
  const h = height ?? DEFAULT_HEIGHT;
  return `<div class="mkp-outline-place${className ? ` ${className}` : ''}" data-mkp-place="${p.place}" data-mkp-place-name="${p.name}" aria-hidden="true" style="height:${h}px"></div>`;
}

/** The height of a widget never drawn yet: it may move this once, and is measured for next time. */
export const DEFAULT_HEIGHT = 160;

export interface OutlineOptions {
  /** the width of the element it goes in, for the heights */
  width: number;
  /** draws the Markdown between the widgets (the host's renderer); left out without it */
  prose?: (markdown: string) => string;
  /** a class for every placeholder, for a host's own loading look */
  className?: string;
}

/**
 * The document's first paint: its prose (drawn by `prose`, when given) and a placeholder for each
 * top-level widget, sized from `sizes`, in a container marked busy until mount() draws them.
 */
export function outline(source: string, sizes: PlaceSize[] | undefined, opts: OutlineOptions): string {
  const doc = parseDoc(source, 'doc.mkp.md', new Diagnostics());
  const parts: string[] = [];
  let place = 0;
  for (const it of doc.items) {
    if (it.k === 'block' || it.k === 'container') {
      const p = { place, name: bare(it.name), line: it.line };
      const size = sizes?.find((s) => s.place === place && s.name === p.name);
      parts.push(placeholder(p, heightAt(size, opts.width), opts.className));
      place++;
    } else if (it.k === 'md' && opts.prose) parts.push(opts.prose(it.text));
  }
  return `<div class="mkp-outline" aria-busy="true">${parts.join('\n')}</div>`;
}
