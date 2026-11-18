import { test } from "node:test";
import assert from "node:assert/strict";
import { fileURLToPath } from "node:url";
import * as esbuild from "esbuild";
import { chromium } from "playwright-core";
import * as cli from "@mkp/cli";
import { bundle, compilePages, docSteps, launch, open } from "../../testing/browser.mjs";

const irs = await compilePages(cli);

test("<MkpDoc> on a server renders the page itself, its widgets drawn by Solid", async () => {
  // Node resolves solid-js to its server build, as Solid's SSR does
  const { renderToString, createComponent } = await import("solid-js/web");
  const { MkpDoc } = await import("@mkp/solid");
  const html = renderToString(() => createComponent(MkpDoc, { ir: irs.v1, defaultState: { n: { num: "2" } }, externs: { app: { unit: { text: "items" } } } }));
  // Solid keeps a space after a class it sets
  assert.match(html, /^<div[^>]* class="mkp-root ?"/);
  assert.match(html, /<style[^>]*>/);
  assert.ok(html.replace(/<!--[^>]*-->/g, "").includes("Count: 2 items"), html);
  assert.match(html, /data-part="press\.label"[^>]*>Add one</);
});

test("<MkpDoc> in Chromium: controlled $state, refusals, props, snapshots", async () => {
  const js = await bundle(esbuild, fileURLToPath(new URL("./doc-app.mjs", import.meta.url)), { conditions: ["browser"] });
  const browser = await launch(chromium);
  try {
    const { page, errors } = await open(browser, { js, irs });
    await docSteps(page);
    assert.deepEqual(errors, []);
  } finally {
    await browser.close();
  }
});
