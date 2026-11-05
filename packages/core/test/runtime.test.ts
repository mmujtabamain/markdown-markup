// The runtime on the examples: controls and their bar, play, steps, reveal, signals and width.
import { inflateSync } from 'node:zlib';
import { describe, expect, it } from 'vitest';
import { compile } from '../src/build';
import { formatDiagnostic } from '../src/diag';
import { Runtime } from '../src/runtime/runtime';
import { walk, type VNode } from '../src/runtime/view';
import { examples } from './examples.test';

function bundle(name: string) {
  const ex = examples().find((e) => e.name.endsWith(name))!;
  const c = compile({ packs: ex.packs });
  const b = c.document(ex.text, ex.name, undefined, { docFile: ex.docFile });
  expect(c.diags.errors.map(formatDiagnostic)).toEqual([]);
  return b!;
}

function find(nodes: VNode[], f: (n: VNode) => boolean): VNode[] {
  const out: VNode[] = [];
  walk(nodes, (n) => f(n) && out.push(n));
  return out;
}

const texts = (rt: Runtime): string[] => find(rt.view(), (n) => n.t === 'text').map((n) => (n.p.runs as { v?: string }[]).map((r) => r.v ?? '').join(''));

/** Presses the press whose content says `label`. */
function pressLabelled(rt: Runtime, label: string): void {
  const p = find(rt.view(), (n) => n.t === 'press' && JSON.stringify(n.kids).includes(label))[0];
  rt.dispatch(p.key, 'click');
}

describe('runtime: roots of unity (example 25)', () => {
  it('draws its canvas and its bar of controls, with no warnings', () => {
    const rt = new Runtime(bundle('roots-of-unity'), { now: () => 0 });
    const v = rt.view();
    expect(rt.warnings).toEqual([]);
    expect(find(v, (n) => n.t === 'canvas').length).toBe(1);
    expect(find(v, (n) => n.t === 'bar').length).toBe(1);
    expect(find(v, (n) => n.t === 'quote').length).toBe(1);
  });
  it('plays k a root a second, and a toggle shows the turned point', () => {
    const rt = new Runtime(bundle('roots-of-unity'), { now: () => 0 });
    rt.view();
    expect(rt.press('k.play')).toBe(true);
    rt.tick(2100);
    const s = rt.blocks().find((b) => b.def.name === 'roots')!;
    expect(s.get('k')).toBe(2);
    const circles = () => find(rt.view(), (n) => n.t === 'canvas')[0].layers!.flatMap((l) => l.shapes).filter((x) => x.t === 'circle').length;
    const before = circles();
    expect(rt.press('spin')).toBe(true);
    expect(circles()).toBe(before + 1);
  });
});

describe('runtime: steps, switch and reveal (example 13)', () => {
  it('starts at no step, with a track, and steps through the cases', () => {
    const rt = new Runtime(bundle('controls'), { now: () => 0 });
    expect(texts(rt)).toContain('Press play, or step through.');
    expect(texts(rt)).toContain('—/4');
    expect(find(rt.view(), (n) => n.t === 'range' && n.key.includes('.step')).length).toBe(1);
    rt.press('step.next');
    expect(texts(rt)).toContain('Warm the pot.');
    rt.press('step.reset');
    expect(texts(rt)).toContain('Press play, or step through.');
  });
  it('plays a step a second', () => {
    const rt = new Runtime(bundle('controls'), { now: () => 0 });
    rt.view();
    rt.press('step.play');
    rt.tick(2050);
    expect(texts(rt)).toContain('Add a spoon of green tea per cup.');
  });
  it('reveals what is hidden, keeping its place', () => {
    const rt = new Runtime(bundle('controls'), { now: () => 0 });
    const why = () => find(rt.view(), (n) => n.id === 'why')[0];
    expect(why().hidden).toBe(true);
    pressLabelled(rt, 'Why not boiling');
    expect(why().hidden).toBe(false);
  });
});

