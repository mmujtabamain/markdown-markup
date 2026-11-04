// The React Native renderer against every fixture case of every pack (read from disk, so packs and
// fixtures added later are covered) and the section-18 document: each renders with no error
// node, every view node has its element with the right role, and play steps re-render cleanly.
// Then interactions: tabs, a range, a field, an overlay, a handle, arrows, pixels and motion.

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react-native';
import type { TestInstance } from 'test-renderer';
import {
  compile,
  compileCase,
  Diagnostics,
  fixtureCases,
  formatDiagnostic,
  MathsEngine,
  prerender,
  Runtime,
  TokenTable,
  walkView,
  type FixtureCase,
  type IRBundle,
  type VNode,
  type VRun,
  type VShape,
} from '@mkp/core';
import { capabilities, MkpDocument, setSkia } from '../src';
import { allPacks, ROOT } from './packs';

const H = { includeHiddenElements: true } as const;
const c = compile({ packs: allPacks() });
const cases = fixtureCases(c).filter((fc) => !fc.expect?.errors?.length);
let maths: MathsEngine;

beforeAll(async () => {
  maths = await MathsEngine.create();
}, 120000);

function build(fc: FixtureCase): IRBundle {
  const r = compileCase(c, fc);
  if (!r.bundle) throw new Error(`${fc.pack}/${fc.widget}/${fc.name}: ${r.diags.errors.map(formatDiagnostic).join('\n')}`);
  prerender(r.bundle, maths);
  return r.bundle;
}

interface MountOptions {
  hosts?: Record<string, unknown>;
  reducedMotion?: boolean;
  theme?: 'light' | 'dark';
  caps?: string[];
}

async function mount(bundle: IRBundle, o: MountOptions = {}): Promise<Runtime> {
  const rt = new Runtime(bundle, { now: () => 0, maths, capabilities: o.caps ?? ['core@1', 'gfx@1'], reducedMotion: o.reducedMotion ?? true, hosts: o.hosts ? { '0': o.hosts } : undefined });
  await render(<MkpDocument bundle={bundle} runtime={rt} reducedMotion={o.reducedMotion ?? true} theme={o.theme ?? 'light'} />);
  return rt;
}

const all = (el: TestInstance, pred: (i: TestInstance) => boolean): TestInstance[] => el.queryAll(pred);
const hasType = (el: TestInstance, type: string): boolean => all(el, (i) => i.type === type).length > 0;
const PRESS_ROLE: Record<string, string> = { button: 'button', tab: 'tab', option: 'radio', toggle: 'togglebutton' };

function mathRuns(rs: unknown): (VRun & { t: 'math' })[] {
  return Array.isArray(rs) ? (rs as VRun[]).filter((r): r is VRun & { t: 'math' } => r.t === 'math') : [];
}

