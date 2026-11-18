// Publishes MKP's npm packages (targets/ts), each after the ones it depends on: @mkp/runtime
// first, the framework bindings last. A package's `file:` dependencies on its neighbours become
// the release's version for the publish, and its package.json is put back after.
//
//   node tools/release/publish-npm.mjs --version 0.3.0 [--dry-run]
//
// Every package is built first (npm run build), and each @mkp/cli-<os>-<cpu> holds its binary in
// bin/ (the release workflow puts them there); one without a binary isn't published. Publishing
// needs NPM_TOKEN in ~/.npmrc, as the workflow writes it; --dry-run needs nothing.

import { execFileSync } from "node:child_process";
import { existsSync, writeFileSync } from "node:fs";
import { join, relative } from "node:path";
import { packages, repo } from "./packages.mjs";

const arg = (name) => {
  const at = process.argv.indexOf(name);
  return at > 0 ? process.argv[at + 1] : undefined;
};
const version = arg("--version");
const dry = process.argv.includes("--dry-run");
if (!version) {
  console.error("usage: node tools/release/publish-npm.mjs --version <x.y.z> [--dry-run]");
  process.exit(2);
}

const SECTIONS = ["dependencies", "optionalDependencies", "peerDependencies", "devDependencies"];
const order = packages();

let failed = 0;
for (const p of order) {
  const where = relative(repo, p.dir);
  if (p.pkg.version !== version) {
    console.error(`${p.pkg.name} (${where}) is ${p.pkg.version}, not ${version}: raise it first`);
    failed++;
    continue;
  }
  if (p.pkg.os && !existsSync(join(p.dir, "bin"))) {
    console.log(`${p.pkg.name}: no binary in ${where}/bin, not published`);
    continue;
  }
  // the neighbours it names by folder are named by the release's version
  const out = JSON.parse(p.text);
  for (const section of SECTIONS) {
    for (const [dep, spec] of Object.entries(out[section] ?? {})) {
      if (typeof spec === "string" && spec.startsWith("file:")) out[section][dep] = version;
    }
  }
  writeFileSync(p.file, JSON.stringify(out, null, 2) + "\n");
  try {
    execFileSync("npm", ["publish", "--access", "public", ...(dry ? ["--dry-run"] : [])], { cwd: p.dir, stdio: ["ignore", "inherit", "inherit"] });
    console.log(`${dry ? "would publish" : "published"} ${p.pkg.name}@${version}`);
  } catch {
    console.error(`${p.pkg.name}: npm publish failed`);
    failed++;
  } finally {
    writeFileSync(p.file, p.text);
  }
}
process.exit(failed ? 1 : 0);
