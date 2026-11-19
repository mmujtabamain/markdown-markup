// Num: num.rs's unit tests, one for one, then the show form, rounding halves to even at 34 digits,
// and the failures, with libdecnumber's own behaviour where num.rs inherits it.

import { describe, test } from "node:test";
import assert from "node:assert/strict";
import { Num, NumError } from "../dist/index.js";

const n = (s) => {
  const x = Num.parse(s);
  assert.notEqual(x, null, `${s} parses`);
  return x;
};

const fails = (f, kind) =>
  assert.throws(f, (e) => {
    assert.ok(e instanceof NumError, `a NumError, not ${e}`);
    assert.equal(e.kind, kind);
    assert.equal(e.message, kind === "DivisionByZero" ? "a division by zero" : "a number too large for decimal128");
    return true;
  });

describe("num.rs's tests", () => {
  test("exact_base_ten", () => {
    assert.equal(n("0.1").add(n("0.2")).show(), "0.3");
    assert.equal(n("7").div(n("2")).show(), "3.5");
    assert.equal(n("1").div(n("3")).show(), "0.3333333333333333333333333333333333");
    assert.equal(n("1").div(n("3")).mul(n("3")).show(), "0.9999999999999999999999999999999999");
    assert.equal(n("-7").rem(n("2")).show(), "-1");
    assert.equal(n("7").rem(n("-2")).show(), "1");
  });

  test("shortest_exact_form", () => {
    assert.equal(n("42.000").show(), "42");
    assert.equal(n("1_000").show(), "1000");
    assert.equal(n("0.25").show(), "0.25");
    assert.equal(n("0").neg().show(), "0");
    assert.equal(n("1000").exp().show().length, 435);
  });

  test("failures_and_no_answer", () => {
    fails(() => n("1").div(n("0")), "DivisionByZero");
    fails(() => n("20000").exp(), "TooLarge");
    assert.equal(n("-4").sqrt(), null);
    assert.equal(n("0").ln(), null);
    assert.equal(n("2").asin(), null);
    assert.equal(n("0").pow(n("-1")), null);
    assert.equal(n("-8").pow(n("0.5")), null);
    assert.equal(n("-2").pow(n("3")).show(), "-8");
  });

  test("rounding", () => {
    assert.equal(n("2.5").round().show(), "3");
    assert.equal(n("-2.5").round().show(), "-3");
    assert.equal(n("-2.5").floor().show(), "-3");
    assert.equal(n("2.1").ceil().show(), "3");
    assert.equal(n("2.345").fmt(2), "2.35");
    assert.equal(n("2").fmt(2), "2.00");
    assert.equal(n("3.14159").fmt(0), "3");
  });

  test("maths_to_34_digits", () => {
    assert.equal(Num.pi().show(), "3.141592653589793238462643383279503");
    assert.equal(n("1").exp().show(), "2.718281828459045235360287471352662");
    assert.equal(n("2").sqrt().show(), "1.414213562373095048801688724209698");
    assert.equal(n("0").sin().show(), "0");
    assert.equal(n("1").sin().show(), "0.841470984807896506652502321630299");
    assert.equal(n("1").cos().show(), "0.5403023058681397174009366074429766");
    assert.equal(n("1").atan().show(), "0.7853981633974483096156608458198757");
    assert.equal(n("1").atan2(n("-1")).show(), "2.356194490192344928846982537459627");
    assert.equal(n("1").asin().show(), "1.570796326794896619231321691639751");
    assert.equal(n("0.5").tanh().show(), "0.4621171572600097585023184836436725");
  });
});

