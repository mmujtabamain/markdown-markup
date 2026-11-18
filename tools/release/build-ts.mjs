// Installs and builds MKP's npm packages (targets/ts) in order, each after what it uses: with
// npm 10 a `file:` dependency is a link, so what it points to is built first. --test then runs
// every package's tests, once all are built (a test may use a package built after its own, as
// @mkp/cli builds the IR @mkp/embed's tests draw).
//
//   node tools/release/build-ts.mjs [--test | --test-only]
//
// --test-only runs the tests of packages already built, as the release does once a browser is
// installed for the ones that need it.

import { execFileSync } from "node:child_process";
import { existsSync } from "node:fs";
import { join, relative } from "node:path";
import { packages, repo } from "./packages.mjs";

const only = process.argv.includes("--test-only");
const test = only || process.argv.includes("--test");
const run = (cwd, args) => execFileSync("npm", args, { cwd, stdio: ["ignore", "inherit", "inherit"] });
const all = packages({ published: false }).filter((p) => p.pkg.scripts?.build || p.pkg.scripts?.test);
for (const p of only ? [] : all) {
  console.log(`== ${p.pkg.name} (${relative(repo, p.dir)}): install, build`);
  run(p.dir, existsSync(join(p.dir, "package-lock.json")) ? ["ci", "--no-audit", "--no-fund"] : ["install", "--no-audit", "--no-fund"]);
  if (p.pkg.scripts.build) run(p.dir, ["run", "build"]);
}
if (test) {
  for (const p of all.filter((p) => p.pkg.scripts.test)) {
    console.log(`== ${p.pkg.name} (${relative(repo, p.dir)}): test`);
    run(p.dir, ["test"]);
  }
}
