// The native fns: what core declares `extern fn` with no body, because MKP can't do it in terms of
// anything else (page 5). List storage, Unicode text, exact numbers and their maths, the interface
// fns of the built-in types, a range's ends, a duration's milliseconds, and `clamp`. A port of
// targets/rust/eval/src/natives.rs.
//
// Text is a sequence of Unicode scalar values, as Rust's `str`: lengths, positions and order count
// code points, not UTF-16 units.

import { Num, NumError } from "./num.js";
import * as V from "./value.js";
import type { Item, ListValue, Value } from "./value.js";
import { Failure, MAX_ITEMS, numOp } from "./interp.js";
import type { Binding, Machine } from "./interp.js";

/** Every native fn, by its full name. */
export const NATIVES: readonly string[] = [
  "core/number.show", "core/number.same", "core/number.before", "core/number.add", "core/number.sub", "core/number.scale",
  "core/duration.show", "core/duration.same", "core/duration.before", "core/duration.add", "core/duration.sub", "core/duration.scale",
  "core/text.show", "core/text.same", "core/text.before",
  "core/bool.show", "core/bool.same", "core/bool.before",
  "core/range.low", "core/range.high", "core/range.stride", "core/range.has",
  "core/duration.ms",
  "core/number.round", "core/number.floor", "core/number.ceil", "core/number.abs", "core/number.fmt", "core/number.sign",
  "core/number.sqrt", "core/number.pow", "core/number.exp", "core/number.ln",
  "core/number.sin", "core/number.cos", "core/number.tan", "core/number.asin", "core/number.acos", "core/number.atan",
  "core/number.atan2", "core/number.sinh", "core/number.cosh", "core/number.tanh",
  "core/list.len", "core/list.at", "core/list.add", "core/list.insert", "core/list.remove_at", "core/list.move", "core/list.remove", "core/list.sort",
  "core/text.len", "core/text.slice", "core/text.chars", "core/text.lower", "core/text.upper", "core/text.trim", "core/text.has", "core/text.split", "core/text.number",
  "core/ordered.clamp",
  "core/text.of_code",
];

const NATIVE_SET: ReadonlySet<string> = new Set(NATIVES);

/** core's bodyless `extern fn`s that only a target can supply, from what it runs on (page 5,
 * plan tab 14): every other bodyless one is a native. */
export const TARGET_ONLY: readonly string[] = ["core/moment.local"];

export function exists(name: string): boolean {
  return NATIVE_SET.has(name);
}

const THOUSAND = Num.int(1000);

/** Whole seconds as `2s`, anything else as `250ms`. */
export function showDuration(ms: Num): string {
  try {
    const s = ms.div(THOUSAND);
    if (s.isInt()) {
      return `${s.show()}s`;
    }
  } catch (e) {
    if (!(e instanceof NumError)) {
      throw e;
    }
  }
  return `${ms.show()}ms`;
}

// ---- Unicode text, by code points

let lastText = "";
let lastPlain = true;

/** Whether a text has no character above U+FFFF, so its UTF-16 units are its characters. */
function plain(t: string): boolean {
  if (t !== lastText) {
    lastText = t;
    lastPlain = !/[\ud800-\udfff]/.test(t);
  }
  return lastPlain;
}

/** The number of characters (Unicode scalar values) in a text. */
export function textLength(t: string): number {
  if (plain(t)) {
    return t.length;
  }
  let n = 0;
  for (const _ of t) {
    n += 1;
  }
  return n;
}

function chars(t: string): string[] {
  return plain(t) ? t.split("") : Array.from(t);
}

function sliceChars(t: string, start: number, count: number): string {
  if (plain(t)) {
    return start >= t.length ? "" : t.substring(start, start + Math.min(count, t.length));
  }
  let out = "";
  let k = 0;
  for (const c of t) {
    if (k >= start + count) {
      break;
    }
    if (k >= start) {
      out += c;
    }
    k += 1;
  }
  return out;
}

