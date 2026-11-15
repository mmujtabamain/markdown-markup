// The evaluator: it walks the IR's statements and expressions, with the limits of page 6. A port
// of targets/rust/eval/src/interp.rs, kept to its order of evaluation, its failures and messages,
// its step, item and depth counting, and its item identities.
//
// What lives outside a fn (a widget's cells and inputs, `$state`, the app's channels) is reached
// through a Host. Where Rust returns `Err(Failure)`, this throws a `Failure`.

import type * as ir from "../generated/ir.js";
import { Num, NumError, type NumErrorKind } from "./num.js";
import * as V from "./value.js";
import type { CaseValue, Entry, FnValue, Item, RecordValue, Value } from "./value.js";
import * as natives from "./natives.js";

/** Page 6's limits. */
export const MAX_STEPS = 1_000_000;
export const MAX_ITEMS = 10_000;
export const MAX_DEPTH = 64;

export type Limit = "Steps" | "Items" | "Depth";

/** interp.rs's FailKind, by its variants' names. `Number` and `Limit` say which in `num` and `limit`. */
export type FailKind =
  /** A number that doesn't fit: a division by zero, or a result too large. */
  | "Number"
  /** A `require` or a contract, false for values that are not constants. */
  | "Rule"
  /** A position outside a list. */
  | "Position"
  /** An item used after it was removed. */
  | "Removed"
  | "Limit"
  /** What is only known when the page runs: a variable, `$state`, an extern nobody supplies. */
  | "NotConstant"
  /** A bug in the IR: a name that isn't declared, a value of the wrong kind. */
  | "Ir";

/** Which number failure or which limit, for kinds `Number` and `Limit`. */
export interface FailureDetail {
  num?: NumErrorKind;
  limit?: Limit;
}

export class Failure extends Error {
  readonly kind: FailKind;
  /** A `require`'s message, when a rule failed. */
  readonly rule?: string;
  /** For `Number`: a division by zero, or a result too large. */
  readonly num?: NumErrorKind;
  /** For `Limit`: which one. */
  readonly limit?: Limit;

  /** As Rust's `Failure { kind, message, rule }`. */
  constructor(kind: FailKind, message: string, rule?: string, detail: FailureDetail = {}) {
    super(message);
    this.name = "Failure";
    this.kind = kind;
    if (rule !== undefined) {
      this.rule = rule;
    }
    if (detail.num !== undefined) {
      this.num = detail.num;
    }
    if (detail.limit !== undefined) {
      this.limit = detail.limit;
    }
  }

  static ir(message: string): Failure {
    return new Failure("Ir", message);
  }

  static rule(message: string): Failure {
    return new Failure("Rule", `broken rule: ${message}`, message);
  }

  static ofNum(e: NumError): Failure {
    return new Failure("Number", e.message, undefined, { num: e.kind });
  }

  static ofLimit(limit: Limit, message: string): Failure {
    return new Failure("Limit", message, undefined, { limit });
  }
}

/** Runs number maths, a NumError becoming a Failure of kind Number, as Rust's `?` on a NumResult. */
export function numOp<T>(f: () => T): T {
  try {
    return f();
  } catch (e) {
    if (e instanceof NumError) {
      throw Failure.ofNum(e);
    }
    throw e;
  }
}

export type OuterKind = "cell" | "input" | "state" | "let" | "extern" | "slot";

/** What a name outside a fn's locals stands for. */
export interface Outer {
  readonly kind: OuterKind;
  readonly name: string;
}

const OUTER_DEBUG: { [K in OuterKind]: string } = { cell: "Cell", input: "Input", state: "State", let: "Let", extern: "Extern", slot: "Slot" };

/** An Outer as Rust's `{:?}` writes it, for messages: `Cell("n")`. */
export function outerDebug(o: Outer): string {
  return `${OUTER_DEBUG[o.kind]}(${JSON.stringify(o.name)})`;
}

/** Everything outside a fn: a widget instance, the document, the app, the target. */
export interface Host {
  read(m: Machine, what: Outer, owner?: number): Value;
  write(m: Machine, what: Outer, owner: number | undefined, value: Value): void;
  /** An extern fn of a pack or of the app: its value, `null` when it returns nothing, and
   * `undefined` when nobody supplies it (Rust's `None`), so its default body runs if it has one.
   * Left out, nobody supplies any. */
  callExtern?(m: Machine, name: string, args: readonly Value[]): Value | undefined | null;
  /** `invoke event(args)`. Left out, it fails as NotConstant, as it does for the compiler. */
  invoke?(m: Machine, event: string, args: Value[], owner: number | undefined): void;
  /** The value a token case stands for, from the target's tokens. Left out, the build's own:
   * `m.defaultTokenValue(c)`. */
  tokenValue?(m: Machine, c: CaseValue): Value;
}

/** A host for the compiler: only constants can be worked out. */
export class Constants implements Host {
  read(m: Machine, what: Outer, _owner?: number): Value {
    if (what.kind === "let") {
      const v = m.prog.lets.get(what.name);
      if (v !== undefined) {
        return v;
      }
    }
    throw new Failure("NotConstant", `${outerDebug(what)} is only known when the page runs`);
  }

  write(_m: Machine, what: Outer, _owner: number | undefined, _value: Value): void {
    throw new Failure("NotConstant", `${outerDebug(what)} can't change while a constant is worked out`);
  }
}

/** A local, or a reference to a place for a `mut` parameter, a `mut for` or an `if (mut …)`. */
export type Binding = { readonly value: Value } | { readonly ref: Place };

export interface Place {
  readonly root: PlaceRoot;
  readonly path: readonly Step[];
}

export type PlaceRoot =
  | { readonly kind: "local"; readonly frame: number; readonly name: string }
  | { readonly kind: "outer"; readonly outer: Outer; readonly owner: number | undefined };

export type Step =
  | { readonly kind: "field"; readonly name: string }
  /** An item by its position, as `xs[i] = v` writes. */
  | { readonly kind: "index"; readonly index: number }
  /** The real item, by its identity, wherever it now is. */
  | { readonly kind: "item"; readonly id: number }
  /** The real item as an `opt`: `none` once it has been removed (a `mut for` variable). */
  | { readonly kind: "itemOpt"; readonly id: number }
  /** The value inside an `opt`. */
  | { readonly kind: "inside" };

const INSIDE: Step = { kind: "inside" };

type Var = [name: string, binding: Binding];

interface Frame {
  vars: Var[];
  owner: number | undefined;
}

/** `null` goes on; an object returns, with a value or none. */
type Flow = null | { readonly value: Value | undefined };

/** The declarations a program's code needs, by their full names. */
export class Program {
  readonly fns = new Map<string, ir.FnDecl>();
  readonly externs = new Map<string, ir.ExternFn>();
  readonly records = new Map<string, ir.Record>();
  readonly enums = new Map<string, ir.Enum>();
  readonly tokens = new Map<string, ir.Token>();
  readonly aliases = new Map<string, ir.Type>();
  readonly interfaces = new Map<string, ir.Interface>();
  /** Constant lets, already worked out. */
  readonly lets = new Map<string, Value>();

