// @vitest-environment jsdom
// The playground as a provider: every base widget is its own, nothing falls back to the neutral
// renderer, and each shadcn control drives the runtime and shows what the runtime says.
import { afterEach, describe, expect, it } from 'vitest';
import { cleanup, fireEvent, render, within } from '@testing-library/react';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { compile, CORE_MKP, fixtureCases, compileCase, Runtime } from '@mkp/core';
import { BASE_WIDGETS, MkpDocument } from '@mkp/react';
import { shadcnTokens } from '@mkp/shadcn';
import { allPacks, ROOT } from '../../../packages/core/test/helpers';
import { components } from '../src/kit';

afterEach(cleanup);

// Radix's Slider measures itself, and jsdom has no layout
globalThis.ResizeObserver ??= class {
  observe(): void {}
  unobserve(): void {}
  disconnect(): void {}
};

const packs = compile({ packs: allPacks() });

function fixture(pack: string, widget: string, name: string): { rt: Runtime; ui: ReturnType<typeof render> } {
  const fc = fixtureCases(packs).find((c) => c.pack === pack && c.widget === widget && c.name === name)!;
  const bundle = compileCase(packs, fc).bundle!;
  const rt = new Runtime(bundle, { now: () => 0 });
  return { rt, ui: render(<MkpDocument bundle={bundle} runtime={rt} components={components} tokens={shadcnTokens} />) };
}

describe('the base set', () => {
  it('is every widget core@1 provides', () => {
    const provides = /provides (.*)/.exec(CORE_MKP)![1].split(' ').filter((n) => n !== 'rgb');
    expect([...BASE_WIDGETS].sort()).toEqual(provides.sort());
  });

  it('is all defined by the provider: the 18.5 document uses no neutral control', () => {
    const bundle = packs.document(readFileSync(join(ROOT, 'examples/spec18/roots.mkp.md'), 'utf8'), 'roots.mkp.md')!;
    const { container } = render(<MkpDocument bundle={bundle} components={components} tokens={shadcnTokens} />);
    expect(container.querySelector('.mkp-error')).toBeNull();
    expect(container.querySelector('.mkp-press, .mkp-range, .mkp-field, .mkp-meter')).toBeNull();
    expect(container.querySelector('[data-slot=tabs-list]')).toBeTruthy();
    expect(container.querySelector('[data-slot=slider]')).toBeTruthy();
    expect(container.querySelector('[data-slot=alert]')).toBeTruthy();
    // the neutral look isn't loaded, or it would win over the provider's own
    expect(container.ownerDocument.querySelector('style')?.textContent).not.toContain('.mkp-press');
  });
});

describe('controls drive the runtime', () => {
  it('tabs: a real TabsTrigger selects the runtime tab', () => {
    const { ui } = fixture('mkp-ui', 'tabs@1', 'two');
    const tabs = ui.getAllByRole('tab');
    expect(tabs[0].getAttribute('data-slot')).toBe('tabs-trigger');
    expect(tabs[0].getAttribute('aria-selected')).toBe('true');
    fireEvent.mouseDown(tabs[1], { button: 0 });
    expect(ui.getAllByRole('tab')[1].getAttribute('aria-selected')).toBe('true');
  });

  it('a row of options is a ToggleGroup, and pressing the chosen one keeps it', () => {
    const { ui } = fixture('mkp-ui', 'select@1', 'inline');
    const items = () => within(ui.container).getAllByRole('radio');
    expect(items()[0].getAttribute('data-slot')).toBe('toggle-group-item');
    fireEvent.click(items()[1]);
    expect(items()[1].getAttribute('aria-checked')).toBe('true');
    fireEvent.click(items()[1]);
    expect(items()[1].getAttribute('aria-checked')).toBe('true');
  });

  it('toggle is a Switch', () => {
    const { ui } = fixture('mkp-ui', 'toggle@1', 'off');
    const sw = ui.getByRole('switch');
    expect(sw.getAttribute('data-slot')).toBe('switch');
    expect(sw.getAttribute('aria-checked')).toBe('false');
    fireEvent.click(sw);
    expect(ui.getByRole('switch').getAttribute('aria-checked')).toBe('true');
  });

  it('answers are option rows, marked right or wrong once checked', () => {
    const { ui } = fixture('mkp-learn', 'quiz.choice@1', 'multiple');
    const rows = () => ui.getAllByRole('checkbox');
    expect(rows()[0].getAttribute('data-slot')).toBe('option-row');
    fireEvent.click(rows()[0]);
    expect(rows()[0].getAttribute('aria-checked')).toBe('true');
    expect(rows()[0].getAttribute('data-state')).toBe('chosen');
    fireEvent.click(ui.getByRole('button', { name: 'Check' }));
    expect(['right', 'wrong']).toContain(rows()[0].getAttribute('data-state'));
  });

  it('one pick is checked as soon as it is made, and the bar says how it went', () => {
    const { ui } = fixture('mkp-learn', 'quiz.choice@1', 'single');
    const rows = () => ui.getAllByRole('radio');
    expect(ui.queryByRole('button', { name: 'Check' })).toBeNull();
    fireEvent.click(rows()[0]);
    expect(rows()[0].getAttribute('aria-checked')).toBe('true');
    expect(rows()[0].getAttribute('data-state')).toBe('wrong');
    expect(ui.container.querySelector('.mkp-frame')?.getAttribute('data-tone')).toBe('bad');
    fireEvent.click(ui.getByRole('button', { name: 'Try again' }));
    expect(rows()[0].getAttribute('aria-checked')).toBe('false');
    fireEvent.click(rows()[1]);
    expect(rows()[1].getAttribute('data-state')).toBe('right');
    expect(ui.container.querySelector('.mkp-frame')?.getAttribute('data-tone')).toBe('ok');
  });

  it('predict: what waits is blurred until the reader answers', () => {
    const { ui } = fixture('mkp-learn', 'predict@1', 'recall');
    const veiled = () => ui.container.querySelector('[data-blur]');
    expect(veiled()?.textContent).toContain('Too Many Requests');
    fireEvent.click(ui.getByRole('button', { name: 'Reveal' }));
    expect(veiled()).toBeNull();
  });

  it('a press that is one symbol is an icon, as a button and as a toggle', () => {
    const { ui } = fixture('mkp-cs', 'trace@1', 'sum-loop');
    // play is the bar's one strong button, pressed or not
    const play = ui.getByRole('button', { name: 'play step' });
    expect(play.getAttribute('data-slot')).toBe('button');
    expect(play.getAttribute('aria-pressed')).toBe('false');
    expect(play.querySelector('svg')).toBeTruthy();
    expect(play.textContent).toBe('');
    // the arrows and start over are quiet icon buttons
    for (const name of ['previous: step', 'next: step', 'start over: step']) expect(ui.getByRole('button', { name }).querySelector('svg')).toBeTruthy();
  });

  it('a code block with a current line is a numbered listing with that line marked', () => {
    const { ui } = fixture('mkp-cs', 'trace@1', 'sum-loop');
    expect(ui.container.querySelector('[data-slot=code-block] [aria-current=step]')?.textContent).toBe('1total = 0');
    fireEvent.click(ui.getByRole('button', { name: 'next: step' }));
    expect(ui.container.querySelector('[data-slot=code-block] [aria-current=step]')?.textContent).toBe('2for i in range(1, 4):');
  });

  it('progress is a Progress', () => {
    const { ui } = fixture('mkp-ui', 'progress@1', 'percent');
    expect(ui.getByRole('progressbar').getAttribute('data-slot')).toBe('progress');
  });

  it('a field is an Input that reports what is typed', () => {
    const { ui } = fixture('mkp-learn', 'quiz.numeric@1', 'half');
    const input = ui.getByRole('textbox') as HTMLInputElement;
    expect(input.getAttribute('data-slot')).toBe('input');
    fireEvent.change(input, { target: { value: '42' } });
    expect((ui.getByRole('textbox') as HTMLInputElement).value).toBe('42');
  });
});