/** Asserts the view tree has no error node and that each node has its element, with its role. */
function check(rt: Runtime): number {
  const view = rt.view();
  const errors: string[] = [];
  walkView(view, (n) => {
    if (n.t === 'error') errors.push(`${String(n.p.name)}: ${String(n.p.message)}`);
  });
  expect(errors).toEqual([]);
  expect(screen.queryAllByRole('alert', H)).toEqual([]);
  let count = 0;
  walkView(view, (n: VNode) => {
    count++;
    const el = screen.getByTestId(n.key, H);
    const p = n.p;
    switch (n.t) {
      case 'press': {
        const role = PRESS_ROLE[String(p.kind ?? 'button')];
        const pressable = within(el).getAllByRole(role, H)[0];
        const st = pressable.props.accessibilityState ?? {};
        expect(!!st.disabled).toBe(!!p.disabled);
        if (p.kind === 'tab') expect(!!st.selected).toBe(!!p.selected);
        if (p.kind === 'option' || p.kind === 'toggle') expect(!!st.checked).toBe(!!p.selected);
        break;
      }
      case 'range': {
        const slider = within(el).getByRole('adjustable', H);
        expect(slider.props.accessibilityValue.now).toBe(Number(p.value));
        expect(slider.props.accessibilityActions.map((a: { name: string }) => a.name)).toEqual(['increment', 'decrement']);
        break;
      }
      case 'field':
        expect(hasType(el, 'TextInput')).toBe(true);
        break;
      case 'overlay': {
        const anchor = within(el).getAllByRole('button', H)[0];
        expect(!!anchor.props.accessibilityState?.expanded).toBe(!!p.open);
        break;
      }
      case 'canvas': {
        const shapes: VShape[] = (n.layers ?? []).flatMap((l) => l.shapes);
        const pixels = shapes.filter((s) => s.t === 'pixels');
        if (Number(p.dims) === 3) expect(hasType(el, 'RNSVGSvgView') || hasType(el, 'Image')).toBe(true);
        else {
          expect(hasType(el, 'RNSVGSvgView')).toBe(true);
          expect(within(el).getAllByRole('image', H).some((i) => i.props.accessibilityLabel === String(p.label || 'figure'))).toBe(true);
        }
        const handles = shapes.filter((s) => s.t === 'handle');
        expect(within(el).queryAllByRole('adjustable', H).length).toBeGreaterThanOrEqual(handles.length);
        for (const s of pixels) {
          if (s.t !== 'pixels') continue;
          if (s.fallback) expect(hasType(el, 'Image')).toBe(true);
          else expect(within(el).queryAllByTestId('skia-canvas', H).length).toBeGreaterThan(0);
        }
        break;
      }
      case 'text':
      case 'paragraph':
      case 'heading':
        expect(hasType(el, 'Text')).toBe(true);
        for (const m of mathRuns(p.runs)) if ((m as { svg?: string }).svg) expect(all(el, (i) => i.props.accessibilityLabel === ((m as { speech?: string }).speech || m.tex)).length).toBeGreaterThan(0);
        if (n.t === 'heading') expect(within(el).getAllByRole('header', H).length).toBeGreaterThan(0);
        break;
      case 'math':
        if (p.svg) expect(hasType(el, 'RNSVGSvgView')).toBe(true);
        break;
      case 'image':
        expect(hasType(el, 'Image')).toBe(true);
        break;
      case 'scope':
        if (n.arrows?.length) expect(within(el).queryAllByTestId('mkp-arrows', H).length).toBeGreaterThan(0);
        break;
      case 'bar':
        expect(all(el, (i) => i.props.accessibilityRole === 'toolbar').length).toBe(1);
        break;
    }
  });
  return count;
}

async function play(rt: Runtime, fc: FixtureCase): Promise<void> {
  for (const s of fc.play ?? []) {
    await act(async () => {
      if (s.press) expect(rt.press(s.press)).toBe(true);
      if (s.set) rt.set(s.set);
      if (s.command) rt.widget(0).command(s.command, s.args);
      if (s.wait) for (let t = 0; t < s.wait; t += 50) rt.tick(50);
    });
    check(rt);
  }
}

const name = (fc: FixtureCase): string => `${fc.pack}/${fc.widget}/${fc.name}`;

// The document drives playing controls on animation frames; here the play steps' waits tick the
// runtime instead, so frames are held (fake timers) and only the 'play' test below runs them.
function holdFrames(): void {
  beforeEach(() => jest.useFakeTimers());
  afterEach(() => jest.useRealTimers());
}

describe('every fixture case renders', () => {
  holdFrames();
  // (build errors in packs are the core's fixture test's to report; a case that cannot compile fails below)
  it('finds the packs and their cases', () => {
    expect(cases.length).toBeGreaterThan(10);
  });
  it.each(cases.map((fc) => [name(fc), fc] as const))('%s', async (_n, fc) => {
    const rt = await mount(build(fc), { hosts: fc.hosts });
    expect(check(rt)).toBeGreaterThan(0);
    await play(rt, fc);
  });
});

