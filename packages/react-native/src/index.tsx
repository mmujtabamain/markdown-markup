// @mkp/react-native: render an MKP bundle on React Native with the core runtime.

import { useEffect, useMemo, useRef, useState, useSyncExternalStore, type ReactNode } from 'react';
import { AccessibilityInfo, useColorScheme, View, type StyleProp, type ViewStyle } from 'react-native';
import { Runtime, type IRBundle, type MathsRenderer, type RuntimeOptions } from '@mkp/core';
import { RuntimeCtx, type Ctx } from './context';
import { Kids } from './nodes';
import { capabilities } from './skia';
import { makeTheme, type Scheme, type TokenMap } from './theme';

export { Node, Kids } from './nodes';
export { Runs, MathView, InkCtx } from './runs';
export { Canvas } from './canvas';
export { RuntimeCtx, MeasureCtx, useCtx, type Ctx, type Registry } from './context';
export { makeTheme, mixColors, fontFamily, type Theme, type TokenMap, type Scheme, type FontToken } from './theme';
export { capabilities, setSkia, skia, skiaUniforms, type SkiaModule } from './skia';

export interface MkpDocumentProps {
  bundle: IRBundle;
  /** a runtime to drive (tests and hosts that call commands); one is made otherwise */
  runtime?: Runtime;
  maths?: MathsRenderer;
  theme?: 'light' | 'dark' | 'auto';
  /** a provider's own values for token names */
  tokens?: TokenMap;
  /** overrides the system's reduce-motion setting */
  reducedMotion?: boolean;
  options?: RuntimeOptions;
  style?: StyleProp<ViewStyle>;
}

/** The system's reduce-motion setting, kept current (when `enabled`; a host's override skips it). */
export function useReduceMotion(enabled = true): boolean {
  const [on, setOn] = useState(false);
  useEffect(() => {
    if (!enabled) return undefined;
    let live = true;
    AccessibilityInfo.isReduceMotionEnabled()
      .then((v) => live && setOn(!!v))
      .catch(() => undefined);
    const sub = AccessibilityInfo.addEventListener('reduceMotionChanged', (v) => setOn(!!v));
    return () => {
      live = false;
      sub?.remove();
    };
  }, [enabled]);
  return on;
}

export function MkpDocument(props: MkpDocumentProps): ReactNode {
  const system = useReduceMotion(props.reducedMotion === undefined);
  const reducedMotion = props.reducedMotion ?? system;
  const rt = useMemo(
    () => props.runtime ?? new Runtime(props.bundle, { capabilities: capabilities(), ...props.options, maths: props.maths, reducedMotion }),
    [props.bundle, props.runtime], // eslint-disable-line react-hooks/exhaustive-deps
  );
  const scheme = useColorScheme();
  const mode: Scheme = props.theme === 'dark' || props.theme === 'light' ? props.theme : scheme === 'dark' ? 'dark' : 'light';
  const theme = useMemo(() => makeTheme(props.bundle.tokens, props.tokens, mode), [props.bundle, props.tokens, mode]);

  // play: drive the runtime's clock on animation frames while anything plays
  const raf = useRef<ReturnType<typeof requestAnimationFrame> | null>(null);
  const kick = useRef(() => undefined as void);
  kick.current = () => {
    if (raf.current !== null || !rt.playing()) return;
    let last = 0;
    const loop = (t: number): void => {
      if (!rt.playing()) {
        raf.current = null;
        return;
      }
      if (last) rt.tick(Math.min(100, t - last));
      last = t;
      raf.current = requestAnimationFrame(loop);
    };
    raf.current = requestAnimationFrame(loop);
  };
  useEffect(() => {
    kick.current();
    return () => {
      if (raf.current !== null) cancelAnimationFrame(raf.current);
      raf.current = null;
    };
  }, [rt]);

  const tree = useSyncExternalStore(
    (notify) =>
      rt.subscribe(() => {
        kick.current();
        notify();
      }),
    () => rt.view(),
  );

  const ctx = useMemo<Ctx>(() => ({ rt, theme }), [rt, theme]);
  return (
    <RuntimeCtx.Provider value={ctx}>
      <View style={[{ backgroundColor: theme.color('surface') }, props.style]}>
        <Kids nodes={tree} />
      </View>
    </RuntimeCtx.Provider>
  );
}
