// The JS API runs the native xtmd binary: check, build, md and format.

import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { build, check, format, md, XtmdError } from "../dist/index.js";

const dir = mkdtempSync(join(tmpdir(), "xtmd-cli-api-"));
const page = join(dir, "page.xt.md");
writeFileSync(page, "$state {\n    tries: int = 2;\n}\n@@@\n# Tries\n\nTried \\{$state.tries} times.\n");
const bad = join(dir, "bad.xtpack");
writeFileSync(bad, "package t;\n\nlet x: number = y;\n");

test("check gives every diagnostic as data", async () => {
  assert.deepEqual(await check(page), []);
  const found = await check(bad);
  assert.equal(found.length, 1);
  assert.equal(found[0].code, "names.unknown-name");
  assert.deepEqual([found[0].line, found[0].column], [3, 17]);
});

test("build gives the lowered IR", async () => {
  const ir = await build(page);
  assert.equal(ir.ir.module, "doc");
  assert.deepEqual(ir.ir.levels, ["core.draw"]);
  assert.ok(Array.isArray(ir.ir.bindings) && ir.ir.bindings.length > 0, "a sentence that reads $state is a binding");
  await assert.rejects(build(bad), XtmdError);
});

test("md writes the page with its starting values", async () => {
  assert.equal(await md(page), "# Tries\n\nTried 2 times.\n");
});

test("format says whether a file is in the canonical layout", async () => {
  assert.equal(await format(page, { check: true }), true);
});
