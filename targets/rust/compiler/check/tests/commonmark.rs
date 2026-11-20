//! CommonMark's and GitHub's spec examples, compiled as Extended Mark documents and compared as blocks.
//!
//! Each example's Markdown is a document of its own: the compiler splits its blocks, and core's
//! `rich_text.read`, written in Extended Mark, reads each block's inline Markdown. The page that results
//! is compared with the spec's own HTML, both read into the same blocks: what a block is, and
//! each run of text with its marks. Examples where Extended Mark reads Markdown its own way (raw HTML is
//! text; `\{`, `$…$`, `@name` and `}` lines are Extended Mark's) are compared with the reading written
//! in targets/checks/commonmark/xtmd-readings.json, each with its reason.
//!
//! Each example is also read by core's `md.from`, run in the evaluator, which reads Markdown as
//! data (no holes, calls or front matter): the same expectations, except readings marked
//! `"only": "prose"`, and its own reading under an `md.from:` key where it has one.

use xtmd_check::{compile_core, compile_on, Source};
use xtmd_ir::ir;
use serde_json::{json, Value};
use std::path::PathBuf;

fn repo() -> PathBuf {
    PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("../../../..")
}

fn core_sources() -> Vec<Source> {
    let mut files: Vec<PathBuf> = std::fs::read_dir(repo().join("core")).unwrap().map(|e| e.unwrap().path()).filter(|p| p.extension().map_or(false, |x| x == "xtmdpack")).collect();
    files.sort();
    files.into_iter().map(|p| Source { path: format!("core/{}", p.file_name().unwrap().to_str().unwrap()), text: std::fs::read_to_string(&p).unwrap() }).collect()
}

// ---- the page the compiler wrote, as blocks

fn text_of(e: &ir::Expr) -> String {
    match e {
        ir::Expr::Text(t) => t.clone(),
        ir::Expr::Num(n) => n.clone(),
        _ => String::new(),
    }
}

fn inlines_of_rich(e: &ir::Expr) -> Vec<Value> {
    let ir::Expr::Rich(r) = e else { return vec![json!({"text": {"value": "<not rich>"}})] };
    let mut out = Vec::new();
    for s in &r.segments {
        let s = &s.segment;
        let v = s.value.as_ref().map(text_of).unwrap_or_default();
        let m = s.marks.clone().unwrap_or(ir::Marks { bold: false, italic: false, strike: false, link: None });
        out.push(match s.part {
            ir::SegmentSegmentPart::Text => {
                let mut t = json!({"value": v});
                if m.bold {
                    t["bold"] = json!(true);
                }
                if m.italic {
                    t["italic"] = json!(true);
                }
                if m.strike {
                    t["strike"] = json!(true);
                }
                if let Some(l) = &m.link {
                    t["link"] = json!(encode_url(&text_of(l)));
                }
                json!({"text": t})
            }
            ir::SegmentSegmentPart::Code => json!({"code": v}),
            ir::SegmentSegmentPart::Math => json!({"math": "tex"}),
            ir::SegmentSegmentPart::Image => json!({"image": {"src": encode_url(&s.src.as_ref().map(text_of).unwrap_or_default()), "alt": s.alt.as_ref().map(text_of).unwrap_or_default()}}),
            ir::SegmentSegmentPart::Note => json!({"note": v}),
            ir::SegmentSegmentPart::Break => json!({"break": {}}),
            ir::SegmentSegmentPart::View => json!({"view": {}}),
        });
    }
    normalize_inlines(out)
}

