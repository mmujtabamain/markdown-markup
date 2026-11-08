// A widget's size before it is drawn, as an HTML img tag's width and height are: minwidth and
// minheight (px, where it starts: the drawn size wins), and aspect (width over height, exact).
// Any two give the box; they are written on a use or as a widget's own inputs (its defaults).

import type { IRDef } from './ir';

export const SIZE_KEYS = ['minwidth', 'minheight', 'aspect'] as const;
export type SizeKey = (typeof SIZE_KEYS)[number];

export interface WidgetSize {
  /** px: at least this wide at first, up to the width it is in */
  minwidth?: number;
  /** px: at least this tall at first */
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
 * The box a size gives before the widget is drawn: a width (px, at most the width it is in) and a
 * shape, or a height. Two of the three fix it; one gives what it can; none gives nothing.
 */
export function sizeBox(s: WidgetSize): { width?: number; aspect?: number; height?: number } {
  const { minwidth: w, minheight: h, aspect: a } = s;
  if (a !== undefined) return w !== undefined ? { width: w, aspect: a } : h !== undefined ? { width: h * a, aspect: a } : { aspect: a };
  if (w !== undefined && h !== undefined) return { width: w, aspect: w / h };
  if (h !== undefined) return { height: h };
  if (w !== undefined) return { width: w };
  return {};
}

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
