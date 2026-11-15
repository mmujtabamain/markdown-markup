import { test } from "node:test";
import assert from "node:assert/strict";
import { fileURLToPath } from "node:url";
import * as esbuild from "esbuild";
import { chromium } from "playwright-core";
import * as cli from "@mkp/cli";
import { bundle, compilePages, launch, open, steps } from "../../testing/browser.mjs";

const irs = await compilePages(cli);

test("in Chromium: mounts, follows its inputs, emits what the page did, unmounts", async () => {
  const js = await bundle(esbuild, fileURLToPath(new URL("./app.ts", import.meta.url)), {
    tsconfigRaw: { compilerOptions: { experimentalDecorators: true, useDefineForClassFields: false } },
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
