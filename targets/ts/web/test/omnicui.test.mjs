// MKP's widget contracts (targets/checks/contracts/, one per core extern widget) pass on the web
// target: omnicui drives omnicui_adapter.mjs, which mounts each widget with @mkp/runtime and
// @mkp/dom in a real Chromium. The omnicui binary is the release external/omnicui/omnicui.lock
// names, which external/omnicui/fetch.sh fetches and checks (or OMNICUI_BINARY, which it passes
// through); when it can't, the test is skipped and says why.

import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const repo = resolve(here, "../../../..");
const project = join(repo, "targets/checks");

function omnicui() {
  const run = spawnSync(join(repo, "external/omnicui/fetch.sh"), [], { encoding: "utf8" });
  return run.status === 0 ? { path: run.stdout.trim() } : { why: run.stderr.trim() };
}

const found = omnicui();
const binary = found.path;
const skip = binary ? false : `no omnicui binary: external/omnicui/fetch.sh says ${found.why || "nothing"}`;

test("every widget contract passes on the web target (omnicui check web)", { skip, timeout: 20 * 60 * 1000 }, () => {
  const run = spawnSync(binary, ["--project", project, "check", "web"], { cwd: repo, encoding: "utf8", maxBuffer: 64 * 1024 * 1024 });
  const out = `${run.stdout ?? ""}${run.stderr ?? ""}`;
  const summary = out.split("\n").find((l) => / pass · \d+ fail · /.test(l)) ?? "(no summary line)";
  process.stderr.write(`omnicui: ${summary}\n`);
  assert.equal(run.status, 0, `omnicui check web exited with ${run.status}:\n${out.split("\n").filter((l) => !l.startsWith("[web ")).join("\n")}`);
  assert.match(summary, / 0 fail · 0 broken · 0 not advertised/);
});
