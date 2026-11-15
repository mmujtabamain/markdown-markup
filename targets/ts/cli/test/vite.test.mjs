// A Vite build compiles a page through @mkp/cli: `import page from "./sprint.mkp.md"`.

import { test } from "node:test";
import assert from "node:assert/strict";
import { readdirSync, readFileSync, rmSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { build } from "vite";
import mkp from "../dist/vite.js";

const app = join(dirname(fileURLToPath(import.meta.url)), "vite-app");

test("a Vite build compiles a page through @mkp/cli", async () => {
  rmSync(join(app, "dist"), { recursive: true, force: true });
  await build({ root: app, logLevel: "silent", plugins: [mkp()], build: { outDir: "dist", minify: false } });
  const assets = join(app, "dist", "assets");
  const js = readdirSync(assets).filter((f) => f.endsWith(".js")).map((f) => readFileSync(join(assets, f), "utf8")).join("\n");
  // the page's IR is in the bundle, compiled by the native mkp
  assert.match(js, /"module":\s*"doc"/);
  assert.match(js, /core\/slider/);
  assert.match(js, /"\$state":\s*"open"/);
});

test("a page that doesn't compile fails the build with mkp's message", async () => {
  const bad = join(app, "..", "vite-bad");
  await assert.rejects(
    build({ root: app, logLevel: "silent", plugins: [mkp()], build: { outDir: join(bad, "dist"), rollupOptions: { input: join(app, "..", "vite-broken.html") } } }),
    /doesn't compile|names\.unknown-name|no `missing` here/,
  );
});
