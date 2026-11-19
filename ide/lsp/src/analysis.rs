//! The editor features, worked out from a build's resolved IR (schemas/rir.schema.json) and the
//! texts of its files: what a name under the cursor is, where it is declared, a file's outline, and
//! what may be written where the cursor is. Every place is a file's byte offsets, as the resolved IR
//! gives them; `server` turns them into the protocol's.

use std::collections::HashMap;

use serde_json::{json, Value};

/// One declaration or member: a widget, an input, a field, a fn, a `$state` field and the rest.
#[derive(Clone, Debug)]
pub struct Decl {
    pub id: String,
    /// The resolved IR's word for it: `widget`, `extern_widget`, `fn`, `record`, `input`, `field`…
    pub kind: String,
    pub name: String,
    pub file: String,
    pub name_span: (usize, usize),
    pub span: (usize, usize),
    pub about: Option<String>,
    pub ty: Option<Value>,
    /// The declaration it belongs to, for a member.
    pub owner: Option<String>,
    /// Its members, in order: a widget's inputs then events, a record's fields, a fn's params.
    pub members: Vec<String>,
    /// For a member: it has a default, so a call may leave it out.
    pub defaulted: bool,
}

/// A name written somewhere, and what it means.
#[derive(Clone, Debug)]
struct Ref {
    span: (usize, usize),
    /// A declaration's id, or `$state.name`, or for a local, `local name`.
    to: String,
}

/// An expression's place and type.
#[derive(Clone, Debug)]
struct Typed {
    span: (usize, usize),
    ty: Value,
}

#[derive(Clone, Default)]
struct FileIx {
    refs: Vec<Ref>,
    typed: Vec<Typed>,
    /// The ids of its own top-level declarations, in order, and its `$state` fields.
    decls: Vec<String>,
    state: Vec<String>,
}

/// A build's resolved IR, indexed.
#[derive(Clone, Default)]
pub struct Index {
    pub decls: HashMap<String, Decl>,
    files: HashMap<String, FileIx>,
    texts: HashMap<String, String>,
}

/// A name's declaration found: its file and the span of its name.
pub struct Found {
    pub file: String,
    pub span: (usize, usize),
}

/// What hovering shows: Markdown, and the span it is about.
pub struct Hover {
    pub markdown: String,
    pub span: (usize, usize),
}

/// A file's outline: a declaration and what is in it.
pub struct Symbol {
    pub name: String,
    pub detail: String,
    /// The protocol's SymbolKind.
    pub kind: u32,
    pub span: (usize, usize),
    pub name_span: (usize, usize),
    pub children: Vec<Symbol>,
}

/// Something that may be written at the cursor.
pub struct Completion {
    pub label: String,
    /// The protocol's CompletionItemKind.
    pub kind: u32,
    pub detail: String,
    pub doc: Option<String>,
    /// What is written, as a snippet (`$1` and `$0` stops), when it isn't the label.
    pub snippet: Option<String>,
    /// The text it replaces, as byte offsets, when that isn't only the word at the cursor: a
    /// widget's `@` and the name begun after it.
    pub replace: Option<(usize, usize)>,
}

fn span_of(v: &Value) -> Option<(usize, usize)> {
    let a = v.as_array()?;
    Some((a.first()?.as_u64()? as usize, a.get(1)?.as_u64()? as usize))
}

impl Index {
    /// Indexes `rir`, whose files' texts are `texts` (by the path the resolved IR names them by).
    pub fn new(rir: &Value, texts: HashMap<String, String>) -> Index {
        let mut ix = Index { texts, ..Index::default() };
        for f in rir["files"].as_array().into_iter().flatten() {
            ix.add_file(f);
        }
        ix
    }

    /// Adds the files of another resolved IR, such as core's, built once.
    pub fn extend(&mut self, rir: &Value, texts: HashMap<String, String>) {
        self.texts.extend(texts);
        for f in rir["files"].as_array().into_iter().flatten() {
            self.add_file(f);
        }
    }

    fn add_file(&mut self, f: &Value) {
        let path = f["path"].as_str().unwrap_or("").to_string();
        let mut fx = FileIx::default();
        for d in f["declarations"].as_array().into_iter().flatten() {
            let Some((kind, body)) = d.as_object().and_then(|o| o.iter().next()) else { continue };
            if let Some(id) = self.add_decl(&path, kind, body, None) {
                fx.decls.push(id);
            }
        }
        for field in f["state"]["fields"].as_array().into_iter().flatten() {
            if let Some(id) = self.add_decl(&path, "state", field, None) {
                fx.state.push(id);
            }
        }
        walk(f, &mut fx, None);
        self.files.insert(path, fx);
    }

