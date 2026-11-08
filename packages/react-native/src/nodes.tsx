// The base set as React Native components (spec 8): the four containers, text, media, press, range,
// field, overlay, canvas, Markdown blocks, the control bar, scopes with arrows, and the error boundary.

import { useCallback, useContext, useEffect, useMemo, useRef, useState, type ComponentRef, type ReactNode } from 'react';
import {
  Modal,
  PanResponder,
  Pressable,
  ScrollView,
  Text,
  TextInput,
  View,
  type AccessibilityActionEvent,
  type AccessibilityRole,
  type GestureResponderEvent,
  type LayoutChangeEvent,
  type LayoutRectangle,
  type Role,
  type TextStyle,
  type ViewStyle,
} from 'react-native';
import { G, Path, Polygon, Svg } from 'react-native-svg';
import { ARROW_CORNERS, arrowPaths, type ArrowEnds, type Rect, type VArrow, type VNode, type VRun } from '@mkp/core';
import { FlowCtx, KeepCtx, MeasureCtx, useCtx, type Measurable, type Registry } from './context';
import { InkCtx, InlineImage, MathView, Runs, useInk, type MathLike } from './runs';
import { Canvas } from './canvas';
import { Frame, Icon, Pane, Zoom } from './shell';
import { curve, estimate, markSvg, placeLabels, polyline, trackList, withEnds, type Mark, type Pt } from './geometry';
import type { Theme } from './theme';

// ---------------------------------------------------------------------------------------------
// Children keyed by identity. Nothing animates: a change to the view is drawn as it is.

export function Kids({ nodes, cell }: { nodes: VNode[] | undefined; cell?: (n: VNode) => ViewStyle | undefined }): ReactNode {
  return (nodes ?? []).map((n) => <Slot key={n.key} n={n} extra={cell?.(n)} />);
}

const SELF: Record<string, ViewStyle['alignSelf']> = { start: 'flex-start', center: 'center', end: 'flex-end', stretch: 'stretch' };

/** The place its container gives a node: grow, basis, its own alignment (GAPS 41), and width=fit or fill. */
function layoutStyle(n: VNode, theme: Theme, flow: 'row' | 'column'): ViewStyle {
  const basis = n.layout?.basis ? theme.size(n.layout.basis) : undefined;
  const self = n.layout?.self ? SELF[n.layout.self] : n.p.width === 'fit' && flow === 'column' ? 'flex-start' : undefined;
  return {
    ...(n.layout?.grow ? { flexGrow: 1, flexShrink: 1, flexBasis: 0 } : null),
    ...(basis !== undefined ? { flexBasis: basis } : null),
    ...(self ? { alignSelf: self } : null),
    ...(n.p.width === 'fill' ? { width: '100%' } : null),
  };
}

/** One keyed child: a wrapper that reports its layout to scopes measuring arrows, and is kept in view when it says so. */
function Slot({ n, extra }: { n: VNode; extra?: ViewStyle }): ReactNode {
  const { theme } = useCtx();
  const regs = useContext(MeasureCtx);
  const flow = useContext(FlowCtx);
  const keep = useContext(KeepCtx);
  const host = useRef<ComponentRef<typeof View>>(null);
  useEffect(() => {
    for (const r of regs) r.register(n.key, host.current as Measurable | null, !!n.hidden);
    return () => {
      for (const r of regs) r.register(n.key, null, true);
    };
  }, [regs, n.key, n.hidden]);
  const kept = !!n.layout?.keep;
  useEffect(() => {
    if (kept && keep && host.current) keep(host.current as Measurable);
  }, [kept, keep]);
  // minheight and aspect (at its width), as its first paint had them: taller when its content is
  const aspect = n.size?.aspect;
  const [width, setWidth] = useState(0);
  const onLayout =
    regs.length || aspect
      ? (e: LayoutChangeEvent) => {
          regs.forEach((r) => r.layout(n.key, e.nativeEvent.layout));
          if (aspect) setWidth(e.nativeEvent.layout.width);
        }
      : undefined;
  return (
    <View
      ref={host}
      testID={n.key}
      nativeID={n.id}
      onLayout={onLayout}
      accessibilityElementsHidden={n.hidden}
      importantForAccessibility={n.hidden ? 'no-hide-descendants' : 'auto'}
      style={[layoutStyle(n, theme, flow), extra, n.size?.minheight || (aspect && width) ? { minHeight: Math.max(n.size?.minheight ?? 0, aspect && width ? width / aspect : 0) } : null, n.hidden ? { display: 'none' } : null]}
    >
      <Node n={n} />
    </View>
  );
}

// ---------------------------------------------------------------------------------------------

const ALIGN: Record<string, ViewStyle['alignItems']> = { start: 'flex-start', center: 'center', end: 'flex-end', stretch: 'stretch', baseline: 'baseline' };
const JUSTIFY: Record<string, ViewStyle['justifyContent']> = { start: 'flex-start', center: 'center', end: 'flex-end', between: 'space-between', around: 'space-around' };
const TEXT_ALIGN: Record<string, TextStyle['textAlign']> = { start: 'left', center: 'center', end: 'right', left: 'left', right: 'right' };
const QUOTE_TONE: Record<string, string> = { note: 'info', tip: 'ok', important: 'accent', warning: 'warn', caution: 'bad' };
const WEIGHT: Record<string, number> = { thin: 1, normal: 2, thick: 4 };
const SIDES: Record<string, ('Top' | 'Right' | 'Bottom' | 'Left')[]> = { top: ['Top'], right: ['Right'], bottom: ['Bottom'], left: ['Left'], x: ['Left', 'Right'], y: ['Top', 'Bottom'] };

/** A container's look: background, a border on the sides `edge` names at its `weight` (GAPS 154), corners, shadow, dim and blur. */
function boxStyle(p: Record<string, unknown>, theme: Theme): ViewStyle {
  const stroke = theme.color(p.stroke);
  const border: Record<string, unknown> = {};
  if (stroke) {
    const w = WEIGHT[String(p.weight)] ?? 1;
    const sides = SIDES[String(p.edge ?? 'all')];
    border.borderColor = stroke;
    if (!sides) border.borderWidth = w;
    else for (const s of sides) border[`border${s}Width`] = w;
    if (p.line === 'dashed' || p.line === 'dotted') border.borderStyle = p.line;
  }
  const min = theme.size(p.minwidth);
  return {
    padding: theme.space(p.pad),
    // padx and pady in pad's place on their sides
    ...(theme.space(p.padx) !== undefined ? { paddingHorizontal: theme.space(p.padx) } : null),
    ...(theme.space(p.pady) !== undefined ? { paddingVertical: theme.space(p.pady) } : null),
    gap: theme.space(p.gap),
    backgroundColor: p.tint && p.tint !== 'none' ? theme.mix(theme.color(p.tint), theme.color('surface'), 0.12) : theme.color(p.fill),
    ...(border as ViewStyle),
    borderRadius: theme.radius(p.radius),
    ...theme.shadow(p.shadow),
    ...(min !== undefined && p.scroll !== 'x' ? { minWidth: min } : null),
    // faded back; blurred until revealed (no blur on native: nearly faded out)
    ...(p.blur ? { opacity: 0.12 } : p.dim ? { opacity: 0.4 } : null),
  };
}

