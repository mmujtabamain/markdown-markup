// 0.2.7 -> 0.2.8: nothing a document, pack or bundle holds changed meaning or look. A file moves up
// by its stamp alone. (A pack's externs hand their host more: record lists, each record's content,
// other slots and the summary; and the Markdown target writes them: all in the runtime and renderers.)

import type { Step } from '../index';

export const step_0_2_8: Step = {
  from: '0.2.7',
  to: '0.2.8',
  summary: "nothing to change: a pack's externs hand their host their record lists, each record's content, their other slots and their summary, and are written in Markdown.",
  renames: [],
  removes: [],
  changes: [],
  ir() {},
};
