import { test } from "node:test";
import assert from "node:assert/strict";
import { fileURLToPath } from "node:url";
import { createSSRApp, h } from "vue";
import { renderToString } from "vue/server-renderer";
import * as esbuild from "esbuild";
import { chromium } from "playwright-core";
import * as cli from "@mkp/cli";
import { MkpPage } from "@mkp/vue";
import { bundle, compilePages, launch, open, steps } from "../../testing/browser.mjs";

const irs = await compilePages(cli);

test("on a server it renders the empty element, or the HTML it is given", async () => {
  assert.equal(await renderToString(createSSRApp({ render: () => h(MkpPage, { ir: irs.v1 }) })), '<div data-mkp-page></div>');
  assert.equal(await renderToString(createSSRApp({ render: () => h(MkpPage, { ir: irs.v1, html: "<h1>Count: 0</h1>" }) })), '<div data-mkp-page><h1>Count: 0</h1></div>');
});

test("in Chromium: mounts, follows its props, tells the app, unmounts", async () => {
  const js = await bundle(esbuild, fileURLToPath(new URL("./app.mjs", import.meta.url)), {
    define: { __VUE_OPTIONS_API__: "true", __VUE_PROD_DEVTOOLS__: "false", __VUE_PROD_HYDRATION_MISMATCH_DETAILS__: "false" },
  });
  const browser = await launch(chromium);
  try {
    const { page, errors } = await open(browser, { js, irs });
    await steps(page);
    assert.deepEqual(errors, []);
  } finally {
    await browser.close();
  }
});
