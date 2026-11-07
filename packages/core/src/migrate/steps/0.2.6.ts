// 0.2.5 -> 0.2.6: nothing a document, pack or bundle holds changed meaning or look. A file moves up
// by its stamp alone. (Canvases size and redraw better, and a maths engine may arrive late: all in
// the renderers and the runtime.)

import type { Step } from '../index';

export const step_0_2_6: Step = {
  from: '0.2.5',
  to: '0.2.6',
  summary: 'nothing to change: canvases draw at their size from the first frame and only when they change, and a maths engine can arrive after the document.',
  renames: [],
  removes: [],
  changes: [],
  ir() {},
};