  add(d: ir.Decl): void {
    if ("fn" in d) {
      this.fns.set(d.fn.name, d.fn);
    } else if ("extern" in d) {
      if ("fn" in d.extern) {
        this.externs.set(d.extern.fn.name, d.extern.fn);
      } else if ("channel" in d.extern) {
        // a channel's fns are the app's: `doc/scores.saved`
        const c = d.extern.channel;
        for (const f of c.fns) {
          this.externs.set(`${c.name}.${f.name}`, { name: `${c.name}.${f.name}`, params: f.params, returns: f.returns, supplier: c.supplier });
        }
      }
    } else if ("record" in d) {
      this.records.set(d.record.name, d.record);
    } else if ("enum" in d) {
      this.enums.set(d.enum.name, d.enum);
    } else if ("token" in d) {
      this.tokens.set(d.token.name, d.token);
    } else if ("type" in d) {
      this.aliases.set(d.type.name, d.type.is);
    } else if ("interface" in d) {
      this.interfaces.set(d.interface.name, d.interface);
    }
  }

  static fromModule(m: ir.Module): Program {
    const p = new Program();
    for (const d of m.declarations) {
      p.add(d.declare);
    }
    return p;
  }
}

/** The single key of an IR union's object: `{ num: "1" }` is a "num". */
function tag(o: object): string {
  for (const k in o) {
    return k;
  }
  return "";
}

function has(o: object, key: string): boolean {
  return Object.prototype.hasOwnProperty.call(o, key);
}

function short(ty: string): string {
  const k = ty.lastIndexOf("/");
  return k < 0 ? ty : ty.slice(k + 1);
}

const OP_DEBUG: { [K in ir.OpName]: string } = {
  "+": "Plus",
  "-": "Minus",
  "*": "Times",
  "/": "Divide",
  "%": "Rem",
  "==": "Eq",
  "!=": "Ne",
  "<": "Lt",
  "<=": "Le",
  ">": "Gt",
  ">=": "Ge",
  "&&": "And",
  "||": "Or",
  "!": "Not",
  "?": "Pick",
};

const SMALL: Num[] = [];

/** A position or a count as a number. */
function int(k: number): Num {
  if (k >= 0 && k < 1024) {
    let n = SMALL[k];
    if (n === undefined) {
      n = Num.int(k);
      SMALL[k] = n;
    }
    return n;
  }
  return Num.int(k);
}

const EMPTY: readonly never[] = [];

export class Machine {
  readonly prog: Program;
  host: Host;
  steps = 0;
  depth = 0;
  nextId = 0;
  /** The message of the last rule a `try` turned into `none`, for a literal's error. */
  lastRule: string | undefined = undefined;
  private frames: Frame[] = [{ vars: [], owner: undefined }];

  constructor(prog: Program, host: Host) {
    this.prog = prog;
    this.host = host;
  }

  /** Starts counting steps again, for one redraw, one event or one constant. */
  resetSteps(): void {
    this.steps = 0;
  }

  private step(): void {
    this.steps += 1;
    if (this.steps > MAX_STEPS) {
      throw Failure.ofLimit("Steps", "more than 1,000,000 steps");
    }
  }

  newId(): number {
    this.nextId += 1;
    return this.nextId;
  }

  makeList(values: readonly Value[]): Value {
    if (values.length > MAX_ITEMS) {
      throw Failure.ofLimit("Items", "a list of more than 10,000 items");
    }
    const ids = { next: this.nextId };
    const v = V.list(values, ids);
    this.nextId = ids.next;
    return v;
  }

  private frame(): Frame {
    return this.frames[this.frames.length - 1];
  }

  private owner(): number | undefined {
    return this.frame().owner;
  }

  /** Works out an expression with these locals, inside the widget instance `owner`: how a runtime
   * or the Markdown writer reads a node's values. */
  evalIn(locals: readonly (readonly [string, Value])[], owner: number | undefined, e: ir.Expr): Value {
    const vars: Var[] = locals.map(([n, v]) => [n, { value: v }]);
    this.frames.push({ vars, owner });
    try {
      return this.eval(e);
    } finally {
      this.frames.pop();
    }
  }

  // ---- for a runtime: a view's nodes read with the locals around them, values or references
  // (not in interp.rs, whose Markdown writer reads values only; each runs as the fn statements do)

  private withFrame<T>(bindings: readonly (readonly [string, Binding])[], owner: number | undefined, f: () => T): T {
    this.frames.push({ vars: bindings.map(([n, b]) => [n, b]), owner });
    try {
      return f();
    } finally {
      this.frames.pop();
    }
  }

  /** `evalIn`, with locals that may be references: a `mut for` row's item, an `if (mut …)`. */
  evalWith(bindings: readonly (readonly [string, Binding])[], owner: number | undefined, e: ir.Expr): Value {
    return this.withFrame(bindings, owner, () => this.eval(e));
  }

  /** Writes `value` where an IR place says, its locals and positions read with these bindings. */
  setPlace(bindings: readonly (readonly [string, Binding])[], owner: number | undefined, place: ir.Place, value: Value): void {
    this.withFrame(bindings, owner, () => this.writePlace(this.place(place), value));
  }

  /** Opens an opt as `if (let …)` and `if (mut …)` do: the binding of its name, or `undefined`
   * when there is nothing inside. */
  openCond(bindings: readonly (readonly [string, Binding])[], owner: number | undefined, open: ir.CondOpen): Binding | undefined {
    return this.withFrame(bindings, owner, () => {
      if (!this.cond({ open })) {
        return undefined;
      }
      const vars = this.frame().vars;
      return vars[vars.length - 1][1];
    });
  }

  /** The rows a `for` walks, as the statement walks them (a step each): each row's locals (its
   * position, when it has one, then its name: the item, or for `mut for` a reference to the real
   * item) and its key: the item's identity for a list, the number for a range. */
  loopRows(bindings: readonly (readonly [string, Binding])[], owner: number | undefined, f: ir.NodeFor | ir.StmtFor): { key: number | string; bindings: [string, Binding][] }[] {
    return this.withFrame(bindings, owner, () => {
      const rows: { key: number | string; bindings: [string, Binding][] }[] = [];
      const row = (k: number, key: number | string, b: Binding): void => {
        this.step();
        const out: [string, Binding][] = [];
        if (f.position !== undefined) {
          out.push([f.position, { value: V.num(int(k)) }]);
        }
        out.push([f.name, b]);
        rows.push({ key, bindings: out });
      };
      if (f.mut) {
        const listPlace = this.placeOf(f.over);
        const lv = this.readPlace(listPlace);
        if (lv.kind !== "list") {
          throw Failure.ir("`mut for` over something that isn't a list");
        }
        lv.items.forEach((i, k) => row(k, i.id, { ref: { root: listPlace.root, path: [...listPlace.path, { kind: "itemOpt", id: i.id }] } }));
        return rows;
      }
      const over = this.eval(f.over);
      if (over.kind === "list") {
        over.items.forEach((i, k) => row(k, i.id, { value: i.value }));
      } else if (over.kind === "range") {
        this.walkRange(over).forEach((v, k) => row(k, V.asNum(v)?.show() ?? String(k), { value: v }));
      } else {
        throw Failure.ir("`for` over something that isn't a list or a range");
      }
      return rows;
    });
  }

  private bind(name: string, b: Binding): void {
    this.frame().vars.push([name, b]);
  }

  private truncate(mark: number): void {
    const vars = this.frame().vars;
    if (vars.length > mark) {
      vars.length = mark;
    }
  }

  /** The current frame's newest local of this name, by its index. */
  private lookup(name: string): number {
    const vars = this.frame().vars;
    for (let k = vars.length - 1; k >= 0; k--) {
      if (vars[k][0] === name) {
        return k;
      }
    }
    return -1;
  }

