// Bundles the UI into dist/: app.js (the playground, with Monaco's editor API and MKP's language),
// app.css (ours, and Monaco's), Monaco's codicon font, and editor.worker.js, Monaco's web worker,
// as an entry of its own (src/monaco.ts finds it through MonacoEnvironment.getWorkerUrl).
// `npm run build` runs it; the server runs it at startup when dist/app.js is missing.
// `node build.mjs --dev` leaves the code readable and writes source maps.

import { build } from "esbuild";
import { rmSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));

export async function buildBundle({ minify = true, sourcemap = !minify } = {}) {
  const outdir = join(here, "dist");
  rmSync(outdir, { recursive: true, force: true });
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
  ]);
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  await buildBundle({ minify: !process.argv.includes("--dev") });
  process.stderr.write("built dist/: app.js, app.css, editor.worker.js and the codicon font\n");
}
