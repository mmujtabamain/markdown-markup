// The 2D canvas (spec 8): a coordinate space with layers drawn in order, shapes in data units
// drawn with react-native-svg in pixel space (measured with onLayout), labels and placed elements
// as absolutely positioned views, handles that drag with a PanResponder and move with screen-reader
// actions (WCAG 2.5.7), and with gfx@1: pixels through Skia and a 3D mesh with a camera.

import { useMemo, useRef, useState, type ReactNode } from 'react';
import { Image, PanResponder, Text, View, type AccessibilityActionEvent } from 'react-native';
import { Circle, G, Image as SvgImage, Line, Path, Polygon, Rect, Svg } from 'react-native-svg';
import type { VNode, VShape, VRun } from '@mkp/core';
import { useCtx } from './context';
import { Kids } from './nodes';
import { Runs, useInk } from './runs';
import { skia, skiaUniforms } from './skia';
import type { Theme } from './theme';

const SIZES: Record<string, number> = { s: 160, m: 320, l: 480 };

/** The canvas width: as wide as its parent allows (once laid out), up to its size token. */
function useWidth(max: number, initial: number): [number, (w: number) => void] {
  const [w, setW] = useState<number | null>(null);
  return [Math.max(80, Math.min(max, w ?? initial)), (avail) => setW((prev) => (prev === avail ? prev : avail))];
}

interface Geo {
  X: (v: number) => number;
  Y: (v: number) => number;
  unit: number;
  W: number;
  H: number;
  x: number[];
  y: number[];
  theme: Theme;
  /** views drawn over the SVG (labels, placed elements, handles, pixels) */
  over: ReactNode[];
  /** views drawn under the SVG (pixels) */
  under: ReactNode[];
  opacity: number;
}

export function Canvas({ n }: { n: VNode }): ReactNode {
  const { theme } = useCtx();
  const p = n.p;
  const sizeTok = String(p.size ?? 'm');
  const tokenMax = theme.size(sizeTok);
  const max = sizeTok === 'fill' ? 4000 : typeof tokenMax === 'number' ? tokenMax : SIZES[sizeTok] ?? 320;
  const [W, setAvail] = useWidth(max, Math.min(max, SIZES.m));
  const x = (p.x as number[] | undefined) ?? [-1, 1];
  const y = (p.y as number[] | undefined) ?? [-1, 1];
  const aspect = Number(p.aspect) > 0 ? Number(p.aspect) : (x[1] - x[0]) / (y[1] - y[0]) || 1;
  const H = Math.round(W / aspect);
  const frame = (child: ReactNode): ReactNode => (
    <View style={{ width: '100%', maxWidth: max }} onLayout={(e) => setAvail(e.nativeEvent.layout.width)}>
      {child}
    </View>
  );
  if (Number(p.dims) === 3) return frame(<Canvas3D n={n} W={W} H={H} />);
  const X = (v: number): number => ((v - x[0]) / (x[1] - x[0])) * W;
  const Y = (v: number): number => H - ((v - y[0]) / (y[1] - y[0])) * H;
  const unit = W / (x[1] - x[0]);
  const over: ReactNode[] = [];
  const under: ReactNode[] = [];
  const layers = (n.layers ?? []).map((l) => (
    <G key={l.key} opacity={l.opacity}>
      {l.shapes.map((s) => shape(s, { X, Y, unit, W, H, x, y, theme, over, under, opacity: l.opacity }))}
    </G>
  ));
  return frame(
    <View style={{ width: W, height: H }}>
      {under}
      <View accessible accessibilityRole="image" accessibilityLabel={String(p.label || 'figure')} style={{ position: 'absolute', left: 0, top: 0, width: W, height: H }}>
        <Svg width={W} height={H} viewBox={`0 0 ${W} ${H}`} style={{ overflow: 'visible' }}>
          {layers}
        </Svg>
      </View>
      {over}
    </View>,
  );
}

const paint = (theme: Theme, c: string): string => theme.color(c) ?? 'none';

