// What every document target shares of a snapshot, and of what it tells the app went wrong: the
// plain web's MkpDoc here, and @mkp/view's for the frameworks.

import type { ir } from "@mkp/runtime";

/** What went wrong, for `onError`. */
export type DocError =
  | { kind: "refused"; rule?: string; code?: string; site?: string }
  | { kind: "failed"; rule?: string; code?: string; site?: string }
  | { kind: "load"; message: string }
  | { kind: "compile"; message: string; diagnostics: unknown[] };

/** Everything the page holds, as JSON: opaque to the app, which keeps it and gives it back. */
export interface Snapshot {
  mkp: string;
  /** A hash of the IR it was taken from: its places mean the same widgets only in the same IR. */
  ir: string;
  state: Record<string, ir.Expr>;
  own: Record<string, Record<string, ir.Expr>>;
}

/** What `restore` did. */
export interface Restored {
  /** "all" when the IR is the one it was taken from; "state" when only `$state` could go back;
   * "none" when the snapshot can't be read or its `$state` was refused. */
  restored: "all" | "state" | "none";
  /** What was left out: refused fields and places, or "own" for every widget's variables. */
  dropped: string[];
  why?: string;
}

/** A short, stable hash of a text: FNV-1a, 52 bits, in base 36. */
export function hash(text: string): string {
  let h1 = 0x811c9dc5;
  let h2 = 0x01000193;
  for (let k = 0; k < text.length; k++) {
    const c = text.charCodeAt(k);
    h1 = Math.imul(h1 ^ c, 16777619) >>> 0;
    h2 = Math.imul(h2 ^ c, 2246822519) >>> 0;
  }
  return (h2 % 0x100000).toString(36) + h1.toString(36);
}

/** The release snapshots are taken in: one of another can't be read. */
export const RELEASE = "0.3.0";
