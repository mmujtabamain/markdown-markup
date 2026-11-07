// What a host relies on to draw a document cheaply: whether it needs the maths engine at all.
import { describe, expect, it } from 'vitest';
import { compile } from '../src/build';
import { formatDiagnostic } from '../src/diag';
import { MathsEngine, needsMaths, prerender } from '../src/maths';
import { Diagnostics } from '../src/diag';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { ROOT } from './helpers';

function bundle(src: string) {
  const c = compile({ packs: [] });
  const b = c.document(src, 'x.mkp.md');
  expect(c.diags.errors.map(formatDiagnostic)).toEqual([]);
  return b!;
}
const widget = (body: string) => '```mkp\nw "a widget"\n' + body + '  project md = "x"\n```\n\n```w\nsummary: s\n```\n';

describe('needsMaths', () => {
  it('is false for a document with no maths, a dollar in code among it', () => {
    expect(needsMaths(bundle('# Hi\n\nNo maths here, only `$HOME`.\n\n```sh\necho $PATH\n```\n'))).toBe(false);
    expect(needsMaths(bundle(widget('  var n int = 0\n  press label="up"\n    text "Up \\val{n}"\n    @click set n=(n + 1)\n')))).toBe(false);
  });
  it('is true for maths in prose, a display formula, and maths inside a widget', () => {
    expect(needsMaths(bundle('# Hi\n\nEuler: $e^{i\\pi} = -1$.\n'))).toBe(true);
    expect(needsMaths(bundle('$$\nx^2\n$$\n'))).toBe(true);
    expect(needsMaths(bundle(widget('  text "the area is $\\pi r^2$"\n')))).toBe(true);
  });
  it('is true for maths with a live value, which only the engine can draw', () => {
    expect(needsMaths(bundle(widget('  var k int = 1\n  text "$e^{\\val{k} i}$"\n')))).toBe(true);
  });
  it('is false once the build has typeset every formula, and true while one is live', async () => {
    const m = await MathsEngine.create({ speech: false });
    const still = bundle('# Hi\n\nEuler: $e^{i\\pi} = -1$.\n\n$$\nx^2\n$$\n');
    prerender(still, m, new Diagnostics());
    expect(needsMaths(still)).toBe(false);
    const live = bundle(widget('  var k int = 1\n  text "$e^{\\val{k} i}$"\n'));
    prerender(live, m, new Diagnostics());
    expect(needsMaths(live)).toBe(true);
  });
  it('agrees with the examples: those that teach maths need it, the counter does not', () => {
    const of = (name: string) => bundle(readFileSync(join(ROOT, 'examples', name, 'doc.mkp.md'), 'utf8'));
    expect(needsMaths(of('05-counter'))).toBe(false);
    expect(needsMaths(of('03-code-and-maths'))).toBe(true);
    expect(needsMaths(of('25-roots-of-unity'))).toBe(true);
  });

});

