// @mkp/react: render an MKP bundle on the web with the core runtime.

import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, useSyncExternalStore, type ReactNode } from 'react';
import { Runtime, type IRBundle, type MathsRenderer, type RuntimeOptions, type VNode } from '@mkp/core';
import { BASE_CSS, NEUTRAL_CSS, tokenCss, type TokenMap } from './style';
import { Kids, RuntimeCtx, type MkpComponents } from './nodes';
import { SHELL_CSS } from './shell';

export { Node, Kids, Runs, MathSpan, MathBlock, TextBlock, Box, CodeLines, RuntimeCtx, BASE_WIDGETS, nodeAttrs, layoutStyle, boxStyle, flowStyle, gridTracks, rowRole, textStyle, hoverEvents, fieldTone, fieldKeys, keepInView, type BaseWidget, type CodeMark, type MathMark, type HostProps, type HostRoute, type MkpComponents } from './nodes';
export { Arrows, curve, placeLabels, MIN_BEND, type Drawn } from './arrows';
export { Canvas, placeCanvasLabels, pathHead } from './canvas';
export { Frame, Pane, Zoom, FitBox, fitsWidth, zoomBounds, Icon, relayout, SHELL_CSS, type ShellButton, type ShellButtonProps } from './shell';
export { tokenCss, layer, color, size, BASE_CSS, NEUTRAL_CSS, type TokenMap } from './style';

export interface MkpProviderProps {
  bundle: IRBundle;
  /** a runtime to drive (tests and hosts that call commands); one is made otherwise */
  runtime?: Runtime;
  maths?: MathsRenderer;
  /** a provider's own values for token names */
  tokens?: TokenMap;
  /** a host's own components for base widgets and definitions */
  components?: MkpComponents;
  reducedMotion?: boolean;
  options?: RuntimeOptions;
  children?: ReactNode;
}

export interface MkpDocumentProps extends Omit<MkpProviderProps, 'children'> {
  theme?: 'light' | 'dark' | 'auto';
  className?: string;
}

function usePrefersReducedMotion(): boolean {
  const [r, setR] = useState(() => typeof matchMedia !== 'undefined' && matchMedia('(prefers-reduced-motion: reduce)').matches);
  useEffect(() => {
    if (typeof matchMedia === 'undefined') return;
    const m = matchMedia('(prefers-reduced-motion: reduce)');
    const f = (): void => setR(m.matches);
    m.addEventListener?.('change', f);
    return () => m.removeEventListener?.('change', f);
  }, []);
  return r;
}

export function useRuntime(bundle: IRBundle, opts: RuntimeOptions): Runtime {
  return useMemo(() => new Runtime(bundle, opts), [bundle]); // eslint-disable-line react-hooks/exhaustive-deps
}

const ViewCtx = createContext<VNode[] | null>(null);

/** The reader's width, from a width in pixels: narrow (a phone), medium or wide (GAPS 30, 160). */
export function widthClass(px: number): 'narrow' | 'medium' | 'wide' {
  return px < 600 ? 'narrow' : px < 1000 ? 'medium' : 'wide';
}

/** Measures an element for the document's width: it returns how to stop. */
type MeasureWidth = (el: HTMLElement) => () => void;
const WidthCtx = createContext<MeasureWidth | null>(null);

/**
 * The document's width, as the runtime's `width`: the widest element measured with `useMkpWidth`
 * (a document's root, or each of a host's own roots), or the window's while none is.
 */
