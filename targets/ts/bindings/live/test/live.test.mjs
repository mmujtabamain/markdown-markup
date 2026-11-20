// @extended-mark/live in Node, with the real xtmd.wasm: a text compiled into a page's IR, a broken draft that
// leaves the last page and says why, and a compiler that answers late.

import { test } from "node:test";
import assert from "node:assert/strict";
import { Doc, toHtml } from "@extended-mark/view";
import { Live, compiler } from "../dist/index.js";

const counter = (title) => `$state {\n    n: int 0..10 = 0;\n}\n@@@\n# ${title}: \\{$state.n}\n\n@press(label = "Add one", click = fn() {\n    $state.n = ($state.n + 1).clamp(0, 10);\n});\n`;
const tick = () => new Promise((r) => setTimeout(r, 0));

/** Waits until `f` holds, for the compiler's first load. */
async function until(f) {
  for (let k = 0; k < 400 && !f(); k++) await new Promise((r) => setTimeout(r, 25));
  assert.ok(f());
}

test("a text compiles into the IR a run-time target draws, and a broken draft leaves the last page", async () => {
  const errors = [];
  let changes = 0;
  const live = new Live(() => changes++);
  live.update({ source: counter("Count") }, (e) => errors.push(e));
  await until(() => live.ir);
  assert.equal(live.ir.ir.module, "doc");
  assert.deepEqual(errors, []);
  const first = live.ir;
  // drawn as <XtmdDoc ir={…}> draws it
  const doc = new Doc({ ir: live.ir });
  assert.ok(toHtml(doc.render()).includes("Count: 0"));
  // the same text again: nothing compiled, the same IR
  live.update({ source: counter("Count") }, (e) => errors.push(e));
  assert.equal(live.ir, first);
  const before = changes;
  // a draft with an error: the last page stays, the error is told with where it is
  live.update({ source: "$state {\n    n: int 0..10 = 0;\n}\n@@@\n# \\{$state.nope}\n" }, (e) => errors.push(e));
  assert.equal(live.ir, first);
  assert.equal(errors.length, 1);
  assert.equal(errors[0].kind, "compile");
  assert.match(errors[0].message, /^page\.xtmd doesn't compile \(1 error\): page\.xtmd:5:/);
  assert.ok(errors[0].diagnostics.length >= 1);
  assert.ok(live.diagnostics.some((d) => d.severity === "error"));
  assert.equal(changes, before + 1);
  // fixed: a new page
  live.update({ source: counter("Total") }, (e) => errors.push(e));
  assert.notEqual(live.ir, first);
  assert.deepEqual(live.diagnostics.filter((d) => d.severity === "error"), []);
  doc.update({ ir: live.ir });
  assert.ok(toHtml(doc.render()).includes("Total: 0"));
});

test("the compiler is loaded once for the page", async () => {
  assert.equal(compiler(), compiler());
  const c = await compiler();
  assert.equal(c.build("page.xtmd", "# Hi\n").errors, 0);
});

test("a compiler that answers late: the latest text wins, whatever order the answers come in", async () => {
  const c = await compiler();
  const waiting = [];
  const slow = { build: (path, text, packs) => new Promise((done) => waiting.push(() => done(c.build(path, text, packs)))) };
  const live = new Live(() => {});
  live.update({ source: counter("One"), compiler: slow });
  live.update({ source: counter("Two"), compiler: slow });
  // the second answers first, then the first, late
  waiting[1]();
  await tick();
  waiting[0]();
  await tick();
  assert.ok(JSON.stringify(live.ir).includes("Two"));
  assert.ok(!JSON.stringify(live.ir).includes("One"));
});

test("a compiler that can't be loaded is told as a load error", async () => {
  const errors = [];
  const live = new Live(() => {});
  live.update({ source: "# Hi\n", wasm: new Uint8Array([0, 1, 2, 3]) }, (e) => errors.push(e));
  await until(() => errors.length);
  assert.equal(errors[0].kind, "load");
  assert.equal(live.ir, undefined);
});
