// Every `extern fn` core declares with no body is a native of this evaluator, or is on the
// written list of target-only fns (plan tab 14).

import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { natives } from "../dist/index.js";
import { xtmdBinary, workdir } from "./xtmd.mjs";

test("every bodyless core extern fn is a native or target-only", () => {
  // a pack's IR keeps all of core it builds on; a page's keeps only what the page uses
  const page = join(workdir(), "t.xtmdpack");
  writeFileSync(page, "package t;\n");
  const ir = JSON.parse(execFileSync(xtmdBinary(), ["build", page], { maxBuffer: 64 * 1024 * 1024 }).toString());
  const bodyless = ir.ir.declarations
    .map((d) => d.declare.extern?.fn)
    .filter((f) => f && f.supplier === "core" && !(f.default?.length > 0))
    .map((f) => f.name);
  assert.ok(bodyless.length > 50, `only ${bodyless.length} found`);
  assert.deepEqual(bodyless.filter((n) => !natives.exists(n) && !natives.TARGET_ONLY.includes(n)), []);
});
