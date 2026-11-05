// The redesign's language (plan doc #1129 §3): a document's own definitions, no shadowing, typed
// fns, interfaces, type parameters and typed paths, answers, the containers and width.
import { describe, expect, it } from 'vitest';
import { compile, type PackSource } from '../src/build';
import { formatDiagnostic } from '../src/diag';
import { Runtime } from '../src/runtime/runtime';
import { walk, type VNode } from '../src/runtime/view';

const enc = new TextEncoder();
function pack(name: string, files: Record<string, string>, manifest = ''): PackSource {
  const m = new Map<string, Uint8Array>([['manifest.mkp', enc.encode(`pack ${name}@1 "test"\n  requires core@1\n${manifest}`)]]);
  for (const [k, v] of Object.entries(files)) m.set(k, enc.encode(v));
  return { label: name, files: m };
}

function doc(text: string, opts: { packs?: PackSource[]; docFile?: { text: string; file: string } } = {}) {
  const c = compile({ packs: opts.packs ?? [] });
  const b = c.document(text, 'doc.mkp.md', undefined, { docFile: opts.docFile });
  return { c, b, errors: c.diags.errors.map((d) => d.code), all: c.diags.errors.map(formatDiagnostic) };
}

function texts(nodes: VNode[]): string[] {
  const out: string[] = [];
  walk(nodes, (n) => {
    if (n.t === 'text') out.push((n.p.runs as { v?: string }[]).map((r) => r.v ?? '').join(''));
  });
  return out;
}

const fence = (body: string): string => '```mkp\n' + body + '\n```\n';
const block = (name: string, yaml: string): string => '```' + name + '\n' + yaml + '\n```\n';

const greeting = ['greeting "A line of welcome with a name in it."', '  in name text = "world" "who to greet"', '  text "Hello, **\\val{name}**!"', '  project md = "Hello, **" + name + "**!"'].join('\n');

describe('a document defines its own widgets (6.25)', () => {
  it('in an mkp fence, without @N, used before or after it', () => {
    const r = doc(block('greeting', 'name: reader\nsummary: A greeting.') + '\n' + fence(greeting));
    expect(r.all).toEqual([]);
    expect(Object.keys(r.b!.defs)).toContain('$doc:greeting@1');
    expect(r.b!.defs['$doc:greeting@1'].inline).toBe(true);
    const rt = new Runtime(r.b!);
    expect(texts(rt.view())).toEqual(['Hello, **reader**!'.replace(/\*\*/g, '')].map(() => expect.stringContaining('reader')));
  });

  it('in the document file beside it', () => {
    const r = doc(block('greeting', 'summary: A greeting.'), { docFile: { text: greeting + '\n', file: 'doc.mkp' } });
    expect(r.all).toEqual([]);
    expect(Object.keys(r.b!.defs)).toContain('$doc:greeting@1');
  });

  it('report errors at the document line inside the fence', () => {
    const r = doc('# Title\n\n' + fence('w "w"\n  text colour\n  project md = "w"') + block('w', 'summary: s'));
    expect(r.all[0]).toMatch(/^doc\.mkp\.md:5:/);
  });

  it('need a project md, and no name a pack or core already gives', () => {
    expect(doc(fence('w "w"\n  text "x"') + block('w', 'summary: s')).errors).toContain('mkp.no-project');
    expect(doc(fence('column "mine"\n  text "x"\n  project md = "x"')).errors).toContain('mkp.shadow');
    const p = pack('lib', { 'w.mkp': 'tally@1 "t"\n  text "t"\n' }, '  provides tally\n');
    expect(doc(fence('tally "mine"\n  text "x"\n  project md = "x"'), { packs: [p] }).errors).toContain('mkp.shadow');
  });

  it('never reach another document built with the same packs', () => {
    const c = compile({ packs: [] });
    expect(c.document(fence(greeting) + block('greeting', 'summary: s'), 'a.mkp.md')).not.toBeNull();
    expect(c.document(block('greeting', 'summary: s'), 'b.mkp.md')).toBeNull();
    expect(c.diags.errors.map((d) => d.code)).toContain('mkp.unknown-widget');
  });

  it('may not declare externs, tokens or interfaces', () => {
    expect(doc(fence('extern x@1 "x"')).errors).toContain('mkp.syntax');
    expect(doc(fence('tokens t@1 "t"\n  color ink "#000000"')).errors).toContain('mkp.doc-item');
  });
});

