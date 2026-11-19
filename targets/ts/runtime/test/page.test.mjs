// A page running on @extended-mark/runtime: mounted, changed only through checked transactions, and
// written back as Markdown (page 6, plan tab 11). Each page is built by the xtmd binary.

import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { Page, Num, layout, place, keepInside, around } from "../dist/index.js";
import { xtmdBinary, workdir, repo as repoRoot } from "./xtmd.mjs";

const dir = workdir();
let n = 0;

/** A document's IR, built by the xtmd binary. */
function page(source, opts = {}) {
  const file = join(dir, `page${n++}.xt.md`);
  writeFileSync(file, source);
  const out = file.replace(/\.xt\.md$/, ".ir.json");
  execFileSync(xtmdBinary(), ["build", file, "--out", out], { stdio: ["ignore", "pipe", "pipe"] });
  return new Page(JSON.parse(readFileSync(out, "utf8")), opts);
}

const num = (s) => ({ num: String(s) });

test("a page mounts: its tree, its $state and its Markdown", () => {
  const p = page('$state {\n    n: int 0..10 = 3;\n}\n@@@\n# Count\n\n@slider(value = $state.n, label = "N");\n');
  const tree = p.observeTree();
  assert.equal(tree.s1.widget, "core/slider");
  assert.deepEqual(tree.s1.props.value, num(3));
  assert.deepEqual(p.observeState(), { n: num(3) });
  assert.equal(p.markdown(), "# Count\n\nN: 3\n");
});

test("a widget's write goes to the caller's variable, checked against its contract", () => {
  const p = page('$state {\n    n: int 0..10 = 3;\n}\n@@@\n@slider(value = $state.n, label = "N");\n');
  p.write("s0", "value", p.value(num(7)));
  assert.deepEqual(p.observeState(), { n: num(7) });
  p.write("s0", "value", p.value(num(12)));
  assert.deepEqual(p.observeState(), { n: num(7) });
  assert.deepEqual(p.takeOutcome().refused, [{ code: "contracts.outside", site: "s0" }]);
  p.write("s0", "value", p.value(num("1.5")));
  assert.deepEqual(p.observeState(), { n: num(7) });
});

test("an app's write to $state is one change, checked once against $state's rules", () => {
  const p = page('$state {\n    low: number = 1;\n    high: number = 5;\n\n    require "low stays at or below high" {\n        return low <= high;\n    }\n}\n@@@\n\\{$state.low} to \\{$state.high}\n');
  p.set({ low: p.value(num(9)) });
  assert.deepEqual(p.takeOutcome().refused, [{ rule: "low stays at or below high" }]);
  assert.deepEqual(p.observeState().low, num(1));
  // both at once is one change, so the rule holds after it
  p.set({ low: p.value(num(9)), high: p.value(num(10)) });
  assert.deepEqual(p.takeOutcome().refused, []);
  assert.equal(p.markdown(), "9 to 10\n");
  // a field that doesn't exist, or a value its type refuses, changes nothing
  p.set({ nope: p.value(num(1)) });
  assert.deepEqual(p.takeOutcome().refused, [{ code: "contracts.outside", site: "$state.nope" }]);
});

test("a handler that fails is undone whole and reported; the page carries on", () => {
  const p = page(
    '$state {\n    tries: int = 0;\n    total: number = 10;\n}\n\nwidget go() {\n    view {\n        @press(label = "Go", click = fn() { $state.tries = $state.tries + 1; $state.total = $state.total / 0; });\n    }\n}\n@@@\n@go;\n',
  );
  p.event("s0/s0", "click");
  assert.deepEqual(p.observeState(), { tries: num(0), total: num(10) });
  assert.deepEqual(p.takeOutcome().failures, [{ code: "failure.number", site: "s0/s0" }]);
});

test("extern channels: the app's fns are reported as calls, its values redraw, and exposed fns run as one change", () => {
  const p = page(
    'extern scores {\n    unit: text = "K";\n    fn saved(total: int);\n}\n\n$state {\n    points: int 0... = 0;\n}\n\nexpose scores {\n    fn clear() {\n        $state.points = 0;\n    }\n}\n\nwidget tally(mut points: int) {\n    view {\n        @press(label = "Add", click = fn() { points = points + 1; scores.saved(points); });\n    }\n    markdown {\n        \\{points} \\{scores.unit}\n    }\n}\n@@@\n@tally(points = $state.points);\n',
  );
  p.event("s0/s0", "click");
  assert.deepEqual(p.takeCalls(), [{ call: { name: "doc/scores.saved", args: [num(1)] } }]);
  assert.equal(p.markdown(), "1 K\n");
  p.setExtern("doc/scores", { unit: p.value({ text: "points" }) });
  assert.equal(p.markdown(), "1 points\n");
  p.expose("doc/scores", "clear");
  assert.deepEqual(p.observeState(), { points: num(0) });
});

