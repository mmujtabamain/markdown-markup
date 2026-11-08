// 0.2.9 -> 0.2.10: a document's state block has a place now, as a widget has (meta.place on its
// controls), so a first paint reserves its controls' box and mount(el, bundle, { places: true }) draws
// them there. A bundle an older release built numbered widgets only: its places are numbered again
// here as the compiler numbers them, state blocks counted. Nothing draws differently. (A widget with
// minheight and aspect fitting its column, \val{} in prose warned of and segments() are outside the
// files.)

import type { Step } from '../index';
import type { Obj } from '../walk';

/** Body nodes that are prose, not a place (blocks, containers and state blocks' controls are the rest). */
const PROSE = new Set(['paragraph', 'heading', 'list', 'quote', 'code', 'math', 'divider', 'table', 'footnote', 'html']);

/** Numbers a bundle's top-level widgets and state blocks by place, in order. */
function numberPlaces(roots: unknown[]): void {
  const visit = (v: unknown): void => {
    if (Array.isArray(v)) return v.forEach(visit);
    if (!v || typeof v !== 'object') return;
    const doc = (v as Obj).doc as Obj | undefined;
    if (doc && Array.isArray(doc.body)) {
      let place = 0;
      for (const n of doc.body as Obj[]) {
        const meta = (n.meta ?? {}) as Obj;
        if (typeof meta.block === 'number' || !PROSE.has(String(n.node))) n.meta = { ...meta, place: place++ };
      }
    }
  };
  roots.forEach(visit);
}

export const step_0_2_10: Step = {
  from: '0.2.9',
  to: '0.2.10',
  summary: 'nothing to change: a state block has a place, as a widget has, so a first paint reserves its controls\' box; places are numbered again with it counted.',
  renames: [],
  removes: [],
  changes: [],
  ir(roots) {
    numberPlaces(roots);
  },
};
