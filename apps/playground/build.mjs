// Bundles the UI into dist/: app.js (the playground, with Monaco's editor API and MKP's language),
// app.css (ours, and Monaco's), Monaco's codicon font, editor.worker.js, Monaco's web worker, as an
// entry of its own (src/monaco.ts finds it through MonacoEnvironment.getWorkerUrl), and the
// compiler: compiler.worker.js, which runs mkp.wasm (@mkp/wasm's, copied beside it).
// `npm run build` runs it; the server runs it at startup when dist/app.js is missing.
// `node build.mjs --dev` leaves the code readable and writes source maps.

import { build } from "esbuild";
import { copyFileSync, existsSync, mkdirSync, rmSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));

export async function buildBundle({ minify = true, sourcemap = !minify } = {}) {
  const outdir = join(here, "dist");
  // the compiler the page runs: targets/rust/wasm/build.sh makes it
  let wasm;
  try {
    wasm = createRequire(join(here, "package.json")).resolve("@mkp/wasm/mkp.wasm");
  } catch {
    wasm = undefined;
  }
  if (!wasm || !existsSync(wasm)) throw new Error("no mkp.wasm in @mkp/wasm: run targets/rust/wasm/build.sh");
  rmSync(outdir, { recursive: true, force: true });
  mkdirSync(outdir, { recursive: true });
  copyFileSync(wasm, join(outdir, "mkp.wasm"));
  const common = {
    absWorkingDir: here,
    outdir,
    bundle: true,
    format: "esm",
    platform: "browser",
    target: "es2022",
    minify,
    sourcemap,
    // Monaco's and its dependencies' licences, beside the bundle rather than in it
    legalComments: "linked",
    logLevel: "warning",
  };
  await Promise.all([
    build({
      ...common,
      entryPoints: { app: join(here, "src/app.ts") },
      // the codicon font Monaco's CSS points at, written beside app.css
      loader: { ".ttf": "file" },
      assetNames: "[name]-[hash]",
    }),
    build({
      ...common,
      // a module: Monaco starts it from a small blob that imports this URL
      entryPoints: { "editor.worker": "monaco-editor/editor/editor.worker.js" },
    }),
    build({
      ...common,
      entryPoints: { "compiler.worker": join(here, "src/compiler.worker.ts") },
    }),
  ]);
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  await buildBundle({ minify: !process.argv.includes("--dev") });
  process.stderr.write("built dist/: app.js, app.css, editor.worker.js, compiler.worker.js, mkp.wasm and the codicon font\n");
}