test("a loop's rows keep their widgets' variables by item, not by position", () => {
  const p = page(
    'record task {\n    title: text;\n}\n\n$state {\n    tasks: list<task> = [task { title = "a" }, task { title = "b" }];\n}\n\nwidget row(t: task) {\n    mut votes: int = 0;\n    view {\n        @press(label = "\\{t.title}: \\{votes}", click = fn() { votes = votes + 1; });\n    }\n}\n\nwidget board() {\n    view {\n        mut for (t in $state.tasks) {\n            if (mut x: task = t) {\n                @row(t = x);\n                @press(label = "Drop", click = fn() { $state.tasks.remove(x); });\n            }\n        }\n    }\n}\n@@@\n@board;\n',
  );
  p.event("s0/s0[1]/s2/s0", "click");
  assert.deepEqual(p.observeTree()["s0/s0[1]/s2/s0"].props.label, { text: "b: 1" });
  p.event("s0/s0[0]/s3", "click");
  // "b" is now the first row, and keeps its vote
  assert.deepEqual(p.observeTree()["s0/s0[0]/s2/s0"].props.label, { text: "b: 1" });
});

test("a widget that fails while drawing is a notice, and is tried again when what it reads changes", () => {
  const p = page('$state {\n    parts: int 0... = 0;\n}\n\nwidget share() {\n    view {\n        @label(value = "Each: \\{100 / $state.parts}");\n    }\n}\n@@@\n@share;\n\nAfter.\n');
  assert.deepEqual(p.takeOutcome().failures, [{ code: "failure.number", site: "s0" }]);
  assert.equal(p.observeTree().s0.widget, "#notice");
  p.set({ parts: p.value(num(4)) });
  assert.deepEqual(p.observeTree()["s0/s0"].props.value, { text: "Each: 25" });
});

test("the page's values reach the document as core's page channel", () => {
  const p = page('widget where() {\n    view {\n        @label(value = page.width == width.NARROW ? "Narrow" : "Wide");\n    }\n}\n@@@\n@where;\n', { page: { width: "NARROW" } });
  assert.equal(p.markdown(), "Narrow\n");
  p.setPage({ width: "WIDE" });
  assert.equal(p.markdown(), "Wide\n");
});

test("onChange is told after every redraw", () => {
  const p = page('$state {\n    n: int 0..10 = 0;\n}\n@@@\n@slider(value = $state.n, label = "N");\n');
  let told = 0;
  const off = p.onChange(() => told++);
  p.write("s0", "value", p.value(num(1)));
  off();
  p.write("s0", "value", p.value(num(2)));
  assert.equal(told, 1);
});

// ---- the plane's layout

const N = (s) => Num.literal(String(s));
const pt = (x, y) => ({ x: N(x), y: N(y) });
const show = (r) => [r.from.x, r.from.y, r.to.x, r.to.y].map((x) => x.show());

test("a spot's box: its anchor's part of it on the point, moved by its nudge", () => {
  const size = { width: N(40), height: N(20) };
  assert.deepEqual(show(place(pt(0, 0), "CENTER", pt(0, 0), size)), ["-20", "-10", "20", "10"]);
  assert.deepEqual(show(place(pt(0, 0), "SW", pt(0, 0), size)), ["0", "0", "40", "20"]);
  assert.deepEqual(show(place(pt(0, 0), "NE", pt(0, 0), size)), ["-40", "-20", "0", "0"]);
  assert.deepEqual(show(place(pt(0, 0), "N", pt(5, 5), size)), ["-15", "-15", "25", "5"]);
  assert.deepEqual(show(place(pt(10, 10), "E", pt(0, 0), size)), ["-30", "0", "10", "20"]);
});

test("bounds left out are the region around every box; the centre stays inside them", () => {
  const r = around([
    { from: pt(-4, -10), to: pt(4, 10) },
    { from: pt(100, 50), to: pt(124, 70) },
  ]);
  assert.deepEqual(show(r), ["-4", "-10", "124", "70"]);
  const b = { from: pt(-400, -300), to: pt(400, 300) };
  // inside: kept; past an edge: moved back; bounds smaller than the view: their middle
  assert.deepEqual([keepInside(pt(10, 10), pt(100, 50), b)].map((p) => [p.x.show(), p.y.show()]), [["10", "10"]]);
  assert.deepEqual([keepInside(pt(390, -290), pt(100, 50), b)].map((p) => [p.x.show(), p.y.show()]), [["300", "-250"]]);
  assert.deepEqual([keepInside(pt(390, 0), pt(500, 50), b)].map((p) => [p.x.show(), p.y.show()]), [["0", "0"]]);
});

