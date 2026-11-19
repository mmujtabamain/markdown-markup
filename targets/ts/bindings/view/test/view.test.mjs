// @extended-mark/view without a framework or a browser: the page as HTML, the patcher keeping elements by key,
// and the document's controlled `$state`, refusals and snapshots.

import { test } from "node:test";
import assert from "node:assert/strict";
import * as cli from "xtmd";
import { Doc, Patcher, h, toHtml } from "../dist/index.js";
import { compilePages } from "../../testing/browser.mjs";

const irs = await compilePages(cli);
const tick = () => new Promise((r) => setTimeout(r, 0));
const num = (n) => ({ num: String(n) });
const externs = { app: { unit: { text: "items" } } };

/** Every drawn widget of a page, slots included. */
function drawn(nodes, out = []) {
  for (const d of nodes) {
    out.push(d);
    for (const s of d.slots.values()) drawn(s, out);
  }
  return out;
}

test("toHtml escapes text and attributes, writes properties and style, and leaves a void element open", () => {
  const v = h("p", "label", { title: 'a "b"' }, ["<i> & </i>", { tag: "input", attrs: {}, props: { value: "x<", disabled: true, checked: false }, children: [] }]);
  v.style = { "text-align": "end" };
  assert.equal(toHtml(v), '<p data-part="label" class="xtmd-label" title="a &quot;b&quot;" style="text-align:end">&lt;i&gt; &amp; &lt;/i&gt;<input value="x&lt;" disabled></p>');
  // a stylesheet's text is its own
  assert.equal(toHtml({ tag: "style", attrs: {}, children: ["a > b {}"] }), "<style>a > b {}</style>");
});

test("the patcher keeps an element by key, sets only what changed, and moves only what is out of place", () => {
  const ops = [];
  let made = 0;
  const host = {
    live: true,
    createElement: (tag) => ({ tag, id: ++made, kids: [], attrs: {} }),
    createText: (text) => ({ text, kids: [] }),
    setText: (n, t) => (n.text = t),
    setAttribute: (n, k, v) => (ops.push(`set ${k}`), (n.attrs[k] = v)),
    removeAttribute: (n, k) => (ops.push(`unset ${k}`), delete n.attrs[k]),
    setStyle: () => {},
    removeStyle: () => {},
    setProperty: () => {},
    listen: () => () => {},
    insertBefore: (p, c, before) => {
      ops.push(`move ${c.tag ?? "text"}${c.id ?? ""}`);
      p.kids = p.kids.filter((x) => x !== c);
      p.kids.splice(before ? p.kids.indexOf(before) : p.kids.length, 0, c);
    },
    removeChild: (p, c) => (ops.push(`remove ${c.id}`), (p.kids = p.kids.filter((x) => x !== c))),
  };
  const li = (key, cls) => ({ ...h("li", undefined, { class: cls }, [key]), key });
  const parent = { kids: [] };
  const p = new Patcher(host, parent);
  p.render(h("ul", undefined, {}, [li("a", "x"), li("b", "x"), li("c", "x")]));
  const [a, b, c] = parent.kids[0].kids;
  ops.length = 0;
  // c moves to the front and b's class changes: a and b stay where they are, and nothing is made
  p.render(h("ul", undefined, {}, [li("c", "x"), li("a", "x"), li("b", "y")]));
  assert.deepEqual(parent.kids[0].kids, [c, a, b]);
  assert.equal(made, 4);
  assert.deepEqual(ops, ["set class", `move li${c.id}`]);
  assert.equal(b.attrs.class, "y");
  // a key gone is an element removed
  ops.length = 0;
  p.render(h("ul", undefined, {}, [li("c", "x"), li("b", "y")]));
  assert.deepEqual(parent.kids[0].kids, [c, b]);
  assert.deepEqual(ops, [`remove ${a.id}`]);
});

test("a document renders its page with the app's externs and the `$state` it starts from", () => {
  const doc = new Doc({ ir: irs.v1, externs, defaultState: { n: num(2) } });
  const html = toHtml(doc.render());
  assert.match(html, /^<div class="xtmd-root" data-xtmd-root data-xtmd-theme="light"/);
  assert.ok(html.includes("Count: 2 items"), html);
  assert.match(html, /data-part="press\.label"[^>]*>Add one</);
  assert.equal(doc.markdown(), "# Count: 2 items\n\nAdd one\n");
});

