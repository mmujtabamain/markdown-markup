// 0.2.2 -> 0.2.3: nothing a document, pack or bundle holds changed meaning or look. A file moves up
// by its stamp alone. (Packs gained migrate blocks across widgets, and renderers a host's icons:
// both are additions.)

import type { Step } from '../index';

export const step_0_2_3: Step = {
  from: '0.2.2',
  to: '0.2.3',
  summary: 'nothing to change: migrate blocks that move uses to another widget, and a host’s icons, are additions.',
  renames: [],
  removes: [],
  changes: [],
  ir() {},
};
