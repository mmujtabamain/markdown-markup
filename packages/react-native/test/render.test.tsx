// The React Native renderer on small documents that define their widgets inline: each renders with
// no error node and every view node has its element with the right role, in light and dark. Then
// the containers and their props, text, press, field, code, maths, the canvas, arrows, the width,
// and interactions: tabs, a range, a field, an overlay, a handle, pixels and play.

import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react-native';
import type { TestInstance } from 'test-renderer';
import { compile, formatDiagnostic, MathsEngine, prerender, Runtime, TokenTable, walkView, type IRBundle, type VNode, type VRun, type VShape } from '@mkp/core';
import { capabilities, markSvg, MkpDocument, placeCanvasLabels, setSkia, widthClass } from '../src';

const H = { includeHiddenElements: true } as const;
let maths: MathsEngine;

beforeAll(async () => {
  maths = await MathsEngine.create();
}, 120000);

const fence = (b: string): string => '```mkp\n' + b + '\n```\n';

/** A document with one widget, w, defined inline from its lines, a block using it, and any Markdown after. */
function doc(lines: string[], after = ''): IRBundle {
  const text = fence(['w "A test widget."', ...lines.map((l) => '  ' + l), '  project md = "w"'].join('\n')) + '```w\nsummary: s\n```\n' + after;
  const c = compile({ packs: [] });
  const b = c.document(text, 'doc.mkp.md');
  if (!b || c.diags.errors.length) throw new Error(c.diags.errors.map(formatDiagnostic).join('\n'));
  prerender(b, maths);
  return b;
}

interface MountOptions {
  reducedMotion?: boolean;
  theme?: 'light' | 'dark';
  caps?: string[];
}

async function mount(bundle: IRBundle, o: MountOptions = {}): Promise<Runtime> {
  const rt = new Runtime(bundle, { now: () => 0, maths, capabilities: o.caps ?? ['core@1', 'gfx@1'], reducedMotion: o.reducedMotion ?? true });
  await render(<MkpDocument bundle={bundle} runtime={rt} reducedMotion={o.reducedMotion ?? true} theme={o.theme ?? 'light'} />);
  return rt;
}

const all = (el: TestInstance, pred: (i: TestInstance) => boolean): TestInstance[] => el.queryAll(pred);
const hasType = (el: TestInstance, type: string): boolean => all(el, (i) => i.type === type).length > 0;
const PRESS_ROLE: Record<string, string> = { button: 'button', tab: 'tab', option: 'radio', toggle: 'togglebutton', check: 'checkbox', radio: 'radio', switch: 'switch', plain: 'button' };
const flat = (style: unknown): Record<string, unknown> => (Array.isArray(style) ? Object.assign({}, ...style.flat(4).filter(Boolean)) : ((style as Record<string, unknown>) ?? {}));

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
    // a frame's drawers (About, Details) are drawn only while they are open
    if (/\.(about|details)\//.test(n.key)) return;
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
        break;
      }
      case 'field':
        expect(hasType(el, 'TextInput')).toBe(true);
        break;
      case 'overlay':
        expect(!!within(el).getAllByRole('button', H)[0].props.accessibilityState?.expanded).toBe(!!p.open);
        break;
      case 'canvas': {
        const shapes: VShape[] = (n.layers ?? []).flatMap((l) => l.shapes);
        if (Number(p.dims) !== 3) {
          expect(hasType(el, 'RNSVGSvgView')).toBe(true);
          expect(within(el).getAllByRole('image', H).some((i) => i.props.accessibilityLabel === String(p.label || 'figure'))).toBe(true);
        }
        expect(within(el).queryAllByRole('adjustable', H).length).toBeGreaterThanOrEqual(shapes.filter((s) => s.t === 'handle').length);
        for (const s of shapes) if (s.t === 'label') expect(within(el).getByTestId(`${s.key}.label`, H)).toBeTruthy();
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
      case 'scope':
        if (n.arrows?.length) expect(within(el).queryAllByTestId(/^mkp-arrows/, H).length).toBeGreaterThan(0);
        break;
      case 'bar':
        expect(all(el, (i) => i.props.accessibilityRole === 'toolbar').length).toBe(1);
        break;
    }
  });
  return count;
}

