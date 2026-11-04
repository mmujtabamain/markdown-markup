// The shell base widgets on React Native (spec 8): frame, pane, zoom and icon. A frame's drawers
// and full screen are modals; the zoom has its lock and buttons (a pinch needs a gesture library).

import { useState, type ReactNode } from 'react';
import { Modal, Pressable, ScrollView, Text, View } from 'react-native';
import { ICON_GLYPHS, type VNode, type VRun } from '@mkp/core';
import { useCtx } from './context';
import { Runs, useInk } from './runs';
import { Kids } from './nodes';

function ShellButton({ label, onPress, pressed, children }: { label: string; onPress(): void; pressed?: boolean; children: string }): ReactNode {
  const { theme } = useCtx();
  const ink = useInk();
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityState={pressed === undefined ? undefined : { selected: pressed }}
      hitSlop={6}
      onPress={onPress}
      style={({ pressed: down }) => ({ minWidth: 32, minHeight: 32, alignItems: 'center', justifyContent: 'center', borderRadius: theme.radius('card'), backgroundColor: down || pressed ? theme.mix(theme.color('muted'), theme.color('surface'), 0.16) : undefined })}
    >
      <Text style={{ color: ink, fontSize: theme.font('body').fontSize }}>{children}</Text>
    </Pressable>
  );
}

export function Icon({ n }: { n: VNode }): ReactNode {
  const { theme } = useCtx();
  const ink = useInk();
  const body = theme.font('body').fontSize;
  const scale = n.p.size === 'small' ? 0.8 : n.p.size === 'large' ? 1.4 : 1;
  const label = n.p.label ? String(n.p.label) : undefined;
  return (
    <Text
      accessibilityRole={label ? 'image' : undefined}
      accessibilityLabel={label}
      accessibilityElementsHidden={!label}
      importantForAccessibility={label ? 'auto' : 'no-hide-descendants'}
      style={{ color: theme.color(n.p.tone) ?? ink, fontSize: body * scale }}
    >
      {ICON_GLYPHS[String(n.p.name)] ?? '•'}
    </Text>
  );
}

export function Frame({ n }: { n: VNode }): ReactNode {
  const { theme } = useCtx();
  const ink = useInk();
  const [drawer, setDrawer] = useState<'about' | 'details' | null>(null);
  const [full, setFull] = useState(false);
  const slots = n.slots ?? {};
  const has = (k: string): boolean => (slots[k]?.length ?? 0) > 0;
  const line = theme.mix(theme.color('muted'), theme.color('surface'), 0.3);
  const mono = theme.font('mono');
  const body = theme.font('body');
  const height = n.p.height && n.p.height !== 'none' ? (theme.size(n.p.height) as number | undefined) : undefined;
  const tone = n.p.tone && n.p.tone !== 'none' ? theme.color(n.p.tone) : undefined;
  const head = (
    <View style={{ flexDirection: 'row', alignItems: 'center', gap: theme.space('m'), minHeight: 40, paddingVertical: theme.space('s'), paddingLeft: theme.space('l'), paddingRight: theme.space('s'), borderBottomWidth: 1, borderBottomColor: line }}>
      {n.p.kind ? <Text style={{ fontFamily: mono.fontFamily, fontSize: 11, letterSpacing: 0.7, textTransform: 'uppercase', color: theme.color('muted') }}>{String(n.p.kind)}</Text> : null}
      <Text accessibilityRole="header" numberOfLines={1} style={{ flex: 1, color: ink, fontWeight: '600', fontSize: body.fontSize * 0.95 }}>
        <Runs runs={n.p.title as VRun[]} fontSize={body.fontSize * 0.95} />
      </Text>
      {has('actions') ? (
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: theme.space('xs') }}>
          <Kids nodes={slots.actions} />
        </View>
      ) : null}
      {has('about') ? <ShellButton label="About" onPress={() => setDrawer('about')}>ⓘ</ShellButton> : null}
      {has('details') ? <ShellButton label="Details" onPress={() => setDrawer('details')}>▤</ShellButton> : null}
      <ShellButton label={full ? 'Leave full screen' : 'Full screen'} onPress={() => setFull(!full)}>{full ? '⤡' : '⤢'}</ShellButton>
    </View>
  );
  const stage = (
    <View style={full ? { flex: 1 } : height ? { height } : undefined}>
      {height || full ? (
        <ScrollView>
          <Kids nodes={n.kids} />
        </ScrollView>
      ) : (
        <Kids nodes={n.kids} />
      )}
    </View>
  );
  const bar = has('bar') ? (
    <View
      accessibilityRole="toolbar"
      accessibilityLabel="controls"
      style={{ flexDirection: 'row', alignItems: 'center', gap: theme.space('m'), minHeight: 44, paddingVertical: theme.space('s'), paddingHorizontal: theme.space('l'), borderTopWidth: 1, borderTopColor: line, backgroundColor: theme.mix(tone ?? theme.color('muted'), theme.color('surface'), tone ? 0.1 : 0.06) }}
    >
      <Kids nodes={slots.bar} />
    </View>
  ) : null;
  const box = { borderWidth: 1, borderColor: line, borderRadius: theme.radius('card'), backgroundColor: theme.color('surface'), overflow: 'hidden' as const };
  return (
    <View style={box}>
      {head}
      {stage}
      {bar}
      <Modal visible={full} onRequestClose={() => setFull(false)}>
        <View style={{ flex: 1, backgroundColor: theme.color('surface') }}>
          {head}
          {stage}
          {bar}
        </View>
      </Modal>
      <Modal visible={!!drawer} transparent animationType="none" onRequestClose={() => setDrawer(null)}>
        <View style={{ flex: 1, flexDirection: 'row', backgroundColor: '#0006' }}>
          <Pressable accessibilityLabel="Close" style={{ flex: 1 }} onPress={() => setDrawer(null)} />
          <View accessibilityViewIsModal style={{ width: '85%', backgroundColor: theme.color('surface') }}>
            <View style={{ flexDirection: 'row', alignItems: 'center', padding: theme.space('m'), borderBottomWidth: 1, borderBottomColor: line }}>
              <Text accessibilityRole="header" style={{ flex: 1, color: ink, fontWeight: '600' }}>{drawer === 'about' ? 'About' : 'Details'}</Text>
              <ShellButton label="Close" onPress={() => setDrawer(null)}>✕</ShellButton>
            </View>
            <ScrollView contentContainerStyle={{ padding: theme.space('l') }}>{drawer ? <Kids nodes={slots[drawer]} /> : null}</ScrollView>
          </View>
        </View>
      </Modal>
    </View>
  );
}