test("a controlled `$state` is checked: what fits is shown and heard once, what doesn't is refused and the page keeps the last that fit", async () => {
  const errors = [];
  const states = [];
  const props = { ir: irs.v1, externs, onError: (e) => errors.push(e), onStateChange: (s) => states.push(s) };
  // one the page refuses as it starts: told, and the page starts from its own
  const doc = new Doc({ ...props, state: { n: num(11) } });
  assert.equal(errors.length, 1);
  assert.equal(errors[0].kind, "refused");
  assert.deepEqual(doc.state(), { n: num(0) });
  // one that fits: shown, and heard once
  doc.update({ ...props, state: { n: num(3) } });
  await tick();
  assert.deepEqual(doc.state(), { n: num(3) });
  assert.deepEqual(states, [{ n: num(3) }]);
  // the same again is no change
  doc.update({ ...props, state: { n: num(3) } });
  await tick();
  assert.equal(states.length, 1);
  // one out of range: refused once, and 3 stays
  doc.update({ ...props, state: { n: num(12) } });
  await tick();
  assert.equal(errors.length, 2);
  assert.deepEqual(doc.state(), { n: num(3) });
  assert.equal(states.length, 1);
});

test("set, expose and the app's extern fns go through the page, each heard once its change is done", async () => {
  const states = [];
  const calls = [];
  const doc = new Doc({ ir: irs.v1, externs, onStateChange: (s) => states.push(s), onCalls: (c) => calls.push(...c) });
  let renders = 0;
  doc.subscribe(() => renders++);
  doc.set({ n: num(4) });
  await tick();
  assert.deepEqual(states, [{ n: num(4) }]);
  assert.ok(renders >= 1);
  // the reader's press: its handler writes $state and calls app.saved
  const press = drawn(doc.running.tree()).find((d) => d.widget === "core/press");
  doc.running.event(press.path, "click", []);
  await tick();
  assert.deepEqual(states.at(-1), { n: num(5) });
  assert.equal(calls.length, 1);
  assert.match(JSON.stringify(calls[0]), /saved/);
  doc.expose("app", "reset");
  await tick();
  assert.deepEqual(states.at(-1), { n: num(0) });
});

test("a snapshot brings back `$state` and widgets' own variables in the same IR, `$state` alone in another, and nothing it can't read", async () => {
  const doc = new Doc({ ir: irs.notes });
  doc.set({ n: num(2) });
  const tally = drawn(doc.running.tree()).find((d) => d.widget === "core/press");
  doc.running.event(tally.path, "click", []);
  doc.running.event(tally.path, "click", []);
  const snap = JSON.parse(JSON.stringify(doc.snapshot()));
  assert.deepEqual(snap.state, { n: num(2) });
  assert.ok(Object.values(snap.own).some((o) => JSON.stringify(o.k) === JSON.stringify(num(2))), JSON.stringify(snap.own));
  // the same IR: all of it
  const again = new Doc({ ir: irs.notes });
  assert.deepEqual(again.restore(snap), { restored: "all", dropped: [] });
  assert.deepEqual(again.state(), { n: num(2) });
  assert.ok(again.markdown().includes("Apples: 2"), again.markdown());
  // started from it
  const started = new Doc({ ir: irs.notes, defaultSnapshot: snap });
  assert.ok(started.markdown().includes("Apples: 2"), started.markdown());
  // another IR: $state only, as its places may be other widgets
  const other = new Doc({ ir: irs.v1, externs });
  assert.deepEqual(other.restore({ ...snap, state: { n: num(2) } }), { restored: "state", dropped: ["own"] });
  assert.deepEqual(other.state(), { n: num(2) });
  // a snapshot of another release, or a $state the page refuses
  assert.equal(other.restore({ ...snap, xtmd: "0.2.0" }).restored, "none");
  const errors = [];
  const strict = new Doc({ ir: irs.v1, externs, onError: (e) => errors.push(e) });
  assert.equal(strict.restore({ ...snap, state: { n: num(11) } }).restored, "none");
  assert.equal(errors[0].kind, "refused");
  assert.deepEqual(strict.state(), { n: num(0) });
});

test("a document fetched from `src` shows that it is loading, then the page, or why it couldn't be had", async () => {
  const realFetch = globalThis.fetch;
  globalThis.fetch = async (url) => (url === "/ok.json" ? { ok: true, json: async () => irs.v1 } : { ok: false, status: 404, statusText: "Not Found" });
  try {
    const errors = [];
    const doc = new Doc({ src: "/ok.json", externs });
    assert.ok(toHtml(doc.render()).includes("data-xtmd-loading"));
    await tick();
    assert.ok(toHtml(doc.render()).includes("Count: 0 items"));
    const missing = new Doc({ src: "/missing.json", onError: (e) => errors.push(e) });
    await tick();
    assert.equal(errors[0].kind, "load");
    assert.match(toHtml(missing.render()), /role="alert"[^>]*>The page at \/missing\.json couldn&#39;t be loaded: 404 Not Found</);
  } finally {
    globalThis.fetch = realFetch;
  }
});