    /// A declaration and its members, by its id; gives the id.
    fn add_decl(&mut self, file: &str, kind: &str, body: &Value, owner: Option<&str>) -> Option<String> {
        let id = body["id"].as_str()?.to_string();
        let name_span = span_of(&body["name_span"]).unwrap_or((0, 0));
        let span = span_of(&body["span"]).unwrap_or(name_span);
        let name = body["name"].as_str().map(str::to_string).unwrap_or_else(|| id.rsplit(['/', '.']).next().unwrap_or(&id).to_string());
        let mut members = Vec::new();
        for (key, member_kind) in [("inputs", "input"), ("events", "event"), ("slots", "slot"), ("fields", "field"), ("params", "param"), ("cases", "case"), ("values", "value"), ("fns", "extern_fn")] {
            for m in body[key].as_array().into_iter().flatten() {
                if let Some(mid) = self.add_decl(file, member_kind, m, Some(&id)) {
                    members.push(mid);
                }
            }
        }
        let decl = Decl {
            id: id.clone(),
            kind: kind.to_string(),
            name,
            file: file.to_string(),
            name_span,
            span,
            about: body["doc"]["about"].as_str().map(str::to_string),
            ty: body.get("type").filter(|t| t.is_object()).cloned(),
            owner: owner.map(str::to_string),
            members,
            defaulted: body.get("default").is_some(),
        };
        self.decls.insert(id.clone(), decl);
        Some(id)
    }

    /// A file's text, by its path.
    pub fn text(&self, file: &str) -> Option<&str> {
        self.texts.get(file).map(String::as_str)
    }

    /// The source a declaration is written with, on one line: up to its body or its `;`.
    pub fn header(&self, d: &Decl) -> String {
        let Some(text) = self.text(&d.file) else { return d.name.clone() };
        let (start, end) = (d.span.0.min(text.len()), d.span.1.min(text.len()));
        let src = &text[start..end];
        // a member is all of its span; a declaration stops at its body
        let cut = if d.owner.is_some() || d.kind == "state" { src.len() } else { header_end(src) };
        let one: String = src[..cut].split_whitespace().collect::<Vec<_>>().join(" ");
        let one = one.trim_end_matches([';', ',']).trim().to_string();
        if one.chars().count() > 300 {
            format!("{}…", one.chars().take(300).collect::<String>())
        } else {
            one
        }
    }

    fn smallest_ref(&self, file: &str, offset: usize) -> Option<&Ref> {
        self.files.get(file)?.refs.iter().filter(|r| r.span.0 <= offset && offset <= r.span.1).min_by_key(|r| r.span.1 - r.span.0)
    }

    /// The smallest typed expression around a span.
    fn type_around(&self, file: &str, span: (usize, usize)) -> Option<&Value> {
        self.files.get(file)?.typed.iter().filter(|t| t.span.0 <= span.0 && span.1 <= t.span.1).min_by_key(|t| t.span.1 - t.span.0).map(|t| &t.ty)
    }

    /// The declaration whose name is written at `offset`, if one is.
    fn decl_named_at(&self, file: &str, offset: usize) -> Option<&Decl> {
        self.decls.values().filter(|d| d.file == file && d.name_span.0 <= offset && offset <= d.name_span.1 && d.name_span != (0, 0)).min_by_key(|d| d.name_span.1 - d.name_span.0)
    }

    /// What is under the cursor: a name and what it means, or an expression's type.
    pub fn hover(&self, file: &str, offset: usize) -> Option<Hover> {
        if let Some(r) = self.smallest_ref(file, offset) {
            if let Some(d) = self.decls.get(&r.to) {
                return Some(Hover { markdown: self.describe(d), span: r.span });
            }
            // a local, or a name the resolved IR gives no declaration for: its type, where known
            let ty = self.type_around(file, r.span).map(type_text);
            let name = r.to.strip_prefix("local ").unwrap_or(&r.to);
            return Some(Hover { markdown: code(&match ty {
                Some(t) => format!("{}: {}", name, t),
                None => name.to_string(),
            }), span: r.span });
        }
        if let Some(d) = self.decl_named_at(file, offset) {
            return Some(Hover { markdown: self.describe(d), span: d.name_span });
        }
        let fx = self.files.get(file)?;
        let t = fx.typed.iter().filter(|t| t.span.0 <= offset && offset <= t.span.1).min_by_key(|t| t.span.1 - t.span.0)?;
        Some(Hover { markdown: code(&type_text(&t.ty)), span: t.span })
    }