fn blocks_of_nodes(nodes: &[ir::Node]) -> Vec<Value> {
    let mut out = Vec::new();
    for n in nodes {
        let ir::Node::Extern(e) = n else { continue };
        let prop = |k: &str| e.props.get(k);
        let slot = |k: &str| e.slots.get(k).map(|s| blocks_of_nodes(s)).unwrap_or_default();
        out.push(match e.name.as_str() {
            "core/paragraph" => json!({"paragraph": prop("value").map(inlines_of_rich).unwrap_or_default()}),
            "core/heading" => json!({"heading": {"level": prop("level").map(text_of).unwrap_or_default().parse::<i64>().unwrap_or(0), "inline": prop("value").map(inlines_of_rich).unwrap_or_default()}}),
            "core/bullets" => {
                let ordered = matches!(prop("ordered"), Some(ir::Expr::Bool(true)));
                let items: Vec<Value> = e.slots.get("items").map(|s| s.iter().filter_map(|i| {
                    let ir::Node::Extern(it) = i else { return None };
                    let done = match it.props.get("done") {
                        Some(ir::Expr::Some(b)) => Some(matches!(**b, ir::Expr::Bool(true))),
                        _ => None,
                    };
                    let blocks = it.slots.get("body").map(|b| blocks_of_nodes(b)).unwrap_or_default();
                    Some(match done {
                        Some(d) => json!({"done": d, "blocks": blocks}),
                        None => json!({"blocks": blocks}),
                    })
                }).collect()).unwrap_or_default();
                let mut b = json!({"ordered": ordered, "items": items});
                if ordered {
                    b["start"] = json!(prop("start").map(text_of).unwrap_or_default().parse::<i64>().unwrap_or(1));
                }
                json!({"bullets": b})
            }
            "core/quote" => json!({"quote": slot("body")}),
            "core/code" => json!({"code": {"lang": prop("lang").map(text_of).unwrap_or_default(), "src": prop("src").map(text_of).unwrap_or_default()}}),
            "core/math" => json!({"math": "tex"}),
            "core/divider" => json!({"divider": {}}),
            "core/footnote" => json!({"footnote": {"mark": prop("mark").map(text_of).unwrap_or_default(), "blocks": slot("body")}}),
            "core/table" => {
                let cells = |x: Option<&ir::Expr>| -> Vec<Value> {
                    match x {
                        Some(ir::Expr::List(l)) => l.iter().map(|c| json!(inlines_of_rich(c))).collect(),
                        _ => Vec::new(),
                    }
                };
                let rows: Vec<Value> = match prop("rows") {
                    Some(ir::Expr::List(rs)) => rs.iter().map(|r| json!(cells(Some(r)))).collect(),
                    _ => Vec::new(),
                };
                let align: Vec<Value> = match prop("align") {
                    Some(ir::Expr::List(l)) => l.iter().map(|a| if let ir::Expr::Case(c) = a { json!(c.name) } else { json!("START") }).collect(),
                    _ => Vec::new(),
                };
                json!({"table": {"align": align, "head": cells(prop("head")), "rows": rows}})
            }
            other => json!({"other": other}),
        });
    }
    out
}

/// A destination as CommonMark's HTML writer percent-encodes it, which is the writer's business,
/// not Markdown's: the link mark holds the destination as written.
fn encode_url(s: &str) -> String {
    let keep = ";/?:@&=+$,-_.!~*'()#";
    let mut out = String::new();
    let b: Vec<char> = s.chars().collect();
    let mut i = 0;
    while i < b.len() {
        let c = b[i];
        if c == '%' && i + 2 < b.len() && b[i + 1].is_ascii_hexdigit() && b[i + 2].is_ascii_hexdigit() {
            out.push_str(&b[i..i + 3].iter().collect::<String>());
            i += 3;
            continue;
        }
        if c.is_ascii_alphanumeric() || keep.contains(c) {
            out.push(c);
        } else {
            let mut buf = [0u8; 4];
            for byte in c.encode_utf8(&mut buf).bytes() {
                out.push_str(&format!("%{:02X}", byte));
            }
        }
        i += 1;
    }
    out
}

// ---- the spec's HTML, as blocks

#[derive(Debug, Clone)]
enum H {
    Tag { name: String, attrs: Vec<(String, String)>, kids: Vec<H> },
    Text(String),
}