describe("the show form", () => {
  test("never an exponent", () => {
    const big = n("1" + "0".repeat(40));
    assert.equal(big.show(), "1" + "0".repeat(40));
    assert.equal(n("1").div(big).show(), "0." + "0".repeat(39) + "1");
    // the largest decimal128 number, written out
    const max = n("9".repeat(34) + "0".repeat(6111));
    assert.equal(max.show(), "9".repeat(34) + "0".repeat(6111));
    assert.equal(max.show().length, 6145);
  });

  test("no negative zero", () => {
    for (const z of [n("-0"), n("-0.000"), n("0").mul(n("-1")), n("-4").rem(n("2")), n("-0.4").round(), n("-0.4").ceil(), n("5").sub(n("5")), n("-0").abs(), n("0").neg()]) {
      assert.equal(z.show(), "0");
      assert.equal(z.isNegative(), false);
      assert.equal(z.isZero(), true);
    }
    assert.equal(n("-0.001").fmt(2), "0.00");
    assert.equal(n("-0.4").fmt(0), "0");
    assert.equal(n("0").sign().show(), "0");
  });

  test("trailing zeros are dropped, and kept where they are the number's own", () => {
    assert.equal(n("42.50").show(), "42.5");
    assert.equal(n("1000.000").show(), "1000");
    assert.equal(n("100").show(), "100");
    assert.equal(n("0.10").show(), "0.1");
    assert.equal(n("2.50").mul(n("4")).show(), "10");
    assert.equal(n("-7.000").show(), "-7");
    assert.equal(n("007").show(), "7");
    assert.equal(n("2").fmt(3), "2.000");
    assert.equal(n("1.5").fmt(1), "1.5");
    assert.equal(n("123.456").fmt(10), "123.4560000000");
  });

  test("fmt rounds halves away from zero", () => {
    assert.equal(n("2.5").fmt(0), "3");
    assert.equal(n("-2.5").fmt(0), "-3");
    assert.equal(n("1.005").fmt(2), "1.01");
    assert.equal(n("-1.005").fmt(2), "-1.01");
    assert.equal(n("0.125").fmt(2), "0.13");
  });
});

describe("34 digits, halves to even", () => {
  test("literals", () => {
    assert.equal(n("1.00000000000000000000000000000000050").show(), "1");
    assert.equal(n("1.00000000000000000000000000000000150").show(), "1.000000000000000000000000000000002");
    assert.equal(n("1.00000000000000000000000000000000051").show(), "1.000000000000000000000000000000001");
    assert.equal(n("9".repeat(35)).show(), "1" + "0".repeat(35));
    assert.equal(n("12345678901234567890123456789012345678").show(), "12345678901234567890123456789012350000");
  });

  test("sums and products", () => {
    // 1E33 + 0.5: a tie, kept even
    assert.equal(n("1" + "0".repeat(33)).add(n("0.5")).show(), "1" + "0".repeat(33));
    // 1E33 + 1.5: a tie, up to even
    assert.equal(n("1" + "0".repeat(33)).add(n("1.5")).show(), "1" + "0".repeat(31) + "02");
    // a tie on an odd last digit goes up
    assert.equal(n("9".repeat(34)).add(n("0.5")).show(), "1" + "0".repeat(34));
    assert.equal(n("100000000000000005").mul(n("100000000000000005")).show(), "10000000000000001000000000000000020");
    assert.equal(n("2").div(n("3")).show(), "0.6666666666666666666666666666666667");
    assert.equal(n("-2").div(n("3")).show(), "-0.6666666666666666666666666666666667");
  });

  test("fmt past 34 digits writes the exact number, padded, as num.rs now does", () => {
    assert.equal(n("1000000000000000000000000000000").fmt(10), "1000000000000000000000000000000.0000000000");
    assert.equal(n("-12345678901234567890123456789012.5").fmt(4), "-12345678901234567890123456789012.5000");
  });

  test("pow rounds its result halves to even, as a product does (page 2)", () => {
    assert.equal(n("100000000000000005").pow(n("2")).show(), "10000000000000001000000000000000020");
    assert.equal(n("100000000000000005").pow(n("2")).show(), n("100000000000000005").mul(n("100000000000000005")).show());
    assert.equal(n("2").pow(n("10")).show(), "1024");
    assert.equal(n("2").pow(n("-2")).show(), "0.25");
    assert.equal(n("16").pow(n("0.5")).show(), "4");
  });
});

