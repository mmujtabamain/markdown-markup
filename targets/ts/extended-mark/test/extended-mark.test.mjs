// extended-mark is the xtmd package by another name: the same API, the same plugin, the same command.

import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const ours = join(here, "..", "bin", "xtmd.js");
const theirs = join(dirname(createRequire(import.meta.url).resolve("xtmd")), "..", "bin", "xtmd.js");

test("its API is xtmd's own: the same functions and error class, not copies", async () => {
  const em = await import("extended-mark");
  const x = await import("xtmd");
  assert.deepEqual(Object.keys(em).sort(), Object.keys(x).sort());
  for (const name of ["build", "check", "md", "format", "run", "findBinary", "XtmdError"]) assert.equal(em[name], x[name], name);
});

test("its Vite plugin is xtmd's", async () => {
  const em = await import("extended-mark/vite");
  const x = await import("xtmd/vite");
  assert.equal(em.default, x.default);
  assert.equal(em.xtmd, x.xtmd);
});

test("its xtmd command runs xtmd's, with the same arguments, output and exit code", () => {
  const run = (bin, args) => spawnSync(process.execPath, [bin, ...args], { encoding: "utf8" });
  const version = run(ours, ["--version"]);
  assert.equal(version.status, 0, version.stderr);
  assert.match(version.stdout, /^xtmd 0\.3\.\d+ \(Extended Mark 0\.3;/);
  assert.equal(version.stdout, run(theirs, ["--version"]).stdout);
  // a usage error: exit 2 from both, with the same message
  const a = run(ours, ["check", "no-such-file.xtmd"]);
  const b = run(theirs, ["check", "no-such-file.xtmd"]);
  assert.notEqual(a.status, 0);
  assert.deepEqual([a.status, a.stderr], [b.status, b.stderr]);
});
