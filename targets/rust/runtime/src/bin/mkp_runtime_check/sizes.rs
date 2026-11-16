//! The headless native target's fixed sizes, in the page's own lengths, the test target's
//! (targets/ts/test/sizes.mjs), so a check can say exactly where a plane's spots land:
//!
//! - Text is 8 wide per character and 20 high: a label, a paragraph, a button's label.
//! - A flex lines its children up along its axis (a row's is X, a column's Y); a grid, a cell, a
//!   sizing and a spot stack theirs. Each has its `gap` between children and its `pad` on every
//!   side (core's space tokens).
//! - Anything else is 80 by 20.
//! - A plane given no width is 640 wide, the test page's width.

use std::rc::Rc;

use mkp_eval::value::Record;
use mkp_runtime::{Binding, Drawn, Measure, Num, Page, Size, Value, ValueFn};

pub const CHAR: f64 = 8.0;
pub const LINE: f64 = 20.0;
pub const OTHER: f64 = 80.0;
pub const PAGE_WIDTH: i64 = 640;

fn text_of(v: Option<&Value>) -> Option<String> {
    match v? {
        Value::Text(t) => Some(t.to_string()),
        Value::Opt(x) => Some(x.as_deref().map(|x| text_of(Some(x)).unwrap_or_default()).unwrap_or_default()),
        Value::List(l) => Some(l.items.iter().map(|i| text_of(Some(&i.value)).unwrap_or_default()).collect()),
        Value::Record(r) => Some(r.fields.iter().map(|(_, x)| text_of(Some(x)).unwrap_or_default()).collect()),
        Value::Case(c) => Some(c.values.iter().map(|(_, x)| text_of(Some(x)).unwrap_or_default()).collect()),
        _ => None,
    }
}

fn to_f64(n: &Num) -> f64 {
    n.show().parse().unwrap_or(0.0)
}

/// A token case's number, or 0. An `opt` gives its value's.
fn token_of(page: &Page, v: Option<&Value>) -> f64 {
    match v {
        Some(Value::Opt(x)) => x.as_deref().map_or(0.0, |x| token_of(page, Some(x))),
        Some(Value::Num(n)) => to_f64(n),
        Some(c @ Value::Case(_)) => match page.token_value(c) {
            Ok(Value::Num(n)) => to_f64(&n),
            _ => 0.0,
        },
        _ => 0.0,
    }
}

/// Widgets that hold others: their size is their children's, with their gap and pad.
const CONTAINERS: [&str; 5] = ["core/flex", "core/grid", "core/cell", "core/sizing", "core/spot"];

/// A drawn widget's size: (width, height).
pub fn size_of(page: &Page, d: &Drawn) -> (f64, f64) {
    let pad = token_of(page, d.props.get("pad"));
    let gap = token_of(page, d.props.get("gap"));
    if CONTAINERS.contains(&d.widget.as_str()) {
        let sizes: Vec<(f64, f64)> = d.children().map(|k| size_of(page, k)).collect();
        let between = gap * (sizes.len().max(1) - 1) as f64;
        // a flex lines its children up along its axis; everything else here stacks them
        let across = d.widget == "core/flex" && matches!(d.props.get("axis"), Some(Value::Case(c)) if &*c.name == "X");
        let (w, h) = if across {
            (sizes.iter().map(|s| s.0).sum::<f64>() + between, sizes.iter().map(|s| s.1).fold(0.0, f64::max))
        } else {
            (sizes.iter().map(|s| s.0).fold(0.0, f64::max), sizes.iter().map(|s| s.1).sum::<f64>() + between)
        };
        return (w + 2.0 * pad, h + 2.0 * pad);
    }
    match text_of(d.props.get("value")).or_else(|| text_of(d.props.get("label"))) {
        Some(text) => (CHAR * text.chars().count() as f64 + 2.0 * pad, LINE + 2.0 * pad),
        None => (OTHER, LINE),
    }
}

fn num(x: f64) -> Num {
    if x.fract() == 0.0 && x.abs() < 1e15 {
        Num::int(x as i64)
    } else {
        Num::parse(&x.to_string()).unwrap_or_else(Num::zero)
    }
}

/// The layout's measure.
pub struct Fixed;

impl Measure for Fixed {
    fn spot(&mut self, page: &Page, spot: &Drawn) -> Size {
        let (w, h) = size_of(page, spot);
        Size { width: num(w), height: num(h) }
    }

    fn plane_width(&mut self, _page: &Page, _plane: &Drawn) -> Num {
        Num::int(PAGE_WIDTH)
    }
}

/// The value fns this target supplies. Its reader is in UTC.
pub fn target_fns() -> Vec<(String, ValueFn)> {
    let can_draw_tex: ValueFn = Rc::new(|_, _| Ok(Some(Value::Bool(true))));
    let local: ValueFn = Rc::new(|m, args| {
        let m0 = args.first().cloned().unwrap_or_else(Value::none);
        let utc = m.call("core/moment.utc", vec![Binding::Value(m0.clone())])?.unwrap_or_else(Value::none);
        let in_utc = match &m0 {
            Value::Record(r) => {
                let fields = r
                    .fields
                    .iter()
                    .map(|(k, v)| {
                        let v = match &**k {
                            "east" => Value::Bool(true),
                            "offset_hour" | "offset_minute" => Value::Num(Num::zero()),
                            _ => v.clone(),
                        };
                        (k.clone(), v)
                    })
                    .collect();
                Value::Record(Rc::new(Record { ty: r.ty.clone(), fields }))
            }
            other => other.clone(),
        };
        m.call("core/moment_at", vec![Binding::Value(utc), Binding::Value(in_utc)])
    });
    vec![("core/can_draw_tex".into(), can_draw_tex), ("core/moment.local".into(), local)]
}