describe('static types and nothing silent (6.5, GAPS 42, 43)', () => {
  const def = (body: string) => doc(fence(`w "w"\n${body}\n  project md = "w"`) + block('w', 'summary: s'));
  it('a fn types its parameters and result', () => {
    expect(def('  fn twice(x) = 2 x\n  text "a"').errors).toContain('mkp.untyped');
    expect(def('  fn twice(x: num) = 2 x\n  text "a"').errors).toContain('mkp.untyped');
    expect(def('  fn twice(x: num): num = 2 x\n  text "\\val{twice(2)}"').errors).toEqual([]);
  });
  it('a name may not hide a colour token, an option or a global', () => {
    expect(def('  in good bool = true\n  ok = good\n  text "a"').all[0]).toMatch(/mkp\.shadow: "ok" is a colour token/);
    expect(def('  in mode choice(play|stop) = play\n  play = 1\n  text "a"').errors).toContain('mkp.shadow');
    expect(def('  width = 3\n  text "a"').errors).toContain('mkp.shadow');
    // space and size words stay free
    expect(def('  s = 3\n  text "\\val{s}"').errors).toEqual([]);
  });
  it('text built-ins, and at() that never wraps', () => {
    const r = def('  t = trim("  Oslo  ")\n  n = number("2,5")\n  u = upper(slice(t, 0, 2))\n  z = at([1, 2], -1, 9)\n  l = last([1, 2])\n  i = indexof(t, "lo")\n  text "\\val{u} \\val{n} \\val{z} \\val{l} \\val{i}"');
    expect(r.all).toEqual([]);
    expect(texts(new Runtime(r.b!).view())).toEqual(['OS 2.5 9 2 2']);
  });
  it('types flow where they are plain: lists of ints and nums, if branches, call arguments, options', () => {
    // [0] + nums is a list of nums
    const r1 = def('  xs = [1.5, 2.5]\n  m = max([0] + map(xs, x => x / 2))\n  text "\\val{m}"');
    expect(r1.all).toEqual([]);
    expect(texts(new Runtime(r1.b!).view())).toEqual(['1.25']);
    // a colour token takes its type from the other branch, and from a function's parameter
    expect(def('  in t color = none\n  hue = if(t == none, muted, t)\n  text "a" tone=hue').all).toEqual([]);
    expect(def('  fn pick(t: color): color = t\n  text "a" tone=(pick(muted))').all).toEqual([]);
    // a line indented under a value or a projection is an error, never dropped (GAPS 136)
    expect(def('  v = "one"\n    + " two"\n  text (v)').errors).toEqual(['mkp.continuation']);
    expect(doc(fence('w "w"\n  text "a"\n  project md = "one"\n    + " two"') + block('w', 'summary: s')).errors).toEqual(['mkp.continuation']);
    // an option word is the option where a choice is expected, whatever else has that name
    expect(def('  plain = "x"\n  press kind=plain\n    text (plain)').all).toEqual([]);
  });
  it('a named type fills the fields a literal leaves out', () => {
    const r = doc(fence('type item = {label: text, tone: color = muted}\nw "w"\n  xs = [{label: "a"} : item]\n  text "a"\n  project md = "w"'));
    // the cast syntax isn't the language: a literal is typed by where it goes
    expect(r.errors).toContain('mkp.syntax');
    const r2 = doc(fence('type item = {label: text, tone: color = muted}\nfn one(l: text): item = {label: l}\nw "w"\n  x = one("a")\n  text x.label tone=(x.tone)\n  project md = "w"') + block('w', 'summary: s'));
    expect(r2.all).toEqual([]);
    // from YAML too, a default written as an expression: a point
    const r3 = doc(fence('type spot = {id: text, at: point = (1, 2)}\nw "w"\n  in items list(spot)\n  text "\\val{items[0].at.y}"\n  project md = "w"') + block('w', 'items:\n  - {id: b}\nsummary: s'));
    expect(r3.all).toEqual([]);
    expect(texts(new Runtime(r3.b!).view())).toEqual(['2']);
  });
});

