//! The MKP page the omnicui adapter mounts for one widget contract, as the web's
//! (targets/ts/web/omnicui/source.mjs, of which this is a port): the extern widget called on its
//! own, its props turned into MKP literals by each input's type, every `mut` input bound to a
//! `$state` field (so a write persists), every event bound to a handler (so it reaches the page),
//! and its slots filled with simple labelled content. Inputs, slots and events come from the IR's
//! declarations, not from a hand-written list.
//!
//! Names: omnicui's are camelCase, MKP's small with underscores. A prop `zoomRange` is the input
//! `zoom_range`; an event `openChanged` is `open_changed`; a write to the `mut` input `open` is
//! reported as the event `writeOpen`, with the field `value`.

use std::collections::BTreeMap;

use serde_json::{Map, Value as Json};

/// `zoom_range` → `zoomRange`.
pub fn camel(s: &str) -> String {
    let mut out = String::new();
    let mut up = false;
    for c in s.chars() {
        if c == '_' {
            up = true;
        } else if up {
            out.extend(c.to_uppercase());
            up = false;
        } else {
            out.push(c);
        }
    }
    out
}

/// `zoomRange` → `zoom_range`.
pub fn snake(s: &str) -> String {
    let mut out = String::new();
    for c in s.chars() {
        if c.is_ascii_uppercase() {
            out.push('_');
            out.push(c.to_ascii_lowercase());
        } else {
            out.push(c);
        }
    }
    out
}

/// `open` → `writeOpen`: the event a write to a `mut` input is reported as.
pub fn write_event(input: &str) -> String {
    let c = camel(input);
    let mut chars = c.chars();
    match chars.next() {
        Some(f) => format!("write{}{}", f.to_uppercase(), chars.as_str()),
        None => "write".into(),
    }
}

/// `core/press_kind` → `press_kind`: the name a document writes.
fn short(name: &str) -> &str {
    name.rsplit('/').next().unwrap_or(name)
}

/// Every declaration of an IR file, by kind and full name.
#[derive(Default)]
pub struct Decls {
    pub widgets: BTreeMap<String, Json>,
    pub enums: BTreeMap<String, Json>,
    pub tokens: BTreeMap<String, Json>,
    pub records: BTreeMap<String, Json>,
    pub types: BTreeMap<String, Json>,
}

pub fn declarations(file: &Json) -> Decls {
    let ir = if file.get("ir").is_some() { &file["ir"] } else { file };
    let mut out = Decls::default();
    for d in ir["declarations"].as_array().into_iter().flatten() {
        let x = &d["declare"];
        let name = |v: &Json| v["name"].as_str().unwrap_or("").to_string();
        if let Some(w) = x.get("extern").and_then(|e| e.get("widget")) {
            out.widgets.insert(name(w), w.clone());
        } else if let Some(e) = x.get("enum") {
            out.enums.insert(name(e), e.clone());
        } else if let Some(t) = x.get("token") {
            out.tokens.insert(name(t), t.clone());
        } else if let Some(r) = x.get("record") {
            out.records.insert(name(r), r.clone());
        } else if let Some(t) = x.get("type") {
            out.types.insert(name(t), t.clone());
        }
    }
    out
}

/// The core widget a contract id names: `core.slider` → `core/slider`.
pub fn widget_of(component: &str) -> Option<String> {
    let rest = component.strip_prefix("core.")?;
    let ok = rest.chars().next().is_some_and(|c| c.is_ascii_lowercase()) && rest.chars().all(|c| c.is_ascii_lowercase() || c.is_ascii_digit() || c == '_');
    ok.then(|| format!("core/{}", rest))
}

// ---- literals

/// A text literal on one line: `"` and `\` escaped, line breaks and tabs as `\n` and `\t`.
pub fn text_literal(s: &str) -> String {
    let mut out = String::from("\"");
    for c in s.chars() {
        match c {
            '\\' => out.push_str("\\\\"),
            '"' => out.push_str("\\\""),
            '\n' => out.push_str("\\n"),
            '\t' => out.push_str("\\t"),
            c if (c as u32) < 0x20 || c as u32 == 0x7f => out.push_str(&format!("\\u{{{:x}}}", c as u32)),
            c => out.push(c),
        }
    }
    out.push('"');
    out
}

