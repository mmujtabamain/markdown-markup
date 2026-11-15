// Values while a page runs, or while a constant is worked out. A port of
// targets/rust/eval/src/value.rs.
//
// Values have no cycles and are never changed in place: a write makes a new value along its path
// (page 2: assigning makes a value of its own, and the implementer copies only when one of them is
// changed), so a value can be shared freely. Every item of a list has a hidden identity, kept
// through `add`, `insert`, `remove`, `move`, `sort` and writes, so `mut for` can find the real item
// and rows can follow their items.

import type * as ir from "../generated/ir.js";
import { Num } from "./num.js";
import type { Binding } from "./interp.js";

export interface Item {
  readonly id: number;
  readonly value: Value;
}

/** A record's field or a case's value: its name and its value. */
export type Entry = readonly [name: string, value: Value];

export interface NumValue {
  readonly kind: "num";
  readonly n: Num;
}

export interface TextValue {
  readonly kind: "text";
  readonly s: string;
}

export interface BoolValue {
  readonly kind: "bool";
  readonly b: boolean;
}

/** Milliseconds. */
export interface DurationValue {
  readonly kind: "duration";
  readonly n: Num;
}

export interface ListValue {
  readonly kind: "list";
  readonly items: readonly Item[];
}

export interface RecordValue {
  readonly kind: "record";
  readonly ty: string;
  /** In the order the record declares them. */
  readonly fields: readonly Entry[];
}

/** An enum's case, a token among them, with the values it carries. */
export interface CaseValue {
  readonly kind: "case";
  /** The enum or token type: `core/stage`, `core/color`. */
  readonly ty: string;
  readonly name: string;
  readonly values: readonly Entry[];
}

export interface OptValue {
  readonly kind: "opt";
  /** `null` for `opt.NONE`. */
  readonly value: Value | null;
}

export interface RangeValue {
  readonly kind: "range";
  readonly low: Value | null;
  readonly high: Value | null;
  readonly step: Value | null;
}

/** A lambda: its code, and what it saw when it was made. */
export interface FnValue {
  readonly kind: "fn";
  readonly params: readonly ir.Param[];
  readonly body: readonly ir.Stmt[];
  readonly captured: readonly [name: string, binding: Binding][];
  /** The widget instance it was made in, for its cells and inputs. */
  readonly owner: number | undefined;
}

/** A view as a value: a description of a call, drawn where it is placed. */
export interface ViewValue {
  readonly kind: "view";
  readonly widget: string;
  /** Its inputs' values, by name, in name order. */
  readonly args: ReadonlyMap<string, Value>;
  readonly slots: { readonly [name: string]: ir.Node[] };
  readonly events: { readonly [name: string]: string };
  /** Its inputs' expressions, as the IR gives them. */
  readonly exprs: { readonly [name: string]: ir.Expr };
  /** The locals where it was made, which its slots' nodes read, as a lambda's body does. */
  readonly captured: readonly [name: string, binding: Binding][];
  /** The widget instance it was made in, for its cells and inputs. */
  readonly owner: number | undefined;
}

export type Value =
  | NumValue
  | TextValue
  | BoolValue
  | DurationValue
  | ListValue
  | RecordValue
  | CaseValue
  | OptValue
  | RangeValue
  | FnValue
  | ViewValue;

const TRUE: BoolValue = { kind: "bool", b: true };
const FALSE: BoolValue = { kind: "bool", b: false };
const NONE: OptValue = { kind: "opt", value: null };

/** A number: a Num, or a JS whole number. */
export function num(n: Num | number): Value {
  return { kind: "num", n: typeof n === "number" ? Num.int(n) : n };
}

export function text(s: string): Value {
  return { kind: "text", s };
}

export function bool(b: boolean): Value {
  return b ? TRUE : FALSE;
}

/** A duration of `ms` milliseconds: a Num, or a JS whole number. */
export function duration(ms: Num | number): Value {
  return { kind: "duration", n: typeof ms === "number" ? Num.int(ms) : ms };
}

export function some(v: Value): Value {
  return { kind: "opt", value: v };
}

export function none(): Value {
  return NONE;
}

/** A list of these values, each with a new identity: `ids.next` is the last one given out. */
export function list(values: readonly Value[], ids: { next: number }): Value {
  const items: Item[] = new Array(values.length);
  for (let k = 0; k < values.length; k++) {
    ids.next += 1;
    items[k] = { id: ids.next, value: values[k] };
  }
  return { kind: "list", items };
}

export function record(ty: string, fields: readonly Entry[]): RecordValue {
  return { kind: "record", ty, fields };
}

export function caseOf(ty: string, name: string, values: readonly Entry[] = []): CaseValue {
  return { kind: "case", ty, name, values };
}

