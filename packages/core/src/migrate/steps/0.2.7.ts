// 0.2.6 -> 0.2.7: a document's top-level widgets, fenced or :::, are numbered by place (meta.place),
// so a host can reserve each one's box in a first paint and mount() can draw it there. A bundle an
// older release built has no places: they are numbered here as the compiler numbers them. Nothing
// draws differently.

import type { Step } from '../index';
import type { Obj } from '../walk';

/** Body nodes that are Markdown, not a widget (blocks and containers are everything else at the top). */
const MARKDOWN = new Set(['paragraph', 'heading', 'list', 'quote', 'code', 'math', 'divider', 'table', 'footnote', 'controls', 'html']);

/** Numbers a bundle's top-level widgets by place, in order. */
function numberPlaces(roots: unknown[]): void {
  const visit = (v: unknown): void => {
    if (Array.isArray(v)) return v.forEach(visit);
    if (!v || typeof v !== 'object') return;
    const o = v as Obj;
    const doc = o.doc as Obj | undefined;
    if (doc && Array.isArray(doc.body)) {
      let place = 0;
      for (const n of doc.body as Obj[]) {
        const meta = (n.meta ?? {}) as Obj;
        if (typeof meta.block === 'number' || !MARKDOWN.has(String(n.node))) n.meta = { ...meta, place: place++ };
      }
    }
  };
  roots.forEach(visit);
}

export const step_0_2_7: Step = {
  from: '0.2.6',
  to: '0.2.7',
  summary: 'nothing to change: a document’s top-level widgets are numbered by place, for a first paint that reserves their boxes.',
  renames: [],
  removes: [],
  changes: [],
  ir(roots) {
    numberPlaces(roots);
  },
};
