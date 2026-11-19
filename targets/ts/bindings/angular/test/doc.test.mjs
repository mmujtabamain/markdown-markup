import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import * as esbuild from "esbuild";
import { chromium } from "playwright-core";
import * as cli from "xtmd";
import { bundle, compilePages, docSteps, launch, open } from "../../testing/browser.mjs";

const irs = await compilePages(cli);
const decorators = { tsconfigRaw: { compilerOptions: { experimentalDecorators: true, useDefineForClassFields: false } } };

test("<xtmd-doc> on a server renders the page itself, through Angular's Renderer2", async () => {
  const r = await esbuild.build({ entryPoints: [fileURLToPath(new URL("./doc-server.ts", import.meta.url))], bundle: true, write: false, format: "esm", platform: "node", logLevel: "silent", ...decorators, banner: { js: "import { createRequire } from 'module'; const require = createRequire(import.meta.url);" } });
  // a file of its own: Angular's server build asks for `require`, which needs the module's path
  const dir = mkdtempSync(join(tmpdir(), "xtmd-angular-"));
  const file = join(dir, "doc-server.mjs");
  writeFileSync(file, r.outputFiles[0].text);
  const { render } = await import(pathToFileURL(file).href);
  const html = await render(irs.v1);
  assert.match(html, /<div[^>]*class="xtmd-root"/);
  assert.ok(html.includes("Count: 2 items"), html);
  assert.match(html, /data-part="press\.label"[^>]*>Add one</);
});

test("<xtmd-doc> in Chromium: controlled $state, refusals, props, snapshots", async () => {
  const js = await bundle(esbuild, fileURLToPath(new URL("./doc-app.ts", import.meta.url)), decorators);
  const browser = await launch(chromium);
  try {
    const { page, errors } = await open(browser, { js, irs });
    await docSteps(page);
    assert.deepEqual(errors, []);
  } finally {
    await browser.close();
  }
});