/** A record's field, or a case's value, by name: the first of that name. */
export function entry(entries: readonly Entry[], name: string): Value | undefined {
  for (const [n, v] of entries) {
    if (n === name) {
      return v;
    }
  }
  return undefined;
}

export function asNum(v: Value): Num | undefined {
  return v.kind === "num" || v.kind === "duration" ? v.n : undefined;
}

export function asBool(v: Value): boolean | undefined {
  return v.kind === "bool" ? v.b : undefined;
}

export function asText(v: Value): string | undefined {
  return v.kind === "text" ? v.s : undefined;
}

/** The name of the value's own type, which an interface's fn is sent to. */
export function typeName(v: Value): string {
  switch (v.kind) {
    case "num":
      return "core/number";
    case "text":
      return "core/text";
    case "bool":
      return "core/bool";
    case "duration":
      return "core/duration";
    case "list":
      return "core/list";
    case "record":
      return v.ty;
    case "case":
      return v.ty;
    case "opt":
      return "core/opt";
    case "range":
      return "core/range";
    case "fn":
      return "fn";
    case "view":
      return "core/view";
  }
}

/** Code point order, as Rust compares strings (UTF-8 bytes): -1, 0 or 1. */
export function compareText(a: string, b: string): number {
  const n = Math.min(a.length, b.length);
  for (let k = 0; k < n; k++) {
    let x = a.charCodeAt(k);
    let y = b.charCodeAt(k);
    if (x !== y) {
      // surrogates (U+D800..U+DFFF) stand for code points above U+FFFF: put them after U+E000..U+FFFF
      if (x >= 0xd800 && y >= 0xd800) {
        x = x >= 0xe000 ? x - 0x800 : x + 0x2000;
        y = y >= 0xe000 ? y - 0x800 : y + 0x2000;
      }
      return x < y ? -1 : 1;
    }
  }
  return a.length === b.length ? 0 : a.length < b.length ? -1 : 1;
}

/** An object's entries in its keys' order, as a Rust BTreeMap iterates them. */
export function sortedEntries<T>(o: { readonly [key: string]: T } | undefined): [string, T][] {
  if (o === undefined) {
    return [];
  }
  const out = Object.entries(o);
  if (out.length > 1) {
    out.sort((p, q) => compareText(p[0], q[0]));
  }
  return out;
}

function objectOf<T>(entries: Iterable<readonly [string, T]>): { [key: string]: T } {
  // a BTreeMap: keys in order, the last of a name wins
  const map = new Map<string, T>();
  for (const [k, v] of entries) {
    map.set(k, v);
  }
  const out: { [key: string]: T } = {};
  for (const k of [...map.keys()].sort(compareText)) {
    Object.defineProperty(out, k, { value: map.get(k), enumerable: true, writable: true, configurable: true });
  }
  return out;
}

/** The IR's form of a value, for the IR, observations and Markdown. */
export function toIr(v: Value): ir.Expr {
  switch (v.kind) {
    case "num":
      return { num: v.n.show() };
    case "text":
      return { text: v.s };
    case "bool":
      return { bool: v.b };
    case "duration":
      return { duration: v.n.show() };
    case "list":
      return { list: v.items.map((i) => toIr(i.value)) };
    case "record":
      return { record: { fields: objectOf(v.fields.map(([n, x]) => [n, toIr(x)] as const)), type: v.ty } };
    case "case": {
      const c: ir.ExprCase = { enum: v.ty, name: v.name };
      if (v.values.length > 0) {
        c.values = objectOf(v.values.map(([n, x]) => [n, toIr(x)] as const));
      }
      return { case: c };
    }
    case "opt":
      return v.value === null ? { none: {} } : { some: toIr(v.value) };
    case "range": {
      const r: ir.ExprRange = {};
      if (v.high !== null) {
        r.high = toIr(v.high);
      }
      if (v.low !== null) {
        r.low = toIr(v.low);
      }
      if (v.step !== null) {
        r.step = toIr(v.step);
      }
      return { range: r };
    }
    case "fn":
      return { text: "<fn>" };
    case "view": {
      const view: ir.ViewValue = { args: objectOf([...v.args].map(([k, x]) => [k, toIr(x)] as const)), widget: v.widget };
      if (Object.keys(v.events).length > 0) {
        view.events = { ...v.events };
      }
      if (Object.keys(v.slots).length > 0) {
        view.slots = { ...v.slots };
      }
      return { view };
    }
  }
}

/** The helpers, under the type's name: `Value.text("a")`, `Value.some(v)`, `Value.none()`. */
export const Value = {
  num,
  text,
  bool,
  duration,
  some,
  none,
  list,
  record,
  caseOf,
  entry,
  asNum,
  asBool,
  asText,
  typeName,
  toIr,
};