/** A row's role: what the runtime gave it (a control, a choice), or a tablist when it holds tabs. */
function rowRole(n: VNode): Role | undefined {
  if (n.p.role === 'control') return 'group';
  if (n.p.role) return n.p.role as Role;
  return n.kids?.some((k) => k.t === 'press' && k.p.kind === 'tab') ? 'tablist' : undefined;
}

/**
 * A container's own view, with a press on its own background (not on a child) raising click
 * (pointer only, GAPS 125), and scroll=x a horizontal ScrollView inside its outline (GAPS 149).
 */
function Box({ n, style, flow, role, children }: { n: VNode; style: ViewStyle; flow: 'row' | 'column'; role?: Role; children: ReactNode }): ReactNode {
  const { rt, theme } = useCtx();
  const p = n.p;
  const click = n.ev?.includes('click')
    ? {
        onStartShouldSetResponder: (e: GestureResponderEvent) => e.target === e.currentTarget,
        onResponderRelease: () => rt.dispatch(n.key, 'click'),
      }
    : {};
  const label = p.label ? String(p.label) : undefined;
  const inner = <FlowCtx.Provider value={flow}>{children}</FlowCtx.Provider>;
  if (p.scroll === 'x') {
    const { padding, gap, ...outline } = { ...boxStyle(p, theme), ...style } as ViewStyle & { padding?: number; gap?: number };
    const { flexDirection, flexWrap, alignItems, justifyContent } = style;
    return (
      <View role={role} accessibilityLabel={label} style={outline} {...click}>
        <Scroller horizontal content={{ flexDirection, flexWrap, alignItems, justifyContent, padding, gap, minWidth: theme.size(p.minwidth) ?? '100%', flexGrow: 1 }}>
          {inner}
        </Scroller>
      </View>
    );
  }
  return (
    <View role={role} accessibilityLabel={label} style={{ ...style, ...boxStyle(p, theme) }} {...click}>
      {inner}
    </View>
  );
}

const runs = (p: Record<string, unknown>): VRun[] => (p.runs as VRun[] | undefined) ?? [];