describe('containers (8)', () => {
  it('grid columns are tracks, or a number of equal ones', () => {
    const r = doc(fence('w "w"\n  grid cols=[auto, 1fr, 6ch]\n    text "a"\n  grid cols=3\n    text "b"\n  project md = "w"') + block('w', 'summary: s'));
    expect(r.all).toEqual([]);
    const grids: VNode[] = [];
    walk(new Runtime(r.b!).view(), (n) => n.t === 'grid' && grids.push(n));
    expect(grids.map((g) => g.p.cols)).toEqual([['auto', '1fr', '6ch'], ['1fr', '1fr', '1fr']]);
    expect(doc(fence('w "w"\n  grid cols=[auto, wide]\n    text "a"\n  project md = "w"')).errors).toContain('mkp.input-type');    // worked out: a list of track words
    const r2 = doc(fence('w "w"\n  fn autos(n: int): list(track) = map(range(1, n), k => "auto")\n  grid cols=(autos(2))\n    text "a"\n  project md = "w"') + block('w', 'summary: s'));
    expect(r2.all).toEqual([]);
    const g2: VNode[] = [];
    walk(new Runtime(r2.b!).view(), (n) => n.t === 'grid' && g2.push(n));
    expect(g2[0].p.cols).toEqual(['auto', 'auto']);
  });
  it('an icon named none draws nothing', () => {
    const r = doc(fence('w "w"\n  in i iconname = none\n  row\n    icon name=i\n    icon name=star\n  project md = "w"') + block('w', 'summary: s'));
    expect(r.all).toEqual([]);
    const icons: VNode[] = [];
    walk(new Runtime(r.b!).view(), (n) => n.t === 'icon' && icons.push(n));
    expect(icons.map((n) => n.p.name)).toEqual(['star']);
  });
  it('a child says how it sits across its container', () => {
    const r = doc(fence('w "w"\n  row\n    text "a" self=end\n  project md = "w"') + block('w', 'summary: s'));
    expect(r.all).toEqual([]);
    const t: VNode[] = [];
    walk(new Runtime(r.b!).view(), (n) => n.t === 'text' && t.push(n));
    expect(t[0].layout).toEqual({ self: 'end' });
  });
  it('width is the reader’s, and follows the provider', () => {
    const r = doc(fence('w "w"\n  text "\\val{width}"\n  column if=(width == narrow)\n    text "phone"\n  project md = "w"') + block('w', 'summary: s'));
    expect(r.all).toEqual([]);
    const rt = new Runtime(r.b!);
    expect(texts(rt.view())).toEqual(['wide']);
    rt.setWidth('narrow');
    expect(texts(rt.view())).toEqual(['narrow', 'phone']);
  });
  it('a snapshot (the Markdown) draws the branch for its width only', () => {
    // the narrow branch would fail (a key twice): the wide snapshot never draws it
    const r = doc(fence('w "w"\n  switch on=(if(width == narrow, "a", "b"))\n    case "a"\n      each x in [1, 1] key=x\n        text "x"\n    case "b"\n      text "wide"\n  project md = "w"') + block('w', 'summary: s'));
    expect(r.all).toEqual([]);
    const rt = new Runtime(r.b!, { snapshot: true });
    expect(texts(rt.view())).toEqual(['wide']);
    expect(rt.warnings).toEqual([]);
  });
});

