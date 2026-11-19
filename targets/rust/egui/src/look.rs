//! The page's tokens as egui values: colours for the page's theme, lengths in points, and fonts.
//! Values come from the build's tokens block, as the evaluator gives them (`core/color.INK` is a
//! `color_value` with a light and a dark colour), and are kept once read: a build's tokens don't
//! change while the page runs.

use std::cell::RefCell;
use std::collections::HashMap;

use egui::{Color32, FontFamily, FontId};
use xtmd_runtime::{Page, Value};

use crate::values::{field, inner, num, text};

/// How the page's tokens look: its theme and what each token stands for.
#[derive(Default)]
pub struct Look {
    dark: bool,
    known: RefCell<HashMap<String, Option<Value>>>,
}

/// A font token, worked out: its size in points, whether it is bold and whether it is mono.
#[derive(Clone, Copy, Debug)]
pub struct Font {
    pub size: f32,
    pub bold: bool,
    pub mono: bool,
    /// Line height, as a multiple of the size.
    pub line: f32,
}

impl Font {
    pub fn id(&self) -> FontId {
        FontId::new(self.size, if self.mono { FontFamily::Monospace } else { FontFamily::Proportional })
    }
}

/// A colour written `#rrggbb` or `#rrggbbaa`.
pub fn parse_color(s: &str) -> Option<Color32> {
    let h = s.trim().strip_prefix('#')?;
    let byte = |k: usize| u8::from_str_radix(h.get(k..k + 2)?, 16).ok();
    match h.len() {
        6 => Some(Color32::from_rgb(byte(0)?, byte(2)?, byte(4)?)),
        8 => Some(Color32::from_rgba_unmultiplied(byte(0)?, byte(2)?, byte(4)?, byte(6)?)),
        3 => {
            let d = |k: usize| u8::from_str_radix(h.get(k..k + 1)?, 16).ok().map(|x| x * 17);
            Some(Color32::from_rgb(d(0)?, d(1)?, d(2)?))
        }
        _ => None,
    }
}

impl Look {
    pub fn new(dark: bool) -> Look {
        Look { dark, known: RefCell::new(HashMap::new()) }
    }

    pub fn dark(&self) -> bool {
        self.dark
    }

    pub fn set_dark(&mut self, dark: bool) {
        self.dark = dark;
    }

    /// A token case's value, as the build gives it; anything else is itself.
    pub fn value(&self, page: &Page, v: Option<&Value>) -> Option<Value> {
        let v = inner(v)?;
        let Value::Case(c) = v else { return Some(v.clone()) };
        let key = format!("{}.{}{}", c.ty, c.name, if c.values.is_empty() { String::new() } else { format!("{:?}", c.values.iter().map(|(_, x)| text(Some(x))).collect::<Vec<_>>()) });
        if let Some(known) = self.known.borrow().get(&key) {
            return known.clone();
        }
        let out = page.token_value(v).ok();
        self.known.borrow_mut().insert(key, out.clone());
        out
    }

    /// A colour token for the page's theme, or a colour written as text.
    pub fn color(&self, page: &Page, v: Option<&Value>) -> Option<Color32> {
        let t = self.value(page, v)?;
        match &t {
            Value::Record(r) if &*r.ty == "core/color_value" => parse_color(&text(r.get(if self.dark { "dark" } else { "light" }))),
            Value::Text(s) => parse_color(s),
            _ => None,
        }
    }

    /// A length token (space, size, radius, stroke) in points, or a number as it is.
    pub fn number(&self, page: &Page, v: Option<&Value>) -> Option<f32> {
        num(self.value(page, v).as_ref()).map(|n| n as f32)
    }

    /// One of core's colours by name: `INK`, `MUTED`, `ACCENT`.
    pub fn core_color(&self, page: &Page, name: &str) -> Color32 {
        let v = Value::Case(std::rc::Rc::new(xtmd_eval::value::Case { ty: "core/color".into(), name: name.into(), values: Vec::new() }));
        self.color(page, Some(&v)).unwrap_or(match (name, self.dark) {
            ("SURFACE", false) => Color32::WHITE,
            ("SURFACE", true) => Color32::from_rgb(0x15, 0x17, 0x1a),
            ("INK", false) => Color32::from_rgb(0x1a, 0x1c, 0x1f),
            ("INK", true) => Color32::from_rgb(0xec, 0xee, 0xf1),
            ("LINE", _) => Color32::GRAY,
            ("ACCENT", _) => Color32::from_rgb(0x25, 0x63, 0xeb),
            _ => Color32::GRAY,
        })
    }

    /// One of core's spaces by name, in points: `XS` … `XL`.
    pub fn space(&self, page: &Page, name: &str) -> f32 {
        let v = Value::Case(std::rc::Rc::new(xtmd_eval::value::Case { ty: "core/space".into(), name: name.into(), values: Vec::new() }));
        self.number(page, Some(&v)).unwrap_or(8.0)
    }

    /// A font token by name: `BODY`, `HEADING`, `MONO`.
    pub fn font(&self, page: &Page, name: &str) -> Font {
        let v = Value::Case(std::rc::Rc::new(xtmd_eval::value::Case { ty: "core/font".into(), name: name.into(), values: Vec::new() }));
        let t = self.value(page, Some(&v));
        let size = num(field(t.as_ref(), "size")).unwrap_or(if name == "MONO" { 14.0 } else { 16.0 }) as f32;
        let weight = num(field(t.as_ref(), "weight")).unwrap_or(400.0);
        let line = num(field(t.as_ref(), "line")).unwrap_or(1.5) as f32;
        let family = text(field(t.as_ref(), "family"));
        Font { size, bold: weight >= 600.0, mono: name == "MONO" || family.contains("mono"), line }
    }

    /// The body font at a text size: `SMALL`, `NORMAL` or `LARGE`.
    pub fn sized(&self, page: &Page, font: Option<&str>, size: Option<&str>) -> Font {
        let mut f = self.font(page, font.unwrap_or("BODY"));
        f.size *= match size {
            Some("SMALL") => 0.875,
            Some("LARGE") => 1.25,
            _ => 1.0,
        };
        f
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn colours_from_hex() {
        assert_eq!(parse_color("#2563eb"), Some(Color32::from_rgb(0x25, 0x63, 0xeb)));
        assert_eq!(parse_color("#0000001f").map(|c| c.a()), Some(0x1f));
        assert_eq!(parse_color("2563eb"), None);
    }
}
