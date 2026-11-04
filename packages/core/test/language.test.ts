// The language, evaluator, runtime interface and safety rules, case by case.
import { describe, expect, it } from 'vitest';
import { strToU8, zipSync } from 'fflate';
import { compile, type PackSource } from '../src/build';
import { formatDiagnostic } from '../src/diag';
import { Runtime } from '../src/runtime/runtime';
import { readZip, sanitizeSvg, writeZip } from '../src/pack';
import { Diagnostics } from '../src/diag';
import { rand, fmtNum } from '../src/eval';
import { allPacks } from './helpers';

const enc = new TextEncoder();
function pack(name: string, files: Record<string, string>, extra = ''): PackSource {
  const m = new Map<string, Uint8Array>([['manifest.mkp', enc.encode(`pack ${name}@1 "test"\n  requires core@1\n${extra}`)]]);
  for (const [k, v] of Object.entries(files)) m.set(k, enc.encode(v));
  return { label: name, files: m };
}

/** Compiles one definition (in a pack that provides it) and a document using it. */
function build(src: string, doc: string, opts: { packs?: PackSource[]; provides?: string } = {}) {
  const names = [...src.matchAll(/^(?:part |extern )?([A-Za-z_][\w.-]*)@\d+/gm)].map((m) => m[1]);
  const p = pack('t', { 't.mkp': src }, `  provides ${opts.provides ?? names.join(' ')}\n`);
  const c = compile({ packs: [...(opts.packs ?? []), p] });
  const b = c.document(doc, 'doc.mkp.md');
  return { c, b, errors: c.diags.errors.map((d) => d.code), all: c.diags.errors.map(formatDiagnostic) };
}

function evalIn(expr: string, extra = '', packs: PackSource[] = []): unknown {
  const { b, all } = build(`w@1 "w"\n${extra}  r = ${expr}\n  text "\\val{r}"\n`, '```w\nsummary: s\n```\n', { packs });
  expect(all).toEqual([]);
  const rt = new Runtime(b!);
  rt.view();
  return rt.blocks()[0].get('r');
}

describe('errors (6.19)', () => {
  it('have the file, line:column, code, a fix and the element path', () => {
    const { all } = build('w@1 "w"\n  stack\n    canvas x=-1..1 y=-1..1\n      layer\n        circle (0, 0) 1 colour=ink\n', '');
    expect(all[0]).toMatch(/^t\/t\.mkp:5:25 error mkp\.unknown-prop: circle record has no prop "colour"/);
    expect(all[0]).toMatch(/w@1 › stack › canvas › layer › circle$/);
  });
  it('report tabs, bad indentation and unclosed brackets', () => {
    expect(build('w@1 "w"\n\ttext "a"\n', '').errors).toContain('mkp.tab');
    expect(build('w@1 "w"\n      text "a"\n', '').errors).toContain('mkp.indent');
    expect(build('w@1 "w"\n  r = (1 + 2\n', '').errors).toContain('mkp.unclosed-bracket');
  });
  it('catch unknown names with a suggestion, and type errors', () => {
    const r = build('w@1 "w"\n  in count int = 2\n  r = cuont + 1\n', '');
    expect(r.all[0]).toMatch(/"cuont" is not defined here \(did you mean "count"\?\)/);
    expect(build('w@1 "w"\n  r = 1 + true\n', '').errors).toContain('mkp.no-operator');
    expect(build('w@1 "w"\n  r = |1|\n', '').all.join()).toMatch(/write abs\(x\)/);
  });
  it('check documents against inputs, and the YAML maths guard', () => {
    const src = 'w@1 "w"\n  in n int 2..12 = 5\n  in f latex = $x$\n  text "\\val{n}"\n';
    expect(build(src, '```w\nn: 40\nsummary: s\n```\n').errors).toContain('mkp.input-range');
    expect(build(src, '```w\nn: 4\n```\n').errors).toContain('mkp.missing-summary');
    expect(build(src, '```w\nm: 4\nsummary: s\n```\n').errors).toContain('mkp.unknown-prop');
    expect(build(src, '```w\nf: "\\theta"\nsummary: s\n```\n').errors).toContain('mkp.yaml-control-char');
    expect(build(src, "```w\nf: '\\theta'\nsummary: s\n```\n").errors).toEqual([]);
  });
  it('reject static ids that do not exist, and duplicates', () => {
    expect(build('w@1 "w"\n  press\n    text "x"\n    @click reveal nope\n', '').errors).toContain('mkp.unknown-id');
    expect(build('w@1 "w"\n  text "a" id=x\n  text "b" id=x\n', '').errors).toContain('mkp.duplicate-id');
  });
  it('enforce source limits', () => {
    const deep = 'w@1 "w"\n' + Array.from({ length: 14 }, (_, i) => '  '.repeat(i + 1) + 'stack').join('\n') + '\n';
    expect(build(deep, '').errors).toContain('mkp.limit');
    const wide = 'w@1 "w"\n  stack\n' + Array.from({ length: 33 }, () => '    text "x"').join('\n') + '\n';
    expect(build(wide, '').errors).toContain('mkp.limit');
    expect(build('w@1 "w"\n  budget 30000000\n  text "x"\n', '').errors).toContain('mkp.limit');
  });
});