    /// A declaration as hovering shows it: how it is written, what it belongs to, and its doc.
    pub fn describe(&self, d: &Decl) -> String {
        let mut out = code(&self.header(d));
        if let Some(owner) = d.owner.as_ref().and_then(|o| self.decls.get(o)) {
            out.push_str(&format!("\n\n{} of `{}`", word(&d.kind), owner.name));
        }
        if let Some(a) = &d.about {
            out.push_str("\n\n");
            out.push_str(a);
        }
        out
    }

    /// Where the name at `offset` is declared.
    pub fn definition(&self, file: &str, offset: usize) -> Option<Found> {
        let r = self.smallest_ref(file, offset)?;
        let d = self.decls.get(&r.to)?;
        (d.name_span != (0, 0)).then(|| Found { file: d.file.clone(), span: d.name_span })
    }

    /// Every place a declaration is written, in the files indexed: its own name, and each use.
    pub fn references(&self, file: &str, offset: usize) -> Vec<Found> {
        let id = match self.smallest_ref(file, offset) {
            Some(r) => r.to.clone(),
            None => match self.decl_named_at(file, offset) {
                Some(d) => d.id.clone(),
                None => return Vec::new(),
            },
        };
        let mut out: Vec<Found> = Vec::new();
        if let Some(d) = self.decls.get(&id).filter(|d| d.name_span != (0, 0)) {
            out.push(Found { file: d.file.clone(), span: d.name_span });
        }
        let mut files: Vec<&String> = self.files.keys().collect();
        files.sort();
        for f in files {
            for r in self.files[f].refs.iter().filter(|r| r.to == id) {
                out.push(Found { file: f.clone(), span: r.span });
            }
        }
        out
    }

    /// A file's outline.
    pub fn symbols(&self, file: &str) -> Vec<Symbol> {
        let Some(fx) = self.files.get(file) else { return Vec::new() };
        let mut out: Vec<Symbol> = fx.decls.iter().filter_map(|id| self.decls.get(id)).map(|d| self.symbol(d)).collect();
        if !fx.state.is_empty() {
            let fields: Vec<Symbol> = fx.state.iter().filter_map(|id| self.decls.get(id)).map(|d| self.symbol(d)).collect();
            let span = (fields.iter().map(|s| s.span.0).min().unwrap_or(0), fields.iter().map(|s| s.span.1).max().unwrap_or(0));
            out.push(Symbol { name: "$state".into(), detail: String::new(), kind: 23, span, name_span: span, children: fields });
        }
        out.sort_by_key(|s| s.span.0);
        out
    }

    fn symbol(&self, d: &Decl) -> Symbol {
        let children = d.members.iter().filter_map(|m| self.decls.get(m)).filter(|m| m.name_span != (0, 0)).map(|m| self.symbol(m)).collect();
        let detail = match &d.ty {
            Some(t) => type_text(t),
            None => String::new(),
        };
        Symbol { name: d.name.clone(), detail, kind: symbol_kind(&d.kind), span: d.span, name_span: d.name_span, children }
    }

