// A document in its pieces, in source order: its prose, each top-level widget (fenced or :::, with its
// place), and what the widgets may need from around them (front matter, the document's own definitions,
// shared state). Each piece is its source lines as written, so they put back together give the document.

import { Diagnostics } from '../diag';
import { parseDoc } from './doc';

export type Segment =
  | { kind: 'prose'; text: string; lines: [number, number] }
  /** a top-level widget: its place (meta.place, data-mkp-place), its name (no pack, no version) */
  | { kind: 'widget'; place: number; name: string; text: string; lines: [number, number] }
  /** what a widget's text may need to compile on its own: front matter, an mkp fence, a state block */
  | { kind: 'front' | 'defs' | 'state'; text: string; lines: [number, number] };

/** The document's pieces in order. lines are 1-based and inclusive; blank lines around pieces belong to none. */
export function segments(source: string): Segment[] {
  const doc = parseDoc(source, 'doc.mkp.md', new Diagnostics());
  const lines = source.replace(/\r\n?/g, '\n').split('\n');
  const out: Segment[] = [];
  const text = (a: number, b: number): string => lines.slice(a - 1, b).join('\n');
  if (doc.front !== null) {
    const close = lines.findIndex((l, i) => i > 0 && (l === '---' || l === '...'));
    out.push({ kind: 'front', text: text(1, close + 1), lines: [1, close + 1] });
  }
  let place = 0;
  doc.items.forEach((it, i) => {
    // to the line before the next piece, blank lines at its end left out
    let start = it.line;
    let end = (doc.items[i + 1]?.line ?? lines.length + 1) - 1;
    while (start < end && !lines[start - 1]?.trim()) start++;
    while (end > start && !lines[end - 1]?.trim()) end--;
    const at: [number, number] = [start, end];
    if (it.k === 'block' || it.k === 'container') out.push({ kind: 'widget', place: place++, name: it.name.replace(/^.*:/, '').replace(/@\d+$/, ''), text: text(...at), lines: at });
    else out.push({ kind: it.k === 'md' ? 'prose' : it.k, text: text(...at), lines: at });
  });
  return out;
}