function shape(s: VShape, g: Geo): ReactNode {
  const { X, Y, unit, theme } = g;
  switch (s.t) {
    case 'rect': {
      const x0 = Math.min(X(s.a[0]), X(s.b[0]));
      const y0 = Math.min(Y(s.a[1]), Y(s.b[1]));
      const r = theme.radius(s.radius);
      return <Rect key={s.key} x={x0} y={y0} width={Math.abs(X(s.b[0]) - X(s.a[0]))} height={Math.abs(Y(s.b[1]) - Y(s.a[1]))} rx={r} ry={r} fill={paint(theme, s.fill)} stroke={paint(theme, s.stroke)} />;
    }
    case 'line': {
      const c = paint(theme, s.stroke);
      return (
        <G key={s.key}>
          <Line x1={X(s.a[0])} y1={Y(s.a[1])} x2={X(s.b[0])} y2={Y(s.b[1])} stroke={c} strokeWidth={s.width} strokeDasharray={s.dash ? [5, 4] : undefined} />
          {s.arrow ? <Polygon points={arrowHead([X(s.a[0]), Y(s.a[1])], [X(s.b[0]), Y(s.b[1])])} fill={c} /> : null}
        </G>
      );
    }
    case 'circle':
      return <Circle key={s.key} cx={X(s.c[0])} cy={Y(s.c[1])} r={Math.max(0.5, s.r * unit)} fill={paint(theme, s.fill)} stroke={paint(theme, s.stroke)} strokeWidth={s.width} />;
    case 'path': {
      if (!s.pts.length) return null;
      const d = s.pts.map((q, i) => `${i ? 'L' : 'M'}${X(q[0]).toFixed(2)},${Y(q[1]).toFixed(2)}`).join(' ') + (s.closed ? ' Z' : '');
      return <Path key={s.key} d={d} fill={paint(theme, s.fill)} stroke={paint(theme, s.stroke)} strokeWidth={s.width} strokeDasharray={s.dash ? [5, 4] : undefined} strokeLinejoin="round" />;
    }
    case 'label':
      g.over.push(<Label key={s.key} s={s} g={g} />);
      return null;
    case 'image': {
      const w = s.w * unit;
      const h = (s.h || s.w) * unit;
      return <SvgImage key={s.key} href={{ uri: s.src }} x={X(s.at[0]) - w / 2} y={Y(s.at[1]) - h / 2} width={w} height={h} accessibilityLabel={s.alt} />;
    }
    case 'place':
      g.over.push(<Placed key={s.key} at={[X(s.at[0]), Y(s.at[1])]} opacity={g.opacity} kids={s.kids} />);
      return null;
    case 'handle':
      g.over.push(<Handle key={s.key} s={s} g={g} />);
      return null;
    case 'pixels':
      g.under.push(<Pixels key={s.key} s={s} g={g} />);
      return null;
    case 'mesh':
      return null;
  }
}

function arrowHead(a: number[], b: number[]): string {
  const ang = Math.atan2(b[1] - a[1], b[0] - a[0]);
  const s = 8;
  const p1 = [b[0] - s * Math.cos(ang - 0.4), b[1] - s * Math.sin(ang - 0.4)];
  const p2 = [b[0] - s * Math.cos(ang + 0.4), b[1] - s * Math.sin(ang + 0.4)];
  return `${b[0]},${b[1]} ${p1.join(',')} ${p2.join(',')}`;
}

/**
 * Centres a view on a point (or anchors it by a compass side) once its own size is known;
 * until then it stays invisible so nothing flashes in the wrong place.
 */
function useAnchored(anchor: string): [{ w: number; h: number } | null, (w: number, h: number) => void, (sz: { w: number; h: number }) => [number, number]] {
  const [size, setSize] = useState<{ w: number; h: number } | null>(null);
  const off = (sz: { w: number; h: number }): [number, number] => anchor === 'center' ? [-sz.w / 2, -sz.h / 2] : [anchor.includes('e') ? 0 : anchor.includes('w') ? -sz.w : -sz.w / 2, anchor.includes('n') ? -sz.h : anchor.includes('s') ? 0 : -sz.h / 2];
  return [size, (w, h) => setSize((prev) => (prev && prev.w === w && prev.h === h ? prev : { w, h })), off];
}