test("a layout writes boxes once: a second pass with nothing changed writes nothing", () => {
  const p = page(
    '$state {\n    home: opt<region> = opt.NONE;\n}\n\nwidget map() {\n    view {\n        @plane(label = "Map", bounds = region { from = point { x = -100, y = -100 }, to = point { x = 100, y = 100 } }) {\n            items {\n                @spot(at = point { x = 0, y = 0 }, box = $state.home) {\n                    @label(value = "Home");\n                }\n            }\n        }\n    }\n}\n@@@\n@map;\n',
  );
  let redraws = 0;
  p.onChange(() => redraws++);
  const measure = { spot: () => ({ width: N(32), height: N(20) }), planeWidth: () => N(100) };
  layout(p, measure);
  assert.equal(redraws, 1);
  assert.deepEqual(p.observeState().home, { some: { record: { type: "core/region", fields: { from: { record: { type: "core/point", fields: { x: num(-16), y: num(-10) } } }, to: { record: { type: "core/point", fields: { x: num(16), y: num(10) } } } } } } });
  layout(p, measure);
  assert.equal(redraws, 1);
});

test("writing the Markdown leaves the page as it was: a row's events still run afterwards", () => {
  const p = page(
    'record task {\n    title: text;\n}\n\n$state {\n    tasks: list<task> = [task { title = "a" }, task { title = "b" }];\n}\n\nwidget row(t: task) {\n    event drop();\n    view {\n        @press(label = "Drop \\{t.title}", click = fn() { invoke drop(); });\n    }\n    markdown {\n        - \\{t.title}\n    }\n}\n\nwidget board() {\n    view {\n        mut for (t in $state.tasks) {\n            if (mut x: task = t) {\n                @row(t = x, drop = fn() { $state.tasks.remove(x); });\n            }\n        }\n    }\n    markdown {\n        @for (t in $state.tasks) {\n        - \\{t.title}\n        }\n    }\n}\n@@@\n@board;\n',
  );
  assert.equal(p.markdown(), "- a\n- b\n");
  p.event("s0/s0[0]/s2/s0", "click");
  assert.deepEqual(p.takeOutcome().failures, []);
  assert.equal(p.markdown(), "- b\n");
  p.event("s0/s0[0]/s2/s0", "click");
  assert.equal(p.markdown(), "");
});

test("writing the Markdown leaves a widget's events in place: one that passes its event on still does", () => {
  const p = page('$state {\n    n: int = 0;\n}\n\nwidget go() {\n    event pressed();\n    view {\n        @press(label = "Go", click = fn() { invoke pressed(); });\n    }\n    markdown {\n        Go\n    }\n}\n@@@\n@go(pressed = fn() { $state.n = $state.n + 1; });\n\nPressed \\{$state.n} times.\n');
  assert.equal(p.markdown(), "Go\n\nPressed 0 times.\n");
  p.event("s0/s0", "click");
  assert.deepEqual(p.observeState(), { n: num(1) });
});

test("an app's write of the wrong type is refused, whatever its contract", () => {
  const p = page('record task {\n    title: text;\n}\n\n$state {\n    tasks: list<task> = [task { title = "a" }];\n    n: int = 1;\n    note: opt<text> = opt.NONE;\n}\n@@@\n\\{$state.n}\n');
  for (const [k, x] of [["tasks", num(3)], ["n", { text: "3" }], ["tasks", { list: [{ record: { type: "doc/task", fields: { title: num(1) } } }] }], ["note", { some: num(2) }]]) {
    p.set({ [k]: p.value(x) });
    assert.deepEqual(p.takeOutcome().refused, [{ code: "contracts.outside", site: `$state.${k}` }], k);
  }
  p.set({ tasks: p.value({ list: [{ record: { type: "doc/task", fields: { title: { text: "b" } } } }] }), note: p.value({ some: { text: "hi" } }) });
  assert.deepEqual(p.takeOutcome().refused, []);
  assert.equal(p.observeState().tasks.list[0].record.fields.title.text, "b");
});