describe('a bundle is the same wherever its packs were read from', () => {
  it("records a pack file as the pack's name and its path in the pack", () => {
    const lib = (label: string) => ({ ...pack('lib', { 'w.mkp': 'fn hi(n: text): text = "hi " + n\nw@1 "w"\n  text (hi("a"))\n  project md = "w"', 'w.fixture.json': JSON.stringify({ widget: 'w@1', cases: { one: { props: {}, summary: 's' } } }) }, '  provides w\n'), label });
    const built = ['../../home/someone/repo/packs/lib', 'packs/lib'].map((label) => doc(block('w', 'summary: s'), { packs: [lib(label)] }).b!);
    expect(built.map((b) => b.defs['lib:w@1'].file)).toEqual(['lib/w.mkp', 'lib/w.mkp']);
    // and so does a function the definition calls
    expect(built.map((b) => Object.values(b.fns).map((f) => f.file))).toEqual([['lib/w.mkp'], ['lib/w.mkp']]);
  });
});

describe('interfaces (6.24)', () => {
  const host = pack('host', { 'scored.mkp': 'interface scored@1 "A widget whose score a host can add up."\n  in of int\n  signal scored {got: int}\n  project md\n' }, '  provides scored\n');
  const stars = (signal: string) =>
    fence(['stars "Rate it."', '  implements scored@1', '  in of int = 5', signal, '  var got int = 0', '  row', '    each k in 1..of', '      press label=(format(k, 0))', '        icon name=star', `        @click set got=k${signal ? ' send scored got=k' : ''}`, '  project md = format(got, 0) + " stars"'].join('\n')) + block('stars', 'summary: A rating.');
  it('a widget that has what the interface asks for implements it, and the block says so', () => {
    const r = doc(stars('  signal scored {got: int} "on a rating"'), { packs: [host] });
    expect(r.all).toEqual([]);
    expect(r.b!.interface.implements).toEqual([{ def: '$doc:stars@1', iface: 'host:scored@1' }]);
    expect(r.b!.doc.body[0].meta?.implements).toEqual(['host:scored@1']);
  });
  it('one that lacks a part of it is a compile error, naming what is missing', () => {
    const r = doc(stars(''), { packs: [host] });
    expect(r.all.join('\n')).toMatch(/mkp\.interface: stars implements scored@1 but has no signal scored \{got: int\}/);
  });
  it('a block finds the interfaces of what it holds, at any depth', () => {
    const r = doc(
      stars('  signal scored {got: int} "on a rating"').replace(/```stars[\s\S]*$/, '') +
        fence('pair "Two ratings."\n  column\n    stars\n    stars\n  project md = "two"') +
        block('pair', 'summary: Two ratings.'),
      { packs: [host] },
    );
    expect(r.all).toEqual([]);
    expect(r.b!.doc.body[0].meta?.within).toEqual(['host:scored@1']);
  });
});

describe('type parameters and typed paths (6.26)', () => {
  const picklist = [
    'picklist of T "Records the reader steps through, showing two of their fields."',
    '  in items list(T) "the records"',
    '  in title path(T, text) "the field shown in bold"',
    '  in note path(T, text) "the field shown under it"',
    '  at = steps (len(items)) "item"',
    '  column gap=s',
    '    each k in 0..(len(items) - 1) key=k',
    '      column stroke=(if(k == at, accent, line))',
    '        text (items[k][title]) weight=bold',
    '        text (items[k][note]) tone=muted',
    '  project md = join(map(items, it => "- **" + it[title] + "**: " + it[note]), "\\n")',
  ].join('\n');
  const yaml = (title: string) => `items:\n  - {city: Lisbon, fact: Built on seven hills.}\n  - {city: Oslo, fact: Has a ski jump.}\ntitle: ${title}\nnote: fact\nsummary: Two cities.`;
  it('take their type from the YAML, and paths read it', () => {
    const r = doc(fence(picklist) + block('picklist', yaml('city')));
    expect(r.all).toEqual([]);
    expect(texts(new Runtime(r.b!).view()).slice(0, 4)).toEqual(['Lisbon', 'Built on seven hills.', 'Oslo', 'Has a ski jump.']);
  });
  it('a path to a field the items lack fails at its own line', () => {
    const r = doc(fence(picklist) + block('picklist', yaml('population')));
    expect(r.all[0]).toMatch(/doc\.mkp\.md:\d+:\d+ error mkp\.unknown-field: "population" isn't a field of the items \(they have city, fact\)/);
  });
  it("a path to a pack's own record type takes YAML records of its shape (walk's entry)", () => {
    const lib = pack('lib', {
      'pairs.mkp': ['type entry = {name: text, value: text}', 'pairs@1 of S "Each step\'s name/value pairs."', '  in steps list(S)', '  in values path(S, list(entry))', '  column', '    each e in steps[0][values] key=e.name', '      text (e.name + " = " + e.value)', '  project md = "pairs"'].join('\n'),
      'pairs.fixture.json': JSON.stringify({ widget: 'pairs@1', cases: { one: { props: { steps: [{ vars: [{ name: 'x', value: '1' }] }], values: 'vars' }, summary: 's' } } }),
    }, '  provides pairs\n');
    const r = doc(block('pairs', 'steps:\n  - {vars: [{name: x, value: "1"}]}\nvalues: vars\nsummary: s'), { packs: [lib] });
    expect(r.all).toEqual([]);
    expect(texts(new Runtime(r.b!).view())).toEqual(['x = 1']);
  });
  it('items of different shapes fail', () => {
    const r = doc(fence(picklist) + block('picklist', 'items:\n  - {city: Lisbon, fact: Hills.}\n  - {city: Oslo}\ntitle: city\nnote: fact\nsummary: s'));
    expect(r.errors).toContain('mkp.input-type');
  });
});

describe('answers (6.27, GAPS 166)', () => {
  const ask = (md: string) => fence(['ask "A one-word question."', '  in prompt text', '  in accept list(text) answer "what counts as right"', '  text prompt', `  project md = ${md}`].join('\n')) + block('ask', 'prompt: Capital of Norway?\naccept: [Oslo]\nsummary: s');
  it('project md may show an answer only inside if(answers, …)', () => {
    expect(doc(ask('prompt + join(accept, ", ")')).errors).toContain('mkp.answer-leak');
    const r = doc(ask('prompt + if(answers, " (" + join(accept, " or ") + ")", "")'));
    expect(r.all).toEqual([]);
    expect(r.b!.defs['$doc:ask@1'].inputs.find((i) => i.name === 'accept')?.answer).toBe(true);
  });
});

describe('events, controls and time (6.11, 6.12)', () => {
  const def = (body: string) => doc(fence(`w "w"\n${body}\n  project md = "w"`) + block('w', 'summary: s'));
  it('if= on an event line guards that line, and lines run in order', () => {
    const r = def('  var n int = 0\n  var log text = ""\n  press id=go\n    text "go"\n    @click set n=(n + 1)\n    @click set log=(log + "even") if=(mod(n, 2) == 0)\n  text "\\val{n} \\val{log}"');
    expect(r.all).toEqual([]);
    const rt = new Runtime(r.b!);
    rt.press('go');
    expect(texts(rt.view())).toContain('1 ');
    rt.press('go');
    expect(texts(rt.view())).toContain('2 even');
  });
  it('a clock counts seconds while it runs, and reset starts it again', () => {
    const r = def('  t = clock "elapsed"\n  text "\\val{floor(t)}"');
    expect(r.all).toEqual([]);
    const rt = new Runtime(r.b!);
    rt.view();
    rt.tick(2500);
    expect(texts(rt.view())).toContain('2');
    rt.press('t.play');
    rt.tick(5000);
    expect(texts(rt.view())).toContain('2');
  });
  it('steps can start at no step, and play a pace per step', () => {
    const r = def('  at = steps 4 none=true play=500ms/step "step"\n  text "at \\val{at}"');
    expect(r.all).toEqual([]);
    const rt = new Runtime(r.b!);
    expect(texts(rt.view())).toContain('at -1');
    expect(texts(rt.view())).toContain('—/4');
    rt.press('at.play');
    rt.tick(1000);
    expect(texts(rt.view())).toContain('at 1');
  });
});

describe('positions (GAPS 165)', () => {
  it('a wrong value in a YAML list item is reported at that item', () => {
    const src = fence('nums "n"\n  in xs list(int)\n  text "n"\n  project md = "n"') + block('nums', 'xs:\n  - 1\n  - two\n  - 3\nsummary: s');
    const r = doc(src);
    const line = src.split('\n').findIndex((l) => l.includes('- two')) + 1;
    expect(r.all[0]).toMatch(new RegExp(`^doc\\.mkp\\.md:${line}:5 error mkp\\.input-type: xs\\[1\\] is a whole number`));
  });
});

describe('record kinds and optional paths (GAPS 44)', () => {
  it('a record kind is a type a fn can take, and an optional path is ""', () => {
    const src = fence([
      'board of T "Rows of a table, with an optional note column."',
      '  in rows list(T)',
      '  in name path(T, text)',
      '  in note path(T, text) = ""',
      '  in marks list(record mark {at: int, tone: color = accent})',
      '  fn shade(m: mark): color = m.tone',
      '  column',
      '    each k in 0..(len(rows) - 1) key=k',
      '      row',
      '        text (rows[k][name])',
      '        text (rows[k][note]) tone=muted if=(note != "")',
      '    each m in marks key=m.at',
      '      text "mark \\val{m.at}" tone=(shade(m))',
      '  project md = join(map(rows, r => r[name]), ", ")',
    ].join('\n')) + block('board', 'rows:\n  - {city: Oslo, n: 1}\nname: city\nmarks:\n  - {at: 1}\nsummary: s');
    const r = doc(src);
    expect(r.all).toEqual([]);
    expect(texts(new Runtime(r.b!).view())).toEqual(['Oslo', 'mark 1']);
  });
  it('a path to a number where text is needed says to quote the values', () => {
    const src = fence('t of T "t"\n  in rows list(T)\n  in name path(T, text)\n  text "x"\n  project md = "x"') + block('t', 'rows:\n  - {n: 1}\nname: n\nsummary: s');
    expect(doc(src).all[0]).toMatch(/quote the values in the YAML/);
  });
});

describe('profiles: positions and the body’s shape (GAPS 12, 35)', () => {
  const prof = (rules: string): PackSource => {
    const m = new Map<string, Uint8Array>([['manifest.mkp', enc.encode(`profile lesson@1 "a lesson"\n  requires core@1\n  front title text\n  front course text = ""\n${rules}`)]]);
    return { label: 'lesson', files: m };
  };
  const build = (rules: string, text: string) => {
    const c = compile({ packs: [prof(rules)], profile: 'lesson' });
    c.document(text, 'doc.mkp.md');
    return c.diags.errors.map(formatDiagnostic);
  };
  it('a rule on a front-matter field points at that field', () => {
    const all = build('  rule pattern front.course "^[a-z-]+$" "course ids are kebab-case"\n', '---\ntitle: T\ncourse: Not Kebab\n---\n# T\n');
    expect(all[0]).toMatch(/^doc\.mkp\.md:3:1 error mkp\.rule\.pattern: course ids are kebab-case/);
  });
  it('headings at most n deep, and a body that starts with a heading', () => {
    const rules = '  rule depth headings 3 "sections go three deep at most"\n  rule first body heading "a lesson starts with a heading"\n';
    expect(build(rules, '---\ntitle: T\n---\n# T\n\n#### Too deep\n')).toEqual([expect.stringMatching(/^doc\.mkp\.md:6:1 error mkp\.rule\.depth/)]);
    expect(build(rules, '---\ntitle: T\n---\nText first.\n\n# T\n')).toEqual([expect.stringMatching(/^doc\.mkp\.md:4:1 error mkp\.rule\.first/)]);
    expect(build(rules, '---\ntitle: T\n---\n# T\n\n## U\n')).toEqual([]);
  });
});

describe('a slot holds a fragment of a document (GAPS 88)', () => {
  it('with widget blocks in it', () => {
    const src = fence(greeting) + fence('boxed "b"\n  in body slot\n  column\n    slot body') + '````boxed\nbody: |\n  Before.\n\n  ```greeting\n  name: inside\n  summary: s\n  ```\nsummary: s\n````\n';
    const r = doc(src);
    expect(r.all).toEqual([]);
    expect(texts(new Runtime(r.b!).view()).join(' ')).toContain('inside');
  });
});