  private hostRead(what: Outer, owner: number | undefined): Value {
    return this.host.read(this, what, owner);
  }

  // ---- places

  private readRoot(root: PlaceRoot): Value {
    if (root.kind === "outer") {
      return this.hostRead(root.outer, root.owner);
    }
    const frame = this.frames[root.frame];
    if (frame === undefined) {
      throw Failure.ir("a reference outlived its fn");
    }
    for (let k = frame.vars.length - 1; k >= 0; k--) {
      const [n, b] = frame.vars[k];
      if (n === root.name) {
        return "value" in b ? b.value : this.readPlace(b.ref);
      }
    }
    throw Failure.ir(`no local \`${root.name}\``);
  }

  readPlace(p: Place): Value {
    let v = this.readRoot(p.root);
    for (const s of p.path) {
      switch (s.kind) {
        case "field": {
          if (v.kind === "record") {
            const x = V.entry(v.fields, s.name);
            if (x === undefined) {
              throw Failure.ir(`no field \`${s.name}\``);
            }
            v = x;
            continue;
          }
          break;
        }
        case "index": {
          if (v.kind === "list") {
            const item = s.index >= 0 ? v.items[s.index] : undefined;
            if (item === undefined) {
              throw new Failure("Position", "a position outside the list");
            }
            v = item.value;
            continue;
          }
          break;
        }
        case "item": {
          if (v.kind === "list") {
            const item = findItem(v.items, s.id);
            if (item === undefined) {
              throw new Failure("Removed", "an item used after it was removed");
            }
            v = item.value;
            continue;
          }
          break;
        }
        case "itemOpt": {
          if (v.kind === "list") {
            const item = findItem(v.items, s.id);
            v = item === undefined ? V.none() : V.some(item.value);
            continue;
          }
          break;
        }
        case "inside": {
          if (v.kind === "opt") {
            if (v.value === null) {
              throw new Failure("Removed", "an opt that is empty");
            }
            v = v.value;
            continue;
          }
          break;
        }
      }
      throw Failure.ir("a place that doesn't fit its value");
    }
    return v;
  }

  writePlace(p: Place, value: Value): void {
    if (p.path.length === 0) {
      this.writeRoot(p.root, value);
      return;
    }
    const whole = this.readRoot(p.root);
    this.writeRoot(p.root, writePath(whole, p.path, 0, value));
  }

  private writeRoot(root: PlaceRoot, value: Value): void {
    if (root.kind === "outer") {
      this.host.write(this, root.outer, root.owner, value);
      return;
    }
    const frame = this.frames[root.frame];
    if (frame === undefined) {
      throw Failure.ir("a reference outlived its fn");
    }
    for (let k = frame.vars.length - 1; k >= 0; k--) {
      const [n, b] = frame.vars[k];
      if (n === root.name) {
        if ("value" in b) {
          frame.vars[k] = [n, { value }];
          return;
        }
        this.writePlace(b.ref, value);
        return;
      }
    }
    throw Failure.ir(`no local \`${root.name}\``);
  }

  private place(p: ir.Place): Place {
    let root: PlaceRoot;
    let path: Step[];
    const r = p.root;
    if ("local" in r) {
      const k = this.lookup(r.local);
      if (k < 0) {
        throw Failure.ir(`no local \`${r.local}\``);
      }
      const b = this.frame().vars[k][1];
      if ("ref" in b) {
        root = b.ref.root;
        path = b.ref.path.slice();
      } else {
        root = { kind: "local", frame: this.frames.length - 1, name: r.local };
        path = [];
      }
    } else if ("cell" in r) {
      root = { kind: "outer", outer: { kind: "cell", name: r.cell }, owner: this.owner() };
      path = [];
    } else if ("input" in r) {
      root = { kind: "outer", outer: { kind: "input", name: r.input }, owner: this.owner() };
      path = [];
    } else {
      root = { kind: "outer", outer: { kind: "state", name: r.$state }, owner: undefined };
      path = [];
    }
    for (const s of p.path) {
      if ("field" in s) {
        path.push({ kind: "field", name: s.field.name });
      } else {
        const at = this.eval(s.item.at);
        const n = V.asNum(at)?.toI64() ?? null;
        if (n === null) {
          throw new Failure("Position", "a position that isn't a whole number");
        }
        path.push({ kind: "index", index: n });
      }
    }
    return { root, path };
  }

  // ---- statements

  private block(stmts: readonly ir.Stmt[]): Flow {
    const mark = this.frame().vars.length;
    let flow: Flow = null;
    for (const s of stmts) {
      flow = this.stmt(s);
      if (flow !== null) {
        break;
      }
    }
    this.truncate(mark);
    return flow;
  }

  private stmt(s: ir.Stmt): Flow {
    this.step();
    switch (tag(s)) {
      case "declare": {
        const d = (s as { declare: ir.StmtDeclare }).declare;
        const l = "let" in d ? d.let : d.mut;
        const v = this.eval(l.value);
        this.bind(l.name, { value: v });
        break;
      }
      case "set": {
        const set = (s as { set: ir.StmtSet }).set;
        const v = this.eval(set.value);
        const p = this.place(set.place);
        this.writePlace(p, v);
        break;
      }
      case "return": {
        const r = (s as { return: ir.StmtReturn }).return;
        return { value: r.value !== undefined ? this.eval(r.value) : undefined };
      }
      case "if": {
        const i = (s as { if: ir.StmtIf }).if;
        for (const b of i.branches) {
          const mark = this.frame().vars.length;
          if (this.cond(b.when)) {
            try {
              return this.block(b.then);
            } finally {
              this.truncate(mark);
            }
          }
        }
        return this.block(i.else ?? EMPTY);
      }
      case "for":
        return this.forLoop((s as { for: ir.StmtFor }).for);
      case "match": {
        const m = (s as { match: ir.StmtMatch }).match;
        const v = this.eval(m.value);
        for (const c of m.cases) {
          const mark = this.frame().vars.length;
          if (this.patterns(c.when, v)) {
            try {
              return this.block(c.then);
            } finally {
              this.truncate(mark);
            }
          }
        }
        return this.block(m.else ?? EMPTY);
      }
      case "invoke": {
        const i = (s as { invoke: ir.StmtInvoke }).invoke;
        const args: Value[] = [];
        for (const a of i.args) {
          args.push(this.eval(a));
        }
        const owner = this.owner();
        if (this.host.invoke === undefined) {
          throw new Failure("NotConstant", `\`invoke ${i.event}\` runs only when the page runs`);
        }
        this.host.invoke(this, i.event, args, owner);
        break;
      }
      case "call":
        this.callExpr((s as { call: ir.Call }).call);
        break;
      case "apply": {
        const a = (s as { apply: ir.StmtApply }).apply;
        const f = this.eval(a.fn);
        const args = this.args(a.args);
        this.apply(f, args);
        break;
      }
      default:
        throw Failure.ir(`a statement \`${tag(s)}\` this evaluator doesn't know`);
    }
    return null;
  }

