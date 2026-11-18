// The MKP compiler in the browser: mkp-wasm, built for wasm32-wasip1 (targets/rust/wasm), and the
// little it asks of its host. A real-time target compiles a document's text as it is edited with
// `Compiler.build`, and draws the IR it gives as a run-time target draws one it was given: the
// same IR `mkp build` writes.
//
// The module asks for six WASI functions only (randomness, the clock, its environment, writing to
// standard error, and exiting); they are answered here, so nothing else is needed, in a browser,
// a worker or Node.

/** A file a pack is made of: its path, as its `package` and imports name it, and its text. */
export interface PackFile {
  path: string;
  text: string;
}

/** A diagnostic, as `mkp check --format json` writes one. */
export interface Diagnostic {
  type: "diagnostic";
  file: string;
  code: string;
  severity: "error" | "warning" | "note";
  line: number;
  column: number;
  end: { line: number; column: number };
  message: string;
  fix?: string | null;
}

/** Where a call is written: its first line and column, and where it ends. */
export interface Written {
  line: number;
  column: number;
  end: { line: number; column: number };
}

/** What a build gives: the IR file `mkp build` writes, or null when there are errors; every
 * diagnostic of the file built (and the errors of its packs); and where each call in the file is
 * written, by its template (`doc`, `doc/share`) and site (`s1`), so an editor can mark the call a
 * failed widget's site names. No IR holds that: a page runs without its source. */
export interface Built {
  ir: { ir: Record<string, unknown> } | null;
  diagnostics: Diagnostic[];
  errors: number;
  sites: Record<string, Record<string, Written>>;
}

/** Where the module comes from: its URL, its bytes, a response for it, or the module compiled. */
export type WasmSource = string | URL | ArrayBuffer | ArrayBufferView | Response | WebAssembly.Module;

interface Exports {
  memory: WebAssembly.Memory;
  _initialize(): void;
  mkp_alloc(len: number): number;
  mkp_free(ptr: number, len: number): void;
  mkp_new(): number;
  mkp_build(compiler: number, ptr: number, len: number): number;
}

/** The module stopped (`proc_exit`): a panic in the compiler. The instance can't be used again. */
class Exit extends Error {}

/** The WASI functions the module imports, answered over its memory. */
function wasi(memory: () => WebAssembly.Memory, log: (line: string) => void) {
  const view = () => new DataView(memory().buffer);
  let pending = "";
  const decoder = new TextDecoder();
  return {
    random_get(ptr: number, len: number): number {
      const bytes = new Uint8Array(memory().buffer, ptr, len);
      for (let k = 0; k < len; k += 65536) crypto.getRandomValues(bytes.subarray(k, Math.min(len, k + 65536)));
      return 0;
    },
    environ_sizes_get(count: number, size: number): number {
      view().setUint32(count, 0, true);
      view().setUint32(size, 0, true);
      return 0;
    },
    environ_get(): number {
      return 0;
    },
    clock_time_get(_id: number, _precision: bigint, out: number): number {
      view().setBigUint64(out, BigInt(Math.round(Date.now() * 1e6)), true);
      return 0;
    },
    // standard output and error, a line at a time: a panic's message comes this way
    fd_write(_fd: number, iovs: number, count: number, written: number): number {
      const v = view();
      let n = 0;
      for (let k = 0; k < count; k++) {
        const ptr = v.getUint32(iovs + k * 8, true);
        const len = v.getUint32(iovs + k * 8 + 4, true);
        pending += decoder.decode(new Uint8Array(memory().buffer, ptr, len));
        n += len;
      }
      const lines = pending.split("\n");
      pending = lines.pop() ?? "";
      for (const l of lines) log(l);
      v.setUint32(written, n, true);
      return 0;
    },
    proc_exit(code: number): never {
      throw new Exit(`mkp.wasm exited with ${code}`);
    },
  };
}

async function compile(source: WasmSource): Promise<WebAssembly.Module> {
  if (source instanceof WebAssembly.Module) return source;
  if (typeof Response !== "undefined" && source instanceof Response) return WebAssembly.compile(await source.arrayBuffer());
  if (source instanceof ArrayBuffer || ArrayBuffer.isView(source)) return WebAssembly.compile(source as BufferSource);
  const url = new URL(String(source), typeof location !== "undefined" ? location.href : undefined);
  if (url.protocol === "file:") {
    // Node: fetch has no files. Named out of a bundler's sight, as a browser never comes here
    const fs = "node:fs/promises";
    const { readFile } = (await import(/* @vite-ignore */ /* webpackIgnore: true */ fs)) as typeof import("node:fs/promises");
    return WebAssembly.compile(await readFile(url));
  }
  const r = await fetch(url);
  if (!r.ok) throw new Error(`mkp.wasm couldn't be loaded from ${url}: ${r.status} ${r.statusText}`);
  return WebAssembly.compile(await r.arrayBuffer());
}

/** The compiler: load it once (core is compiled then), and build every document with it. */
export class Compiler {
  private ex!: Exports;
  private handle = 0;
  /** What the module wrote to standard error, a panic's message among it, last first cleared. */
  private said: string[] = [];
  private readonly encoder = new TextEncoder();
  private readonly decoder = new TextDecoder();

  private constructor(private readonly module: WebAssembly.Module) {}

  /**
   * Loads the compiler. `source` is where mkp.wasm is: its URL (as a bundler gives it for
   * `@mkp/wasm/mkp.wasm`), its bytes, or the module compiled; left out, the mkp.wasm beside this
   * file, which works where `import.meta.url` is this file's own (Node, an unbundled module).
   */
  static async load(source?: WasmSource): Promise<Compiler> {
    const c = new Compiler(await compile(source ?? new URL("../mkp.wasm", import.meta.url)));
    c.start();
    return c;
  }

  private start(): void {
    let memory: WebAssembly.Memory | undefined;
    const imports = { wasi_snapshot_preview1: wasi(() => memory!, (l) => this.said.push(l)) };
    const instance = new WebAssembly.Instance(this.module, imports as unknown as WebAssembly.Imports);
    this.ex = instance.exports as unknown as Exports;
    memory = this.ex.memory;
    this.ex._initialize();
    this.handle = this.ex.mkp_new();
  }

  /**
   * Builds one file: `path` ending in `.mkp.md` for a document, else a pack's file; its `text`; and
   * the files of the packs it uses. Gives the IR as `mkp build` writes it, or the errors.
   */
  build(path: string, text: string, packs: PackFile[] = []): Built {
    const req = this.encoder.encode(JSON.stringify({ path, text, packs }));
    const ex = this.ex;
    this.said = [];
    let reply: number;
    try {
      const ptr = ex.mkp_alloc(req.length);
      new Uint8Array(ex.memory.buffer, ptr, req.length).set(req);
      try {
        reply = ex.mkp_build(this.handle, ptr, req.length);
      } finally {
        ex.mkp_free(ptr, req.length);
      }
    } catch (e) {
      // a panic: the instance is spent, so the next build starts a new one
      const why = this.said.join("\n") || (e instanceof Error ? e.message : String(e));
      this.start();
      throw new Error(`the compiler stopped on ${path}: ${why}`);
    }
    const len = new DataView(ex.memory.buffer).getUint32(reply, true);
    const json = this.decoder.decode(new Uint8Array(ex.memory.buffer, reply + 4, len));
    ex.mkp_free(reply, 4 + len);
    return JSON.parse(json) as Built;
  }
}
