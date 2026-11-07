// 0.2.4 -> 0.2.5: nothing a document, pack or bundle holds changed meaning or look. A file moves up
// by its stamp alone, and keeps its own text (mkp migrate now leaves a file the steps don't change
// as its author wrote it).

import type { Step } from '../index';

export const step_0_2_5: Step = {
  from: '0.2.4',
  to: '0.2.5',
  summary: 'nothing to change: mkp migrate now keeps a file’s own text when the steps change nothing in it.',
  renames: [],
  removes: [],
  changes: [],
  ir() {},
};