  private cond(c: ir.Cond): boolean {
    if ("cond" in c) {
      const b = V.asBool(this.eval(c.cond));
      if (b === undefined) {
        throw Failure.ir("a condition that isn't a bool");
      }
      return b;
    }
    const o = c.open;
    if (!o.mut) {
      const v = this.eval(o.opt);
      if (v.kind === "opt") {
        if (v.value === null) {
          return false;
        }
        this.bind(o.name, { value: v.value });
        return true;
      }
      this.bind(o.name, { value: v });
      return true;
    }
    let target = this.placeOf(o.opt);
    // `xs[i]` is an opt: none past the end, and otherwise the item itself, by its identity
    const last = target.path[target.path.length - 1];
    if (last !== undefined && last.kind === "index") {
      const list: Place = { root: target.root, path: target.path.slice(0, -1) };
      const lv = this.readPlace(list);
      const item = lv.kind === "list" && last.index >= 0 ? lv.items[last.index] : undefined;
      if (item === undefined) {
        return false;
      }
      target = { root: target.root, path: [...list.path, { kind: "item", id: item.id }] };
    }
    const tl = target.path[target.path.length - 1];
    let inside: Place;
    let now: Value;
    if (tl !== undefined && tl.kind === "itemOpt") {
      inside = { root: target.root, path: [...target.path.slice(0, -1), { kind: "item", id: tl.id }] };
      now = this.readPlace(target);
    } else {
      inside = { root: target.root, path: [...target.path, INSIDE] };
      now = this.readPlace(target);
    }
    if (now.kind === "opt") {
      if (now.value === null) {
        return false;
      }
      this.bind(o.name, { ref: inside });
      return true;
    }
    // a plain value where an opt is wanted is always there
    this.bind(o.name, { ref: { root: inside.root, path: inside.path.slice(0, -1) } });
    return true;
  }

  /** The place an expression stands for: a `place`, or a local that refers to one. */
  private placeOf(e: ir.Expr): Place {
    switch (tag(e)) {
      case "place":
        return this.place((e as { place: ir.Place }).place);
      case "get": {
        const g = (e as { get: ir.Get }).get;
        if ("local" in g) {
          return this.place({ root: { local: g.local }, path: [] });
        }
        if ("cell" in g) {
          return this.place({ root: { cell: g.cell }, path: [] });
        }
        if ("input" in g) {
          return this.place({ root: { input: g.input }, path: [] });
        }
        if ("$state" in g) {
          return this.place({ root: { $state: g.$state }, path: [] });
        }
        break;
      }
      case "field": {
        const f = (e as { field: ir.ExprField }).field;
        const p = this.placeOf(f.value);
        return { root: p.root, path: [...p.path, { kind: "field", name: f.name }] };
      }
    }
    throw Failure.ir("a mut place that isn't a variable");
  }

  private forLoop(f: ir.StmtFor): Flow {
    if (f.mut) {
      const listPlace = this.placeOf(f.over);
      const lv = this.readPlace(listPlace);
      if (lv.kind !== "list") {
        throw Failure.ir("`mut for` over something that isn't a list");
      }
      const ids = lv.items.map((i) => i.id);
      for (let k = 0; k < ids.length; k++) {
        this.step();
        const mark = this.frame().vars.length;
        if (f.position !== undefined) {
          this.bind(f.position, { value: V.num(int(k)) });
        }
        this.bind(f.name, { ref: { root: listPlace.root, path: [...listPlace.path, { kind: "itemOpt", id: ids[k] }] } });
        const flow = this.block(f.body);
        this.truncate(mark);
        if (flow !== null) {
          return flow;
        }
      }
      return null;
    }
    const over = this.eval(f.over);
    let values: readonly Value[];
    if (over.kind === "list") {
      values = over.items.map((i) => i.value);
    } else if (over.kind === "range") {
      values = this.walkRange(over);
    } else {
      throw Failure.ir("`for` over something that isn't a list or a range");
    }
    for (let k = 0; k < values.length; k++) {
      this.step();
      const mark = this.frame().vars.length;
      if (f.position !== undefined) {
        this.bind(f.position, { value: V.num(int(k)) });
      }
      this.bind(f.name, { value: values[k] });
      const flow = this.block(f.body);
      this.truncate(mark);
      if (flow !== null) {
        return flow;
      }
    }
    return null;
  }

  /** The numbers a range walks: from its low end to its high one, by its step (1 when none). */
  walkRange(r: { readonly low: Value | null; readonly high: Value | null; readonly step: Value | null }): Value[] {
    const low = r.low !== null ? V.asNum(r.low) : undefined;
    if (low === undefined) {
      throw Failure.ir("a range with no start can't be walked");
    }
    const step = (r.step !== null ? V.asNum(r.step) : undefined) ?? int(1);
    if (step.isZero()) {
      throw Failure.ofLimit("Items", "a range walked by a step of 0");
    }
    const high = r.high !== null ? V.asNum(r.high) : undefined;
    const down = step.isNegative();
    const out: Value[] = [];
    let x = low;
    for (;;) {
      if (high !== undefined && ((!down && x.gt(high)) || (down && x.lt(high)))) {
        break;
      }
      if (out.length >= MAX_ITEMS) {
        throw Failure.ofLimit("Items", "a range of more than 10,000 items");
      }
      out.push(V.num(x));
      const from = x;
      x = numOp(() => from.add(step));
    }
    return out;
  }

  private patterns(pats: readonly ir.Pattern[], v: Value): boolean {
    for (const p of pats) {
      let hit = false;
      if ("case" in p) {
        const c = p.case;
        if (v.kind === "case") {
          if (v.ty === c.enum && v.name === c.name) {
            const binds = c.binds ?? EMPTY;
            const n = Math.min(binds.length, v.values.length);
            for (let k = 0; k < n; k++) {
              this.bind(binds[k], { value: v.values[k][1] });
            }
            hit = true;
          }
        } else if (v.kind === "opt") {
          if (c.name === "SOME" && v.value !== null) {
            const name = c.binds?.[0];
            if (name !== undefined) {
              this.bind(name, { value: v.value });
            }
            hit = true;
          } else if (c.name === "NONE" && v.value === null) {
            hit = true;
          }
        } else if (v.kind === "bool") {
          hit = c.name === (v.b ? "TRUE" : "FALSE");
        }
      } else if ("num" in p) {
        if (v.kind === "num") {
          const n = Num.literal(p.num);
          hit = n !== null && n.equals(v.n);
        }
      } else if ("text" in p) {
        hit = v.kind === "text" && v.s === p.text;
      } else if ("bool" in p) {
        hit = v.kind === "bool" && v.b === p.bool;
      }
      if (hit) {
        return true;
      }
    }
    return false;
  }

  // ---- expressions

