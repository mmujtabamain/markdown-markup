// mkp.wasm held to the binary: every conformance case built both ways gives the same IR and the
// same diagnostics, and what a real-time target leans on (a broken document, packs given as text,
// a compiler that goes on after a bad one) works.

import { test } from "node:test";
import assert from "node:assert/strict";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import * as cli from "@mkp/cli";
import { Compiler } from "../dist/index.js";

const here = dirname(fileURLToPath(import.meta.url));
const casesDir = join(here, "../../../checks/cases");

function walk(dir, keep, out = []) {
  for (const name of readdirSync(dir).sort()) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) walk(p, keep, out);
    else if (keep(p)) out.push(p);
  }
  return out;
}

/** Every case with a source: where it is, its packs' folders and files, and those files' text. */
const cases = walk(casesDir, (p) => p.endsWith(".json")).flatMap((f) => {
  const c = JSON.parse(readFileSync(f, "utf8"));
  if (!c.id || !c.source) return [];
  const dir = dirname(f);
  const packs = (c.packs ?? []).map((p) => join(dir, p));
  const files = packs.flatMap((p) => (statSync(p).isDirectory() ? walk(p, (x) => x.endsWith(".mkp")) : [p]));
  return [{ id: c.id, source: join(dir, c.source), packs, files: files.map((path) => ({ path, text: readFileSync(path, "utf8") })) }];
});

const started = Date.now();
const compiler = await Compiler.load();
const loadMs = Date.now() - started;

test("mkp.wasm loads, compiling core once", () => {
  assert.ok(cases.length >= 50, `${cases.length} cases`);
  // core is compiled as it loads: say how long, so a slow one shows
  console.log(`mkp.wasm loaded in ${loadMs} ms`);
});

test("every conformance case gives the binary's IR, or the binary's errors", async () => {
  let built = 0;
  for (const c of cases) {
    const got = compiler.build(c.source, readFileSync(c.source, "utf8"), c.files);
    let want;
    try {
      want = await cli.build(c.source, { packs: c.packs });
    } catch (e) {
      want = null;
    }
    if (want) {
      assert.equal(got.errors, 0, `${c.id}: ${JSON.stringify(got.diagnostics)}`);
      assert.deepEqual(got.ir, want, c.id);
      built++;
    } else {
      assert.ok(got.errors > 0 && got.ir === null, `${c.id}: the binary refuses it, mkp.wasm doesn't`);
    }
    // the file's own diagnostics, where and what
    const said = await cli.check(c.source, { packs: c.packs });
    const key = (d) => `${d.file}:${d.line}:${d.column} ${d.code}`;
    assert.deepEqual(got.diagnostics.filter((d) => d.file === c.source).map(key).sort(), said.filter((d) => d.file === c.source).map(key).sort(), c.id);
  }
  // most cases are compile errors on purpose; the rest run on the targets
  assert.ok(built >= 50, `${built} of ${cases.length} built`);
});

test("a document with errors gives them, with no IR, and the compiler goes on", () => {
  const bad = compiler.build("page.mkp.md", "$state {\n    n: int 0..3 = 9;\n}\n@@@\n\\{$state.nope}\n");
  assert.equal(bad.ir, null);
  assert.ok(bad.errors >= 1);
  assert.ok(bad.diagnostics.every((d) => d.file === "page.mkp.md" && d.line >= 1 && typeof d.message === "string"), JSON.stringify(bad.diagnostics));
  const good = compiler.build("page.mkp.md", "# Hello\n");
  assert.equal(good.errors, 0);
  assert.equal(good.ir.ir.module, "doc");
});

test("a pack given as text is used, and one the document names but isn't given is an error", () => {
  const pack = { path: "shapes/shapes.mkp", text: "package shapes;\n\npack shapes@1 {\n    provides double;\n}\n\nfn double(x: number): number {\n    return x * 2;\n}\n" };
  const doc = "import shapes;\n@@@\nTwice: \\{double(4)}\n";
  const ok = compiler.build("page.mkp.md", doc, [pack]);
  assert.equal(ok.errors, 0, JSON.stringify(ok.diagnostics));
  assert.ok(JSON.stringify(ok.ir).includes("shapes/double"));
  const missing = compiler.build("page.mkp.md", doc);
  assert.ok(missing.errors > 0 && missing.diagnostics.some((d) => d.code === "names.unknown-pack"), JSON.stringify(missing.diagnostics));
});