/// A number literal: digits, an optional fraction and a minus, never an exponent.
pub fn number_literal(v: &Json) -> Result<String, String> {
    let x = match v {
        Json::Number(n) => n.as_f64(),
        Json::String(s) => s.trim().parse().ok(),
        _ => None,
    }
    .filter(|x: &f64| x.is_finite())
    .ok_or_else(|| format!("{} is not a number", v))?;
    let mut s = format!("{}", x.abs());
    if s.contains('e') || s.contains('E') {
        s = format!("{:.20}", x.abs()).trim_end_matches('0').trim_end_matches('.').to_string();
    }
    Ok(if x < 0.0 { format!("-{}", s) } else { s })
}

/// A JSON value given for a list, a record or a range may come as JSON text in a string prop.
fn parsed(v: &Json) -> Json {
    if let Json::String(s) = v {
        let t = s.trim();
        if t.starts_with('[') || t.starts_with('{') {
            if let Ok(j) = serde_json::from_str(t) {
                return j;
            }
        }
    }
    v.clone()
}

/// `"0..10"`, `"0..10 step 0.5"`, `"0..."`: (low, open high, high, step).
fn range_text(s: &str) -> Option<(String, bool, Option<String>, Option<String>)> {
    let s = s.trim();
    let (body, step) = match s.split_once("step") {
        Some((b, st)) => (b.trim(), Some(st.trim().to_string())),
        None => (s, None),
    };
    let (low, rest) = body.split_once("..")?;
    let (open, high) = match rest.strip_prefix('.') {
        Some(h) => (true, h.trim()),
        None => (false, rest.trim()),
    };
    let num = |x: &str| x.parse::<f64>().is_ok();
    if !num(low.trim()) || (!high.is_empty() && !num(high)) || step.as_deref().is_some_and(|s| !num(s)) {
        return None;
    }
    Some((low.trim().to_string(), open, (!high.is_empty()).then(|| high.to_string()), step))
}

/// A prop's value, in the type of the input it is given to, as MKP source.
pub fn literal(v: &Json, ty: &Json, decls: &Decls) -> Result<String, String> {
    let name = ty["name"].as_str().unwrap_or("");
    let args = ty["args"].as_array().cloned().unwrap_or_default();
    match name {
        "core/text" | "core/rich_text" | "core/latex" | "core/md" => {
            return Ok(text_literal(&match v {
                Json::String(s) => s.clone(),
                other => other.to_string(),
            }))
        }
        "core/bool" => {
            return match v {
                Json::Bool(true) => Ok("true".into()),
                Json::Bool(false) => Ok("false".into()),
                Json::String(s) if s == "true" => Ok("true".into()),
                Json::String(s) if s == "false" => Ok("false".into()),
                other => Err(format!("{} is not a bool", other)),
            }
        }
        "core/number" | "core/int" => return number_literal(v),
        "core/opt" => {
            return match v {
                Json::Null => Ok("opt.NONE".into()),
                Json::String(s) if s == "NONE" => Ok("opt.NONE".into()),
                other => literal(other, args.first().unwrap_or(&Json::Null), decls),
            }
        }
        "core/list" => {
            let items = parsed(v);
            let Json::Array(items) = items else { return Err(format!("{} is not a list (give JSON: [ … ])", v)) };
            let inner: Result<Vec<String>, String> = items.iter().map(|x| literal(x, args.first().unwrap_or(&Json::Null), decls)).collect();
            return Ok(format!("[{}]", inner?.join(", ")));
        }
        "core/range" => {
            let r = parsed(v);
            return match &r {
                Json::Array(a) => Ok(format!("{}..{}{}", number_literal(&a[0])?, number_literal(a.get(1).unwrap_or(&Json::Null))?, match a.get(2) {
                    Some(s) => format!(" step {}", number_literal(s)?),
                    None => String::new(),
                })),
                Json::Object(o) => {
                    let low = o.get("low").map(number_literal).transpose()?.unwrap_or_default();
                    let high = o.get("high").map(number_literal).transpose()?;
                    let step = o.get("step").map(number_literal).transpose()?;
                    Ok(format!("{}..{}{}", low, high.unwrap_or_else(|| ".".into()), step.map(|s| format!(" step {}", s)).unwrap_or_default()))
                }
                other => {
                    let s = other.as_str().map(str::to_string).unwrap_or_else(|| other.to_string());
                    let (low, open, high, step) = range_text(&s).ok_or_else(|| format!("{} is not a range (write \"0..10\" or \"0..10 step 0.5\")", v))?;
                    Ok(format!("{}..{}{}{}", low, if open { "." } else { "" }, high.unwrap_or_default(), step.map(|s| format!(" step {}", s)).unwrap_or_default()))
                }
            };
        }
        _ => {}
    }
    if let Some(alias) = decls.types.get(name) {
        let mut is = alias["is"].clone();
        if let Some(c) = ty.get("contract") {
            is["contract"] = c.clone();
        }
        return literal(v, &is, decls);
    }
    if let Some(kinds) = decls.enums.get(name).or_else(|| decls.tokens.get(name)) {
        let token = decls.tokens.contains_key(name);
        if token && v.is_number() {
            return number_literal(v);
        }
        let cases = kinds["cases"].as_array().cloned().unwrap_or_default();
        let c = parsed(v);
        if let Json::String(s) = &c {
            if !cases.iter().any(|k| k["name"] == *s) {
                let names: Vec<&str> = cases.iter().filter_map(|k| k["name"].as_str()).collect();
                return Err(format!("{:?} is not a case of {} ({})", s, short(name), names.join(", ")));
            }
            return Ok(format!("{}.{}", short(name), s));
        }
        if let Json::Object(o) = &c {
            if o.len() == 1 {
                let (case_name, values) = o.iter().next().unwrap();
                let kase = cases.iter().find(|k| k["name"] == *case_name).ok_or_else(|| format!("{:?} is not a case of {}", case_name, short(name)))?;
                let mut fields = Vec::new();
                for f in kase["fields"].as_array().into_iter().flatten() {
                    let fname = f["name"].as_str().unwrap_or("");
                    if let Some(x) = values.get(fname) {
                        fields.push(format!("{} = {}", fname, literal(x, &f["type"], decls)?));
                    }
                }
                return Ok(format!("{}.{}({})", short(name), case_name, fields.join(", ")));
            }
        }
        return Err(format!("{} is not a case of {}", v, short(name)));
    }
    if let Some(record) = decls.records.get(name) {
        let o = parsed(v);
        let Json::Object(o) = o else { return Err(format!("{} is not a {} (give JSON: {{ … }})", v, short(name))) };
        let snaked: Map<String, Json> = o.iter().map(|(k, x)| (snake(k), x.clone())).collect();
        let mut fields = Vec::new();
        for f in record["fields"].as_array().into_iter().flatten() {
            let fname = f["name"].as_str().unwrap_or("");
            if let Some(x) = o.get(fname).or_else(|| snaked.get(fname)) {
                fields.push(format!("{} = {}", fname, literal(x, &f["type"], decls)?));
            }
        }
        return Ok(format!("{} {{ {} }}", short(name), fields.join(", ")));
    }
    Err(format!("an input of type {} can't be set from a contract", name))
}

