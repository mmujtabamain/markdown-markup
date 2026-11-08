// What every node reads: the runtime it reports events to, the resolved tokens,
// and the measurement registries of the scopes above it (for arrows, spec 6.10).

import { createContext, useContext, type ComponentType, type ReactNode } from 'react';
import type { LayoutRectangle } from 'react-native';
import type { Runtime } from '@mkp/core';
import type { Theme } from './theme';

/** What a host's icon is given: the name a document chose (one of the fixed set), and how to draw it. */
export interface HostIconProps {
  name: string;
  size: 'small' | 'normal' | 'large';
  /** the tone the document asked for (a colour token's name: accent, ok…), or none for the text's own colour */
  tone: string;
  /** that tone resolved to a colour */
  color: string;
  /** its size in points: the body text's, scaled for small and large */
  px: number;
  /** what it says to a screen reader; the box carries it, so the icon itself needs no label */
  label?: string;
}
export type IconComponent = ComponentType<HostIconProps>;
/** A host's icons: one component for every name, or one per name (the rest stay MKP's). */
export type MkpIcons = IconComponent | Partial<Record<string, IconComponent>>;

/** What a host's component for an extern gets: its id, its inputs, and what it holds, drawn. */
export interface ExternProps {
  /** the extern's id, pack:name@N */
  id: string;
  /** its inputs, with their defaults filled in */
  props: Record<string, unknown>;
  /** what the document put inside it (its first slot), already drawn by MKP */
  children: ReactNode;
  /** its other slots (filled by name with :::fill), drawn, by input name */
  slots: Record<string, ReactNode>;
  /** each record's content, drawn, for its record lists with a slot: records.sections[i] goes with props.sections[i] */
  records: Record<string, ReactNode[]>;
  /** the summary its use wrote, if any */
  summary?: string;
  /** reports one of the extern's outs to the document, which runs its handlers */
  dispatch: (event: string, payload?: unknown) => void;
}
/** A host's components for a pack's externs, by id ("devbench:accordion@1"). */
export type MkpExterns = Record<string, ComponentType<ExternProps>>;

export interface Ctx {
  rt: Runtime;
  theme: Theme;
  /** a host's icons, drawn in place of MKP's text symbols */
  icons?: MkpIcons;
  /** a host's components for a pack's externs, by id */
  externs?: MkpExterns;
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
