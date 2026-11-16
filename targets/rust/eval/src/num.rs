//! MKP's one number type: exact base-10, IEEE 754 decimal128 with 34 significant digits,
//! rounding halves to even (page 2), through IBM's libdecnumber.
//!
//! There is no negative zero: every result that is zero is plain `0`, so a number has one
//! value and one spelling in every runtime. A result too large for decimal128, and a division
//! by zero, are failures; maths with no answer gives `None`.

use dec::{Context, Decimal, Decimal128};
use std::cmp::Ordering;
use std::fmt;

/// Internal precision for maths written as series: 150 digits, well past 34.
type Wide = Decimal<50>;
const WIDE_DIGITS: usize = 120;

#[derive(Clone, Copy)]
pub struct Num(Decimal128);

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum NumError {
    /// A division, or a remainder, by zero.
    DivisionByZero,
    /// A result beyond decimal128's 10^6144.
    TooLarge,
}

impl fmt::Display for NumError {
    fn fmt(&self, f: &mut fmt::Formatter) -> fmt::Result {
        f.write_str(match self {
            NumError::DivisionByZero => "a division by zero",
            NumError::TooLarge => "a number too large for decimal128",
        })
    }
}

pub type NumResult = Result<Num, NumError>;

fn cx() -> Context<Decimal128> {
    Context::<Decimal128>::default()
}

fn wide_cx(digits: usize) -> Context<Wide> {
    let mut c = Context::<Wide>::default();
    c.set_precision(digits).unwrap();
    c.set_max_exponent(99_999).unwrap();
    c.set_min_exponent(-99_999).unwrap();
    c
}

/// A context with decimal128's own precision and exponents, for libdecnumber's maths. It rounds
/// halves to even, as every result does (page 2): libdecnumber's default is half up.
fn d128_cx() -> Context<Wide> {
    let mut c = Context::<Wide>::default();
    c.set_rounding(dec::Rounding::HalfEven);
    c.set_precision(34).unwrap();
    c.set_max_exponent(6144).unwrap();
    c.set_min_exponent(-6143).unwrap();
    c
}

fn wide(n: Num) -> Wide {
    Wide::from(n.0)
}

fn wide_str(s: &str) -> Wide {
    s.parse().unwrap()
}

impl Num {
    fn checked(d: Decimal128) -> NumResult {
        if d.is_infinite() || d.is_nan() {
            return Err(NumError::TooLarge);
        }
        Ok(Num::plain(d))
    }

    /// Zero is always positive.
    fn plain(d: Decimal128) -> Num {
        if d.is_zero() && d.is_negative() {
            Num(cx().abs(d))
        } else {
            Num(d)
        }
    }

    fn from_wide(w: &Wide) -> NumResult {
        if !w.is_finite() {
            return Err(NumError::TooLarge);
        }
        let d = cx().from_decimal(w);
        Num::checked(d)
    }

    pub fn zero() -> Num {
        Num::int(0)
    }

    pub fn int(n: i64) -> Num {
        Num(cx().from_i128(n as i128))
    }

    /// An MKP number literal (`1_000`, `0.25`) or an IR number (`-7`, `3.5`).
    pub fn parse(s: &str) -> Option<Num> {
        let t: String = s.chars().filter(|c| *c != '_').collect();
        let body = t.strip_prefix('-').unwrap_or(&t);
        let mut parts = body.splitn(2, '.');
        let whole = parts.next().unwrap_or("");
        let frac = parts.next();
        if whole.is_empty() || !whole.bytes().all(|b| b.is_ascii_digit()) {
            return None;
        }
        if let Some(f) = frac {
            if f.is_empty() || !f.bytes().all(|b| b.is_ascii_digit()) {
                return None;
            }
        }
        let mut c = cx();
        let d = c.parse(t.as_str()).ok()?;
        Num::checked(d).ok()
    }

    pub fn d128(&self) -> Decimal128 {
        self.0
    }

    pub fn add(self, o: Num) -> NumResult {
        Num::checked(cx().add(self.0, o.0))
    }

    pub fn sub(self, o: Num) -> NumResult {
        Num::checked(cx().sub(self.0, o.0))
    }

    pub fn mul(self, o: Num) -> NumResult {
        Num::checked(cx().mul(self.0, o.0))
    }

    pub fn div(self, o: Num) -> NumResult {
        if o.is_zero() {
            return Err(NumError::DivisionByZero);
        }
        Num::checked(cx().div(self.0, o.0))
    }

