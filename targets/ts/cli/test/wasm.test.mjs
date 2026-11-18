// On a platform with no mkp binary, build and check compile with @mkp/wasm: the same compiler, so
// the same IR and the same diagnostics. The API is loaded from a copy where no binary can be found.

import { test } from "node:test";
import assert from "node:assert/strict";
import { cpSync, mkdirSync, mkdtempSync, realpathSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { build, check } from "../dist/index.js";

const here = dirname(fileURLToPath(import.meta.url));
const dir = mkdtempSync(join(tmpdir(), "mkp-cli-wasm-"));
const page = join(dir, "page.mkp.md");
writeFileSync(page, "import shapes;\n\n$state {\n    tries: int = 2;\n}\n@@@\n# Tries\n\nTried \\{$state.tries} times, \\{double(2)} over.\n");
const pack = join(dir, "shapes");
mkdirSync(pack);
writeFileSync(join(pack, "shapes.mkp"), "package shapes;\n\npack shapes@1 {\n    provides double;\n}\n\nfn double(x: number): number {\n    return x * 2;\n}\n");
const bad = join(dir, "bad.mkp");
writeFileSync(bad, "package t;\n\nlet x: number = y;\n");

/** The API, from a copy with @mkp/wasm and no binary: no platform package, no repository build. */
async function withoutBinary() {
  const root = join(dir, "cli");
  cpSync(join(here, "..", "dist"), join(root, "dist"), { recursive: true });
  writeFileSync(join(root, "package.json"), JSON.stringify({ type: "module" }));
  mkdirSync(join(root, "node_modules", "@mkp"), { recursive: true });
  symlinkSync(realpathSync(join(here, "..", "node_modules", "@mkp", "wasm")), join(root, "node_modules", "@mkp", "wasm"), "dir");
  return import(pathToFileURL(join(root, "dist", "index.js")).href);
}

test("with no binary, build and check compile with @mkp/wasm and agree with the binary", { skip: process.env.MKP_BINARY ? "MKP_BINARY names a binary" : false }, async () => {
  const wasm = await withoutBinary();
  assert.equal(wasm.locateBinary(), undefined);
  const packs = { packs: [pack] };
  assert.deepEqual(await wasm.check(page, packs), []);
  assert.deepEqual(await check(page, packs), []);
  assert.deepEqual(await wasm.build(page, packs), await build(page, packs));
  const found = await wasm.check(bad);
  assert.deepEqual(found, await check(bad));
  assert.equal(found[0].code, "names.unknown-name");
  await assert.rejects(wasm.build(bad), (e) => e instanceof wasm.MkpError && /bad\.mkp:3:17: error\[names\.unknown-name\]/.test(e.message));
  // the commands only the binary has still say so
  await assert.rejects(wasm.md(page), /no mkp binary/);
});