/** Unicode's White_Space, as Rust's `char::is_whitespace` and `str::trim`. */
function isWhitespace(c: number): boolean {
  return (
    (c >= 0x09 && c <= 0x0d) ||
    c === 0x20 ||
    c === 0x85 ||
    c === 0xa0 ||
    c === 0x1680 ||
    (c >= 0x2000 && c <= 0x200a) ||
    c === 0x2028 ||
    c === 0x2029 ||
    c === 0x202f ||
    c === 0x205f ||
    c === 0x3000
  );
}

function trim(t: string): string {
  let a = 0;
  let b = t.length;
  while (a < b && isWhitespace(t.charCodeAt(a))) {
    a += 1;
  }
  while (b > a && isWhitespace(t.charCodeAt(b - 1))) {
    b -= 1;
  }
  return t.slice(a, b);
}

function digits(s: string): boolean {
  if (s.length === 0) {
    return false;
  }
  for (let k = 0; k < s.length; k++) {
    const c = s.charCodeAt(k);
    if (c < 48 || c > 57) {
      return false;
    }
  }
  return true;
}

// ---- arguments

function num(m: Machine, args: readonly Binding[], k: number): Num {
  const n = V.asNum(m.valueOf(args[k]));
  if (n === undefined) {
    throw Failure.ir("a native fn given something that isn't a number");
  }
  return n;
}

function text(m: Machine, args: readonly Binding[], k: number): string {
  const v = m.valueOf(args[k]);
  if (v.kind !== "text") {
    throw Failure.ir("a native fn given something that isn't a text");
  }
  return v.s;
}

function list(m: Machine, args: readonly Binding[], k: number): ListValue {
  const v = m.valueOf(args[k]);
  if (v.kind !== "list") {
    throw Failure.ir("a native fn given something that isn't a list");
  }
  return v;
}

function whole(n: Num, what: string): number {
  const k = n.toI64();
  if (k === null) {
    throw new Failure("Position", `${what} that isn't a whole number`);
  }
  return k;
}

/** Writes a changed list back through `mut self`. */
function setList(m: Machine, args: readonly Binding[], items: Item[]): void {
  if (items.length > MAX_ITEMS) {
    throw Failure.ofLimit("Items", "a list of more than 10,000 items");
  }
  const self = args[0];
  if (!("ref" in self)) {
    throw Failure.ir("a list fn that changes its list, given a list it can't write");
  }
  m.writePlace(self.ref, { kind: "list", items });
}

function someNum(r: Num | null): Value {
  return r === null ? V.none() : V.some(V.num(r));
}

/** Runs the native fn `name` (one `exists` names): its value, or `undefined` when it returns
 * nothing (the list fns that change their list). */
