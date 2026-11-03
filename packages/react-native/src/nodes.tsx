// The base set as React Native components (spec 8): layout, text, media, press, range, field,
// overlay, canvas, Markdown blocks, the control bar, scopes with arrows, and the error boundary.

import { useContext, useEffect, useLayoutEffect, useMemo, useRef, useState, type ComponentRef, type ReactNode } from 'react';
import {
  Animated,
  Modal,
  PanResponder,
  Pressable,
  ScrollView,
  Text,
  TextInput,
  View,
  type AccessibilityActionEvent,
  type AccessibilityRole,
  type DimensionValue,
  type LayoutChangeEvent,
  type LayoutRectangle,
  type TextStyle,
  type ViewStyle,
} from 'react-native';
import { Polygon, Path, Svg } from 'react-native-svg';
import { arrowPath, type Rect, type VNode, type VRun } from '@mkp/core';
import { MeasureCtx, useCtx, type Measurable, type Registry } from './context';
import { InkCtx, InlineImage, MathView, Runs, useInk, type MathLike } from './runs';
import { Canvas } from './canvas';
import type { Theme } from './theme';

// ---------------------------------------------------------------------------------------------
// Keyed children with enter, move and leave animation (6.11). Moves are animated by
// LayoutAnimation, configured by the document before a re-render that reorders keys; entering
// children fade in and removed children linger briefly while they fade out.

interface Leaving {
  node: VNode;
  index: number;
  until: number;
}

export function Kids({ nodes, cell }: { nodes: VNode[] | undefined; cell?: (n: VNode) => ViewStyle | undefined }): ReactNode {
  const { reducedMotion, theme } = useCtx();
  const list = nodes ?? [];
  const prevKeys = useRef<Set<string> | null>(null);
  const prevNodes = useRef<VNode[]>([]);
  const [leaving, setLeaving] = useState<Leaving[]>([]);
  const curKeys = new Set(list.map((n) => n.key));
  const mounted = prevKeys.current !== null;
  const quick = theme.motion('quick');

  useLayoutEffect(() => {
    const before = prevNodes.current;
    const hadKeys = prevKeys.current;
    prevKeys.current = curKeys;
    prevNodes.current = list;
    if (reducedMotion || !hadKeys) return undefined;
    const gone = before.map((n, i) => ({ n, i })).filter(({ n }) => !curKeys.has(n.key));
    if (!gone.length) return undefined;
    const until = Date.now() + quick;
    setLeaving((l) => [...l.filter((x) => !curKeys.has(x.node.key)), ...gone.map(({ n, i }) => ({ node: n, index: i, until }))]);
    const t = setTimeout(() => setLeaving((l) => l.filter((x) => x.until > Date.now())), quick + 20);
    return () => clearTimeout(t);
  });

  const rendered: { n: VNode; leaving: boolean }[] = list.map((n) => ({ n, leaving: false }));
  for (const l of leaving) if (!curKeys.has(l.node.key)) rendered.splice(Math.min(l.index, rendered.length), 0, { n: l.node, leaving: true });
  return rendered.map(({ n, leaving: isLeaving }) => (
    <Slot key={n.key} n={n} entering={mounted && !prevKeys.current!.has(n.key) && !reducedMotion} leaving={isLeaving} extra={cell?.(n)} />
  ));
}

function layoutStyle(n: VNode, theme: Theme): ViewStyle {
  const basis = n.layout?.basis ? theme.size(n.layout.basis) : undefined;
  return {
    ...(n.layout?.grow ? { flexGrow: 1, flexShrink: 1, flexBasis: 0 } : null),
    ...(basis !== undefined ? { flexBasis: basis } : null),
  };
}

