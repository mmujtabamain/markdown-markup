import { test } from "node:test";
import assert from "node:assert/strict";
import { fileURLToPath } from "node:url";
import { createElement as h } from "react";
import { renderToString } from "react-dom/server";
import * as esbuild from "esbuild";
import { chromium } from "playwright-core";
import * as cli from "@mkp/cli";
import { MkpPage } from "@mkp/react";
import { bundle, compilePages, launch, open, steps } from "../../testing/browser.mjs";

const irs = await compilePages(cli);

test("on a server it renders the empty element, or the HTML it is given", () => {
  assert.equal(renderToString(h(MkpPage, { ir: irs.v1, className: "shop" })), '<div class="shop" data-mkp-page=""></div>');
  assert.equal(renderToString(h(MkpPage, { ir: irs.v1, html: "<h1>Count: 0 points</h1>" })), '<div data-mkp-page=""><h1>Count: 0 points</h1></div>');
});

test("in Chromium: mounts, follows its props, tells the app, unmounts", async () => {
  const js = await bundle(esbuild, fileURLToPath(new URL("./app.mjs", import.meta.url)));
  const browser = await launch(chromium);
  try {
    const { page, errors } = await open(browser, { js, irs });
    await steps(page);
    assert.deepEqual(errors, []);
  } finally {
    await browser.close();
  }
});