    /// What may be written at `offset` in `file`, whose text (perhaps newer than the index) is `text`.
    pub fn completions(&self, file: &str, text: &str, offset: usize) -> Vec<Completion> {
        let before = &text[..offset.min(text.len())];
        let line = before.rsplit('\n').next().unwrap_or("");
        // `@` and a name being written: the widgets there are, each replacing the `@` and the name
        if let Some(at) = line.rfind('@') {
            let typed = &line[at + 1..];
            if typed.chars().all(|c| c.is_ascii_lowercase() || c.is_ascii_digit() || c == '_') {
                let from = offset - typed.len() - 1;
                return self
                    .widgets()
                    .into_iter()
                    .map(|w| {
                        let mut c = self.widget_completion(w);
                        c.replace = Some((from, offset));
                        c
                    })
                    .collect();
            }
        }
        // `$state.`: its fields
        if line.ends_with("$state.") || trailing_name(line).is_some_and(|(q, _)| q == "$state") {
            let fields = self.files.get(file).map(|f| f.state.clone()).unwrap_or_default();
            return fields.iter().filter_map(|id| self.decls.get(id)).map(|d| self.member_completion(d, false)).collect();
        }
        // `name.`: an enum's or a token's cases
        if let Some((q, _)) = trailing_name(line) {
            if let Some(e) = self.decls.values().find(|d| d.name == q && matches!(d.kind.as_str(), "enum" | "token" | "tokens") && d.owner.is_none()) {
                return e.members.iter().filter_map(|m| self.decls.get(m)).map(|c| Completion { label: c.name.clone(), kind: 20, detail: format!("{}.{}", e.name, c.name), doc: c.about.clone(), snippet: None, replace: None }).collect();
            }
        }
        // inside a call's brackets: the inputs and events not yet given
        if let Some((name, given)) = open_call(before) {
            if let Some(w) = self.widgets().into_iter().find(|w| w.name == name) {
                return w
                    .members
                    .iter()
                    .filter_map(|m| self.decls.get(m))
                    .filter(|m| matches!(m.kind.as_str(), "input" | "event") && !given.contains(&m.name))
                    .map(|m| self.member_completion(m, true))
                    .collect();
            }
        }
        Vec::new()
    }

    /// Every widget the build can call: core's, its packs' and its own.
    fn widgets(&self) -> Vec<&Decl> {
        let mut w: Vec<&Decl> = self.decls.values().filter(|d| matches!(d.kind.as_str(), "widget" | "extern_widget") && d.owner.is_none()).collect();
        w.sort_by(|a, b| a.name.cmp(&b.name).then(a.id.cmp(&b.id)));
        w
    }

    fn widget_completion(&self, w: &Decl) -> Completion {
        // the inputs a call has to give, each a stop to fill in
        let needed: Vec<&Decl> = w.members.iter().filter_map(|m| self.decls.get(m)).filter(|m| m.kind == "input" && !m.defaulted).collect();
        let args: Vec<String> = needed.iter().enumerate().map(|(k, m)| format!("{} = ${}", m.name, k + 1)).collect();
        Completion { label: w.name.clone(), kind: 7, detail: self.header(w), doc: w.about.clone(), snippet: Some(format!("@{}({})$0", w.name, args.join(", "))), replace: None }
    }

    fn member_completion(&self, m: &Decl, assign: bool) -> Completion {
        let detail = self.header(m);
        let snippet = assign.then(|| format!("{} = $0", m.name));
        Completion { label: m.name.clone(), kind: if m.kind == "event" { 23 } else { 5 }, detail, doc: m.about.clone(), snippet, replace: None }
    }
}

/// Where a declaration's header ends: its body's `{`, or its `;`, outside brackets and strings.
fn header_end(src: &str) -> usize {
    let (mut depth, mut in_str) = (0i32, false);
    let mut prev = ' ';
    for (k, c) in src.char_indices() {
        if in_str {
            if c == '"' && prev != '\\' {
                in_str = false;
            }
        } else {
            match c {
                '"' => in_str = true,
                '(' | '[' | '<' => depth += 1,
                ')' | ']' | '>' => depth -= 1,
                '{' | ';' if depth <= 0 => return k,
                _ => {}
            }
        }
        prev = c;
    }
    src.len()
}

/// `q.name` at a line's end, the name perhaps empty: (`q`, `name`).
fn trailing_name(line: &str) -> Option<(&str, &str)> {
    let dot = line.rfind('.')?;
    let after = &line[dot + 1..];
    if !after.chars().all(|c| c.is_ascii_alphanumeric() || c == '_') {
        return None;
    }
    let head = &line[..dot];
    let start = head.rfind(|c: char| !(c.is_ascii_alphanumeric() || c == '_' || c == '$')).map_or(0, |k| k + 1);
    let q = &head[start..];
    (!q.is_empty()).then_some((q, after))
}

