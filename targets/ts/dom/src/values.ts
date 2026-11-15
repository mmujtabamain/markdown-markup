// Reading the runtime's values for drawing. Every input arrives with its default filled in, so
// these only unwrap: an opt to its value, a case to its name, a record to its fields.

import { Num, toIr, type Value } from "@mkp/runtime";

/** The value inside an opt (and inside that one), or the value itself; undefined for none. */
export function inner(v: Value | undefined): Value | undefined {
  while (v && v.kind === "opt") v = v.value ?? undefined;
  return v;
}

/** A record's field, or a case's value, by name. */
export function field(v: Value | undefined, name: string): Value | undefined {
  v = inner(v);
  if (!v) return undefined;
  if (v.kind === "record") return v.fields.find(([k]) => k === name)?.[1];
  if (v.kind === "case") return v.values.find(([k]) => k === name)?.[1];
  return undefined;
}

/** A value as the words it shows: a text, a number in its exact form, a bool. */
export function str(v: Value | undefined): string {
  v = inner(v);
  if (!v) return "";
  if (v.kind === "text") return v.s;
  if (v.kind === "num" || v.kind === "duration") return v.n.show();
  if (v.kind === "bool") return v.b ? "true" : "false";
  return "";
}

/** A number as JS reads it, for drawing only: writes go back as exact Nums. */
export function num(v: Value | undefined): number | undefined {
  v = inner(v);
  return v && (v.kind === "num" || v.kind === "duration") ? v.n.toNumber() : undefined;
}

export function exact(v: Value | undefined): Num | undefined {
  v = inner(v);
  return v && v.kind === "num" ? v.n : undefined;
}

export function flag(v: Value | undefined, otherwise = false): boolean {
  v = inner(v);
  return v && v.kind === "bool" ? v.b : otherwise;
}

/** An enum's or a token's case name: `START`, `ACCENT`. */
export function kase(v: Value | undefined): string | undefined {
  v = inner(v);
  return v && v.kind === "case" ? v.name : undefined;
}

export function list(v: Value | undefined): Value[] {
  v = inner(v);
  return v && v.kind === "list" ? v.items.map((i) => i.value) : [];
}

export interface XY {
  x: number;
  y: number;
}

export function point(v: Value | undefined): XY | undefined {
  const x = num(field(v, "x"));
  const y = num(field(v, "y"));
  return x === undefined || y === undefined ? undefined : { x, y };
}

export function region(v: Value | undefined): { from: XY; to: XY } | undefined {
  const from = point(field(v, "from"));
  const to = point(field(v, "to"));
  return from && to ? { from, to } : undefined;
}

/** A value's identity for "did it change": its IR form, with fns by their code. */
export function sig(v: Value | undefined): string {
  if (!v) return "";
  if (v.kind === "fn") return `fn:${fnId(v)}`;
  return JSON.stringify(toIr(v));
}

const fnIds = new WeakMap<object, number>();
let nextFn = 0;

/** A fn value's code, as a number: the same lambda keeps it across redraws. */
function fnId(v: Value & { kind: "fn" }): number {
  let id = fnIds.get(v.body);
  if (id === undefined) fnIds.set(v.body, (id = ++nextFn));
  return id;
}

/** A JS number as an exact Num, rounded to `places` digits after the point: pointer maths is
 * floating point, and a write should be a number a person would write. */
export function toNum(x: number, places = 2): Num {
  if (!Number.isFinite(x)) return Num.zero();
  const p = Math.max(0, Math.min(12, places));
  return Num.parse(x.toFixed(p)) ?? Num.zero();
}

/** How many digits after the point keep a sub-pixel's worth, for `units` units per pixel. */
export function placesFor(unitsPerPx: number): number {
  if (!(unitsPerPx > 0) || !Number.isFinite(unitsPerPx)) return 2;
  return Math.max(0, Math.ceil(-Math.log10(unitsPerPx)) + 1);
}
