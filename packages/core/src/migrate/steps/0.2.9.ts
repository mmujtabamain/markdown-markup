// 0.2.8 -> 0.2.9: nothing a document, pack or bundle holds changed meaning or look. A file moves up
// by its stamp alone. (minwidth, minheight and aspect are new words on a widget's use: a file from
// before has none. A widget's own input of one of those names keeps its meaning, and now also gives
// its size.)

import type { Step } from '../index';

export const step_0_2_9: Step = {
  from: '0.2.8',
  to: '0.2.9',
  summary: 'nothing to change: minwidth, minheight and aspect are new on a widget\'s use, and a first paint is sized by them instead of by heights a host kept.',
  renames: [],
  removes: [],
  changes: [],
  ir() {},
};
