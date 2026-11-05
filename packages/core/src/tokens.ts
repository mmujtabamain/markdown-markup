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

/** A name to pair a bare value with, for messages. */
const PAIR_NAME: Record<string, string> = { space: 'm', size: 'm', radius: 'card' };

/** How a line of each token kind is written, for messages. */
const TOKEN_LINE: Record<string, string> = {
  color: 'color brand "#2563eb" dark="#7aa7ff"',
  font: 'font body "system-ui, sans-serif" size=16',
  shadow: 'shadow raised y=1 blur=3',
  space: 'space xs=2 s=4',
  size: 'size s=160 m=320',
  radius: 'radius card=8 pill=999',
};

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
          if (c !== undefined && (typeof c !== 'string' || !COLOR_RE.test(c))) {
            const at = k === 'value' ? l.value?.p : l.args.find((a) => (a.key ?? 'value') === k)?.p;
            const what = k === 'value' ? `the colour token ${l.name}` : `${k}= on the colour token ${l.name}`;
            const eg = k === 'value' ? `color ${l.name} "#2563eb"` : `${k}="#7aa7ff"`;
            diags.error('mkp.token-value', `${what} must be a hex colour, # and 3, 4, 6 or 8 hex digits; found ${typeof c === 'string' ? c : String(c)}. Write it in quotes, e.g. \`${eg}\``, at ?? l.p);
          }
        }
      }
      bucket[l.name] = entry;
    } else {
      for (const a of l.args) {
        if (!a.key) {
          if (kind === 'color' || kind === 'font' || kind === 'shadow') {
            diags.error('mkp.token-syntax', `a ${kind} token line starts with the token's name, as in \`${TOKEN_LINE[kind]}\`; found ${a.value.src} with no name before it. Put a name first: \`${kind} brand ${a.value.src}\``, a.p);
          } else {
            const word = a.value.src.replace(/^"|"$/g, '').replace(/[^A-Za-z0-9_]/g, '') || 'name';
            diags.error('mkp.token-syntax', `a line of ${kind} tokens is a list of name=value pairs, as in \`${TOKEN_LINE[kind] ?? `${kind} a=1 b=2`}\`; found ${a.value.src}, which has no name. Remove ${a.value.src}, or write it as a pair: \`${/^[A-Za-z_]/.test(word) ? `${word}=4` : `${PAIR_NAME[kind] ?? 'name'}=${a.value.src}`}\``, a.p);
          }
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

/** A line defining one token of a kind, for messages. */
function tokenLineFor(kind: string, n: string): string {
  if (kind === 'color') return `color ${n} "#2563eb"`;
  if (kind === 'font') return `font ${n} "system-ui, sans-serif" size=16`;
  if (kind === 'shadow') return `shadow ${n} y=1 blur=3`;
  return `${kind} ${n}=8`;
}

export function checkRequired(sets: IRTokenSet[], diags: Diagnostics): void {
  const names = tokenNames(sets);
  for (const [kind, req] of Object.entries(REQUIRED_TOKENS)) {
    for (const n of req) {
      if (!names.get(kind)?.has(n)) {
        diags.error('mkp.token-missing', `no token set defines the ${kind} token "${n}", which every set of tokens must have. Add a line for it to a tokens file, e.g. \`${tokenLineFor(kind, n)}\``);
      }
    }
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