describe('expressions (6.7)', () => {
  it('follow the precedence table', () => {
    expect(evalIn('2^3^2')).toBe(512);
    expect(evalIn('-2^2')).toBe(-4);
    expect(evalIn('8/2 2')).toBe(2);
    expect(evalIn('1/2 4')).toBe(0.125);
    expect(evalIn('2 + 3 * 4')).toBe(14);
    expect(evalIn('2^-1')).toBe(0.5);
    expect(evalIn('not 1 > 2 and 2 >= 2 or false')).toBe(true);
  });
  it('are lazy in if, and, or', () => {
    expect(evalIn('if(true, 1, [1][5])')).toBe(1);
    expect(evalIn('false and [1][5] == 1')).toBe(false);
    expect(evalIn('true or [1][5] == 1')).toBe(true);
  });
  it('give inf and nan, and show them as ∞ and —', () => {
    expect(evalIn('1/0')).toBe(Infinity);
    expect(Number.isNaN(evalIn('sqrt(-1)'))).toBe(true);
    expect(fmtNum(Infinity)).toBe('∞');
    expect(fmtNum(NaN)).toBe('—');
    expect(fmtNum(3.14159265)).toBe('3.142');
    expect(fmtNum(123456)).toBe('123500');
  });
  it('have lists, dicts and records', () => {
    expect(evalIn('sum(map(range(1, 4), k => k^2))')).toBe(30);
    expect(evalIn('sum(1, 4, k => k)')).toBe(10);
    expect(evalIn('fold([1, 2, 3], 0, (a, x) => a + x)')).toBe(6);
    expect(evalIn('sort([3, 1, 2], x => -x)')).toEqual([3, 2, 1]);
    expect(evalIn('get(put({}, "a", 1), "b", 7)')).toBe(7);
    expect(evalIn('keys(group(["ab", "ac", "b"], s => len([s])))')).toEqual(['1']);
    expect(evalIn('indexof([5, 6], 9)')).toBe(-1);
    expect(evalIn('at([1, 2], 9, 0)')).toBe(0);
    expect(evalIn('join(map([1, 2.5], x => format(x, 1)), "; ")')).toBe('1.0; 2.5');
    expect(evalIn('iterate(1, 10, x => x 2)')).toBe(1024);
    expect(evalIn('scan(1, 3, x => x + 1)')).toEqual([1, 2, 3, 4]);
    expect(evalIn('{a: 1, b: "x"}.b')).toBe('x');
    expect(evalIn('(1, 2).y')).toBe(2);
  });
  it('make a missing key or index a runtime error caught by the error boundary', () => {
    const { b } = build('w@1 "w"\n  r = [1, 2][5]\n  text "\\val{r}"\n', '```w\nsummary: The summary.\n```\n');
    const signals: unknown[] = [];
    const rt = new Runtime(b!, { onSignal: (e) => signals.push(e) });
    const v = rt.view();
    expect(JSON.stringify(v)).toContain('"t":"error"');
    expect(JSON.stringify(v)).toContain('The summary.');
    expect(signals).toMatchObject([{ name: 'error', payload: { code: 'mkp.index' } }]);
  });
  it('dispatch on declared types with one from promotion, and convert to point', () => {
    const packs = allPacks().filter((p) => p.label.includes('mkp-math') || p.label.includes('mkp-ui'));
    const z = evalIn('exp(2 pi i 1/4)', '', packs) as { re: number; im: number };
    expect(z.re).toBeCloseTo(0, 12);
    expect(z.im).toBeCloseTo(1, 12);
    expect(evalIn('1 + 0.5i', '', packs)).toEqual({ re: 1, im: 0.5 });
  });
  it('specialise untyped fns per call, and cap recursion', () => {
    expect(evalIn('twice(3)', '  fn twice(x) = x 2\n')).toBe(6);
    expect(evalIn('twice("a")', '  fn twice(x) = x + x\n')).toBe('aa');
    const { b } = build('w@1 "w"\n  fn f(n: num): num = if(n <= 0, 0, 1 + f(n - 1))\n  r = f(100)\n  text "\\val{r}"\n', '```w\nsummary: s\n```\n');
    expect(JSON.stringify(new Runtime(b!).view())).toContain('mkp.depth');
  });
  it('run out of budget as a runtime error', () => {
    const { b } = build('w@1 "w"\n  r = sum(map(range(1, 9000), k => sum(map(range(1, 200), j => j))))\n  text "\\val{r}"\n', '```w\nsummary: s\n```\n');
    expect(JSON.stringify(new Runtime(b!).view())).toContain('mkp.budget');
    const ok = build('w@1 "w"\n  budget 20000000\n  r = sum(map(range(1, 9000), k => sum(map(range(1, 200), j => j))))\n  text "\\val{r}"\n', '```w\nsummary: s\n```\n');
    expect(JSON.stringify(new Runtime(ok.b!).view())).not.toContain('"t":"error"');
  });
  it('are deterministic in rand and answer-checking', () => {
    expect(rand(1, 2)).toBe(rand(1, 2));
    expect(rand(1, 2)).not.toBe(rand(1, 3));
    expect(evalIn('equivalent("2(x+1)", "2x + 2", ["x"])')).toBe(true);
    expect(evalIn('equivalent("x^2", "2x", ["x"])')).toBe(false);
    expect(evalIn('parse("1/2", [])()')).toBe(0.5);
    expect(Number.isNaN(evalIn('parse("1/", [])()'))).toBe(true);
  });
});