/** One keyed child: its own animated wrapper, which also reports its layout to scopes measuring arrows. */
function Slot({ n, entering, leaving, extra }: { n: VNode; entering: boolean; leaving: boolean; extra?: ViewStyle }): ReactNode {
  const { theme } = useCtx();
  const regs = useContext(MeasureCtx);
  const host = useRef<ComponentRef<typeof View>>(null);
  const opacity = useRef(new Animated.Value(entering ? 0 : 1)).current;
  useEffect(() => {
    if (!entering) return undefined;
    const a = Animated.timing(opacity, { toValue: 1, duration: theme.motion('settle'), useNativeDriver: true });
    a.start();
    return () => a.stop();
  }, []); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    if (!leaving) return undefined;
    const a = Animated.timing(opacity, { toValue: 0, duration: theme.motion('quick'), useNativeDriver: true });
    a.start();
    return () => a.stop();
  }, [leaving]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    for (const r of regs) r.register(n.key, host.current as Measurable | null, !!n.hidden);
    return () => {
      for (const r of regs) r.register(n.key, null, true);
    };
  }, [regs, n.key, n.hidden]);
  const onLayout = regs.length ? (e: LayoutChangeEvent) => regs.forEach((r) => r.layout(n.key, e.nativeEvent.layout)) : undefined;
  return (
    <Animated.View
      ref={host}
      testID={n.key}
      nativeID={n.id}
      onLayout={onLayout}
      pointerEvents={leaving ? 'none' : 'auto'}
      accessibilityElementsHidden={leaving || n.hidden}
      importantForAccessibility={leaving || n.hidden ? 'no-hide-descendants' : 'auto'}
      style={[layoutStyle(n, theme), extra, { opacity }, n.hidden ? { display: 'none' } : null]}
    >
      <Node n={n} />
    </Animated.View>
  );
}

// ---------------------------------------------------------------------------------------------

const ALIGN: Record<string, ViewStyle['alignItems']> = { start: 'flex-start', center: 'center', end: 'flex-end', stretch: 'stretch', baseline: 'baseline' };
const JUSTIFY: Record<string, ViewStyle['justifyContent']> = { start: 'flex-start', center: 'center', end: 'flex-end', between: 'space-between', around: 'space-around' };
const TEXT_ALIGN: Record<string, TextStyle['textAlign']> = { start: 'left', center: 'center', end: 'right', left: 'left', right: 'right' };
const QUOTE_TONE: Record<string, string> = { note: 'info', tip: 'ok', important: 'accent', warning: 'warn', caution: 'bad' };

function boxStyle(p: Record<string, unknown>, theme: Theme): ViewStyle {
  const stroke = theme.color(p.stroke);
  return {
    padding: theme.space(p.pad),
    gap: theme.space(p.gap),
    backgroundColor: theme.color(p.fill),
    borderWidth: stroke ? 1 : undefined,
    borderColor: stroke,
    borderRadius: theme.radius(p.radius),
    ...theme.shadow(p.shadow),
  };
}

const runs = (p: Record<string, unknown>): VRun[] => (p.runs as VRun[] | undefined) ?? [];

