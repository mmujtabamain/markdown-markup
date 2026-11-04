// The conformance suite (spec 11, 13): every fixture compiles to a bundle plus expected results —
// values at given states (within tolerances: relative 1e-9, absolute 1e-12 near zero), the visible
// nodes, and golden Markdown. Other providers and ports run the same cases.

import type { IRBundle } from './ir';
import type { PlayStep } from './fixtures';
import { writeMarkdown } from './md';
import { Runtime } from './runtime/runtime';
import { walk, type VNode } from './runtime/view';

export interface ConfExpect {
  values: Record<string, Record<string, unknown>>;
  visible: string[];
}

export interface ConfCase {
  id: string;
  bundle: IRBundle;
  hosts?: Record<string, unknown>;
  steps: PlayStep[];
  /** before the play steps, and after them */
  initial: ConfExpect;
  final: ConfExpect;
  md: { plain: string; all: string };
  /** relative tolerance for values (11: 1e-9 unless the fixture says otherwise) */
  tolerance?: number;
}

/** The visible nodes, in document order: kind, and id when the node has one. */
export function visible(nodes: VNode[]): string[] {
  const out: string[] = [];
  const go = (ns: VNode[]): void => {
    for (const n of ns) {
      if (n.hidden) continue;
      out.push(n.id ? `${n.t}#${n.id}` : n.t);
      if (n.kids) go(n.kids);
      if (n.body) go(n.body);
      for (const l of n.layers ?? []) for (const s of l.shapes) out.push(`shape:${s.t}`);
    }
  };
  go(nodes);
  return out;
}

function observe(rt: Runtime): ConfExpect {
  return { values: rt.snapshot(), visible: visible(rt.view()) };
}

function play(rt: Runtime, steps: PlayStep[]): void {
  for (const s of steps) {
    if (s.press) rt.press(s.press);
    if (s.set) rt.set(s.set);
    if (s.command) rt.widget(0).command(s.command, s.args);
    if (s.wait) for (let t = 0; t < s.wait; t += 50) rt.tick(Math.min(50, s.wait - t));
  }
}

/** Runs a case's bundle: what a provider's runtime must reproduce. */
export function runCase(bundle: IRBundle, steps: PlayStep[], hosts?: Record<string, unknown>, mdAll = true): { initial: ConfExpect; final: ConfExpect; md: { plain: string; all: string } } {
  // gfx@1 declared: conformance compares values and nodes, not fallback pixels
  const rt = new Runtime(bundle, { now: () => 0, hosts: hosts ? { '0': hosts } : undefined, capabilities: ['core@1', 'gfx@1'] });
  const initial = observe(rt);
  play(rt, steps);
  const final = observe(rt);
  const md = {
    plain: writeMarkdown(bundle).md,
    all: mdAll ? writeMarkdown(bundle, { toggles: ['gfm', 'math', 'mermaid', 'html', 'images'] }).md : '',
  };
  return { initial, final, md };
}

export function makeCase(id: string, bundle: IRBundle, steps: PlayStep[] = [], hosts?: Record<string, unknown>, tolerance?: number): ConfCase {
  const r = runCase(bundle, steps, hosts);
  return { id, bundle, hosts, steps, initial: r.initial, final: r.final, md: r.md, ...(tolerance ? { tolerance } : {}) };
}

/** Numbers agree within relative 1e-9, or absolute 1e-12 near zero (11). */
export function close(a: number, b: number, rel = 1e-9): boolean {
  if (Number.isNaN(a) && Number.isNaN(b)) return true;
  if (a === b) return true;
  const d = Math.abs(a - b);
  return d <= 1e-12 || d <= rel * Math.max(Math.abs(a), Math.abs(b));
}

export function diffValues(want: unknown, got: unknown, path = '', rel = 1e-9): string[] {
  if (typeof want === 'number' && typeof got === 'number') return close(want, got, rel) ? [] : [`${path}: expected ${want}, got ${got}`];
  if (Array.isArray(want) && Array.isArray(got)) {
    if (want.length !== got.length) return [`${path}: expected ${want.length} items, got ${got.length}`];
    return want.flatMap((w, i) => diffValues(w, got[i], `${path}[${i}]`, rel));
  }
  if (want && got && typeof want === 'object' && typeof got === 'object') {
    const out: string[] = [];
    for (const k of new Set([...Object.keys(want), ...Object.keys(got)])) out.push(...diffValues((want as Record<string, unknown>)[k], (got as Record<string, unknown>)[k], `${path}.${k}`, rel));
    return out;
  }
  return want === got ? [] : [`${path}: expected ${JSON.stringify(want)}, got ${JSON.stringify(got)}`];
}

/** Every difference between a case's expectations and a run. */
export function checkCase(c: ConfCase, opts: { mdAll?: boolean } = {}): string[] {
  const mdAll = opts.mdAll ?? true;
  const got = runCase(c.bundle, c.steps, c.hosts, mdAll);
  const out: string[] = [];
  const rel = c.tolerance ?? 1e-9;
  out.push(...diffValues(c.initial.values, got.initial.values, 'initial', rel));
  out.push(...diffValues(c.final.values, got.final.values, 'final', rel));
  if (c.initial.visible.join(' ') !== got.initial.visible.join(' ')) out.push('initial visible nodes differ');
  if (c.final.visible.join(' ') !== got.final.visible.join(' ')) out.push('final visible nodes differ');
  // Markdown can carry formatted numbers; compare with numbers read within tolerance
  for (const k of mdAll ? (['plain', 'all'] as const) : (['plain'] as const)) if (!sameMd(c.md[k], got.md[k])) out.push(`markdown (${k}) differs`);
  return out;
}

function sameMd(a: string, b: string): boolean {
  if (a === b) return true;
  const na = a.split(/(-?\d+\.?\d*(?:e-?\d+)?)/);
  const nb = b.split(/(-?\d+\.?\d*(?:e-?\d+)?)/);
  if (na.length !== nb.length) return false;
  return na.every((x, i) => (i % 2 ? Math.abs(Number(x) - Number(nb[i])) <= 1e-3 * Math.max(1, Math.abs(Number(x))) : x === nb[i]));
}

export { walk };