const tabs = ['var at text = "a"', 'row', '  press kind=tab selected=(at == "a")', '    text "Roots"', '    @click set at="a"', '  press kind=tab selected=(at == "b")', '    text "Powers"', '    @click set at="b"'];

const DOCS: Record<string, [string[], string?]> = {
  tabs: [tabs],
  containers: [['column gap=s pad=m stroke=line edge=bottom weight=thick width=fit', '  row justify=center wrap=false scroll=x', '    text "a"', '    text "b" self=end', '  grid cols=[auto, 1fr, 6ch, m]', '    text "1"', '    text "2"', '    text "3"', '    text "4"', '    text "5" span=2', '  stack align=center justify=end', '    text "under"', '    text "over"']],
  text: [['text "a long title" lines=2 clip=true', 'text "plain" lines=3 caps=true', 'text "maths $x^2$ inline"']],
  controls: [['k = slider 0..4 step=1 "which root"', 'at = steps 3 none=true play=1s "step"', 't = clock "elapsed"', 'pick = choice(one|two) "pick"', 'on = toggle "on"', 'text "k \\val{k} at \\val{at}"']],
  inputs: [['var v text = ""', 'field value=v lines=3 tone=ok label="many"', 'field value=v tone=bad label="one"', 'code src="a = 1\\nb = 2" pickable=true', '  @pick set v="picked"', 'meter value=0.4']],
  maths: [['math tex=$\\mark{a}{x^2} + 1$ marks=[{id: "a", tone: ok, note: "the square"}]']],
  canvas: [['p = drag x=0..10 y=0..10 = (5, 5) "point"', 'canvas x=0..10 y=0..10 size=s height=m label="plot"', '  layer opacity=0.8', '    circle (5, 5) 1 px=6 fill=accent opacity=0.5', '    path [(0, 0), (10, 10)] head=arrow width=2', '    path [(0, 10), (10, 0)] head=dot dash=true', '    label (5, 5) "big" size=large halo=true dx=4 dy=2', '    label (5, 5) "near" chip=true', '    handle p tone=info']],
  overlay: [['overlay id=o mode=popover label="more"', '  text "open"', '  fill body', '    text "inside"']],
  frame: [['at = steps 3 "step"', 'frame kind="Demo" title="A frame" height=s status="going"', '  pane title="P" note="n"', '    text "in the pane"', '  fill about', '    text "about it"']],
  arrows: [['column gap=l', '  column id=a', '    text "a"', '  column id=b', '    text "b"', 'arrow from=a to=b label="go"', 'arrow from=b to=a curve head=dot tail=ring', 'arrow from=a to=b layer=behind opacity=0.4']],
  markdown: [['text "x"'], '\n# A heading\n\nA paragraph with `code` and a note.[^n]\n\n- one\n- [x] two\n\n| a | b |\n|---|---|\n| 1 | 2 |\n\n> [!TIP]\n> A tip.\n\n```js\nlet x = 1\n```\n\n[^n]: The note.\n'],
};

// The document drives playing controls (a clock runs from the start) on animation frames; here
// frames are held (fake timers) so nothing updates outside act, and only the 'play' test runs them.
function holdFrames(): void {
  beforeEach(() => jest.useFakeTimers());
  afterEach(() => jest.useRealTimers());
}

describe('every document renders', () => {
  holdFrames();
  it.each(Object.entries(DOCS))('%s', async (_name, [lines, after]) => {
    const bundle = doc(lines, after);
    const rt = await mount(bundle);
    expect(check(rt)).toBeGreaterThan(0);
    await screen.unmount();
    const dark = await mount(bundle, { theme: 'dark' });
    check(dark);
    const root = screen.toJSON() as unknown as { props: { style: { backgroundColor?: string }[] } };
    expect(root.props.style[0].backgroundColor).toBe(new TokenTable(bundle.tokens).color('surface', 'dark'));
  });
});

const find = (view: VNode[], pred: (n: VNode) => boolean): VNode | undefined => {
  let hit: VNode | undefined;
  walkView(view, (n) => {
    if (!hit && pred(n)) hit = n;
  });
  return hit;
};
const node = (rt: Runtime, t: string): VNode => find(rt.view(), (n) => n.t === t)!;
/** The node's own element: the first host view inside its slot. */
const own = (rt: Runtime, t: string): TestInstance => screen.getByTestId(node(rt, t).key, H).children[0] as TestInstance;

