// A widget's size, as an HTML img tag's width and height are: minwidth and minheight (px, the least
// it is: bigger content wins) and aspect (width over height, exact). Any two give its box before it
// is drawn; they are written on a use or as a widget's own inputs (its defaults).

import type { IRDef } from './ir';

export const SIZE_KEYS = ['minwidth', 'minheight', 'aspect'] as const;
export type SizeKey = (typeof SIZE_KEYS)[number];

export interface WidgetSize {
  /** px: at least this wide, up to the width it is in */
  minwidth?: number;
  /** px: at least this tall */
  minheight?: number;
  /** width over height: kept at every width */
  aspect?: number;
}

export const isSizeKey = (k: string): k is SizeKey => (SIZE_KEYS as readonly string[]).includes(k);

/**
 * A size as written: px for minwidth and minheight (320), a ratio for aspect (16/9, 1.6, or 16:9).
 * Undefined for none, 0, or anything else.
 */
export function sizeOf(k: SizeKey, text: string | number): number | undefined {
  const s = String(text).trim().replace(/^"(.*)"$/s, '$1').replace(/^\((.*)\)$/s, '$1').trim();
  const ratio = /^(\d+(?:\.\d+)?)\s*[/:]\s*(\d+(?:\.\d+)?)$/.exec(s);
  const n = ratio ? (k === 'aspect' ? Number(ratio[1]) / Number(ratio[2]) : NaN) : /^\d+(?:\.\d+)?$/.test(s) ? Number(s) : NaN;
  return Number.isFinite(n) && n > 0 ? n : undefined;
}

/** How a size is written, for a message. */
export function sizeTakes(k: SizeKey): string {
  return k === 'aspect' ? 'a ratio of width to height, e.g. aspect=16/9 or aspect=1.6' : `a number of px greater than 0, e.g. ${k}=320`;
}

/** A use's sizes, with the widget's own defaults filling in up to two: what is written on the use wins. */
export function mergeSize(own: WidgetSize, defaults: WidgetSize | undefined): WidgetSize {
  const out: WidgetSize = { ...own };
  for (const k of SIZE_KEYS) if (Object.keys(out).length < 2 && out[k] === undefined && defaults?.[k] !== undefined) out[k] = defaults[k];
  return out;
}

/**
 * A size as CSS for an empty box, a first paint's placeholder: at least minwidth wide and minheight
 * tall, at aspect's shape, never wider than the width it is in (a minheight with an aspect would
 * otherwise make it as wide as that shape needs).
 */
export function sizeStyle(s: WidgetSize): { minWidth?: string; minHeight?: string; aspectRatio?: string; maxWidth?: string } {
  const out: { minWidth?: string; minHeight?: string; aspectRatio?: string; maxWidth?: string } = {};
  if (s.minwidth !== undefined) out.minWidth = `min(${round(s.minwidth)}px, 100%)`;
  if (s.minheight !== undefined) out.minHeight = `${round(s.minheight)}px`;
  if (s.aspect !== undefined) out.aspectRatio = String(round(s.aspect, 4));
  if (Object.keys(out).length) out.maxWidth = '100%';
  return out;
}

/**
 * A size as CSS for a drawn widget, the box its placeholder was when its content fits: minwidth on
 * it, minheight and aspect on a spacer inside it (data-mkp-sized, in MKP's stylesheet) that only
 * reserves room, so content bigger than that still shows and the box grows.
 */
export function sizeVars(s: WidgetSize): Record<string, string> {
  const out: Record<string, string> = {};
  if (s.minwidth !== undefined) out.minWidth = `min(${round(s.minwidth)}px, 100%)`;
  if (s.minheight !== undefined) out['--mkp-minheight'] = `${round(s.minheight)}px`;
  if (s.aspect !== undefined) out['--mkp-aspect'] = String(round(s.aspect, 4));
  return out;
}

const round = (n: number, places = 0): number => Math.round(n * 10 ** places) / 10 ** places;

/**
 * Each widget's own sizes, by name: the defaults of its minwidth, minheight and aspect inputs.
 * Made once from a host's packs (a compile, or any bundle), for outline()'s sizes.
 */
export function sizeDefaults(from: { defs: Record<string, IRDef> | Map<string, IRDef> }): Record<string, WidgetSize> {
  const out: Record<string, WidgetSize> = {};
  const defs = from.defs instanceof Map ? [...from.defs.values()] : Object.values(from.defs);
  for (const d of defs) {
    if (d.kind === 'part' || d.pack === 'core') continue;
    const s: WidgetSize = {};
    for (const i of d.inputs) {
      if (!isSizeKey(i.name) || !i.default) continue;
      const v = 'lit' in i.default ? i.default.lit : 'expr' in i.default ? (i.default as { expr: string }).expr : undefined;
      const n = typeof v === 'number' || typeof v === 'string' ? sizeOf(i.name, v) : undefined;
      if (n !== undefined) s[i.name] = n;
    }
    if (Object.keys(s).length) out[d.name] = s;
  }
  return out;
}