fn decode(s: &str) -> String {
    let mut out = String::new();
    let mut rest = s;
    while let Some(k) = rest.find('&') {
        out.push_str(&rest[..k]);
        let tail = &rest[k..];
        let end = tail.find(';').unwrap_or(0);
        let ent = if end > 0 { &tail[1..end] } else { "" };
        let rep = match ent {
            "amp" => Some("&".to_string()),
            "lt" => Some("<".to_string()),
            "gt" => Some(">".to_string()),
            "quot" => Some("\"".to_string()),
            _ if ent.starts_with("#x") || ent.starts_with("#X") => u32::from_str_radix(&ent[2..], 16).ok().and_then(char::from_u32).map(|c| c.to_string()),
            _ if ent.starts_with('#') => ent[1..].parse::<u32>().ok().and_then(char::from_u32).map(|c| c.to_string()),
            _ => None,
        };
        match rep {
            Some(r) => {
                out.push_str(&r);
                rest = &tail[end + 1..];
            }
            None => {
                out.push('&');
                rest = &tail[1..];
            }
        }
    }
    out.push_str(rest);
    out
}

const VOID: &[&str] = &["br", "hr", "img", "input"];

fn parse_html(s: &str) -> Vec<H> {
    let mut stack: Vec<(String, Vec<(String, String)>, Vec<H>)> = vec![("root".into(), Vec::new(), Vec::new())];
    let mut i = 0;
    let b = s.as_bytes();
    while i < s.len() {
        if b[i] == b'<' {
            let end = match s[i..].find('>') {
                Some(e) => i + e,
                None => break,
            };
            let inner = &s[i + 1..end];
            if let Some(name) = inner.strip_prefix('/') {
                let name = name.trim().to_lowercase();
                if let Some(pos) = stack.iter().rposition(|(n, _, _)| *n == name) {
                    while stack.len() > pos {
                        let (n, a, k) = stack.pop().unwrap();
                        stack.last_mut().unwrap().2.push(H::Tag { name: n, attrs: a, kids: k });
                    }
                }
            } else {
                let self_closing = inner.ends_with('/');
                let inner = inner.trim_end_matches('/');
                let mut parts = inner.splitn(2, char::is_whitespace);
                let name = parts.next().unwrap_or("").to_lowercase();
                let rest = parts.next().unwrap_or("");
                let mut attrs = Vec::new();
                let mut r = rest.trim();
                while !r.is_empty() {
                    let eq = r.find('=');
                    let sp = r.find(char::is_whitespace);
                    match (eq, sp) {
                        (Some(e), sp) if sp.map_or(true, |s| e < s) => {
                            let key = r[..e].trim().to_string();
                            let after = &r[e + 1..];
                            if let Some(q) = after.chars().next().filter(|c| *c == '"' || *c == '\'') {
                                let close = after[1..].find(q).map(|c| c + 1).unwrap_or(after.len() - 1);
                                attrs.push((key, decode(&after[1..close])));
                                r = after[close + 1..].trim_start();
                            } else {
                                let close = after.find(char::is_whitespace).unwrap_or(after.len());
                                attrs.push((key, decode(&after[..close])));
                                r = after[close..].trim_start();
                            }
                        }
                        (_, Some(s)) => {
                            attrs.push((r[..s].to_string(), String::new()));
                            r = r[s..].trim_start();
                        }
                        _ => {
                            attrs.push((r.to_string(), String::new()));
                            r = "";
                        }
                    }
                }
                if self_closing || VOID.contains(&name.as_str()) {
                    stack.last_mut().unwrap().2.push(H::Tag { name, attrs, kids: Vec::new() });
                } else {
                    stack.push((name, attrs, Vec::new()));
                }
            }
            i = end + 1;
        } else {
            let end = s[i..].find('<').map(|e| i + e).unwrap_or(s.len());
            stack.last_mut().unwrap().2.push(H::Text(decode(&s[i..end])));
            i = end;
        }
    }
    while stack.len() > 1 {
        let (n, a, k) = stack.pop().unwrap();
        stack.last_mut().unwrap().2.push(H::Tag { name: n, attrs: a, kids: k });
    }
    stack.pop().unwrap().2
}