describe("failures", () => {
  test("division and remainder by zero", () => {
    fails(() => n("1").div(n("0")), "DivisionByZero");
    fails(() => n("0").div(n("0")), "DivisionByZero");
    fails(() => n("5").rem(n("0")), "DivisionByZero");
  });

  test("results beyond 10^6144", () => {
    const max = n("9".repeat(34) + "0".repeat(6111));
    fails(() => max.mul(n("10")), "TooLarge");
    fails(() => max.add(max), "TooLarge");
    fails(() => n("1").div(n("0." + "0".repeat(6150) + "1")), "TooLarge");
    fails(() => n("15000").cosh(), "TooLarge");
    fails(() => n("30000").sinh(), "TooLarge");
    assert.equal(n("30000").tanh().show(), "1");
    assert.equal(n("-30000").tanh().show(), "-1");
    assert.equal(Num.parse("1" + "0".repeat(6145)), null);
    assert.equal(n("-20000").exp().show(), "0");
  });

  test("libdecnumber's invalid operations, which num.rs reports as too large", () => {
    // 0 to the power 0
    fails(() => n("0").pow(n("0")), "TooLarge");
    // a remainder whose quotient needs more than 34 digits
    fails(() => n("1" + "0".repeat(37)).rem(n("3")), "TooLarge");
    assert.equal(n("1" + "0".repeat(33)).rem(n("3")).show(), "1");
    // a negative number to a whole power too large for the integer path
    fails(() => n("-2").pow(n("10000000000")), "TooLarge");
  });

  test("below the smallest subnormal, a result is 0", () => {
    const tiny = n("0." + "0".repeat(6175) + "1");
    assert.equal(tiny.show(), "0." + "0".repeat(6175) + "1");
    assert.equal(tiny.div(n("10")).show(), "0");
    assert.equal(tiny.div(n("2")).show(), "0");
    assert.equal(tiny.mul(n("1.5")).show(), "0." + "0".repeat(6175) + "2");
  });
});

describe("parse", () => {
  test("Extended Mark's number literal and nothing else", () => {
    for (const bad of ["", "-", ".5", "5.", "1e3", "+1", " 5", "5 ", "1.2.3", "--1", "0x10", "1,5", "Infinity", "NaN"]) {
      assert.equal(Num.parse(bad), null, `${JSON.stringify(bad)} isn't a number`);
    }
    assert.equal(n("1_000_000.000_1").show(), "1000000.0001");
    assert.equal(n("-0012.50").show(), "-12.5");
  });
});

describe("toI64", () => {
  test("whole numbers that fit", () => {
    assert.equal(n("42").toI64(), 42);
    assert.equal(n("-7.000").toI64(), -7);
    assert.equal(n("0").toI64(), 0);
    assert.equal(n("1" + "0".repeat(18)).toI64(), 1e18);
    assert.equal(n("0.5").toI64(), null);
    assert.equal(n("1" + "0".repeat(19)).toI64(), null);
    assert.equal(n("12" + "0".repeat(18)).toI64(), null);
    assert.equal(n("9223372036854775807").toI64(), 9223372036854775807);
    assert.equal(n("9223372036854775808").toI64(), null);
  });

  test("as num.rs: libdecnumber's rescale keeps a whole number's low 34 digits", () => {
    // 10^43 + 10^10: its shortest form has an exponent of 10, so it is rescaled, losing its top digits
    assert.equal(n("1" + "0".repeat(32) + "1" + "0".repeat(10)).toI64(), 1e10);
  });
});

describe("maths", () => {
  test("trig and its inverses", () => {
    assert.equal(n("0").cos().show(), "1");
    assert.equal(n("0").tan().show(), "0");
    assert.equal(n("0").atan().show(), "0");
    assert.equal(n("-1").asin().show(), "-1.570796326794896619231321691639751");
    assert.equal(n("1").acos().show(), "0");
    assert.equal(n("-1").acos().show(), "3.141592653589793238462643383279503");
    assert.equal(n("0").atan2(n("-5")).show(), "3.141592653589793238462643383279503");
    assert.equal(n("0").atan2(n("0")).show(), "0");
    assert.equal(n("-2").atan2(n("0")).show(), "-1.570796326794896619231321691639751");
    assert.equal(n("1.5").acos(), null);
  });

  test("sign, abs, round, floor, ceil", () => {
    assert.equal(n("-3").sign().show(), "-1");
    assert.equal(n("0.001").sign().show(), "1");
    assert.equal(n("-3.5").abs().show(), "3.5");
    assert.equal(n("0.5").round().show(), "1");
    assert.equal(n("-0.5").round().show(), "-1");
    assert.equal(n("3.5").floor().show(), "3");
    assert.equal(n("-3.5").ceil().show(), "-3");
    assert.equal(n("1" + "0".repeat(40)).round().show(), "1" + "0".repeat(40));
  });
});
