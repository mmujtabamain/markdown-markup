// Where the native `mkp` binary is: named by MKP_BINARY, from this platform's package, or, in
// the repository itself, the compiler's own build.

import { existsSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const exe = process.platform === "win32" ? "mkp.exe" : "mkp";

export function findBinary(): string {
  const named = process.env.MKP_BINARY;
  if (named) {
    if (!existsSync(named)) throw new Error(`MKP_BINARY names ${named}, which doesn't exist`);
    return named;
  }
  // the platform's package, installed as an optional dependency
  const pkg = `@mkp/cli-${process.platform}-${process.arch}`;
  try {
    const require = createRequire(import.meta.url);
    return join(dirname(require.resolve(`${pkg}/package.json`)), "bin", exe);
  } catch {
    // not installed: try the repository's own build
  }
  const here = dirname(fileURLToPath(import.meta.url));
  for (const profile of ["release", "debug"]) {
    const built = join(here, "..", "..", "..", "rust", "target", profile, exe);
    if (existsSync(built)) return built;
  }
  throw new Error(`no mkp binary for ${process.platform}-${process.arch}: install ${pkg}, or set MKP_BINARY`);
}