fn attr(attrs: &[(String, String)], k: &str) -> Option<String> {
    attrs.iter().find(|(a, _)| a == k).map(|(_, v)| v.clone())
}

#[derive(Clone, Default)]
struct Marks {
    bold: bool,
    italic: bool,
    strike: bool,
    link: Option<String>,
}

fn inlines_of_html(nodes: &[H], m: &Marks, out: &mut Vec<Value>) {
    for n in nodes {
        match n {
            H::Text(t) => {
                let mut v = json!({"value": t});
                if m.bold {
                    v["bold"] = json!(true);
                }
                if m.italic {
                    v["italic"] = json!(true);
                }
                if m.strike {
                    v["strike"] = json!(true);
                }
                if let Some(l) = &m.link {
                    v["link"] = json!(l);
                }
                out.push(json!({"text": v}));
            }
            H::Tag { name, attrs, kids } => {
                let mut m2 = m.clone();
                match name.as_str() {
                    "em" => m2.italic = true,
                    "strong" => m2.bold = true,
                    "del" | "s" => m2.strike = true,
                    "a" => m2.link = Some(attr(attrs, "href").unwrap_or_default()),
                    "code" => {
                        out.push(json!({"code": plain(kids)}));
                        continue;
                    }
                    "img" => {
                        out.push(json!({"image": {"src": attr(attrs, "src").unwrap_or_default(), "alt": attr(attrs, "alt").unwrap_or_default()}}));
                        continue;
                    }
                    "br" => {
                        out.push(json!({"break": {}}));
                        continue;
                    }
                    "input" => continue,
                    _ => {}
                }
                inlines_of_html(kids, &m2, out);
            }
        }
    }
}

fn plain(nodes: &[H]) -> String {
    nodes
        .iter()
        .map(|n| match n {
            H::Text(t) => t.clone(),
            H::Tag { kids, .. } => plain(kids),
        })
        .collect()
}

const BLOCK: &[&str] = &["p", "h1", "h2", "h3", "h4", "h5", "h6", "ul", "ol", "blockquote", "pre", "hr", "table", "li", "div"];

