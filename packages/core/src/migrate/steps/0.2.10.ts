// 0.2.9 -> 0.2.10: nothing a document, pack or bundle holds changed meaning or look. A file moves up
// by its stamp alone. (A widget with minheight and aspect no longer overflows a narrow column or
// spills its content; \val{} written in prose is warned of; segments() is new: all outside the files.)

import type { Step } from '../index';

export const step_0_2_10: Step = {
  from: '0.2.9',
  to: '0.2.10',
  summary: 'nothing to change: a widget with minheight and aspect fits its column and grows for its content, \\val{} in prose is warned of, and segments() splits a document.',
  renames: [],
  removes: [],
  changes: [],
  ir() {},
};
