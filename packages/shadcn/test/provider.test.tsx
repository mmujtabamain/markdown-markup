// @vitest-environment jsdom
// @mkp/shadcn with the playground's kit as the provider: every base widget is its own, nothing falls
// back to the neutral renderer, and each shadcn control drives the runtime and shows what the runtime
// says. The documents define their widgets inline.
import { afterEach, describe, expect, it } from 'vitest';
import { cleanup, fireEvent, render, within } from '@testing-library/react';
import { compile, CORE_MKP, formatDiagnostic, Runtime, type IRBundle } from '@mkp/core';
import { BASE_WIDGETS, MkpDocument } from '@mkp/react';
import { shadcnTokens } from '@mkp/shadcn';
import { components } from '../../../apps/playground/src/kit';

afterEach(cleanup);

// Radix's Slider measures itself, and jsdom has no layout
globalThis.ResizeObserver ??= class {
  observe(): void {}
  unobserve(): void {}
  disconnect(): void {}
};

const fence = (b: string): string => '```mkp\n' + b + '\n```\n';

function doc(lines: string[], after = ''): IRBundle {
  const text = fence(['w "A test widget."', ...lines.map((l) => '  ' + l), '  project md = "w"'].join('\n')) + '```w\nsummary: s\n```\n' + after;
  const c = compile({ packs: [] });
  const b = c.document(text, 'doc.mkp.md');
  if (!b || c.diags.errors.length) throw new Error(c.diags.errors.map(formatDiagnostic).join('\n'));
  return b;
}

function draw(lines: string[], after = ''): { rt: Runtime; ui: ReturnType<typeof render> } {
  const bundle = doc(lines, after);
  const rt = new Runtime(bundle, { now: () => 0 });
  return { rt, ui: render(<MkpDocument bundle={bundle} runtime={rt} components={components} tokens={shadcnTokens} />) };
}

const tabs = ['var at text = "a"', 'row', '  press kind=tab selected=(at == "a")', '    text "Roots"', '    @click set at="a"', '  press kind=tab selected=(at == "b")', '    text "Powers"', '    @click set at="b"'];

describe('the base set', () => {
  it('is every widget core@1 provides', () => {
    const types = new Set([...CORE_MKP.matchAll(/^type (\w+)/gm)].map((m) => m[1]));
    const provides = /provides (.*)/.exec(CORE_MKP)![1].split(' ').filter((n) => !types.has(n));
    expect([...BASE_WIDGETS].sort()).toEqual(provides.sort());
    expect(Object.keys(components).sort()).toEqual([...BASE_WIDGETS].sort());
  });

  it('is all defined by the provider: the document uses no neutral control', () => {
    const { ui } = draw([...tabs, 'k = slider 0..4 step=1 "which root"', 'meter value=0.5', 'var v text = ""', 'field value=v'], '\n> [!NOTE]\n> A note.\n');
    const { container } = ui;
    expect(container.querySelector('.mkp-error')).toBeNull();
    expect(container.querySelector('.mkp-press, .mkp-range, .mkp-field, .mkp-meter')).toBeNull();
    expect(container.querySelector('[data-slot=tabs-list]')).toBeTruthy();
    expect(container.querySelector('[data-slot=slider]')).toBeTruthy();
    expect(container.querySelector('[data-slot=alert]')).toBeTruthy();
    expect(container.querySelector('[data-slot=progress]')).toBeTruthy();
    expect(container.querySelector('[data-slot=input]')).toBeTruthy();
    // the neutral look isn't loaded, or it would win over the provider's own
    expect(container.ownerDocument.querySelector('style')?.textContent).not.toContain('.mkp-press');
  });

  it('lays out the four containers as the base renderer does, with their props', () => {
    const { ui } = draw(['column width=fit stroke=line edge=bottom', '  row justify=center scroll=x wrap=false', '    text "a"', '  grid cols=[auto, 1fr]', '    text "b"', '  stack', '    text "under"', '    text "over" self=end']);
    const c = ui.container;
    expect(c.querySelector<HTMLElement>('[data-mkp=column]')!.style.width).toBe('fit-content');
    expect(c.querySelector<HTMLElement>('[data-mkp=column]')!.style.borderBottom).toContain('var(--mkp-color-line)');
    expect(c.querySelector('[data-mkp=row][data-scroll=x] > [data-mkp-inner][data-justify=center]')).toBeTruthy();
    expect(c.querySelector<HTMLElement>('[data-mkp=grid]')!.style.gridTemplateColumns).toBe('auto minmax(0, 1fr)');
    expect(c.querySelector('[data-mkp=stack][data-layers]')?.children).toHaveLength(2);
  });

  it('gives the line colour and the categorical tones shadcn’s own variables', () => {
    expect(shadcnTokens.color.line.value).toBe('var(--border, #e5e5e5)');
    expect(shadcnTokens.color.c1.value).toBe('var(--chart-1, #2563eb)');
    expect(Object.keys(shadcnTokens.color)).toEqual(expect.arrayContaining(['c1', 'c2', 'c3', 'c4', 'c5', 'c6']));
  });
});

