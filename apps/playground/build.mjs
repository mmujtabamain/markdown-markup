// Bundles the UI: src/app.ts and the CSS it imports (ours and @mkp/dom's) into dist/app.js and
// dist/app.css. `npm run build` runs it; the server runs it at startup when dist/app.js is missing.

import { build } from "esbuild";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));

export async function buildBundle({ minify = true } = {}) {
  await build({
    absWorkingDir: here,
    entryPoints: { app: join(here, "src/app.ts") },
    outdir: join(here, "dist"),
    bundle: true,
    format: "esm",
    platform: "browser",
    target: "es2022",
    minify,
    sourcemap: true,
    legalComments: "none",
    logLevel: "warning",
  });
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  await buildBundle({ minify: !process.argv.includes("--dev") });
  process.stderr.write("built dist/app.js and dist/app.css\n");
}
