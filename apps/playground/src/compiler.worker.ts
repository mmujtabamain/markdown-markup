// The compiler, in a worker of its own: xtmd.wasm with core compiled as it loads, and every build
// run here, so the editor never waits on one. A message is a build; its answer has its id.

import { Compiler, type Built, type PackFile } from "@extended-mark/wasm";

export interface Request {
  id: number;
  /** Where xtmd.wasm is. */
  wasm: string;
  /** Left out: only load the compiler, so core is compiled before the first page asks. */
  build?: { path: string; text: string; packs: PackFile[] };
}

export type Answer = { id: number; built?: Built; ms: number; loadMs?: number } | { id: number; error: string; stage: "load" | "build" };

let loading: Promise<Compiler> | undefined;
let loadMs: number | undefined;

self.onmessage = async (e: MessageEvent<Request>) => {
  const { id, wasm, build } = e.data;
  const reply = (a: Answer) => (self as unknown as Worker).postMessage(a);
  let compiler: Compiler;
  try {
    if (!loading) {
      const t = performance.now();
      loading = Compiler.load(wasm).then((c) => ((loadMs = Math.round(performance.now() - t)), c));
    }
    compiler = await loading;
  } catch (err) {
    // tried again at the next message
    loading = undefined;
    reply({ id, error: err instanceof Error ? err.message : String(err), stage: "load" });
    return;
  }
  if (!build) return reply({ id, ms: 0, loadMs });
  const t = performance.now();
  try {
    const built = compiler.build(build.path, build.text, build.packs);
    reply({ id, built, ms: Math.round(performance.now() - t), loadMs });
  } catch (err) {
    // a panic: the compiler starts again by itself for the next build
    reply({ id, error: err instanceof Error ? err.message : String(err), stage: "build" });
  }
};