function useWidthReport(rt: Runtime): MeasureWidth {
  const els = useRef(new Set<HTMLElement>());
  const ro = useRef<ResizeObserver | null>(null);
  const report = useCallback(() => {
    let w = 0;
    for (const el of els.current) w = Math.max(w, el.clientWidth);
    if (!els.current.size && typeof document !== 'undefined') w = document.documentElement.clientWidth || window.innerWidth;
    // nothing laid out yet (a hidden tab, a test): the runtime keeps what it has
    if (w > 0) rt.setWidth(widthClass(w));
  }, [rt]);
  useEffect(() => {
    if (typeof window === 'undefined') return;
    report();
    window.addEventListener('resize', report);
    return () => {
      window.removeEventListener('resize', report);
      ro.current?.disconnect();
      ro.current = null;
    };
  }, [report]);
  return useCallback(
    (el) => {
      els.current.add(el);
      if (typeof ResizeObserver !== 'undefined') (ro.current ??= new ResizeObserver(report)).observe(el);
      report();
      return () => {
        els.current.delete(el);
        ro.current?.unobserve(el);
      };
    },
    [report],
  );
}

/** Reports this element's width as the document's (see MkpProvider): for a host that draws its own roots. */
export function useMkpWidth(ref: { current: HTMLElement | null }): void {
  const measure = useContext(WidthCtx);
  useEffect(() => (measure && ref.current ? measure(ref.current) : undefined), [measure, ref]);
}

/** The document's top-level view nodes (one per body item, in order), inside an `MkpProvider`. */
export function useMkpView(): VNode[] {
  const v = useContext(ViewCtx);
  if (!v) throw new Error('useMkpView is for components inside <MkpProvider>');
  return v;
}

/**
 * The runtime, its clock and the token stylesheet, with no element of its own: a host that lays
 * blocks out in its own page (sections, columns) renders each top-level node from `useMkpView()`
 * with `Node` inside its own `.mkp-root` element (and `useMkpWidth` on it, so widgets know the width
 * they have). `MkpDocument` is this plus one root that stacks them.
 */
export function MkpProvider(props: MkpProviderProps): ReactNode {
  const prefers = usePrefersReducedMotion();
  const reducedMotion = props.reducedMotion ?? prefers;
  // the web provides gfx@1 (WebGL for pixels, projected polygons for mesh)
  const rt = useMemo(() => props.runtime ?? new Runtime(props.bundle, { capabilities: ['core@1', 'gfx@1'], ...props.options, maths: props.maths, reducedMotion }), [props.bundle, props.runtime]); // eslint-disable-line react-hooks/exhaustive-deps
  const tree = useSyncExternalStore(
    (f) => rt.subscribe(f),
    () => rt.view(),
    () => rt.view(),
  );
  // play: drive the runtime's clock on animation frames while anything plays
  useEffect(() => {
    let raf = 0;
    let last = 0;
    const loop = (t: number): void => {
      if (rt.playing()) {
        if (last) rt.tick(Math.min(100, t - last));
        last = t;
      } else last = 0;
      raf = requestAnimationFrame(loop);
    };
    raf = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(raf);
  }, [rt]);
  const css = useMemo(() => BASE_CSS + SHELL_CSS + (props.components ? '' : NEUTRAL_CSS) + tokenCss(props.bundle.tokens, props.tokens), [props.bundle, props.tokens, props.components]);
  const ctx = useMemo(() => ({ rt, components: props.components }), [rt, props.components]);
  const measure = useWidthReport(rt);
  return (
    <RuntimeCtx.Provider value={ctx}>
      <WidthCtx.Provider value={measure}>
        <ViewCtx.Provider value={tree}>
          <style>{css}</style>
          {props.children}
        </ViewCtx.Provider>
      </WidthCtx.Provider>
    </RuntimeCtx.Provider>
  );
}

function DocumentRoot({ theme, className }: { theme?: MkpDocumentProps['theme']; className?: string }): ReactNode {
  const tree = useMkpView();
  const root = useRef<HTMLDivElement>(null);
  useMkpWidth(root);
  return (
    <div ref={root} className={['mkp-root', className].filter(Boolean).join(' ')} data-theme={theme && theme !== 'auto' ? theme : undefined}>
      <Kids nodes={tree} />
    </div>
  );
}

export function MkpDocument(props: MkpDocumentProps): ReactNode {
  const { theme, className, ...rest } = props;
  return (
    <MkpProvider {...rest}>
      <DocumentRoot theme={theme} className={className} />
    </MkpProvider>
  );
}
