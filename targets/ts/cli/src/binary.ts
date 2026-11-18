// Where the native `mkp` binary is: named by MKP_BINARY, from this platform's package, or, in
// the repository itself, the compiler's own build. A platform with none compiles with @mkp/wasm.

import { existsSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const exe = process.platform === "win32" ? "mkp.exe" : "mkp";

const pkg = `@mkp/cli-${process.platform}-${process.arch}`;

export function findBinary(): string {
  const found = locateBinary();
  if (!found) throw new Error(`no mkp binary for ${process.platform}-${process.arch}: install ${pkg}, or set MKP_BINARY`);
  return found;
}

/** The binary, or undefined when this platform has none: `build` and `check` then compile with
 * @mkp/wasm. One MKP_BINARY names has to exist. */
export function locateBinary(): string | undefined {
  const named = process.env.MKP_BINARY;
  if (named) {
    if (!existsSync(named)) throw new Error(`MKP_BINARY names ${named}, which doesn't exist`);
    return named;
  }
  // the platform's package, installed as an optional dependency
  try {
    const require = createRequire(import.meta.url);
    const bin = join(dirname(require.resolve(`${pkg}/package.json`)), "bin", exe);
    if (existsSync(bin)) return bin;
  } catch {
    // not installed: try the repository's own build
  }
  const here = dirname(fileURLToPath(import.meta.url));
  for (const profile of ["release", "debug"]) {
    const built = join(here, "..", "..", "..", "rust", "target", profile, exe);
    if (existsSync(built)) return built;
  }
  return undefined;
}
