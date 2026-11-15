// The test target, checked the way `mkp target check` uses it: every target check passes on it,
// each of its defects is caught by some check, and its adapter speaks the check protocol.

import { describe, test } from "node:test";
import assert from "node:assert/strict";
import { spawn, spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { createInterface } from "node:readline";
import { DEFECTS } from "../defects.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const target = join(here, "..");
const repo = join(target, "../../..");

/** The mkp binary: MKP_BINARY, or the repo's own build. */
function mkp() {
  const found = [process.env.MKP_BINARY, join(repo, "targets/rust/target/release/mkp"), join(repo, "targets/rust/target/debug/mkp")].find((p) => p && existsSync(p));
  assert.ok(found, "no mkp binary: build targets/rust or set MKP_BINARY");
  return found;
}

/** `mkp target check test`, run without blocking, so several can run at once. */
function check(...args) {
  return new Promise((resolve) => {
    const child = spawn(mkp(), ["target", "check", "test", ...args], { cwd: repo });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (d) => (stdout += d));
    child.stderr.on("data", (d) => (stderr += d));
    child.on("exit", (status) => resolve({ status, stdout, stderr }));
  });
}

test("every target check passes on the test target", async () => {
  const r = await check();
  assert.equal(r.status, 0, r.stdout + r.stderr);
  assert.match(r.stdout, /test: \d+ cases, \d+ steps, 0 differ from the case/);
});

describe("each defect is caught", { concurrency: 4 }, () => {
  for (const [name, what] of Object.entries(DEFECTS)) {
    test(`${name}: ${what}`, async () => {
      const r = await check("--defect", name, "--expect-failures");
      assert.equal(r.status, 0, `nothing caught ${name}:\n${r.stdout}${r.stderr}`);
      assert.match(r.stdout, /caught: \d+ differences/);
    });
  }
});

test("a defect that isn't one is refused", () => {
  const r = spawnSync("node", ["adapter.mjs"], { cwd: target, env: { ...process.env, MKP_TEST_DEFECT: "no-such-defect" }, encoding: "utf8", input: "" });
  assert.equal(r.status, 2);
  assert.match(r.stderr, /no defect no-such-defect/);
});

/** The adapter, driven by hand over JSON-RPC. */
function adapter() {
  const child = spawn("node", ["adapter.mjs"], { cwd: target, stdio: ["pipe", "pipe", "inherit"] });
  const lines = createInterface({ input: child.stdout });
  const waiting = new Map();
  lines.on("line", (l) => {
    const m = JSON.parse(l);
    waiting.get(m.id)?.(m);
  });
  let next = 1;
  return {
    call(method, params = {}) {
      const id = next++;
      return new Promise((resolve) => {
        waiting.set(id, resolve);
        child.stdin.write(JSON.stringify({ jsonrpc: "2.0", id, method, params }) + "\n");
      });
    },
    done: new Promise((resolve) => child.on("exit", resolve)),
  };
}

test("the adapter speaks the check protocol: advertise, load, a step, observe, quit", async () => {
  const dir = mkdtempSync(join(tmpdir(), "mkp-test-target-"));
  try {
    const src = join(dir, "page.mkp.md");
    writeFileSync(src, '$state {\n    n: int 0..3 = 0;\n}\n@@@\n@slider(value = $state.n, label = "N");\n');
    const ir = join(dir, "page.ir.json");
    const b = spawnSync(mkp(), ["build", src, "-o", ir], { encoding: "utf8" });
    if (b.status !== 0) writeFileSync(ir, spawnSync(mkp(), ["build", src], { encoding: "utf8" }).stdout);
    const a = adapter();
    const ad = await a.call("advertise", { protocol: "1" });
    assert.deepEqual(ad.result, { name: "test", protocol: "1", levels: ["core.draw", "core.live", "core.gfx"], supplies: ["core/*", "core/can_draw_tex", "core/moment.local"] });
    const before = await a.call("observe");
    assert.equal(before.error.message, "no page is loaded");
    await a.call("load", { ir, page: { width: "NARROW" } });
    let o = (await a.call("observe")).result;
    assert.equal(o.tree.s0.widget, "core/slider");
    assert.deepEqual(o.state, { n: { num: "0" } });
    await a.call("write", { site: "s0", input: "value", value: { num: "2" } });
    o = (await a.call("observe")).result;
    assert.deepEqual(o.state, { n: { num: "2" } });
    assert.deepEqual(o.outcome, { refused: [], failures: [] });
    await a.call("write", { site: "s0", input: "value", value: { num: "9" } });
    o = (await a.call("observe")).result;
    assert.deepEqual(o.state, { n: { num: "2" } });
    assert.deepEqual(o.outcome.refused, [{ code: "contracts.outside", site: "s0" }]);
    const unknown = await a.call("dance");
    assert.equal(unknown.error.code, -32601);
    await a.call("quit");
    assert.equal(await a.done, 0);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
