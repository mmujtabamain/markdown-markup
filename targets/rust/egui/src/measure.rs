//! How spots are measured for the plane's layout.
//!
//! - [`Fixed`]: the checks' fixed sizes, the test target's (targets/ts/test/sizes.mjs), so every
//!   target's boxes agree exactly. Text is 8 wide per character and 20 high; a flex lines its
//!   children up along its axis, and a grid, a cell, a sizing and a spot stack theirs, each with
//!   its `gap` and `pad`; anything else is 80 by 20; a plane given no width is 640 wide.
//! - [`Measured`]: what egui drew. Each spot's box is its child's rect from the last frame, in
//!   the plane's units (the plane's `Scene` lays its content out unscaled, so a rect there is in
//!   the plane's units already), rounded to whole points so a layout settles.

use std::collections::HashMap;

use xtmd_runtime::{Drawn, Measure, Num, Page, Size, Value};

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

/// A token case's number, or 0. An `opt` gives its value's.
fn token_of(page: &Page, v: Option<&Value>) -> f64 {
    match v {
        Some(Value::Opt(x)) => x.as_deref().map_or(0.0, |x| token_of(page, Some(x))),
        Some(Value::Num(n)) => crate::values::to_f64(n),
        Some(c @ Value::Case(_)) => match page.token_value(c) {
            Ok(Value::Num(n)) => crate::values::to_f64(&n),
            _ => 0.0,
        },
        _ => 0.0,
    }
}

/// Widgets that hold others: their size is their children's, with their gap and pad.
const CONTAINERS: [&str; 5] = ["core/flex", "core/grid", "core/cell", "core/sizing", "core/spot"];

/// A drawn widget's size in the fixed sizes: (width, height).
pub fn fixed_size(page: &Page, d: &Drawn) -> (f64, f64) {
    let pad = token_of(page, d.props.get("pad"));
    let gap = token_of(page, d.props.get("gap"));
    if CONTAINERS.contains(&d.widget.as_str()) {
        let sizes: Vec<(f64, f64)> = d.children().map(|k| fixed_size(page, k)).collect();
        let between = gap * (sizes.len().max(1) - 1) as f64;
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

/// A whole number of points, as an exact number.
pub fn whole(x: f64) -> Num {
    if x.is_finite() && x.fract() == 0.0 && x.abs() < 1e15 {
        Num::int(x as i64)
    } else {
        Num::parse(&format!("{}", x)).unwrap_or_else(Num::zero)
    }
}

/// The checks' fixed sizes.
#[derive(Clone, Copy, Debug, Default)]
pub struct Fixed;

impl Measure for Fixed {
    fn spot(&mut self, page: &Page, spot: &Drawn) -> Size {
        let (w, h) = fixed_size(page, spot);
        Size { width: whole(w), height: whole(h) }
    }

    fn plane_width(&mut self, _page: &Page, _plane: &Drawn) -> Num {
        Num::int(PAGE_WIDTH)
    }
}

/// What egui drew in the last frame: each spot's size and each plane's width, by path.
#[derive(Clone, Debug, Default)]
pub struct Measured {
    pub spots: HashMap<String, egui::Vec2>,
    pub planes: HashMap<String, f32>,
}

impl Measure for Measured {
    fn spot(&mut self, _page: &Page, spot: &Drawn) -> Size {
        let s = self.spots.get(&spot.path).copied().unwrap_or(egui::Vec2::ZERO);
        Size { width: whole(s.x.max(0.0).round() as f64), height: whole(s.y.max(0.0).round() as f64) }
    }

    fn plane_width(&mut self, _page: &Page, plane: &Drawn) -> Num {
        whole(self.planes.get(&plane.path).copied().unwrap_or(PAGE_WIDTH as f32).max(0.0).round() as f64)
    }
}