/// A literal from a default in the IR's form, for a `$state` field's starting value.
pub fn ir_literal(x: &Json) -> Result<String, String> {
    if let Some(n) = x.get("num").and_then(Json::as_str) {
        return Ok(n.to_string());
    }
    if let Some(t) = x.get("text").and_then(Json::as_str) {
        return Ok(text_literal(t));
    }
    if let Some(b) = x.get("bool").and_then(Json::as_bool) {
        return Ok(b.to_string());
    }
    if x.get("none").is_some() {
        return Ok("opt.NONE".into());
    }
    if let Some(s) = x.get("some") {
        return ir_literal(s);
    }
    if let Some(c) = x.get("case") {
        let vals: Vec<String> = c["values"].as_object().into_iter().flatten().map(|(k, v)| Ok(format!("{} = {}", k, ir_literal(v)?))).collect::<Result<_, String>>()?;
        let head = format!("{}.{}", short(c["enum"].as_str().unwrap_or("")), c["name"].as_str().unwrap_or(""));
        return Ok(if vals.is_empty() { head } else { format!("{}({})", head, vals.join(", ")) });
    }
    if let Some(r) = x.get("record") {
        let fields: Vec<String> = r["fields"].as_object().into_iter().flatten().map(|(k, v)| Ok(format!("{} = {}", k, ir_literal(v)?))).collect::<Result<_, String>>()?;
        return Ok(format!("{} {{ {} }}", short(r["type"].as_str().unwrap_or("")), fields.join(", ")));
    }
    if let Some(l) = x.get("list").and_then(Json::as_array) {
        let items: Vec<String> = l.iter().map(ir_literal).collect::<Result<_, String>>()?;
        return Ok(format!("[{}]", items.join(", ")));
    }
    if let Some(r) = x.get("range") {
        let low = r.get("low").map(ir_literal).transpose()?.unwrap_or_default();
        let high = r.get("high").map(ir_literal).transpose()?.unwrap_or_else(|| ".".into());
        return Ok(format!("{}..{}", low, high));
    }
    Err(format!("can't write the default {}", x))
}

