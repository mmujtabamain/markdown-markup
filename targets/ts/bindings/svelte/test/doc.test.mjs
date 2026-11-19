import { test } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { compile } from "svelte/compiler";
import * as esbuild from "esbuild";
import { chromium } from "playwright-core";
import * as cli from "xtmd";
import { bundle, compilePages, docSteps, launch, open } from "../../testing/browser.mjs";

const irs = await compilePages(cli);

/** .svelte files compiled by Svelte's own compiler, for the browser or a server. */
const svelte = (generate) => ({
  name: "svelte",
  setup(build) {
    build.onLoad({ filter: /\.svelte$/ }, async (args) => {
      const r = compile(await readFile(args.path, "utf8"), { filename: args.path, generate });
      const warnings = r.warnings.filter((w) => !args.path.includes("/test/"));
      if (warnings.length) return { errors: warnings.map((w) => ({ text: w.message })) };
      return { contents: r.js.code, loader: "js" };
    });
  },
});

test("<XtmdDoc> on a server renders the page itself, its widgets drawn by Svelte", async () => {
  const r = await esbuild.build({
    stdin: { contents: 'export { render } from "svelte/server"; export { XtmdDoc } from "@extended-mark/svelte";', resolveDir: fileURLToPath(new URL(".", import.meta.url)) },
    bundle: true, write: false, format: "esm", platform: "node", conditions: ["svelte"], plugins: [svelte("server")], logLevel: "silent",
  });
  const { render, XtmdDoc } = await import(`data:text/javascript;base64,${Buffer.from(r.outputFiles[0].text).toString("base64")}`);
  const { body } = render(XtmdDoc, { props: { ir: irs.v1, defaultState: { n: { num: "2" } }, externs: { app: { unit: { text: "items" } } } } });
  // Svelte marks its blocks with comments for hydration
  const html = body.replace(/<!--[^>]*-->/g, "");
  assert.match(html, /<div[^>]* class="xtmd-root"/);
  assert.ok(html.includes("Count: 2 items"), html);
  assert.match(html, /data-part="press\.label"[^>]*>Add one</);
});

test("<XtmdDoc> in Chromium: controlled $state, refusals, props, snapshots", async () => {
  const js = await bundle(esbuild, fileURLToPath(new URL("./doc-app.mjs", import.meta.url)), { plugins: [svelte("client")], conditions: ["svelte", "browser"] });
  const browser = await launch(chromium);
  try {
    const { page, errors } = await open(browser, { js, irs });
    await docSteps(page);
    assert.deepEqual(errors, []);
  } finally {
    await browser.close();
  }
});