  eval(e: ir.Expr): Value {
    switch (tag(e)) {
      case "num": {
        const s = (e as { num: string }).num;
        const n = Num.literal(s);
        if (n === null) {
          throw Failure.ir(`\`${s}\` is not a number`);
        }
        return V.num(n);
      }
      case "text":
        return V.text((e as { text: string }).text);
      case "bool":
        return V.bool((e as { bool: boolean }).bool);
      case "duration": {
        const n = Num.literal((e as { duration: string }).duration);
        if (n === null) {
          throw Failure.ir("a duration that isn't a number");
        }
        return V.duration(n);
      }
      case "list": {
        const items = (e as { list: ir.Expr[] }).list;
        const out: Value[] = new Array(items.length);
        for (let k = 0; k < items.length; k++) {
          out[k] = this.eval(items[k]);
        }
        return this.makeList(out);
      }
      case "record": {
        const r = (e as { record: ir.ExprRecord }).record;
        return this.makeRecord(r.type, this.given(r.fields), false);
      }
      case "case": {
        const c = (e as { case: ir.ExprCase }).case;
        const values: Entry[] = [];
        for (const [k, x] of V.sortedEntries(c.values)) {
          values.push([k, this.eval(x)]);
        }
        return V.caseOf(c.enum, c.name, this.orderCaseValues(c.enum, c.name, values));
      }
      case "some":
        return V.some(this.eval((e as { some: ir.Expr }).some));
      case "none":
        return V.none();
      case "range": {
        const r = (e as { range: ir.ExprRange }).range;
        const low = r.low !== undefined ? this.eval(r.low) : null;
        const high = r.high !== undefined ? this.eval(r.high) : null;
        const step = r.step !== undefined ? this.eval(r.step) : null;
        return { kind: "range", low, high, step };
      }
      case "token": {
        const name = (e as { token: string }).token;
        const dot = name.lastIndexOf(".");
        if (dot < 0) {
          throw Failure.ir("a token without a case");
        }
        return V.caseOf(name.slice(0, dot), name.slice(dot + 1));
      }
      case "tokval": {
        const t = (e as { tokval: ir.ExprTokval }).tokval;
        const v = this.eval(t.value);
        const field = this.caseFields(t.type, t.name)[0] ?? "value";
        return V.caseOf(t.type, t.name, [[field, v]]);
      }
      case "rich":
        return this.rich((e as { rich: ir.Rich }).rich);
      case "template":
        return this.template((e as { template: ir.ExprTemplate }).template);
      case "view": {
        const v = (e as { view: ir.ViewValue }).view;
        const args = new Map<string, Value>();
        for (const [k, x] of V.sortedEntries(v.args)) {
          args.set(k, this.eval(x));
        }
        const captured = this.frame().vars.slice();
        return { kind: "view", widget: v.widget, args, slots: v.slots ?? {}, events: v.events ?? {}, exprs: v.args, captured, owner: this.owner() };
      }
      case "get":
        return this.get((e as { get: ir.Get }).get);
      case "bind":
        throw new Failure("NotConstant", `binding ${(e as { bind: string }).bind} is worked out when the page runs`);
      case "field": {
        const f = (e as { field: ir.ExprField }).field;
        const v = this.eval(f.value);
        return this.field(v, f.name);
      }
      case "call": {
        const c = (e as { call: ir.Call }).call;
        const v = this.callExpr(c);
        if (v === undefined) {
          throw Failure.ir(`\`${c.name}\` returns nothing`);
        }
        return v;
      }
      case "apply": {
        const a = (e as { apply: ir.ExprApply }).apply;
        const f = this.eval(a.fn);
        const args = this.args(a.args);
        const v = this.apply(f, args);
        if (v === undefined) {
          throw Failure.ir("a fn value that returns nothing");
        }
        return v;
      }
      case "op":
        return this.op((e as { op: ir.ExprOp }).op);
      case "show": {
        const v = this.eval((e as { show: ir.ExprShow }).show.value);
        return V.text(this.show(v));
      }
      case "fn": {
        const l = (e as { fn: ir.Lambda }).fn;
        return { kind: "fn", params: l.params, body: l.body, captured: this.frame().vars.slice(), owner: this.owner() };
      }
      case "place": {
        const p = this.place((e as { place: ir.Place }).place);
        return this.readPlace(p);
      }
      case "try":
        return this.tryValue((e as { try: ir.ExprTry }).try.value);
      case "with": {
        const w = (e as { with: ir.ExprWith }).with;
        const base = this.eval(w.value);
        return this.with(base, this.given(w.fields), false);
      }
    }
    throw Failure.ir(`an expression \`${tag(e)}\` this evaluator doesn't know`);
  }

  /** A record literal's fields, worked out in their names' order. */
  private given(fields: { [key: string]: ir.Expr }): [string, Value][] {
    const out: [string, Value][] = [];
    for (const [k, x] of V.sortedEntries(fields)) {
      out.push([k, this.eval(x)]);
    }
    return out;
  }

  private get(g: ir.Get): Value {
    let outer: Outer;
    if ("local" in g) {
      const k = this.lookup(g.local);
      if (k < 0) {
        throw Failure.ir(`no local \`${g.local}\``);
      }
      const b = this.frame().vars[k][1];
      return "value" in b ? b.value : this.readPlace(b.ref);
    } else if ("input" in g) {
      outer = { kind: "input", name: g.input };
    } else if ("cell" in g) {
      outer = { kind: "cell", name: g.cell };
    } else if ("$state" in g) {
      outer = { kind: "state", name: g.$state };
    } else if ("let" in g) {
      outer = { kind: "let", name: g.let };
    } else if ("slot" in g) {
      outer = { kind: "slot", name: g.slot };
    } else if ("extern" in g) {
      outer = { kind: "extern", name: g.extern };
    } else if ("token" in g) {
      return this.eval({ token: g.token });
    } else {
      throw Failure.ir(`a read \`${tag(g)}\` this evaluator doesn't know`);
    }
    return this.hostRead(outer, this.owner());
  }

  field(v: Value, name: string): Value {
    if (v.kind === "record") {
      const x = V.entry(v.fields, name);
      if (x === undefined) {
        throw Failure.ir(`\`${v.ty}\` has no field \`${name}\``);
      }
      return x;
    }
    if (v.kind === "view") {
      const x = v.args.get(name);
      if (x === undefined) {
        throw Failure.ir(`the view has no input \`${name}\``);
      }
      return x;
    }
    // a token's record value lets its fields through: color.INK.light
    if (v.kind === "case" && this.prog.tokens.has(v.ty)) {
      const value = this.host.tokenValue !== undefined ? this.host.tokenValue(this, v) : this.defaultTokenValue(v);
      return this.field(value, name);
    }
    throw Failure.ir(`no field \`${name}\` on a ${V.typeName(v)}`);
  }

  defaultTokenValue(c: CaseValue): Value {
    const t = this.prog.tokens.get(c.ty);
    if (t === undefined) {
      throw Failure.ir(`\`${c.ty}\` is not a token type`);
    }
    if (c.values.length > 0) {
      return c.values[0][1];
    }
    if (!has(t.values, c.name)) {
      throw Failure.ir(`no value for \`${c.ty}.${c.name}\``);
    }
    return this.eval(t.values[c.name]);
  }

  private caseDecl(ty: string, name: string): ir.CaseDecl | undefined {
    const cases = this.prog.enums.get(ty)?.cases ?? this.prog.tokens.get(ty)?.cases;
    return cases?.find((c) => c.name === name);
  }

  private caseFields(ty: string, name: string): string[] {
    return (this.caseDecl(ty, name)?.fields ?? EMPTY).map((f) => f.name);
  }

  private orderCaseValues(ty: string, name: string, values: Entry[]): Entry[] {
    const order = this.caseFields(ty, name);
    if (order.length === 0) {
      return values;
    }
    const out: Entry[] = [];
    for (const f of order) {
      const found = values.find(([k]) => k === f);
      if (found !== undefined) {
        out.push(found);
      }
    }
    return out;
  }

  private args(args: readonly ir.Expr[]): Binding[] {
    const out: Binding[] = new Array(args.length);
    for (let k = 0; k < args.length; k++) {
      const a = args[k];
      out[k] = "place" in a ? { ref: this.place(a.place) } : { value: this.eval(a) };
    }
    return out;
  }

