//! Markdown out (page 1, plan tab 13): a page written as Markdown at any moment, with the
//! values it has, its starting ones when nothing has run. Each block and mark is written in one
//! spelling, and a character in a value that Markdown would read is written with a backslash.

mod render;

pub use render::{page, Failure};

/// A page's Markdown text, its front matter at the top as the document wrote it.
pub fn write_page(front_matter: Option<&str>, blocks: &[Block]) -> String {
    let body = write(blocks);
    match front_matter {
        Some(fm) => format!("---\n{}\n---\n\n{}", fm, body),
        None => body,
    }
}

use serde_json::{json, Value as Json};

/// A run of a sentence.
#[derive(Clone, Debug, PartialEq)]
pub enum Inline {
    Text { value: String, bold: bool, italic: bool, strike: bool, link: Option<String> },
    Code(String),
    Math(String),
    Image { src: String, alt: String },
    Note(String),
    Break,
}

#[derive(Clone, Copy, Debug, PartialEq)]
pub enum Align {
    Start,
    Center,
    End,
}

#[derive(Clone, Debug, PartialEq)]
pub struct Item {
    pub done: Option<bool>,
    pub blocks: Vec<Block>,
}

/// A Markdown block, as the page writes it and the checks read it.
#[derive(Clone, Debug, PartialEq)]
pub enum Block {
    Paragraph(Vec<Inline>),
    Heading { level: u8, inline: Vec<Inline> },
    Bullets { ordered: bool, start: i64, items: Vec<Item> },
    Quote(Vec<Block>),
    Code { lang: String, src: String },
    Math(String),
    Table { head: Vec<Vec<Inline>>, rows: Vec<Vec<Vec<Inline>>>, align: Vec<Align> },
    Footnote { mark: String, blocks: Vec<Block> },
    Divider,
}

/// Runs that follow one another with the same marks are one run.
pub fn join_runs(runs: Vec<Inline>) -> Vec<Inline> {
    let mut out: Vec<Inline> = Vec::new();
    for r in runs {
        if let (Some(Inline::Text { value, bold, italic, strike, link }), Inline::Text { value: v2, bold: b2, italic: i2, strike: s2, link: l2 }) = (out.last_mut(), &r) {
            if bold == b2 && italic == i2 && strike == s2 && link == l2 {
                value.push_str(v2);
                continue;
            }
        }
        if matches!(&r, Inline::Text { value, .. } if value.is_empty()) {
            continue;
        }
        out.push(r);
    }
    out
}

// ---- as the check schema writes them

pub fn inline_json(i: &Inline) -> Json {
    match i {
        Inline::Text { value, bold, italic, strike, link } => {
            let mut t = json!({ "value": value });
            if *bold {
                t["bold"] = json!(true);
            }
            if *italic {
                t["italic"] = json!(true);
            }
            if *strike {
                t["strike"] = json!(true);
            }
            if let Some(l) = link {
                t["link"] = json!(l);
            }
            json!({ "text": t })
        }
        Inline::Code(c) => json!({ "code": c }),
        Inline::Math(m) => json!({ "math": m }),
        Inline::Image { src, alt } => json!({ "image": { "src": src, "alt": alt } }),
        Inline::Note(n) => json!({ "note": n }),
        Inline::Break => json!({ "break": {} }),
    }
}

pub fn blocks_json(blocks: &[Block]) -> Json {
    Json::Array(blocks.iter().map(block_json).collect())
}

pub fn block_json(b: &Block) -> Json {
    let runs = |r: &[Inline]| Json::Array(r.iter().map(inline_json).collect());
    match b {
        Block::Paragraph(r) => json!({ "paragraph": runs(r) }),
        Block::Heading { level, inline } => json!({ "heading": { "level": level, "inline": runs(inline) } }),
        Block::Bullets { ordered, start, items } => {
            let items: Vec<Json> = items
                .iter()
                .map(|i| match i.done {
                    Some(d) => json!({ "done": d, "blocks": blocks_json(&i.blocks) }),
                    None => json!({ "blocks": blocks_json(&i.blocks) }),
                })
                .collect();
            let mut x = json!({ "ordered": ordered, "items": items });
            if *ordered {
                x["start"] = json!(start);
            }
            json!({ "bullets": x })
        }
        Block::Quote(b) => json!({ "quote": blocks_json(b) }),
        Block::Code { lang, src } => json!({ "code": { "lang": lang, "src": src } }),
        Block::Math(t) => json!({ "math": t }),
        Block::Table { head, rows, align } => json!({ "table": {
            "head": head.iter().map(|c| runs(c)).collect::<Vec<_>>(),
            "rows": rows.iter().map(|r| r.iter().map(|c| runs(c)).collect::<Vec<_>>()).collect::<Vec<_>>(),
            "align": align.iter().map(|a| match a { Align::Start => "START", Align::Center => "CENTER", Align::End => "END" }).collect::<Vec<_>>(),
        } }),
        Block::Footnote { mark, blocks } => json!({ "footnote": { "mark": mark, "blocks": blocks_json(blocks) } }),
        Block::Divider => json!({ "divider": {} }),
    }
}

// ---- the one spelling (page 1, Markdown out)

