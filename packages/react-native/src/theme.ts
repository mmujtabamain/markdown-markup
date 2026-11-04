// Tokens resolved to React Native style values (spec 7). The web renderer turns tokens into CSS
// custom properties; here a Theme answers each token name with a concrete value for the current
// colour scheme, so styles stay token-driven and switch with light/dark.

import { Platform, type TextStyle, type ViewStyle } from 'react-native';
import { TokenTable, type IRTokenSet } from '@mkp/core';

/** A provider's own values for token names: kind → name → { value, dark?, …props }. */
export type TokenMap = Record<string, Record<string, Record<string, unknown>>>;

export type Scheme = 'light' | 'dark';

export interface FontToken {
  fontFamily?: string;
  fontSize: number;
  fontWeight: TextStyle['fontWeight'];
  lineHeight: number;
}

export interface Theme {
  scheme: Scheme;
  /** a colour token's value for this scheme; undefined for `none` and unknown names */
  color(name: unknown): string | undefined;
  /** space tokens (pad, gap) in density-independent pixels */
  space(name: unknown): number | undefined;
  /** size tokens; `fill` is 100% */
  size(name: unknown): number | `${number}%` | undefined;
  radius(name: unknown): number | undefined;
  font(name: unknown): FontToken;
  shadow(name: unknown): ViewStyle | undefined;
  /** a colour mixed with another, like CSS color-mix (a fraction of `a`) */
  mix(a: string | undefined, b: string | undefined, fraction: number): string | undefined;
}

const GENERIC: Record<string, string | undefined> = {
  'system-ui': undefined,
  'sans-serif': undefined,
  serif: Platform.select({ ios: 'Georgia', default: 'serif' }),
  monospace: Platform.select({ ios: 'Menlo', default: 'monospace' }),
  'ui-monospace': Platform.select({ ios: 'Menlo', default: 'monospace' }),
};

/** A CSS font stack reduced to one family React Native can load (generic names map to the platform's). */
export function fontFamily(stack: unknown): string | undefined {
  if (typeof stack !== 'string') return undefined;
  const names = stack.split(',').map((s) => s.trim().replace(/^["']|["']$/g, '')).filter(Boolean);
  const first = names[0];
  if (!first) return undefined;
  if (first in GENERIC) {
    // a generic first family: prefer a more specific generic later in the stack (ui-monospace, monospace)
    for (const n of names) if (GENERIC[n]) return GENERIC[n];
    return undefined;
  }
  return first;
}

function num(v: unknown, fallback: number): number {
  if (typeof v === 'number' && Number.isFinite(v)) return v;
  if (typeof v === 'string') {
    const m = /^(-?[\d.]+)\s*(ms|s|px)?$/.exec(v.trim());
    if (m) return Number(m[1]) * (m[2] === 's' ? 1000 : 1);
  }
  return fallback;
}

function hex(c: string): [number, number, number, number] | null {
  const m = /^#([0-9a-f]{3,8})$/i.exec(c.trim());
  if (!m) return null;
  let h = m[1];
  if (h.length === 3 || h.length === 4) h = [...h].map((x) => x + x).join('');
  if (h.length !== 6 && h.length !== 8) return null;
  const n = (i: number): number => parseInt(h.slice(i, i + 2), 16);
  return [n(0), n(2), n(4), h.length === 8 ? n(6) / 255 : 1];
}

export function mixColors(a: string | undefined, b: string | undefined, fraction: number): string | undefined {
  if (!a) return b;
  if (!b) return a;
  const x = hex(a);
  const y = hex(b);
  if (!x || !y) return a;
  const f = Math.max(0, Math.min(1, fraction));
  const ch = (i: number): number => Math.round(x[i] * f + y[i] * (1 - f));
  const alpha = x[3] * f + y[3] * (1 - f);
  const to2 = (n: number): string => n.toString(16).padStart(2, '0');
  return `#${to2(ch(0))}${to2(ch(1))}${to2(ch(2))}${alpha < 1 ? to2(Math.round(alpha * 255)) : ''}`;
}

export function makeTheme(sets: IRTokenSet[], overrides: TokenMap | undefined, scheme: Scheme): Theme {
  const t = new TokenTable(sets, overrides);
  const named = (name: unknown): string | null => (typeof name === 'string' && name && name !== 'none' ? name : null);
  const fonts = new Map<string, FontToken>();
  return {
    scheme,
    color: (name) => {
      const n = named(name);
      return n ? t.color(n, scheme) : undefined;
    },
    space: (name) => {
      const n = named(name);
      return n ? t.num('space', n) : undefined;
    },
    size: (name) => {
      const n = named(name);
      if (!n) return undefined;
      if (n === 'fill') return '100%';
      return t.num('size', n);
    },
    radius: (name) => {
      const n = named(name);
      return n ? t.num('radius', n) : undefined;
    },
    font: (name) => {
      const n = named(name) ?? 'body';
      const hit = fonts.get(n);
      if (hit) return hit;
      const v = t.get('font', n) ?? t.get('font', 'body') ?? {};
      const size = num(v.size, 16);
      const f: FontToken = {
        fontFamily: fontFamily(v.value),
        fontSize: size,
        fontWeight: String(Math.round(num(v.weight, 400) / 100) * 100) as TextStyle['fontWeight'],
        lineHeight: Math.round(size * num(v.line, 1.5)),
      };
      fonts.set(n, f);
      return f;
    },
    shadow: (name) => {
      const n = named(name);
      const v = n ? t.get('shadow', n) : undefined;
      if (!v) return undefined;
      const c = typeof v.color === 'string' ? hex(v.color) : null;
      const y = num(v.y, 1);
      const blur = num(v.blur, 2);
      return {
        shadowColor: c ? `rgb(${c[0]}, ${c[1]}, ${c[2]})` : '#000000',
        shadowOpacity: c ? c[3] : 0.12,
        shadowRadius: blur / 2,
        shadowOffset: { width: 0, height: y },
        elevation: Math.max(1, Math.round(blur)),
      };
    },
    mix: mixColors,
  };
}
