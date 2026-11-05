// What every node reads: the runtime it reports events to, the resolved tokens,
// and the measurement registries of the scopes above it (for arrows, spec 6.10).

import { createContext, useContext } from 'react';
import type { LayoutRectangle } from 'react-native';
import type { Runtime } from '@mkp/core';
import type { Theme } from './theme';

export interface Ctx {
  rt: Runtime;
  theme: Theme;
}

export const RuntimeCtx = createContext<Ctx | null>(null);

export function useCtx(): Ctx {
  const c = useContext(RuntimeCtx);
  if (!c) throw new Error('MKP nodes render inside <MkpDocument>');
  return c;
}

/** A host view that can measure itself against another (React Native's measureLayout). */
export interface Measurable {
  measureLayout?: (relativeTo: never, onSuccess: (x: number, y: number, w: number, h: number) => void, onFail?: () => void) => void;
}

/**
 * A scope with arrows keeps the rectangles of the elements inside it, relative to its own
 * container. Elements report on every layout; the scope redraws its arrows when a rect changes.
 */
export interface Registry {
  /** the scope container's host view, to measure against */
  container: { current: Measurable | null };
  /** an element's host view appeared (or, with null, went away) */
  register(key: string, host: Measurable | null, hidden: boolean): void;
  /** an element was laid out (relative to its parent view) */
  layout(key: string, layout: LayoutRectangle): void;
}

/** Every registry from the document root down to here: an element reports to each of them. */
export const MeasureCtx = createContext<readonly Registry[]>([]);

/** The nearest scroller: it scrolls a host view inside it into view (keep=true, GAPS 150). */
export const KeepCtx = createContext<((host: Measurable) => void) | null>(null);

/** Which way the container a node sits in runs, so width=fit knows whether to stop stretching. */
export const FlowCtx = createContext<'row' | 'column'>('column');
