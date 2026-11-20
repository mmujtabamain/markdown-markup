// Builds the extension into dist/: the desktop's and the browser's extension, the language
// server's two hosts (a Node process, a web worker), the preview's page (the vscode target), and
// beside them xtmd.wasm, the IR schemas, VS Code's codicons and, where this tree has it, MKP 0.2's
// frozen step (checked against its lock, as the xtmd binary checks it). The types are checked first.
//
//   node build.mjs [--watch]

import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { cpSync, existsSync, mkdirSync, readFileSync, rmSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { build, context } from "esbuild";

const here = dirname(fileURLToPath(import.meta.url));
const repo = join(here, "..", "..");
const dist = join(here, "dist");
const watch = process.argv.includes("--watch");

execFileSync(process.execPath, [join(here, "node_modules", "typescript", "bin", "tsc"), "-p", here], { stdio: "inherit" });

rmSync(dist, { recursive: true, force: true });
mkdirSync(join(dist, "schemas"), { recursive: true });

const wasm = join(repo, "targets", "ts", "wasm", "xtmd.wasm");
if (!existsSync(wasm)) throw new Error(`${wasm} isn't built: targets/rust/wasm/build.sh builds it`);
cpSync(wasm, join(dist, "xtmd.wasm"));
for (const s of ["ir", "rir"]) cpSync(join(repo, "schemas", `${s}.schema.json`), join(dist, "schemas", `${s}.schema.json`));
mkdirSync(join(dist, "codicons"), { recursive: true });
for (const f of ["codicon.css", "codicon.ttf"]) cpSync(join(here, "node_modules", "@vscode", "codicons", "dist", f), join(dist, "codicons", f));
cpSync(join(here, "src", "target", "style.css"), join(dist, "preview.css"));
// the 0.2 → 0.3 step: only Extended Mark 0.3.0 carries it, so a later tree has no lock and no step
const frozen = join(repo, "tools", "migrate-0.2", "frozen");
const lock = join(frozen, "migrate-0.2.lock");
if (existsSync(lock)) {
  const sha = /^sha256 = "([0-9a-f]+)"/m.exec(readFileSync(lock, "utf8"))?.[1];
  const step = join(frozen, "migrate-0.2.cjs");
  if (!sha || createHash("sha256").update(readFileSync(step)).digest("hex") !== sha) throw new Error(`${step} isn't the file ${lock} names (its SHA-256 differs)`);
  cpSync(step, join(dist, "migrate-0.2.cjs"));
}

// import.meta.url only ever reaches @extended-mark/wasm's default xtmd.wasm, which is never used:
// the extension always gives it the bytes
const common = { bundle: true, sourcemap: true, minify: !watch, target: "es2022", logLevel: "warning", define: { "import.meta.url": "undefined" } };
const builds = [
  { ...common, entryPoints: [join(here, "src", "node.ts")], outfile: join(dist, "node", "extension.js"), platform: "node", format: "cjs", external: ["vscode"] },
  { ...common, entryPoints: [join(here, "src", "server", "node.ts")], outfile: join(dist, "node", "server.js"), platform: "node", format: "cjs" },
  { ...common, entryPoints: [join(here, "src", "web.ts")], outfile: join(dist, "web", "extension.js"), platform: "browser", format: "cjs", external: ["vscode"], mainFields: ["browser", "module", "main"] },
  { ...common, entryPoints: [join(here, "src", "server", "worker.ts")], outfile: join(dist, "web", "worker.js"), platform: "browser", format: "iife", mainFields: ["browser", "module", "main"] },
  { ...common, entryPoints: [join(here, "src", "target", "main.ts")], outfile: join(dist, "preview.js"), platform: "browser", format: "iife" },
];

if (watch) {
  for (const b of builds) await (await context(b)).watch();
  console.log("watching src/");
} else {
  await Promise.all(builds.map((b) => build(b)));
  console.log(`built dist/: node/extension.js, node/server.js, web/extension.js, web/worker.js, preview.js, xtmd.wasm${existsSync(lock) ? ", migrate-0.2.cjs" : ""}`);
}
