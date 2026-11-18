import { test } from "node:test";
import assert from "node:assert/strict";
import { fileURLToPath } from "node:url";
import * as esbuild from "esbuild";
import { chromium } from "playwright-core";
import * as cli from "@mkp/cli";
import { Doc, toHtml } from "@mkp/view";
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

test("on a server, the same page as HTML (@mkp/view), which MkpDoc takes over in the browser", async () => {
  // what a server writes into the element: no DOM, no framework
  const html = toHtml(new Doc({ ir: irs.v1, defaultState: { n: { num: "2" } }, externs: { app: { unit: { text: "items" } } } }).render());
  assert.match(html, /^<div class="mkp-root" data-mkp-root/);
  assert.ok(html.includes("Count: 2 items"));
  const js = await bundle(esbuild, fileURLToPath(new URL("./doc-server-app.mjs", import.meta.url)));
  const browser = await launch(chromium);
  try {
    const page = await browser.newPage();
    const errors = [];
    page.on("pageerror", (e) => errors.push(e));
    await page.setContent(`<!doctype html><html><head><meta charset="utf-8"></head><body><div id="app">${html}</div></body></html>`);
    assert.ok((await page.textContent("#app")).includes("Count: 2 items"), "readable before any script");
    await page.evaluate((irs) => (window.__IR = irs), irs);
    await page.addScriptTag({ content: js });
    await page.waitForFunction(() => window.__test?.doc.running);
    // one page, MkpDoc's, and it works
    assert.equal(await page.evaluate(() => document.querySelectorAll("#app [data-mkp-widget='core/press']").length), 1);
    await page.click('#app [data-mkp-widget="core/press"]');
    await page.waitForFunction(() => document.querySelector("#app").textContent.includes("Count: 3 items"));
    assert.ok((await page.evaluate(() => window.__server)).includes("Count: 2 items"));
    assert.deepEqual(errors, []);
  } finally {
    await browser.close();
  }
});