describe('overlays no pack uses yet', () => {
  const enc = new TextEncoder();
  function doc(mode: string) {
    const files = new Map<string, Uint8Array>([
      ['manifest.mkp', enc.encode('pack t@1 "test"\n  requires core@1\n  provides w\n')],
      ['w.mkp', enc.encode(`w@1 "w"\n  overlay id=o mode=${mode} label="more"\n    text "open"\n    fill body\n      text "inside"\n`)],
    ]);
    const c = compile({ packs: [{ label: 't', files }] });
    return render(<MkpDocument bundle={c.document('```w\nsummary: s\n```\n', 'doc.mkp.md')!} components={components} tokens={shadcnTokens} />);
  }

  it('a dialog is a Dialog, opened and closed through the runtime', () => {
    const ui = doc('dialog');
    fireEvent.click(ui.getByRole('button', { name: 'more' }));
    expect(within(ui.getByRole('dialog')).getByText('inside').closest('.mkp-root')).toBeTruthy();
    fireEvent.keyDown(ui.getByRole('dialog'), { key: 'Escape' });
    expect(ui.queryByRole('dialog')).toBeNull();
  });

  it('a popover is a Popover', () => {
    const ui = doc('popover');
    fireEvent.click(ui.getByRole('button', { name: 'more' }));
    expect(ui.getByText('inside')).toBeTruthy();
  });
});

describe('a choice of the widget’s state', () => {
  const enc = new TextEncoder();
  function doc(inHeader: boolean) {
    const view = inHeader
      ? '  frame kind="Report" title="t"\n    text "stage"\n    fill actions\n      controls pct\n'
      : '  frame kind="Report" title="t"\n    text "stage"\n';
    const files = new Map<string, Uint8Array>([
      ['manifest.mkp', enc.encode('pack t@1 "test"\n  requires core@1\n  provides w\n')],
      ['w.mkp', enc.encode(`w@1 "w"\n  pct = choice(p50|p95) "percentile"\n${view}`)],
    ]);
    const c = compile({ packs: [{ label: 't', files }] });
    return render(<MkpDocument bundle={c.document('```w\nsummary: s\n```\n', 'doc.mkp.md')!} components={components} tokens={shadcnTokens} />);
  }

  it('is its name and a ToggleGroup of its options in the bar', () => {
    const ui = doc(false);
    const group = ui.getByRole('radiogroup', { name: 'percentile' });
    expect(group.closest('.mkp-frame-bar, [data-slot=widget-controls]')).toBeTruthy();
    expect(group.querySelector('.mkp-choice-label')?.textContent).toBe('percentile');
    const items = within(group).getAllByRole('radio');
    expect(items.map((i) => i.getAttribute('data-slot'))).toEqual(['toggle-group-item', 'toggle-group-item']);
    fireEvent.click(items[1]);
    expect(within(ui.getByRole('radiogroup', { name: 'percentile' })).getAllByRole('radio')[1].getAttribute('aria-checked')).toBe('true');
  });

  it('sits in the header without its name showing when placed in the frame’s actions', () => {
    const ui = doc(true);
    const group = ui.getByRole('radiogroup', { name: 'percentile' });
    expect(group.closest('.mkp-frame-actions')).toBeTruthy();
    expect(group.closest('.mkp-frame-bar')).toBeNull();
  });
});
