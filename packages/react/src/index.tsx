// @mkp/react: render an MKP bundle on the web with the core runtime.

import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, useSyncExternalStore, type ReactNode } from 'react';
import { Runtime, type IRBundle, type MathsRenderer, type RuntimeOptions, type VNode } from '@mkp/core';
import { BASE_CSS, NEUTRAL_CSS, tokenCss, type TokenMap } from './style';
import { Kids, RuntimeCtx, type MkpComponents, type MkpExterns } from './nodes';
import type { MkpIcons } from './shell';
import { SHELL_CSS } from './shell';

export { Node, Kids, Runs, MathSpan, MathBlock, TextBlock, Box, CodeLines, RuntimeCtx, BASE_WIDGETS, nodeAttrs, layoutStyle, boxStyle, flowStyle, gridTracks, rowRole, textStyle, hoverEvents, fieldTone, fieldKeys, keepInView, type BaseWidget, type CodeMark, type MathMark, type HostProps, type HostRoute, type MkpComponents, type ExternProps, type MkpExterns } from './nodes';
export { Arrows, curve, placeLabels, MIN_BEND, type Drawn } from './arrows';
export { Canvas, placeCanvasLabels, pathHead } from './canvas';
export { Frame, Pane, Zoom, FitBox, fitsWidth, zoomBounds, Icon, hostIcon, domIcons, domExterns, relayout, SHELL_CSS, type ShellButton, type ShellButtonProps, type HostIconProps, type IconComponent, type MkpIcons, type DomIcon, type DomIcons, type DomExtern, type DomExterns, type DomExternProps } from './shell';
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
  /**
   * a host's icons, for one name or all: any component, given { name, size, tone, color, label,
   * className }. Documents still only name icons from the fixed set; the box keeps its data-name,
   * size, colour and label, and MKP's text symbol is left out
   */
  icons?: MkpIcons;
  /**
   * a host's components for a pack's externs, by id ({ "devbench:accordion@1": Accordion }). An
   * extern is drawn by the app's own code only; one with no component here shows a placeholder
   * with its summary. Unlike `components`, giving these keeps MKP's own look for everything else
   */
  externs?: MkpExterns;
  /**
   * 'inline' (the default) writes MKP's stylesheet in a <style> of its own; 'external' writes only
   * this document's tokens there, and the page loads the rest once: mkp.css from the web zip, or
   * mkpCss() in your own stylesheet. A first paint and mount() must agree on it
   */
  styles?: 'inline' | 'external';
  reducedMotion?: boolean;
  options?: RuntimeOptions;
  children?: ReactNode;
}

export interface MkpDocumentProps extends Omit<MkpProviderProps, 'children'> {
  theme?: 'light' | 'dark' | 'auto';
  className?: string;
}

/**
 * MKP's stylesheet without any document's tokens: the layout, the shell and (unless your own
 * components draw the base set) the neutral look, in @layer mkp. What <MkpDocument styles="external">
 * leaves for the page to load once; the web zip's mkp.css is mkpCss().
 */
export function mkpCss(opts: { neutral?: boolean } = {}): string {
  return BASE_CSS + SHELL_CSS + (opts.neutral === false ? '' : NEUTRAL_CSS);
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
  // an engine that arrives later is given to the runtime as it is: the state stays, formulas fill in
  useEffect(() => {
    if (!props.runtime && props.maths) rt.setMaths(props.maths);
  }, [rt, props.maths, props.runtime]);
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
  const css = useMemo(() => (props.styles === 'external' ? '' : mkpCss({ neutral: !props.components })) + tokenCss(props.bundle.tokens, props.tokens), [props.bundle, props.tokens, props.components, props.styles]);
  const ctx = useMemo(() => ({ rt, components: props.components, icons: props.icons, externs: props.externs }), [rt, props.components, props.icons, props.externs]);
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

/**
 * Tells the document which theme the reader sees, so a widget that reads `theme` (a pixels ramp that
 * can't follow the colour tokens) draws for it: `light` or `dark` as given, or the system's for `auto`.
 */
export function useMkpTheme(theme: 'light' | 'dark' | 'auto' | undefined): void {
  const { rt } = useContext(RuntimeCtx) ?? {};
  useEffect(() => {
    if (!rt) return;
    if (theme === 'light' || theme === 'dark') return rt.setTheme(theme);
    if (typeof matchMedia === 'undefined') return;
    const m = matchMedia('(prefers-color-scheme: dark)');
    const set = (): void => rt.setTheme(m.matches ? 'dark' : 'light');
    set();
    m.addEventListener('change', set);
    return () => m.removeEventListener('change', set);
  }, [rt, theme]);
}

function DocumentRoot({ theme, className }: { theme?: MkpDocumentProps['theme']; className?: string }): ReactNode {
  const tree = useMkpView();
  const root = useRef<HTMLDivElement>(null);
  useMkpWidth(root);
  useMkpTheme(theme ?? 'auto');
  return (
    <div ref={root} className={['mkp-root', className].filter(Boolean).join(' ')} data-mkp-theme={theme && theme !== 'auto' ? theme : undefined}>
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
