import { test } from "node:test";
import assert from "node:assert/strict";
import { fileURLToPath } from "node:url";
import { createElement as h } from "react";
import { renderToString } from "react-dom/server";
import * as esbuild from "esbuild";
import { chromium } from "playwright-core";
import * as cli from "@mkp/cli";
import { MkpDoc } from "@mkp/react";
import { bundle, compilePages, docSteps, launch, open } from "../../testing/browser.mjs";

const irs = await compilePages(cli);

test("<MkpDoc> on a server renders the page itself, its widgets drawn by React", () => {
  const html = renderToString(h(MkpDoc, { ir: irs.v1, defaultState: { n: { num: "2" } }, externs: { app: { unit: { text: "items" } } } }));
  assert.match(html, /^<div class="mkp-root" data-mkp-root=""/);
  assert.match(html, /<style data-mkp-dom="">/);
  // React keeps adjacent text apart with empty comments
  assert.ok(html.replace(/<!-- -->/g, "").includes("Count: 2 items"), html);
  assert.match(html, /data-mkp-widget="core\/press"[^>]*>/);
  assert.match(html, /<span data-part="press\.label" class="mkp-press-label">Add one<\/span>/);
});

test("<MkpDoc> in Chromium: controlled $state, refusals, props, snapshots, in React's StrictMode", async () => {
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