/// A type as a document writes it, its contract included: `number 0.1..10`, `opt<region>`.
pub fn type_source(t: &Json) -> String {
    let mut s = short(t["name"].as_str().unwrap_or("")).to_string();
    if let Some(args) = t["args"].as_array().filter(|a| !a.is_empty()) {
        s += &format!("<{}>", args.iter().map(type_source).collect::<Vec<_>>().join(", "));
    }
    let c = &t["contract"];
    if let Some(r) = c.get("range") {
        let lo = r["low"]["num"].as_str().unwrap_or("");
        let hi = r["high"]["num"].as_str().unwrap_or("");
        s += &format!(" {}..{}", lo, if hi.is_empty() { "." } else { hi });
    }
    if let Some(st) = c["step"]["num"].as_str() {
        s += &format!(" step {}", st);
    }
    s
}

/// A starting value for a `$state` field when neither the contract nor the input gives one.
fn zero(t: &Json, decls: &Decls) -> Result<String, String> {
    let name = t["name"].as_str().unwrap_or("");
    match name {
        "core/text" => return Ok("\"\"".into()),
        "core/bool" => return Ok("false".into()),
        "core/number" | "core/int" => return Ok(t["contract"]["range"]["low"]["num"].as_str().unwrap_or("0").to_string()),
        "core/opt" => return Ok("opt.NONE".into()),
        _ => {}
    }
    if let Some(r) = decls.records.get(name) {
        let fields: Vec<String> = r["fields"].as_array().into_iter().flatten().map(|f| Ok(format!("{} = {}", f["name"].as_str().unwrap_or(""), zero(&f["type"], decls)?))).collect::<Result<_, String>>()?;
        return Ok(format!("{} {{ {} }}", short(name), fields.join(", ")));
    }
    if let Some(e) = decls.enums.get(name) {
        return Ok(format!("{}.{}", short(name), e["cases"][0]["name"].as_str().unwrap_or("")));
    }
    Err(format!("no starting value for a {}", name))
}

// ---- slots and the widgets a widget has to sit in

fn label(text: &str) -> String {
    format!("@label(value = {});", text_literal(text))
}

/// The content a slot gets when the contract doesn't fill it, where the widget needs some.
fn slot_default(key: &str) -> Option<Json> {
    let s = |x: &str| Some(Json::String(x.into()));
    let l = |xs: &[&str]| Some(Json::Array(xs.iter().map(|x| Json::String(x.to_string())).collect()));
    match key {
        "core/bullets.items" => l(&["One", "Two"]),
        "core/item.body" => s("An item"),
        "core/quote.body" => s("Quoted"),
        "core/footnote.body" => s("Its source."),
        "core/overlay.anchor" => s("More"),
        "core/overlay.body" => s("The rest"),
        "core/flex.children" => l(&["One", "Two"]),
        "core/grid.children" => l(&["One", "Two"]),
        "core/cell.child" => s("In a cell"),
        "core/sizing.child" => s("Sized"),
        "core/place.child" => s("Here"),
        "core/spot.child" => s("Home"),
        _ => None,
    }
}

/// A labelled circle up and to the right of the middle, so a press at a canvas's middle lands on
/// empty space.
const FILLER_CIRCLE: &str = "@circle(at = point { x = 0.5, y = 0.5 }, r = 0.2, fill = color.ACCENT, label = \"a dot\");";

fn indent(lines: Vec<String>) -> Vec<String> {
    lines.into_iter().map(|l| format!("    {}", l)).collect()
}

/// Where a widget has to sit: the widgets around it, with its call inside.
fn parents(widget: &str, inner: Vec<String>) -> Vec<String> {
    let wrap = |head: &str, body: Vec<String>| {
        let mut v = vec![head.to_string()];
        v.extend(body);
        v.push("}".into());
        v
    };
    match widget {
        "core/item" => wrap("@bullets {", indent(inner)),
        "core/layer" => wrap("@canvas(label = \"A canvas\") {", indent(inner)),
        "core/spot" => {
            let mut body = vec!["    items {".to_string()];
            body.extend(indent(indent(inner)));
            body.push("    }".into());
            wrap("@plane(label = \"A plane\", width = size.M, aspect = 2) {", body)
        }
        "core/cell" => wrap("@grid(cols = cols.EQUAL(count = 2)) {", indent(inner)),
        "core/sizing" => wrap("@flex(axis = axis.X) {", indent(inner)),
        "core/circle" | "core/path" | "core/place" | "core/handle" | "core/shade" => {
            let mut body = vec!["    @layer {".to_string()];
            body.extend(indent(indent(inner)));
            body.push("    }".into());
            wrap("@canvas(label = \"A canvas\") {", body)
        }
        _ => inner,
    }
}