describe('runtime: signals and guarded events (example 14)', () => {
  it('sends answered on every check, and the field takes the verdict’s tone', () => {
    const seen: string[] = [];
    const rt = new Runtime(bundle('check-an-answer'), { now: () => 0, onSignal: (e) => seen.push(`${e.name} ${JSON.stringify(e.payload)}`) });
    const field = () => find(rt.view(), (n) => n.t === 'field')[0];
    rt.dispatch(field().key, 'change', ' bergen');
    rt.dispatch(field().key, 'submit');
    expect(texts(rt)).toContain('Not quite. Try again.');
    rt.dispatch(field().key, 'change', 'OSLO ');
    rt.dispatch(field().key, 'submit');
    expect(texts(rt)).toContain('Right.');
    expect(field().p.tone).toBe('ok');
    expect(seen).toEqual(['answered {"correct":false,"value":" bergen"}', 'answered {"correct":true,"value":"OSLO "}']);
  });
});

describe('runtime: width (example 09)', () => {
  it('lays out a wrapping row of cards when wide, and a column when narrow', () => {
    const rt = new Runtime(bundle('on-a-phone'), { now: () => 0 });
    const rows = () => find(rt.view(), (n) => n.t === 'row' && n.p.wrap === true).length;
    expect(texts(rt)).toContain('Seen at wide width.');
    const wide = rows();
    rt.setWidth('narrow');
    expect(texts(rt)).toContain('Seen at narrow width.');
    expect(rows()).toBe(wide - 1);
  });
});

describe('runtime: a clock (example 15)', () => {
  it('counts down while it runs, pauses, and starts over', () => {
    const rt = new Runtime(bundle('timer'), { now: () => 0 });
    expect(texts(rt)).toContain('6:00 left');
    rt.tick(1000);
    rt.tick(1000);
    expect(texts(rt)).toContain('5:58 left');
    // taking it out pauses the clock (pause), and it shows the clock's own control in its row
    pressLabelled(rt, 'Take it out now');
    rt.tick(5000);
    expect(texts(rt)).toContain('5:58 left');
    expect(find(rt.view(), (n) => n.p.control === 'clock').length).toBe(1);
    // starting over goes back to the start and runs again (reset, then play)
    pressLabelled(rt, 'Start over');
    expect(texts(rt)).toContain('6:00 left');
    rt.tick(1000);
    expect(texts(rt)).toContain('5:59 left');
  });
});

/** The red of a fallback PNG's pixel at (i, j): rows are filter 0, RGBA. */
function redAt(uri: string, i: number, j: number): number {
  const png = Buffer.from(uri.split(',')[1], 'base64');
  const w = png.readUInt32BE(16);
  const idat: Buffer[] = [];
  for (let o = 8; o < png.length; ) {
    const len = png.readUInt32BE(o);
    if (png.toString('latin1', o + 4, o + 8) === 'IDAT') idat.push(png.subarray(o + 8, o + 8 + len));
    o += 12 + len;
  }
  return inflateSync(Buffer.concat(idat))[j * (w * 4 + 1) + 1 + i * 4];
}

describe('runtime: a pixels layer without a GPU', () => {
  it("samples its fallback image over the canvas's ranges, not -1..1", () => {
    const text = ['```mkp', 'ramp "Red rising with x."', '  requires gfx@1', '  canvas x=2..4 y=0..1 size=s label="a ramp"', '    layer', '      pixels (rgb(x / 4, 0, 0)) res=32', '  project md = "A ramp."', '```', '', '```ramp', 'summary: A ramp.', '```', ''].join('\n');
    const c = compile({ packs: [] });
    const b = c.document(text, 'ramp.mkp.md');
    expect(c.diags.errors.map(formatDiagnostic)).toEqual([]);
    const shapes = find(new Runtime(b!, { now: () => 0, capabilities: ['core@1'] }).view(), (n) => n.t === 'canvas')[0].layers!.flatMap((l) => l.shapes);
    const px = shapes.find((s) => s.t === 'pixels') as { fallback?: string };
    // x runs 2..4, so red runs from a half to all of it (over -1..1 it would start at none)
    expect(redAt(px.fallback!, 0, 0)).toBeGreaterThan(120);
    expect(redAt(px.fallback!, 95, 0)).toBeGreaterThan(250);
  });
});
