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
  /** the keys of the elements the path runs through, in order (via=, 6.10) */
  via?: string[];
}

export type VShape =
  | { t: 'rect'; key: string; a: number[]; b: number[]; fill: string; stroke: string; radius: string }
  | { t: 'line'; key: string; a: number[]; b: number[]; stroke: string; width: number; dash: boolean; arrow: boolean }
  | { t: 'circle'; key: string; c: number[]; r: number; fill: string; stroke: string; width: number }
  | { t: 'path'; key: string; pts: number[][]; closed: boolean; fill: string; stroke: string; width: number; dash: boolean }
  | { t: 'label'; key: string; at: number[]; runs: VRun[]; tone: string; anchor: string }
  | { t: 'image'; key: string; src: string; at: number[]; w: number; h: number; alt: string }
  | { t: 'place'; key: string; at: number[]; kids: VNode[] }
  | { t: 'handle'; key: string; at: number[]; tone: string; label: string; x: number[]; y: number[] }
  | { t: 'pixels'; key: string; glsl: string; sksl: string; uniforms: Record<string, number>; res: number; fallback?: string }
  | { t: 'mesh'; key: string; z: number[][]; n: number; fill: string; fallback?: string };

export interface VLayer {
  key: string;
  opacity: number;
  shapes: VShape[];
}

export interface VNode {
  /** base widget kind: stack flex grid text image press range meter field overlay canvas, Markdown kinds,
   *  or the containers scope (a definition instance), bar (its controls) and error */
  t: string;
  key: string;
  id?: string;
  p: Record<string, unknown>;
  kids?: VNode[];
  /** overlay: the body shown when open */
  body?: VNode[];
  hidden?: boolean;
  layout?: { grow?: boolean; basis?: string; span?: number };
  /** events the renderer should report: click, change, submit, open, close, drag */
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
    for (const l of n.layers ?? []) for (const s of l.shapes) if (s.t === 'place') walk(s.kids, f);
  }
}
