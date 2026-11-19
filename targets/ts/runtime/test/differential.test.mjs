// Differential: the Rust evaluator against this one, case by case. Each case is written twice into
// one Extended Mark file, as `let r_K: T = EXPR;`, which the compiler works out with the Rust evaluator
// (its value lands in the IR, and a failure is a compile error carrying the failure's message),
// and as `fn f_K(): T { return EXPR; }`, whose return expression the TypeScript evaluator works
// out here with a fresh Machine, as the compiler does for a let. Both answers have to be the same:
// the same value in the IR's form, or a failure with the same message. The limits are counted the
// same way too: the cases at 1,000,000 steps and at 64 calls deep sit on the edge.

import { test } from "node:test";
import { rmSync } from "node:fs";
import assert from "node:assert/strict";
import { Constants, Failure, Machine, toIr } from "../dist/index.js";
import { build, declarations, program, workdir } from "./xtmd.mjs";

const PRELUDE = `package t;

enum stage {
    IDLE,
    RUNNING,
    FAILED(why: text),
    DONE,
}

record span {
    start: number;
    end: number;

    require "a span has to end after it starts" {
        return end > start;
    }
}

record dial {
    level: number 0..10;
    name: text[1...] = "dial";
}

fn sweep_in(mut xs: list<number>) {
    mut for (t in xs) {
        if (mut x: number = t) {
            if (x % 2 == 0) {
                xs.remove(x);
            } else {
                x = x * 10;
            }
        }
        xs.sort();
    }
}

fn sweep(): list<number> {
    mut xs: list<number> = [5, 1, 4, 2, 3];
    sweep_in(xs);
    return xs;
}

fn bump_at(mut xs: list<number>, i: int) {
    if (mut x: number = xs[i]) {
        x = x + 100;
    }
}

fn bumped(i: int): list<number> {
    mut xs: list<number> = [1, 2, 3];
    bump_at(xs, i);
    return xs;
}

fn list_ops(): list<number> {
    mut xs: list<number> = [5, 3, 9];
    xs.add(1);
    xs.insert(0, 7);
    xs.insert(99, 8);
    xs.remove_at(2);
    xs.move(0, 3);
    xs.sort();
    xs.remove(9);
    return xs;
}

fn remove_outside(): list<number> {
    mut xs: list<number> = [1];
    xs.remove_at(5);
    return xs;
}

fn write_outside(): list<number> {
    mut xs: list<number> = [1];
    xs[5] = 2;
    return xs;
}

fn write_at(): list<number> {
    mut xs: list<number> = [1, 2, 3];
    xs[1] = 20;
    return xs;
}

fn burn(n: number, p: number): number {
    mut s: number = 0;
    for (i in 0..n) {
        for (j in 0..99) {
            s = s + 1;
        }
    }
    for (k in 0..p) {
    }
    return s;
}

fn deep(n: number): number {
    if (n <= 0) {
        return 0;
    }
    return deep(n - 1) + 1;
}

fn many(n: number): number {
    mut xs: list<number> = [];
    for (i in 1..5000) {
        xs.add(i);
    }
    for (i in 1..n) {
        xs.add(i);
    }
    return xs.len();
}

fn open_range(): number {
    mut s: number = 0;
    for (i in 1...) {
        if (i > 5) {
            return s;
        }
        s = s + i;
    }
    return s;
}

fn walk(r: range<number>): list<number> {
    mut out: list<number> = [];
    for (k, x in r) {
        out.add(x * 100 + k);
    }
    return out;
}

fn make_span(a: number, b: number): span {
    return span { start = a, end = b };
}

fn try_span(a: number, b: number): opt<span> {
    return try span { start = a, end = b };
}

fn try_dial(n: number): opt<dial> {
    return try dial { level = n };
}

fn try_turn(n: number): opt<dial> {
    let d: dial = dial { level = 5 };
    return try d with { level = n };
}

fn describe(s: stage): text {
    match (s) {
        case stage.IDLE, stage.DONE {
            return "at rest";
        }
        case stage.FAILED(why) {
            return "failed: \\{why}";
        }
        case else {
            return "running";
        }
    }
}

fn scaled(k: number): list<number> {
    return [1, 2, 3].map(fn(x) { return x * k; });
}

fn digits_of(n: number): list<text> {
    return "\\{n}".chars();
}
`;