describe('the containers', () => {
  it('a border on the sides edge= names, at its weight; width=fit stops stretching (GAPS 19, 154)', async () => {
    const rt = await mount(doc(DOCS.containers[0]));
    const col = flat(own(rt, 'column').props.style);
    expect(col.borderBottomWidth).toBe(4);
    expect(col.borderTopWidth).toBeUndefined();
    expect(col.borderColor).toBe(new TokenTable(rt.bundle.tokens).color('line', 'light'));
    expect(flat(screen.getByTestId(node(rt, 'column').key).props.style).alignSelf).toBe('flex-start');
  });

  it('a row with scroll=x scrolls sideways inside its outline (GAPS 149), and a child’s self= is its own (GAPS 41)', async () => {
    const rt = await mount(doc(DOCS.containers[0]));
    const row = screen.getByTestId(node(rt, 'row').key);
    const scroller = all(row, (i) => i.type === 'RCTScrollView')[0];
    expect(scroller.props.horizontal).toBe(true);
    const b = find(rt.view(), (n) => n.t === 'text' && (n.p.runs as VRun[])[0]?.t === 'text' && (n.p.runs as { v: string }[])[0].v === 'b')!;
    expect(flat(screen.getByTestId(b.key).props.style).alignSelf).toBe('flex-end');
  });

  it('a grid takes its tracks: shares grow, characters and size tokens are fixed widths (GAPS 98)', async () => {
    const rt = await mount(doc(DOCS.containers[0]));
    const g = node(rt, 'grid');
    const cell = (i: number) => flat(screen.getByTestId(g.kids![i].key).parent!.props.style);
    expect(cell(1).flexGrow).toBe(1);
    expect(cell(2).width).toBeCloseTo(6 * 14 * 0.6, 5);
    expect(cell(3).width).toBe(320);
    // the fifth cell starts a second row and spans two tracks
    expect(screen.getByTestId(g.kids![4].key).parent!.parent).not.toBe(screen.getByTestId(g.kids![0].key).parent!.parent);
  });

  it('a stack draws its children over each other, as tall as the tallest (GAPS 79)', async () => {
    const rt = await mount(doc(DOCS.containers[0]));
    const st = node(rt, 'stack');
    const [under, over] = st.kids!.map((k) => screen.getByTestId(k.key).parent!);
    expect(flat(under.props.style).position).toBe('absolute');
    await fireEvent(under, 'layout', { nativeEvent: { layout: { x: 0, y: 0, width: 100, height: 40 } } });
    await fireEvent(over, 'layout', { nativeEvent: { layout: { x: 0, y: 0, width: 100, height: 20 } } });
    expect(flat(own(rt, 'stack').props.style).minHeight).toBe(40);
    // centred down it: the shorter one sits halfway
    expect(flat(screen.getByTestId(st.kids![1].key).parent!.props.style).top).toBe(10);
    expect(flat(under.props.style).alignItems).toBe('flex-end');
  });

  it('a press on a container’s own background raises click, and one on a child does not (GAPS 125)', async () => {
    const rt = await mount(doc(['var n int = 0', 'column pad=m', '  text "count \\val{n}"', '  @click set n=(n + 1)']));
    const col = own(rt, 'column');
    expect(col.props.onStartShouldSetResponder({ target: 1, currentTarget: 2 })).toBe(false);
    expect(col.props.onStartShouldSetResponder({ target: 2, currentTarget: 2 })).toBe(true);
    await act(async () => col.props.onResponderRelease());
    expect(screen.getByText('count 1')).toBeTruthy();
  });
});

