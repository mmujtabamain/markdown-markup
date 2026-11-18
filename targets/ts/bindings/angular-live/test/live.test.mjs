import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import * as esbuild from "esbuild";
import { chromium } from "playwright-core";
import { compiler } from "@mkp/live";
import { bundle, launch, liveSteps, openLive, pageSources } from "../../testing/browser.mjs";

const decorators = { tsconfigRaw: { compilerOptions: { experimentalDecorators: true, useDefineForClassFields: false } } };

test("<mkp-live-doc> on a server, given a compiler, compiles the text and renders the page", async () => {
  const r = await esbuild.build({ entryPoints: [fileURLToPath(new URL("./live-server.ts", import.meta.url))], bundle: true, write: false, format: "esm", platform: "node", logLevel: "silent", ...decorators, banner: { js: "import { createRequire } from 'module'; const require = createRequire(import.meta.url);" } });
  // a file of its own: Angular's server build asks for `require`, which needs the module's path
  const file = join(mkdtempSync(join(tmpdir(), "mkp-angular-live-")), "live-server.mjs");
  writeFileSync(file, r.outputFiles[0].text);
  const { render } = await import(pathToFileURL(file).href);
  const html = await render(pageSources().v1, await compiler());
  assert.match(html, /<div[^>]*class="mkp-root"/);
  assert.ok(html.includes("Count: 2 items"), html);
});

test("<mkp-live-doc> in Chromium: compiled in the tab, edited, a broken draft kept back", async () => {
  const js = await bundle(esbuild, fileURLToPath(new URL("./live-app.ts", import.meta.url)), decorators);
  const browser = await launch(chromium);
  try {
    const { page, errors } = await openLive(browser, { js });
    await liveSteps(page);
    assert.deepEqual(errors, []);
  } finally {
    await browser.close();
  }
});
