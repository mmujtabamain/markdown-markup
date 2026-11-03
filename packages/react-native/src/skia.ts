// gfx@1 on React Native draws `pixels` with Skia's runtime effects. Skia is an optional peer: when
// the app does not include @shopify/react-native-skia, the renderer declares only core@1 and the
// runtime hands it each gfx node's fallback instead (spec 8.1).

import type { ComponentType, ReactNode } from 'react';
import type { StyleProp, ViewStyle } from 'react-native';

export interface SkRuntimeEffect {
  readonly __brand?: 'SkRuntimeEffect';
}

/** The part of @shopify/react-native-skia this renderer uses. */
export interface SkiaModule {
  Skia: { RuntimeEffect: { Make(sksl: string): SkRuntimeEffect | null } };
  Canvas: ComponentType<{ style?: StyleProp<ViewStyle>; children?: ReactNode; accessible?: boolean; pointerEvents?: 'none' }>;
  Fill: ComponentType<{ children?: ReactNode }>;
  Shader: ComponentType<{ source: SkRuntimeEffect; uniforms: Record<string, number | number[]> }>;
}

declare const require: (id: string) => unknown;

function load(): SkiaModule | null {
  try {
    // an optional dependency: Metro and Jest both leave a failing require in a try to the runtime
    const m = require('@shopify/react-native-skia') as Partial<SkiaModule> | null;
    return m && m.Skia?.RuntimeEffect && m.Canvas && m.Fill && m.Shader ? (m as SkiaModule) : null;
  } catch {
    return null;
  }
}

let cached: SkiaModule | null | undefined;
let override: SkiaModule | null | undefined;

/** Skia, when the app includes it. */
export function skia(): SkiaModule | null {
  if (override !== undefined) return override;
  if (cached === undefined) cached = load();
  return cached;
}

/** For hosts and tests: provide (or with null, withhold) Skia explicitly; undefined restores detection. */
export function setSkia(m: SkiaModule | null | undefined): void {
  override = m;
}

/** The capabilities this renderer provides on this device. */
export function capabilities(): string[] {
  return skia() ? ['core@1', 'gfx@1'] : ['core@1'];
}

/** A pixels node's uniforms in Skia's shape: `name.x`/`name.y` pairs become float2 arrays. */
export function skiaUniforms(u: Record<string, number>, x: number[], y: number[], size: [number, number]): Record<string, number | number[]> {
  const out: Record<string, number | number[]> = { mkp_x: [x[0], x[1]], mkp_y: [y[0], y[1]], mkp_size: size };
  for (const [k, v] of Object.entries(u)) {
    const m = /^(.*)\.([xy])$/.exec(k);
    if (m) {
      const cur = (out[m[1]] as number[] | undefined) ?? [0, 0];
      cur[m[2] === 'x' ? 0 : 1] = v;
      out[m[1]] = cur;
    } else out[k] = v;
  }
  return out;
}