describe('text, press, field, code and maths', () => {
  it('text clips to its lines with an ellipsis (GAPS 151)', async () => {
    const rt = await mount(doc(DOCS.text[0]));
    const [a, b] = rt.view()[0].kids!.map((k) => screen.getByTestId(k.key).children[0] as TestInstance);
    expect(a.props.numberOfLines).toBe(2);
    expect(a.props.ellipsizeMode).toBe('tail');
    expect(b.props.numberOfLines).toBeUndefined();
  });

  it('a press raises enter and leave on hover and focus', async () => {
    await mount(doc(['var over text = "no"', 'press label="card"', '  text "card"', '  @enter set over="yes"', '  @leave set over="no"', 'text "over \\val{over}"']));
    const card = screen.getByRole('button', { name: 'card' });
    await fireEvent(card, 'hoverIn');
    expect(screen.getByText('over yes')).toBeTruthy();
    await fireEvent(card, 'hoverOut');
    expect(screen.getByText('over no')).toBeTruthy();
    await fireEvent(card, 'focus');
    expect(screen.getByText('over yes')).toBeTruthy();
  });

  it('a field of several lines is multiline and submits when editing ends; a tone marks it (GAPS 80, 86)', async () => {
    const rt = await mount(doc(['var v text = ""', 'var got text = "-"', 'field value=v lines=3 tone=ok label="many"', '  @submit set got=(submit.value)', 'text "got \\val{got}"']));
    const input = all(screen.getByTestId(node(rt, 'field').key), (i) => i.type === 'TextInput')[0];
    expect(input.props.multiline).toBe(true);
    expect(input.props.numberOfLines).toBe(3);
    expect(flat(input.props.style).borderColor).toBe(new TokenTable(rt.bundle.tokens).color('ok', 'light'));
    await fireEvent.changeText(input, 'two\nlines');
    await fireEvent(input, 'endEditing', { nativeEvent: { text: 'two\nlines' } });
    expect(screen.getByText('got two\nlines')).toBeTruthy();
  });

  it('a pickable listing raises pick with the line pressed (GAPS 68, 96)', async () => {
    await mount(doc(['var at int = 0', 'code src="a = 1\\nb = 2\\nc = 3" pickable=true', '  @pick set at=(pick.line)', 'text "picked \\val{at}"']));
    await fireEvent.press(screen.getByRole('button', { name: 'line 2' }));
    expect(screen.getByText('picked 2')).toBeTruthy();
  });

  it('a formula’s marks colour their groups, and their notes are listed under it', async () => {
    expect(markSvg('<svg><g class="x mkp-mark-a" fill="currentColor"><use/></g><g class="mkp-mark-b"/></svg>', { a: '#15803d' })).toBe('<svg><g class="x mkp-mark-a" color="#15803d" fill="currentColor"><use/></g><g class="mkp-mark-b"/></svg>');
    await mount(doc(DOCS.maths[0]));
    expect(within(screen.getByTestId('mark-a')).getByText('the square')).toBeTruthy();
  });
});

describe('the canvas', () => {
  it('draws circles in px, paths with heads, and a fixed height (GAPS 18, 109, 113)', async () => {
    const rt = await mount(doc(DOCS.canvas[0]));
    const box = screen.getByTestId(node(rt, 'canvas').key);
    const svg = all(box, (i) => i.type === 'RNSVGSvgView')[0];
    expect(svg.props.height ?? flat(svg.props.style).height).toBe(320);
    // the px circle, and the dot at a path's end sized to its stroke
    expect(all(box, (i) => i.type === 'RNSVGCircle').map((c) => Number(c.props.r))).toEqual([6, 2.5]);
    // two shafts and an arrow head (a polygon is drawn as a path)
    expect(all(box, (i) => i.type === 'RNSVGPath')).toHaveLength(3);
  });

  it('keeps labels inside the canvas and clear of each other (GAPS 107)', () => {
    const [a, b, c] = placeCanvasLabels(
      [
        { x: 50, y: 50, w: 40, h: 16, anchor: 'center' },
        { x: 55, y: 52, w: 40, h: 16, anchor: 'center' },
        { x: 198, y: 2, w: 30, h: 16, anchor: 'ne' },
      ],
      200,
      100,
    );
    expect(a[0] + a[2] <= b[0] || b[0] + b[2] <= a[0] || a[1] + a[3] <= b[1] || b[1] + b[3] <= a[1]).toBe(true);
    expect(c[0] + c[2]).toBeLessThanOrEqual(200);
  });

  it('shows labels once measured, with their halo', async () => {
    const rt = await mount(doc(DOCS.canvas[0]));
    const labels = (node(rt, 'canvas').layers ?? []).flatMap((l) => l.shapes).filter((s) => s.t === 'label');
    for (const s of labels) await fireEvent(screen.getByTestId(`${s.key}.label`), 'layout', { nativeEvent: { layout: { x: 0, y: 0, width: 30, height: 16 } } });
    const big = screen.getByTestId(`${labels[0].key}.label`);
    expect(flat(big.props.style).opacity).toBeCloseTo(0.8, 5);
    expect(all(big, (i) => i.type === 'Text' && flat(i.props.style).textShadowRadius === 3)).toHaveLength(1);
  });
});