    /// The remainder, with the sign of the left side.
    pub fn rem(self, o: Num) -> NumResult {
        if o.is_zero() {
            return Err(NumError::DivisionByZero);
        }
        Num::checked(cx().rem(self.0, o.0))
    }

    pub fn neg(self) -> Num {
        Num::plain(cx().minus(self.0))
    }

    pub fn abs(self) -> Num {
        Num::plain(cx().abs(self.0))
    }

    pub fn is_zero(&self) -> bool {
        self.0.is_zero()
    }

    pub fn is_negative(&self) -> bool {
        !self.0.is_zero() && self.0.is_negative()
    }

    pub fn is_int(&self) -> bool {
        self.0.is_integer() || cx().reduce(self.0).exponent() >= 0
    }

    /// -1, 0 or 1.
    pub fn sign(self) -> Num {
        if self.is_zero() {
            Num::int(0)
        } else if self.is_negative() {
            Num::int(-1)
        } else {
            Num::int(1)
        }
    }

    /// The whole number nearest, halves away from zero.
    pub fn round(self) -> Num {
        let mut c = cx();
        c.set_rounding(dec::Rounding::HalfUp);
        Num::plain(c.round(self.0))
    }

    pub fn floor(self) -> Num {
        let mut c = cx();
        c.set_rounding(dec::Rounding::Floor);
        Num::plain(c.round(self.0))
    }

    pub fn ceil(self) -> Num {
        let mut c = cx();
        c.set_rounding(dec::Rounding::Ceiling);
        Num::plain(c.round(self.0))
    }

    /// The whole number it is, when it is one and fits.
    pub fn to_i64(&self) -> Option<i64> {
        if !self.is_int() {
            return None;
        }
        let r = cx().reduce(self.0);
        if r.exponent() > 18 {
            return None;
        }
        let mut c = cx();
        let mut q = r;
        c.rescale(&mut q, 0);
        let v = q.coefficient();
        i64::try_from(v).ok()
    }

    /// Its shortest exact form: no exponent and no trailing zeros. `42`, `3.5`, `0.3`, `-7`.
    pub fn show(&self) -> String {
        if self.is_zero() {
            return "0".into();
        }
        let r = cx().reduce(self.0);
        let digits: String = r.coefficient_digits().iter().skip_while(|d| **d == 0).map(|d| (b'0' + d) as char).collect();
        let exp = r.exponent();
        let mut out = String::new();
        if r.is_negative() {
            out.push('-');
        }
        if exp >= 0 {
            out.push_str(&digits);
            for _ in 0..exp {
                out.push('0');
            }
        } else {
            let point = digits.len() as i64 + exp as i64;
            if point <= 0 {
                out.push_str("0.");
                for _ in 0..(-point) {
                    out.push('0');
                }
                out.push_str(&digits);
            } else {
                out.push_str(&digits[..point as usize]);
                out.push('.');
                out.push_str(&digits[point as usize..]);
            }
        }
        out
    }

    /// Exactly `places` digits after the point, rounding halves away from zero.
    pub fn fmt(&self, places: u32) -> String {
        let mut c = cx();
        c.set_rounding(dec::Rounding::HalfUp);
        let quantum = c.parse(format!("1E-{}", places).as_str()).unwrap();
        let s = Num::plain(c.quantize(self.0, quantum));
        let mut text = s.show();
        if places > 0 {
            let have = text.split_once('.').map(|(_, f)| f.len()).unwrap_or(0);
            if have == 0 {
                text.push('.');
            }
            for _ in have..places as usize {
                text.push('0');
            }
        }
        text
    }

    pub fn sqrt(self) -> Option<Num> {
        if self.is_negative() {
            return None;
        }
        let mut w = wide(self);
        d128_cx().sqrt(&mut w);
        Num::from_wide(&w).ok()
    }

    /// `None` for 0 to a negative power, or a negative number to a power that isn't whole.
    pub fn pow(self, p: Num) -> Result<Option<Num>, NumError> {
        if self.is_zero() && p.is_negative() {
            return Ok(None);
        }
        if self.is_negative() && !p.is_int() {
            return Ok(None);
        }
        let mut w = wide(self);
        let e = wide(p);
        let mut c = d128_cx();
        c.pow(&mut w, &e);
        Num::from_wide(&w).map(Some)
    }

    pub fn exp(self) -> NumResult {
        let mut w = wide(self);
        d128_cx().exp(&mut w);
        Num::from_wide(&w)
    }

    /// `None` at 0 or below.
    pub fn ln(self) -> Option<Num> {
        if self.is_zero() || self.is_negative() {
            return None;
        }
        let mut w = wide(self);
        d128_cx().ln(&mut w);
        Num::from_wide(&w).ok()
    }