const trigInputs = ["0.5", "1", "2", "3", "-1", "10", "100", "0.001", "1000000", "-123.456"];

/** [type, expression]: everything the evaluator does, at the edges where it can go wrong. */
const CASES = [
  // arithmetic, exact, halves to even
  ["number", "0.1 + 0.2"],
  ["number", "1 / 3"],
  ["number", "(1 / 3) * 3"],
  ["number", "2 / 3"],
  ["number", "-2 / 3"],
  ["number", "1 / 7 + 1 / 7"],
  ["number", "-7 % 2"],
  ["number", "7 % -2"],
  ["number", "5.5 % 2"],
  ["number", "-4 % 2"],
  ["number", "1000000000000000000000000000000000 % 3"],
  ["number", "10000000000000000000000000000000000 % 3"],
  ["number", "100000000000000000000000000000000000 % 3"],
  ["number", "10000000000000000000000000000000000000 % 3"],
  ["number", "1 / 0"],
  ["number", "5 % 0"],
  ["number", "0 * -1"],
  ["number", "99999999999999999999999999999999999"],
  ["number", "1.00000000000000000000000000000000050"],
  ["number", "1.00000000000000000000000000000000150"],
  ["number", "12345678901234567890123456789012345678"],
  ["number", "9999999999999999999999999999999999 + 0.5"],
  ["number", "1000000000000000000000000000000000 + 0.5"],
  ["number", "1000000000000000000000000000000000 + 1.5"],
  ["number", "9999999999999999999999999999999999 * 9999999999999999999999999999999999"],
  ["number", "100000000000000005 * 100000000000000005"],
  ["number", "0.000000001 * 0.000000001"],
  ["number", `0.${"0".repeat(6175)}1`],
  ["number", `0.${"0".repeat(6175)}1 / 2`],
  ["number", `0.${"0".repeat(6175)}3 / 2`],
  ["number", `0.${"0".repeat(6175)}1 * 1.5`],
  ["number", `0.${"0".repeat(6170)}123456789 * 1`],
  ["number", `0.${"0".repeat(6140)}1234567 / 7`],
  ["number", `${"9".repeat(34)}${"0".repeat(6111)} * 10`],
  ["number", `${"9".repeat(34)}${"0".repeat(6110)} + ${"9".repeat(34)}${"0".repeat(6110)}`],
  // rounding and formatting
  ["number", "(2.5).round()"],
  ["number", "(-2.5).round()"],
  ["number", "(0.5).round()"],
  ["number", "(-0.4).round()"],
  ["number", "(7 / 2).floor()"],
  ["number", "(-3.5).ceil()"],
  ["number", "(-3.5).floor()"],
  ["number", "(-7).sign()"],
  ["number", "(-7.25).abs()"],
  ["text", "(2.345).fmt(2)"],
  ["text", "(-0.001).fmt(2)"],
  ["text", "(2).fmt(0)"],
  ["text", "(1.005).fmt(2)"],
  ["text", "(-1.005).fmt(2)"],
  ["text", "(123.456).fmt(10)"],
  ["text", "(-2.5).fmt(0)"],
  ["text", "(1 / 3).fmt(10)"],
  ["text", "(42).fmt(3)"],
  ["text", "\"\\{42.50}\""],
  ["text", "\"\\{-0.0}\""],
  ["text", "\"\\{1 / 8}\""],
  // maths
  ["opt<number>", "(2).sqrt()"],
  ["opt<number>", "(3).sqrt()"],
  ["opt<number>", "(16).sqrt()"],
  ["opt<number>", "(0.0001).sqrt()"],
  ["opt<number>", "(1000000).sqrt()"],
  ["opt<number>", "(12345678901234567890).sqrt()"],
  ["opt<number>", "(-4).sqrt()"],
  ["opt<number>", "(2).pow(10)"],
  ["opt<number>", "(2).pow(-2)"],
  ["opt<number>", "(1.1).pow(100)"],
  ["opt<number>", "(3).pow(0.5)"],
  ["opt<number>", "(10).pow(-3)"],
  ["opt<number>", "(7).pow(33)"],
  ["opt<number>", "(7).pow(-33)"],
  ["opt<number>", "(1.0001).pow(10000)"],
  ["opt<number>", "(2).pow(0.1)"],
  ["opt<number>", "(100000000000000005).pow(2)"],
  ["opt<number>", "(0.5).pow(3)"],
  ["opt<number>", "(-2).pow(3)"],
  ["opt<number>", "(-2).pow(-3)"],
  ["opt<number>", "(123.456).pow(7)"],
  ["opt<number>", "(9).pow(1.5)"],
  ["opt<number>", "(1.5).pow(-7)"],
  ["opt<number>", "(0.3).pow(13)"],
  ["opt<number>", "(1.000000001).pow(123456789)"],
  ["opt<number>", "(1.0000000001).pow(12345678901)"],
  ["opt<number>", "(2).pow(1000000)"],
  ["opt<number>", "(0.5).pow(100000)"],
  ["opt<number>", "(0).pow(0)"],
  ["opt<number>", "(0).pow(5)"],
  ["opt<number>", "(0).pow(-1)"],
  ["opt<number>", "(-8).pow(0.5)"],
  ["opt<number>", "(-2).pow(10000000000)"],
  ["opt<number>", "(1).pow(0.5)"],
  ["number", "(1).exp()"],
  ["number", "(-1).exp()"],
  ["number", "(0.5).exp()"],
  ["number", "(100).exp()"],
  ["number", "(-100).exp()"],
  ["number", "(14000).exp()"],
  ["number", "(-14200).exp()"],
  ["number", "(20000).exp()"],
  ["opt<number>", "(10).ln()"],
  ["opt<number>", "(0.001).ln()"],
  ["opt<number>", "(2).ln()"],
  ["opt<number>", "(1000000000000000000000000000000).ln()"],
  ["opt<number>", "(0).ln()"],
  ...trigInputs.flatMap((x) => [
    ["number", `(${x}).sin()`],
    ["number", `(${x}).cos()`],
    ["number", `(${x}).tan()`],
    ["number", `(${x}).atan()`],
    ["number", `(${x}).sinh()`],
    ["number", `(${x}).cosh()`],
    ["number", `(${x}).tanh()`],
  ]),
  ["number", "(15000).cosh()"],
  ["number", "(-30000).tanh()"],
  ...["0.5", "-0.5", "1", "-1", "0", "0.999", "1.5"].flatMap((x) => [
    ["opt<number>", `(${x}).asin()`],
    ["opt<number>", `(${x}).acos()`],
  ]),
  ...[
    ["1", "1"],
    ["-1", "-1"],
    ["0", "-5"],
    ["0", "5"],
    ["-2", "0"],
    ["3", "-4"],
    ["-3", "-4"],
    ["0", "0"],
  ].map(([y, x]) => ["number", `(${y}).atan2(${x})`]),
  ["bool", "pi > 3.1415 && pi < 3.1416"],
  // durations
  ["text", "\"\\{1500ms}\""],
  ["text", "\"\\{2s}\""],
  ["text", "\"\\{2s * 1.5}\""],
  ["duration", "2s * 3"],
  ["duration", "2s + 500ms"],
  ["duration", "-(2s)"],
  ["number", "(2s + 500ms).ms()"],
  ["bool", "250ms < 1s"],
  // text: Unicode characters, Rust's order and whitespace
  ["bool", "\"\\u{ff00}\" < \"\\u{1f600}\""],
  ["bool", "\"b\" < \"a\""],
  ["bool", "\"ab\" < \"abc\""],
  ["number", "\"héllo\".len()"],
  ["number", "\"😀x\".len()"],
  ["text", "\"a😀b\".slice(1, 1)"],
  ["text", "\"a😀b\".slice(1, 100)"],
  ["text", "\"hello\".slice(9, 2)"],
  ["list<text>", "\"😀ab\".chars()"],
  ["text", "\"\\u{85}x\\u{85}\".trim()"],
  ["text", "\"\\u{feff}x\\u{feff}\".trim()"],
  ["text", "\"\\u{3000} x \\t\\n\".trim()"],
  ["text", "\"ÄB\".lower()"],
  ["text", "\"straße\".upper()"],
  ["text", "\"ΣΑΣ\".lower()"],
  ["list<text>", "\"a,b,,c\".split(\",\")"],
  ["list<text>", "\",\".split(\",\")"],
  ["list<text>", "\"abc\".split(\"abc\")"],
  ["opt<number>", "\"07\".number()"],
  ["opt<number>", "\"-0.50\".number()"],
  ["opt<number>", "\"1.\".number()"],
  ["opt<number>", "\"1_000\".number()"],
  ["opt<number>", "\"1e3\".number()"],
  ["opt<number>", "\"-\".number()"],
  ["opt<text>", "text.of_code(65)"],
  ["opt<text>", "text.of_code(128512)"],
  ["opt<text>", "text.of_code(55296)"],
  ["opt<text>", "text.of_code(1114112)"],
  ["opt<text>", "text.of_code(65.5)"],
  ["bool", "\"hello\".has(\"ell\") && \"hello\".has(\"\")"],
  ["list<text>", "digits_of(-12.5)"],
  // lists: identity through changes, positions, writes
  ["list<number>", "sweep()"],
  ["list<number>", "list_ops()"],
  ["list<number>", "bumped(1)"],
  ["list<number>", "bumped(5)"],
  ["list<number>", "bumped(-1)"],
  ["list<number>", "write_at()"],
  ["list<number>", "remove_outside()"],
  ["list<number>", "write_outside()"],
  ["list<number>", "[3, 1, 2].sorted()"],
  ["list<text>", "[\"b\", \"a\", \"😀\", \"\\u{ff00}\"].sorted()"],
  ["list<number>", "scaled(3)"],
  ["opt<number>", "[1, 2, 3].at(1)"],
  ["opt<number>", "[1, 2, 3].at(1.5)"],
  ["opt<number>", "[1, 2, 3][-1]"],
  ["bool", "[1, 2] == [1, 2] && [1, 2] != [2, 1] && [1] != [1, 1]"],
  // ranges
  ["list<number>", "walk(1..5)"],
  ["list<number>", "walk(0..1 step 0.25)"],
  ["list<number>", "walk(10..1 step -3)"],
  ["list<number>", "walk(5..1)"],
  ["bool", "6 in 0..10 step 2 && !(5 in 0..10 step 2) && 1 in 1..."],
  ["bool", "(1..10) == (1..10) && (1..10) != (1..11)"],
  ["number", "open_range()"],
  // records, rules and contracts
  ["span", "make_span(1, 5)"],
  ["span", "make_span(5, 1)"],
  ["opt<span>", "try_span(1, 5)"],
  ["opt<span>", "try_span(5, 1)"],
  ["opt<dial>", "try_dial(7)"],
  ["opt<dial>", "try_dial(11)"],
  ["opt<dial>", "try_turn(3)"],
  ["opt<dial>", "try_turn(-1)"],
  ["bool", "make_span(1, 2) == make_span(1, 2) && make_span(1, 2) != make_span(1, 3)"],
  // enums, matches, opts
  ["text", "describe(stage.IDLE)"],
  ["text", "describe(stage.FAILED(\"timeout\"))"],
  ["text", "describe(stage.RUNNING)"],
  ["bool", "stage.FAILED(\"a\") == stage.FAILED(\"a\") && stage.FAILED(\"a\") != stage.FAILED(\"b\")"],
  ["bool", "opt.SOME(3) == 3 && opt.NONE != 3 && opt.SOME(opt.NONE) != opt.NONE"],
  ["opt<number>", "opt.SOME(3)"],
  // the limits, on their edges
  ["number", "burn(4949, 93)"],
  ["number", "burn(4949, 94)"],
  ["number", "burn(4949, 95)"],
  ["number", "burn(4949, 96)"],
  ["number", "deep(62)"],
  ["number", "deep(63)"],
  ["number", "deep(64)"],
  ["number", "many(5000)"],
  ["number", "many(5001)"],
  ["list<number>", "walk(1..10000)"],
  ["list<number>", "walk(1..10001)"],
];