describe('arrows', () => {
  it('are drawn between measured ends, behind the content when asked, with dot and ring ends and a chip', async () => {
    const rt = await mount(doc(DOCS.arrows[0]));
    const scope = find(rt.view(), (n) => !!n.arrows?.length)!;
    const lay = async (id: string, y: number) => {
      const key = find(rt.view(), (n) => n.id === id)!.key;
      await fireEvent(screen.getByTestId(key), 'layout', { nativeEvent: { layout: { x: 0, y, width: 40, height: 20 } } });
    };
    await lay('a', 0);
    await lay('b', 60);
    const el = screen.getByTestId(scope.key);
    await waitFor(() => expect(all(within(el).getByTestId('mkp-arrows', H), (e) => e.type === 'RNSVGPath').length).toBeGreaterThan(1));
    const behind = within(el).getByTestId('mkp-arrows-behind', H);
    expect(all(behind, (e) => e.type === 'RNSVGGroup').some((g) => Math.abs(Number(g.props.opacity) - 0.4) < 1e-9)).toBe(true);
    // the curved one ends in a dot and a ring: two circles drawn as paths
    const arcs = all(within(el).getByTestId('mkp-arrows', H), (e) => e.type === 'RNSVGPath' && / a\d/.test(String(e.props.d)));
    expect(arcs.length).toBe(2);
    expect(within(el).getByText('go', H)).toBeTruthy();
    check(rt);
  });
});

describe('the reader’s width', () => {
  it('follows the document’s laid-out width', async () => {
    expect([390, 600, 1000].map(widthClass)).toEqual(['narrow', 'medium', 'wide']);
    const rt = await mount(doc(['text "\\val{width}"']));
    expect(screen.getByText('wide')).toBeTruthy();
    const root = screen.root!;
    await fireEvent(root, 'layout', { nativeEvent: { layout: { x: 0, y: 0, width: 390, height: 800 } } });
    expect(screen.getByText('narrow')).toBeTruthy();
    expect(rt.view()).toBeTruthy();
  });
});

describe('the runtime’s control rows', () => {
  // a clock runs from the start: its frames are held
  holdFrames();
  it('the controls are rows with their roles: steps (with no step yet), a clock, a choice', async () => {
    const rt = await mount(doc(DOCS.controls[0]));
    const row = (role: string, name: string) => all(screen.root!, (i) => i.props.role === role && i.props.accessibilityLabel === name);
    expect(row('group', 'step')).toHaveLength(1);
    expect(screen.getByText('—/3')).toBeTruthy();
    expect(row('group', 'elapsed')).toHaveLength(1);
    expect(row('radiogroup', 'pick')).toHaveLength(1);
    await fireEvent.press(screen.getByRole('button', { name: 'next: step' }));
    expect(screen.getByText('k 0 at 0')).toBeTruthy();
    check(rt);
  });
});

