import { test } from "node:test";
import assert from "node:assert/strict";
import { fileURLToPath } from "node:url";
import { createSSRApp, h } from "vue";
import { renderToString } from "vue/server-renderer";
import * as esbuild from "esbuild";
import { chromium } from "playwright-core";
import { MkpLiveDoc, compiler } from "@mkp/vue-live";
import { bundle, launch, liveSteps, openLive, pageSources } from "../../testing/browser.mjs";

const define = { __VUE_OPTIONS_API__: "true", __VUE_PROD_DEVTOOLS__: "false", __VUE_PROD_HYDRATION_MISMATCH_DETAILS__: "false" };

test("<MkpLiveDoc> on a server, given a compiler, compiles the text and renders the page", async () => {
  const c = await compiler();
  const html = await renderToString(createSSRApp({ render: () => h(MkpLiveDoc, { source: pageSources().v1, compiler: c, defaultState: { n: { num: "2" } }, externs: { app: { unit: { text: "items" } } } }) }));
  // Vue writes an empty attribute bare
  assert.match(html, /^<div class="mkp-root" data-mkp-root(="")? /);
  assert.ok(html.replace(/<!--[^>]*-->/g, "").includes("Count: 2 items"), html);
});

test("<MkpLiveDoc> in Chromium: compiled in the tab, edited, a broken draft kept back", async () => {
  const js = await bundle(esbuild, fileURLToPath(new URL("./live-app.mjs", import.meta.url)), { define });
  const browser = await launch(chromium);
  try {
    const { page, errors } = await openLive(browser, { js });
    await liveSteps(page);
    assert.deepEqual(errors, []);
  } finally {
    await browser.close();
  }
});
