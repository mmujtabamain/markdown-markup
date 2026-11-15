// `$state` as a reader reads it: values and types written as MKP writes them, from the IR's form.

import type { ir } from "@mkp/runtime";
import { escapeHtml } from "./highlight.js";

type Decl = Record<string, unknown>;

function moduleOf(file: ir.File | ir.Module): ir.Module {
  return "ir" in file ? file.ir : file;
}

/** The page's `$state` declaration, if it has one. */
export function stateDecl(file: ir.File | ir.Module): ir.State | undefined {
  for (const d of moduleOf(file).declarations) {
    const decl = d.declare as Decl;
    if ("$state" in decl) return decl["$state"] as ir.State;
  }
  return undefined;
}

/** A declaration by its full name: a record, an enum or a type alias. */
export function findDecl(file: ir.File | ir.Module, name: string): { kind: string; decl: Record<string, unknown> } | undefined {
  for (const d of moduleOf(file).declarations) {
    const decl = d.declare as Decl;
    for (const kind of ["record", "enum", "type"]) {
      const x = decl[kind] as { name?: string } | undefined;
      if (x && x.name === name) return { kind, decl: x as Record<string, unknown> };
    }
  }
  return undefined;
}

/** A name as the page wrote it: `core/int` is `int`, `doc/task` is `task`. */
export function shortName(full: string): string {
  const slash = full.lastIndexOf("/");
  return slash < 0 ? full : full.slice(slash + 1);
}

function bounds(b: ir.Bounds | undefined, sep = ".."): string {
  if (!b) return "";
  const low = b.low ? valueText(b.low) : "";
  const high = b.high ? valueText(b.high) : "";
  if (low && high) return low === high ? low : `${low}${sep}${high}`;
  if (low) return `${low}...`;
  return high ? `...${high}` : "";
}

/** A type as it is written: `int 0..10`, `list<task>[1...]`, `opt<region>`. */
export function typeText(t: ir.Type): string {
  let s = shortName(t.name);
  if (t.args?.length) s += `<${t.args.map(typeText).join(", ")}>`;
  const c = t.contract;
  if (c) {
    if (c.length) s += `[${bounds(c.length)}]`;
    if (c.range) s += ` ${bounds(c.range)}`;
    if (c.step) s += ` step ${valueText(c.step)}`;
    if (c.only) s += ` only [${c.only.map((x) => valueText(x)).join(", ")}]`;
  }
  return s;
}

/**
 * What a `$state` field's values have to be, for keeping them across a recompile: its type's
 * shape (contracts left out: those are checked on the value) and every declaration of the page's
 * own that it reaches. Core's types don't change between compiles.
 */
export function typeSignature(file: ir.File | ir.Module, t: ir.Type): string {
  const seen = new Set<string>();
  const parts: string[] = [];
  const visit = (t: ir.Type): unknown => {
    const shape: Record<string, unknown> = { name: t.name };
    if (t.args?.length) shape.args = t.args.map(visit);
    if (t.fields?.length) shape.fields = t.fields.map((f) => [f.name, visit(f.type)]);
    if (!t.name.startsWith("core/") && !seen.has(t.name)) {
      seen.add(t.name);
      const d = findDecl(file, t.name);
      if (d) {
        parts.push(JSON.stringify(d.decl));
        for (const f of (d.decl.fields as ir.Field[] | undefined) ?? []) visit(f.type);
        for (const c of (d.decl.cases as { fields?: ir.Field[] }[] | undefined) ?? []) for (const f of c.fields ?? []) visit(f.type);
        const is = d.decl.is as ir.Type | undefined;
        if (is) visit(is);
      }
    }
    return shape;
  };
  return JSON.stringify(visit(t)) + "|" + parts.join("|");
}

/** The cases of an enum whose cases hold nothing, for a picker; undefined for any other. */
export function plainCases(file: ir.File | ir.Module, enumName: string): string[] | undefined {
  const d = findDecl(file, enumName);
  if (!d || d.kind !== "enum") return undefined;
  const cases = d.decl.cases as { name: string; fields?: unknown[] }[];
  if (cases.some((c) => c.fields?.length)) return undefined;
  return cases.map((c) => c.name);
}

/**
 * Why a value in the IR's form isn't of a type, or undefined when it is, as far as its shape
 * goes: numbers, text, lists, records and their fields, enums and their cases. `Page.set` checks
 * a value against its field's contracts only, so the playground checks the shape before it writes.
 * Types it can't see into (aliases, interfaces, generics) pass.
 */
