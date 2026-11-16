//! Reading the runtime's values for drawing, as @mkp/dom's `values.ts` reads them. Every input
//! arrives with its default filled in, so these only unwrap: an opt to its value, a case to its
//! name, a record to its fields. Numbers are read as `f64` for drawing only: writes go back as
//! exact [`Num`]s.

use mkp_runtime::{Num, Value};

/// The value inside an opt (and inside that one), or the value itself; `None` for none.
pub fn inner(v: Option<&Value>) -> Option<&Value> {
    let mut v = v?;
    loop {
        match v {
            Value::Opt(Some(x)) => v = x,
            Value::Opt(None) => return None,
            other => return Some(other),
        }
    }
}

/// A record's field, or a case's value, by name.
pub fn field<'a>(v: Option<&'a Value>, name: &str) -> Option<&'a Value> {
    match inner(v)? {
        Value::Record(r) => r.get(name),
        Value::Case(c) => c.values.iter().find(|(k, _)| &**k == name).map(|(_, x)| x),
        _ => None,
    }
}

/// A value as the words it shows: a text, a number in its exact form, a bool.
pub fn text(v: Option<&Value>) -> String {
    match inner(v) {
        Some(Value::Text(t)) => t.to_string(),
        Some(Value::Num(n)) | Some(Value::Duration(n)) => n.show(),
        Some(Value::Bool(b)) => b.to_string(),
        _ => String::new(),
    }
}

/// A number as `f64`, for drawing.
pub fn num(v: Option<&Value>) -> Option<f64> {
    match inner(v)? {
        Value::Num(n) | Value::Duration(n) => Some(to_f64(n)),
        _ => None,
    }
}

/// A number as it is: exact.
pub fn exact(v: Option<&Value>) -> Option<Num> {
    match inner(v)? {
        Value::Num(n) => Some(*n),
        _ => None,
    }
}

pub fn flag(v: Option<&Value>, otherwise: bool) -> bool {
    match inner(v) {
        Some(Value::Bool(b)) => *b,
        _ => otherwise,
    }
}

/// An enum's or a token's case name: `START`, `ACCENT`.
pub fn case(v: Option<&Value>) -> Option<&str> {
    match inner(v)? {
        Value::Case(c) => Some(&c.name),
        _ => None,
    }
}

/// A list's items.
pub fn list(v: Option<&Value>) -> Vec<&Value> {
    match inner(v) {
        Some(Value::List(l)) => l.items.iter().map(|i| &i.value).collect(),
        _ => Vec::new(),
    }
}

/// A point, as `(x, y)`.
pub fn point(v: Option<&Value>) -> Option<(f64, f64)> {
    Some((num(field(v, "x"))?, num(field(v, "y"))?))
}

/// A region, as its two corners.
pub fn region(v: Option<&Value>) -> Option<((f64, f64), (f64, f64))> {
    Some((point(field(v, "from"))?, point(field(v, "to"))?))
}

/// A range's ends and step, each as `f64`.
pub fn range(v: Option<&Value>) -> Option<(Option<f64>, Option<f64>, Option<f64>)> {
    match inner(v)? {
        Value::Range(r) => Some((num(r.low.as_ref()), num(r.high.as_ref()), num(r.step.as_ref()))),
        _ => None,
    }
}

pub fn to_f64(n: &Num) -> f64 {
    n.show().parse().unwrap_or(0.0)
}

/// A float as an exact number, rounded half away from zero to `places` digits after the point:
/// pointer maths is floating point, and a write should be a number a person would write.
pub fn to_num(x: f64, places: u32) -> Num {
    if !x.is_finite() {
        return Num::zero();
    }
    let p = places.min(12);
    let scale = 10f64.powi(p as i32);
    let r = (x * scale).round() / scale;
    let s = format!("{:.*}", p as usize, r);
    let s = if s.contains('.') { s.trim_end_matches('0').trim_end_matches('.').to_string() } else { s };
    let s = if s == "-0" { "0".to_string() } else { s };
    Num::parse(&s).unwrap_or_else(Num::zero)
}

/// How many digits after the point keep a sub-pixel's worth, for `units` units per pixel.
pub fn places_for(units_per_px: f64) -> u32 {
    if units_per_px.is_nan() || units_per_px <= 0.0 || !units_per_px.is_finite() {
        return 2;
    }
    ((-units_per_px.log10()).ceil() + 1.0).max(0.0) as u32
}

/// A template's text: its pieces, with each hole's shown text between them.
pub fn template_text(v: Option<&Value>) -> String {
    let pieces = list(field(v, "pieces"));
    let holes = list(field(v, "holes"));
    let mut out = String::new();
    for (k, p) in pieces.iter().enumerate() {
        out.push_str(&text(Some(p)));
        if let Some(h) = holes.get(k) {
            out.push_str(&text(field(Some(h), "value")));
        }
    }
    out
}

/// A latex value's TeX: the text the Markdown writes between dollars.
pub fn tex(latex: Option<&Value>) -> String {
    template_text(field(latex, "tex"))
}

/// A point value in the IR's record form.
pub fn point_value(x: Num, y: Num) -> Value {
    mkp_runtime::layout::pt_value(&mkp_runtime::Pt { x, y })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn rounds_half_away_from_zero() {
        assert_eq!(to_num(1.5625, 3).show(), "1.563");
        assert_eq!(to_num(100.0, 1).show(), "100");
        assert_eq!(to_num(-0.0001, 2).show(), "0");
        assert_eq!(to_num(0.3, 4).show(), "0.3");
    }

    #[test]
    fn places_keep_a_sub_pixel() {
        assert_eq!(places_for(1.0), 1);
        assert_eq!(places_for(0.00625), 4);
        assert_eq!(places_for(0.5), 2);
    }
}