test("an extern widget the target doesn't supply shows its Markdown, and is reported", () => {
  const pack = join(repoRoot, "targets/checks/packs/badge");
  const file = join(dir, "pack-page.xt.md");
  writeFileSync(file, 'import badge;\n@@@\n# Votes\n\n@badge(label = "Votes", count = 2);\n\n@seal(text = "Checked by nobody");\n');
  const out = file.replace(/\.xt\.md$/, ".ir.json");
  execFileSync(xtmdBinary(), ["build", file, "--pack", pack, "--out", out], { stdio: ["ignore", "pipe", "pipe"] });
  const ir = JSON.parse(readFileSync(out, "utf8"));
  assert.deepEqual(ir.ir.needs.packs, [{ externs: ["badge/badge", "badge/seal"], name: "badge", version: 1 }]);
  const p = new Page(ir, { supplies: (w) => w.startsWith("core/") || w === "badge/badge" });
  const tree = p.observeTree();
  assert.equal(tree.s1.widget, "badge/badge");
  // the seal is drawn as its Markdown: a quote holding a paragraph, under its own path
  assert.equal(tree.s2, undefined);
  assert.deepEqual(Object.values(tree).map((n) => n.widget).filter((w) => w !== "core/heading"), ["badge/badge", "core/quote", "core/paragraph"]);
  assert.deepEqual(p.missing(), ["badge/seal"]);
  // its calls show their Markdown, supplied or not
  assert.equal(p.markdown(), "# Votes\n\n**Votes**: 2\n\n> Checked by nobody\n");
  p.setSupplies(() => true);
  assert.deepEqual(p.missing(), []);
  assert.equal(p.observeTree().s2.widget, "badge/seal");
});

test("a spot outside its plane's bounds is a warning for the app when the page runs, once as it moves out", () => {
  const p = page(
    '$state {\n    x: number = 5;\n}\n\nwidget map() {\n    view {\n        @plane(label = "Map", bounds = region { from = point { x = 0, y = 0 }, to = point { x = 10, y = 10 } }) {\n            items {\n                @spot(at = point { x = $state.x, y = 5 }) {\n                    @label(value = "here");\n                }\n            }\n        }\n    }\n}\n@@@\n@map;\n',
  );
  const measure = { spot: () => ({ width: N(8), height: N(8) }), planeWidth: () => N(100) };
  layout(p, measure);
  assert.deepEqual(p.takeWarnings(), []);
  p.set({ x: p.value(num(20)) });
  layout(p, measure);
  assert.deepEqual(p.takeWarnings(), [{ code: "views.spot-outside-bounds", site: "s0/s1" }]);
  // still outside: not reported again; back inside and out again: reported again
  p.set({ x: p.value(num(30)) });
  layout(p, measure);
  assert.deepEqual(p.takeWarnings(), []);
  p.set({ x: p.value(num(3)) });
  layout(p, measure);
  p.set({ x: p.value(num(-1)) });
  layout(p, measure);
  assert.deepEqual(p.takeWarnings(), [{ code: "views.spot-outside-bounds", site: "s0/s1" }]);
  assert.deepEqual(p.takeOutcome().failures, []);
});

test("a widget of another kind at a key keeps its own variables", () => {
  const p = page(
    '$state {\n    which: bool = true;\n}\n\nwidget one() {\n    mut n: int = 0;\n    view {\n        @press(label = "one \\{n}", click = fn() { n = n + 1; });\n    }\n}\n\nwidget two() {\n    mut n: int = 0;\n    view {\n        @press(label = "two \\{n}", click = fn() { n = n + 1; });\n    }\n}\n\nwidget pile() {\n    view {\n        @press(label = "swap", click = fn() { $state.which = !$state.which; });\n        @stack {\n            if ($state.which) {\n                @one;\n            } else {\n                @two;\n            }\n        }\n    }\n}\n@@@\n@pile;\n',
  );
  const at = "s0/s1/s1[0]/s3/s0";
  p.event(at, "click");
  assert.deepEqual(p.observeTree()[at].props.label, { text: "one 1" });
  p.event("s0/s0", "click");
  assert.deepEqual(p.observeTree()[at].props.label, { text: "two 0" });
  // `one` left the key, and `two` holds it: its count moves, redraw after redraw
  for (const k of [1, 2, 3]) {
    p.event(at, "click");
    assert.deepEqual(p.observeTree()[at].props.label, { text: `two ${k}` });
  }
});

