// The xtmd compiler, run for build tools. Every call runs the native binary: there is one
// compiler, and nothing here turns source into IR itself. On a platform with no binary, `build`
// and `check` run the same compiler built as WebAssembly (@extended-mark/wasm).

import { execFile } from "node:child_process";
import { readdir, readFile, stat } from "node:fs/promises";
import { join } from "node:path";
import type { Built, Compiler, PackFile } from "@extended-mark/wasm";
import { findBinary, locateBinary } from "./binary.js";

export { findBinary, locateBinary } from "./binary.js";

export interface Options {
  /** Packs the document uses: folders and .xtmdpack files. */
  packs?: string[];
  /** An xtmd.toml; left out, xtmd looks beside the file and in the folders above. */
  config?: string;
}

export interface Diagnostic {
  file: string;
  code: string;
  severity: "error" | "warning";
  line: number;
  column: number;
  end: { line: number; column: number };
  message: string;
  fix?: string | null;
}

/** The IR file `xtmd build` writes: `{ "ir": { … } }`, as schemas/ir.schema.json defines it. */
export interface IrFile {
  ir: { version: number; module: string; levels: string[]; [key: string]: unknown };
}

/** A compile that failed, with what the compiler said. */
export class XtmdError extends Error {
  constructor(message: string, readonly output: string) {
    super(message);
    this.name = "XtmdError";
  }
}

interface Run {
  code: number;
  stdout: string;
  stderr: string;
}

/** Runs `xtmd` with these arguments. A non-zero exit is an answer, not a failure to run. */
export function run(args: string[]): Promise<Run> {
  const binary = findBinary();
  return new Promise((resolve, reject) => {
    execFile(binary, args, { maxBuffer: 256 * 1024 * 1024 }, (error, stdout, stderr) => {
      const code = (error as { code?: unknown } | null)?.code;
      if (error && typeof code !== "number") reject(error);
      else resolve({ code: typeof code === "number" ? code : 0, stdout, stderr });
    });
  });
}

function flags(o: Options = {}): string[] {
  const out: string[] = [];
  if (o.packs?.length) out.push("--pack", o.packs.join(","));
  if (o.config) out.push("--config", o.config);
  return out;
}

// ---- with no binary: the compiler as WebAssembly

let wasm: Promise<Compiler> | undefined;

/** A pack's files, as the compiler reads them: each `.xtmdpack` in a folder, and each file named. */
async function packFiles(packs: string[] = []): Promise<PackFile[]> {
  const out: PackFile[] = [];
  const add = async (path: string): Promise<void> => {
    if ((await stat(path)).isDirectory()) {
      for (const name of (await readdir(path)).sort()) await add(join(path, name));
    } else if (path.endsWith(".xtmdpack")) {
      out.push({ path, text: await readFile(path, "utf8") });
    }
  };
  for (const p of packs) await add(p);
  return out;
}

/** A file built by @extended-mark/wasm, the same compiler: what `build` and `check` give where no binary
 * fits the platform. It reads no xtmd.toml, so a document whose packs' versions it names needs
 * the binary. */
async function wasmBuild(file: string, options: Options = {}): Promise<Built> {
  if (options.config) throw new XtmdError(`no xtmd binary for ${process.platform}-${process.arch}, and @extended-mark/wasm reads no xtmd.toml (${options.config})`, "");
  wasm ??= import("@extended-mark/wasm").then((m) => m.Compiler.load());
  const compiler = await wasm;
  return compiler.build(file, await readFile(file, "utf8"), await packFiles(options.packs));
}

/** Diagnostics as `xtmd check` prints them: `file:line:column: severity[code]: message`. */
function said(ds: Diagnostic[]): string {
  return ds.map((d) => `${d.file}:${d.line}:${d.column}: ${d.severity}[${d.code}]: ${d.message}`).join("\n");
}

// ---- the commands

/** Every error and warning in a file, compiled with core and its packs. */
export async function check(file: string, options?: Options): Promise<Diagnostic[]> {
  if (!locateBinary()) {
    const b = await wasmBuild(file, options);
    return b.diagnostics.filter((d) => d.severity !== "note").map(({ type: _, ...d }) => d as Diagnostic);
  }
  const r = await run(["check", "--format", "json", ...flags(options), file]);
  if (r.code === 2) throw new XtmdError(r.stderr.trim(), r.stderr);
  // a JSON object a line: each diagnostic, each file, then the summary
  const lines = r.stdout.split("\n").filter((l) => l.trim()).map((l) => JSON.parse(l) as { type: string } & Diagnostic);
  return lines.filter((l) => l.type === "diagnostic").map(({ type: _, ...d }) => d as Diagnostic);
}

/** A document's IR, lowered: what a runtime runs. */
export async function build(file: string, options?: Options): Promise<IrFile> {
  if (!locateBinary()) {
    const b = await wasmBuild(file, options);
    if (!b.ir) {
      const text = said(b.diagnostics.filter((d) => d.severity === "error").map(({ type: _, ...d }) => d as Diagnostic));
      throw new XtmdError(`${file} doesn't compile:\n${text}`, text);
    }
    return b.ir as unknown as IrFile;
  }
  const r = await run(["build", ...flags(options), file]);
  if (r.code !== 0) throw new XtmdError(`${file} doesn't compile:\n${r.stderr.trim()}`, r.stderr);
  return JSON.parse(r.stdout) as IrFile;
}

/** A document's Markdown, with its starting values. */
export async function md(file: string, options?: Options): Promise<string> {
  const r = await run(["md", ...flags(options), file]);
  if (r.code !== 0) throw new XtmdError(`${file} doesn't compile:\n${r.stderr.trim()}`, r.stderr);
  return r.stdout;
}

/** Whether a file is in the canonical layout (`check`), or the file printed in it. */
export async function format(file: string, opts: { check?: boolean } = {}): Promise<boolean> {
  const r = await run(["fmt", ...(opts.check ? ["--check"] : []), file]);
  if (r.code === 2) throw new XtmdError(r.stderr.trim(), r.stderr);
  return r.code === 0;
}