function Label({ s, g }: { s: Extract<VShape, { t: 'label' }>; g: Geo }): ReactNode {
  const ink = useInk();
  const [size, setSize, off] = useAnchored(s.anchor);
  const o = size ? off(size) : [0, 0];
  const f = g.theme.font('body');
  const fs = f.fontSize * 0.95;
  const tone = s.tone === 'ink' ? ink : g.theme.color(s.tone) ?? ink;
  return (
    <View
      pointerEvents="none"
      onLayout={(e) => setSize(e.nativeEvent.layout.width, e.nativeEvent.layout.height)}
      style={{
        position: 'absolute',
        left: g.X(s.at[0]) + o[0],
        top: g.Y(s.at[1]) + o[1],
        opacity: size ? g.opacity : 0,
        // a chip: the label on the surface in a thin outline of its tone
        ...(s.chip ? { paddingHorizontal: 6, paddingVertical: 1, borderWidth: 1, borderRadius: 5, borderColor: g.theme.mix(tone ?? '#888', g.theme.color('surface') ?? '#fff', 0.35), backgroundColor: g.theme.color('surface') } : null),
      }}
    >
      <Text style={{ color: tone, fontFamily: f.fontFamily, fontSize: s.chip ? fs * 0.9 : fs, fontWeight: s.chip ? '600' : undefined }} numberOfLines={1}>
        <Runs runs={s.runs as VRun[]} fontSize={fs} />
      </Text>
    </View>
  );
}

function Placed({ at, opacity, kids }: { at: [number, number]; opacity: number; kids: VNode[] }): ReactNode {
  const [size, setSize, off] = useAnchored('center');
  const o = size ? off(size) : [0, 0];
  return (
    <View onLayout={(e) => setSize(e.nativeEvent.layout.width, e.nativeEvent.layout.height)} style={{ position: 'absolute', left: at[0] + o[0], top: at[1] + o[1], opacity: size ? opacity : 0 }}>
      <Kids nodes={kids} />
    </View>
  );
}

const fmt = (v: number): string => String(Number(v.toPrecision(3)));
const TOUCH = 44;

/**
 * A drag handle. Drag it (a PanResponder), or move it with the screen reader: adjustable
 * increment/decrement move along x, and named actions move in each direction (WCAG 2.5.7).
 */
