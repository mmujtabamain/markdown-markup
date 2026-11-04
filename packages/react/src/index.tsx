// @mkp/react: render an MKP bundle on the web with the core runtime.

import { createContext, useContext, useEffect, useMemo, useState, useSyncExternalStore, type ReactNode } from 'react';
import { Runtime, type IRBundle, type MathsRenderer, type RuntimeOptions, type VNode } from '@mkp/core';
import { BASE_CSS, tokenCss, type TokenMap } from './style';
import { Kids, RuntimeCtx } from './nodes';

export { Node, Kids, Runs, MathSpan, RuntimeCtx } from './nodes';
export { Canvas } from './canvas';
export { tokenCss, BASE_CSS, type TokenMap } from './style';

export interface MkpProviderProps {
  bundle: IRBundle;
  /** a runtime to drive (tests and hosts that call commands); one is made otherwise */
  runtime?: Runtime;
  maths?: MathsRenderer;
  /** a provider's own values for token names */
  tokens?: TokenMap;
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

/** The document's top-level view nodes (one per body item, in order), inside an `MkpProvider`. */
export function useMkpView(): VNode[] {
  const v = useContext(ViewCtx);
  if (!v) throw new Error('useMkpView is for components inside <MkpProvider>');
  return v;
}

/**
 * The runtime, its clock and the token stylesheet, with no element of its own: a host that lays
 * blocks out in its own page (sections, columns) renders each top-level node from `useMkpView()`
 * with `Node` inside its own `.mkp-root` element. `MkpDocument` is this plus one root that stacks them.
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
  const css = useMemo(() => BASE_CSS + tokenCss(props.bundle.tokens, props.tokens), [props.bundle, props.tokens]);
  const ctx = useMemo(() => ({ rt, reducedMotion }), [rt, reducedMotion]);
  return (
    <RuntimeCtx.Provider value={ctx}>
      <ViewCtx.Provider value={tree}>
        <style>{css}</style>
        {props.children}
      </ViewCtx.Provider>
    </RuntimeCtx.Provider>
  );
}

function DocumentRoot({ theme, className }: { theme?: MkpDocumentProps['theme']; className?: string }): ReactNode {
  const tree = useMkpView();
  const reducedMotion = useContext(RuntimeCtx)!.reducedMotion;
  return (
    <div className={['mkp-root', className].filter(Boolean).join(' ')} data-theme={theme && theme !== 'auto' ? theme : undefined} data-reduced-motion={reducedMotion || undefined}>
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