fn blocks_of_html(nodes: &[H]) -> Vec<Value> {
    let mut out = Vec::new();
    let mut loose: Vec<H> = Vec::new();
    let flush = |loose: &mut Vec<H>, out: &mut Vec<Value>| {
        if loose.iter().any(|n| !matches!(n, H::Text(t) if t.trim().is_empty())) {
            let mut inl = Vec::new();
            let mut nodes = loose.clone();
            // a tight list item's text: trim the line breaks around it
            if let Some(H::Text(t)) = nodes.first_mut() {
                *t = t.trim_start_matches('\n').to_string();
            }
            if let Some(H::Text(t)) = nodes.last_mut() {
                *t = t.trim_end_matches('\n').to_string();
            }
            inlines_of_html(&nodes, &Marks::default(), &mut inl);
            out.push(json!({"paragraph": normalize_inlines(inl)}));
        }
        loose.clear();
    };
    for n in nodes {
        let H::Tag { name, attrs, kids } = n else {
            loose.push(n.clone());
            continue;
        };
        if !BLOCK.contains(&name.as_str()) {
            loose.push(n.clone());
            continue;
        }
        flush(&mut loose, &mut out);
        let mut inl = Vec::new();
        out.push(match name.as_str() {
            "hr" => json!({"divider": {}}),
            "p" => {
                inlines_of_html(kids, &Marks::default(), &mut inl);
                json!({"paragraph": normalize_inlines(inl)})
            }
            h if h.len() == 2 && h.starts_with('h') => {
                inlines_of_html(kids, &Marks::default(), &mut inl);
                json!({"heading": {"level": h[1..].parse::<i64>().unwrap_or(0), "inline": normalize_inlines(inl)}})
            }
            "ul" | "ol" => {
                let items: Vec<Value> = kids
                    .iter()
                    .filter_map(|k| match k {
                        H::Tag { name, kids, .. } if name == "li" => {
                            let done = kids.iter().find_map(|x| match x {
                                H::Tag { name, attrs, .. } if name == "input" => Some(attr(attrs, "checked").is_some()),
                                _ => None,
                            });
                            let mut ks = kids.clone();
                            if done.is_some() {
                                if let Some(pos) = ks.iter().position(|x| matches!(x, H::Tag { name, .. } if name == "input")) {
                                    ks.remove(pos);
                                    if let Some(H::Text(t)) = ks.get_mut(pos) {
                                        *t = t.trim_start().to_string();
                                    }
                                }
                            }
                            let blocks = blocks_of_html(&ks);
                            Some(match done {
                                Some(d) => json!({"done": d, "blocks": blocks}),
                                None => json!({"blocks": blocks}),
                            })
                        }
                        _ => None,
                    })
                    .collect();
                let mut b = json!({"ordered": name == "ol", "items": items});
                if name == "ol" {
                    b["start"] = json!(attr(attrs, "start").and_then(|s| s.parse::<i64>().ok()).unwrap_or(1));
                }
                json!({"bullets": b})
            }
            "blockquote" => json!({"quote": blocks_of_html(kids)}),
            "pre" => {
                let (lang, src) = match kids.iter().find(|k| matches!(k, H::Tag { name, .. } if name == "code")) {
                    Some(H::Tag { attrs, kids, .. }) => (attr(attrs, "class").map(|c| c.trim_start_matches("language-").to_string()).unwrap_or_default(), plain(kids)),
                    _ => (String::new(), plain(kids)),
                };
                json!({"code": {"lang": lang, "src": src}})
            }
            "hr" => json!({"divider": {}}),
            "table" => {
                let mut head = Vec::new();
                let mut rows = Vec::new();
                let mut align = Vec::new();
                fn walk(n: &[H], head: &mut Vec<Value>, rows: &mut Vec<Value>, align: &mut Vec<Value>, in_head: bool) {
                    for k in n {
                        if let H::Tag { name, attrs, kids } = k {
                            match name.as_str() {
                                "thead" => walk(kids, head, rows, align, true),
                                "tbody" => walk(kids, head, rows, align, false),
                                "tr" => {
                                    let mut cells = Vec::new();
                                    for c in kids {
                                        if let H::Tag { name, attrs, kids } = c {
                                            if name == "th" || name == "td" {
                                                let mut inl = Vec::new();
                                                inlines_of_html(kids, &Marks::default(), &mut inl);
                                                cells.push(json!(normalize_inlines(inl)));
                                                if in_head {
                                                    align.push(json!(match attr(attrs, "align").as_deref() {
                                                        Some("center") => "CENTER",
                                                        Some("right") => "END",
                                                        _ => "START",
                                                    }));
                                                }
                                            }
                                        }
                                    }
                                    if in_head {
                                        *head = cells;
                                    } else {
                                        rows.push(json!(cells));
                                    }
                                }
                                _ => {
                                    let _ = attrs;
                                }
                            }
                        }
                    }
                }
                walk(kids, &mut head, &mut rows, &mut align, false);
                json!({"table": {"align": align, "head": head, "rows": rows}})
            }
            other => json!({"other": other}),
        });
    }
    flush(&mut loose, &mut out);
    out
}