/// The call whose brackets are open at the end of `before`: its widget's name, and the names
/// already given in it.
fn open_call(before: &str) -> Option<(String, Vec<String>)> {
    let bytes = before.as_bytes();
    let (mut depth, mut k) = (0i32, bytes.len());
    while k > 0 {
        k -= 1;
        match bytes[k] {
            b')' | b']' | b'}' => depth += 1,
            b'(' | b'[' | b'{' if depth > 0 => depth -= 1,
            b'(' => {
                // `@name(`
                let head = &before[..k];
                let start = head.rfind(|c: char| !(c.is_ascii_lowercase() || c.is_ascii_digit() || c == '_'))?;
                if head.as_bytes()[start] != b'@' {
                    return None;
                }
                let name = head[start + 1..].to_string();
                let args = &before[k + 1..];
                let given = args
                    .split(',')
                    .filter_map(|a| a.split_once('=').map(|(n, _)| n.trim().to_string()))
                    .filter(|n| !n.is_empty() && n.chars().all(|c| c.is_ascii_alphanumeric() || c == '_'))
                    .collect();
                return (!name.is_empty()).then_some((name, given));
            }
            b'[' | b'{' => return None,
            _ => {}
        }
    }
    None
}

/// The names and types a file's resolved IR writes, wherever they sit: each object that names a
/// widget, an input, a fn, a field or a variable, and each expression with its type.
fn walk(v: &Value, fx: &mut FileIx, widget: Option<&str>) {
    match v {
        Value::Object(o) => {
            // inside a widget's declaration, `get: { input }` names one of its inputs
            let inside = o.get("id").and_then(Value::as_str).filter(|_| o.contains_key("inputs")).or(widget);
            if let Some(ns) = o.get("name_span").and_then(span_of) {
                let to = if let Some(w) = o.get("widget").and_then(Value::as_str) {
                    Some(w.to_string())
                } else if let Some(t) = o.get("target").and_then(Value::as_str) {
                    Some(t.to_string())
                } else if let Some(f) = o.get("fn").and_then(Value::as_str) {
                    Some(f.to_string())
                } else if let Some(m) = o.get("member").and_then(Value::as_str) {
                    Some(m.to_string())
                } else if let Some(s) = o.get("state").and_then(Value::as_str) {
                    Some(format!("$state.{}", s))
                } else if let Some(i) = o.get("input").and_then(Value::as_str) {
                    inside.map(|w| format!("{}.{}", w, i))
                } else if let Some(i) = o.get("own").and_then(Value::as_str) {
                    inside.map(|w| format!("{}.{}", w, i))
                } else if let Some(l) = o.get("let").or_else(|| o.get("extern")).and_then(Value::as_str) {
                    Some(l.to_string())
                } else {
                    o.get("local").or_else(|| o.get("slot")).and_then(Value::as_str).map(|l| format!("local {}", l))
                };
                if let Some(to) = to {
                    fx.refs.push(Ref { span: ns, to });
                }
            }
            if let (Some(t), Some(sp)) = (o.get("type").filter(|t| t.is_object()), o.get("span").and_then(span_of)) {
                fx.typed.push(Typed { span: sp, ty: t.clone() });
            }
            for x in o.values() {
                walk(x, fx, inside);
            }
        }
        Value::Array(a) => {
            for x in a {
                walk(x, fx, widget);
            }
        }
        _ => {}
    }
}

/// A type as it is written: `list<node>[1...]`, `number 0..10`, `fn(node): bool`.
pub fn type_text(t: &Value) -> String {
    let name = t["name"].as_str().unwrap_or("?");
    let mut out = if name == "fn" {
        let params: Vec<String> = t["params"].as_array().into_iter().flatten().map(|p| type_text(&p["type"])).collect();
        match t.get("returns").filter(|r| r.is_object()) {
            Some(r) => format!("fn({}): {}", params.join(", "), type_text(r)),
            None => format!("fn({})", params.join(", ")),
        }
    } else {
        let short = name.strip_prefix("core/").unwrap_or(name).replace('/', ".");
        match t["args"].as_array() {
            Some(args) if !args.is_empty() => format!("{}<{}>", short, args.iter().map(type_text).collect::<Vec<_>>().join(", ")),
            _ => short,
        }
    };
    let c = &t["contract"];
    if let Some(r) = c.get("range") {
        out.push_str(&format!(" {}", bounds(r, "..")));
        if let Some(s) = r.get("step") {
            out.push_str(&format!(" step {}", lit(s)));
        }
    }
    if let Some(s) = c.get("step").filter(|_| c.get("range").is_none()) {
        out.push_str(&format!(" step {}", lit(s)));
    }
    if let Some(l) = c.get("length") {
        out.push_str(&format!("[{}]", bounds(l, "..")));
    }
    if let Some(only) = c.get("only").and_then(Value::as_array) {
        out.push_str(&format!(" only ({})", only.iter().map(lit).collect::<Vec<_>>().join(", ")));
    }
    out
}