/// Inputs a contract can't give (a shader is code, its args are any type): the adapter's own.
fn fixed(widget: &str, input: &str) -> Option<&'static str> {
    match (widget, input) {
        ("core/shade", "shader") => Some("glow"),
        ("core/shade", "args") => Some("1"),
        _ => None,
    }
}

/// Top-level definitions a page needs for fixed inputs.
fn definitions(widget: &str) -> Vec<String> {
    match widget {
        "core/shade" => vec![
            "fn glow(at: point, px: number, args: number): pixel {".into(),
            "    return pixel { r = at.x.clamp(0, 1), g = 0, b = at.y.clamp(0, 1), a = 1 };".into(),
            "}".into(),
        ],
        _ => Vec::new(),
    }
}

fn slot_content(widget: &str, slot: &Json, given: Option<&Json>) -> Vec<String> {
    let sname = slot["name"].as_str().unwrap_or("");
    let key = format!("{}.{}", widget, sname);
    let t = &slot["type"];
    let value = given.map(parsed).or_else(|| slot_default(&key));
    let arg0 = &t["args"][0];
    if t["name"] == "core/list" && arg0["name"] == "core/item" {
        let items: Vec<String> = match &value {
            Some(Json::Array(a)) => a.iter().map(|x| x.as_str().map(str::to_string).unwrap_or_else(|| x.to_string())).collect(),
            Some(Json::String(s)) => vec![s.clone()],
            _ => Vec::new(),
        };
        return items.iter().flat_map(|s| vec!["@item {".to_string(), format!("    @paragraph(value = {});", text_literal(s)), "}".to_string()]).collect();
    }
    if t["name"] == "core/list" && arg0["name"] == "core/layer" {
        return if widget == "core/plane" { Vec::new() } else { vec!["@layer {".into(), format!("    {}", FILLER_CIRCLE), "}".into()] };
    }
    if t["name"] == "core/list" && arg0["name"] == "core/spot" {
        return vec!["@spot(at = point { x = 100, y = 40 }) {".into(), "    @label(value = \"Home\");".into(), "}".into()];
    }
    if t["name"] == "core/list" && arg0["interface"] == "core/shape" {
        return vec![FILLER_CIRCLE.into()];
    }
    match value {
        None | Some(Json::Null) => Vec::new(),
        Some(Json::Array(a)) => a.iter().map(|x| label(x.as_str().unwrap_or(&x.to_string()))).collect(),
        Some(v) => {
            let text = v.as_str().map(str::to_string).unwrap_or_else(|| v.to_string());
            if ["core/item.body", "core/quote.body", "core/footnote.body"].contains(&key.as_str()) {
                vec![format!("@paragraph(value = {});", text_literal(&text))]
            } else {
                vec![label(&text)]
            }
        }
    }
}