/// Runs of text with the same marks joined, and empty ones dropped. The line break HTML writes
/// after a hard break is the writer's, not the text's.
fn normalize_inlines(v: Vec<Value>) -> Vec<Value> {
    let mut out: Vec<Value> = Vec::new();
    let mut after_break = false;
    for mut x in v {
        if after_break {
            if let Some(t) = x.get("text").and_then(|t| t["value"].as_str()).map(|s| s.to_string()) {
                x["text"]["value"] = json!(t.strip_prefix('\n').unwrap_or(&t));
            }
        }
        after_break = x.get("break").is_some();
        if let Some(t) = x.get("text") {
            if t["value"].as_str() == Some("") {
                continue;
            }
            if let Some(last) = out.last_mut() {
                if let Some(lt) = last.get("text").cloned() {
                    let same = ["bold", "italic", "strike", "link"].iter().all(|k| lt.get(*k) == t.get(*k));
                    if same {
                        let joined = format!("{}{}", lt["value"].as_str().unwrap_or(""), t["value"].as_str().unwrap_or(""));
                        last["text"]["value"] = json!(joined);
                        continue;
                    }
                }
            }
        }
        out.push(x);
    }
    out
}

// ---- core's md.from, run in the evaluator

fn field<'a>(v: &'a xtmd_eval::Value, name: &str) -> Option<&'a xtmd_eval::Value> {
    match v {
        xtmd_eval::Value::Record(r) => r.get(name),
        _ => None,
    }
}

fn text_value(v: Option<&xtmd_eval::Value>) -> String {
    match v {
        Some(xtmd_eval::Value::Text(t)) => t.to_string(),
        Some(xtmd_eval::Value::Num(n)) => n.show(),
        _ => String::new(),
    }
}

fn case_value<'a>(v: &'a xtmd_eval::Value, name: &str) -> Option<&'a xtmd_eval::Value> {
    match v {
        xtmd_eval::Value::Case(c) => c.values.iter().find(|(k, _)| &**k == name).map(|(_, x)| x),
        _ => None,
    }
}

fn list_items(v: Option<&xtmd_eval::Value>) -> Vec<xtmd_eval::Value> {
    match v {
        Some(xtmd_eval::Value::List(l)) => l.items.iter().map(|i| i.value.clone()).collect(),
        _ => Vec::new(),
    }
}

fn inlines_of_value(v: &xtmd_eval::Value) -> Vec<Value> {
    let mut out = Vec::new();
    for seg in list_items(field(v, "segments")) {
        let Some(xtmd_eval::Value::Case(part)) = field(&seg, "part") else { continue };
        let marks = field(&seg, "marks");
        let flag = |n: &str| matches!(marks.and_then(|m| field(m, n)), Some(xtmd_eval::Value::Bool(true)));
        let link = match marks.and_then(|m| field(m, "link")) {
            Some(xtmd_eval::Value::Opt(Some(l))) => Some(text_value(Some(l))),
            _ => None,
        };
        let p = xtmd_eval::Value::Case(part.clone());
        out.push(match &*part.name {
            "TEXT" => {
                let mut t = json!({"value": text_value(case_value(&p, "value"))});
                if flag("bold") {
                    t["bold"] = json!(true);
                }
                if flag("italic") {
                    t["italic"] = json!(true);
                }
                if flag("strike") {
                    t["strike"] = json!(true);
                }
                if let Some(l) = link {
                    t["link"] = json!(encode_url(&l));
                }
                json!({"text": t})
            }
            "CODE" => json!({"code": text_value(case_value(&p, "value"))}),
            "MATH" => json!({"math": "tex"}),
            "IMAGE" => json!({"image": {"src": encode_url(&text_value(case_value(&p, "src"))), "alt": text_value(case_value(&p, "alt"))}}),
            "NOTE" => json!({"note": text_value(case_value(&p, "mark"))}),
            "BREAK" => json!({"break": {}}),
            _ => json!({"view": {}}),
        });
    }
    normalize_inlines(out)
}

