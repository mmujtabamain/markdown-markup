// Test helpers: the Rust compiler (the xtmd binary) builds Extended Mark sources into IR, which the
// TypeScript evaluator then runs.

import { execFileSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { Constants, Machine, Program } from "../dist/index.js";

export const repo = join(dirname(fileURLToPath(import.meta.url)), "../../../..");

/** The release binary, or the debug one. */
export function xtmdBinary() {
  for (const kind of ["release", "debug"]) {
    const p = join(repo, "targets/rust/target", kind, "xtmd");
    if (existsSync(p)) {
      return p;
    }
  }
  throw new Error("no xtmd binary: run `cargo build --release` in targets/rust");
}

export function workdir() {
  return mkdtempSync(join(tmpdir(), "xtmd-runtime-test-"));
}

/** `file:line:col: error[code]: message` lines of the compiler's output. */
function diagnostics(text, file) {
  const out = [];
  for (const line of text.split("\n")) {
    const m = /^(.*?):(\d+):(\d+): (error|warning)\[([^\]]+)\]: (.*)$/.exec(line);
    if (m && m[1].endsWith(file) && m[4] === "error") {
      out.push({ line: Number(m[2]), col: Number(m[3]), code: m[5], message: m[6] });
    }
  }
  return out;
}

/** Builds `source` as `<name>.xtmdpack` in `dir`: its IR module, or its errors. */
export function build(dir, name, source) {
  const file = join(dir, `${name}.xtmdpack`);
  const out = join(dir, `${name}.ir.json`);
  writeFileSync(file, source);
  try {
    execFileSync(xtmdBinary(), ["build", file, "--out", out], { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"], maxBuffer: 64 * 1024 * 1024 });
  } catch (e) {
    const text = `${e.stdout ?? ""}\n${e.stderr ?? ""}`;
    return { ok: false, errors: diagnostics(text, `${name}.xtmdpack`), output: text.trim() };
  }
  const ir = JSON.parse(readFileSync(out, "utf8")).ir;
  return { ok: true, ir, errors: [] };
}

/** The module's declarations of one kind, by full name. */
export function declarations(ir, kind) {
  const out = new Map();
  for (const d of ir.declarations) {
    if (kind in d.declare) {
      out.set(d.declare[kind].name, d.declare[kind]);
    }
  }
  return out;
}

/** A Program for the module, with its constant lets worked out in order, as the Markdown writer
 * (compiler/markdown/src/render.rs) loads them. */
export function program(ir) {
  const prog = Program.fromModule(ir);
  for (const [name, l] of declarations(ir, "let")) {
    try {
      prog.lets.set(name, new Machine(prog, new Constants()).eval(l.value));
    } catch {
      // a let that isn't a constant: left out, as render.rs does
    }
  }
  return prog;
}
