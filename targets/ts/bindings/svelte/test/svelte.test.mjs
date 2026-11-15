import { test } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { compile } from "svelte/compiler";
import * as esbuild from "esbuild";
import { chromium } from "playwright-core";
import * as cli from "@mkp/cli";
import { bundle, compilePages, launch, open, steps } from "../../testing/browser.mjs";

const irs = await compilePages(cli);

/** .svelte files compiled by Svelte's own compiler, for the browser. */
const svelte = {
  name: "svelte",
  setup(build) {
    build.onLoad({ filter: /\.svelte$/ }, async (args) => {
      const r = compile(await readFile(args.path, "utf8"), { filename: args.path, generate: "client" });
      const warnings = r.warnings.filter((w) => !args.path.includes("/test/"));
      if (warnings.length) return { errors: warnings.map((w) => ({ text: w.message })) };
      return { contents: r.js.code, loader: "js" };
    });
  },
};

test("in Chromium: mounts, follows its props, tells the app, unmounts", async () => {
  const js = await bundle(esbuild, fileURLToPath(new URL("./app.mjs", import.meta.url)), { plugins: [svelte], conditions: ["svelte", "browser"] });
  const browser = await launch(chromium);
  try {
    const { page, errors } = await open(browser, { js, irs });
    await steps(page);
    assert.deepEqual(errors, []);
  } finally {
    await browser.close();
  }
});