fn bounds(b: &Value, dots: &str) -> String {
    match (b.get("low"), b.get("high")) {
        (Some(l), Some(h)) if lit(l) == lit(h) => lit(l),
        (Some(l), Some(h)) => format!("{}{}{}", lit(l), dots, lit(h)),
        (Some(l), None) => format!("{}...", lit(l)),
        (None, Some(h)) => format!("...{}", lit(h)),
        (None, None) => String::new(),
    }
}

/// A constant as it is written: `1`, `"left"`, `color.INFO`.
fn lit(v: &Value) -> String {
    if let Some(n) = v["num"].as_str() {
        return n.to_string();
    }
    if let Some(t) = v["text"].as_str() {
        return format!("{:?}", t);
    }
    if let Some(b) = v["bool"].as_bool() {
        return b.to_string();
    }
    if let Some(c) = v["case"].as_str() {
        return c.rsplit('/').next().unwrap_or(c).to_string();
    }
    if v.get("neg").is_some() {
        return format!("-{}", lit(&v["neg"]));
    }
    "…".into()
}

fn code(s: &str) -> String {
    format!("```xtmd\n{}\n```", s)
}

fn word(kind: &str) -> &str {
    match kind {
        "input" => "an input",
        "event" => "an event",
        "slot" => "a slot",
        "field" => "a field",
        "param" => "a parameter",
        "case" => "a case",
        "value" => "a value",
        "extern_fn" => "an extern fn",
        _ => "a part",
    }
}

/// The protocol's SymbolKind for a declaration.
fn symbol_kind(kind: &str) -> u32 {
    match kind {
        "pack" => 4,
        "extern" => 2,
        "widget" | "extern_widget" => 5,
        "record" => 23,
        "enum" => 10,
        "interface" => 11,
        "fn" | "extern_fn" => 12,
        "let" | "state" => 13,
        "token" | "tokens" => 14,
        "type" => 26,
        "input" | "field" | "value" => 7,
        "event" => 24,
        "slot" => 8,
        "case" => 22,
        "param" => 13,
        _ => 13,
    }
}

/// The protocol's symbols, from the outline, with ranges by `range` (byte offsets to the protocol's).
pub fn symbols_json(symbols: &[Symbol], range: &dyn Fn((usize, usize)) -> Value) -> Value {
    Value::Array(
        symbols
            .iter()
            .map(|s| json!({ "name": s.name, "detail": s.detail, "kind": s.kind, "range": range(s.span), "selectionRange": range(s.name_span), "children": symbols_json(&s.children, range) }))
            .collect(),
    )
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn types_read_as_they_are_written() {
        let t = json!({ "args": [{ "name": "graphs/node" }], "contract": { "length": { "low": { "num": "1" } } }, "name": "core/list" });
        assert_eq!(type_text(&t), "list<graphs.node>[1...]");
        assert_eq!(type_text(&json!({ "name": "core/number", "contract": { "range": { "low": { "num": "0" }, "high": { "num": "10" } } } })), "number 0..10");
        assert_eq!(type_text(&json!({ "name": "fn", "params": [{ "name": "p0", "type": { "name": "graphs/node" } }], "returns": { "name": "core/bool" } })), "fn(graphs.node): bool");
    }

    #[test]
    fn a_call_open_at_the_cursor_names_its_widget_and_what_it_has() {
        assert_eq!(open_call("@press(label = \"Go\", "), Some(("press".into(), vec!["label".into()])));
        assert_eq!(open_call("x = f(1, "), None);
        assert_eq!(open_call("@row(gap = space.M) {\n    @press("), Some(("press".into(), vec![])));
        assert_eq!(trailing_name("tone = color.IN"), Some(("color", "IN")));
    }

    #[test]
    fn a_header_stops_at_the_body() {
        assert_eq!(header_end("widget w(a: list<int> = [1, 2]) {\n  view {}\n}"), 32);
        assert_eq!(header_end("let a: text = \"{x};\";"), 20);
    }
}
