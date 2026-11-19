// Builds the showcase into dist/: each framework's entry bundled with its own binding's esbuild
// and node_modules (React, Vue, Svelte, Solid, Angular, and their -live), xtmd.wasm, and the
// counter example's text and IR. `node build.mjs`, then `node serve.mjs`.

import { copyFileSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const bindings = join(here, "../..");
const out = join(here, "dist");
mkdirSync(out, { recursive: true });

const own = (fw) => createRequire(join(bindings, fw, "package.json"));
const load = async (fw, pkg) => {
  const m = await import(pathToFileURL(own(fw).resolve(pkg)).href);
  return { ...m.default, ...m };
};

const FRAMEWORKS = {
  react: { entry: "react.mjs", define: { "process.env.NODE_ENV": '"production"' } },
  vue: { entry: "vue.mjs", define: { "process.env.NODE_ENV": '"production"', __VUE_OPTIONS_API__: "true", __VUE_PROD_DEVTOOLS__: "false", __VUE_PROD_HYDRATION_MISMATCH_DETAILS__: "false" } },
  svelte: { entry: "svelte.mjs", svelte: true },
  solid: { entry: "solid.mjs" },
  angular: { entry: "angular.ts", decorators: true },
};

for (const [fw, o] of Object.entries(FRAMEWORKS)) {
  const { build } = await load(fw, "esbuild");
  const plugins = [];
  if (o.svelte) {
    const { compile } = await load(fw, "svelte/compiler");
    plugins.push({
      name: "svelte",
      setup(b) {
        b.onLoad({ filter: /\.svelte$/ }, (args) => ({ contents: compile(readFileSync(args.path, "utf8"), { filename: args.path, generate: "client" }).js.code, loader: "js" }));
      },
    });
  }
  await build({
    entryPoints: [join(here, o.entry)],
    outfile: join(out, `${fw}.js`),
    bundle: true,
    format: "iife",
    platform: "browser",
    target: "es2022",
    minify: true,
    logLevel: "warning",
    // the framework, its binding and its live binding, from their own folders
    nodePaths: [join(bindings, `${fw}-live/node_modules`), join(bindings, `${fw}/node_modules`)],
    conditions: o.svelte ? ["svelte", "browser"] : ["browser"],
    define: o.define ?? {},
    // the live binding is the run-time one's sibling folder, in no node_modules
    alias: { [`@extended-mark/${fw}-live`]: join(bindings, `${fw}-live/dist/index.js`) },
    plugins,
    ...(o.decorators ? { tsconfigRaw: { compilerOptions: { experimentalDecorators: true, useDefineForClassFields: false } } } : {}),
  });
}

const repo = join(bindings, "../../..");
copyFileSync(join(repo, "targets/ts/wasm/xtmd.wasm"), join(out, "xtmd.wasm"));
const counter = join(repo, "apps/playground/examples/counter.xt.md");
copyFileSync(counter, join(out, "counter.xt.md"));
const cli = await import(pathToFileURL(join(bindings, "react/node_modules/xtmd/dist/index.js")).href);
writeFileSync(join(out, "counter.ir.json"), JSON.stringify(await cli.build(counter)));
process.stderr.write("built dist/: react, vue, svelte, solid, angular, xtmd.wasm, counter\n");
