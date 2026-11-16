//! `rich_text` drawn as one egui text layout: its segments with their marks, read as the Markdown
//! writer reads them, so what is drawn and what is written as Markdown say the same words. Links
//! and pictures are checked before use; nothing in a value is ever read as Markdown or HTML.

use std::ops::Range;

use egui::text::{LayoutJob, TextFormat};
use egui::{Align, Color32, FontFamily, FontId, Stroke};
use mkp_runtime::Value;

use crate::values::{case, field, flag, inner, list, tex, text};

/// Whether a link may be followed: http, https and mailto, or a relative one. Whitespace and
/// control characters are dropped first, as browsers do, so `java\tscript:` is caught.
pub fn safe_href(url: &str) -> Option<String> {
    let plain: String = url.chars().filter(|c| !(*c as u32 <= 0x20 || *c as u32 == 0x7f)).collect();
    if plain.is_empty() {
        return None;
    }
    match scheme(&plain) {
        None => Some(url.trim().to_string()),
        Some(s) if ["http", "https", "mailto"].contains(&s.as_str()) => Some(url.trim().to_string()),
        Some(_) => None,
    }
}

/// Whether a picture may be shown: http, https, relative, or a `data:` image.
pub fn safe_src(url: &str) -> Option<String> {
    let plain: String = url.chars().filter(|c| !(*c as u32 <= 0x20 || *c as u32 == 0x7f)).collect();
    if plain.to_ascii_lowercase().starts_with("data:image/") {
        return Some(url.trim().to_string());
    }
    match scheme(&plain) {
        None if !plain.is_empty() => Some(url.trim().to_string()),
        None => None,
        Some(s) if s == "http" || s == "https" => Some(url.trim().to_string()),
        Some(_) => None,
    }
}

fn scheme(s: &str) -> Option<String> {
    let colon = s.find(':')?;
    let head = &s[..colon];
    let mut chars = head.chars();
    let first = chars.next()?;
    if first.is_ascii_alphabetic() && chars.all(|c| c.is_ascii_alphanumeric() || "+.-".contains(c)) {
        Some(head.to_ascii_lowercase())
    } else {
        None
    }
}

/// How a run of rich text is drawn: its font, colour and the accent for links.
#[derive(Clone, Copy)]
pub struct Style {
    pub size: f32,
    pub bold: bool,
    pub mono: bool,
    pub color: Color32,
    pub accent: Color32,
    pub code_bg: Color32,
    pub line: f32,
}

/// A rich text laid out: the job, and where each link is in its text, by byte range.
pub struct Laid {
    pub job: LayoutJob,
    pub links: Vec<(Range<usize>, String)>,
}

/// The words of a rich_text, as drawn: what a reader of the page sees.
pub fn words(v: Option<&Value>) -> String {
    let mut out = String::new();
    for seg in list(field(v, "segments")) {
        out.push_str(&part_words(field(Some(seg), "part")));
    }
    out
}

fn part_words(part: Option<&Value>) -> String {
    match case(part) {
        Some("TEXT") | Some("CODE") => text(field(part, "value")),
        Some("MATH") => tex(field(part, "tex")),
        Some("NOTE") => text(field(part, "mark")),
        Some("BREAK") => "\n".into(),
        // a picture's words are its alt text, which it is named by; a view in a sentence isn't drawn here
        Some("IMAGE") => text(field(part, "alt")),
        _ => String::new(),
    }
}

/// Lays a rich_text out for egui.
pub fn layout(v: Option<&Value>, s: Style) -> Laid {
    let mut job = LayoutJob::default();
    let mut links = Vec::new();
    for seg in list(field(v, "segments")) {
        let part = field(Some(seg), "part");
        let marks = field(Some(seg), "marks");
        let on = |n: &str| flag(field(marks, n), false);
        let link = inner(field(marks, "link")).map(|l| text(Some(l)));
        let words = part_words(part);
        if words.is_empty() {
            continue;
        }
        let kind = case(part).unwrap_or("TEXT");
        let mono = s.mono || matches!(kind, "CODE" | "MATH");
        let size = if kind == "NOTE" { s.size * 0.75 } else if mono && !s.mono { s.size * 0.9 } else { s.size };
        let family = if mono { FontFamily::Monospace } else { FontFamily::Proportional };
        let mut f = TextFormat { font_id: FontId::new(size, family), color: s.color, ..Default::default() };
        f.line_height = Some(s.size * s.line);
        if on("bold") || s.bold {
            // egui's default fonts have no bold face: the text is drawn darker and wider by a hair
            f.extra_letter_spacing = 0.4;
            f.color = strong(s.color);
        }
        if on("italic") {
            f.italics = true;
        }
        if on("strike") {
            f.strikethrough = Stroke::new(1.0, f.color);
        }
        if kind == "CODE" {
            f.background = s.code_bg;
        }
        if kind == "NOTE" {
            f.valign = Align::TOP;
            f.color = s.accent;
        }
        if kind == "IMAGE" {
            f.italics = true;
        }
        let start = job.text.len();
        if let Some(href) = &link {
            let safe = safe_href(href);
            if safe.is_some() {
                f.color = s.accent;
                f.underline = Stroke::new(1.0, s.accent);
            }
            job.append(&words, 0.0, f);
            if let Some(url) = safe {
                links.push((start..job.text.len(), url));
            }
        } else {
            job.append(&words, 0.0, f);
        }
    }
    Laid { job, links }
}

/// A colour a little stronger: what bold looks like without a bold face.
fn strong(c: Color32) -> Color32 {
    let [r, g, b, a] = c.to_array();
    let lum = (r as u32 + g as u32 + b as u32) / 3;
    let push = |x: u8| if lum > 128 { x.saturating_add(24) } else { x.saturating_sub(24) };
    Color32::from_rgba_premultiplied(push(r), push(g), push(b), a)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn links_are_checked() {
        assert_eq!(safe_href("https://example.org").as_deref(), Some("https://example.org"));
        assert_eq!(safe_href("java\tscript:alert(1)"), None);
        assert_eq!(safe_href("/docs").as_deref(), Some("/docs"));
        assert_eq!(safe_src("javascript:alert(1)"), None);
        assert!(safe_src("data:image/png;base64,AAAA").is_some());
    }
}