export function Node({ n }: { n: VNode }): ReactNode {
  const { theme, externs, rt } = useCtx();
  const ink = useInk();
  const p = n.p;
  const body = theme.font('body');
  // a pack's extern the host draws itself, by id
  const Ext = n.ext ? externs?.[n.ext] : undefined;
  if (Ext)
    return (
      <Ext
        id={n.ext!}
        props={p}
        slots={Object.fromEntries(Object.entries(n.slots ?? {}).map(([k, s]) => [k, <Kids key={k} nodes={s} />]))}
        records={Object.fromEntries(Object.entries(n.recs ?? {}).map(([k, list]) => [k, list.map((s, i) => <Kids key={i} nodes={s} />)]))}
        summary={n.summary}
        size={n.size}
        dispatch={(event, payload) => rt.dispatch(n.key, event, payload)}
      >
        <Kids nodes={n.kids ?? []} />
      </Ext>
    );
  switch (n.t) {
    case 'scope':
      return <Scope n={n} />;
    case 'error':
      return (
        <View accessibilityRole="alert" style={{ borderWidth: 1, borderColor: theme.color('bad'), borderRadius: theme.radius('card'), padding: theme.space('m') }}>
          <Text style={{ color: theme.color('ink'), fontSize: body.fontSize }}>{String(p.summary || p.name)}</Text>
          <Text style={{ color: theme.color('bad'), fontSize: body.fontSize * 0.875, marginTop: theme.space('s') }}>{String(p.message)}</Text>
        </View>
      );
    case 'bar':
      return (
        <View
          accessibilityRole="toolbar"
          accessibilityLabel="controls"
          style={{ flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', rowGap: theme.space('m'), columnGap: theme.space('l'), paddingTop: theme.space('s'), marginTop: theme.space('m'), borderTopWidth: 1, borderTopColor: theme.color('line') }}
        >
          <Kids nodes={n.kids} />
        </View>
      );
    case 'column':
      return (
        <Box n={n} flow="column" style={{ flexDirection: 'column', alignItems: ALIGN[String(p.align)] ?? 'stretch', justifyContent: JUSTIFY[String(p.justify)] }}>
          <Kids nodes={n.kids} />
        </Box>
      );
    case 'row':
      return (
        <Box n={n} flow="row" role={rowRole(n)} style={{ flexDirection: 'row', flexWrap: p.wrap === false ? 'nowrap' : 'wrap', alignItems: ALIGN[String(p.align)] ?? 'flex-start', justifyContent: JUSTIFY[String(p.justify)] ?? 'flex-start' }}>
          <Kids nodes={n.kids} />
        </Box>
      );
    case 'grid':
      return <Grid n={n} />;
    case 'stack':
      return <Stack n={n} />;
    case 'text': {
      const f = theme.font(p.font ?? 'body');
      const scale = p.size === 'small' ? 0.875 : p.size === 'large' ? 1.25 : 1;
      // none: the colour around it, which a press passes down (InkCtx)
      const tone = String(p.tone ?? 'none');
      const lines = Number(p.lines) || 0;
      const st: TextStyle = {
        color: tone === 'none' ? ink : theme.color(tone) ?? ink,
        fontFamily: f.fontFamily,
        fontSize: f.fontSize * scale,
        lineHeight: f.lineHeight * scale,
        fontWeight: p.weight === 'bold' ? '700' : p.weight === 'medium' ? '500' : f.fontWeight,
        textAlign: TEXT_ALIGN[String(p.align)] ?? undefined,
        minHeight: lines ? f.lineHeight * scale * lines : undefined,
        ...(p.caps ? { textTransform: 'uppercase', letterSpacing: f.fontSize * scale * 0.06 } : null),
      };
      // clipped at its lines (one with no lines=) with an ellipsis (GAPS 151)
      const clip = p.clip ? lines || 1 : p.wrap === false ? 1 : undefined;
      return (
        <Text style={st} numberOfLines={clip} ellipsizeMode={clip ? 'tail' : undefined}>
          <Runs runs={runs(p)} fontSize={f.fontSize * scale} />
        </Text>
      );
    }
    case 'image':
      return <BlockImage src={String(p.src)} alt={String(p.alt ?? '')} max={typeof theme.size(p.size) === 'number' ? (theme.size(p.size) as number) : undefined} />;
    case 'press':
      return <Press n={n} />;
    case 'range':
      return <Range n={n} />;
    case 'meter':
      return <Meter n={n} />;
    case 'field':
      return <Field n={n} />;
    case 'overlay':
      return <Overlay n={n} />;
    case 'canvas':
      return <Canvas n={n} />;
    case 'frame':
      return <Frame n={n} />;
    case 'pane':
      return <Pane n={n} />;
    case 'zoom':
      return <Zoom n={n} />;
    case 'icon':
      return <Icon n={n} />;
    case 'paragraph':
      return (
        <Text style={{ color: ink, fontFamily: body.fontFamily, fontSize: body.fontSize, lineHeight: body.lineHeight, marginVertical: body.fontSize * 0.5 }}>
          <Runs runs={runs(p)} fontSize={body.fontSize} />
        </Text>
      );
    case 'heading': {
      const level = Math.min(6, Math.max(1, Number(p.level) || 2));
      const h = theme.font('heading');
      const scale = level === 1 ? 1.35 : level === 2 ? 1 : level === 3 ? 0.85 : 0.75;
      return (
        <Text
          accessibilityRole="header"
          nativeID={(p.anchor as string | undefined) ?? undefined}
          style={{ color: ink, fontFamily: h.fontFamily, fontWeight: h.fontWeight, fontSize: h.fontSize * scale, lineHeight: h.lineHeight * scale, marginTop: h.fontSize * scale * 0.6, marginBottom: h.fontSize * scale * 0.3 }}
        >
          <Runs runs={runs(p)} fontSize={h.fontSize * scale} />
        </Text>
      );
    }
    case 'divider':
      return <View accessibilityRole="none" style={{ height: 1, backgroundColor: theme.color('line'), marginVertical: theme.space('l') }} />;
    case 'code':
      return <Code n={n} />;
    case 'math':
      return <MathBlock n={n} />;
    case 'quote': {
      const alert = String(p.alert ?? 'none');
      const toneName = QUOTE_TONE[alert];
      const tone = theme.color(toneName ?? 'muted');
      return (
        <View
          accessibilityRole={toneName ? 'summary' : undefined}
          style={{ marginVertical: body.fontSize * 0.6, paddingVertical: theme.space('s'), paddingHorizontal: theme.space('l'), borderLeftWidth: 4, borderLeftColor: tone, backgroundColor: theme.mix(tone, theme.color('surface'), 0.09), borderTopRightRadius: theme.radius('card'), borderBottomRightRadius: theme.radius('card') }}
        >
          {toneName ? <Text style={{ color: tone, fontWeight: '700', fontSize: body.fontSize, textTransform: 'capitalize' }}>{alert}</Text> : null}
          <Kids nodes={n.kids} />
        </View>
      );
    }
    case 'list':
      return <List n={n} />;
    case 'table':
      return <Table n={n} />;
    case 'footnote':
      return (
        <View nativeID={`fn-${String(p.label)}`} style={{ flexDirection: 'row', gap: theme.space('s') }}>
          <Text style={{ color: ink, fontSize: body.fontSize * 0.75 }}>{String(p.label)}</Text>
          <View style={{ flex: 1 }}>
            <Kids nodes={n.kids} />
          </View>
        </View>
      );
    default:
      // an extern with no component here: its summary, or what its pack says it is, accessibly
      return (
        <View accessible accessibilityRole="text" style={{ borderWidth: 1, borderColor: theme.color('muted'), borderRadius: theme.radius('card'), padding: theme.space('m') }}>
          <Text style={{ color: ink }}>{String(n.summary ?? p.summary ?? (n.ext && rt.bundle.defs[n.ext]?.about) ?? n.t)}</Text>
        </View>
      );
  }
}

/**
 * Layers (GAPS 79): every child drawn over the one before, the last on top, and the stack as tall as
 * its tallest. React Native has no grid cell to share, so the children are placed absolutely, each
 * at its own height, and the stack takes the tallest as they are measured. Down it, start, center and
 * end place them (stretch sits at the top); across it, justify does.
 */
function Stack({ n }: { n: VNode }): ReactNode {
  const { theme } = useCtx();
  const p = n.p;
  const [heights, setHeights] = useState<Record<string, number>>({});
  const tallest = Math.max(0, ...(n.kids ?? []).map((k) => heights[k.key] ?? 0));
  const down = p.align === 'end' ? 1 : p.align === 'center' ? 0.5 : 0;
  const pad = theme.space(p.pady) ?? theme.space(p.pad) ?? 0;
  const across = ALIGN[String(p.justify)] ?? 'stretch';
  return (
    <Box n={n} flow="column" style={{ minHeight: tallest + 2 * pad }}>
      {(n.kids ?? []).map((k) => (
        <View
          key={k.key}
          pointerEvents="box-none"
          onLayout={(e) => {
            const h = e.nativeEvent.layout.height;
            setHeights((prev) => (prev[k.key] === h ? prev : { ...prev, [k.key]: h }));
          }}
          style={{ position: 'absolute', left: pad, right: pad, top: pad + (tallest - (heights[k.key] ?? 0)) * down, alignItems: across }}
        >
          <Slot n={k} />
        </View>
      ))}
    </Box>
  );
}

/**
 * Columns from tracks (GAPS 98): Nfr shares the room left, Nch and size tokens are fixed widths, and
 * auto and fit take the widest of their column's cells as each row measures them. Rows wrap after
 * as many cells as there are tracks (span=n cells take n).
 */
function Grid({ n }: { n: VNode }): ReactNode {
  const { theme } = useCtx();
  const p = n.p;
  const tracks = trackList(p.cols);
  const [widths, setWidths] = useState<Record<number, number>>({});
  const mono = theme.font('mono').fontSize * 0.6;
  const rows: { kids: VNode[]; at: number[] }[] = [];
  let row: { kids: VNode[]; at: number[] } = { kids: [], at: [] };
  let col = 0;
  for (const k of n.kids ?? []) {
    const span = Math.max(1, Math.min(tracks.length, k.layout?.span ?? 1));
    if (!k.hidden && col + span > tracks.length) {
      rows.push(row);
      row = { kids: [], at: [] };
      col = 0;
    }
    row.kids.push(k);
    row.at.push(col);
    if (!k.hidden) col += span;
  }
  if (row.kids.length) rows.push(row);
  const share = (t: string): number => (/fr$/.test(t) ? parseFloat(t) : 0);
  const cell = (k: VNode, at: number): ViewStyle => {
    const span = tracks.slice(at, at + Math.max(1, k.layout?.span ?? 1));
    const fr = span.reduce((s, t) => s + share(t), 0);
    if (fr > 0) return { flexGrow: fr, flexShrink: 1, flexBasis: 0, minWidth: 0, alignItems: ALIGN[String(p.justify)] };
    const fixed = span.reduce((s, t, i) => s + (/ch$/.test(t) ? parseFloat(t) * mono : t === 'auto' || t === 'fit' ? widths[at + i] ?? 0 : Number(theme.size(t)) || 0), 0);
    const measured = span.every((t, i) => (t !== 'auto' && t !== 'fit') || widths[at + i] !== undefined);
    return { ...(measured ? { width: fixed } : { flexShrink: 0 }), alignItems: ALIGN[String(p.justify)] };
  };
  const measure = (at: number, k: VNode) => (e: LayoutChangeEvent) => {
    const t = tracks[at];
    if ((t !== 'auto' && t !== 'fit') || (k.layout?.span ?? 1) > 1) return;
    const w = e.nativeEvent.layout.width;
    setWidths((prev) => ((prev[at] ?? 0) >= w ? prev : { ...prev, [at]: w }));
  };
  const gap = theme.space(p.gap) ?? 0;
  return (
    <Box n={n} flow="column" style={{ flexDirection: 'column', rowGap: gap }}>
      {rows.map((r, i) => (
        <View key={i} style={{ flexDirection: 'row', columnGap: gap, alignItems: ALIGN[String(p.align)] ?? 'stretch' }}>
          {r.kids.map((k, j) => (
            <View key={k.key} style={k.hidden ? { display: 'none' } : cell(k, r.at[j])} onLayout={measure(r.at[j], k)}>
              <Slot n={k} />
            </View>
          ))}
        </View>
      ))}
    </Box>
  );
}

/** A view that scrolls, and keeps what asks for it (keep=true) in view. */
export function Scroller({ horizontal, style, content, children }: { horizontal?: boolean; style?: ViewStyle; content?: ViewStyle; children: ReactNode }): ReactNode {
  const view = useRef<ComponentRef<typeof ScrollView>>(null);
  const inner = useRef<ComponentRef<typeof View>>(null);
  const at = useRef(0);
  const room = useRef(0);
  const keep = useCallback(
    (host: Measurable) => {
      if (!host.measureLayout || !inner.current) return;
      host.measureLayout(inner.current as never, (x, y, w, h) => {
        const [lo, len] = horizontal ? [x, w] : [y, h];
        const from = at.current;
        const to = from + room.current;
        const go = lo < from ? lo - 8 : lo + len > to && room.current ? Math.min(lo + len - room.current + 8, lo - 8) : null;
        if (go !== null) view.current?.scrollTo(horizontal ? { x: Math.max(0, go), animated: false } : { y: Math.max(0, go), animated: false });
      });
    },
    [horizontal],
  );
  return (
    <KeepCtx.Provider value={keep}>
      <ScrollView
        ref={view}
        horizontal={horizontal}
        style={style}
        scrollEventThrottle={32}
        onScroll={(e) => (at.current = horizontal ? e.nativeEvent.contentOffset.x : e.nativeEvent.contentOffset.y)}
        onLayout={(e) => (room.current = horizontal ? e.nativeEvent.layout.width : e.nativeEvent.layout.height)}
        contentContainerStyle={horizontal ? { flexGrow: 1 } : undefined}
      >
        <View ref={inner} collapsable={false} style={content}>
          {children}
        </View>
      </ScrollView>
    </KeepCtx.Provider>
  );
}

function BlockImage({ src, alt, max }: { src: string; alt: string; max?: number }): ReactNode {
  const [width, setWidth] = useState<number | null>(null);
  return (
    <View style={{ width: '100%', maxWidth: max }} onLayout={(e) => setWidth(e.nativeEvent.layout.width)}>
      <InlineImage src={src} alt={alt} max={width ?? max ?? 320} />
    </View>
  );
}

function List({ n }: { n: VNode }): ReactNode {
  const { theme } = useCtx();
  const ink = useInk();
  const p = n.p;
  const body = theme.font('body');
  const start = Number(p.start) || 1;
  return (
    <View accessibilityRole="list" style={{ marginVertical: body.fontSize * 0.4, gap: theme.space('xs') }}>
      {(n.kids ?? []).map((it, i) => {
        const checked = String(it.p.checked ?? 'none');
        const marker = checked !== 'none' ? null : p.ordered ? `${start + i}.` : '•';
        return (
          <View key={it.key} testID={it.key} style={{ flexDirection: 'row', gap: theme.space('s') }}>
            {marker ? (
              <Text style={{ color: ink, fontSize: body.fontSize, lineHeight: body.lineHeight, minWidth: p.ordered ? body.fontSize * 1.4 : body.fontSize * 0.8, textAlign: 'right' }}>{marker}</Text>
            ) : (
              <View
                accessible
                accessibilityRole="checkbox"
                accessibilityState={{ checked: checked === 'yes', disabled: true }}
                style={{ width: 18, height: 18, marginTop: (body.lineHeight - 18) / 2, borderRadius: 4, borderWidth: 1.5, borderColor: theme.color('muted'), backgroundColor: checked === 'yes' ? theme.color('accent') : undefined, alignItems: 'center', justifyContent: 'center' }}
              >
                {checked === 'yes' ? <Text style={{ color: theme.color('surface'), fontSize: 12, fontWeight: '700' }}>✓</Text> : null}
              </View>
            )}
            <View style={{ flex: 1 }}>
              <Kids nodes={it.kids} />
            </View>
          </View>
        );
      })}
    </View>
  );
}

function Table({ n }: { n: VNode }): ReactNode {
  const { theme } = useCtx();
  const ink = useInk();
  const p = n.p;
  const body = theme.font('body');
  const head = (p.head as VRun[][] | undefined) ?? [];
  const rows = (p.rows as VRun[][][] | undefined) ?? [];
  const align = (p.align as string[] | undefined) ?? [];
  // columns are sized from their longest cell, so rows line up without measuring text
  const widths = head.map((h, i) => {
    const longest = Math.max(plainRuns(h).length, ...rows.map((r) => plainRuns(r[i] ?? []).length));
    return Math.max(64, Math.min(280, longest * body.fontSize * 0.55 + 2 * (theme.space('m') ?? 8)));
  });
  const line = theme.mix(theme.color('muted'), theme.color('surface'), 0.45);
  const cellStyle = (i: number): ViewStyle => ({ width: widths[i] ?? 96, paddingVertical: theme.space('xs'), paddingHorizontal: theme.space('m'), borderWidth: 0.5, borderColor: line });
  const textStyle = (i: number, bold: boolean): TextStyle => ({ color: ink, fontSize: body.fontSize, lineHeight: body.lineHeight, fontWeight: bold ? '700' : undefined, textAlign: TEXT_ALIGN[align[i] ?? 'none'] });
  return (
    <ScrollView horizontal style={{ marginVertical: body.fontSize * 0.5 }}>
      <View accessibilityRole="grid">
        <View style={{ flexDirection: 'row' }} accessibilityRole="header">
          {head.map((c, i) => (
            <View key={i} style={cellStyle(i)}>
              <Text style={textStyle(i, true)}>
                <Runs runs={c} fontSize={body.fontSize} />
              </Text>
            </View>
          ))}
        </View>
        {rows.map((r, j) => (
          <View key={j} style={{ flexDirection: 'row' }}>
            {head.map((_h, i) => (
              <View key={i} style={cellStyle(i)}>
                <Text style={textStyle(i, false)}>
                  <Runs runs={r[i] ?? []} fontSize={body.fontSize} />
                </Text>
              </View>
            ))}
          </View>
        ))}
      </View>
    </ScrollView>
  );
}

function plainRuns(rs: VRun[]): string {
  return rs.map((r) => (r.t === 'text' || r.t === 'code' ? r.v : r.t === 'math' ? r.tex : '')).join('');
}

// ---------------------------------------------------------------------------------------------
// Interaction

const PRESS_ROLE: Record<string, AccessibilityRole> = { button: 'button', tab: 'tab', option: 'radio', toggle: 'togglebutton', radio: 'radio', check: 'checkbox', switch: 'switch' };

/** The tick box, the dot or the switch's track drawn before a press's content. */
function PressMark({ kind, on }: { kind: string; on: boolean }): ReactNode {
  const { theme } = useCtx();
  const accent = theme.color('accent');
  const surface = theme.color('surface');
  const muted = theme.color('muted');
  if (kind === 'switch') {
    return (
      <View style={{ width: 36, height: 20, borderRadius: 10, padding: 3, flexDirection: 'row', justifyContent: on ? 'flex-end' : 'flex-start', backgroundColor: on ? accent : muted }}>
        <View style={{ width: 14, height: 14, borderRadius: 7, backgroundColor: surface }} />
      </View>
    );
  }
  return <View style={{ width: 16, height: 16, borderWidth: 1, borderColor: on ? accent : muted, borderRadius: kind === 'radio' ? 8 : 3, backgroundColor: on ? accent : undefined }} />;
}

/** A press: something clickable and focusable, with the role and state its kind implies. */
function Press({ n }: { n: VNode }): ReactNode {
  const { rt, theme } = useCtx();
  const p = n.p;
  const kind = String(p.kind ?? 'button');
  const selected = !!p.selected;
  const disabled = !!p.disabled;
  const accent = theme.color('accent');
  const surface = theme.color('surface');
  const tone = theme.color(p.tone);
  const state = kind === 'tab' ? { selected, disabled } : kind === 'button' ? { disabled } : { checked: selected, disabled };
  const mark = kind === 'check' || kind === 'radio' || kind === 'switch';
  const plain = kind === 'plain';
  const r = theme.radius('card');
  // enter and leave: a pointer's hover (a mouse, a stylus, a desktop) or focus
  const enter = n.ev?.includes('enter') ? () => rt.dispatch(n.key, 'enter') : undefined;
  const leave = n.ev?.includes('leave') ? () => rt.dispatch(n.key, 'leave') : undefined;
  return (
    <Pressable
      accessibilityRole={PRESS_ROLE[kind] ?? 'button'}
      accessibilityState={state}
      accessibilityLabel={p.label ? String(p.label) : undefined}
      disabled={disabled}
      hitSlop={6}
      onPress={() => rt.dispatch(n.key, 'click')}
      onHoverIn={enter}
      onHoverOut={leave}
      onFocus={enter}
      onBlur={leave}
      style={plain ? ({ pressed }) => ({ opacity: pressed ? 0.7 : 1 }) : ({ pressed }) => ({
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: mark ? 'flex-start' : 'center',
        gap: theme.space('s'),
        minHeight: 36,
        minWidth: 36,
        paddingVertical: theme.space('xs'),
        paddingHorizontal: kind === 'switch' ? 0 : theme.space('m'),
        borderWidth: kind === 'switch' ? 0 : 1,
        borderColor: p.emphasis === 'low' && !pressed ? 'transparent' : p.emphasis === 'high' ? theme.color('ink') : selected ? accent : pressed ? accent : theme.color('line'),
        backgroundColor: kind === 'switch' ? undefined : p.emphasis === 'high' ? theme.color('ink') : selected && !mark ? accent : p.emphasis === 'low' && !pressed ? undefined : theme.mix(theme.color('muted'), surface, pressed ? 0.24 : 0.14),
        borderRadius: r,
        ...(kind === 'tab' ? { borderBottomLeftRadius: 0, borderBottomRightRadius: 0 } : null),
        opacity: disabled ? 0.45 : 1,
      })}
    >
      {mark ? <PressMark kind={kind} on={selected} /> : null}
      <InkCtx.Provider value={p.emphasis === 'high' || (selected && !mark) ? surface : tone}>
        <Kids nodes={n.kids} />
      </InkCtx.Provider>
    </Pressable>
  );
}

/**
 * Text or number entry. One line submits on Return; several (GAPS 80) are a multiline box where
 * Return is a new line, and it submits when editing ends (a phone has no Ctrl+Enter). A tone marks
 * it right or wrong (GAPS 86).
 */
function Field({ n }: { n: VNode }): ReactNode {
  const { rt, theme } = useCtx();
  const ink = useInk();
  const p = n.p;
  const body = theme.font('body');
  const width = theme.size(p.width);
  const lines = Number(p.lines) || 1;
  const tone = theme.color(p.tone);
  const submit = (text: string): void => rt.dispatch(n.key, 'submit', { value: text });
  return (
    <TextInput
      value={String(p.value ?? '')}
      placeholder={String(p.placeholder ?? '')}
      placeholderTextColor={theme.color('muted')}
      accessibilityLabel={String(p.label || p.placeholder || 'entry')}
      accessibilityHint={p.tone === 'bad' ? 'marked wrong' : p.tone === 'ok' ? 'marked right' : undefined}
      keyboardType={p.kind === 'number' ? 'numbers-and-punctuation' : 'default'}
      returnKeyType={lines > 1 ? 'default' : 'done'}
      multiline={lines > 1}
      numberOfLines={lines > 1 ? lines : undefined}
      autoCapitalize="none"
      autoCorrect={false}
      onChangeText={(v) => rt.dispatch(n.key, 'change', { value: v })}
      onSubmitEditing={lines > 1 ? undefined : (e) => submit(e.nativeEvent.text)}
      onEndEditing={lines > 1 ? (e) => submit(e.nativeEvent.text) : undefined}
      style={{
        width,
        minHeight: lines > 1 ? lines * body.lineHeight + 2 * (theme.space('xs') ?? 2) : 40,
        textAlignVertical: lines > 1 ? 'top' : undefined,
        color: ink,
        fontFamily: body.fontFamily,
        fontSize: body.fontSize,
        backgroundColor: theme.color('surface'),
        borderWidth: tone ? 2 : 1,
        borderColor: tone ?? theme.mix(theme.color('muted'), theme.color('surface'), 0.6),
        borderRadius: theme.radius('card'),
        paddingVertical: theme.space('xs'),
        paddingHorizontal: theme.space('m'),
      }}
    />
  );
}

interface CodeMark {
  line: number;
  tone?: string;
  note?: string;
}

/** A code block; with a line or marks a numbered listing, and with pickable each line is pressed (GAPS 68, 96). */
function Code({ n }: { n: VNode }): ReactNode {
  const { rt, theme } = useCtx();
  const ink = useInk();
  const p = n.p;
  const body = theme.font('body');
  const mono = theme.font('mono');
  const type = { fontFamily: mono.fontFamily, fontSize: mono.fontSize, lineHeight: mono.lineHeight };
  const marks = (p.marks as CodeMark[] | undefined) ?? [];
  const pick = p.pickable && n.ev?.includes('pick') ? (line: number) => rt.dispatch(n.key, 'pick', { line }) : undefined;
  if (!p.line && !marks.length && !pick) {
    return (
      <ScrollView horizontal style={{ backgroundColor: theme.mix(theme.color('muted'), theme.color('surface'), 0.12), borderRadius: theme.radius('card'), marginVertical: body.fontSize * 0.5 }} contentContainerStyle={{ padding: theme.space('m') }}>
        <Text selectable style={{ ...type, color: ink }} accessibilityLabel={p.lang ? `${String(p.lang)} code` : 'code'}>
          {String(p.src)}
        </Text>
      </ScrollView>
    );
  }
  return (
    <ScrollView horizontal style={{ backgroundColor: theme.mix(theme.color('muted'), theme.color('surface'), 0.08) }}>
      <View accessibilityLabel={p.lang ? `${String(p.lang)} code` : 'code'} style={{ paddingVertical: theme.space('s') }}>
        {String(p.src)
          .split('\n')
          .map((line, i) => {
            const on = i + 1 === p.line;
            const m = marks.find((x) => x.line === i + 1);
            const tone = m?.tone && m.tone !== 'none' ? theme.color(m.tone) : undefined;
            const style: ViewStyle = { flexDirection: 'row', paddingHorizontal: theme.space('m'), backgroundColor: on ? theme.mix(theme.color('accent'), theme.color('surface'), 0.14) : tone ? theme.mix(tone, theme.color('surface'), 0.12) : undefined };
            const text = (
              <>
                <Text style={{ ...type, color: theme.color('muted'), width: mono.fontSize * 2 }}>{i + 1}</Text>
                <Text selectable={!pick} style={{ ...type, color: ink, fontWeight: on ? '700' : undefined }}>
                  {line}
                </Text>
                {m?.note ? <Text style={{ color: theme.color('muted'), fontSize: mono.fontSize * 0.85, marginLeft: theme.space('l') }}>{m.note}</Text> : null}
              </>
            );
            return pick ? (
              <Pressable key={i} accessibilityRole="button" accessibilityLabel={`line ${i + 1}`} accessibilityState={{ selected: on }} onPress={() => pick(i + 1)} style={style}>
                {text}
              </Pressable>
            ) : (
              <View key={i} accessibilityState={{ selected: on }} style={style}>
                {text}
              </View>
            );
          })}
      </View>
    </ScrollView>
  );
}

interface MathMark {
  id: string;
  tone?: string;
  note?: string;
}

/** A display formula, its \mark{id} parts in their tones and their notes listed under it, each with its tone's swatch. */
function MathBlock({ n }: { n: VNode }): ReactNode {
  const { theme } = useCtx();
  const body = theme.font('body');
  const marks = (n.p.marks as MathMark[] | undefined) ?? [];
  const colours: Record<string, string> = {};
  for (const m of marks) {
    const c = theme.color(m.tone);
    if (c) colours[m.id] = c;
  }
  const m = n.p as unknown as MathLike;
  const shown = m.svg && Object.keys(colours).length ? { ...m, svg: markSvg(m.svg, colours) } : m;
  const notes = marks.filter((x) => x.note);
  return (
    <View>
      <ScrollView horizontal contentContainerStyle={{ flexGrow: 1, justifyContent: 'center', paddingVertical: body.fontSize * 0.6 }}>
        <MathView m={shown} fontSize={body.fontSize} display />
      </ScrollView>
      {notes.length ? (
        <View accessibilityRole="list" style={{ flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'center', columnGap: theme.space('l'), rowGap: theme.space('xs'), marginBottom: body.fontSize * 0.6 }}>
          {notes.map((x) => (
            <View key={x.id} testID={`mark-${x.id}`} style={{ flexDirection: 'row', alignItems: 'center', gap: theme.space('s') }}>
              <View style={{ width: body.fontSize * 0.7, height: body.fontSize * 0.7, borderRadius: 2, backgroundColor: colours[x.id] ?? theme.color('muted') }} />
              <Text style={{ color: theme.color('muted'), fontSize: body.fontSize * 0.875 }}>{x.note}</Text>
            </View>
          ))}
        </View>
      ) : null}
    </View>
  );
}

const fmt = (v: number): string => String(Number(v.toPrecision(4)));

/**
 * A value on a track. Drag the track (a PanResponder), or use the screen reader's adjustable
 * increment/decrement actions as the non-drag alternative (WCAG 2.5.7).
 */
function Range({ n }: { n: VNode }): ReactNode {
  const { rt, theme } = useCtx();
  const p = n.p;
  const min = Number(p.min);
  const max = Number(p.max);
  const step = Number(p.step) > 0 ? Number(p.step) : 0;
  const value = Number(p.value);
  const width = useRef(0);
  const [w, setW] = useState(0);
  const grant = useRef(0);
  const live = useRef({ min, max, step, key: n.key });
  live.current = { min, max, step, key: n.key };
  const send = (v: number): void => {
    const { min: lo, max: hi, step: st } = live.current;
    let x = Math.min(hi, Math.max(lo, v));
    if (st > 0) x = Math.min(hi, lo + Math.round((x - lo) / st) * st);
    rt.dispatch(live.current.key, 'change', { value: Number(x.toPrecision(12)) });
  };
  const fromX = (px: number): number => {
    const { min: lo, max: hi } = live.current;
    return lo + (Math.max(0, Math.min(width.current, px)) / (width.current || 1)) * (hi - lo);
  };
  const pan = useMemo(
    () =>
      PanResponder.create({
        onStartShouldSetPanResponder: () => true,
        onMoveShouldSetPanResponder: () => true,
        onPanResponderTerminationRequest: () => false,
        onPanResponderGrant: (e) => {
          grant.current = e.nativeEvent.locationX;
          send(fromX(grant.current));
        },
        onPanResponderMove: (_e, g) => send(fromX(grant.current + g.dx)),
      }),
    [], // eslint-disable-line react-hooks/exhaustive-deps
  );
  const nudge = (dir: 1 | -1): void => send(value + dir * (step || (max - min) / 20));
  const accent = theme.color('accent');
  const frac = max > min ? Math.max(0, Math.min(1, (value - min) / (max - min))) : 0;
  const THUMB = 22;
  return (
    <View
      accessible
      accessibilityRole="adjustable"
      accessibilityLabel={String(p.label || 'value')}
      accessibilityValue={{ min, max, now: value, text: fmt(value) }}
      accessibilityActions={[{ name: 'increment' }, { name: 'decrement' }]}
      onAccessibilityAction={(e: AccessibilityActionEvent) => {
        if (e.nativeEvent.actionName === 'increment') nudge(1);
        if (e.nativeEvent.actionName === 'decrement') nudge(-1);
      }}
      style={{ width: 180, maxWidth: '100%', height: 44, justifyContent: 'center' }}
      onLayout={(e) => {
        width.current = e.nativeEvent.layout.width;
        setW(e.nativeEvent.layout.width);
      }}
      {...pan.panHandlers}
    >
      <View pointerEvents="none" style={{ height: 4, borderRadius: 2, backgroundColor: theme.mix(theme.color('muted'), theme.color('surface'), 0.35) }}>
        <View style={{ width: `${frac * 100}%`, height: 4, borderRadius: 2, backgroundColor: accent }} />
      </View>
      <View
        pointerEvents="none"
        style={{ position: 'absolute', left: Math.max(0, frac * (w || 180) - THUMB / 2), width: THUMB, height: THUMB, borderRadius: THUMB / 2, backgroundColor: accent, borderWidth: 2, borderColor: theme.color('surface'), ...theme.shadow('raised') }}
      />
    </View>
  );
}

function Meter({ n }: { n: VNode }): ReactNode {
  const { theme } = useCtx();
  const p = n.p;
  const max = Number(p.max) > 0 ? Number(p.max) : 1;
  const done = Math.max(0, Math.min(1, Number(p.value) / max));
  const surface = theme.color('surface');
  return (
    <View
      accessibilityRole="progressbar"
      accessibilityLabel={String(p.label || 'progress')}
      accessibilityValue={{ min: 0, max: 100, now: Math.round(done * 100) }}
      style={{ height: 8, width: theme.size(p.size), maxWidth: '100%', borderRadius: 4, overflow: 'hidden', backgroundColor: theme.mix(theme.color('muted'), surface, 0.25) }}
    >
      <View style={{ height: '100%', width: `${done * 100}%`, backgroundColor: theme.color(p.tone) }} />
    </View>
  );
}

/** A popover, tooltip, dialog or menu anchored to its first slot. A dialog is a Modal (the back button closes it). */
function Overlay({ n }: { n: VNode }): ReactNode {
  const { rt, theme } = useCtx();
  const p = n.p;
  const mode = String(p.mode ?? 'popover');
  const open = !!p.open;
  const close = (): void => rt.dispatch(n.key, 'close');
  const surface = theme.color('surface');
  const panel: ViewStyle = {
    backgroundColor: surface,
    borderWidth: 1,
    borderColor: theme.mix(theme.color('muted'), surface, 0.45),
    borderRadius: theme.radius('card'),
    padding: theme.space('l'),
    ...theme.shadow('raised'),
  };
  const label = p.label ? String(p.label) : undefined;
  return (
    <View style={{ position: 'relative', alignSelf: 'flex-start', zIndex: open ? 100 : undefined }}>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={label}
        accessibilityState={{ expanded: open }}
        accessibilityHint={mode === 'tooltip' ? 'shows a tip' : undefined}
        onPress={() => rt.dispatch(n.key, open ? 'close' : 'open')}
        onLongPress={mode === 'tooltip' ? () => rt.dispatch(n.key, 'open') : undefined}
        onHoverIn={mode === 'tooltip' ? () => rt.dispatch(n.key, 'open') : undefined}
        onHoverOut={mode === 'tooltip' ? () => rt.dispatch(n.key, 'close') : undefined}
        style={{ minHeight: 36, minWidth: 36, justifyContent: 'center', paddingHorizontal: theme.space('m'), borderWidth: 1, borderColor: theme.mix(theme.color('muted'), surface, 0.45), borderRadius: theme.radius('card'), backgroundColor: theme.mix(theme.color('muted'), surface, 0.14) }}
      >
        <Kids nodes={n.kids} />
      </Pressable>
      {open && mode === 'dialog' ? (
        <Modal transparent visible animationType="none" onRequestClose={close} supportedOrientations={['portrait', 'landscape']}>
          <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', padding: theme.space('l') }}>
            <Pressable accessibilityRole="button" accessibilityLabel="close" onPress={close} style={{ position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, backgroundColor: '#00000066' }} />
            <View accessibilityViewIsModal accessibilityLabel={label ?? 'dialog'} style={{ ...panel, width: '100%', maxWidth: 480 }}>
              <Kids nodes={n.body} />
            </View>
          </View>
        </Modal>
      ) : null}
      {open && mode !== 'dialog' ? (
        <View accessibilityLiveRegion="polite" accessibilityLabel={label} style={{ ...panel, position: 'absolute', top: '100%', left: 0, marginTop: 4, minWidth: 160, maxWidth: 320, zIndex: 100 }}>
          <Kids nodes={n.body} />
        </View>
      ) : null}
    </View>
  );
}

// ---------------------------------------------------------------------------------------------
// Scopes: a definition instance, with its arrows drawn over (or under) it (6.10)

interface Entry {
  host: Measurable | null;
  hidden: boolean;
  layout?: LayoutRectangle;
}

interface Drawn {
  key: string;
  d: string;
  head: string;
  label?: Pt;
  align?: 'start' | 'end';
  runs?: VRun[];
  marks: Mark[];
  tone?: string;
  line?: string;
  dim?: boolean;
  bold?: boolean;
  opacity?: number;
  behind?: boolean;
  /** the label's size: measured, or estimated until it is */
  size?: [number, number];
  /** its hops' arcs: a dashed or dotted line draws each unbroken, so the hop always shows */
  hops?: string[];
}
const DASH: Record<string, string | undefined> = { solid: undefined, dashed: '5 4', dotted: '2 3' };

function Scope({ n }: { n: VNode }): ReactNode {
  const { theme } = useCtx();
  const parents = useContext(MeasureCtx);
  const container = useRef<ComponentRef<typeof View>>(null);
  const arrows = n.arrows;
  const entries = useRef(new Map<string, Entry>());
  const rects = useRef(new Map<string, Rect>());
  const sizes = useRef(new Map<string, [number, number]>());
  const [paths, setPaths] = useState<Drawn[]>([]);
  const frame = useRef<ReturnType<typeof requestAnimationFrame> | null>(null);
  // children unregister after this scope's own cleanup, and that must not ask for another frame
  const gone = useRef(false);
  const arrowsRef = useRef(arrows);
  arrowsRef.current = arrows;
  const labelSize = theme.font('body').fontSize * 0.8;

  // turns the measured rects into paths; equal output keeps the previous state (no re-render)
  const draw = useRef(() => {
    const out: Drawn[] = [];
    const shown: VArrow[] = [];
    const ends: ArrowEnds[] = [];
    for (const a of arrowsRef.current ?? []) {
      const ra = rects.current.get(a.from);
      const rb = rects.current.get(a.to);
      if (!ra || !rb || entries.current.get(a.from)?.hidden || entries.current.get(a.to)?.hidden) continue;
      // waypoints not measured yet, or hidden, are passed by
      const via = (a.via ?? []).filter((k) => !entries.current.get(k)?.hidden).map((k) => rects.current.get(k)).filter((r): r is Rect => !!r);
      shown.push(a);
      // the ends are drawn here (dot and ring among them), so the core draws only the shaft and head
      ends.push({ from: a.from, to: a.to, a: ra, b: rb, via, curve: a.curve, route: a.route, head: 'arrow', tail: 'none', corner: a.corner ? ARROW_CORNERS[a.corner] : undefined, ...(a.lanes ? { lanes: a.lanes } : {}), ...(a.hop ? { hop: a.hop } : {}) });
    }
    const lines: Pt[][] = [];
    arrowPaths(ends).forEach((raw, i) => {
      const a = shown[i];
      const e = ends[i];
      // a curve bends at least MIN_BEND (GAPS 52)
      const pth = e.curve && !e.via?.length && !e.route && e.from !== e.to ? curve(e.a, e.b) : raw;
      if (!pth) return;
      const end = withEnds(pth, a.head ?? 'arrow', a.tail ?? 'none');
      out.push({ key: a.key, d: end.d, head: end.head.map((q) => q.join(',')).join(' '), marks: end.marks, label: a.label ? pth.label : undefined, align: pth.align, runs: a.label, tone: a.tone, line: a.line, dim: a.dim, bold: a.bold, opacity: a.opacity, behind: a.layer === 'behind', ...(pth.hops ? { hops: pth.hops } : {}) });
      lines.push(polyline(end.d));
    });
    // labels are chips, moved along their line clear of the others (GAPS 141)
    const sizeOf = (p: Drawn): [number, number] => sizes.current.get(p.key) ?? estimate(p.runs, labelSize);
    placeLabels(out, lines, sizeOf);
    for (const p of out) if (p.label) p.size = sizeOf(p);
    setPaths((prev) => (JSON.stringify(prev) === JSON.stringify(out) ? prev : out));
  }).current;

  // measures every arrow end against the scope container, then draws. Until the platform has
  // answered for an element, its layout relative to its parent stands in (exact for the scope's
  // own children); on the new architecture measureLayout answers synchronously.
  const measured = useRef(new Set<string>());
  const measure = useRef(() => {
    const want = new Set<string>();
    for (const a of arrowsRef.current ?? []) for (const k of [a.from, a.to, ...(a.via ?? [])]) want.add(k);
    const root = container.current as Measurable | null;
    for (const k of want) {
      const e = entries.current.get(k);
      if (!e) continue;
      if (e.layout && !measured.current.has(k)) rects.current.set(k, { x: e.layout.x, y: e.layout.y, w: e.layout.width, h: e.layout.height });
      if (e.host?.measureLayout && root) {
        try {
          e.host.measureLayout(root as never, (x, y, w, h) => {
            measured.current.add(k);
            const r = rects.current.get(k);
            rects.current.set(k, { x, y, w, h });
            if (!r || r.x !== x || r.y !== y || r.w !== w || r.h !== h) draw();
          });
        } catch {
          // a view that is not mounted any more: its last rect stands
        }
      }
    }
    draw();
  }).current;

  const schedule = useRef(() => {
    if (frame.current !== null || gone.current) return;
    frame.current = requestAnimationFrame(() => {
      frame.current = null;
      measure();
    });
  }).current;

  const registry = useMemo<Registry>(
    () => ({
      container: container as { current: Measurable | null },
      register: (key, host, hidden) => {
        if (!host) {
          entries.current.delete(key);
          measured.current.delete(key);
        } else entries.current.set(key, { ...entries.current.get(key), host, hidden });
        schedule();
      },
      layout: (key, layout) => {
        const e = entries.current.get(key) ?? { host: null, hidden: false };
        entries.current.set(key, { ...e, layout });
        schedule();
      },
    }),
    [], // eslint-disable-line react-hooks/exhaustive-deps
  );
  const chain = useMemo(() => (arrows?.length ? [...parents, registry] : parents), [parents, registry, !!arrows?.length]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (arrows?.length) measure();
  });
  useEffect(() => {
    gone.current = false;
    return () => {
      gone.current = true;
      if (frame.current !== null) cancelAnimationFrame(frame.current);
    };
  }, []);
  // a label's real size, once drawn: the labels are placed again with it
  const sized = useCallback(
    (key: string, w: number, h: number) => {
      const s = sizes.current.get(key);
      if (s && Math.abs(s[0] - w) < 0.5 && Math.abs(s[1] - h) < 0.5) return;
      sizes.current.set(key, [w, h]);
      draw();
    },
    [draw],
  );

  const label = n.p.summary ? String(n.p.summary) : undefined;
  const behind = paths.filter((p) => p.behind);
  const front = paths.filter((p) => !p.behind);
  return (
    <View ref={container} role={label ? 'group' : undefined} accessibilityLabel={label} nativeID={(n.p.anchor as string | undefined) ?? undefined} onLayout={arrows?.length ? schedule : undefined} style={{ position: 'relative' }}>
      {/* behind: drawn first, so the content covers it (GAPS 100) */}
      {behind.length ? <Arrows paths={behind} sized={sized} testID="mkp-arrows-behind" /> : null}
      <MeasureCtx.Provider value={chain}>
        <Kids nodes={n.kids} />
      </MeasureCtx.Provider>
      {arrows?.length ? <Arrows paths={front} sized={sized} testID="mkp-arrows" /> : null}
    </View>
  );
}

/** The drawn arrows, out of the touch and accessibility trees (they are decoration; the structure is in the content). */
function Arrows({ paths, sized, testID }: { paths: Drawn[]; sized: (key: string, w: number, h: number) => void; testID: string }): ReactNode {
  const { theme } = useCtx();
  const muted = theme.color('muted');
  const surface = theme.color('surface');
  const fs = theme.font('body').fontSize * 0.8;
  return (
    <View pointerEvents="none" accessibilityElementsHidden importantForAccessibility="no-hide-descendants" style={{ position: 'absolute', top: 0, left: 0, right: 0, bottom: 0 }} testID={testID}>
      <Svg width="100%" height="100%" style={{ overflow: 'visible' }}>
        {paths.map((p) => {
          const ink = (p.tone ? theme.color(p.tone) : undefined) ?? muted;
          const width = p.bold ? 2 : 1.5;
          return (
            <G key={p.key} opacity={(p.dim ? 0.3 : 1) * (p.opacity ?? 1)}>
              <Path d={p.d} fill="none" stroke={ink} strokeWidth={width} strokeDasharray={DASH[p.line ?? 'solid']} />
              {p.head ? <Polygon points={p.head} fill={ink} /> : null}
              {p.marks.map((m, i) => (
                <Path key={i} d={m.d} stroke={(m.tone ? theme.color(m.tone) : undefined) ?? ink} strokeWidth={m.tone ? 2 : width} fill={m.fill === 'solid' ? ink : m.fill === 'hollow' ? surface : 'none'} strokeLinecap="round" />
              ))}
            </G>
          );
        })}
        {/* the hops last, over every line, each on a thin edge of the surface */}
        {paths
          .filter((p) => p.hops?.length)
          .map((p) => {
            const ink = (p.tone ? theme.color(p.tone) : undefined) ?? muted;
            const width = p.bold ? 2 : 1.5;
            return (
              <G key={`hops-${p.key}`} opacity={(p.dim ? 0.3 : 1) * (p.opacity ?? 1)}>
                {p.hops!.map((h, i) => (
                  <G key={i}>
                    <Path d={h} fill="none" stroke={surface} strokeWidth={width + 3} />
                    <Path d={h} fill="none" stroke={ink} strokeWidth={width} />
                  </G>
                ))}
              </G>
            );
          })}
      </Svg>
      {paths.map((p) => {
        if (!p.label || !p.runs) return null;
        const ink = (p.tone ? theme.color(p.tone) : undefined) ?? muted;
        const [w, h] = p.size ?? [0, 0];
        // a chip: the label on the surface in a thin outline of its colour, centred on its spot (or beside a loop)
        return (
          <View
            key={`${p.key}.l`}
            testID={`${p.key}.label`}
            onLayout={(e) => sized(p.key, e.nativeEvent.layout.width, e.nativeEvent.layout.height)}
            style={{ position: 'absolute', left: p.label[0] - (p.align === 'start' ? 0 : p.align === 'end' ? w : w / 2), top: p.label[1] - h / 2, opacity: (p.dim ? 0.3 : 1) * (p.opacity ?? 1) }}
          >
            <Text style={{ color: ink, fontSize: fs, backgroundColor: surface, borderWidth: 1, borderColor: theme.mix(ink, surface, 0.3), borderRadius: h / 2 || fs, paddingHorizontal: 6, overflow: 'hidden' }}>
              <Runs runs={p.runs} fontSize={fs} />
            </Text>
          </View>
        );
      })}
    </View>
  );
}