/// Text with every character Markdown or MKP's prose would read written with a backslash.
fn escape(s: &str, line_start: bool) -> String {
    let mut out = String::new();
    let chars: Vec<char> = s.chars().collect();
    let mut at_start = line_start;
    for (k, &c) in chars.iter().enumerate() {
        let rest: String = chars[..k].iter().collect();
        let escape_here = match c {
            '\\' | '`' | '*' | '_' | '~' | '[' | ']' | '<' | '>' | '$' | '|' | '&' => true,
            '#' | '-' | '+' | '=' | '@' | '}' | '!' if at_start => true,
            // a bare link: http://, https://, ftp:// and www.
            ':' => rest.ends_with("http") || rest.ends_with("https") || rest.ends_with("ftp"),
            '.' => rest.to_lowercase().ends_with("www"),
            _ => false,
        };
        // a number then . or ) at a line's start would start a list
        let ordered = (c == '.' || c == ')') && line_start && !rest.is_empty() && rest.chars().all(|d| d.is_ascii_digit());
        if escape_here || ordered {
            out.push('\\');
        }
        out.push(c);
        if c == '\n' {
            at_start = true;
        } else if !(c == ' ' && at_start) {
            at_start = false;
        }
    }
    out
}

fn code_span(c: &str) -> String {
    let mut ticks = 1;
    while c.contains(&"`".repeat(ticks)) {
        ticks += 1;
    }
    let fence = "`".repeat(ticks);
    let pad = if c.starts_with('`') || c.ends_with('`') || c.starts_with(' ') && c.ends_with(' ') && !c.trim().is_empty() { " " } else { "" };
    format!("{}{}{}{}{}", fence, pad, c, pad, fence)
}

/// A sentence's runs, each with its marks.
pub fn write_inline(runs: &[Inline]) -> String {
    let mut out = String::new();
    for r in runs {
        let first = out.is_empty();
        match r {
            Inline::Text { value, bold, italic, strike, link } => {
                let mut t = escape(value, first);
                if *italic {
                    t = format!("*{}*", t);
                }
                if *bold {
                    t = format!("**{}**", t);
                }
                if *strike {
                    t = format!("~~{}~~", t);
                }
                if let Some(l) = link {
                    t = format!("[{}](<{}>)", t, l.replace('<', "%3C").replace('>', "%3E"));
                }
                out.push_str(&t);
            }
            Inline::Code(c) => out.push_str(&code_span(c)),
            Inline::Math(m) => out.push_str(&format!("${}$", m)),
            Inline::Image { src, alt } => out.push_str(&format!("![{}](<{}>)", escape(alt, false), src)),
            Inline::Note(n) => out.push_str(&format!("[^{}]", n)),
            Inline::Break => out.push_str("\\\n"),
        }
    }
    out
}

fn indent(text: &str, first: &str, rest: &str) -> String {
    let mut out = String::new();
    for (k, line) in text.lines().enumerate() {
        let prefix = if k == 0 { first } else { rest };
        if line.is_empty() {
            out.push_str(prefix.trim_end());
        } else {
            out.push_str(prefix);
            out.push_str(line);
        }
        out.push('\n');
    }
    out
}

fn write_block(b: &Block) -> String {
    match b {
        Block::Paragraph(r) => format!("{}\n", write_inline(r)),
        Block::Heading { level, inline } => format!("{} {}\n", "#".repeat(*level as usize), write_inline(inline)),
        Block::Bullets { ordered, start, items } => {
            let mut out = String::new();
            let loose = items.iter().any(|i| i.blocks.len() > 1);
            for (k, it) in items.iter().enumerate() {
                let marker = if *ordered { format!("{}. ", start + k as i64) } else { "- ".to_string() };
                let task = match it.done {
                    Some(true) => "[x] ",
                    Some(false) => "[ ] ",
                    None => "",
                };
                let body = write_blocks_inner(&it.blocks);
                let body = if body.is_empty() { "\n".to_string() } else { body };
                let pad = " ".repeat(marker.len());
                out.push_str(&indent(&body, &format!("{}{}", marker, task), &pad));
                if loose && k + 1 < items.len() {
                    out.push('\n');
                }
            }
            out
        }
        Block::Quote(b) => indent(&write_blocks_inner(b), "> ", "> "),
        Block::Code { lang, src } => {
            let mut ticks = 3;
            while src.contains(&"`".repeat(ticks)) {
                ticks += 1;
            }
            let fence = "`".repeat(ticks);
            let src = if src.ends_with('\n') || src.is_empty() { src.clone() } else { format!("{}\n", src) };
            format!("{}{}\n{}{}\n", fence, lang, src, fence)
        }
        Block::Math(t) => format!("$$\n{}\n$$\n", t.trim_end()),
        Block::Divider => "---\n".to_string(),
        Block::Table { head, rows, align } => {
            let cell = |c: &[Inline]| write_inline(c).replace('|', "\\|");
            let mut out = format!("| {} |\n", head.iter().map(|c| cell(c)).collect::<Vec<_>>().join(" | "));
            let rule: Vec<&str> = (0..head.len())
                .map(|k| match align.get(k) {
                    Some(Align::Center) => ":---:",
                    Some(Align::End) => "---:",
                    _ => "---",
                })
                .collect();
            out.push_str(&format!("| {} |\n", rule.join(" | ")));
            for r in rows {
                out.push_str(&format!("| {} |\n", r.iter().map(|c| cell(c)).collect::<Vec<_>>().join(" | ")));
            }
            out
        }
        Block::Footnote { mark, blocks } => indent(&write_blocks_inner(blocks), &format!("[^{}]: ", mark), "    "),
    }
}

fn write_blocks_inner(blocks: &[Block]) -> String {
    blocks.iter().map(write_block).collect::<Vec<_>>().join("\n")
}

/// The page as Markdown text: its blocks, then its footnotes at the end.
pub fn write(blocks: &[Block]) -> String {
    let (notes, rest): (Vec<&Block>, Vec<&Block>) = blocks.iter().partition(|b| matches!(b, Block::Footnote { .. }));
    // lists that follow one another are already one list (page 3), so blocks never run together
    let parts: Vec<String> = rest.into_iter().chain(notes).map(write_block).collect();
    parts.join("\n")
}