export function run(m: Machine, name: string, a: readonly Binding[]): Value | undefined {
  const short = name.slice("core/".length);
  switch (short) {
    case "number.show":
      return V.text(num(m, a, 0).show());
    case "number.same":
    case "duration.same": {
      const x = num(m, a, 0);
      return V.bool(x.equals(num(m, a, 1)));
    }
    case "number.before":
    case "duration.before": {
      const x = num(m, a, 0);
      return V.bool(x.lt(num(m, a, 1)));
    }
    case "number.add": {
      const x = num(m, a, 0);
      const y = num(m, a, 1);
      return V.num(numOp(() => x.add(y)));
    }
    case "number.sub": {
      const x = num(m, a, 0);
      const y = num(m, a, 1);
      return V.num(numOp(() => x.sub(y)));
    }
    case "number.scale": {
      const x = num(m, a, 0);
      const y = num(m, a, 1);
      return V.num(numOp(() => x.mul(y)));
    }
    case "duration.show":
      return V.text(showDuration(num(m, a, 0)));
    case "duration.add": {
      const x = num(m, a, 0);
      const y = num(m, a, 1);
      return V.duration(numOp(() => x.add(y)));
    }
    case "duration.sub": {
      const x = num(m, a, 0);
      const y = num(m, a, 1);
      return V.duration(numOp(() => x.sub(y)));
    }
    case "duration.scale": {
      const x = num(m, a, 0);
      const y = num(m, a, 1);
      return V.duration(numOp(() => x.mul(y)));
    }
    case "duration.ms":
      return V.num(num(m, a, 0));
    case "text.show":
      return V.text(text(m, a, 0));
    case "text.same": {
      const x = text(m, a, 0);
      return V.bool(x === text(m, a, 1));
    }
    case "text.before": {
      const x = text(m, a, 0);
      return V.bool(V.compareText(x, text(m, a, 1)) < 0);
    }
    case "bool.show":
      return V.text(V.asBool(m.valueOf(a[0])) ?? false ? "true" : "false");
    case "bool.same": {
      const x = V.asBool(m.valueOf(a[0]));
      return V.bool(x === V.asBool(m.valueOf(a[1])));
    }
    case "bool.before": {
      const x = V.asBool(m.valueOf(a[0])) ?? false;
      return V.bool(!x && (V.asBool(m.valueOf(a[1])) ?? false));
    }
    case "range.low":
    case "range.high":
    case "range.stride": {
      const r = m.valueOf(a[0]);
      if (r.kind !== "range") {
        throw Failure.ir("a range fn given something that isn't a range");
      }
      const part = short === "range.low" ? r.low : short === "range.high" ? r.high : r.step;
      return part === null ? V.none() : V.some(part);
    }
    case "range.has": {
      const r = m.valueOf(a[0]);
      if (r.kind !== "range") {
        throw Failure.ir("a range fn given something that isn't a range");
      }
      const x = m.valueOf(a[1]);
      if (r.low !== null && m.before(x, r.low)) {
        return V.bool(false);
      }
      if (r.high !== null && m.before(r.high, x)) {
        return V.bool(false);
      }
      const step = r.step !== null ? V.asNum(r.step) : undefined;
      const xn = V.asNum(x);
      if (step !== undefined && xn !== undefined) {
        const from = (r.low !== null ? V.asNum(r.low) : undefined) ?? Num.zero();
        if (!numOp(() => xn.sub(from).div(step)).isInt()) {
          return V.bool(false);
        }
      }
      return V.bool(true);
    }
    case "number.round":
      return V.num(num(m, a, 0).round());
    case "number.floor":
      return V.num(num(m, a, 0).floor());
    case "number.ceil":
      return V.num(num(m, a, 0).ceil());
    case "number.abs":
      return V.num(num(m, a, 0).abs());
    case "number.sign":
      return V.num(num(m, a, 0).sign());
    case "number.fmt": {
      const places = Math.min(Math.max(whole(num(m, a, 1), "a number of places"), 0), 10);
      return V.text(num(m, a, 0).fmt(places));
    }
    case "number.sqrt":
      return someNum(num(m, a, 0).sqrt());
    case "number.pow": {
      const x = num(m, a, 0);
      const p = num(m, a, 1);
      return someNum(numOp(() => x.pow(p)));
    }
    case "number.exp": {
      const x = num(m, a, 0);
      return V.num(numOp(() => x.exp()));
    }
    case "number.ln":
      return someNum(num(m, a, 0).ln());
    case "number.sin": {
      const x = num(m, a, 0);
      return V.num(numOp(() => x.sin()));
    }
    case "number.cos": {
      const x = num(m, a, 0);
      return V.num(numOp(() => x.cos()));
    }
    case "number.tan": {
      const x = num(m, a, 0);
      return V.num(numOp(() => x.tan()));
    }
    case "number.asin":
      return someNum(num(m, a, 0).asin());
    case "number.acos":
      return someNum(num(m, a, 0).acos());
    case "number.atan": {
      const x = num(m, a, 0);
      return V.num(numOp(() => x.atan()));
    }
    case "number.atan2": {
      const y = num(m, a, 0);
      const x = num(m, a, 1);
      return V.num(numOp(() => y.atan2(x)));
    }
    case "number.sinh": {
      const x = num(m, a, 0);
      return V.num(numOp(() => x.sinh()));
    }
    case "number.cosh": {
      const x = num(m, a, 0);
      return V.num(numOp(() => x.cosh()));
    }
    case "number.tanh": {
      const x = num(m, a, 0);
      return V.num(numOp(() => x.tanh()));
    }
    case "list.len":
      return V.num(Num.int(list(m, a, 0).items.length));
    case "list.at": {
      const l = list(m, a, 0);
      const k = num(m, a, 1).toI64();
      return k !== null && k >= 0 && k < l.items.length ? V.some(l.items[k].value) : V.none();
    }
    case "list.add": {
      const items = list(m, a, 0).items.slice();
      const value = m.valueOf(a[1]);
      const id = m.newId();
      items.push({ id, value });
      setList(m, a, items);
      return undefined;
    }
    case "list.insert": {
      const items = list(m, a, 0).items.slice();
      const pos = Math.max(whole(num(m, a, 1), "a position"), 0);
      const value = m.valueOf(a[2]);
      const id = m.newId();
      items.splice(Math.min(pos, items.length), 0, { id, value });
      setList(m, a, items);
      return undefined;
    }
    case "list.remove_at": {
      const items = list(m, a, 0).items.slice();
      const pos = whole(num(m, a, 1), "a position");
      if (pos < 0 || pos >= items.length) {
        throw new Failure("Position", "remove_at with a position outside the list");
      }
      items.splice(pos, 1);
      setList(m, a, items);
      return undefined;
    }
    case "list.move": {
      const items = list(m, a, 0).items.slice();
      const pos = whole(num(m, a, 1), "a position");
      const to = whole(num(m, a, 2), "a position");
      const n = items.length;
      if (pos < 0 || pos >= n || to < 0 || to >= n) {
        throw new Failure("Position", "move with a position outside the list");
      }
      const [item] = items.splice(pos, 1);
      items.splice(to, 0, item);
      setList(m, a, items);
      return undefined;
    }
    case "list.remove": {
      const l = list(m, a, 0);
      const x = m.valueOf(a[1]);
      const kept: Item[] = [];
      for (const i of l.items) {
        if (!m.equal(i.value, x)) {
          kept.push(i);
        }
      }
      setList(m, a, kept);
      return undefined;
    }
    case "list.sort": {
      const l = list(m, a, 0);
      // a stable insertion of each item after every one that isn't after it
      const out: Item[] = [];
      for (const item of l.items) {
        let at = out.length;
        while (at > 0 && m.before(item.value, out[at - 1].value)) {
          at -= 1;
        }
        out.splice(at, 0, item);
      }
      setList(m, a, out);
      return undefined;
    }
    case "text.len":
      return V.num(Num.int(textLength(text(m, a, 0))));
    case "text.slice": {
      const t = text(m, a, 0);
      const start = Math.max(whole(num(m, a, 1), "a start"), 0);
      const count = Math.max(whole(num(m, a, 2), "a count"), 0);
      return V.text(sliceChars(t, start, count));
    }
    case "text.chars": {
      const t = text(m, a, 0);
      return m.makeList(chars(t).map((c) => V.text(c)));
    }
    case "text.lower":
      return V.text(text(m, a, 0).toLowerCase());
    case "text.upper":
      return V.text(text(m, a, 0).toUpperCase());
    case "text.trim":
      return V.text(trim(text(m, a, 0)));
    case "text.has": {
      const t = text(m, a, 0);
      return V.bool(t.includes(text(m, a, 1)));
    }
    case "text.split": {
      const t = text(m, a, 0);
      const sep = text(m, a, 1);
      if (sep.length === 0) {
        throw Failure.rule("split takes a separator of at least one character");
      }
      return m.makeList(t.split(sep).map((p) => V.text(p)));
    }
    case "text.number": {
      const t = text(m, a, 0);
      const body = t.startsWith("-") ? t.slice(1) : t;
      const dot = body.indexOf(".");
      const w = dot < 0 ? body : body.slice(0, dot);
      const f = dot < 0 ? null : body.slice(dot + 1);
      if (digits(w) && (f === null || digits(f))) {
        return someNum(Num.parse(t));
      }
      return V.none();
    }
    case "text.of_code": {
      const k = num(m, a, 0).toI64();
      if (k === null || k < 0 || k > 0x10ffff || (k >= 0xd800 && k <= 0xdfff)) {
        return V.none();
      }
      return V.some(V.text(String.fromCodePoint(k)));
    }
    case "ordered.clamp": {
      const x = m.valueOf(a[0]);
      const low = m.valueOf(a[1]);
      const high = m.valueOf(a[2]);
      if (m.before(x, low)) {
        return low;
      }
      if (m.before(high, x)) {
        return high;
      }
      return x;
    }
  }
  throw Failure.ir(`no native \`${name}\``);
}
