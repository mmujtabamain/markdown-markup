// The mkp compiler, run for build tools. Every call runs the native binary: there is one
// compiler, and nothing here turns source into IR itself.

import { execFile } from "node:child_process";
import { findBinary } from "./binary.js";

export { findBinary } from "./binary.js";

export interface Options {
  /** Packs the document uses: folders and .mkp files. */
  packs?: string[];
  /** An mkp.toml; left out, mkp looks beside the file and in the folders above. */
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

/** The IR file `mkp build` writes: `{ "ir": { … } }`, as schemas/ir.schema.json defines it. */
export interface IrFile {
  ir: { version: number; module: string; levels: string[]; [key: string]: unknown };
}

/** A compile that failed, with what the compiler said. */
export class MkpError extends Error {
  constructor(message: string, readonly output: string) {
    super(message);
    this.name = "MkpError";
  }
}

interface Run {
  code: number;
  stdout: string;
  stderr: string;
}

/** Runs `mkp` with these arguments. A non-zero exit is an answer, not a failure to run. */
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

/** Every error and warning in a file, compiled with core and its packs. */
export async function check(file: string, options?: Options): Promise<Diagnostic[]> {
  const r = await run(["check", "--format", "json", ...flags(options), file]);
  if (r.code === 2) throw new MkpError(r.stderr.trim(), r.stderr);
  // a JSON object a line: each diagnostic, each file, then the summary
  const lines = r.stdout.split("\n").filter((l) => l.trim()).map((l) => JSON.parse(l) as { type: string } & Diagnostic);
  return lines.filter((l) => l.type === "diagnostic").map(({ type: _, ...d }) => d as Diagnostic);
}

/** A document's IR, lowered: what a runtime runs. */
export async function build(file: string, options?: Options): Promise<IrFile> {
  const r = await run(["build", ...flags(options), file]);
  if (r.code !== 0) throw new MkpError(`${file} doesn't compile:\n${r.stderr.trim()}`, r.stderr);
  return JSON.parse(r.stdout) as IrFile;
}

/** A document's Markdown, with its starting values. */
export async function md(file: string, options?: Options): Promise<string> {
  const r = await run(["md", ...flags(options), file]);
  if (r.code !== 0) throw new MkpError(`${file} doesn't compile:\n${r.stderr.trim()}`, r.stderr);
  return r.stdout;
}

/** Whether a file is in the canonical layout (`check`), or the file printed in it. */
export async function format(file: string, opts: { check?: boolean } = {}): Promise<boolean> {
  const r = await run(["fmt", ...(opts.check ? ["--check"] : []), file]);
  if (r.code === 2) throw new MkpError(r.stderr.trim(), r.stderr);
  return r.code === 0;
}