  valueOf(b: Binding): Value {
    return "value" in b ? b.value : this.readPlace(b.ref);
  }

  private callExpr(c: ir.Call): Value | undefined {
    const args = this.args(c.args);
    return this.call(c.name, args);
  }

  /** Calls a fn by its full name: a native, an extern, one written in MKP, or an interface's.
   * `undefined` when it returns nothing. */
  call(name: string, args: readonly Binding[]): Value | undefined {
    this.step();
    const f = this.prog.fns.get(name);
    if (f !== undefined) {
      return this.runFn(f.params, f.body, args, undefined);
    }
    if (natives.exists(name)) {
      return natives.run(this, name, args);
    }
    const ext = this.prog.externs.get(name);
    if (ext !== undefined) {
      const values: Value[] = [];
      for (const a of args) {
        values.push(this.valueOf(a));
      }
      if (this.host.callExtern !== undefined) {
        const answer = this.host.callExtern(this, name, values);
        if (answer !== undefined) {
          return answer === null ? undefined : answer;
        }
      }
      if (ext.default !== undefined && ext.default.length > 0) {
        return this.runFn(ext.params, ext.default, args, undefined);
      }
      throw new Failure("NotConstant", `nobody supplies \`${name}\``);
    }
    const dot = name.lastIndexOf(".");
    if (dot >= 0) {
      const iface = name.slice(0, dot);
      if (this.prog.interfaces.has(iface)) {
        return this.dispatch(iface, name.slice(dot + 1), args);
      }
    }
    throw Failure.ir(`no fn \`${name}\``);
  }

  /** An interface's fn, sent to the fn of the first argument's own type. */
  private dispatch(iface: string, f: string, args: readonly Binding[]): Value | undefined {
    if (args.length === 0) {
      throw Failure.ir("an interface fn with no value");
    }
    const first = this.valueOf(args[0]);
    const own = `${V.typeName(first)}.${f}`;
    if (this.prog.fns.has(own) || natives.exists(own) || this.prog.externs.has(own)) {
      return this.call(own, args);
    }
    // what the language gives every type: same field by field, and enums in their order
    if (iface === "core/same" && f === "same") {
      const b = this.valueOf(args[1]);
      return V.bool(this.equal(first, b));
    }
    if (iface === "core/ordered" && f === "before") {
      const b = this.valueOf(args[1]);
      return V.bool(this.before(first, b));
    }
    if (iface === "core/shown" && f === "show") {
      return V.text(this.show(first));
    }
    throw Failure.ir(`\`${V.typeName(first)}\` has no fn \`${f}\``);
  }

  private runFn(params: readonly ir.Param[], body: readonly ir.Stmt[], args: readonly Binding[], closure: FnValue | undefined): Value | undefined {
    if (this.depth >= MAX_DEPTH) {
      throw Failure.ofLimit("Depth", "calls more than 64 deep");
    }
    const vars: Var[] = [];
    let owner = this.owner();
    if (closure !== undefined) {
      for (const c of closure.captured) {
        vars.push(c);
      }
      owner = closure.owner;
    }
    const n = Math.min(params.length, args.length);
    for (let k = 0; k < n; k++) {
      const p = params[k];
      const a = args[k];
      vars.push([p.name, p.mut === true ? a : { value: this.valueOf(a) }]);
    }
    this.depth += 1;
    this.frames.push({ vars, owner });
    let flow: Flow;
    try {
      flow = this.block(body);
    } finally {
      this.frames.pop();
      this.depth -= 1;
    }
    return flow === null ? undefined : flow.value;
  }

  /** Calls a fn value. `undefined` when it returns nothing. */
  apply(f: Value, args: readonly Binding[]): Value | undefined {
    this.step();
    if (f.kind === "fn") {
      return this.runFn(f.params, f.body, args, f);
    }
    throw Failure.ir("a call of something that isn't a fn");
  }

  private op(op: ir.ExprOp): Value {
    const a = op.args;
    switch (op.name) {
      case "&&": {
        const l = V.asBool(this.eval(a[0])) ?? false;
        return V.bool(l && (V.asBool(this.eval(a[1])) ?? false));
      }
      case "||": {
        const l = V.asBool(this.eval(a[0])) ?? false;
        return V.bool(l || (V.asBool(this.eval(a[1])) ?? false));
      }
      case "?": {
        const c = V.asBool(this.eval(a[0])) ?? false;
        return this.eval(c ? a[1] : a[2]);
      }
      case "!":
        return V.bool(!(V.asBool(this.eval(a[0])) ?? false));
      case "-": {
        if (a.length === 1) {
          const v = this.eval(a[0]);
          if (v.kind === "num") {
            return V.num(v.n.neg());
          }
          if (v.kind === "duration") {
            return V.duration(v.n.neg());
          }
          throw Failure.ir("`-` on something that isn't a number");
        }
        break;
      }
    }
    const l = this.eval(a[0]);
    const r = this.eval(a[1]);
    switch (op.name) {
      case "==":
        return V.bool(this.equal(l, r));
      case "!=":
        return V.bool(!this.equal(l, r));
      case "<":
        return V.bool(this.before(l, r));
      case ">":
        return V.bool(this.before(r, l));
      case "<=":
        return V.bool(!this.before(r, l));
      case ">=":
        return V.bool(!this.before(l, r));
    }
    let x: Num;
    let y: Num;
    if ((l.kind === "num" && r.kind === "num") || (l.kind === "duration" && (r.kind === "duration" || r.kind === "num"))) {
      x = l.n;
      y = (r as { n: Num }).n;
    } else {
      throw Failure.ir(`\`${OP_DEBUG[op.name]}\` on values that aren't numbers`);
    }
    let n: Num;
    switch (op.name) {
      case "+":
        n = numOp(() => x.add(y));
        break;
      case "-":
        n = numOp(() => x.sub(y));
        break;
      case "*":
        n = numOp(() => x.mul(y));
        break;
      case "/":
        n = numOp(() => x.div(y));
        break;
      case "%":
        n = numOp(() => x.rem(y));
        break;
      default:
        throw Failure.ir("an operator that isn't arithmetic");
    }
    if (l.kind === "duration" && op.name !== "%") {
      return V.duration(n);
    }
    return V.num(n);
  }

