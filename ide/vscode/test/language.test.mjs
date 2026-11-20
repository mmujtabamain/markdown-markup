// Which language a file is read in: a pack in its own; a .xtmd code then prose with a @@@ line, prose all through without.

import { test } from "node:test";
import assert from "node:assert/strict";
import { build } from "esbuild";

const bundle = await build({ entryPoints: [new URL("../src/language.ts", import.meta.url).pathname], bundle: true, write: false, format: "esm", platform: "node" });
const { languageFor } = await import(`data:text/javascript,${encodeURIComponent(bundle.outputFiles[0].text)}`);

test("a document with @@@ is code then prose; one without, prose; a pack's file, code", () => {
  assert.equal(languageFor("a.xtmd", "let a: int = 1;\n@@@\n# Hi\n"), "xtmd");
  assert.equal(languageFor("a.xtmd", "# Hi\n\n@press(label = \"Go\");\n"), "xtmd-prose");
  assert.equal(languageFor("a.xtmd", "---\ntitle: x\n---\n# Hi\n"), "xtmd-prose");
  // only code, with no @@@: a document that draws nothing yet
  assert.equal(languageFor("a.xtmd", "// a note\nwidget w() {\n}\n"), "xtmd");
  assert.equal(languageFor("kit.xtmdpack", "# not prose\n"), "xtmd-pack");
});