export function Pane({ n }: { n: VNode }): ReactNode {
  const { theme } = useCtx();
  const line = theme.mix(theme.color('muted'), theme.color('surface'), 0.25);
  const title = n.p.title as VRun[];
  const note = n.p.note as VRun[];
  const mono = theme.font('mono');
  return (
    <View style={{ flex: 1, minWidth: 0 }}>
      {title.length || note.length ? (
        <View style={{ flexDirection: 'row', justifyContent: 'space-between', gap: theme.space('m'), paddingVertical: theme.space('m'), paddingHorizontal: theme.space('l'), borderBottomWidth: 1, borderBottomColor: line }}>
          <Text style={{ fontFamily: mono.fontFamily, fontSize: 11, letterSpacing: 0.7, textTransform: 'uppercase', color: theme.color('muted') }}>
            <Runs runs={title} fontSize={11} />
          </Text>
          {note.length ? (
            <Text style={{ fontSize: 12, color: theme.color('muted') }}>
              <Runs runs={note} fontSize={12} />
            </Text>
          ) : null}
        </View>
      ) : null}
      <ScrollView style={{ flex: 1 }}>
        <Kids nodes={n.kids} />
      </ScrollView>
      {n.slots?.footer?.length ? (
        <View style={{ paddingVertical: theme.space('s'), paddingHorizontal: theme.space('l'), borderTopWidth: 1, borderTopColor: line }}>
          <Kids nodes={n.slots.footer} />
        </View>
      ) : null}
    </View>
  );
}

/** Zoom behind a lock: locked, it is still; unlocked, + / − / reset scale it. */
export function Zoom({ n }: { n: VNode }): ReactNode {
  const { theme } = useCtx();
  const [locked, setLocked] = useState(true);
  const [scale, setScale] = useState(1);
  const max = Number(n.p.max) > 1 ? Number(n.p.max) : 4;
  return (
    <View style={{ overflow: 'hidden' }}>
      <View style={scale !== 1 ? { transform: [{ scale }] } : undefined}>
        <Kids nodes={n.kids} />
      </View>
      <View style={{ position: 'absolute', top: theme.space('s'), right: theme.space('s'), flexDirection: 'row', gap: 2, padding: 2, borderRadius: theme.radius('card'), backgroundColor: theme.color('surface') }}>
        {!locked ? (
          <>
            <ShellButton label="Zoom out" onPress={() => setScale(Math.max(1, scale / 1.25))}>−</ShellButton>
            <ShellButton label="Zoom in" onPress={() => setScale(Math.min(max, scale * 1.25))}>+</ShellButton>
            <ShellButton label="Reset the view" onPress={() => setScale(1)}>↺</ShellButton>
          </>
        ) : null}
        <ShellButton label={locked ? 'Unlock to zoom' : 'Lock the view'} pressed={!locked} onPress={() => setLocked(!locked)}>⚿</ShellButton>
      </View>
    </View>
  );
}