  /** `==`: field by field, unless a type's pack writes its own `same`. */
  equal(a: Value, b: Value): boolean {
    switch (a.kind) {
      case "num":
        if (b.kind === "num") {
          return a.n.equals(b.n);
        }
        break;
      case "duration":
        if (b.kind === "duration") {
          return a.n.equals(b.n);
        }
        break;
      case "text":
        if (b.kind === "text") {
          return a.s === b.s;
        }
        break;
      case "bool":
        if (b.kind === "bool") {
          return a.b === b.b;
        }
        break;
      case "list":
        if (b.kind === "list") {
          if (a.items.length !== b.items.length) {
            return false;
          }
          for (let k = 0; k < a.items.length; k++) {
            if (!this.equal(a.items[k].value, b.items[k].value)) {
              return false;
            }
          }
          return true;
        }
        break;
      case "record":
        if (b.kind === "record") {
          if (a.ty !== b.ty) {
            return false;
          }
          const same = this.prog.records.get(a.ty)?.same;
          if (same !== undefined) {
            const out = this.call(same, [{ value: a }, { value: b }]);
            return out !== undefined && out.kind === "bool" ? out.b : false;
          }
          const n = Math.min(a.fields.length, b.fields.length);
          for (let k = 0; k < n; k++) {
            if (!this.equal(a.fields[k][1], b.fields[k][1])) {
              return false;
            }
          }
          return true;
        }
        break;
      case "case":
        if (b.kind === "case") {
          if (a.ty !== b.ty || a.name !== b.name || a.values.length !== b.values.length) {
            return false;
          }
          for (let k = 0; k < a.values.length; k++) {
            if (!this.equal(a.values[k][1], b.values[k][1])) {
              return false;
            }
          }
          return true;
        }
        break;
      case "opt":
        if (b.kind === "opt") {
          if (a.value === null || b.value === null) {
            return a.value === null && b.value === null;
          }
          return this.equal(a.value, b.value);
        }
        break;
    }
    // a plain value where an opt is wanted
    if (a.kind === "opt" && a.value !== null && b.kind !== "opt") {
      return this.equal(a.value, b);
    }
    if (b.kind === "opt" && b.value !== null && a.kind !== "opt") {
      return this.equal(b.value, a);
    }
    if (a.kind === "range" && b.kind === "range") {
      const parts = [
        [a.low, b.low],
        [a.high, b.high],
        [a.step, b.step],
      ] as const;
      for (const [p, q] of parts) {
        if (p === null && q === null) {
          continue;
        }
        if (p !== null && q !== null && this.equal(p, q)) {
          continue;
        }
        return false;
      }
      return true;
    }
    return false;
  }

  /** `<`: numbers and texts by value, enums in the order written, anything else by `before`. */
  before(a: Value, b: Value): boolean {
    if ((a.kind === "num" && b.kind === "num") || (a.kind === "duration" && b.kind === "duration")) {
      return a.n.lt(b.n);
    }
    if (a.kind === "text" && b.kind === "text") {
      return V.compareText(a.s, b.s) < 0;
    }
    if (a.kind === "bool" && b.kind === "bool") {
      return !a.b && b.b;
    }
    if (a.kind === "case" && b.kind === "case" && a.ty === b.ty) {
      const cases = this.prog.enums.get(a.ty)?.cases ?? EMPTY;
      const at = (n: string): number => {
        const k = cases.findIndex((c) => c.name === n);
        return k < 0 ? 0 : k;
      };
      return at(a.name) < at(b.name);
    }
    const out = this.call(`${V.typeName(a)}.before`, [{ value: a }, { value: b }]);
    return out !== undefined && out.kind === "bool" ? out.b : false;
  }

  /** How a value is shown in a hole (page 5). */
  show(v: Value): string {
    switch (v.kind) {
      case "num":
        return v.n.show();
      case "text":
        return v.s;
      case "bool":
        return v.b ? "true" : "false";
      case "duration":
        return natives.showDuration(v.n);
      case "opt":
        if (v.value !== null) {
          return this.show(v.value);
        }
        break;
    }
    const out = this.call(`${V.typeName(v)}.show`, [{ value: v }]);
    if (out !== undefined && out.kind === "text") {
      return out.s;
    }
    throw Failure.ir(`\`${V.typeName(v)}\` has no show`);
  }

  // ---- records

  /** A record from its fields, with the defaults it has, its rules run. With `checked`, its
   * fields' contracts are checked too, as `try` does. */
  makeRecord(ty: string, given: readonly (readonly [string, Value])[], checked: boolean): Value {
    const decl = this.prog.records.get(ty);
    if (decl === undefined) {
      // an inline record: the fields as given
      return V.record(ty, given.map(([k, v]) => [k, v] as const));
    }
    const fields: Entry[] = [];
    for (const f of decl.fields) {
      let v = given.find(([k]) => k === f.name)?.[1];
      if (v === undefined) {
        if (f.default === undefined) {
          throw Failure.ir(`\`${ty}\` is made without its field \`${f.name}\``);
        }
        v = this.eval(f.default);
      }
      if (checked && !this.fits(v, f.type)) {
        throw Failure.rule(`${short(ty)}'s ${f.name} is outside its contract`);
      }
      fields.push([f.name, v]);
    }
    const record = V.record(ty, fields);
    this.checkRequires(decl, record);
    return record;
  }

  private with(base: Value, given: readonly (readonly [string, Value])[], checked: boolean): Value {
    if (base.kind !== "record") {
      throw Failure.ir("`with` on something that isn't a record");
    }
    const fields: Entry[] = base.fields.slice();
    for (const [k, v] of given) {
      const at = fields.findIndex(([n]) => n === k);
      if (at >= 0) {
        fields[at] = [fields[at][0], v];
      }
    }
    const decl = this.prog.records.get(base.ty);
    if (checked && decl !== undefined) {
      for (const f of decl.fields) {
        const v = V.entry(fields, f.name);
        if (v !== undefined && !this.fits(v, f.type)) {
          throw Failure.rule(`${short(base.ty)}'s ${f.name} is outside its contract`);
        }
      }
    }
    const record = V.record(base.ty, fields);
    if (decl !== undefined) {
      this.checkRequires(decl, record);
    }
    return record;
  }

  private checkRequires(decl: ir.Record, record: RecordValue): void {
    if (decl.requires.length === 0) {
      return;
    }
    for (const rule of decl.requires) {
      const args: Binding[] = record.fields.map(([, v]) => ({ value: v }));
      const params: ir.Param[] = record.fields.map(([n]) => ({ name: n, type: { name: "core/any" } }));
      const out = this.runFn(params, rule.body, args, undefined);
      if (!(out !== undefined && out.kind === "bool" && out.b)) {
        throw Failure.rule(rule.message);
      }
    }
  }

  private tryValue(e: ir.Expr): Value {
    let attempt: () => Value;
    switch (tag(e)) {
      case "record": {
        const r = (e as { record: ir.ExprRecord }).record;
        const given = this.given(r.fields);
        attempt = () => this.makeRecord(r.type, given, true);
        break;
      }
      case "with": {
        const w = (e as { with: ir.ExprWith }).with;
        const base = this.eval(w.value);
        const given = this.given(w.fields);
        attempt = () => this.with(base, given, true);
        break;
      }
      case "case": {
        const c = (e as { case: ir.ExprCase }).case;
        const v = this.eval(e);
        const fields = this.caseFieldTypes(c.enum, c.name);
        if (v.kind === "case") {
          const n = Math.min(v.values.length, fields.length);
          for (let k = 0; k < n; k++) {
            if (!this.fits(v.values[k][1], fields[k])) {
              return V.none();
            }
          }
        }
        return V.some(v);
      }
      case "tokval": {
        const t = (e as { tokval: ir.ExprTokval }).tokval;
        const v = this.eval(e);
        const ty = this.caseFieldTypes(t.type, t.name)[0];
        if (v.kind === "case" && ty !== undefined && v.values.length > 0) {
          if (!this.fits(v.values[0][1], ty)) {
            return V.none();
          }
        }
        return V.some(v);
      }
      default:
        attempt = () => this.eval(e);
    }
    try {
      return V.some(attempt());
    } catch (f) {
      if (f instanceof Failure && f.kind === "Rule") {
        this.lastRule = f.rule;
        return V.none();
      }
      throw f;
    }
  }

  private caseFieldTypes(ty: string, name: string): ir.Type[] {
    return (this.caseDecl(ty, name)?.fields ?? EMPTY).map((f) => f.type);
  }

