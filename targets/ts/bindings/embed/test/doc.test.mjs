import { test } from "node:test";
import assert from "node:assert/strict";
import { fileURLToPath } from "node:url";
import * as esbuild from "esbuild";
import { chromium } from "playwright-core";
import * as cli from "@mkp/cli";
import { bundle, compilePages, docSteps, launch, open } from "../../testing/browser.mjs";

const irs = await compilePages(cli);

test("the plain web's MkpDoc in Chromium: controlled $state, refusals, props, snapshots", async () => {
  const js = await bundle(esbuild, fileURLToPath(new URL("./doc-app.mjs", import.meta.url)));
  const browser = await launch(chromium);
  try {
    const { page, errors } = await open(browser, { js, irs });
    await docSteps(page, { stylesheet: "document" });
    assert.deepEqual(errors, []);
  } finally {
    await browser.close();
  }
});

test("MkpDoc fetched from src shows it is loading, then the page, or why it couldn't be had", async () => {
  const js = await bundle(esbuild, fileURLToPath(new URL("./doc-src-app.mjs", import.meta.url)));
  const browser = await launch(chromium);
  try {
    const page = await browser.newPage();
    const pageErrors = [];
    page.on("pageerror", (e) => pageErrors.push(e));
    await page.route("http://mkp.test/page.ir.json", (r) => r.fulfill({ status: 200, contentType: "application/json", headers: { "access-control-allow-origin": "*" }, body: JSON.stringify(irs.v1) }));
    await page.route("http://mkp.test/missing.ir.json", (r) => r.fulfill({ status: 404, body: "no" }));
    await page.setContent(`<!doctype html><html><head><meta charset="utf-8"></head><body><div id="ok"></div><div id="missing"></div></body></html>`);
    await page.addScriptTag({ content: js });
    await page.waitForFunction(() => document.querySelector("#ok")?.textContent.includes("Count: 0 points"));
    await page.waitForFunction(() => window.__errors?.length === 1);
    const errors = await page.evaluate(() => window.__errors);
    assert.equal(errors[0].kind, "load");
    assert.match(errors[0].message, /^The page at http:\/\/mkp\.test\/missing\.ir\.json couldn't be loaded: 404/);
    assert.match(await page.evaluate(() => document.querySelector("#missing [role=alert]")?.textContent ?? ""), /couldn't be loaded/);
    assert.deepEqual(pageErrors, []);
  } finally {
    await browser.close();
  }
});
