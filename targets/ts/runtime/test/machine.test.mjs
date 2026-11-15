// The Machine through its API, as a runtime drives it: a host holding `$state`, extern fns
// supplied or not, items followed by their identity through a sort, and the helpers a page's view
// uses (evalWith, loopRows, openCond, setPlace).

import { test } from "node:test";
import assert from "node:assert/strict";
import { Constants, Failure, Machine, Num, Program, Value, toIr } from "../dist/index.js";

const num = (n) => Value.num(Num.int(n));
const ir = (v) => JSON.stringify(toIr(v));

/** A host with a `$state`, and extern fns from a table: a value, `null` for nothing, or left out. */
class Host {
  constructor(state = {}, externs = {}) {
    this.state = new Map(Object.entries(state));
    this.externs = externs;
    this.invoked = [];
  }
  read(m, what, owner) {
    if (what.kind === "state" && this.state.has(what.name)) {
      return this.state.get(what.name);
    }
    return new Constants().read(m, what, owner);
  }
  write(m, what, owner, value) {
    if (what.kind !== "state") {
      return new Constants().write(m, what, owner, value);
    }
    this.state.set(what.name, value);
  }
  callExtern(m, name, args) {
    const f = this.externs[name];
    return f === undefined ? undefined : f(args);
  }
  invoke(m, event, args, owner) {
    this.invoked.push([event, args.map(ir), owner]);
  }
}

const NUMBER = { name: "core/number" };

test("extern fns: supplied, supplied with nothing, or the default body", () => {
  const prog = new Program();
  const ext = (name, body) => ({ name, params: [{ name: "x", type: NUMBER }], supplier: "app", default: body });
  prog.add({ extern: { fn: ext("app/twice", [{ return: { value: { op: { name: "*", args: [{ get: { local: "x" } }, { num: "2" }] } } } }]) } });
  prog.add({ extern: { fn: ext("app/none", []) } });
  const host = new Host({}, { "app/none": () => null });
  const m = new Machine(prog, host);
  assert.equal(ir(m.call("app/twice", [{ value: num(21) }])), '{"num":"42"}');
  assert.equal(m.call("app/none", [{ value: num(1) }]), undefined);
  host.externs["app/twice"] = ([x]) => Value.text(`app:${x.n.show()}`);
  assert.equal(ir(m.call("app/twice", [{ value: num(5) }])), '{"text":"app:5"}');
  // with nobody supplying it and no default, it is only known when the page runs
  const c = new Machine(prog, new Constants());
  assert.throws(() => c.call("app/none", [{ value: num(1) }]), (e) => e instanceof Failure && e.kind === "NotConstant" && e.message === "nobody supplies `app/none`");
  assert.throws(() => c.eval({ get: { $state: "n" } }), (e) => e instanceof Failure && e.kind === "NotConstant" && e.message === 'State("n") is only known when the page runs');
});

test("invoke goes to the host, with the frame's owner", () => {
  const prog = new Program();
  prog.add({ fn: { name: "t/fire", params: [], body: [{ invoke: { event: "picked", args: [{ num: "3" }] } }] } });
  const host = new Host();
  const m = new Machine(prog, host);
  // an action called as a value returns nothing, which is a failure, as in Rust
  assert.throws(() => m.evalIn([], 7, { call: { name: "t/fire", args: [] } }), (e) => e.kind === "Ir" && e.message === "`t/fire` returns nothing");
  assert.deepEqual(host.invoked, [["picked", ['{"num":"3"}'], 7]]);
  // a lambda made in instance 7 runs there
  const f = m.evalIn([], 7, { fn: { params: [], body: [{ invoke: { event: "again", args: [] } }] } });
  assert.equal(m.apply(f, []), undefined);
  assert.deepEqual(host.invoked[1], ["again", [], 7]);
  assert.throws(
    () => new Machine(prog, new Constants()).call("t/fire", []),
    (e) => e.kind === "NotConstant" && e.message === "`invoke picked` runs only when the page runs",
  );
});

