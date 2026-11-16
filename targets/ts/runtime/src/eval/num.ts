// MKP's one number type: exact base-10, IEEE 754 decimal128 with 34 significant digits,
// rounding halves to even (page 2). A port of targets/rust/eval/src/num.rs, which uses IBM's
// libdecnumber; here decimal.js does the arithmetic and every result is rounded into decimal128
// by hand (34 digits, exponents up to 10^6144, subnormals down to 10^-6176), once, so the two
// agree digit for digit.
//
// There is no negative zero: every result that is zero is plain `0`, so a number has one value and
// one spelling in every runtime. A result too large for decimal128, and a division by zero, are
// failures (a thrown NumError); maths with no answer gives `null`.

import { Decimal } from "decimal.js";

type Rounding = Decimal.Rounding;

const ROUND_CEIL: Rounding = 2;
const ROUND_FLOOR: Rounding = 3;
const ROUND_HALF_UP: Rounding = 4;
const ROUND_HALF_EVEN: Rounding = 6;

/** decimal128: digits, and the largest and smallest adjusted exponents of a normal number. */
const DIGITS = 34;
const EMAX = 6144;
const EMIN = -6143;

// decimal.js never limits exponents itself: decimal128's limits are applied by `roundTo`.
const unbounded = { minE: -9e15, maxE: 9e15, toExpNeg: -9e15, toExpPos: 9e15, modulo: 1 as Decimal.Modulo, crypto: false };
/** What a Num holds: add and sub round here directly, correctly, halves to even. */
const D34 = Decimal.clone({ ...unbounded, precision: 34, rounding: ROUND_HALF_EVEN });
/** Products (exact: 68 digits at most) and quotients (2p+2 digits, so one more rounding is still correct). */
const D70 = Decimal.clone({ ...unbounded, precision: 70, rounding: ROUND_HALF_EVEN });
/** libdecnumber's working precision for `pow` with a power that isn't a small whole number. */
const D44 = Decimal.clone({ ...unbounded, precision: 44, rounding: ROUND_HALF_EVEN });
/** Wide enough to hold the exact product of two numbers of up to 46 digits: `pow`'s whole powers. */
const EXACT = Decimal.clone({ ...unbounded, precision: 200, rounding: ROUND_HALF_EVEN });
/** num.rs's `Wide`: 120 digits, rounding halves up as libdecnumber's default context does. */
const W = Decimal.clone({ ...unbounded, precision: 120, rounding: ROUND_HALF_UP });
/** Wide's largest exponent (num.rs's wide_cx); its smallest, -99,999, is far below the series' 10^-130. */
const WIDE_EMAX = 99_999;

export type NumErrorKind = "DivisionByZero" | "TooLarge";

/** num.rs's NumError: a division or remainder by zero, or a result beyond decimal128's 10^6144. */
export class NumError extends Error {
  readonly kind: NumErrorKind;

  constructor(kind: NumErrorKind) {
    super(kind === "DivisionByZero" ? "a division by zero" : "a number too large for decimal128");
    this.name = "NumError";
    this.kind = kind;
  }
}

interface Rounded {
  v: Decimal;
  overflow: boolean;
  /** Subnormal and inexact, as libdecnumber's Underflow. */
  underflow: boolean;
}

/** Rounds to a context of `digits` digits and these exponents, as libdecnumber does: a value below
 * the smallest normal number keeps only the digits down to the context's tiniest exponent. */
function roundTo(x: Decimal, digits: number, rm: Rounding, emin: number, emax: number): Rounded {
  if (!x.isFinite()) {
    return { v: x, overflow: true, underflow: false };
  }
  if (x.isZero()) {
    return { v: x, overflow: false, underflow: false };
  }
  if (x.e < emin) {
    const r = x.toDP(digits - 1 - emin, rm);
    return { v: r, overflow: false, underflow: !r.eq(x) };
  }
  // decimal.js keeps 7 digits a word: few enough words can't need rounding
  const r = x.d.length * 7 <= digits ? x : x.toSD(digits, rm);
  return { v: r, overflow: r.e > emax, underflow: false };
}

/** A result rounded into decimal128, or the failure of one too large. */
function fin(x: Decimal, rm: Rounding): Num {
  const r = roundTo(x, DIGITS, rm, EMIN, EMAX);
  if (r.overflow) {
    throw new NumError("TooLarge");
  }
  return Num.of(r.v);
}