describe('controls drive the runtime', () => {
  it('tabs: a real TabsTrigger selects the runtime tab', () => {
    const { ui } = draw(tabs);
    const all = ui.getAllByRole('tab');
    expect(all[0].getAttribute('data-slot')).toBe('tabs-trigger');
    expect(all[0].getAttribute('aria-selected')).toBe('true');
    fireEvent.mouseDown(all[1], { button: 0 });
    expect(ui.getAllByRole('tab')[1].getAttribute('aria-selected')).toBe('true');
  });

  it('a row of options is a ToggleGroup, and pressing the chosen one keeps it', () => {
    const { ui } = draw(['var at text = "a"', 'row', '  press kind=option selected=(at == "a")', '    text "A"', '    @click set at="a"', '  press kind=option selected=(at == "b")', '    text "B"', '    @click set at="b"']);
    const items = () => within(ui.container).getAllByRole('radio');
    expect(items()[0].getAttribute('data-slot')).toBe('toggle-group-item');
    fireEvent.click(items()[1]);
    expect(items()[1].getAttribute('aria-checked')).toBe('true');
    fireEvent.click(items()[1]);
    expect(items()[1].getAttribute('aria-checked')).toBe('true');
  });

  it('a switch is a Switch', () => {
    const { ui } = draw(['var on bool = false', 'press kind=switch selected=on label="sound"', '  text "sound"', '  @click set on=(not on)']);
    const sw = ui.getByRole('switch');
    expect(sw.getAttribute('data-slot')).toBe('switch');
    expect(sw.getAttribute('aria-checked')).toBe('false');
    fireEvent.click(sw);
    expect(ui.getByRole('switch').getAttribute('aria-checked')).toBe('true');
  });

  it('answers are option rows, marked right or wrong by their tone', () => {
    const { ui } = draw(['var on bool = false', 'var checked bool = false', 'press kind=check selected=on mark="A" tone=(if(checked, ok, none))', '  text "Paris"', '  @click set on=(not on)', 'press', '  text "Check"', '  @click set checked=true']);
    const row = () => ui.getByRole('checkbox');
    expect(row().getAttribute('data-slot')).toBe('option-row');
    fireEvent.click(row());
    expect(row().getAttribute('aria-checked')).toBe('true');
    expect(row().getAttribute('data-state')).toBe('chosen');
    fireEvent.click(ui.getByRole('button', { name: 'Check' }));
    expect(row().getAttribute('data-state')).toBe('right');
  });

  it('a press raises enter and leave through the kit’s button', () => {
    const { ui } = draw(['var over text = "no"', 'press label="card"', '  text "card"', '  @enter set over="yes"', '  @leave set over="no"', 'text "over \\val{over}"']);
    const card = ui.getByRole('button', { name: 'card' });
    expect(card.getAttribute('data-slot')).toBe('button');
    fireEvent.pointerEnter(card);
    expect(ui.container.textContent).toContain('over yes');
    fireEvent.pointerLeave(card);
    expect(ui.container.textContent).toContain('over no');
  });

  it('what waits is blurred until the reader reveals it', () => {
    const { ui } = draw(['var shown bool = false', 'column blur=(not shown)', '  text "Too Many Requests"', 'press', '  text "Reveal"', '  @click set shown=true']);
    const veiled = () => ui.container.querySelector('[data-blur]');
    expect(veiled()?.textContent).toContain('Too Many Requests');
    fireEvent.click(ui.getByRole('button', { name: 'Reveal' }));
    expect(veiled()).toBeNull();
  });

  it('a press that is one symbol is an icon, as a button and as a toggle', () => {
    const { ui } = draw(['at = steps 3 play=1s "step"', 'text "at \\val{at}"']);
    // play is the bar's one strong button, pressed or not
    const play = ui.getByRole('button', { name: 'play step' });
    expect(play.getAttribute('data-slot')).toBe('button');
    expect(play.getAttribute('aria-pressed')).toBe('false');
    expect(play.querySelector('svg')).toBeTruthy();
    expect(play.textContent).toBe('');
    for (const name of ['previous: step', 'next: step', 'start over: step']) expect(ui.getByRole('button', { name }).querySelector('svg')).toBeTruthy();
    // the steps are a row with their role
    expect(ui.getByRole('group', { name: 'step' }).getAttribute('data-control')).toBe('steps');
  });

  it('a code block with a current line is a numbered listing with that line marked; a pickable one raises pick', () => {
    const { ui } = draw(['var at int = 1', 'code src="total = 0\\nfor i in range(1, 4):" line=at pickable=true', '  @pick set at=(pick.line)']);
    const current = () => ui.container.querySelector('[data-slot=code-block] [aria-current=step]')?.textContent;
    expect(current()).toBe('1total = 0');
    fireEvent.click(ui.getByRole('button', { name: 'line 2' }));
    expect(current()).toBe('2for i in range(1, 4):');
  });

  it('a field is an Input that reports what is typed, marked by its tone; several lines are a Textarea', () => {
    const { ui } = draw(['var v text = ""', 'var got text = "-"', 'field value=v tone=bad label="one"', 'field value=v lines=3 label="many"', '  @submit set got=(submit.value)', 'text "got \\val{got}"']);
    const input = ui.getByRole('textbox', { name: 'one' }) as HTMLInputElement;
    expect(input.getAttribute('data-slot')).toBe('input');
    expect(input.getAttribute('aria-invalid')).toBe('true');
    fireEvent.change(input, { target: { value: '42' } });
    expect((ui.getByRole('textbox', { name: 'one' }) as HTMLInputElement).value).toBe('42');
    const many = ui.getByRole('textbox', { name: 'many' });
    expect(many.getAttribute('data-slot')).toBe('textarea');
    fireEvent.keyDown(many, { key: 'Enter' });
    expect(ui.container.textContent).toContain('got -');
    fireEvent.keyDown(many, { key: 'Enter', ctrlKey: true });
    expect(ui.container.textContent).toContain('got 42');
  });

  it('a formula’s marks and notes are drawn as the base renderer does', () => {
    const { ui } = draw(['math tex=$\\mark{a}{x}$ marks=[{id: "a", tone: c3, note: "the unknown"}]']);
    expect(ui.container.querySelector('[data-mkp=math] style')?.textContent).toContain('.mkp-mark-a { color: var(--mkp-color-c3);');
    expect(ui.container.querySelector('.mkp-math-notes')?.textContent).toBe('the unknown');
  });
});