describe('safety (17)', () => {
  it('treats __proto__ and constructor as plain data', () => {
    expect(evalIn('get(put({}, "__proto__", 1), "__proto__", 0)')).toBe(1);
    expect(evalIn('get({}, "constructor", 5)')).toBe(5);
    expect(evalIn('has({}, "toString")')).toBe(false);
    const { b } = build('w@1 "w"\n  in d dict(num) = {}\n  r = d["constructor"]\n  text "\\val{r}"\n', '```w\nsummary: s\n```\n');
    expect(JSON.stringify(new Runtime(b!).view())).toContain('mkp.missing-key');
  });
  it('rejects zip-slip, symlinks, oversize files and unknown file types in packs', () => {
    const d = new Diagnostics();
    const z = zipSync({ 'manifest.mkp': strToU8('pack x@1 "x"\n'), '../evil.mkp': strToU8('x') });
    expect(readZip(z, 'x.mkpack', d)).toBeNull();
    expect(d.errors.map((e) => e.code)).toContain('mkp.pack-path');
    const d2 = new Diagnostics();
    const big = zipSync({ 'manifest.mkp': strToU8('pack x@1 "x"\n'), 'a.png': new Uint8Array(11 * 1024 * 1024) });
    expect(readZip(big, 'x.mkpack', d2)).toBeNull();
    expect(d2.errors.map((e) => e.code)).toContain('mkp.pack-size');
    const files = new Map([['manifest.mkp', strToU8('pack y@1 "y"\n  requires core@1\n')], ['run.js', strToU8('alert(1)')]]);
    const c = compile({ packs: [{ label: 'y.mkpack', zip: writeZip(files) }] });
    expect(c.diags.errors.map((e) => e.code)).toContain('mkp.pack-file-type');
  });
  it('sanitises SVG assets', () => {
    const s = sanitizeSvg('<svg xmlns="http://www.w3.org/2000/svg" onload="x()"><script>alert(1)</script><a href="https://evil"><rect width="1" height="1" onclick="y()"/></a><image href="data:x"/></svg>')!;
    expect(s).not.toMatch(/script|onload|onclick|evil|data:x/);
    expect(sanitizeSvg('<!DOCTYPE svg [<!ENTITY x "y">]><svg/>')).toBeNull();
  });
  it('caps each items and lists', () => {
    const { b } = build('w@1 "w"\n  in n int = 300\n  each k in 1..n\n    text "\\val{k}"\n', '```w\nsummary: s\n```\n');
    expect(JSON.stringify(new Runtime(b!).view())).toContain('mkp.each');
    expect(JSON.stringify(new Runtime(build('w@1 "w"\n  r = len(range(1, 20000))\n  text "\\val{r}"\n', '```w\nsummary: s\n```\n').b!).view())).toContain('mkp.list-size');
  });
});

