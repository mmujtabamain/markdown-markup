import { test } from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import { withMkp, loader } from "@mkp/next/config";
import { pageHtml } from "@mkp/next/server";
import * as cli from "@mkp/cli";

const counter = fileURLToPath(new URL("../../testing/counter.mkp.md", import.meta.url));
const require = createRequire(import.meta.url);

/** Runs the loader as webpack and Turbopack do: an async loader with options. */
function runLoader(resourcePath, options = {}) {
  const load = require(loader);
  return new Promise((resolve, reject) => {
    const deps = [];
    load.call({
      resourcePath,
      getOptions: () => options,
      addDependency: (f) => deps.push(f),
      async: () => (err, out) => (err ? reject(err) : resolve({ out, deps })),
    });
  });
}

test("the loader turns a .mkp.md file into a module whose default is its IR", async () => {
  const { out } = await runLoader(counter);
  assert.match(out, /^export default \{"ir":/);
  const ir = JSON.parse(out.slice("export default ".length, -1));
  assert.deepEqual(ir, await cli.build(counter));
});

test("a page that doesn't compile fails the build with mkp's message", async () => {
  const broken = fileURLToPath(new URL("../../../cli/test/vite-broken.mkp.md", import.meta.url));
  await assert.rejects(runLoader(broken), /doesn't compile/);
});

test("withMkp gives the loader to Turbopack and to webpack, keeping the app's config", () => {
  const mine = (c) => ((c.marked = true), c);
  const config = withMkp({ reactStrictMode: true, turbopack: { rules: { "*.svg": { loaders: ["svgr"] } } }, webpack: mine }, { packs: ["./packs/maps"] });
  assert.equal(config.reactStrictMode, true);
  assert.deepEqual(config.turbopack.rules["*.svg"], { loaders: ["svgr"] });
  assert.deepEqual(config.turbopack.rules["*.mkp.md"], { loaders: [{ loader, options: { packs: ["./packs/maps"] } }], as: "*.js" });
  const wp = config.webpack({ module: { rules: [] } }, {});
  assert.equal(wp.marked, true);
  assert.equal(wp.module.rules.length, 1);
  assert.ok(wp.module.rules[0].test.test("shop.mkp.md"));
  assert.ok(!wp.module.rules[0].test.test("README.md"));
});

test("pageHtml writes the page's Markdown as HTML, with the app's $state", async () => {
  const ir = await cli.build(counter);
  assert.equal(pageHtml(ir), "<h1>Count: 0 points</h1>\n<p>Add one</p>");
  assert.equal(pageHtml(ir, { state: { n: { num: "7" } } }), "<h1>Count: 7 points</h1>\n<p>Add one</p>");
  // a value that doesn't fit keeps the starting one
  assert.equal(pageHtml(ir, { state: { n: { num: "70" } } }), "<h1>Count: 0 points</h1>\n<p>Add one</p>");
  // a channel by the name the document gives it
  assert.equal(pageHtml(ir, { externs: { app: { unit: { text: "pts" } } } }), "<h1>Count: 0 pts</h1>\n<p>Add one</p>");
});