/// The page for one mount. `props` are the contract's (camelCase), the test's over the contract's
/// defaults. A prop named after a slot fills it: text for a view slot, a list of texts for a list
/// of children or items.
pub fn page_source(widget: &str, props: &Map<String, Json>, decls: &Decls) -> Result<String, String> {
    let w = decls.widgets.get(widget).ok_or_else(|| format!("no extern widget {}", widget))?;
    let given: BTreeMap<String, Json> = props.iter().map(|(k, v)| (snake(k), v.clone())).collect();
    let inputs = w["inputs"].as_array().cloned().unwrap_or_default();
    let slots = w["slots"].as_array().cloned().unwrap_or_default();
    for k in given.keys() {
        let known = inputs.iter().chain(slots.iter()).any(|i| i["name"] == *k);
        if !known {
            return Err(format!("{} has no input or slot {}", widget, camel(k)));
        }
    }
    let mut state = vec!["    heard: int = 0;".to_string()];
    let mut args = Vec::new();
    for input in &inputs {
        let name = input["name"].as_str().unwrap_or("");
        let has = given.get(name);
        if let Some(f) = fixed(widget, name) {
            args.push(format!("{} = {}", name, f));
        } else if input["mut"].as_bool() == Some(true) {
            let start = match has {
                Some(v) => literal(v, &input["type"], decls)?,
                None => match input.get("default") {
                    Some(d) => ir_literal(d)?,
                    None => zero(&input["type"], decls)?,
                },
            };
            state.push(format!("    {}: {} = {};", name, type_source(&input["type"]), start));
            args.push(format!("{} = $state.{}", name, name));
        } else if let Some(v) = has {
            args.push(format!("{} = {}", name, literal(v, &input["type"], decls)?));
        } else if input.get("default").is_none() {
            return Err(format!("{} needs {}, and neither the test nor the contract gives it", widget, camel(name)));
        }
    }
    for e in w["events"].as_array().into_iter().flatten() {
        let params: Vec<&str> = e["params"].as_array().into_iter().flatten().filter_map(|p| p["name"].as_str()).collect();
        args.push(format!("{} = fn({}) {{ $state.heard = $state.heard + 1; }}", e["name"].as_str().unwrap_or(""), params.join(", ")));
    }
    let head = if args.is_empty() { format!("@{}", short(widget)) } else { format!("@{}({})", short(widget), args.join(", ")) };
    let filled: Vec<(String, Vec<String>)> = slots.iter().map(|s| (s["name"].as_str().unwrap_or("").to_string(), slot_content(widget, s, given.get(s["name"].as_str().unwrap_or(""))))).filter(|(_, b)| !b.is_empty()).collect();
    let call: Vec<String> = if filled.is_empty() {
        vec![format!("{};", head)]
    } else if slots.len() == 1 {
        let mut v = vec![format!("{} {{", head)];
        v.extend(indent(filled[0].1.clone()));
        v.push("}".into());
        v
    } else {
        let mut v = vec![format!("{} {{", head)];
        for (s, body) in &filled {
            let mut b = vec![format!("{} {{", s)];
            b.extend(indent(body.clone()));
            b.push("}".into());
            v.extend(indent(b));
        }
        v.push("}".into());
        v
    };
    let view = parents(widget, call);
    let mut out = definitions(widget);
    if !out.is_empty() {
        out.push(String::new());
    }
    out.push("$state {".into());
    out.extend(state);
    out.push("}".into());
    out.push(String::new());
    out.push("widget sample() {".into());
    out.push("    view {".into());
    out.extend(indent(indent(view)));
    out.push("    }".into());
    out.push("}".into());
    out.push("@@@".into());
    out.push("@sample;".into());
    out.push(String::new());
    Ok(out.join("\n"))
}

/// What a mount reports: each event's name and parameters, and each `mut` input's write event.
pub struct Report {
    pub widget: String,
    pub events: BTreeMap<String, (String, Vec<String>)>,
    pub writes: BTreeMap<String, String>,
}

pub fn reporting(widget: &str, decls: &Decls) -> Report {
    let w = &decls.widgets[widget];
    let events = w["events"]
        .as_array()
        .into_iter()
        .flatten()
        .map(|e| {
            let n = e["name"].as_str().unwrap_or("").to_string();
            (n.clone(), (camel(&n), e["params"].as_array().into_iter().flatten().filter_map(|p| p["name"].as_str().map(str::to_string)).collect()))
        })
        .collect();
    let writes = w["inputs"].as_array().into_iter().flatten().filter(|i| i["mut"].as_bool() == Some(true)).map(|i| {
        let n = i["name"].as_str().unwrap_or("").to_string();
        (n.clone(), write_event(&n))
    });
    Report { widget: widget.to_string(), events, writes: writes.collect() }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn names_between_omnicui_and_mkp() {
        assert_eq!(camel("open_changed"), "openChanged");
        assert_eq!(snake("zoomRange"), "zoom_range");
        assert_eq!(write_event("zoom_range"), "writeZoomRange");
        assert_eq!(widget_of("core.slider").as_deref(), Some("core/slider"));
        assert_eq!(widget_of("ui.counter"), None);
    }

    #[test]
    fn literals() {
        assert_eq!(text_literal("a \"b\"\n"), "\"a \\\"b\\\"\\n\"");
        assert_eq!(number_literal(&serde_json::json!(-0.5)).unwrap(), "-0.5");
        assert_eq!(number_literal(&serde_json::json!(3)).unwrap(), "3");
        let decls = Decls::default();
        let range = serde_json::json!({"name": "core/range", "args": [{"name": "core/number"}]});
        assert_eq!(literal(&serde_json::json!("0..10 step 0.5"), &range, &decls).unwrap(), "0..10 step 0.5");
        assert_eq!(literal(&serde_json::json!("1..4"), &range, &decls).unwrap(), "1..4");
    }
}