/** `fin`, with a failure turned into "no answer", as num.rs's `from_wide(..).ok()`. */
function finOrNull(x: Decimal, rm: Rounding): Num | null {
  try {
    return fin(x, rm);
  } catch (e) {
    if (e instanceof NumError) {
      return null;
    }
    throw e;
  }
}

const I64_MAX = 9223372036854775807n;
const I64_MIN = -9223372036854775808n;

const literalCache = new Map<string, Num | null>();

export class Num {
  // A Num is its decimal, made when first needed, and, when it is a whole number of at most 15
  // digits, that number as a JS number too: exact there, so the arithmetic of counts and positions
  // needs no decimal at all. Every result is checked to still be a safe integer before it is used.
  #d: Decimal | undefined;
  /** The whole number it is, if small; NaN when it isn't one; undefined until known. */
  #i: number | undefined;
  static readonly #zero: Num = new Num(undefined, 0);

  private constructor(d: Decimal | undefined, i: number | undefined) {
    this.#d = d;
    this.#i = i;
  }

  get #dec(): Decimal {
    if (this.#d === undefined) {
      this.#d = new D34(this.#i as number);
    }
    return this.#d;
  }

  /** The small whole number it is, or NaN. */
  get #small(): number {
    if (this.#i === undefined) {
      const d = this.#d as Decimal;
      this.#i = d.e < 15 && d.isInteger() ? d.toNumber() : NaN;
    }
    return this.#i;
  }

  /** A Num of a whole JS number known to be a safe integer. */
  static #ofSmall(i: number): Num {
    return i === 0 ? Num.#zero : new Num(undefined, i);
  }

  /** @internal A Num from a finite decimal already in decimal128. */
  static of(d: Decimal): Num {
    if (d.isZero()) {
      return Num.#zero;
    }
    return new Num(d.constructor === D34 ? d : new D34(d), undefined);
  }

  static zero(): Num {
    return Num.#zero;
  }

  /** A whole number. Exact for every safe integer (and every bigint up to 34 digits). */
  static int(n: number | bigint): Num {
    if (typeof n === "number" && !Number.isInteger(n)) {
      throw new RangeError(`Num.int(${n}): not a whole number`);
    }
    if (typeof n === "number" && Number.isSafeInteger(n) && Math.abs(n) < 1e15) {
      return Num.#ofSmall(n);
    }
    return fin(new D34(typeof n === "bigint" ? n.toString() : n), ROUND_HALF_EVEN);
  }

  /** An MKP number literal (`1_000`, `0.25`) or an IR number (`-7`, `3.5`): `[-] digits [. digits]`,
   * underscores ignored, rounded to 34 digits; `null` for anything else, or one too large. */
  static parse(s: string): Num | null {
    const t = s.includes("_") ? s.split("_").join("") : s;
    const body = t.startsWith("-") ? t.slice(1) : t;
    const dot = body.indexOf(".");
    const whole = dot < 0 ? body : body.slice(0, dot);
    const frac = dot < 0 ? null : body.slice(dot + 1);
    if (!allDigits(whole) || (frac !== null && !allDigits(frac))) {
      return null;
    }
    return finOrNull(new D34(t), ROUND_HALF_EVEN);
  }

  /** @internal `parse`, remembered: how the evaluator reads the IR's number literals. */
  static literal(s: string): Num | null {
    let n = literalCache.get(s);
    if (n === undefined) {
      if (literalCache.size > 50_000) {
        literalCache.clear();
      }
      n = Num.parse(s);
      literalCache.set(s, n);
    }
    return n;
  }

  /** The value as decimal.js holds it (a copy at decimal128's precision), for a runtime's own use. */
  toDecimal(): Decimal {
    return new D34(this.#dec);
  }

  add(o: Num): Num {
    const r = this.#small + o.#small;
    if (Number.isSafeInteger(r) && Math.abs(r) < 1e15) {
      return Num.#ofSmall(r);
    }
    return fin(this.#dec.plus(o.#dec), ROUND_HALF_EVEN);
  }

  sub(o: Num): Num {
    const r = this.#small - o.#small;
    if (Number.isSafeInteger(r) && Math.abs(r) < 1e15) {
      return Num.#ofSmall(r);
    }
    return fin(this.#dec.minus(o.#dec), ROUND_HALF_EVEN);
  }

  mul(o: Num): Num {
    const r = this.#small * o.#small;
    if (Number.isSafeInteger(r) && Math.abs(r) < 1e15) {
      return Num.#ofSmall(r + 0);
    }
    return fin(new D70(this.#dec).times(o.#dec), ROUND_HALF_EVEN);
  }

  div(o: Num): Num {
    if (o.isZero()) {
      throw new NumError("DivisionByZero");
    }
    const a = this.#small;
    const b = o.#small;
    if (a === a && b === b && a % b === 0) {
      return Num.#ofSmall(a / b + 0);
    }
    return fin(new D70(this.#dec).div(o.#dec), ROUND_HALF_EVEN);
  }

  /** The remainder, with the sign of the left side. Like libdecnumber's, it fails (as too large)
   * when the whole part of the quotient needs more than 34 digits. */
  rem(o: Num): Num {
    if (o.isZero()) {
      throw new NumError("DivisionByZero");
    }
    const r = this.#small % o.#small;
    if (r === r) {
      return Num.#ofSmall(r + 0);
    }
    if (this.#dec.abs().gte(new D70(o.#dec).abs().times("1e34"))) {
      throw new NumError("TooLarge");
    }
    return fin(this.#dec.mod(o.#dec), ROUND_HALF_EVEN);
  }

  neg(): Num {
    const a = this.#small;
    if (a === a) {
      return Num.#ofSmall(-a + 0);
    }
    return Num.of(this.#dec.neg());
  }

  abs(): Num {
    const a = this.#small;
    if (a === a) {
      return a < 0 ? Num.#ofSmall(-a) : this;
    }
    return Num.of(this.#dec.abs());
  }

  isZero(): boolean {
    // a zero is always held as the small 0
    return this.#small === 0;
  }

  isNegative(): boolean {
    const a = this.#small;
    if (a === a) {
      return a < 0;
    }
    return this.#dec.isNeg();
  }

  isInt(): boolean {
    const a = this.#small;
    return a === a || this.#dec.isInteger();
  }

  /** -1, 0 or 1. */
  sign(): Num {
    if (this.isZero()) {
      return ZERO;
    }
    return this.isNegative() ? MINUS_ONE : ONE;
  }

  /** The whole number nearest, halves away from zero. */
  round(): Num {
    return this.isInt() ? this : Num.of(this.#dec.toDP(0, ROUND_HALF_UP));
  }

  floor(): Num {
    return this.isInt() ? this : Num.of(this.#dec.toDP(0, ROUND_FLOOR));
  }

  ceil(): Num {
    return this.isInt() ? this : Num.of(this.#dec.toDP(0, ROUND_CEIL));
  }

  /** The whole number it is, when it is one and fits an i64; `null` otherwise. A JS number, so
   * exact up to 2^53. As num.rs does it: libdecnumber's rescale keeps the low 34 digits, so a
   * whole number of 10^34 or more whose shortest form has an exponent of 18 or less gives those. */
  toI64(): number | null {
    const a = this.#small;
    if (a === a) {
      return a;
    }
    if (!this.#dec.isInteger()) {
      return null;
    }
    if (this.#dec.isZero()) {
      return 0;
    }
    const trailingZeros = this.#dec.e + 1 - this.#dec.sd();
    if (trailingZeros > 18) {
      return null;
    }
    let digits = this.#dec.abs().toFixed();
    if (digits.length > DIGITS) {
      digits = digits.slice(digits.length - DIGITS);
    }
    let v = BigInt(digits);
    if (this.#dec.isNeg()) {
      v = -v;
    }
    if (v > I64_MAX || v < I64_MIN) {
      return null;
    }
    return Number(v);
  }

  /** An approximation as a JS number, for a runtime's own use (a chart's coordinates). */
  toNumber(): number {
    const a = this.#small;
    return a === a ? a : this.#dec.toNumber();
  }

  /** Its shortest exact form: no exponent and no trailing zeros. `42`, `3.5`, `0.3`, `-7`. */
  show(): string {
    const a = this.#small;
    if (a === a) {
      return String(a);
    }
    return this.#dec.toFixed();
  }

  toString(): string {
    return this.show();
  }

  /** Exactly `places` digits after the point, rounding halves away from zero.
   * (num.rs, through libdecnumber's quantize, can't do it when the result needs more than 34
   * digits, and crashes; here the text is still written.) */
  fmt(places: number): string {
    let r = this.#dec.toDP(places, ROUND_HALF_UP);
    if (r.isZero()) {
      r = new D34(0);
    }
    return r.toFixed(places);
  }

  sqrt(): Num | null {
    if (this.isNegative()) {
      return null;
    }
    return finOrNull(new D70(this.#dec).sqrt(), ROUND_HALF_EVEN);
  }

  /** `null` for 0 to a negative power, or a negative number to a power that isn't whole.
   * libdecnumber's decNumberPower, step for step: a whole power below 2^31 by repeated squaring
   * at 34 + (its digits) + 2 digits, halves to even, any other as exp(ln(x) × p) at 44 digits,
   * and the result rounded to 34 digits, halves to even, as every result is (page 2). */
  pow(p: Num): Num | null {
    if (this.isZero() && p.isNegative()) {
      return null;
    }
    if (this.isNegative() && !p.isInt()) {
      return null;
    }
    return power(this.#dec, p.#dec);
  }

  exp(): Num {
    if (this.#dec.gt(MATH_LIMIT)) {
      throw new NumError("TooLarge");
    }
    if (this.#dec.lt(-MATH_LIMIT)) {
      return ZERO;
    }
    return fin(new D70(this.#dec).exp(), ROUND_HALF_EVEN);
  }

  /** `null` at 0 or below. */
  ln(): Num | null {
    if (this.isZero() || this.isNegative()) {
      return null;
    }
    return finOrNull(new D70(this.#dec).ln(), ROUND_HALF_EVEN);
  }

  sin(): Num {
    return fin(series.sin(series.reduce(wide(this))), ROUND_HALF_EVEN);
  }

  cos(): Num {
    return fin(series.cos(series.reduce(wide(this))), ROUND_HALF_EVEN);
  }

  tan(): Num {
    const r = series.reduce(wide(this));
    const s = series.sin(r);
    const c = series.cos(r);
    if (c.isZero()) {
      throw new NumError("TooLarge");
    }
    return fin(series.div(s, c), ROUND_HALF_EVEN);
  }

  /** `null` outside -1..1. */
  asin(): Num | null {
    const w = series.asin(wide(this));
    return w === null ? null : finOrNull(w, ROUND_HALF_EVEN);
  }

  /** `null` outside -1..1. */
  acos(): Num | null {
    const a = series.asin(wide(this));
    if (a === null) {
      return null;
    }
    return finOrNull(series.sub(series.halfPi(), a), ROUND_HALF_EVEN);
  }

  atan(): Num {
    return fin(series.atan(wide(this)), ROUND_HALF_EVEN);
  }

  /** `y.atan2(x)`: the angle of the point (x, y), from -π to π. */
  atan2(x: Num): Num {
    return fin(series.atan2(wide(this), wide(x)), ROUND_HALF_EVEN);
  }

  sinh(): Num {
    return fin(series.hyperbolic(wide(this), "sinh"), ROUND_HALF_EVEN);
  }

  cosh(): Num {
    return fin(series.hyperbolic(wide(this), "cosh"), ROUND_HALF_EVEN);
  }

  tanh(): Num {
    return fin(series.hyperbolic(wide(this), "tanh"), ROUND_HALF_EVEN);
  }

  static pi(): Num {
    if (PI === undefined) {
      PI = fin(series.pi(), ROUND_HALF_EVEN);
    }
    return PI;
  }

  /** -1, 0 or 1, by value. */
  compare(o: Num): number {
    const a = this.#small;
    const b = o.#small;
    if (a === a && b === b) {
      return a < b ? -1 : a > b ? 1 : 0;
    }
    return this.#dec.cmp(o.#dec);
  }

  equals(o: Num): boolean {
    const a = this.#small;
    const b = o.#small;
    if (a === a && b === b) {
      return a === b;
    }
    return this.#dec.eq(o.#dec);
  }

  lt(o: Num): boolean {
    return this.compare(o) < 0;
  }

  gt(o: Num): boolean {
    return this.compare(o) > 0;
  }
}

const ZERO: Num = Num.zero();
const ONE: Num = Num.int(1);
const MINUS_ONE: Num = Num.int(-1);
let PI: Num | undefined;

/** Past this, exp's result is beyond decimal128 either way: e^15000 > 10^6144, e^-15000 < 10^-6176. */
const MATH_LIMIT = 15_000;

function allDigits(s: string): boolean {
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

function wide(n: Num): Decimal {
  return new W(n.toDecimal());
}

// ---- pow, as libdecnumber's decNumberPower

const BADINT = "bad";
const BIG = "big";

/** decGetInt: a whole number that fits (below 10^9, or above -2·10^9), or why not. */
function getInt(d: Decimal): number | typeof BADINT | typeof BIG {
  if (d.isZero()) {
    return 0;
  }
  if (!d.isInteger()) {
    return BADINT;
  }
  const integralLength = d.e + 1;
  if (integralLength > 10) {
    return BIG;
  }
  const n = Number(d.toFixed());
  if (integralLength === 10 && ((d.isNeg() && -n > 1999999997) || (!d.isNeg() && n > 999999999))) {
    return BIG;
  }
  return n;
}

function power(lhs: Decimal, rhs: Decimal): Num | null {
  const n = getInt(rhs);
  if (lhs.isZero()) {
    if (n === 0) {
      // 0 ** 0 is an invalid operation: a NaN, which num.rs reports as too large
      throw new NumError("TooLarge");
    }
    if (rhs.isNeg()) {
      throw new NumError("TooLarge");
    }
    return ZERO;
  }
  if (typeof n !== "number") {
    if (lhs.isNeg()) {
      // a negative number to a whole power too big for the integer path: invalid
      throw new NumError("TooLarge");
    }
    const ln = new D44(lhs).ln();
    if (ln.isZero()) {
      return ONE;
    }
    const m = ln.times(rhs);
    if (m.gt(MATH_LIMIT)) {
      throw new NumError("TooLarge");
    }
    if (m.lt(-MATH_LIMIT)) {
      return ZERO;
    }
    return fin(m.exp(), ROUND_HALF_EVEN);
  }
  if (n === 0) {
    return ONE;
  }
  // the integer path: working digits, halves to even, inside decimal128's exponents
  const digits = DIGITS + String(Math.abs(n)).length + 2;
  let overflow = false;
  let underflow = false;
  const ctx = (x: Decimal): Decimal => {
    const r = roundTo(x, digits, ROUND_HALF_EVEN, EMIN, EMAX);
    if (r.overflow) {
      overflow = true;
      return new EXACT(Infinity);
    }
    if (r.underflow) {
      underflow = true;
    }
    return r.v;
  };
  let x = new EXACT(lhs);
  if (n < 0) {
    x = ctx(new EXACT(1).div(x));
  }
  let bits = Math.abs(n) | 0;
  let dac = new EXACT(1);
  let seen = false;
  for (let i = 1; ; i++) {
    if (overflow || (underflow && dac.isZero())) {
      break;
    }
    bits = (bits << 1) | 0;
    if (bits < 0) {
      seen = true;
      dac = ctx(dac.times(x));
    }
    if (i === 31) {
      break;
    }
    if (!seen) {
      continue;
    }
    dac = ctx(dac.times(dac));
  }
  if (overflow) {
    throw new NumError("TooLarge");
  }
  if (underflow && !(dac.e < EMIN || dac.isZero())) {
    // decFinalize keeps the working digits; num.rs's from_wide rounds them halves to even
    return fin(dac, ROUND_HALF_EVEN);
  }
  return fin(dac, ROUND_HALF_EVEN);
}

// ---- the maths libdecnumber doesn't do, as series in 120 digits, rounded to 34 at the end

namespace series {
  /** W's operations already round to 120 digits, halves up: what is left of Wide's context is its
   * exponent limit, which these series never reach. */
  const c = (x: Decimal): Decimal => (x.isFinite() && x.e > WIDE_EMAX ? new W(Infinity) : x);

  export function int(n: number): Decimal {
    return new W(n);
  }

  /** Below 10^-130: past every digit that matters. */
  function small(w: Decimal): boolean {
    return w.isZero() || w.e + 1 < -130;
  }

  export function add(a: Decimal, b: Decimal): Decimal {
    return c(a.plus(b));
  }

  export function sub(a: Decimal, b: Decimal): Decimal {
    return c(a.minus(b));
  }

  function mul(a: Decimal, b: Decimal): Decimal {
    return c(a.times(b));
  }

  export function div(a: Decimal, b: Decimal): Decimal {
    return c(a.div(b));
  }

  /** libdecnumber's minus: 0 - x, so zero is never negative. */
  function neg(a: Decimal): Decimal {
    return a.isZero() ? new W(0) : a.neg();
  }

  function lt(a: Decimal, b: Decimal): boolean {
    return a.lt(b);
  }

  function sqrt(a: Decimal): Decimal {
    return c(a.sqrt());
  }

  function isNegative(a: Decimal): boolean {
    // libdecnumber's sign bit: a zero from a division can be negative
    return a.isNeg();
  }

  /** atan(1/n) for a whole n, by its series. */
  function atanInv(n: number): Decimal {
    const x = div(int(1), int(n));
    const x2 = mul(x, x);
    let term = x;
    let sum = x;
    for (let k = 1; ; k++) {
      term = mul(term, x2);
      const t = div(term, int(2 * k + 1));
      if (small(t)) {
        return sum;
      }
      sum = k % 2 === 1 ? sub(sum, t) : add(sum, t);
    }
  }

  let PI_WIDE: Decimal | undefined;

  /** π, by Machin's formula. */
  export function pi(): Decimal {
    if (PI_WIDE === undefined) {
      PI_WIDE = sub(mul(int(16), atanInv(5)), mul(int(4), atanInv(239)));
    }
    return PI_WIDE;
  }

  export function halfPi(): Decimal {
    return div(pi(), int(2));
  }

  /** The same angle, between -π and π. */
  export function reduce(x: Decimal): Decimal {
    const twoPi = mul(pi(), int(2));
    const k = div(x, twoPi).toDP(0, ROUND_HALF_EVEN);
    return sub(x, mul(k, twoPi));
  }

  export function sin(x: Decimal): Decimal {
    const x2 = mul(x, x);
    let term = x;
    let sum = x;
    for (let k = 1; ; k++) {
      term = neg(div(mul(term, x2), int(2 * k * (2 * k + 1))));
      if (small(term)) {
        return sum;
      }
      sum = add(sum, term);
    }
  }

  export function cos(x: Decimal): Decimal {
    const x2 = mul(x, x);
    let term = int(1);
    let sum = int(1);
    for (let k = 1; ; k++) {
      term = neg(div(mul(term, x2), int((2 * k - 1) * (2 * k))));
      if (small(term)) {
        return sum;
      }
      sum = add(sum, term);
    }
  }

  export function atan(x: Decimal): Decimal {
    const one = int(1);
    if (isNegative(x)) {
      return neg(atan(neg(x)));
    }
    if (lt(one, x)) {
      return sub(halfPi(), atan(div(one, x)));
    }
    // halve the angle until it is small: atan(x) = 2 atan(x / (1 + sqrt(1 + x²)))
    let y = x;
    let doublings = 0;
    const limit = new W("0.01");
    while (lt(limit, y)) {
      y = div(y, add(one, sqrt(add(one, mul(y, y)))));
      doublings += 1;
    }
    const y2 = mul(y, y);
    let term = y;
    let sum = y;
    for (let k = 1; ; k++) {
      term = neg(mul(term, y2));
      const t = div(term, int(2 * k + 1));
      if (small(t)) {
        break;
      }
      sum = add(sum, t);
    }
    for (let k = 0; k < doublings; k++) {
      sum = mul(sum, int(2));
    }
    return sum;
  }

  export function asin(x: Decimal): Decimal | null {
    const one = int(1);
    const ax = isNegative(x) ? neg(x) : x;
    if (lt(one, ax)) {
      return null;
    }
    if (!lt(ax, one)) {
      const h = halfPi();
      return isNegative(x) ? neg(h) : h;
    }
    return atan(div(x, sqrt(sub(one, mul(x, x)))));
  }

  export function atan2(y: Decimal, x: Decimal): Decimal {
    if (x.isZero()) {
      if (y.isZero()) {
        return int(0);
      }
      const h = halfPi();
      return isNegative(y) ? neg(h) : h;
    }
    const a = atan(div(y, x));
    if (!isNegative(x)) {
      return a;
    }
    return isNegative(y) ? sub(a, pi()) : add(a, pi());
  }

  export function hyperbolic(x: Decimal, which: "sinh" | "cosh" | "tanh"): Decimal {
    const one = int(1);
    const ax = isNegative(x) ? neg(x) : x;
    const big = int(20000);
    if (lt(big, ax)) {
      if (which === "tanh") {
        return isNegative(x) ? neg(one) : one;
      }
      throw new NumError("TooLarge");
    }
    let sinh: Decimal;
    if (lt(ax, one)) {
      // sinh near 0 by its series, to keep its digits
      const x2 = mul(x, x);
      let term = x;
      let s = x;
      for (let k = 1; ; k++) {
        term = div(mul(term, x2), int(2 * k * (2 * k + 1)));
        if (small(term)) {
          break;
        }
        s = add(s, term);
      }
      sinh = s;
    } else {
      const e = c(x.exp());
      sinh = div(sub(e, div(one, e)), int(2));
    }
    const e = c(x.exp());
    const cosh = div(add(e, div(one, e)), int(2));
    return which === "sinh" ? sinh : which === "cosh" ? cosh : div(sinh, cosh);
  }
}
