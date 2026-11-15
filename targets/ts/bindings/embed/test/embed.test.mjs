import { test } from "node:test";
import assert from "node:assert/strict";
import { fileURLToPath } from "node:url";
import * as esbuild from "esbuild";
import { chromium } from "playwright-core";
import * as cli from "@mkp/cli";
import { blocksHtml, pageHtml } from "@mkp/embed/html";
import { makePage } from "../dist/page.js";
import { bundle, compilePages, launch, open, steps } from "../../testing/browser.mjs";

const irs = await compilePages(cli);

test("makePage keeps the app's $state that fits, and says what it refused", () => {
  const ok = makePage(irs.v2, {}, { n: { num: "4" }, stride: { num: "3" } });
  assert.deepEqual(ok.page.observeState(), { n: { num: "4" }, stride: { num: "3" } });
  assert.deepEqual(ok.outcome, { refused: [], failures: [] });

  const some = makePage(irs.v2, {}, { n: { num: "40" }, stride: { num: "3" }, gone: { num: "1" } });
  assert.deepEqual(some.page.observeState(), { n: { num: "0" }, stride: { num: "3" } });
  assert.deepEqual(some.outcome.refused, [
    { code: "contracts.outside", site: "$state.gone" },
    { code: "contracts.outside", site: "$state.n" },
  ]);
  // a remount drops fields the new page doesn't have without a word
  assert.deepEqual(makePage(irs.v1, {}, { n: { num: "2" }, stride: { num: "3" } }, false).outcome.refused, []);
});

test("pageHtml writes the page's Markdown as HTML, escaped", () => {
  assert.equal(pageHtml(irs.v1, { state: { n: { num: "5" } } }), "<h1>Count: 5 points</h1>\n<p>Add one</p>");
  assert.equal(
    blocksHtml([
      { paragraph: [{ text: { value: "<b>&", bold: true } }, { text: { value: "x", link: "javascript:alert(1)" } }, { text: { value: "y", link: "https://e.org/?a=1&b" } }] },
      { bullets: { ordered: true, start: 3, items: [{ done: true, blocks: [{ paragraph: [{ code: "a<b" }] }] }] } },
      { table: { head: [[{ text: { value: "A" } }]], rows: [[[{ math: "x^2" }]]], align: ["END"] } },
      { divider: {} },
    ]),
    '<p><strong>&lt;b&gt;&amp;</strong>x<a href="https://e.org/?a=1&amp;b">y</a></p>\n' +
      '<ol start="3"><li><input type="checkbox" disabled checked> <code>a&lt;b</code></li></ol>\n' +
      '<table><thead><tr><th style="text-align:right">A</th></tr></thead><tbody><tr><td style="text-align:right"><span class="mkp-math">x^2</span></td></tr></tbody></table>\n' +
      "<hr>",
  );
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
