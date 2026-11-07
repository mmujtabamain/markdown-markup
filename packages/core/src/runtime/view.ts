// The view tree: what the runtime hands renderers. Every node is a base widget (or a built-in
// container) with resolved props; renderers map these to components and report events back by key.

import type { Run } from '../markdown';

export interface VMaths {
  tex: string;
  display?: boolean;
  svg?: string;
  speech?: string;
  /** width and height in ex units, vertical alignment in ex */
  w?: number;
  h?: number;
  va?: number;
}

export type VRun = Run | (Extract<Run, { t: 'math' }> & VMaths);

export interface VArrow {
  key: string;
  from: string;
  to: string;
  label?: VRun[];
  curve?: boolean;
  /** level and upright runs only, and lines with an end in common combine (route=, 6.10) */
  route?: 'down' | 'right';
  /** its colour (a color token), its line, the marks at its ends, faded back or drawn strong */
  tone?: string;
  line?: 'solid' | 'dashed' | 'dotted';
  head?: 'arrow' | 'hollow' | 'one' | 'many' | 'dot' | 'ring' | 'cross' | 'none';
  tail?: 'arrow' | 'hollow' | 'one' | 'many' | 'dot' | 'ring' | 'cross' | 'none';
  dim?: boolean;
  bold?: boolean;
  /** behind: drawn under the content (GAPS 100) */
  layer?: 'behind';
  /** its own opacity, quieter than muted (GAPS 122) */
  opacity?: number;
  /** how round its turns are: m (the default, 12 px), s (6 px) or none */
  corner?: 'none' | 's' | 'm';
  /** the keys of the elements the path runs through, in order (via=, 6.10) */
  via?: string[];
}

/**
 * What a circle or a path can report, when it is written with those lines: the pointer moving onto
 * it or off it, and a press on it. A renderer dispatches them by the shape's key, with no payload.
 */
export type ShapeEvent = 'enter' | 'leave' | 'click';

/**
 * Canvas shapes. Lines, rectangles and curves are paths (the base set draws only these); a
 * circle's px is a radius in pixels, whatever the zoom; opacity is the shape's own (GAPS 106–109,
 * 113). Labels are kept inside the canvas and clear of each other by the renderer.
 */
export type VShape =
  | { t: 'circle'; key: string; c: number[]; r: number; px?: number; fill: string; stroke: string; width: number; opacity?: number; label?: string; ev?: ShapeEvent[] }
  | { t: 'path'; key: string; pts: number[][]; closed: boolean; fill: string; stroke: string; width: number; dash: boolean; head?: 'arrow' | 'dot'; opacity?: number; label?: string; ev?: ShapeEvent[] }
  | { t: 'label'; key: string; at: number[]; runs: VRun[]; tone: string; anchor: string; chip?: boolean; size?: 'small' | 'large'; halo?: boolean; dx?: number; dy?: number; opacity?: number }
  | { t: 'image'; key: string; src: string; at: number[]; w: number; h: number; alt: string }
  | { t: 'place'; key: string; at: number[]; kids: VNode[] }
  | { t: 'handle'; key: string; at: number[]; tone: string; label: string; x: number[]; y: number[] }
  | { t: 'pixels'; key: string; glsl: string; sksl: string; uniforms: Record<string, number>; res: number; fallback?: string }
  | { t: 'mesh'; key: string; z: number[][]; n: number; fill: string; fallback?: string };

export interface VLayer {
  key: string;
  opacity: number;
  /** clip=: the rectangle its shapes are cut off outside, in data units [x0, y0, x1, y1] (low corner first) */
  clip?: number[];
  shapes: VShape[];
}

export interface VNode {
  /** base widget kind: column row grid stack text image press range meter field overlay canvas, Markdown kinds,
   *  or the containers scope (a definition instance), bar (its controls) and error */
  t: string;
  key: string;
  id?: string;
  p: Record<string, unknown>;
  kids?: VNode[];
  /** overlay: the body shown when open */
  body?: VNode[];
  /** frame and pane: their other slots, by name (actions, bar, about, details; footer) */
  slots?: Record<string, VNode[]>;
  hidden?: boolean;
  layout?: { grow?: boolean; basis?: string; span?: number; self?: 'start' | 'center' | 'end' | 'stretch'; keep?: boolean };
  /** events the renderer should report: click, enter, leave, change, submit, open, close, drag */
  ev?: string[];
  arrows?: VArrow[];
  layers?: VLayer[];
  /** source map (12.1): the definition (or document) and the [line, col] this node was written at */
  src?: [string, number, number];
}

export function walk(nodes: VNode[], f: (n: VNode) => void): void {
  for (const n of nodes) {
    f(n);
    if (n.kids) walk(n.kids, f);
    if (n.body) walk(n.body, f);
    for (const s of Object.values(n.slots ?? {})) walk(s, f);
    for (const l of n.layers ?? []) for (const s of l.shapes) if (s.t === 'place') walk(s.kids, f);
  }
}
