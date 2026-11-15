// Puts this machine's release build of mkp in its platform package: platforms/<os>-<cpu>/bin.
// Each platform's package is built on that platform: cargo build --release -p mkp-cli.

import { chmodSync, copyFileSync, existsSync, mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const exe = process.platform === "win32" ? "mkp.exe" : "mkp";
const built = join(here, "..", "..", "..", "rust", "target", "release", exe);
if (!existsSync(built)) {
  console.error(`no release build at ${built}: run cargo build --release -p mkp-cli in targets/rust`);
  process.exit(1);
}
const platform = `${process.platform}-${process.arch}`;
const dir = join(here, "..", "platforms", platform);
mkdirSync(join(dir, "bin"), { recursive: true });
if (!existsSync(join(dir, "package.json"))) {
  const os = process.platform, cpu = process.arch;
  writeFileSync(join(dir, "package.json"), JSON.stringify({ name: `@mkp/cli-${platform}`, version: "0.3.0", description: `The mkp binary for ${os} on ${cpu}`, license: "MIT", os: [os], cpu: [cpu], files: ["bin"] }, null, 2) + "\n");
}
copyFileSync(built, join(dir, "bin", exe));
chmodSync(join(dir, "bin", exe), 0o755);
console.log(`${platform}: ${join(dir, "bin", exe)}`);