    pub fn sin(self) -> NumResult {
        Num::from_wide(&series::sin(&series::reduce(wide(self))))
    }

    pub fn cos(self) -> NumResult {
        Num::from_wide(&series::cos(&series::reduce(wide(self))))
    }

    pub fn tan(self) -> NumResult {
        let r = series::reduce(wide(self));
        let s = series::sin(&r);
        let c = series::cos(&r);
        if c.is_zero() {
            return Err(NumError::TooLarge);
        }
        let mut out = s;
        wide_cx(WIDE_DIGITS).div(&mut out, &c);
        Num::from_wide(&out)
    }

    /// `None` outside -1..1.
    pub fn asin(self) -> Option<Num> {
        series::asin(&wide(self)).and_then(|w| Num::from_wide(&w).ok())
    }

    /// `None` outside -1..1.
    pub fn acos(self) -> Option<Num> {
        let a = series::asin(&wide(self))?;
        let mut out = series::half_pi();
        wide_cx(WIDE_DIGITS).sub(&mut out, &a);
        Num::from_wide(&out).ok()
    }

    pub fn atan(self) -> NumResult {
        Num::from_wide(&series::atan(&wide(self)))
    }

    /// `y.atan2(x)`: the angle of the point (x, y), from -π to π.
    pub fn atan2(self, x: Num) -> NumResult {
        Num::from_wide(&series::atan2(&wide(self), &wide(x)))
    }

    pub fn sinh(self) -> NumResult {
        series::hyperbolic(&wide(self), series::Hyp::Sinh).and_then(|w| Num::from_wide(&w))
    }

    pub fn cosh(self) -> NumResult {
        series::hyperbolic(&wide(self), series::Hyp::Cosh).and_then(|w| Num::from_wide(&w))
    }

    pub fn tanh(self) -> NumResult {
        series::hyperbolic(&wide(self), series::Hyp::Tanh).and_then(|w| Num::from_wide(&w))
    }

    pub fn pi() -> Num {
        Num::from_wide(&series::pi()).unwrap()
    }
}

impl PartialEq for Num {
    fn eq(&self, o: &Num) -> bool {
        self.cmp(o) == Ordering::Equal
    }
}

impl Eq for Num {}

impl PartialOrd for Num {
    fn partial_cmp(&self, o: &Num) -> Option<Ordering> {
        Some(self.cmp(o))
    }
}

impl Ord for Num {
    fn cmp(&self, o: &Num) -> Ordering {
        cx().partial_cmp(self.0, o.0).unwrap_or(Ordering::Equal)
    }
}

impl fmt::Debug for Num {
    fn fmt(&self, f: &mut fmt::Formatter) -> fmt::Result {
        write!(f, "{}", self.show())
    }
}

impl fmt::Display for Num {
    fn fmt(&self, f: &mut fmt::Formatter) -> fmt::Result {
        f.write_str(&self.show())
    }
}

/// The maths libdecnumber doesn't do, as series in 120 digits, rounded to 34 at the end.
mod series {
    use super::*;
    use std::sync::OnceLock;

    fn c() -> Context<Wide> {
        wide_cx(WIDE_DIGITS)
    }

    fn int(n: i64) -> Wide {
        wide_str(&n.to_string())
    }

    fn small(w: &Wide) -> bool {
        // below 10^-130: past every digit that matters
        w.is_zero() || w.exponent() + (w.digits() as i32) < -130
    }

    fn add(a: &Wide, b: &Wide) -> Wide {
        let mut x = *a;
        c().add(&mut x, b);
        x
    }

    fn sub(a: &Wide, b: &Wide) -> Wide {
        let mut x = *a;
        c().sub(&mut x, b);
        x
    }

    fn mul(a: &Wide, b: &Wide) -> Wide {
        let mut x = *a;
        c().mul(&mut x, b);
        x
    }

    fn div(a: &Wide, b: &Wide) -> Wide {
        let mut x = *a;
        c().div(&mut x, b);
        x
    }

    fn neg(a: &Wide) -> Wide {
        let mut x = *a;
        c().minus(&mut x);
        x
    }

    fn lt(a: &Wide, b: &Wide) -> bool {
        c().partial_cmp(a, b) == Some(Ordering::Less)
    }

    fn sqrt(a: &Wide) -> Wide {
        let mut x = *a;
        c().sqrt(&mut x);
        x
    }