export function shapeError(x: ir.Expr, t: ir.Type, file: ir.File | ir.Module, at = "the value"): string | undefined {
  const want = typeText({ ...t, contract: undefined });
  const a = (s: string) => `${/^[aeiou]/.test(s) ? "an" : "a"} ${s}`;
  const no = (what: string) => `${at} is ${what}, not ${a(want)}`;
  const KINDS: Record<string, string> = { num: "a number", text: "text", bool: "true or false", list: "a list", record: "a record", case: "a case", none: "opt.NONE", some: "an opt", duration: "a duration", range: "a range" };
  const kind = KINDS[Object.keys(x)[0]] ?? "something else";
  switch (t.name) {
    case "core/int":
      if (!("num" in x)) return no(kind);
      return /^-?\d+$/.test(x.num) ? undefined : `${at} is ${x.num}, not a whole number`;
    case "core/number":
      return "num" in x ? undefined : no(kind);
    case "core/text":
      return "text" in x ? undefined : no(kind);
    case "core/bool":
      return "bool" in x ? undefined : no(kind);
    case "core/duration":
      return "duration" in x ? undefined : no(kind);
    case "core/range":
      return "range" in x ? undefined : no(kind);
    case "core/list": {
      if (!("list" in x)) return no(kind);
      const item = t.args?.[0];
      if (!item) return undefined;
      for (const [k, i] of x.list.entries()) {
        const e = shapeError(i, item, file, `item ${k + 1}`);
        if (e) return e;
      }
      return undefined;
    }
    case "core/opt": {
      if ("none" in x) return undefined;
      const inner = t.args?.[0];
      return inner ? shapeError("some" in x ? x.some : x, inner, file, at) : undefined;
    }
  }
  const d = findDecl(file, t.name);
  if (!d) return undefined;
  if (d.kind === "record") {
    if (!("record" in x)) return no(kind);
    if (x.record.type !== t.name) return no(a(shortName(x.record.type)));
    const given = x.record.fields as Record<string, ir.Expr>;
    for (const f of (d.decl.fields as ir.Field[]) ?? []) {
      const v = given[f.name];
      if (v === undefined) {
        if (f.default) continue;
        return `${at} has no ${f.name}`;
      }
      const e = shapeError(v, f.type, file, `${f.name}`);
      if (e) return e;
    }
    const unknown = Object.keys(given).find((k) => !((d.decl.fields as ir.Field[]) ?? []).some((f) => f.name === k));
    return unknown ? `${shortName(t.name)} has no field ${unknown}` : undefined;
  }
  if (d.kind === "enum") {
    if (!("case" in x)) return no(kind);
    if (x.case.enum !== t.name) return no(`a case of ${shortName(x.case.enum)}`);
    const cases = (d.decl.cases as { name: string }[]).map((c) => c.name);
    return cases.includes(x.case.name) ? undefined : `${shortName(t.name)} has no case ${x.case.name}`;
  }
  return undefined;
}

// ---- values

const pad2 = (x: ir.Expr | undefined) => String(x && "num" in x ? x.num : "0").padStart(2, "0");

function textLiteral(s: string): string {
  return `"${s.replace(/\\/g, "\\\\").replace(/"/g, '\\"').replace(/\n/g, "\\n").replace(/\t/g, "\\t")}"`;
}

/** A date or a moment as its text literal: `"2026-11-15"`, `"2026-11-15T09:30+01:00"`. */
function dateText(r: ir.ExprRecord): string | undefined {
  const f = r.fields as Record<string, ir.Expr>;
  if (r.type === "core/date") {
    const y = f.year && "num" in f.year ? f.year.num : "0";
    return `"${y.padStart(4, "0")}-${pad2(f.month)}-${pad2(f.day)}"`;
  }
  if (r.type === "core/moment" && f.day && "record" in f.day) {
    const day = dateText(f.day.record)?.slice(1, -1);
    const east = f.east && "bool" in f.east ? f.east.bool : true;
    return `"${day}T${pad2(f.hour)}:${pad2(f.minute)}${east ? "+" : "-"}${pad2(f.offset_hour)}:${pad2(f.offset_minute)}"`;
  }
  return undefined;
}