function Handle({ s, g }: { s: Extract<VShape, { t: 'handle' }>; g: Geo }): ReactNode {
  const { rt, theme } = useCtx();
  const live = useRef({ s, g });
  live.current = { s, g };
  const start = useRef<[number, number]>([0, 0]);
  const toData = (px: number, py: number): number[] => {
    const { g: q } = live.current;
    return [q.x[0] + (px / q.W) * (q.x[1] - q.x[0]), q.y[0] + ((q.H - py) / q.H) * (q.y[1] - q.y[0])];
  };
  const pan = useMemo(
    () =>
      PanResponder.create({
        onStartShouldSetPanResponder: () => true,
        onMoveShouldSetPanResponder: () => true,
        onPanResponderTerminationRequest: () => false,
        onPanResponderGrant: () => {
          const { s: h, g: q } = live.current;
          start.current = [q.X(h.at[0]), q.Y(h.at[1])];
        },
        onPanResponderMove: (_e, d) => {
          const { s: h } = live.current;
          rt.dispatch(h.key, 'drag', toData(start.current[0] + d.dx, start.current[1] + d.dy));
        },
      }),
    [rt], // eslint-disable-line react-hooks/exhaustive-deps
  );
  const stepX = (s.x[1] - s.x[0]) / 50;
  const stepY = (s.y[1] - s.y[0]) / 50;
  const move = (dx: number, dy: number): void => rt.dispatch(s.key, 'drag', [s.at[0] + dx, s.at[1] + dy]);
  const onAction = (e: AccessibilityActionEvent): void => {
    switch (e.nativeEvent.actionName) {
      case 'increment':
      case 'right':
        return move(stepX, 0);
      case 'decrement':
      case 'left':
        return move(-stepX, 0);
      case 'up':
        return move(0, stepY);
      case 'down':
        return move(0, -stepY);
    }
  };
  const tone = theme.color(s.tone) ?? theme.color('accent');
  return (
    <View
      accessible
      accessibilityRole="adjustable"
      accessibilityLabel={s.label}
      accessibilityValue={{ text: `(${fmt(s.at[0])}, ${fmt(s.at[1])})` }}
      accessibilityActions={[
        { name: 'increment', label: 'move right' },
        { name: 'decrement', label: 'move left' },
        { name: 'up', label: 'move up' },
        { name: 'down', label: 'move down' },
        { name: 'left', label: 'move left' },
        { name: 'right', label: 'move right' },
      ]}
      onAccessibilityAction={onAction}
      hitSlop={4}
      style={{ position: 'absolute', left: g.X(s.at[0]) - TOUCH / 2, top: g.Y(s.at[1]) - TOUCH / 2, width: TOUCH, height: TOUCH, alignItems: 'center', justifyContent: 'center', opacity: g.opacity }}
      {...pan.panHandlers}
    >
      <View pointerEvents="none" style={{ width: 14, height: 14, borderRadius: 7, backgroundColor: tone, borderWidth: 2, borderColor: theme.color('surface') }} />
    </View>
  );
}

/** pixels: the compiled SkSL in a Skia canvas, or the fallback image (the runtime supplies it without gfx@1). */
function Pixels({ s, g }: { s: Extract<VShape, { t: 'pixels' }>; g: Geo }): ReactNode {
  const sk = s.fallback ? null : skia();
  const effect = useMemo(() => {
    if (!sk) return null;
    try {
      return sk.Skia.RuntimeEffect.Make(s.sksl);
    } catch {
      return null;
    }
  }, [sk, s.sksl]);
  const box = { position: 'absolute' as const, left: 0, top: 0, width: g.W, height: g.H, opacity: g.opacity };
  if (sk && effect) {
    const { Canvas: SkCanvas, Fill, Shader } = sk;
    return (
      <SkCanvas style={box} pointerEvents="none">
        <Fill>
          <Shader source={effect} uniforms={skiaUniforms(s.uniforms, g.x, g.y, [g.W, g.H])} />
        </Fill>
      </SkCanvas>
    );
  }
  if (s.fallback) return <Image source={{ uri: s.fallback }} style={box} resizeMode="stretch" accessibilityIgnoresInvertColors />;
  return null;
}

