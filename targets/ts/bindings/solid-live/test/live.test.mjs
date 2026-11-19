import { test } from "node:test";
import assert from "node:assert/strict";
import { fileURLToPath } from "node:url";
import * as esbuild from "esbuild";
import { chromium } from "playwright-core";
import { bundle, launch, liveSteps, openLive, pageSources } from "../../testing/browser.mjs";

test("<XtmdLiveDoc> on a server, given a compiler, compiles the text and renders the page", async () => {
  // Node gives Solid's server build
  const { renderToString, createComponent } = await import("solid-js/web");
  const { XtmdLiveDoc, compiler } = await import("@extended-mark/solid-live");
  const c = await compiler();
  const html = renderToString(() => createComponent(XtmdLiveDoc, { source: pageSources().v1, compiler: c, defaultState: { n: { num: "2" } }, externs: { app: { unit: { text: "items" } } } }));
  // Solid keeps a space after a class it sets
  assert.match(html, /^<div[^>]* class="xtmd-root ?"/);
  assert.ok(html.replace(/<!--[^>]*-->/g, "").includes("Count: 2 items"), html);
});

test("<XtmdLiveDoc> in Chromium: compiled in the tab, edited, a broken draft kept back", async () => {
  const js = await bundle(esbuild, fileURLToPath(new URL("./live-app.mjs", import.meta.url)), { conditions: ["browser"] });
  const browser = await launch(chromium);
  try {
    const { page, errors } = await openLive(browser, { js });
    await liveSteps(page);
    assert.deepEqual(errors, []);
  } finally {
    await browser.close();
  }
});
