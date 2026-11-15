// MKP's widget contracts (targets/checks/contracts/, one per core extern widget) pass on the web
// target: omnicui drives omnicui_adapter.mjs, which mounts each widget with @mkp/runtime and
// @mkp/dom in a real Chromium. The omnicui binary is OMNICUI_BINARY, else ~/.local/bin/omnicui;
// with neither, the test is skipped and says why.

import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const repo = resolve(here, "../../../..");
const project = join(repo, "targets/checks");

function omnicui() {
  if (process.env.OMNICUI_BINARY) return process.env.OMNICUI_BINARY;
  const local = join(homedir(), ".local/bin/omnicui");
  return existsSync(local) ? local : undefined;
}

const binary = omnicui();
const skip = binary
  ? false
  : "no omnicui binary: set OMNICUI_BINARY, or build omnicui/tools/omnicui into ~/.local/bin/omnicui (go build -o ~/.local/bin/omnicui ./cmd/omnicui)";

test("every widget contract passes on the web target (omnicui check web)", { skip, timeout: 20 * 60 * 1000 }, () => {
  const run = spawnSync(binary, ["--project", project, "check", "web"], { cwd: repo, encoding: "utf8", maxBuffer: 64 * 1024 * 1024 });
  const out = `${run.stdout ?? ""}${run.stderr ?? ""}`;
  const summary = out.split("\n").find((l) => / pass · \d+ fail · /.test(l)) ?? "(no summary line)";
  process.stderr.write(`omnicui: ${summary}\n`);
  assert.equal(run.status, 0, `omnicui check web exited with ${run.status}:\n${out.split("\n").filter((l) => !l.startsWith("[web ")).join("\n")}`);
  assert.match(summary, / 0 fail · 0 broken · 0 not advertised/);
});