/** JSON with every object's keys in order, so two values can be compared as text. */
function canon(x) {
  if (Array.isArray(x)) {
    return `[${x.map(canon).join(",")}]`;
  }
  if (x !== null && typeof x === "object") {
    return `{${Object.keys(x)
      .sort()
      .map((k) => `${JSON.stringify(k)}:${canon(x[k])}`)
      .join(",")}}`;
  }
  return JSON.stringify(x);
}

function source(withLets, skip) {
  let s = PRELUDE;
  CASES.forEach(([ty, expr], k) => {
    if (withLets && !skip.has(k)) {
      s += `\nlet r_${k}: ${ty} = ${expr};\n`;
    }
    s += `\nfn f_${k}(): ${ty} {\n    return ${expr};\n}\n`;
  });
  return s;
}

test("the TypeScript evaluator agrees with the Rust evaluator", (t) => {
  const dir = workdir();
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  // the Rust answers: a failure for each let it couldn't work out, then the values of the rest
  const first = build(dir, "diff", source(true, new Set()));
  const rust = new Map();
  for (const e of first.errors) {
    const m = /^working out `r_(\d+)` failed: (.*)$/.exec(e.message);
    assert.ok(m, `case setup: ${e.message} (line ${e.line})`);
    rust.set(Number(m[1]), { failure: m[2] });
  }
  const second = build(dir, "diff", source(true, new Set(rust.keys())));
  assert.ok(second.ok, `the cases build:\n${second.output}`);
  const lets = declarations(second.ir, "let");
  const fns = declarations(second.ir, "fn");
  CASES.forEach((_, k) => {
    if (!rust.has(k)) {
      rust.set(k, { value: canon(lets.get(`t/r_${k}`).value) });
    }
  });

  const prog = program(second.ir);
  const mismatches = [];
  let failures = 0;
  CASES.forEach(([ty, expr], k) => {
    const body = fns.get(`t/f_${k}`).body;
    const e = body[0].return.value;
    let ts;
    try {
      ts = { value: canon(toIr(new Machine(prog, new Constants()).eval(e))) };
    } catch (f) {
      if (!(f instanceof Failure)) {
        throw f;
      }
      ts = { failure: f.message };
    }
    const want = rust.get(k);
    if (want.failure !== undefined) {
      failures += 1;
    }
    if (canon(ts) !== canon(want)) {
      const show = (x) => (x.failure !== undefined ? `failure: ${x.failure}` : x.value.length > 300 ? `${x.value.slice(0, 300)}…` : x.value);
      mismatches.push(`r_${k}: ${ty} = ${expr.length > 80 ? expr.slice(0, 80) + "…" : expr}\n    rust: ${show(want)}\n    ts:   ${show(ts)}`);
    }
  });
  console.log(`# differential: ${CASES.length - mismatches.length}/${CASES.length} cases agree with the Rust evaluator (${failures} of them failures)`);
  assert.equal(mismatches.length, 0, `cases that differ:\n${mismatches.join("\n")}`);
});
