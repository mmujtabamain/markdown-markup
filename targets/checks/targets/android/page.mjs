#!/usr/bin/env node
// The pages mkp-android's omnicui adapter mounts: one per contract test, written by the same code as
// the web's (targets/ts/web/omnicui/source.mjs: the widget called on its own, its props as MKP
// literals, each `mut` input bound to `$state`, each event to a handler, its slots filled), so both
// targets mount exactly the same page, and built with the mkp binary (cached per source).
//
// The adapter starts it once and writes one request per line on standard input; each answer is one
// line on standard output:
//
//   {"component": "core.slider", "props": {…}}  →  {"ir": "/tmp/…/<hash>.ir.json", "report": {…}}
//                                                or {"error": "…", "code": -32001}
//
//   node page.mjs [--contracts <file>]    (the file omnicui's `stubs:` writes: each contract's defaults)

import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, readdirSync, renameSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { createInterface } from "node:readline";
import { fileURLToPath } from "node:url";
import { declarations, pageSource, reporting, widgetOf } from "../../../ts/web/omnicui/source.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const repo = resolve(here, "../../../..");
const NO_COMPONENT = -32001;
const STEP_FAILED = -32003;

const k = process.argv.indexOf("--contracts");
const contractsFile = k >= 0 ? process.argv[k + 1] : undefined;
const defaults = new Map();
if (contractsFile && existsSync(contractsFile)) {
  for (const c of JSON.parse(readFileSync(contractsFile, "utf8"))) {
    defaults.set(c.id, Object.fromEntries((c.props ?? []).filter((p) => p.hasDefault).map((p) => [p.name, p.default])));
  }
}

const mkp = process.env.MKP_BINARY ?? ["release", "debug"].map((kind) => join(repo, "targets/rust/target", kind, "mkp")).find(existsSync);
if (!mkp) {
  process.stderr.write("[android] no mkp binary: run `cargo build --release` in targets/rust, or set MKP_BINARY\n");
  process.exit(2);
}

// one folder per compiler and core; the others are stale and go
const stamp = createHash("sha256");
for (const f of [mkp, ...readdirSync(join(repo, "core")).map((f) => join(repo, "core", f))]) {
  const s = statSync(f);
  stamp.update(`${f}:${s.size}:${s.mtimeMs}\n`);
}
const salt = stamp.digest("hex").slice(0, 16);
const caches = process.env.MKP_OMNICUI_ANDROID_CACHE ?? join(tmpdir(), "mkp-omnicui-android-ir");
const cache = join(caches, salt);
mkdirSync(cache, { recursive: true });
for (const d of readdirSync(caches)) if (d !== salt) rmSync(join(caches, d), { recursive: true, force: true });

/** A page's IR file, built once per source. */
function build(source, ext = ".mkp.md") {
  const hash = createHash("sha256").update(ext + source).digest("hex").slice(0, 24);
  const out = join(cache, `${hash}.ir.json`);
  if (!existsSync(out)) {
    const src = join(cache, `${hash}${ext}`);
    writeFileSync(src, source);
    try {
      execFileSync(mkp, ["build", src, "--out", `${out}.part`], { stdio: ["ignore", "pipe", "pipe"], maxBuffer: 64 * 1024 * 1024 });
    } catch (e) {
      throw Object.assign(new Error(`the page didn't build: ${String(e.stdout ?? "") + String(e.stderr ?? "")}`.replace(/\s+/g, " ").trim()), { code: STEP_FAILED });
    }
    renameSync(`${out}.part`, out);
  }
  return out;
}

// every core declaration: a pack's IR keeps all of core it builds on, a page's only what it uses
const decls = declarations(JSON.parse(readFileSync(build("package omnicui_core;\n", ".mkp"), "utf8")));

createInterface({ input: process.stdin }).on("line", (line) => {
  if (!line.trim()) return;
  let answer;
  try {
    const { component, props } = JSON.parse(line);
    const widget = widgetOf(component ?? "");
    if (!widget || !decls.widgets.has(widget)) throw Object.assign(new Error(`no component ${component}: this target mounts core's extern widgets, core.<widget>`), { code: NO_COMPONENT });
    let source;
    try {
      source = pageSource(widget, { ...(defaults.get(component) ?? {}), ...(props ?? {}) }, decls);
    } catch (e) {
      throw Object.assign(new Error(`mount ${component}: ${e.message}`), { code: STEP_FAILED });
    }
    answer = { ir: build(source), report: reporting(widget, decls) };
  } catch (e) {
    answer = { error: String(e?.message ?? e), code: e?.code ?? STEP_FAILED };
  }
  process.stdout.write(JSON.stringify(answer) + "\n");
});
