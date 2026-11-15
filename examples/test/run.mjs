// `npm test`: everything the same-page test needs, then the test. Installs each local package that
// has no node_modules, builds each one whose dist is missing or older than its src (the mkp binary
// included), and runs same-page.test.mjs, which builds and serves the three examples.

import { execFileSync } from "node:child_process";
import { existsSync, readdirSync, statSync } from "node:fs";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const repo = resolve(fileURLToPath(new URL("../..", import.meta.url)));
const ts = join(repo, "targets/ts");

function run(cmd, args, cwd, env = {}) {
  console.log(`\n$ (${cwd.slice(repo.length + 1) || "."}) ${cmd} ${args.join(" ")}`);
  execFileSync(cmd, args, { cwd, stdio: "inherit", env: { ...process.env, ...env } });
}

/** The newest file under a folder, by modification time. */
function newest(dir) {
  let t = 0;
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    const p = join(dir, e.name);
    t = Math.max(t, e.isDirectory() ? newest(p) : statSync(p).mtimeMs);
  }
  return t;
}

// the compiler
const binary = join(repo, "targets/rust/target/release/mkp");
if (!existsSync(binary)) run("cargo", ["build", "--release", "-p", "mkp-cli"], join(repo, "targets/rust"), { PATH: `${process.env.HOME}/.cargo/bin:${process.env.PATH}` });

// the packages, each after what it links to
const packages = ["runtime", "cli", "dom", "bindings/embed", "bindings/react", "bindings/next"].map((p) => join(ts, p));
for (const dir of packages) {
  if (!existsSync(join(dir, "node_modules"))) run("npm", ["install", "--no-audit", "--no-fund"], dir);
  const dist = join(dir, "dist");
  if (!existsSync(dist) || newest(join(dir, "src")) > newest(dist)) run("npm", ["run", "build"], dir);
}

// the examples and this test
for (const ex of ["web-plain", "web-react", "web-next", "test"]) {
  const dir = join(repo, "examples", ex);
  if (!existsSync(join(dir, "node_modules"))) run("npm", ["install", "--no-audit", "--no-fund"], dir);
}

run(process.execPath, ["--test", "--test-reporter=spec", "same-page.test.mjs"], join(repo, "examples/test"));