type Kind = "num" | "text" | "bool" | "case" | "plain";

interface Doc {
  /** One line. */
  flat: string;
  /** Laid out in lines when it is long, with spans for colour. */
  html(indent: string): string;
}

function leaf(text: string, kind: Kind): Doc {
  const html = kind === "plain" ? escapeHtml(text) : `<span class="v-${kind}">${escapeHtml(text)}</span>`;
  return { flat: text, html: () => html };
}

const WIDTH = 56;

/** Where the printer finds a record's fields in the order they were declared. */
type Order = (type: string) => string[] | undefined;

function orderOf(file: ir.File | ir.Module | undefined): Order {
  const cache = new Map<string, string[] | undefined>();
  return (type) => {
    if (!file) return undefined;
    if (!cache.has(type)) {
      const d = findDecl(file, type);
      cache.set(type, d?.kind === "record" ? ((d.decl.fields as ir.Field[]) ?? []).map((f) => f.name) : undefined);
    }
    return cache.get(type);
  };
}

function group(open: string, items: Doc[], close: string, sep = ", "): Doc {
  const flat = `${open}${items.map((i) => i.flat).join(sep)}${close}`;
  return {
    flat,
    html(indent) {
      if (flat.length + indent.length <= WIDTH || !items.length) return `${escapeHtml(open)}${items.map((i) => i.html(indent)).join(escapeHtml(sep))}${escapeHtml(close)}`;
      const inner = indent + "  ";
      return `${escapeHtml(open.trimEnd())}\n${items.map((i) => inner + i.html(inner)).join(",\n")},\n${indent}${escapeHtml(close.trimStart())}`;
    },
  };
}

function doc(x: ir.Expr, order: Order): Doc {
  if ("num" in x) return leaf(x.num, "num");
  if ("text" in x) return leaf(textLiteral(x.text), "text");
  if ("bool" in x) return leaf(String(x.bool), "bool");
  if ("duration" in x) return leaf(`${x.duration}ms`, "num");
  if ("none" in x) return leaf("opt.NONE", "case");
  if ("some" in x) return doc(x.some, order);
  if ("list" in x) return group("[", x.list.map((i) => doc(i, order)), "]");
  if ("case" in x) {
    const name = `${shortName(x.case.enum)}.${x.case.name}`;
    const values = Object.entries(x.case.values ?? {});
    if (!values.length) return leaf(name, "case");
    const head = leaf(name, "case");
    const g = group("(", values.map(([k, v]) => field(k, v, order)), ")");
    return { flat: head.flat + g.flat, html: (i) => head.html(i) + g.html(i) };
  }
  if ("record" in x) {
    const date = dateText(x.record);
    if (date) return leaf(date, "text");
    let fields = Object.entries(x.record.fields as Record<string, ir.Expr>);
    const declared = order(x.record.type);
    if (declared) fields = fields.sort(([a], [b]) => (declared.indexOf(a) >>> 0) - (declared.indexOf(b) >>> 0));
    const name = shortName(x.record.type ?? "record");
    if (!fields.length) return leaf(`${name} {}`, "plain");
    return group(`${name} { `, fields.map(([k, v]) => field(k, v, order)), " }");
  }
  if ("range" in x) {
    const r = x.range;
    const low = r.low ? doc(r.low, order).flat : "";
    const high = r.high ? doc(r.high, order).flat : "";
    return leaf(`${low}${high ? ".." + high : "..."}${r.step ? ` step ${doc(r.step, order).flat}` : ""}`, "num");
  }
  if ("view" in x) return leaf(`@${shortName(x.view.widget)}(…)`, "plain");
  if ("token" in x) return leaf(shortName(String(x.token)), "case");
  return leaf(JSON.stringify(x), "plain");
}

function field(name: string, v: ir.Expr, order: Order): Doc {
  const d = doc(v, order);
  return { flat: `${name} = ${d.flat}`, html: (i) => `${escapeHtml(name)} = ${d.html(i)}` };
}

/** A value on one line, as MKP writes it; a record's fields in the order `file` declares them. */
export function valueText(x: ir.Expr, file?: ir.File | ir.Module): string {
  return doc(x, orderOf(file)).flat;
}

/** A value as HTML, in lines when it is long. */
export function valueHtml(x: ir.Expr, file?: ir.File | ir.Module): string {
  return doc(x, orderOf(file)).html("");
}
