// The test target's defects: MKP_TEST_DEFECT switches one on, and `mkp target check test
// --defect <name> --expect-failures` passes only when some check catches it.

/** The defects a run can switch on, by name: each is caught by at least one check. */
export const DEFECTS = {
  "no-redraw": "the page isn't drawn again after a change, so it keeps showing the old values",
  "no-undo": "a handler that fails keeps what it changed before failing",
  "unchecked-writes": "a widget's write through a mut input isn't checked against the caller's variable",
  "unchecked-app-writes": "an app's write to $state isn't checked against $state's rules",
  "lost-calls": "the app's extern fns run without being reported to the app",
  "rows-by-position": "a loop's rows keep their widgets' variables by position, not by item",
  "no-notice": "a widget that fails leaves nothing in its place instead of a notice",
  "unescaped-markdown": "text is written into the Markdown as it is, so its Markdown characters change the page",
  "ignores-page": "the app's page values (width, theme) are never passed on",
  "boxes-in-pixels": "a spot's box is reported in screen pixels, so it changes on every zoom",
  "boxes-follow-the-view": "a spot's box is measured from the view, so it is written again on every pan",
};
