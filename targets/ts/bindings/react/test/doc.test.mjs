import { test } from "node:test";
import assert from "node:assert/strict";
import { fileURLToPath } from "node:url";
import { createElement as h } from "react";
import { renderToString } from "react-dom/server";
import * as esbuild from "esbuild";
import { chromium } from "playwright-core";
import * as cli from "xtmd";
import { XtmdDoc } from "@extended-mark/react";
import { bundle, compilePages, docSteps, launch, open } from "../../testing/browser.mjs";

const irs = await compilePages(cli);

test("<XtmdDoc> on a server renders the page itself, its widgets drawn by React", () => {
  const html = renderToString(h(XtmdDoc, { ir: irs.v1, defaultState: { n: { num: "2" } }, externs: { app: { unit: { text: "items" } } } }));
  assert.match(html, /^<div class="xtmd-root" data-xtmd-root=""/);
  assert.match(html, /<style data-xtmd-dom="">/);
  // React keeps adjacent text apart with empty comments
  assert.ok(html.replace(/<!-- -->/g, "").includes("Count: 2 items"), html);
  assert.match(html, /data-xtmd-widget="core\/press"[^>]*>/);
  assert.match(html, /<span data-part="press\.label" class="xtmd-press-label">Add one<\/span>/);
});

test("<XtmdDoc> in Chromium: controlled $state, refusals, props, snapshots, in React's StrictMode", async () => {
  const js = await bundle(esbuild, fileURLToPath(new URL("./doc-app.mjs", import.meta.url)));
  const browser = await launch(chromium);
  try {
    const { page, errors } = await open(browser, { js, irs });
    await docSteps(page);
    assert.deepEqual(errors, []);
  } finally {
    await browser.close();
  }
});
