// Installs and builds MKP's npm packages (targets/ts, then the playground) in order, each after
// what it uses: npm links a neighbour named by `file:`, so it is built first. A framework a
// neighbour expects of its user (its peerDependencies: React, Vue, Solid, Svelte, Angular) is then
// one copy for both, the neighbour's, so a binding and its live twin run one React. --test then
// runs every package's tests.
//
//   node tools/release/build-ts.mjs [--test | --test-only]
//
// --test-only runs the tests of packages already built, as the release does once a browser is
// installed for the ones that need it.

import { execFileSync } from "node:child_process";
import { existsSync, lstatSync, rmSync, symlinkSync } from "node:fs";
import { dirname, join, relative } from "node:path";
import { packages, repo } from "./packages.mjs";

const only = process.argv.includes("--test-only");
const test = only || process.argv.includes("--test");
const run = (cwd, args) => execFileSync("npm", args, { cwd, stdio: ["ignore", "inherit", "inherit"] });
const all = packages({ published: false }).filter((p) => p.pkg.scripts?.build || p.pkg.scripts?.test);
const byName = new Map(packages({ published: false }).map((p) => [p.pkg.name, p]));

/** Each framework a neighbour expects of `p`, installed in both, becomes a link to the
 * neighbour's: two copies of React in one page don't share hooks. */
function shareFrameworks(p) {
  for (const dep of Object.keys(p.pkg.dependencies ?? {})) {
    const n = byName.get(dep);
    for (const peer of Object.keys(n?.pkg.peerDependencies ?? {})) {
      const mine = join(p.dir, "node_modules", peer);
      const theirs = join(n.dir, "node_modules", peer);
      if (!existsSync(theirs) || !existsSync(mine) || lstatSync(mine).isSymbolicLink()) continue;
      rmSync(mine, { recursive: true, force: true });
      symlinkSync(relative(dirname(mine), theirs), mine, "dir");
    }
  }
}
// `npm install`, not `npm ci`: a lock file names its neighbours by folder, and one that has fallen
// behind its package.json (a neighbour added since) would stop `ci`
for (const p of only ? [] : all) {
  console.log(`== ${p.pkg.name} (${relative(repo, p.dir)}): install, build`);
  run(p.dir, ["install", "--no-audit", "--no-fund"]);
  shareFrameworks(p);
  if (p.pkg.scripts.build) run(p.dir, ["run", "build"]);
}
if (test) {
  // every package's tests, then the ones that failed
  const failed = [];
  for (const p of all.filter((p) => p.pkg.scripts.test)) {
    console.log(`== ${p.pkg.name} (${relative(repo, p.dir)}): test`);
    try {
      run(p.dir, ["test"]);
    } catch {
      failed.push(p.pkg.name);
    }
  }
  if (failed.length) {
    console.error(`failed: ${failed.join(", ")}`);
    process.exit(1);
  }
}
