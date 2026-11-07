// Migrations (the plan in the docs): each release ships one step that turns the previous release's
// IR into its own, and x to y runs every step in between, in order. A step changes the IR (a bundle,
// or the items a printer reads to write a source back), and says what it can't do the same way:
// what it renamed, what is gone, and where something now looks or behaves differently. Where the old
// look can be kept, the user chooses, and a kept look is written into the IR (and so into the
// source), where it can be seen. Nothing is changed silently: every change is a warning at its line.

import type { Diagnostic } from '../diag';
import type { IRBundle } from '../ir';
import { bundleStamp, compareReleases } from '../stamp';
import { RELEASE } from '../version';
import { STEPS } from './steps';
import type { Obj } from './walk';

/** Where a change applies: the file and [line, col] it was written at. */
export interface Place {
  file?: string;
  pos?: [number, number];
}

/** A change in behaviour the IR doesn't show: the same IR, a different drawing. */
export interface Change {
  /** a short name the user answers by: --keep zoom-minscale */
  id: string;
  /** what is different now, in a sentence */
  what: string;
  /** how the old look is kept (written into the source), or why it can't be */
  keep: { how: string } | { cannot: string };
  /** where in the IR it shows: none, and nothing is said */
  find(roots: unknown[]): Place[];
  /** keeps the old look where it shows (only when it can be kept) */
  pin?(roots: unknown[]): void;
}

export interface Step {
  from: string;
  to: string;
  /** what the release changed, in a line */
  summary: string;
  /** names a release took for itself, renamed in what the user wrote */
  renames: { name: string; why: string }[];
  /** what a release removed, and what to write instead */
  removes: { what: string; instead: string }[];
  changes: Change[];
  /** the IR change itself; it warns through `ctx` at every place it changed */
  ir(roots: unknown[], ctx: StepContext): void;
}

export interface StepContext {
  step: Step;
  warn(code: string, message: string, at?: Place): void;
  /** says a definition's input or member was renamed, so files the IR doesn't hold (fixtures) can follow */
  renamed(def: string, from: string, to: string): void;
}

/** A name a step changed in a definition. */
export interface Renamed {
  def: string;
  from: string;
  to: string;
}

export interface MigrateOptions {
  /** the release to migrate to: this one by default */
  to?: string;
  /** the changes whose old look to keep: their ids, or 'all' (only those that can be kept) */
  keep?: string[] | 'all';
}

export interface Choice {
  id: string;
  step: string;
  what: string;
  /** how it is kept, or null when it can't be */
  how: string | null;
  cannot?: string;
  /** how many places it shows in */
  places: number;
}

export interface MigrateResult {
  from: string;
  to: string;
  /** the steps run, as "0.2.1 -> 0.2.2" */
  steps: string[];
  warnings: Diagnostic[];
  /** the changes kept, by id */
  kept: string[];
  renamed: Renamed[];
}

/** The steps from `from` to `to`, in order; throws when the chain has a hole. */
export function stepsBetween(from: string, to: string = RELEASE): Step[] {
  if (compareReleases(from, to) > 0) throw new Error(`can't migrate back: ${from} is newer than ${to}`);
  const out = STEPS.filter((s) => compareReleases(s.to, from) > 0 && compareReleases(s.to, to) <= 0).sort((a, b) => compareReleases(a.to, b.to));
  let at = from;
  for (const s of out) {
    if (compareReleases(s.from, at) > 0) throw new Error(`no migration from ${at} to ${s.from}: the steps are ${STEPS.map((x) => `${x.from} -> ${x.to}`).join(', ')}`);
    at = s.to;
  }
  return out;
}

/** The changes a migration from `from` would ask about, with how many places each shows in. */
export function choicesFor(roots: unknown[], from: string, to: string = RELEASE): Choice[] {
  return stepsBetween(from, to).flatMap((s) =>
    s.changes
      .map((c) => ({ id: c.id, step: `${s.from} -> ${s.to}`, what: c.what, how: 'how' in c.keep ? c.keep.how : null, ...('cannot' in c.keep ? { cannot: c.keep.cannot } : {}), places: c.find(roots).length }))
      .filter((c) => c.places > 0),
  );
}

/** Runs the steps from `from` up to `opts.to` on `roots` (changed in place), keeping the looks asked for. */
export function migrateRoots(roots: unknown[], from: string, opts: MigrateOptions = {}): MigrateResult {
  const to = opts.to ?? RELEASE;
  const steps = stepsBetween(from, to);
  const warnings: Diagnostic[] = [];
  const kept: string[] = [];
  const renamed: Renamed[] = [];
  const at = (p?: Place) => (p?.file && p.pos ? { file: p.file, line: p.pos[0], col: p.pos[1] } : undefined);
  for (const step of steps) {
    const ctx: StepContext = { step, warn: (code, message, p) => warnings.push({ severity: 'warning', code, message, pos: at(p) }), renamed: (def, a, b) => renamed.push({ def, from: a, to: b }) };
    step.ir(roots, ctx);
    for (const r of step.removes) ctx.warn('mkp.migrate-removed', `${step.to} removed ${r.what}. ${r.instead}`);
    for (const c of step.changes) {
      const places = c.find(roots);
      if (!places.length) continue;
      const keepIt = 'how' in c.keep && c.pin && (opts.keep === 'all' || (opts.keep ?? []).includes(c.id));
      if (keepIt) {
        c.pin!(roots);
        kept.push(c.id);
      }
      for (const p of places) {
        const tail = keepIt ? `Kept the old look: ${(c.keep as { how: string }).how}.` : 'how' in c.keep ? `To keep the old look, migrate with --keep ${c.id} (${c.keep.how}).` : `The old look can't be kept: ${c.keep.cannot}.`;
        ctx.warn(keepIt ? 'mkp.migrate-kept' : 'mkp.migrate-changed', `since ${step.to}, ${c.what}. ${tail}`, p);
      }
    }
  }
  // the same IR can reach a step twice (a bundle and the items printed from it): say each thing once
  const seen = new Set<string>();
  const once = warnings.filter((w) => {
    const k = `${w.code}|${w.message}|${w.pos?.file}:${w.pos?.line}:${w.pos?.col}`;
    return seen.has(k) ? false : (seen.add(k), true);
  });
  return { from, to, steps: steps.map((s) => `${s.from} -> ${s.to}`), warnings: once, kept, renamed };
}

/**
 * A stored bundle brought up to this release (or `opts.to`): a copy, stamped, with the warnings.
 * `mount()` uses it for a bundle an older release built.
 */
export function migrateBundle(bundle: IRBundle, opts: MigrateOptions = {}): MigrateResult & { bundle: IRBundle } {
  const from = bundleStamp(bundle).mkp;
  const copy = JSON.parse(JSON.stringify(bundle)) as IRBundle;
  const r = migrateRoots([copy], from, opts);
  copy.mkp = r.to;
  if (copy.lock) copy.lock = { ...copy.lock, mkp: r.to };
  return { ...r, bundle: copy };
}

/** Whether a bundle was made by an older release than this one (or has no stamp). */
export function needsMigration(bundle: IRBundle): boolean {
  return compareReleases(bundleStamp(bundle).mkp, RELEASE) < 0;
}

export { STEPS };
export type { Obj };
