// mkp-outline: a document's first paint before any of MKP has loaded, made in the page from the
// document's source alone. Each top-level widget gets a quiet placeholder of the size it says it is
// at least (minwidth, minheight, aspect: written on it, or its widget's defaults), so when MKP draws
// the widgets into them (mount(el, bundle, { places: true })) nothing outside their boxes moves.
// Like an HTML img tag's width and height: given, nothing moves; left out, it may move once.
//
//   el.innerHTML = outline(source, { sizes: SIZES, prose: (md) => myMarkdown(md) });  // SIZES: sizeDefaults(compiled packs), once
//   mount(el, bundle, { places: true });
//
// No compiler and no React: it finds the widgets with the compiler's own document splitter.

import { Diagnostics } from '../../core/src/diag';
import { parseDoc, type DocItem } from '../../core/src/syntax/doc';
import { mergeSize, SIZE_KEYS, sizeOf, sizeStyle, type WidgetSize } from '../../core/src/size';

// a document in its pieces, for a host that draws or caches them one by one
export { segments, type Segment } from '../../core/src/syntax/segments';

/** A top-level widget of a document, fenced or ::: , in source order, with the sizes written on it. */
export interface Place {
  place: number;
  name: string;
  line: number;
  /** minwidth, minheight and aspect as written on it (YAML, the ::: line, or {…} under it) */
  size: WidgetSize;
}

const bare = (name: string): string => name.replace(/^.*:/, '').replace(/@\d+$/, '');

/** The sizes written on a block or container, read as the compiler reads them. */
function written(it: Extract<DocItem, { k: 'block' | 'container' }>): WidgetSize {
  const raw: Record<string, string> = {};
  if (it.k === 'block')
    for (const k of SIZE_KEYS) {
      const m = new RegExp(`^${k}:[ \\t]*(.+?)[ \\t]*$`, 'm').exec(it.yaml);
      if (m) raw[k] = m[1].replace(/\s+#.*$/, '');
    }
  else for (const m of it.args.matchAll(/(?:^|\s)(minwidth|minheight|aspect)=("[^"]*"|\([^)]*\)|\S+)/g)) raw[m[1]] = m[2];
  for (const [k, v] of Object.entries(it.attrs?.props ?? {})) raw[k] = v;
  const out: WidgetSize = {};
  for (const k of SIZE_KEYS) {
    const n = raw[k] === undefined ? undefined : sizeOf(k, raw[k]);
    if (n !== undefined) out[k] = n;
  }
  return out;
}

/** A state block's controls, one row each (a var has none). */
const controlRows = (body: string): number => body.split('\n').filter((l) => /^\s*[A-Za-z_][A-Za-z0-9_]*\s+(?:=|[a-z(])/.test(l) && !/^\s*var\s/.test(l)).length;

/** A place's box for a state block: its controls' rows, as MKP's default look draws them (measured in Chromium). */
const stateSize = (body: string): WidgetSize => ({ minheight: Math.max(1, controlRows(body)) * (CONTROL_ROW + CONTROL_GAP) - CONTROL_GAP });

/** How tall one control's row is drawn (a slider, a toggle or a choice with its label), and the gap between rows, in px. */
const CONTROL_ROW = 21;
const CONTROL_GAP = 11;

/** The document's top-level widgets and state blocks, numbered as the compiler numbers them (meta.place). */
export function places(source: string): Place[] {
  const doc = parseDoc(source, 'doc.mkp.md', new Diagnostics());
  return doc.items
    .filter((it): it is Extract<typeof it, { k: 'block' | 'container' | 'state' }> => it.k === 'block' || it.k === 'container' || it.k === 'state')
    .map((it, place) => (it.k === 'state' ? { place, name: 'state', line: it.line, size: stateSize(it.body) } : { place, name: bare(it.name), line: it.line, size: written(it) }));
}

/**
 * A widget's placeholder: an empty box, nothing a screen reader reads, at the size the widget will be
 * drawn at least (its own sizes, with `defaults`, its widget's, filling in), or DEFAULT_HEIGHT high
 * when it says no height.
 */
export function placeholder(p: Place, defaults?: WidgetSize, className = ''): string {
  const css = sizeStyle(mergeSize(p.size, defaults));
  const style = [css.minWidth && `min-width:${css.minWidth}`, css.minHeight && `min-height:${css.minHeight}`, css.aspectRatio && `aspect-ratio:${css.aspectRatio}`, css.maxWidth && `max-width:${css.maxWidth}`, !css.minHeight && !css.aspectRatio && `height:${DEFAULT_HEIGHT}px`].filter(Boolean);
  return `<div class="mkp-outline-place${className ? ` ${className}` : ''}" data-mkp-place="${p.place}" data-mkp-place-name="${p.name}" aria-hidden="true" style="${style.join(';')}"></div>`;
}

/** The height of a widget that says no height: it may move this once, when it is drawn. */
export const DEFAULT_HEIGHT = 160;

export interface OutlineOptions {
  /** each widget's own sizes, by name (sizeDefaults() of the host's packs, made once) */
  sizes?: Record<string, WidgetSize>;
  /** draws the Markdown between the widgets (the host's renderer); left out without it */
  prose?: (markdown: string) => string;
  /** a class for every placeholder, for a host's own loading look */
  className?: string;
}

/**
 * The document's first paint: its prose (drawn by `prose`, when given) and a placeholder for each
 * top-level widget, at the size it is at least, in a container marked busy until mount() draws them.
 */
export function outline(source: string, opts: OutlineOptions = {}): string {
  const doc = parseDoc(source, 'doc.mkp.md', new Diagnostics());
  const parts: string[] = [];
  let place = 0;
  for (const it of doc.items) {
    if (it.k === 'block' || it.k === 'container') {
      const p: Place = { place: place++, name: bare(it.name), line: it.line, size: written(it) };
      parts.push(placeholder(p, opts.sizes?.[p.name], opts.className));
    } else if (it.k === 'state') {
      parts.push(placeholder({ place: place++, name: 'state', line: it.line, size: stateSize(it.body) }, undefined, opts.className));
    } else if (it.k === 'md' && opts.prose) parts.push(opts.prose(it.text));
  }
  return `<div class="mkp-outline" aria-busy="true">${parts.join('\n')}</div>`;
}
