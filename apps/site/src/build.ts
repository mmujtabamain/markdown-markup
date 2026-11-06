// Compiling what the source pane holds, the way `mkp check` and `mkp build` do: the example's
// pack/ or host/ folder (or a limit's) is a pack, doc.mkp is the document's own file, and the
// .mkp.md is the document. One list of diagnostics covers all of it, in the order the compiler
// gives them.

import { compile, Diagnostics, prerender, Runtime, walkView, type Compiled, type Diagnostic, type IRBundle, type MathsEngine, type PackSource, type VNode } from '@mkp/core';
import type { SourceFile } from './catalog';

export interface BuildResult {
  bundle: IRBundle | null;
  diags: Diagnostic[];
  compiled: Compiled;
  /** how long the compile took, in milliseconds */
  ms: number;
}

const enc = new TextEncoder();

/** The packs among the files, one per folder, plus packs opened from disk. */
export function packsOf(files: SourceFile[], extra: PackSource[] = []): PackSource[] {
  const byPack = new Map<string, Map<string, Uint8Array>>();
  for (const f of files) {
    if (f.role !== 'pack' || !f.pack || !f.inPack) continue;
    const m = byPack.get(f.pack) ?? new Map<string, Uint8Array>();
    m.set(f.inPack, enc.encode(f.text));
    byPack.set(f.pack, m);
  }
  return [...[...byPack].map(([label, m]) => ({ label, files: m })), ...extra];
}

export interface BuildOptions {
  /** packs opened from disk, which every opened document sees */
  extraPacks?: PackSource[];
  /** typesets and checks the maths, as `mkp build` does */
  maths?: MathsEngine | null;
  /** a pack's fixture case: it may use the pack's private parts */
  allowParts?: boolean;
  privateOf?: string;
}

export function build(files: SourceFile[], opts: BuildOptions = {}): BuildResult {
  const t0 = performance.now();
  const compiled = compile({ packs: packsOf(files, opts.extraPacks) });
  const doc = files.find((f) => f.role === 'doc');
  const own = files.find((f) => f.role === 'docFile');
  let bundle: IRBundle | null = null;
  if (doc) {
    try {
      bundle = compiled.document(doc.text, doc.path, compiled.diags, { docFile: own ? { text: own.text, file: own.path } : undefined, allowParts: opts.allowParts, privateOf: opts.privateOf });
      if (bundle && opts.maths) prerender(bundle, opts.maths, compiled.diags);
      if (bundle && !compiled.diags.ok) bundle = null;
    } catch (e) {
      // a compiler fault is a diagnostic too, never a blank page
      compiled.diags.error('mkp.internal', `the compiler stopped: ${(e as Error).message}`, { file: doc.path, line: 1, col: 1 });
      bundle = null;
    }
  }
  return { bundle, diags: compiled.diags.items, compiled, ms: performance.now() - t0 };
}

/** A diagnostic as `mkp check --format json` prints it: one line of JSON. */
export function jsonLine(d: Diagnostic): string {
  const { severity, code, message, pos, path } = d;
  return JSON.stringify({ severity, code, message, file: pos?.file, line: pos?.line, col: pos?.col, ...(path ? { path } : {}) });
}

/** An error a block draws in its place (a runtime limit: budget, list size, depth), with its line. */
export interface DrawnError {
  code: string;
  message: string;
  name: string;
  pos?: { file: string; line: number; col: number };
}

/** The errors drawn in a runtime's view. */
export function drawnErrors(rt: Runtime): DrawnError[] {
  const out: DrawnError[] = [];
  try {
    walkView(rt.view(), (n: VNode) => {
      if (n.t !== 'error') return;
      const p = n.p as Record<string, unknown>;
      const src = n.src;
      out.push({ code: String(p.code ?? 'mkp.error'), message: String(p.message ?? ''), name: String(p.summary ?? p.name ?? ''), pos: src ? { file: src[0], line: src[1], col: src[2] } : undefined });
    });
  } catch (e) {
    out.push({ code: 'mkp.internal', message: (e as Error).message, name: 'the document' });
  }
  return out;
}

/** A fresh Diagnostics, for callers that compile on their own. */
export const newDiagnostics = (): Diagnostics => new Diagnostics();