    /// atan(1/n) for a whole n, by its series.
    fn atan_inv(n: i64) -> Wide {
        let x = div(&int(1), &int(n));
        let x2 = mul(&x, &x);
        let mut term = x;
        let mut sum = x;
        let mut k = 1;
        loop {
            term = mul(&term, &x2);
            let t = div(&term, &int(2 * k + 1));
            if small(&t) {
                return sum;
            }
            sum = if k % 2 == 1 { sub(&sum, &t) } else { add(&sum, &t) };
            k += 1;
        }
    }

    /// π, by Machin's formula.
    pub fn pi() -> Wide {
        static PI: OnceLock<String> = OnceLock::new();
        let s = PI.get_or_init(|| {
            let p = sub(&mul(&int(16), &atan_inv(5)), &mul(&int(4), &atan_inv(239)));
            p.to_standard_notation_string()
        });
        wide_str(s)
    }

    pub fn half_pi() -> Wide {
        div(&pi(), &int(2))
    }

    /// The same angle, between -π and π.
    pub fn reduce(x: Wide) -> Wide {
        let two_pi = mul(&pi(), &int(2));
        let mut k = div(&x, &two_pi);
        let mut cr = c();
        cr.set_rounding(dec::Rounding::HalfEven);
        let mut q = k;
        cr.round(&mut q);
        k = q;
        sub(&x, &mul(&k, &two_pi))
    }

    pub fn sin(x: &Wide) -> Wide {
        let x2 = mul(x, x);
        let mut term = *x;
        let mut sum = *x;
        let mut k = 1;
        loop {
            term = neg(&div(&mul(&term, &x2), &int((2 * k) * (2 * k + 1))));
            if small(&term) {
                return sum;
            }
            sum = add(&sum, &term);
            k += 1;
        }
    }

    pub fn cos(x: &Wide) -> Wide {
        let x2 = mul(x, x);
        let mut term = int(1);
        let mut sum = int(1);
        let mut k = 1;
        loop {
            term = neg(&div(&mul(&term, &x2), &int((2 * k - 1) * (2 * k))));
            if small(&term) {
                return sum;
            }
            sum = add(&sum, &term);
            k += 1;
        }
    }

    pub fn atan(x: &Wide) -> Wide {
        let one = int(1);
        if x.is_negative() {
            return neg(&atan(&neg(x)));
        }
        if lt(&one, x) {
            return sub(&half_pi(), &atan(&div(&one, x)));
        }
        // halve the angle until it is small: atan(x) = 2 atan(x / (1 + sqrt(1 + x²)))
        let mut y = *x;
        let mut doublings = 0;
        let limit = wide_str("0.01");
        while lt(&limit, &y) {
            y = div(&y, &add(&one, &sqrt(&add(&one, &mul(&y, &y)))));
            doublings += 1;
        }
        let y2 = mul(&y, &y);
        let mut term = y;
        let mut sum = y;
        let mut k = 1;
        loop {
            term = neg(&mul(&term, &y2));
            let t = div(&term, &int(2 * k + 1));
            if small(&t) {
                break;
            }
            sum = add(&sum, &t);
            k += 1;
        }
        for _ in 0..doublings {
            sum = mul(&sum, &int(2));
        }
        sum
    }

    pub fn asin(x: &Wide) -> Option<Wide> {
        let one = int(1);
        let ax = if x.is_negative() { neg(x) } else { *x };
        if lt(&one, &ax) {
            return None;
        }
        if !lt(&ax, &one) {
            let h = half_pi();
            return Some(if x.is_negative() { neg(&h) } else { h });
        }
        Some(atan(&div(x, &sqrt(&sub(&one, &mul(x, x))))))
    }

    pub fn atan2(y: &Wide, x: &Wide) -> Wide {
        if x.is_zero() {
            if y.is_zero() {
                return int(0);
            }
            let h = half_pi();
            return if y.is_negative() { neg(&h) } else { h };
        }
        let a = atan(&div(y, x));
        if !x.is_negative() {
            return a;
        }
        if y.is_negative() {
            sub(&a, &pi())
        } else {
            add(&a, &pi())
        }
    }

    pub enum Hyp {
        Sinh,
        Cosh,
        Tanh,
    }

