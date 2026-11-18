// Puts a release build of mkp in its platform package: platforms/<os>-<cpu>/bin.
//
//   node scripts/copy-binary.mjs                        this machine's: cargo build --release -p mkp-cli
//   node scripts/copy-binary.mjs --target <triple>      one cross-built for another platform, as the
//                                                       release workflow builds each with cargo zigbuild
//
// The triples are the ones in TARGETS below; each names the platform package it goes in.

import { chmodSync, copyFileSync, existsSync, mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

/** Each platform's Rust target: static on Linux (musl), so one binary runs on every distribution. */
export const TARGETS = {
  "x86_64-unknown-linux-musl": "linux-x64",
  "aarch64-unknown-linux-musl": "linux-arm64",
  "x86_64-apple-darwin": "darwin-x64",
  "aarch64-apple-darwin": "darwin-arm64",
  "x86_64-pc-windows-gnu": "win32-x64",
};

const here = dirname(fileURLToPath(import.meta.url));
const at = process.argv.indexOf("--target");
const target = at > 0 ? process.argv[at + 1] : undefined;
if (at > 0 && !(target in TARGETS)) {
  console.error(`--target takes one of: ${Object.keys(TARGETS).join(", ")}`);
  process.exit(2);
}
const platform = target ? TARGETS[target] : `${process.platform}-${process.arch}`;
const [os, cpu] = platform.split("-");
const exe = os === "win32" ? "mkp.exe" : "mkp";
const built = join(here, "..", "..", "..", "rust", "target", ...(target ? [target] : []), "release", exe);
if (!existsSync(built)) {
  console.error(`no release build at ${built}: run cargo ${target ? `zigbuild --release -p mkp-cli --target ${target}` : "build --release -p mkp-cli"} in targets/rust`);
  process.exit(1);
}
const dir = join(here, "..", "platforms", platform);
mkdirSync(join(dir, "bin"), { recursive: true });
if (!existsSync(join(dir, "package.json"))) {
  writeFileSync(join(dir, "package.json"), JSON.stringify({ name: `@mkp/cli-${platform}`, version: "0.3.0", description: `The mkp binary for ${os} on ${cpu}`, license: "MIT", os: [os], cpu: [cpu], files: ["bin"] }, null, 2) + "\n");
}
copyFileSync(built, join(dir, "bin", exe));
chmodSync(join(dir, "bin", exe), 0o755);
console.log(`${platform}: ${join(dir, "bin", exe)}`);
// MKP 0.3.0 only: the frozen 0.2 → 0.3 step beside the binary, where `mkp migrate` looks for it
// (tools/migrate-0.2/frozen; later releases build without it)
const frozen = join(here, "..", "..", "..", "..", "tools", "migrate-0.2", "frozen", "migrate-0.2.cjs");
if (existsSync(frozen)) {
  copyFileSync(frozen, join(dir, "bin", "migrate-0.2.cjs"));
  console.log(`${platform}: ${join(dir, "bin", "migrate-0.2.cjs")}`);
}