fn blocks_of_value(blocks: Vec<xtmd_eval::Value>) -> Vec<Value> {
    let mut out = Vec::new();
    for b in blocks {
        let xtmd_eval::Value::Case(c) = &b else { continue };
        let get = |n: &str| case_value(&b, n);
        out.push(match &*c.name {
            "PARAGRAPH" => json!({"paragraph": get("value").map(inlines_of_value).unwrap_or_default()}),
            "HEADING" => json!({"heading": {"level": text_value(get("level")).parse::<i64>().unwrap_or(0), "inline": get("value").map(inlines_of_value).unwrap_or_default()}}),
            "BULLETS" => {
                let ordered = matches!(get("ordered"), Some(xtmd_eval::Value::Bool(true)));
                let items: Vec<Value> = list_items(get("items"))
                    .iter()
                    .map(|it| {
                        let blocks = blocks_of_value(list_items(field(it, "body")));
                        match field(it, "done") {
                            Some(xtmd_eval::Value::Opt(Some(d))) => json!({"done": matches!(**d, xtmd_eval::Value::Bool(true)), "blocks": blocks}),
                            _ => json!({"blocks": blocks}),
                        }
                    })
                    .collect();
                let mut x = json!({"ordered": ordered, "items": items});
                if ordered {
                    x["start"] = json!(text_value(get("start")).parse::<i64>().unwrap_or(1));
                }
                json!({"bullets": x})
            }
            "QUOTE" => json!({"quote": blocks_of_value(list_items(get("body")))}),
            "CODE" => json!({"code": {"lang": text_value(get("lang")), "src": text_value(get("src"))}}),
            "MATH" => json!({"math": "tex"}),
            "DIVIDER" => json!({"divider": {}}),
            "FOOTNOTE" => json!({"footnote": {"mark": text_value(get("mark")), "blocks": blocks_of_value(list_items(get("body")))}}),
            "TABLE" => {
                let head: Vec<Value> = list_items(get("head")).iter().map(|c| json!(inlines_of_value(c))).collect();
                let rows: Vec<Value> = list_items(get("rows")).iter().map(|r| json!(list_items(Some(r)).iter().map(|c| json!(inlines_of_value(c))).collect::<Vec<_>>())).collect();
                let align: Vec<Value> = list_items(get("align")).iter().map(|a| if let xtmd_eval::Value::Case(c) = a { json!(&*c.name) } else { json!("START") }).collect();
                json!({"table": {"align": align, "head": head, "rows": rows}})
            }
            other => json!({"other": other}),
        });
    }
    out
}

/// An example's Markdown read by core's md.from, as a reader's text would be.
fn read_md(prog: &xtmd_eval::Program, md: &str) -> Value {
    use xtmd_eval::{interp::Constants, Binding, Machine, Value as V};
    use std::rc::Rc;
    let mut m = Machine::new(prog, Box::new(Constants));
    let pieces = m.make_list(vec![V::text(md)]).unwrap();
    let holes = m.make_list(vec![]).unwrap();
    let tpl = V::Record(Rc::new(xtmd_eval::value::Record { ty: Rc::from("core/template"), fields: vec![(Rc::from("pieces"), pieces), (Rc::from("holes"), holes)] }));
    match m.call("core/md.from", vec![Binding::Value(tpl)]) {
        Ok(Some(V::Opt(Some(v)))) => json!(blocks_of_value(list_items(field(&v, "blocks")))),
        Ok(_) => json!({"errors": ["md.from gave opt.NONE"]}),
        Err(f) => json!({"errors": [f.message]}),
    }
}

struct Outcome {
    passed: usize,
    failed: Vec<(i64, String, String, String)>,
}

fn load(file: &str) -> Value {
    serde_json::from_str(&std::fs::read_to_string(repo().join("targets/checks/commonmark").join(file)).unwrap()).unwrap()
}

