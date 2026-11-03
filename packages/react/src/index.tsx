// @mkp/react: render an MKP bundle on the web with the core runtime.

import { useEffect, useMemo, useState, useSyncExternalStore, type ReactNode } from 'react';
import { Runtime, type IRBundle, type MathsRenderer, type RuntimeOptions } from '@mkp/core';
import { BASE_CSS, tokenCss, type TokenMap } from './style';
import { Kids, RuntimeCtx } from './nodes';

export { Node, Kids, Runs, MathSpan, RuntimeCtx } from './nodes';
export { Canvas } from './canvas';
export { tokenCss, BASE_CSS, type TokenMap } from './style';

export interface MkpDocumentProps {
  bundle: IRBundle;
  /** a runtime to drive (tests and hosts that call commands); one is made otherwise */
  runtime?: Runtime;
  maths?: MathsRenderer;
  theme?: 'light' | 'dark' | 'auto';
  /** a provider's own values for token names */
  tokens?: TokenMap;
  reducedMotion?: boolean;
  options?: RuntimeOptions;
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

export function MkpDocument(props: MkpDocumentProps): ReactNode {
  const prefers = usePrefersReducedMotion();
  const reducedMotion = props.reducedMotion ?? prefers;
  const made = useMemo(() => props.runtime ?? new Runtime(props.bundle, { ...props.options, maths: props.maths, reducedMotion }), [props.bundle, props.runtime]); // eslint-disable-line react-hooks/exhaustive-deps
  const rt = made;
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
      <style>{css}</style>
      <div className={['mkp-root', props.className].filter(Boolean).join(' ')} data-theme={props.theme && props.theme !== 'auto' ? props.theme : undefined}>
        <Kids nodes={tree} />
      </div>
    </RuntimeCtx.Provider>
  );
}