describe('overlays', () => {
  const overlay = (mode: string) => draw([`overlay id=o mode=${mode} label="more"`, '  text "open"', '  fill body', '    text "inside"']);

  it('a dialog is a Dialog, opened and closed through the runtime', () => {
    const { ui } = overlay('dialog');
    fireEvent.click(ui.getByRole('button', { name: 'more' }));
    expect(within(ui.getByRole('dialog')).getByText('inside').closest('.mkp-root')).toBeTruthy();
    fireEvent.keyDown(ui.getByRole('dialog'), { key: 'Escape' });
    expect(ui.queryByRole('dialog')).toBeNull();
  });

  it('a popover is a Popover', () => {
    const { ui } = overlay('popover');
    fireEvent.click(ui.getByRole('button', { name: 'more' }));
    expect(ui.getByText('inside')).toBeTruthy();
  });
});

describe('a choice of the widget’s state', () => {
  const choice = (inHeader: boolean) =>
    draw(['pct = choice(p50|p95) "percentile"', 'frame kind="Report" title="t"', '  text "stage"', ...(inHeader ? ['  fill actions', '    controls pct'] : [])]);

  it('is its name and a ToggleGroup of its options in the bar', () => {
    const { ui } = choice(false);
    const group = ui.getByRole('radiogroup', { name: 'percentile' });
    expect(group.closest('.mkp-frame-bar, [data-slot=widget-controls]')).toBeTruthy();
    expect(group.querySelector('.mkp-choice-label')?.textContent).toBe('percentile');
    const items = within(group).getAllByRole('radio');
    expect(items.map((i) => i.getAttribute('data-slot'))).toEqual(['toggle-group-item', 'toggle-group-item']);
    fireEvent.click(items[1]);
    expect(within(ui.getByRole('radiogroup', { name: 'percentile' })).getAllByRole('radio')[1].getAttribute('aria-checked')).toBe('true');
  });

  it('sits in the header without its name showing when placed in the frame’s actions', () => {
    const { ui } = choice(true);
    const group = ui.getByRole('radiogroup', { name: 'percentile' });
    expect(group.closest('.mkp-frame-actions')).toBeTruthy();
    expect(group.closest('.mkp-frame-bar')).toBeNull();
  });
});
