import { test } from "node:test";
import assert from "node:assert/strict";
import { fileURLToPath } from "node:url";
import { createElement as h } from "react";
import { renderToString } from "react-dom/server";
import * as esbuild from "esbuild";
import { chromium } from "playwright-core";
import { MkpLiveDoc, compiler } from "@mkp/react-live";
import { bundle, launch, liveSteps, openLive, pageSources } from "../../testing/browser.mjs";

test("<MkpLiveDoc> on a server, given a compiler, compiles the text and renders the page", async () => {
  const html = renderToString(h(MkpLiveDoc, { source: pageSources().v1, compiler: await compiler(), defaultState: { n: { num: "2" } }, externs: { app: { unit: { text: "items" } } } }));
  assert.match(html, /^<div class="mkp-root" data-mkp-root=""/);
  assert.ok(html.replace(/<!-- -->/g, "").includes("Count: 2 items"), html);
});

test("<MkpLiveDoc> in Chromium: compiled in the tab, edited, a broken draft kept back, in StrictMode", async () => {
  const js = await bundle(esbuild, fileURLToPath(new URL("./live-app.mjs", import.meta.url)));
  const browser = await launch(chromium);
  try {
    const { page, errors } = await openLive(browser, { js });
    await liveSteps(page);
    assert.deepEqual(errors, []);
  } finally {
    await browser.close();
  }
});