describe('events on what is inside a widget', () => {
  const errors = (src: string) => {
    const c = compile({ packs: [] });
    c.document(src, 'x.mkp.md');
    return c.diags.errors.map((d) => `${d.code}: ${d.message}`);
  };
  const shape = (line: string, events: string[]) => widget(['  var n int = 0', '  canvas -1..1 -1..1 label="f"', '    layer', `      ${line}`, ...events.map((e) => `        ${e}`), ''].join('\n'));
  it('takes @enter, @leave and @click on a circle and a path, and runs them', () => {
    expect(errors(shape('circle (0, 0) 0.5 label="dot"', ['@enter set n=1', '@leave set n=0', '@click set n=2']))).toEqual([]);
    expect(errors(shape('path [(0, 0), (1, 1)] label="line"', ['@click set n=2']))).toEqual([]);
  });
  it('refuses other events on a shape, and events on shapes that are not pointed at', () => {
    expect(errors(shape('circle (0, 0) 0.5', ['@change set n=1']))[0]).toMatch(/^mkp\.unknown-event: a circle raises no "change" event; it raises enter, leave, click/);
    expect(errors(shape('label (0, 0) "a"', ['@enter set n=1']))[0]).toMatch(/a label record is data for canvas, so it can't take events.*or point at a circle or a path instead/);
  });
  it('refuses a press on a shape with no label, since a screen reader could not name it', () => {
    expect(errors(shape('circle (0, 0) 0.5', ['@click set n=1']))[0]).toMatch(/^mkp\.missing-input: a circle that takes @click is a control/);
    expect(errors(shape('circle (0, 0) 0.5', ['@enter set n=1']))).toEqual([]);
  });
  it('takes @enter and @leave on a container', () => {
    expect(errors(widget('  var on bool = false\n  row\n    @enter set on=true\n    @leave set on=false\n    text "x"\n'))).toEqual([]);
  });
});

describe('the second consumer', () => {
  const errors = (src: string) => {
    const c = compile({ packs: [] });
    c.document(src, 'x.mkp.md');
    return c.diags.errors.map((d) => `${d.code}: ${d.message}`);
  };
  it('counts a text literal with a $ in it as maths that may be built as it runs', () => {
    expect(needsMaths(bundle(widget('  in name text = "x"\n  text ("$" + name + "$")\n')))).toBe(true);
    expect(needsMaths(bundle(widget('  in name text = "x"\n  text ("costs \\\\$5 " + name)\n')))).toBe(false);
  });
  it('takes arrow corner=none|s|m and refuses anything else', () => {
    const arrow = (c: string) => widget(`  column\n    text "a" id=a\n    text "b" id=b\n    arrow from=a to=b route=down corner=${c}\n`);
    expect(errors(arrow('none'))).toEqual([]);
    expect(errors(arrow('s'))).toEqual([]);
    expect(errors(arrow('l'))[0]).toMatch(/corner/);
  });
  it('takes if= on a slot, and draws the slot only while it holds', () => {
    const src = '```mkp\npart box "x"\n  in open bool = false\n  in body slot\n  column\n    text "head"\n    slot body if=(open)\n\nw "w"\n  var on bool = false\n  column\n    box open=on\n      text "inside"\n  project md = "x"\n```\n\n```w\nsummary: s\n```\n';
    expect(errors(src)).toEqual([]);
    expect(errors(src.replace('slot body if=(open)', 'slot body hidden=(open)'))[0]).toMatch(/may take if=/);
  });
  it('does not count each, switch and case as levels of nesting', () => {
    let body = '';
    let ind = '  ';
    for (let i = 0; i < 10; i++) {
      body += `${ind}column\n`;
      ind += '  ';
    }
    body += `${ind}each k in 0..1 key=k\n${ind}  switch on=k\n${ind}    case 0\n${ind}      text "deep"\n${ind}    else\n${ind}      text "other"\n`;
    expect(errors(widget(body))).toEqual([]);
  });
});

describe('theme and clip', () => {
  it('reads theme as light by default and as the host sets it, and keeps the name for itself', async () => {
    const { Runtime } = await import('../src/runtime/runtime');
    const { walk } = await import('../src/runtime/view');
    const rt = new Runtime(bundle(widget('  text "\\val{theme}"\n')), {});
    const said = () => { let t = ''; walk(rt.view(), (n) => { if (n.t === 'text') t = JSON.stringify(n.p.runs); }); return t; };
    expect(said()).toContain('light');
    rt.setTheme('dark');
    expect(said()).toContain('dark');
    const c = compile({ packs: [] });
    c.document(widget('  in theme text = "x"\n'), 'x.mkp.md');
    expect(c.diags.errors[0]?.message).toMatch(/"theme" is already the reader's theme/);
  });
  it('gives a layer its clip rectangle, low corner first, and draws it in the Markdown picture', async () => {
    const { Runtime } = await import('../src/runtime/runtime');
    const { walk } = await import('../src/runtime/view');
    const rt = new Runtime(bundle(widget('  canvas 0..10 0..10\n    layer clip=[(9, 8), (1, 2)]\n      circle (5, 5) 1\n')), {});
    let clip: number[] | undefined;
    walk(rt.view(), (n) => { if (n.t === 'canvas') clip = n.layers![0].clip; });
    expect(clip).toEqual([1, 2, 9, 8]);
  });
});
