// Monaco, as little of it as the playground uses: the editor API, no languages but Extended Mark's, and the
// handful of editor features a source editor wants. Its web worker is a separate bundle,
// dist/editor.worker.js (build.mjs), found through MonacoEnvironment.getWorkerUrl.

import * as monaco from "monaco-editor/editor/editor.api.js";
// the editor's icons (the find widget's) and the few features it is built with: matching
// brackets, Ctrl+F, Ctrl+/ for a comment, moving and copying lines, and moving by words. The API
// alone is ~2.6 MB minified; hovers (+346 KB, with a Markdown renderer) and Ctrl+D's cursors
// (+98 KB) are left out, as are suggestions, folding and links: a problem's message is the
// editor's tooltip (editor.ts) and the Diagnostics tab's.
import "monaco-editor/features/codicon/register.js";
import "monaco-editor/features/bracketMatching/register.js";
import "monaco-editor/features/comment/register.js";
import "monaco-editor/features/find/register.js";
import "monaco-editor/features/linesOperations/register.js";
import "monaco-editor/features/wordOperations/register.js";

// the worker, bundled beside app.js (Monaco's typings declare MonacoEnvironment globally)
globalThis.MonacoEnvironment = {
  getWorkerUrl: () => new URL("editor.worker.js", document.baseURI).toString(),
};

export { monaco };