/** dims=3: a mesh z = f(x, y) seen through a camera the reader can turn (drag, or screen-reader actions). */
function Canvas3D({ n, W, H }: { n: VNode; W: number; H: number }): ReactNode {
  const { theme } = useCtx();
  const p = n.p;
  const view = (p.view as number[] | undefined) ?? [35, 25];
  const [cam, setCam] = useState<[number, number]>([view[0], view[1]]);
  const turn = (da: number, de: number): void => setCam(([a, b]) => [a + da, Math.max(-89, Math.min(89, b + de))]);
  const last = useRef<[number, number]>([0, 0]);
  const pan = useMemo(
    () =>
      PanResponder.create({
        onStartShouldSetPanResponder: () => true,
        onMoveShouldSetPanResponder: () => true,
        onPanResponderGrant: () => (last.current = [0, 0]),
        onPanResponderMove: (_e, d) => {
          const [x0, y0] = last.current;
          last.current = [d.dx, d.dy];
          turn((d.dx - x0) * 0.5, (d.dy - y0) * 0.5);
        },
      }),
    [],
  );
  const xr = (p.x as number[] | undefined) ?? [-1, 1];
  const yr = (p.y as number[] | undefined) ?? [-1, 1];
  const zr = (p.z as number[] | undefined) ?? [-1, 1];
  const az = (cam[0] * Math.PI) / 180;
  const el = (cam[1] * Math.PI) / 180;
  const norm = (v: number, r: number[]): number => ((v - r[0]) / (r[1] - r[0]) - 0.5) * 2;
  const project = (x: number, y: number, z: number): [number, number, number] => {
    const X = norm(x, xr);
    const Y = norm(y, yr);
    const Z = norm(z, zr) * 0.8;
    const x1 = X * Math.cos(az) - Y * Math.sin(az);
    const y1 = X * Math.sin(az) + Y * Math.cos(az);
    const sy = Z * Math.cos(el) - y1 * Math.sin(el);
    const depth = y1 * Math.cos(el) + Z * Math.sin(el);
    const s = Math.min(W, H) * 0.33;
    return [W / 2 + x1 * s, H / 2 - sy * s, depth];
  };
  const surface = theme.color('surface');
  const polys: { d: string; depth: number; fill: string | undefined; key: string }[] = [];
  let fallback: string | undefined;
  for (const l of n.layers ?? []) {
    for (const s of l.shapes) {
      if (s.t !== 'mesh') continue;
      if (s.fallback) fallback = s.fallback;
      const N = s.n;
      const base = theme.color(s.fill) ?? theme.color('accent');
      for (let j = 0; j < N; j++) {
        for (let i = 0; i < N; i++) {
          const pt = (ii: number, jj: number): [number, number, number] => project(xr[0] + ((xr[1] - xr[0]) * ii) / N, yr[0] + ((yr[1] - yr[0]) * jj) / N, s.z[jj][ii]);
          const q = [pt(i, j), pt(i + 1, j), pt(i + 1, j + 1), pt(i, j + 1)];
          const zAvg = (s.z[j][i] + s.z[j][i + 1] + s.z[j + 1][i + 1] + s.z[j + 1][i]) / 4;
          const shade = Math.min(1, Math.max(0, (zAvg - zr[0]) / (zr[1] - zr[0])));
          polys.push({ key: `${s.key}/${i}/${j}`, d: q.map((v, k) => `${k ? 'L' : 'M'}${v[0].toFixed(1)},${v[1].toFixed(1)}`).join(' ') + 'Z', depth: q.reduce((a, v) => a + v[2], 0) / 4, fill: theme.mix(base, surface, 0.35 + 0.65 * shade) });
        }
      }
    }
  }
  polys.sort((a, b) => a.depth - b.depth);
  const label = String(p.label || '3D surface');
  if (fallback && !polys.length) return <Image source={{ uri: fallback }} style={{ width: W, height: H }} accessibilityLabel={label} />;
  return (
    <View
      accessible
      accessibilityRole="adjustable"
      accessibilityLabel={label}
      accessibilityHint="turn the view with the actions, or drag"
      accessibilityValue={{ text: `azimuth ${Math.round(cam[0])}°, elevation ${Math.round(cam[1])}°` }}
      accessibilityActions={[
        { name: 'increment', label: 'turn right' },
        { name: 'decrement', label: 'turn left' },
        { name: 'up', label: 'tilt up' },
        { name: 'down', label: 'tilt down' },
      ]}
      onAccessibilityAction={(e) => {
        const m: Record<string, [number, number]> = { increment: [5, 0], decrement: [-5, 0], up: [0, 5], down: [0, -5] };
        const d = m[e.nativeEvent.actionName];
        if (d) turn(d[0], d[1]);
      }}
      style={{ width: W, height: H }}
      {...pan.panHandlers}
    >
      <Svg width={W} height={H}>
        {polys.map((q) => (
          <Path key={q.key} d={q.d} fill={q.fill} stroke={surface} strokeWidth={0.4} />
        ))}
      </Svg>
    </View>
  );
}