test("a mut for row follows its item through a sort, as a view's row does", () => {
  const prog = new Program();
  const host = new Host({ xs: null });
  const m = new Machine(prog, host);
  host.state.set("xs", m.makeList([num(30), num(10), num(20)]));
  const over = { get: { $state: "xs" } };
  const rows = m.loopRows([], undefined, { mut: true, name: "t", position: "k", over, body: [], key: "item", site: "s", type: NUMBER });
  assert.deepEqual(
    rows.map((r) => r.key),
    host.state.get("xs").items.map((i) => i.id),
  );
  // the row of 10, opened with `if (mut x: number = t)`
  const row = rows[1];
  assert.equal(ir(m.evalWith(row.bindings, undefined, { get: { local: "k" } })), '{"num":"1"}');
  const x = m.openCond(row.bindings, undefined, { mut: true, name: "x", opt: { get: { local: "t" } }, type: NUMBER });
  assert.ok(x && "ref" in x);
  // sort the list: the item moves, its row still reaches it
  m.call("core/list.sort", [{ ref: { root: { kind: "outer", outer: { kind: "state", name: "xs" }, owner: undefined }, path: [] } }]);
  assert.equal(ir(host.state.get("xs")), '{"list":[{"num":"10"},{"num":"20"},{"num":"30"}]}');
  m.setPlace([...row.bindings, ["x", x]], undefined, { root: { local: "x" }, path: [] }, num(11));
  assert.equal(ir(host.state.get("xs")), '{"list":[{"num":"11"},{"num":"20"},{"num":"30"}]}');
  // removed, the row's opt is empty and its opened name fails
  m.call("core/list.remove", [{ ref: { root: { kind: "outer", outer: { kind: "state", name: "xs" }, owner: undefined }, path: [] } }, { value: num(11) }]);
  assert.equal(ir(m.evalWith(row.bindings, undefined, { get: { local: "t" } })), '{"none":{}}');
  assert.equal(m.openCond(row.bindings, undefined, { mut: true, name: "x", opt: { get: { local: "t" } }, type: NUMBER }), undefined);
  assert.throws(
    () => m.evalWith([...row.bindings, ["x", x]], undefined, { get: { local: "x" } }),
    (e) => e.kind === "Removed" && e.message === "an item used after it was removed",
  );
});

test("plain rows: a list's keyed by identity, a range's by number", () => {
  const m = new Machine(new Program(), new Constants());
  const list = { list: [{ text: "a" }, { text: "b" }] };
  const rows = m.loopRows([], undefined, { mut: false, name: "s", over: list, body: [], key: "item", site: "s", type: { name: "core/text" } });
  assert.deepEqual(
    rows.map((r) => ir(r.bindings[0][1].value)),
    ['{"text":"a"}', '{"text":"b"}'],
  );
  const range = { range: { low: { num: "0" }, high: { num: "1" }, step: { num: "0.5" } } };
  const nums = m.loopRows([], undefined, { mut: false, name: "i", over: range, body: [], key: "number", site: "s", type: NUMBER });
  assert.deepEqual(
    nums.map((r) => r.key),
    ["0", "0.5", "1"],
  );
});

test("failures carry their kind, and the detail Rust's enum holds", () => {
  const m = new Machine(new Program(), new Constants());
  const op = (name, a, b) => ({ op: { name, args: [{ num: a }, { num: b }] } });
  assert.throws(() => m.eval(op("/", "1", "0")), (e) => e instanceof Failure && e.kind === "Number" && e.num === "DivisionByZero" && e.message === "a division by zero");
  assert.throws(() => m.eval({ range: {} }) && m.walkRange(m.eval({ range: {} })), Failure);
  assert.throws(() => m.walkRange(m.eval({ range: { low: { num: "1" } } })), (e) => e.kind === "Limit" && e.limit === "Items");
  assert.throws(() => m.eval({ bind: "b1" }), (e) => e.kind === "NotConstant" && e.message === "binding b1 is worked out when the page runs");
  const rule = Failure.rule("a span has to end after it starts");
  assert.equal(rule.message, "broken rule: a span has to end after it starts");
  assert.equal(rule.rule, "a span has to end after it starts");
});
