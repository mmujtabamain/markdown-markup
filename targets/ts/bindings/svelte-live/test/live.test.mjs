import { test } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { compile } from "svelte/compiler";
import * as esbuild from "esbuild";
import { chromium } from "playwright-core";
import { compiler } from "@extended-mark/live";
import { bundle, launch, liveSteps, openLive, pageSources } from "../../testing/browser.mjs";

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

test("<XtmdLiveDoc> on a server, given a compiler, compiles the text and renders the page", async () => {
  const r = await esbuild.build({
    stdin: { contents: 'export { render } from "svelte/server"; export { XtmdLiveDoc } from "@extended-mark/svelte-live";', resolveDir: fileURLToPath(new URL(".", import.meta.url)) },
    bundle: true, write: false, format: "esm", platform: "node", conditions: ["svelte"], plugins: [svelte("server")], logLevel: "silent",
    // xtmd.wasm is the test's, loaded beside it
    external: ["node:fs/promises"],
  });
  const { render, XtmdLiveDoc } = await import(`data:text/javascript;base64,${Buffer.from(r.outputFiles[0].text).toString("base64")}`);
  const { body } = render(XtmdLiveDoc, { props: { source: pageSources().v1, compiler: await compiler(), defaultState: { n: { num: "2" } }, externs: { app: { unit: { text: "items" } } } } });
  // Svelte marks its blocks with comments for hydration
  const html = body.replace(/<!--[^>]*-->/g, "");
  assert.match(html, /<div[^>]* class="xtmd-root"/);
  assert.ok(html.includes("Count: 2 items"), html);
});

test("<XtmdLiveDoc> in Chromium: compiled in the tab, edited, a broken draft kept back", async () => {
  const js = await bundle(esbuild, fileURLToPath(new URL("./live-app.mjs", import.meta.url)), { conditions: ["svelte", "browser"], plugins: [svelte("client")] });
  const browser = await launch(chromium);
  try {
    const { page, errors } = await openLive(browser, { js });
    await liveSteps(page);
    assert.deepEqual(errors, []);
  } finally {
    await browser.close();
  }
});