describe('the host interface (15.1–15.3)', () => {
  const src = `live@1 "Readings the host streams in."
  var points list({t: num, v: num}) = []
  host seed int = 0 "per-reader seed"
  command push {t: num, v: num} "add one reading"
    set points=last(points + [{t: t, v: v}], 3)
  command clear "start over"
    set points=[]
  signal picked {t: num} "the reader picked a point"
  n = len(points)
  text "\\val{n} readings, seed \\val{seed}"
  press id=pick
    text "pick"
    @click send picked t=1.5
`;
  it('takes commands, host inputs, and sends signals', () => {
    const { b, all } = build(src, '```live\nsummary: s\n```\n');
    expect(all).toEqual([]);
    expect(b!.interface.commands.map((c) => c.name)).toEqual(['push', 'clear']);
    expect(b!.interface.hosts.map((h) => h.name)).toEqual(['seed']);
    expect(b!.interface.signals.map((s) => s.name)).toEqual(['picked']);
    const got: unknown[] = [];
    const rt = new Runtime(b!, { hosts: { '0': { seed: 42 } }, now: () => 7 });
    rt.view();
    const w = rt.widget(0);
    w.on('picked', (p) => got.push(p));
    for (let k = 0; k < 5; k++) w.command('push', { t: k, v: k * k });
    expect(w.state().n).toBe(3);
    expect(() => w.command('push', { t: 'x', v: 1 })).toThrow(/expected a number/);
    expect(() => w.command('nope')).toThrow(/declares no command/);
    w.command('clear');
    expect(w.state().n).toBe(0);
    expect(w.state().seed).toBe(42);
    rt.press('pick');
    expect(got).toEqual([{ t: 1.5 }]);
    expect(build(src.replace('signal picked', 'signal error'), '').errors).toContain('mkp.reserved');
  });
});

describe('document state (6.23) and profiles (16)', () => {
  it('shares one control between widget blocks', () => {
    const src = 'show@1 "s"\n  in t ref num\n  text "\\val{t}"\n';
    const doc = '```state\nt = slider 0..1 step=0.5 "turn"\n```\n\n```show\nt: {ref: t}\nsummary: a\n```\n\n```show\nt: {ref: t}\nsummary: b\n```\n';
    const { b, all } = build(src, doc);
    expect(all).toEqual([]);
    const rt = new Runtime(b!);
    rt.set({ t: 0.5 });
    expect(JSON.stringify(rt.view()).match(/0\.5/g)!.length).toBeGreaterThanOrEqual(2);
  });
  it('checks front matter, roles and rules from a profile', () => {
    const prof: PackSource = {
      label: 'course',
      files: new Map([['manifest.mkp', enc.encode('profile course@1 "A course profile."\n  requires core@1\n  front title text\n  front scope choice(topic|chapter) = topic\n  front sources list(text)\n  roles introduction example practice\n  rule required front.sources "cite at least one source"\n  rule max-length front.title 30 "keep titles short"\n  rule count roles.example 1..3 "one to three examples"\n')]]),
    };
    const c = compile({ packs: [prof], profile: 'course' });
    const ok = c.document('---\ntitle: Limits\nsources: [a]\n---\n# Limits\n\n## An example\n{role=example}\n', 'a.mkp.md');
    expect(c.diags.errors.map(formatDiagnostic)).toEqual([]);
    expect(ok!.doc.front.scope).toBe('topic');
    const d = new Diagnostics();
    c.document('---\ntitle: A very long title that goes on and on\nsources: []\n---\n# x\n', 'b.mkp.md', d);
    expect(d.errors.map((e) => e.code).sort()).toEqual(['mkp.rule.count', 'mkp.rule.max-length', 'mkp.rule.required']);
  });
});

describe('versions and the lock (6.17)', () => {
  it('records versions and refuses a changed published definition', () => {
    const v1 = build('w@1 "w"\n  text "one"\n', '```w\nsummary: s\n```\n');
    const lock = v1.c.lock;
    expect(lock.defs['t:w@1']).toMatch(/^sha256:/);
    const p = pack('t', { 't.mkp': 'w@1 "w"\n  text "two"\n' }, '  provides w\n');
    const c2 = compile({ packs: [p], lock });
    expect(c2.diags.errors.map((e) => e.code)).toContain('mkp.version-changed');
    const p3 = pack('t', { 't.mkp': 'w@1 "w"\n  text "one"\nw@2 "w"\n  text "two"\n' }, '  provides w\n');
    const c3 = compile({ packs: [p3], lock });
    const b3 = c3.document('```w\nsummary: s\n```\n', 'd.mkp.md');
    expect(Object.keys(b3!.defs)).toContain('t:w@1');
    const c4 = compile({ packs: [p3] });
    expect(Object.keys(c4.document('```w\nsummary: s\n```\n', 'd.mkp.md')!.defs)).toContain('t:w@2');
  });
});
