// Version stamps: which MKP release made a bundle, a lock or a source file, and which IR shape it is
// in. Migrations read them to know where to start. A bundle carries `mkp` beside `ir`; a document
// (.mkp.md) carries `mkp:` and `ir:` in its front matter; a .mkp file (a pack's file or its
// manifest, a document's own .mkp) carries one comment line at its head: `# mkp 0.2.2 ir 1`. Older
// compilers ignore all three. Anything without a stamp was made by UNSTAMPED, the last release
// before stamps.

import { IR_VERSION } from './ir';
import { RELEASE } from './version';

export interface Stamp {
  /** the MKP release, e.g. "0.2.2" */
  mkp: string;
  /** the IR's shape version */
  ir: number;
}

/** The last release that wrote no stamps: what an unstamped bundle or file was made by. */
export const UNSTAMPED = '0.2.1';

/** This release's stamp. */
export const CURRENT: Stamp = { mkp: RELEASE, ir: IR_VERSION };

const HEAD = /^# mkp (\d+(?:\.\d+)*) ir (\d+)[ \t]*$/;
const isDoc = (file: string): boolean => /\.(mkp\.)?md$/i.test(file);

/** A bundle's stamp: its own, or UNSTAMPED's when it has none. */
export function bundleStamp(b: { mkp?: unknown; ir?: unknown }): Stamp & { stamped: boolean } {
  const mkp = typeof b.mkp === 'string' ? b.mkp : null;
  return { mkp: mkp ?? UNSTAMPED, ir: typeof b.ir === 'number' ? b.ir : 1, stamped: mkp !== null };
}

/** Splits a document into its front matter's lines and the rest; no front matter gives null. */
function frontOf(text: string): { lines: string[]; rest: string; nl: string } | null {
  const nl = text.includes('\r\n') ? '\r\n' : '\n';
  const lines = text.replace(/^﻿/, '').split(/\r?\n/);
  if (lines[0] !== '---') return null;
  const end = lines.indexOf('---', 1);
  if (end < 0) return null;
  return { lines: lines.slice(1, end), rest: lines.slice(end + 1).join(nl), nl };
}

/** The stamp a source file says it was written for, or null when it says none. */
export function readStamp(text: string, file: string): Stamp | null {
  if (isDoc(file)) {
    const f = frontOf(text);
    if (!f) return null;
    const get = (k: string): string | undefined => f.lines.map((l) => new RegExp(`^${k}:\\s*["']?([\\w.]+)["']?\\s*$`).exec(l)?.[1]).find(Boolean);
    const mkp = get('mkp');
    return mkp ? { mkp, ir: Number(get('ir') ?? IR_VERSION) } : null;
  }
  const first = text.replace(/^﻿/, '').split(/\r?\n/).find((l) => l.trim() !== '');
  const m = first ? HEAD.exec(first) : null;
  return m ? { mkp: m[1], ir: Number(m[2]) } : null;
}

/** The source with this stamp at its head, replacing any it had: front matter keys, or a .mkp's first line. */
export function writeStamp(text: string, file: string, s: Stamp = CURRENT): string {
  if (isDoc(file)) {
    const f = frontOf(text);
    const nl = f?.nl ?? (text.includes('\r\n') ? '\r\n' : '\n');
    const keep = (f?.lines ?? []).filter((l) => !/^(mkp|ir):/.test(l));
    const front = [`mkp: ${s.mkp}`, `ir: ${s.ir}`, ...keep];
    return ['---', ...front, '---', f ? f.rest : text].join(nl);
  }
  const nl = text.includes('\r\n') ? '\r\n' : '\n';
  const lines = text.replace(/^﻿/, '').split(/\r?\n/);
  const at = lines.findIndex((l) => l.trim() !== '');
  if (at >= 0 && HEAD.test(lines[at])) lines.splice(at, 1);
  return [`# mkp ${s.mkp} ir ${s.ir}`, ...lines].join(nl);
}

/** Compares two releases number by number: -1, 0 or 1. */
export function compareReleases(a: string, b: string): number {
  const x = a.split('.').map(Number);
  const y = b.split('.').map(Number);
  for (let i = 0; i < Math.max(x.length, y.length); i++) if ((x[i] ?? 0) !== (y[i] ?? 0)) return (x[i] ?? 0) < (y[i] ?? 0) ? -1 : 1;
  return 0;
}