test("a widget in a list slot writes its Markdown with its inputs", () => {
  const p = page(
    'widget tally(label: text) {\n    mut votes: int = 0;\n    view {\n        @press(label = "\\{label}: \\{votes}", click = fn() { votes = votes + 1; });\n    }\n    markdown {\n        \\{label} has \\{votes}\n    }\n}\n\nwidget pile() {\n    view {\n        @stack {\n            @tally(label = "a");\n            @tally(label = "b");\n        }\n    }\n}\n@@@\n@pile;\n',
  );
  // as the compiler writes it, with the values it has now
  assert.equal(p.markdown(), "a has 0\n\nb has 0\n");
  const [press] = Object.entries(p.observeTree()).find(([, n]) => n.props.label?.text === "a: 0");
  // the stack's markdown places each child at a site of its own, so the Markdown has an
  // instance of its own for it too: its inputs, and its own variables as they start
  p.event(press, "click");
  assert.equal(p.markdown(), "a has 0\n\nb has 0\n");
  p.event(press, "click");
  assert.deepEqual(p.observeTree()[press].props.label, { text: "a: 2" });
});

// ---- reusing what didn't change (plan tab 2: only the bindings that read what changed)

const MEMO_PAGE =
  'record task {\n    title: text;\n}\n\n$state {\n    n: int = 0;\n    tasks: list<task> = [task { title = "a" }, task { title = "b" }];\n    note: text = "hi";\n}\n\nwidget row(t: task) {\n    mut votes: int = 0;\n    view {\n        @press(label = "\\{t.title}: \\{votes}", click = fn() { votes = votes + 1; });\n    }\n}\n\nwidget board() {\n    view {\n        @label(value = "n is \\{$state.n}");\n        @slider(value = $state.n, label = "N", range = 0..100);\n        mut for (t in $state.tasks) {\n            if (mut x: task = t) {\n                @row(t = x);\n                @press(label = "Drop", click = fn() { $state.tasks.remove(x); });\n            }\n        }\n        @label(value = $state.note);\n    }\n}\n@@@\n# Board\n\n@board;\n';

test("a widget whose reads didn't change is the very same node after a change", () => {
  const p = page(MEMO_PAGE);
  const before = new Map(p.tree().flatMap(function all(d) { return [[d.path, d], ...[...d.slots.values()].flat().flatMap(all)]; }));
  p.write("s1/s1", "value", p.value(num(5)));
  const after = new Map(p.tree().flatMap(function all(d) { return [[d.path, d], ...[...d.slots.values()].flat().flatMap(all)]; }));
  // what reads $state.n is drawn anew; the rows and the note are reused as they were
  assert.notEqual(after.get("s1/s0"), before.get("s1/s0"));
  assert.deepEqual(p.observeTree()["s1/s0"].props.value, { text: "n is 5" });
  for (const reused of ["s1/s6", "s1/s2[0]/s4/s0", "s1/s2[1]/s5", "m0"]) {
    assert.ok(before.get(reused), `${reused} is drawn`);
    assert.equal(after.get(reused), before.get(reused), `${reused} is reused`);
  }
});

test("with and without reuse, every step observes the same tree, $state and Markdown", () => {
  const on = page(MEMO_PAGE);
  const off = page(MEMO_PAGE, { memo: false });
  const same = () => {
    assert.deepEqual(on.observeTree(), off.observeTree());
    assert.deepEqual(on.observeState(), off.observeState());
    assert.equal(on.markdown(), off.markdown());
  };
  same();
  const steps = [
    (p) => p.write("s1/s1", "value", p.value(num(7))),
    (p) => p.event("s1/s2[1]/s4/s0", "click"),
    (p) => p.event("s1/s2[1]/s4/s0", "click"),
    (p) => p.event("s1/s2[0]/s5", "click"),
    (p) => p.set({ note: p.value({ text: "there" }) }),
    (p) => p.event("s1/s2[0]/s4/s0", "click"),
    (p) => p.set({ n: p.value(num(-1)) }),
    (p) => p.setPage({ width: "NARROW", theme: "DARK" }),
    (p) => p.write("s1/s1", "value", p.value(num(3))),
  ];
  for (const step of steps) {
    step(on);
    step(off);
    same();
  }
});

test("an undone change leaves no reused node behind", () => {
  const p = page('$state {\n    n: int = 0;\n    total: number = 10;\n}\n\nwidget go() {\n    view {\n        @label(value = "\\{$state.n} of \\{$state.total}");\n        @press(label = "Go", click = fn() { $state.n = $state.n + 1; $state.total = $state.total / 0; });\n    }\n}\n@@@\n@go;\n');
  p.event("s0/s1", "click");
  assert.deepEqual(p.observeTree()["s0/s0"].props.value, { text: "0 of 10" });
  assert.equal(p.takeOutcome().failures.length, 1);
});
