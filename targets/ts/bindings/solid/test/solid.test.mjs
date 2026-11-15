import { test } from "node:test";
import assert from "node:assert/strict";
import { fileURLToPath } from "node:url";
import * as esbuild from "esbuild";
import { chromium } from "playwright-core";
import * as cli from "@mkp/cli";
import { bundle, compilePages, launch, open, steps } from "../../testing/browser.mjs";

const irs = await compilePages(cli);

test("on a server it renders the empty element", async () => {
  // Node resolves solid-js to its server build, as Solid's SSR does
  const { renderToString, createComponent } = await import("solid-js/web");
  const { MkpPage } = await import("@mkp/solid");
  // Solid adds its hydration key; the element is empty, with its class and marker
  assert.match(renderToString(() => createComponent(MkpPage, { ir: irs.v1, class: "shop" })), /^<div data-hk="\d+" class="shop ?" data-mkp-page=""><\/div>$/);
});

test("in Chromium: mounts, follows its props, tells the app, unmounts", async () => {
  const js = await bundle(esbuild, fileURLToPath(new URL("./app.mjs", import.meta.url)), { conditions: ["browser"] });
  const browser = await launch(chromium);
  try {
    const { page, errors } = await open(browser, { js, irs });
    await steps(page);
    assert.deepEqual(errors, []);
  } finally {
    await browser.close();
  }
});