describe('the section-18 document', () => {
  holdFrames();
  const text = readFileSync(join(ROOT, 'examples/spec18/roots.mkp.md'), 'utf8');
  it('compiles and renders in light and dark, playing its controls', async () => {
    const diags = new Diagnostics();
    const bundle = c.document(text, 'examples/spec18/roots.mkp.md', diags);
    expect(diags.errors.map(formatDiagnostic)).toEqual([]);
    prerender(bundle!, maths);
    const rt = await mount(bundle!);
    expect(check(rt)).toBeGreaterThan(5);
    // every press in the document works and leaves it error-free
    const presses: string[] = [];
    walkView(rt.view(), (n) => n.t === 'press' && !n.p.disabled && presses.push(n.key));
    for (const key of presses.slice(0, 12)) {
      const el = screen.queryByTestId(key, H);
      if (!el) continue;
      await fireEvent.press(within(el).getAllByRole(/button|tab|radio|togglebutton/, H)[0]);
      check(rt);
    }
    await screen.unmount();
    const dark = await mount(bundle!, { theme: 'dark' });
    check(dark);
    const root = screen.toJSON() as unknown as { props: { style: { backgroundColor?: string }[] } };
    expect(root.props.style[0].backgroundColor).toBe(new TokenTable(bundle!.tokens).color('surface', 'dark'));
  });
});

// ---------------------------------------------------------------------------------------------
// Interactions, on whichever cases have the elements (so they follow the packs as they grow)

function firstCase(pred: (view: VNode[]) => boolean): { fc: FixtureCase; bundle: IRBundle } | null {
  for (const fc of cases) {
    const bundle = build(fc);
    const rt = new Runtime(bundle, { now: () => 0, maths, hosts: fc.hosts ? { '0': fc.hosts } : undefined });
    if (pred(rt.view())) return { fc, bundle };
  }
  return null;
}

function find(view: VNode[], pred: (n: VNode) => boolean): VNode | undefined {
  let hit: VNode | undefined;
  walkView(view, (n) => {
    if (!hit && pred(n)) hit = n;
  });
  return hit;
}

function shapeOf(view: VNode[], t: VShape['t']): VShape | undefined {
  let hit: VShape | undefined;
  walkView(view, (n) => {
    for (const l of n.layers ?? []) for (const s of l.shapes) if (!hit && s.t === t) hit = s;
  });
  return hit;
}