export function Node({ n }: { n: VNode }): ReactNode {
  const { theme } = useCtx();
  const ink = useInk();
  const p = n.p;
  const body = theme.font('body');
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
          style={{ flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', rowGap: theme.space('m'), columnGap: theme.space('l'), paddingTop: theme.space('s'), marginTop: theme.space('m'), borderTopWidth: 1, borderTopColor: theme.mix(theme.color('muted'), theme.color('surface'), 0.35) }}
        >
          <Kids nodes={n.kids} />
        </View>
      );
    case 'stack':
      return (
        <View accessibilityLabel={p.label ? String(p.label) : undefined} style={{ flexDirection: 'column', alignItems: ALIGN[String(p.align)] ?? 'stretch', ...boxStyle(p, theme) }}>
          <Kids nodes={n.kids} />
        </View>
      );
    case 'flex':
      return (
        <View
          role={p.role === 'control' ? 'group' : undefined}
          accessibilityLabel={p.label ? String(p.label) : undefined}
          style={{ flexDirection: 'row', flexWrap: p.wrap === false ? 'nowrap' : 'wrap', alignItems: ALIGN[String(p.align)] ?? 'flex-start', justifyContent: JUSTIFY[String(p.justify)] ?? 'flex-start', ...boxStyle(p, theme) }}
        >
          <Kids nodes={n.kids} />
        </View>
      );
    case 'grid':
      return <Grid n={n} />;
    case 'text': {
      const f = theme.font(p.font ?? 'body');
      const scale = p.size === 'small' ? 0.875 : p.size === 'large' ? 1.25 : 1;
      const tone = String(p.tone ?? 'ink');
      const st: TextStyle = {
        color: tone === 'ink' ? ink : theme.color(tone) ?? ink,
        fontFamily: f.fontFamily,
        fontSize: f.fontSize * scale,
        lineHeight: f.lineHeight * scale,
        fontWeight: p.weight === 'bold' ? '700' : p.weight === 'medium' ? '500' : f.fontWeight,
        textAlign: TEXT_ALIGN[String(p.align)] ?? undefined,
      };
      return (
        <Text style={st} numberOfLines={p.wrap === false ? 1 : undefined}>
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
    case 'field':
      return <Field n={n} />;
    case 'overlay':
      return <Overlay n={n} />;
    case 'canvas':
      return <Canvas n={n} />;
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
      return <View accessibilityRole="none" style={{ height: 1, backgroundColor: theme.mix(theme.color('muted'), theme.color('surface'), 0.5), marginVertical: theme.space('l') }} />;
    case 'code': {
      const mono = theme.font('mono');
      return (
        <ScrollView horizontal style={{ backgroundColor: theme.mix(theme.color('muted'), theme.color('surface'), 0.12), borderRadius: theme.radius('card'), marginVertical: body.fontSize * 0.5 }} contentContainerStyle={{ padding: theme.space('m') }}>
          <Text selectable style={{ fontFamily: mono.fontFamily, fontSize: mono.fontSize, lineHeight: mono.lineHeight, color: ink }} accessibilityLabel={p.lang ? `${String(p.lang)} code` : 'code'}>
            {String(p.src)}
          </Text>
        </ScrollView>
      );
    }
    case 'math':
      return (
        <ScrollView horizontal contentContainerStyle={{ flexGrow: 1, justifyContent: 'center', paddingVertical: body.fontSize * 0.6 }}>
          <MathView m={p as unknown as MathLike} fontSize={body.fontSize} display />
        </ScrollView>
      );
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
      // a transitional extern this renderer does not implement: say so, accessibly
      return (
        <View accessible accessibilityRole="text" style={{ borderWidth: 1, borderColor: theme.color('muted'), borderRadius: theme.radius('card'), padding: theme.space('m') }}>
          <Text style={{ color: ink }}>{String(p.summary ?? n.t)}</Text>
        </View>
      );
  }
}

function BlockImage({ src, alt, max }: { src: string; alt: string; max?: number }): ReactNode {
  const [width, setWidth] = useState<number | null>(null);
  return (
    <View style={{ width: '100%', maxWidth: max }} onLayout={(e) => setWidth(e.nativeEvent.layout.width)}>
      <InlineImage src={src} alt={alt} max={width ?? max ?? 320} />
    </View>
  );
}

/** Equal columns: rows that wrap, each cell a fraction of the width (span=n cells take n). */
function Grid({ n }: { n: VNode }): ReactNode {
  const { theme } = useCtx();
  const p = n.p;
  const cols = Math.max(1, Number(p.cols) || 2);
  const gap = theme.space(p.gap) ?? 0;
  const { gap: _omit, ...box } = boxStyle(p, theme);
  const cell = (k: VNode): ViewStyle => ({ width: `${(Math.min(cols, k.layout?.span ?? 1) / cols) * 100}%` as DimensionValue, padding: gap / 2 });
  return (
    <View style={box}>
      <View style={{ flexDirection: 'row', flexWrap: 'wrap', alignItems: ALIGN[String(p.align)] ?? 'stretch', margin: -gap / 2 }}>
        <Kids nodes={n.kids} cell={cell} />
      </View>
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

const PRESS_ROLE: Record<string, AccessibilityRole> = { button: 'button', tab: 'tab', option: 'radio', toggle: 'togglebutton' };

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
  const state = kind === 'tab' ? { selected, disabled } : kind === 'option' || kind === 'toggle' ? { checked: selected, disabled } : { disabled };
  const r = theme.radius('card');
  return (
    <Pressable
      accessibilityRole={PRESS_ROLE[kind] ?? 'button'}
      accessibilityState={state}
      accessibilityLabel={p.label ? String(p.label) : undefined}
      disabled={disabled}
      hitSlop={6}
      onPress={() => rt.dispatch(n.key, 'click')}
      style={({ pressed }) => ({
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'center',
        gap: theme.space('s'),
        minHeight: 36,
        minWidth: 36,
        paddingVertical: theme.space('xs'),
        paddingHorizontal: theme.space('m'),
        borderWidth: 1,
        borderColor: selected ? accent : pressed ? accent : theme.mix(theme.color('muted'), surface, 0.45),
        backgroundColor: selected ? accent : theme.mix(theme.color('muted'), surface, pressed ? 0.24 : 0.14),
        borderRadius: r,
        ...(kind === 'tab' ? { borderBottomLeftRadius: 0, borderBottomRightRadius: 0 } : null),
        opacity: disabled ? 0.45 : 1,
      })}
    >
      <InkCtx.Provider value={selected ? surface : tone}>
        <Kids nodes={n.kids} />
      </InkCtx.Provider>
    </Pressable>
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

/** Text or number entry; Return submits. */
function Field({ n }: { n: VNode }): ReactNode {
  const { rt, theme } = useCtx();
  const ink = useInk();
  const p = n.p;
  const body = theme.font('body');
  const width = theme.size(p.width);
  return (
    <TextInput
      value={String(p.value ?? '')}
      placeholder={String(p.placeholder ?? '')}
      placeholderTextColor={theme.color('muted')}
      accessibilityLabel={String(p.label || p.placeholder || 'entry')}
      keyboardType={p.kind === 'number' ? 'numbers-and-punctuation' : 'default'}
      returnKeyType="done"
      autoCapitalize="none"
      autoCorrect={false}
      onChangeText={(v) => rt.dispatch(n.key, 'change', { value: v })}
      onSubmitEditing={(e) => rt.dispatch(n.key, 'submit', { value: e.nativeEvent.text })}
      style={{
        width,
        minHeight: 40,
        color: ink,
        fontFamily: body.fontFamily,
        fontSize: body.fontSize,
        backgroundColor: theme.color('surface'),
        borderWidth: 1,
        borderColor: theme.mix(theme.color('muted'), theme.color('surface'), 0.6),
        borderRadius: theme.radius('card'),
        paddingVertical: theme.space('xs'),
        paddingHorizontal: theme.space('m'),
      }}
    />
  );
}

/** A popover, tooltip or dialog anchored to its first slot. A dialog is a Modal (the back button closes it). */
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
        <Modal transparent visible animationType="fade" onRequestClose={close} supportedOrientations={['portrait', 'landscape']}>
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
// Scopes: a definition instance, with its arrows drawn over it (6.10)

interface Entry {
  host: Measurable | null;
  hidden: boolean;
  layout?: LayoutRectangle;
}

interface Drawn {
  key: string;
  d: string;
  head: string;
  label?: [number, number];
  runs?: VRun[];
}

function Scope({ n }: { n: VNode }): ReactNode {
  const parents = useContext(MeasureCtx);
  const container = useRef<ComponentRef<typeof View>>(null);
  const arrows = n.arrows;
  const entries = useRef(new Map<string, Entry>());
  const rects = useRef(new Map<string, Rect>());
  const [paths, setPaths] = useState<Drawn[]>([]);
  const frame = useRef<ReturnType<typeof requestAnimationFrame> | null>(null);
  const arrowsRef = useRef(arrows);
  arrowsRef.current = arrows;

  // turns the measured rects into paths; equal output keeps the previous state (no re-render)
  const draw = useRef(() => {
    const out: Drawn[] = [];
    for (const a of arrowsRef.current ?? []) {
      const ra = rects.current.get(a.from);
      const rb = rects.current.get(a.to);
      if (!ra || !rb || entries.current.get(a.from)?.hidden || entries.current.get(a.to)?.hidden) continue;
      const pth = arrowPath(ra, rb, a.curve);
      if (pth) out.push({ key: a.key, d: pth.d, head: pth.head.map((q) => q.join(',')).join(' '), label: a.label ? pth.label : undefined, runs: a.label });
    }
    setPaths((prev) => (JSON.stringify(prev) === JSON.stringify(out) ? prev : out));
  }).current;

  // measures every arrow end against the scope container, then draws. Until the platform has
  // answered for an element, its layout relative to its parent stands in (exact for the scope's
  // own children); on the new architecture measureLayout answers synchronously.
  const measured = useRef(new Set<string>());
  const measure = useRef(() => {
    const want = new Set<string>();
    for (const a of arrowsRef.current ?? []) want.add(a.from).add(a.to);
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
    if (frame.current !== null) return;
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
        }
        else entries.current.set(key, { ...entries.current.get(key), host, hidden });
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

  // keyed moves animate for the settle time: measure again a little after that
  const { theme } = useCtx();
  useEffect(() => {
    if (!arrows?.length) return undefined;
    measure();
    const t = setTimeout(measure, theme.motion('settle') + 50);
    return () => clearTimeout(t);
  });
  useEffect(
    () => () => {
      if (frame.current !== null) cancelAnimationFrame(frame.current);
    },
    [],
  );

  const label = n.p.summary ? String(n.p.summary) : undefined;
  return (
    <View ref={container} role={label ? 'group' : undefined} accessibilityLabel={label} nativeID={(n.p.anchor as string | undefined) ?? undefined} onLayout={arrows?.length ? schedule : undefined} style={{ position: 'relative' }}>
      <MeasureCtx.Provider value={chain}>
        <Kids nodes={n.kids} />
      </MeasureCtx.Provider>
      {arrows?.length ? <Arrows paths={paths} /> : null}
    </View>
  );
}

/** The drawn arrows, over the scope and out of the touch and accessibility trees (they are decoration; the structure is in the content). */
function Arrows({ paths }: { paths: Drawn[] }): ReactNode {
  const { theme } = useCtx();
  const muted = theme.color('muted');
  const body = theme.font('body');
  return (
    <View pointerEvents="none" accessibilityElementsHidden importantForAccessibility="no-hide-descendants" style={{ position: 'absolute', top: 0, left: 0, right: 0, bottom: 0 }} testID="mkp-arrows">
      <Svg width="100%" height="100%" style={{ overflow: 'visible' }}>
        {paths.map((p) => [
          <Path key={`${p.key}.d`} d={p.d} fill="none" stroke={muted} strokeWidth={1.5} />,
          <Polygon key={`${p.key}.h`} points={p.head} fill={muted} />,
        ])}
      </Svg>
      {paths.map((p) =>
        p.label && p.runs ? (
          <View key={`${p.key}.l`} style={{ position: 'absolute', left: p.label[0] - 60, top: p.label[1] - 12, width: 120, alignItems: 'center' }}>
            <Text style={{ color: muted, fontSize: body.fontSize * 0.8, backgroundColor: theme.color('surface') }}>
              <Runs runs={p.runs} fontSize={body.fontSize * 0.8} />
            </Text>
          </View>
        ) : null,
      )}
    </View>
  );
}