fn run(file: &str, base: &xtmd_check::Checker, readings: &Value, through_md: Option<&xtmd_eval::Program>) -> Outcome {
    let data = load(file);
    // GitHub's output, where the same Markdown is one of its examples too
    let gfm = load("gfm-0.29.json");
    let github: std::collections::HashMap<String, String> =
        gfm["examples"].as_array().unwrap().iter().map(|e| (e["markdown"].as_str().unwrap().to_string(), e["html"].as_str().unwrap().to_string())).collect();
    let extensions_only = file.starts_with("gfm");
    let mut out = Outcome { passed: 0, failed: Vec::new() };
    for ex in data["examples"].as_array().unwrap() {
        if extensions_only && ex["extension"].as_str().unwrap_or("").is_empty() {
            continue;
        }
        let n = ex["example"].as_i64().unwrap();
        let md = ex["markdown"].as_str().unwrap();
        let key = format!("{}#{}", file, n);
        let html = github.get(md).cloned().unwrap_or_else(|| ex["html"].as_str().unwrap().to_string());
        // a reading of Extended Mark's own syntax applies to prose only: md.from reads plain Markdown, and
        // has its own reading under `md.from:` where it too differs from CommonMark
        let reading = match through_md {
            None => readings.get(&key),
            Some(_) => readings.get(&format!("md.from:{}", key)).or_else(|| readings.get(&key).filter(|r| r["only"].as_str() != Some("prose"))),
        };
        let expected: Value = match reading {
            Some(r) => r["blocks"].clone(),
            None => json!(blocks_of_html(&parse_html(&html))),
        };
        if let Some(prog) = through_md {
            let found = read_md(prog, md);
            if found == expected {
                out.passed += 1;
            } else {
                out.failed.push((n, ex["section"].as_str().unwrap_or("").to_string(), expected.to_string(), found.to_string()));
            }
            continue;
        }
        let c = compile_on(base, &[], &[Source { path: "example.xtmd".into(), text: md.to_string() }], "doc");
        let found = match &c.module {
            Some(m) => match m.templates.iter().find(|t| t.name == "doc") {
                Some(t) => json!(blocks_of_nodes(&t.view)),
                None => json!([]),
            },
            None => {
                let errs: Vec<String> = c.errors().filter(|d| d.file == "example.xtmd").map(|d| format!("[{}] {}", d.diagnostic.code, d.diagnostic.message)).collect();
                json!({"errors": errs})
            }
        };
        if found == expected {
            out.passed += 1;
        } else {
            out.failed.push((n, ex["section"].as_str().unwrap_or("").to_string(), expected.to_string(), found.to_string()));
        }
    }
    out
}

#[test]
fn commonmark_and_github_examples() {
    let base = compile_core(&core_sources());
    let readings: Value = std::fs::read_to_string(repo().join("targets/checks/commonmark/xtmd-readings.json")).ok().and_then(|s| serde_json::from_str::<Value>(&s).ok()).map(|v| v["readings"].clone()).unwrap_or(json!({}));
    for (key, r) in readings.as_object().unwrap() {
        assert!(r["why"].as_str().map_or(false, |w| !w.is_empty()), "{}: a reading says why", key);
    }
    let mut report = String::new();
    let mut total_failed = 0;
    let mut b = base.clone();
    let prog = b.program();
    for (file, through) in [("commonmark-0.31.2.json", None), ("gfm-0.29.json", None), ("commonmark-0.31.2.json", Some(&prog)), ("gfm-0.29.json", Some(&prog))] {
        let o = run(file, &base, &readings, through);
        let label = if through.is_some() { format!("md.from {}", file) } else { format!("prose {}", file) };
        report.push_str(&format!("{}: {} pass, {} fail\n", label, o.passed, o.failed.len()));
        for (n, sec, want, got) in &o.failed {
            report.push_str(&format!("  #{} ({})\n    want {}\n    got  {}\n", n, sec, want, got));
        }
        total_failed += o.failed.len();
    }
    if let Ok(path) = std::env::var("XTMD_COMMONMARK_REPORT") {
        std::fs::write(path, &report).unwrap();
    }
    println!("{}", report.lines().filter(|l| !l.starts_with(' ')).collect::<Vec<_>>().join("\n"));
    assert_eq!(total_failed, 0, "examples that don't pass:\n{}", report);
}