describe('interactions', () => {
  it('pressing a tab selects it', async () => {
    const hit = firstCase((v) => {
      let tabs = 0;
      walkView(v, (n) => n.t === 'press' && n.p.kind === 'tab' && tabs++);
      return tabs >= 2;
    });
    expect(hit).not.toBeNull();
    const rt = await mount(hit!.bundle, { hosts: hit!.fc.hosts });
    const tabs = screen.getAllByRole('tab');
    const target = tabs.findIndex((t) => !t.props.accessibilityState?.selected);
    expect(target).toBeGreaterThanOrEqual(0);
    await fireEvent.press(tabs[target]);
    expect(screen.getAllByRole('tab')[target].props.accessibilityState.selected).toBe(true);
    check(rt);
  });

  it('a range changes with the increment and decrement actions', async () => {
    const hit = firstCase((v) => !!find(v, (n) => n.t === 'range'));
    expect(hit).not.toBeNull();
    const rt = await mount(hit!.bundle, { hosts: hit!.fc.hosts });
    const node = find(rt.view(), (n) => n.t === 'range')!;
    const atMax = Number(node.p.value) >= Number(node.p.max);
    const slider = within(screen.getByTestId(node.key)).getByRole('adjustable');
    await fireEvent(slider, 'accessibilityAction', { nativeEvent: { actionName: atMax ? 'decrement' : 'increment' } });
    const after = find(rt.view(), (n) => n.key === node.key)!;
    expect(Number(after.p.value)).not.toBe(Number(node.p.value));
    expect(Number(after.p.value) > Number(node.p.value)).toBe(!atMax);
    expect(within(screen.getByTestId(node.key)).getByRole('adjustable').props.accessibilityValue.now).toBe(Number(after.p.value));
    check(rt);
  });

  it('a range follows a drag on its track', async () => {
    const hit = firstCase((v) => !!find(v, (n) => n.t === 'range' && Number(n.p.max) > Number(n.p.min)));
    const rt = await mount(hit!.bundle, { hosts: hit!.fc.hosts });
    const node = find(rt.view(), (n) => n.t === 'range')!;
    const slider = within(screen.getByTestId(node.key)).getByRole('adjustable');
    await fireEvent(slider, 'layout', { nativeEvent: { layout: { x: 0, y: 0, width: 200, height: 44 } } });
    // the PanResponder's grant: a touch at the far end of the track sets the maximum
    const at = { touchActive: true, startPageX: 200, startPageY: 22, startTimeStamp: 1, currentPageX: 200, currentPageY: 22, currentTimeStamp: 1, previousPageX: 200, previousPageY: 22, previousTimeStamp: 1 };
    const touch = { nativeEvent: { locationX: 200, locationY: 22, pageX: 200, pageY: 22, touches: [], changedTouches: [], identifier: 0, timestamp: 1 }, touchHistory: { touchBank: [at], numberActiveTouches: 1, indexOfSingleActiveTouch: 0, mostRecentTimeStamp: 1 } };
    await act(async () => {
      slider.props.onResponderGrant(touch);
    });
    expect(Number(find(rt.view(), (n) => n.key === node.key)!.p.value)).toBeCloseTo(Number(node.p.max), 6);
  });

  it('a field reports changes and submits on Return', async () => {
    const hit = firstCase((v) => !!find(v, (n) => n.t === 'field'));
    expect(hit).not.toBeNull();
    const rt = await mount(hit!.bundle, { hosts: hit!.fc.hosts });
    const node = find(rt.view(), (n) => n.t === 'field')!;
    const input = all(screen.getByTestId(node.key), (i) => i.type === 'TextInput')[0];
    await fireEvent.changeText(input, '0.5');
    expect(find(rt.view(), (n) => n.key === node.key)!.p.value).toBe('0.5');
    await fireEvent(input, 'submitEditing', { nativeEvent: { text: '0.5' } });
    check(rt);
  });

  it('an overlay opens from its anchor and shows its body', async () => {
    const hit = firstCase((v) => !!find(v, (n) => n.t === 'overlay' && !n.p.open));
    if (!hit) return; // no pack uses an overlay yet
    const rt = await mount(hit.bundle, { hosts: hit.fc.hosts });
    const node = find(rt.view(), (n) => n.t === 'overlay')!;
    await fireEvent.press(within(screen.getByTestId(node.key)).getAllByRole('button')[0]);
    const open = find(rt.view(), (n) => n.key === node.key)!;
    expect(open.p.open).toBe(true);
    check(rt);
  });

  it('a handle moves with accessibility actions (the non-drag alternative)', async () => {
    const hit = firstCase((v) => !!shapeOf(v, 'handle'));
    expect(hit).not.toBeNull();
    const rt = await mount(hit!.bundle, { hosts: hit!.fc.hosts });
    const h = shapeOf(rt.view(), 'handle') as Extract<VShape, { t: 'handle' }>;
    const el = screen.getAllByRole('adjustable').find((e) => e.props.accessibilityLabel === h.label)!;
    expect(el).toBeTruthy();
    const towardsMiddle = h.at[1] > (h.y[0] + h.y[1]) / 2 ? 'down' : 'up';
    await fireEvent(el, 'accessibilityAction', { nativeEvent: { actionName: towardsMiddle } });
    const moved = shapeOf(rt.view(), 'handle') as Extract<VShape, { t: 'handle' }>;
    expect(moved.at[1]).not.toBeCloseTo(h.at[1], 6);
    expect(moved.at[0]).toBeCloseTo(h.at[0], 6);
    const towardsCentre = h.at[0] > (h.x[0] + h.x[1]) / 2 ? 'decrement' : 'increment';
    await fireEvent(screen.getAllByRole('adjustable').find((e) => e.props.accessibilityLabel === h.label)!, 'accessibilityAction', { nativeEvent: { actionName: towardsCentre } });
    expect((shapeOf(rt.view(), 'handle') as Extract<VShape, { t: 'handle' }>).at[0]).not.toBeCloseTo(h.at[0], 6);
    check(rt);
  });

  it('a scope with arrows asks for no frame while it unmounts', async () => {
    const hit = firstCase((v) => !!find(v, (n) => !!n.arrows?.length));
    await mount(hit!.bundle, { hosts: hit!.fc.hosts });
    await act(async () => {
      await new Promise((r) => setTimeout(r, 30));
    });
    const frames = jest.spyOn(globalThis, 'requestAnimationFrame');
    await act(async () => {
      await screen.unmount();
    });
    expect(frames).not.toHaveBeenCalled();
    frames.mockRestore();
  });

  it('arrows are drawn between measured ends', async () => {
    const hit = firstCase((v) => !!find(v, (n) => !!n.arrows?.length));
    expect(hit).not.toBeNull();
    const rt = await mount(hit!.bundle, { hosts: hit!.fc.hosts });
    const scope = find(rt.view(), (n) => !!n.arrows?.length)!;
    const a = scope.arrows![0];
    // lay out every element of the scope on a diagonal, so each pair of ends is apart
    let i = 0;
    for (const key of new Set(scope.arrows!.flatMap((x) => [x.from, x.to]))) {
      const el = screen.queryByTestId(key);
      if (el) await fireEvent(el, 'layout', { nativeEvent: { layout: { x: 40 * i, y: 50 * i, width: 30, height: 20 } } });
      i++;
    }
    expect(screen.getByTestId(a.from)).toBeTruthy();
    await waitFor(() => expect(all(screen.getByTestId(scope.key), (e) => e.type === 'RNSVGPath').length).toBeGreaterThan(0));
    check(rt);
  });

  it('pixels draw through Skia, and fall back to the image without it', async () => {
    const hit = firstCase((v) => !!shapeOf(v, 'pixels'));
    if (!hit) return; // no pack uses pixels yet
    expect(capabilities()).toEqual(['core@1', 'gfx@1']);
    await mount(hit.bundle, { hosts: hit.fc.hosts });
    const shader = screen.getAllByTestId('skia-shader', H)[0];
    const uniforms = JSON.parse(shader.props.accessibilityHint);
    expect(uniforms.mkp_size).toHaveLength(2);
    await screen.unmount();
    setSkia(null);
    try {
      expect(capabilities()).toEqual(['core@1']);
      const rt = await mount(hit.bundle, { hosts: hit.fc.hosts, caps: capabilities() });
      expect(screen.queryAllByTestId('skia-canvas', H)).toEqual([]);
      const px = shapeOf(rt.view(), 'pixels') as Extract<VShape, { t: 'pixels' }>;
      expect(px.fallback).toMatch(/^data:image\/png/);
      expect(all(screen.root!, (e) => e.type === 'Image' && e.props.source?.uri === px.fallback).length).toBe(1);
      check(rt);
    } finally {
      setSkia(undefined);
    }
  });

  it('swaps keyed children on a press, with nothing left behind', async () => {
    const hit = firstCase((v) => {
      let tabs = 0;
      walkView(v, (n) => n.t === 'press' && n.p.kind === 'tab' && tabs++);
      return tabs >= 2;
    });
    const rt = await mount(hit!.bundle, { hosts: hit!.fc.hosts });
    const tabs = screen.getAllByRole('tab');
    await fireEvent.press(tabs[tabs.findIndex((t) => !t.props.accessibilityState?.selected)]);
    await waitFor(() => check(rt), { timeout: 2000 });
  });
});

describe('play', () => {
  it('drives a playing runtime on animation frames once a control starts it', async () => {
    // the first case whose play steps press a control's play button
    const fc = cases.find((x) => (x.play ?? []).some((st) => /(^|\.)play$/.test(st.press ?? '')));
    expect(fc).toBeDefined();
    const bundle = build(fc!);
    const rt = new Runtime(bundle, { now: () => 0, maths, reducedMotion: true, hosts: fc!.hosts ? { '0': fc!.hosts } : undefined });
    const tick = jest.spyOn(rt, 'tick');
    await render(<MkpDocument bundle={bundle} runtime={rt} reducedMotion theme="light" />);
    const id = fc!.play!.find((st) => /(^|\.)play$/.test(st.press ?? ''))!.press!;
    await act(async () => {
      expect(rt.press(id)).toBe(true);
      await new Promise((r) => setTimeout(r, 150));
    });
    expect(rt.playing() || tick.mock.calls.length > 0).toBe(true);
    expect(tick).toHaveBeenCalled();
    check(rt);
    await act(async () => {
      await screen.unmount();
    });
  });
});