  /** Whether a value is inside a type's contract, its aliases' contracts included. */
  fits(v: Value, ty: ir.Type): boolean {
    const contracts: ir.Contract[] = [];
    let t = ty;
    let guard = 0;
    for (;;) {
      if (t.contract !== undefined) {
        contracts.push(t.contract);
      }
      const next = this.prog.aliases.get(t.name);
      if (next !== undefined && guard < 16) {
        t = next;
        guard += 1;
      } else {
        break;
      }
    }
    for (const c of contracts) {
      if (!this.fitsContract(v, c)) {
        return false;
      }
    }
    // the items of a list, and the value inside an opt
    if (v.kind === "list" && t.name === "core/list") {
      const item = t.args?.[0];
      if (item !== undefined) {
        for (const i of v.items) {
          if (!this.fits(i.value, item)) {
            return false;
          }
        }
      }
    } else if (v.kind === "opt" && v.value !== null && t.name === "core/opt") {
      const inner = t.args?.[0];
      if (inner !== undefined) {
        return this.fits(v.value, inner);
      }
    }
    return true;
  }

  private fitsContract(v: Value, c: ir.Contract): boolean {
    if (c.range !== undefined) {
      if (c.range.low !== undefined) {
        const low = this.eval(c.range.low);
        if (this.before(v, low)) {
          return false;
        }
      }
      if (c.range.high !== undefined) {
        const high = this.eval(c.range.high);
        if (this.before(high, v)) {
          return false;
        }
      }
    }
    if (c.step !== undefined) {
      const step = V.asNum(this.eval(c.step)) ?? int(1);
      const low = c.range?.low;
      const from = low !== undefined ? (V.asNum(this.eval(low)) ?? Num.zero()) : Num.zero();
      const x = V.asNum(v);
      if (x !== undefined) {
        const k = numOp(() => x.sub(from).div(step));
        if (!k.isInt()) {
          return false;
        }
      }
    }
    if (c.length !== undefined) {
      const n = v.kind === "text" ? natives.textLength(v.s) : v.kind === "list" ? v.items.length : 0;
      if (c.length.low !== undefined) {
        const l = V.asNum(this.eval(c.length.low))?.toI64() ?? null;
        if (l !== null && n < l) {
          return false;
        }
      }
      if (c.length.high !== undefined) {
        const h = V.asNum(this.eval(c.length.high))?.toI64() ?? null;
        if (h !== null && n > h) {
          return false;
        }
      }
    }
    if (c.only !== undefined && c.only.length > 0) {
      let any = false;
      for (const x of c.only) {
        const o = this.eval(x);
        if (this.equal(v, o)) {
          any = true;
          break;
        }
      }
      if (!any) {
        return false;
      }
    }
    return true;
  }

  // ---- prose values

  private rich(r: ir.Rich): Value {
    const segments: Value[] = [];
    for (const seg of r.segments) {
      const s = seg.segment;
      const value = s.value !== undefined ? this.eval(s.value) : undefined;
      let p: Value;
      switch (s.part) {
        case "TEXT":
        case "CODE":
          p = V.caseOf("core/part", s.part, [["value", value ?? V.text("")]]);
          break;
        case "MATH":
          if (value === undefined) {
            throw Failure.ir("maths with no TeX");
          }
          p = V.caseOf("core/part", "MATH", [["tex", value]]);
          break;
        case "NOTE":
          p = V.caseOf("core/part", "NOTE", [["mark", value ?? V.text("")]]);
          break;
        case "VIEW":
          if (value === undefined) {
            throw Failure.ir("a view segment with no view");
          }
          p = V.caseOf("core/part", "VIEW", [["child", value]]);
          break;
        case "IMAGE": {
          const src = s.src !== undefined ? this.eval(s.src) : V.text("");
          const alt = s.alt !== undefined ? this.eval(s.alt) : V.text("");
          p = V.caseOf("core/part", "IMAGE", [
            ["src", src],
            ["alt", alt],
          ]);
          break;
        }
        default:
          p = V.caseOf("core/part", "BREAK");
      }
      const m = s.marks ?? {};
      const link = m.link !== undefined ? V.some(this.eval(m.link)) : V.none();
      const marks = V.record("core/marks", [
        ["bold", V.bool(m.bold === true)],
        ["italic", V.bool(m.italic === true)],
        ["strike", V.bool(m.strike === true)],
        ["link", link],
      ]);
      segments.push(
        V.record("core/segment", [
          ["part", p],
          ["marks", marks],
        ]),
      );
    }
    const list = this.makeList(segments);
    return V.record("core/rich_text", [["segments", list]]);
  }

  private template(t: ir.ExprTemplate): Value {
    if (t.type.name === "core/text") {
      let out = "";
      for (let k = 0; k < t.pieces.length; k++) {
        out += t.pieces[k];
        const h = t.holes[k];
        if (h !== undefined) {
          const v = this.eval(h);
          out += this.show(v);
        }
      }
      return V.text(out);
    }
    const pieces = this.makeList(t.pieces.map((p) => V.text(p)));
    const holes: Value[] = [];
    for (const h of t.holes) {
      let v = this.eval(h);
      const isView = v.kind === "view";
      if (!isView) {
        v = V.text(this.show(v));
      }
      holes.push(V.caseOf("core/hole", isView ? "VIEW" : "TEXT", [[isView ? "child" : "value", v]]));
    }
    const holeList = this.makeList(holes);
    return V.record("core/template", [
      ["pieces", pieces],
      ["holes", holeList],
    ]);
  }
}

function findItem(items: readonly Item[], id: number): Item | undefined {
  for (const i of items) {
    if (i.id === id) {
      return i;
    }
  }
  return undefined;
}

/** Writes `value` at `path` inside `whole`: a new value along the path, the rest shared. */
function writePath(whole: Value, path: readonly Step[], k: number, value: Value): Value {
  if (k === path.length) {
    return value;
  }
  const s = path[k];
  switch (s.kind) {
    case "field":
      if (whole.kind === "record") {
        const at = whole.fields.findIndex(([n]) => n === s.name);
        if (at < 0) {
          throw Failure.ir(`no field \`${s.name}\``);
        }
        const fields = whole.fields.slice();
        fields[at] = [fields[at][0], writePath(fields[at][1], path, k + 1, value)];
        return V.record(whole.ty, fields);
      }
      break;
    case "index":
      if (whole.kind === "list") {
        const item = s.index >= 0 ? whole.items[s.index] : undefined;
        if (item === undefined) {
          throw new Failure("Position", "a position outside the list");
        }
        const items = whole.items.slice();
        items[s.index] = { id: item.id, value: writePath(item.value, path, k + 1, value) };
        return { kind: "list", items };
      }
      break;
    case "item":
    case "itemOpt":
      if (whole.kind === "list") {
        const at = whole.items.findIndex((i) => i.id === s.id);
        if (at < 0) {
          throw new Failure("Removed", "an item used after it was removed");
        }
        const items = whole.items.slice();
        items[at] = { id: items[at].id, value: writePath(items[at].value, path, k + 1, value) };
        return { kind: "list", items };
      }
      break;
    case "inside":
      if (whole.kind === "opt") {
        if (whole.value === null) {
          throw new Failure("Removed", "an opt that is empty");
        }
        return V.some(writePath(whole.value, path, k + 1, value));
      }
      break;
  }
  throw Failure.ir("a place that doesn't fit its value");
}