describe('interactions', () => {
  it('pressing a tab selects it', async () => {
    const rt = await mount(doc(tabs));
    await fireEvent.press(screen.getAllByRole('tab')[1]);
    expect(screen.getAllByRole('tab')[1].props.accessibilityState.selected).toBe(true);
    check(rt);
  });

  it('a range changes with the increment and decrement actions, and follows a drag', async () => {
    const rt = await mount(doc(['k = slider 0..4 step=1 "which root"']));
    const r = node(rt, 'range');
    const slider = within(screen.getByTestId(r.key)).getByRole('adjustable');
    await fireEvent(slider, 'accessibilityAction', { nativeEvent: { actionName: 'increment' } });
    expect(Number(find(rt.view(), (n) => n.key === r.key)!.p.value)).toBe(1);
    await fireEvent(slider, 'layout', { nativeEvent: { layout: { x: 0, y: 0, width: 200, height: 44 } } });
    const at = { touchActive: true, startPageX: 200, startPageY: 22, startTimeStamp: 1, currentPageX: 200, currentPageY: 22, currentTimeStamp: 1, previousPageX: 200, previousPageY: 22, previousTimeStamp: 1 };
    const touch = { nativeEvent: { locationX: 200, locationY: 22, pageX: 200, pageY: 22, touches: [], changedTouches: [], identifier: 0, timestamp: 1 }, touchHistory: { touchBank: [at], numberActiveTouches: 1, indexOfSingleActiveTouch: 0, mostRecentTimeStamp: 1 } };
    await act(async () => {
      within(screen.getByTestId(r.key)).getByRole('adjustable').props.onResponderGrant(touch);
    });
    expect(Number(find(rt.view(), (n) => n.key === r.key)!.p.value)).toBe(4);
    check(rt);
  });

  it('an overlay opens from its anchor and shows its body', async () => {
    const rt = await mount(doc(DOCS.overlay[0]));
    const o = node(rt, 'overlay');
    await fireEvent.press(within(screen.getByTestId(o.key)).getAllByRole('button')[0]);
    expect(find(rt.view(), (n) => n.key === o.key)!.p.open).toBe(true);
    expect(screen.getByText('inside')).toBeTruthy();
    check(rt);
  });

  it('a handle moves with accessibility actions (the non-drag alternative)', async () => {
    const rt = await mount(doc(DOCS.canvas[0]));
    const el = screen.getAllByRole('adjustable').find((e) => e.props.accessibilityLabel === 'point')!;
    await fireEvent(el, 'accessibilityAction', { nativeEvent: { actionName: 'up' } });
    await fireEvent(screen.getAllByRole('adjustable').find((e) => e.props.accessibilityLabel === 'point')!, 'accessibilityAction', { nativeEvent: { actionName: 'increment' } });
    const h = (node(rt, 'canvas').layers ?? []).flatMap((l) => l.shapes).find((s) => s.t === 'handle') as Extract<VShape, { t: 'handle' }>;
    expect(h.at[0]).toBeCloseTo(5.2, 6);
    expect(h.at[1]).toBeCloseTo(5.2, 6);
    check(rt);
  });

  it('a scope with arrows asks for no frame while it unmounts', async () => {
    await mount(doc(DOCS.arrows[0]));
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

  it('pixels draw through Skia, and fall back to the image without it', async () => {
    const bundle = doc(['requires gfx@1', 'canvas x=0..1 y=0..1 size=s', '  layer', '    pixels (rgb(x, y, 0.5))']);
    expect(capabilities()).toEqual(['core@1', 'gfx@1']);
    await mount(bundle);
    const uniforms = JSON.parse(screen.getAllByTestId('skia-shader', H)[0].props.accessibilityHint);
    expect(uniforms.mkp_size).toHaveLength(2);
    await screen.unmount();
    setSkia(null);
    try {
      expect(capabilities()).toEqual(['core@1']);
      const rt = await mount(bundle, { caps: capabilities() });
      expect(screen.queryAllByTestId('skia-canvas', H)).toEqual([]);
      const px = (node(rt, 'canvas').layers ?? []).flatMap((l) => l.shapes).find((s) => s.t === 'pixels') as Extract<VShape, { t: 'pixels' }>;
      expect(px.fallback).toMatch(/^data:image\/png/);
      expect(all(screen.root!, (e) => e.type === 'Image' && e.props.source?.uri === px.fallback).length).toBe(1);
    } finally {
      setSkia(undefined);
    }
  });
});

describe('play', () => {
  it('drives a playing runtime on animation frames once a control starts it', async () => {
    const bundle = doc(['at = steps 4 play=200ms "step"', 'text "at \\val{at}"']);
    const rt = new Runtime(bundle, { now: () => 0, maths, reducedMotion: true });
    const tick = jest.spyOn(rt, 'tick');
    await render(<MkpDocument bundle={bundle} runtime={rt} reducedMotion theme="light" />);
    await act(async () => {
      expect(rt.press('at.play')).toBe(true);
      await new Promise((r) => setTimeout(r, 150));
    });
    expect(tick).toHaveBeenCalled();
    check(rt);
    await act(async () => {
      await screen.unmount();
    });
  });
});