    pub fn hyperbolic(x: &Wide, which: Hyp) -> Result<Wide, NumError> {
        let one = int(1);
        let ax = if x.is_negative() { neg(x) } else { *x };
        let big = wide_str("20000");
        if lt(&big, &ax) {
            return match which {
                Hyp::Tanh => Ok(if x.is_negative() { neg(&one) } else { one }),
                _ => Err(NumError::TooLarge),
            };
        }
        // sinh near 0 by its series, to keep its digits
        let sinh = if lt(&ax, &one) {
            let x2 = mul(x, x);
            let mut term = *x;
            let mut sum = *x;
            let mut k = 1;
            loop {
                term = div(&mul(&term, &x2), &int((2 * k) * (2 * k + 1)));
                if small(&term) {
                    break sum;
                }
                sum = add(&sum, &term);
                k += 1;
            }
        } else {
            let mut e = *x;
            c().exp(&mut e);
            div(&sub(&e, &div(&one, &e)), &int(2))
        };
        let mut e = *x;
        c().exp(&mut e);
        let cosh = div(&add(&e, &div(&one, &e)), &int(2));
        Ok(match which {
            Hyp::Sinh => sinh,
            Hyp::Cosh => cosh,
            Hyp::Tanh => div(&sinh, &cosh),
        })
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn n(s: &str) -> Num {
        Num::parse(s).unwrap()
    }

    #[test]
    fn exact_base_ten() {
        assert_eq!(n("0.1").add(n("0.2")).unwrap().show(), "0.3");
        assert_eq!(n("7").div(n("2")).unwrap().show(), "3.5");
        assert_eq!(n("1").div(n("3")).unwrap().show(), "0.3333333333333333333333333333333333");
        assert_eq!(n("1").div(n("3")).unwrap().mul(n("3")).unwrap().show(), "0.9999999999999999999999999999999999");
        assert_eq!(n("-7").rem(n("2")).unwrap().show(), "-1");
        assert_eq!(n("7").rem(n("-2")).unwrap().show(), "1");
    }

    #[test]
    fn shortest_exact_form() {
        assert_eq!(n("42.000").show(), "42");
        assert_eq!(n("1_000").show(), "1000");
        assert_eq!(n("0.25").show(), "0.25");
        assert_eq!(n("0").neg().show(), "0");
        assert_eq!(n("1000").exp().unwrap().show().len(), 435);
    }

    #[test]
    fn failures_and_no_answer() {
        assert_eq!(n("1").div(n("0")).unwrap_err(), NumError::DivisionByZero);
        assert_eq!(n("20000").exp().unwrap_err(), NumError::TooLarge);
        assert!(n("-4").sqrt().is_none());
        assert!(n("0").ln().is_none());
        assert!(n("2").asin().is_none());
        assert!(n("0").pow(n("-1")).unwrap().is_none());
        assert!(n("-8").pow(n("0.5")).unwrap().is_none());
        assert_eq!(n("-2").pow(n("3")).unwrap().unwrap().show(), "-8");
    }

    #[test]
    fn maths_rounds_halves_to_even() {
        // 100000000000000005² has 35 digits and ends in 25: the tie goes to the even neighbour,
        // as a product does (page 2)
        let x = Num::parse("100000000000000005").unwrap();
        let squared = x.pow(Num::int(2)).unwrap().unwrap();
        assert_eq!(squared, x.mul(x).unwrap());
        assert_eq!(squared.show(), "10000000000000001000000000000000020");
    }

    #[test]
    fn rounding() {
        assert_eq!(n("2.5").round().show(), "3");
        assert_eq!(n("-2.5").round().show(), "-3");
        assert_eq!(n("-2.5").floor().show(), "-3");
        assert_eq!(n("2.1").ceil().show(), "3");
        assert_eq!(n("2.345").fmt(2), "2.35");
        assert_eq!(n("2").fmt(2), "2.00");
        assert_eq!(n("3.14159").fmt(0), "3");
    }

    #[test]
    fn maths_to_34_digits() {
        assert_eq!(Num::pi().show(), "3.141592653589793238462643383279503");
        assert_eq!(n("1").exp().unwrap().show(), "2.718281828459045235360287471352662");
        assert_eq!(n("2").sqrt().unwrap().show(), "1.414213562373095048801688724209698");
        assert_eq!(n("0").sin().unwrap().show(), "0");
        assert_eq!(n("1").sin().unwrap().show(), "0.841470984807896506652502321630299");
        assert_eq!(n("1").cos().unwrap().show(), "0.5403023058681397174009366074429766");
        assert_eq!(n("1").atan().unwrap().show(), "0.7853981633974483096156608458198757");
        assert_eq!(n("1").atan2(n("-1")).unwrap().show(), "2.356194490192344928846982537459627");
        assert_eq!(n("1").asin().unwrap().show(), "1.570796326794896619231321691639751");
        assert_eq!(n("0.5").tanh().unwrap().show(), "0.4621171572600097585023184836436725");
    }
}
