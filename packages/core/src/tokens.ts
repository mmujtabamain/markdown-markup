// Design tokens (spec 7): token sets in .mkp, the required names, and resolving a name to a value.

import { Diagnostics } from './diag';
import type { IRTokenSet } from './ir';
import { REQUIRED_TOKENS } from './base';
import type { TokensSyn, Val } from './syntax/mkp';

function lit(v: Val | undefined): unknown {
  if (!v) return undefined;
  if (v.v === 'dur') return v.ms;
  if (v.v === 'expr') {
    const e = v.e;
    if (e.k === 'num') return e.v;
    if (e.k === 'str') return e.v;
    if (e.k === 'id') return e.name;
    if (e.k === 'neg' && e.a.k === 'num') return -e.a.v;
  }
  return v.src;
}

const COLOR_RE = /^#([0-9a-fA-F]{3,4}|[0-9a-fA-F]{6}|[0-9a-fA-F]{8})$/;

export function tokenSetIR(syn: TokensSyn, pack: string, diags: Diagnostics): IRTokenSet {
  const tokens: IRTokenSet['tokens'] = {};
  for (const l of syn.lines) {
    const kind = l.kind;
    const bucket = (tokens[kind] ??= {});
    if (l.name) {
      const entry: Record<string, unknown> = {};
      if (l.value) entry.value = lit(l.value);
      for (const a of l.args) entry[a.key ?? 'value'] = lit(a.value);
      if (kind === 'color') {
        for (const k of ['value', 'dark']) {
          const c = entry[k];
          if (c !== undefined && (typeof c !== 'string' || !COLOR_RE.test(c))) diags.error('mkp.token-value', `color ${l.name}: ${k} must be a hex colour such as "#2563eb"`, l.p);
        }
      }
      bucket[l.name] = entry;
    } else {
      for (const a of l.args) {
        if (!a.key) {
          diags.error('mkp.token-syntax', `${kind} tokens are written name=value`, a.p);
          continue;
        }
        bucket[a.key] = { value: lit(a.value) };
      }
    }
  }
  return { name: syn.name, version: syn.version, pack, about: syn.about, tokens };
}

/** Token names by kind across sets, for checking style props. */
export function tokenNames(sets: IRTokenSet[]): Map<string, Set<string>> {
  const out = new Map<string, Set<string>>();
  for (const s of sets) for (const [kind, names] of Object.entries(s.tokens)) {
    const b = out.get(kind) ?? new Set<string>();
    for (const n of Object.keys(names)) b.add(n);
    out.set(kind, b);
  }
  return out;
}

export function checkRequired(sets: IRTokenSet[], diags: Diagnostics): void {
  const names = tokenNames(sets);
  for (const [kind, req] of Object.entries(REQUIRED_TOKENS)) {
    for (const n of req) if (!names.get(kind)?.has(n)) diags.error('mkp.token-missing', `the required ${kind} token "${n}" is not defined by any token set`);
  }
}

export type Theme = 'light' | 'dark';

/** Resolves token values: later sets override earlier ones; a provider map overrides both. */
export class TokenTable {
  private readonly table = new Map<string, Record<string, unknown>>();
  constructor(sets: IRTokenSet[], overrides?: Record<string, Record<string, Record<string, unknown>>>) {
    for (const s of sets) for (const [kind, names] of Object.entries(s.tokens)) for (const [n, v] of Object.entries(names)) this.table.set(`${kind}:${n}`, v);
    if (overrides) for (const [kind, names] of Object.entries(overrides)) for (const [n, v] of Object.entries(names)) this.table.set(`${kind}:${n}`, { ...(this.table.get(`${kind}:${n}`) ?? {}), ...v });
  }
  get(kind: string, name: string): Record<string, unknown> | undefined {
    return this.table.get(`${kind}:${name}`);
  }
  color(name: string, theme: Theme = 'light'): string | undefined {
    const t = this.get('color', name);
    if (!t) return undefined;
    return (theme === 'dark' && typeof t.dark === 'string' ? t.dark : t.value) as string | undefined;
  }
  num(kind: string, name: string): number | undefined {
    const v = this.get(kind, name)?.value;
    return typeof v === 'number' ? v : undefined;
  }
  /** Everything, as plain JSON (for renderers that set CSS variables). */
  all(): Record<string, Record<string, unknown>> {
    const out: Record<string, Record<string, unknown>> = {};
    for (const [k, v] of this.table) out[k] = v;
    return out;
  }
}
