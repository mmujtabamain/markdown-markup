//! The types of `schemas/`, written for Rust and for TypeScript.
//!
//! The schemas use a small part of JSON Schema, and each shape becomes one kind of type:
//! an object with properties is a struct; a `oneOf` of objects with one key each is a tagged
//! union (serde's externally tagged enum, a TypeScript union of one-key objects); a string
//! `enum` is an enum of strings; an object with only `additionalProperties` is a map.

use serde_json::{Map, Value};
use std::collections::{BTreeMap, BTreeSet};
use std::path::{Path, PathBuf};

pub struct Schema {
    /// `ir` or `check`: the Rust module and the TypeScript file.
    pub module: &'static str,
    pub defs: Map<String, Value>,
}

impl Schema {
    pub fn load(path: &Path, module: &'static str) -> Schema {
        let v: Value = serde_json::from_str(&std::fs::read_to_string(path).unwrap()).unwrap();
        Schema { module, defs: v["$defs"].as_object().unwrap().clone() }
    }
}

/// The files to write, relative to the repository: (path, contents).
pub fn generate(repo: &Path) -> Vec<(PathBuf, String)> {
    let ir = Schema::load(&repo.join("schemas/ir.schema.json"), "ir");
    let check = Schema::load(&repo.join("schemas/check.schema.json"), "check");
    let mut out = Vec::new();
    for s in [&ir, &check] {
        let mut g = Gen::new(s);
        g.run();
        out.push((PathBuf::from(format!("targets/rust/compiler/ir/src/{}.rs", s.module)), g.rust()));
        out.push((PathBuf::from(format!("targets/ts/runtime/src/generated/{}.ts", s.module)), g.ts()));
    }
    out
}

pub fn pascal(s: &str) -> String {
    let sym = match s {
        "+" => Some("Plus"),
        "-" => Some("Minus"),
        "*" => Some("Times"),
        "/" => Some("Divide"),
        "%" => Some("Rem"),
        "==" => Some("Eq"),
        "!=" => Some("Ne"),
        "<" => Some("Lt"),
        "<=" => Some("Le"),
        ">" => Some("Gt"),
        ">=" => Some("Ge"),
        "&&" => Some("And"),
        "||" => Some("Or"),
        "!" => Some("Not"),
        "?" => Some("Pick"),
        _ => None,
    };
    if let Some(s) = sym {
        return s.to_string();
    }
    let mut out = String::new();
    let mut up = true;
    for c in s.chars() {
        if c.is_ascii_alphanumeric() {
            if up {
                out.extend(c.to_uppercase());
            } else {
                out.extend(c.to_lowercase());
            }
            up = false;
        } else {
            up = true;
        }
    }
    out
}

fn rust_field(name: &str) -> String {
    match name {
        "$state" => "state".into(),
        "type" => "ty".into(),
        "mut" => "mutable".into(),
        "fn" | "else" | "use" | "let" | "if" | "for" | "return" | "enum" | "match" | "in" | "where" | "self" | "box" | "ref" | "move" | "static"
        | "loop" | "const" | "struct" | "impl" | "trait" | "mod" | "pub" | "crate" | "super" | "as" | "break" | "continue" | "do" | "async" | "await"
        | "dyn" | "extern" | "true" | "false" | "type_" => format!("{}_", name),
        _ => name.replace('-', "_"),
    }
}

/// What a type expression became.
#[derive(Clone)]
enum Ty {
    Str,
    Int,
    Bool,
    Any,
    Empty,
    Named(String),
    Vec(Box<Ty>),
    Map(Box<Ty>),
}

enum Item {
    Struct { name: String, doc: Option<String>, fields: Vec<FieldOut> },
    Union { name: String, doc: Option<String>, variants: Vec<(String, Ty, Option<String>)> },
    Strings { name: String, doc: Option<String>, values: Vec<String> },
}

struct FieldOut {
    key: String,
    ty: Ty,
    required: bool,
    doc: Option<String>,
}

struct Gen<'a> {
    s: &'a Schema,
    items: Vec<Item>,
    /// Edges from a type to the types it holds directly (not through a list or a map).
    edges: BTreeMap<String, BTreeSet<String>>,
    foreign: BTreeSet<String>,
}

fn doc(v: &Value) -> Option<String> {
    v.get("description").and_then(|d| d.as_str()).map(|s| s.to_string())
}

impl<'a> Gen<'a> {
    fn new(s: &'a Schema) -> Gen<'a> {
        Gen { s, items: Vec::new(), edges: BTreeMap::new(), foreign: BTreeSet::new() }
    }

    fn run(&mut self) {
        let defs: Vec<(String, Value)> = self.s.defs.iter().map(|(k, v)| (k.clone(), v.clone())).collect();
        for (k, v) in defs {
            let name = pascal(&k);
            self.def(&name, &v);
        }
    }

    fn def(&mut self, name: &str, v: &Value) {
        if let Some(alts) = v.get("oneOf").and_then(|a| a.as_array()) {
            let mut variants = Vec::new();
            for a in alts {
                let props = a["properties"].as_object().unwrap();
                let (key, payload) = props.iter().next().unwrap();
                let ty = self.ty(payload, &format!("{}{}", name, pascal(key)));
                self.edge(name, &ty);
                variants.push((key.clone(), ty, doc(a)));
            }
            self.items.push(Item::Union { name: name.into(), doc: doc(v), variants });
        } else if let Some(values) = v.get("enum").and_then(|e| e.as_array()) {
            let values = values.iter().map(|x| x.as_str().unwrap().to_string()).collect();
            self.items.push(Item::Strings { name: name.into(), doc: doc(v), values });
        } else if v.get("properties").is_some() {
            let required: BTreeSet<String> =
                v.get("required").and_then(|r| r.as_array()).map(|r| r.iter().map(|x| x.as_str().unwrap().to_string()).collect()).unwrap_or_default();
            let mut fields = Vec::new();
            for (key, fv) in v["properties"].as_object().unwrap() {
                let ty = self.ty(fv, &format!("{}{}", name, pascal(key)));
                self.edge(name, &ty);
                fields.push(FieldOut { key: key.clone(), ty, required: required.contains(key), doc: doc(fv) });
            }
            self.items.push(Item::Struct { name: name.into(), doc: doc(v), fields });
        } else {
            panic!("{}: a definition is an object, a oneOf or a string enum", name);
        }
    }

    fn edge(&mut self, from: &str, ty: &Ty) {
        if let Ty::Named(n) = ty {
            self.edges.entry(from.to_string()).or_default().insert(n.clone());
        }
    }

    fn ty(&mut self, v: &Value, context: &str) -> Ty {
        if let Some(r) = v.get("$ref").and_then(|r| r.as_str()) {
            let (file, def) = r.split_once("#/$defs/").unwrap();
            if !file.is_empty() {
                self.foreign.insert(pascal(def));
            }
            return Ty::Named(pascal(def));
        }
        if let Some(c) = v.get("const") {
            return if c.is_string() { Ty::Str } else { Ty::Int };
        }
        if v.get("oneOf").is_some() || v.get("enum").is_some() {
            self.def(context, v);
            return Ty::Named(context.to_string());
        }
        match v.get("type").and_then(|t| t.as_str()) {
            Some("string") => Ty::Str,
            Some("integer") => Ty::Int,
            Some("boolean") => Ty::Bool,
            Some("array") => Ty::Vec(Box::new(self.ty(&v["items"], context))),
            Some("object") => {
                let props = v.get("properties").and_then(|p| p.as_object());
                match (props, v.get("additionalProperties")) {
                    (Some(p), _) if p.is_empty() => Ty::Empty,
                    (Some(_), _) => {
                        self.def(context, v);
                        Ty::Named(context.to_string())
                    }
                    (None, Some(ap)) if ap.is_object() => Ty::Map(Box::new(self.ty(ap, context))),
                    _ => Ty::Any,
                }
            }
            None if v.as_object().map_or(false, |o| o.keys().all(|k| k == "description")) => Ty::Any,
            other => panic!("{}: no type for {:?}", context, other),
        }
    }

    /// Whether `to` holds `from` again directly, so `from` holding `to` needs a box.
    fn cyclic(&self, from: &str, to: &str) -> bool {
        let mut seen = BTreeSet::new();
        let mut stack = vec![to.to_string()];
        while let Some(n) = stack.pop() {
            if n == from {
                return true;
            }
            if !seen.insert(n.clone()) {
                continue;
            }
            if let Some(next) = self.edges.get(&n) {
                stack.extend(next.iter().cloned());
            }
        }
        false
    }

    fn rust_ty(&self, ty: &Ty, owner: &str) -> String {
        match ty {
            Ty::Str => "String".into(),
            Ty::Int => "i64".into(),
            Ty::Bool => "bool".into(),
            Ty::Any => "serde_json::Value".into(),
            Ty::Empty => "Empty".into(),
            Ty::Named(n) => {
                let path = if self.foreign.contains(n) && self.s.module == "check" { format!("crate::ir::{}", n) } else { n.clone() };
                if self.cyclic(owner, n) {
                    format!("Box<{}>", path)
                } else {
                    path
                }
            }
            Ty::Vec(t) => format!("Vec<{}>", self.rust_inner(t)),
            Ty::Map(t) => format!("BTreeMap<String, {}>", self.rust_inner(t)),
        }
    }

    fn rust_inner(&self, ty: &Ty) -> String {
        match ty {
            Ty::Named(n) if self.foreign.contains(n) && self.s.module == "check" => format!("crate::ir::{}", n),
            Ty::Named(n) => n.clone(),
            other => self.rust_ty(other, ""),
        }
    }

    fn rust(&self) -> String {
        let mut o = String::new();
        o.push_str(&format!(
            "// Written by mkp-schemagen from schemas/{}.schema.json. Don't edit: change the schema, then run\n// `cargo run -p mkp-schemagen`.\n\n#![allow(clippy::all)]\n\nuse serde::{{Deserialize, Serialize}};\nuse std::collections::BTreeMap;\n",
            self.s.module
        ));
        if self.s.module == "ir" {
            o.push_str("\n/// An object with nothing in it: `{}`.\n#[derive(Clone, Debug, Default, PartialEq, Serialize, Deserialize)]\n#[serde(deny_unknown_fields)]\npub struct Empty {}\n");
        } else {
            o.push_str("\nuse crate::ir::Empty;\n");
        }
        o.push_str("\nfn is_false(b: &bool) -> bool {\n    !*b\n}\n");
        for item in &self.items {
            o.push('\n');
            match item {
                Item::Struct { name, doc, fields } => {
                    rust_doc(&mut o, doc, "");
                    o.push_str("#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]\n#[serde(deny_unknown_fields)]\n");
                    o.push_str(&format!("pub struct {} {{\n", name));
                    for f in fields {
                        rust_doc(&mut o, &f.doc, "    ");
                        let rname = rust_field(&f.key);
                        let mut attrs = Vec::new();
                        if rname != f.key {
                            attrs.push(format!("rename = \"{}\"", f.key));
                        }
                        let base = self.rust_ty(&f.ty, name);
                        let ty = if f.required {
                            base
                        } else {
                            match &f.ty {
                                Ty::Vec(_) => {
                                    attrs.push("default, skip_serializing_if = \"Vec::is_empty\"".into());
                                    base
                                }
                                Ty::Map(_) => {
                                    attrs.push("default, skip_serializing_if = \"BTreeMap::is_empty\"".into());
                                    base
                                }
                                Ty::Bool => {
                                    attrs.push("default, skip_serializing_if = \"is_false\"".into());
                                    base
                                }
                                _ => {
                                    attrs.push("default, skip_serializing_if = \"Option::is_none\"".into());
                                    format!("Option<{}>", base)
                                }
                            }
                        };
                        if !attrs.is_empty() {
                            o.push_str(&format!("    #[serde({})]\n", attrs.join(", ")));
                        }
                        o.push_str(&format!("    pub {}: {},\n", rname, ty));
                    }
                    o.push_str("}\n");
                }
                Item::Union { name, doc, variants } => {
                    rust_doc(&mut o, doc, "");
                    o.push_str("#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]\n");
                    o.push_str(&format!("pub enum {} {{\n", name));
                    for (key, ty, d) in variants {
                        rust_doc(&mut o, d, "    ");
                        o.push_str(&format!("    #[serde(rename = \"{}\")]\n", key));
                        o.push_str(&format!("    {}({}),\n", pascal(key), self.rust_ty(ty, name)));
                    }
                    o.push_str("}\n");
                }
                Item::Strings { name, doc, values } => {
                    rust_doc(&mut o, doc, "");
                    o.push_str("#[derive(Clone, Copy, Debug, PartialEq, Eq, Hash, PartialOrd, Ord, Serialize, Deserialize)]\n");
                    o.push_str(&format!("pub enum {} {{\n", name));
                    for v in values {
                        o.push_str(&format!("    #[serde(rename = \"{}\")]\n    {},\n", v, pascal(v)));
                    }
                    o.push_str("}\n");
                }
            }
        }
        o
    }

    fn ts_ty(&self, ty: &Ty) -> String {
        match ty {
            Ty::Str => "string".into(),
            Ty::Int => "number".into(),
            Ty::Bool => "boolean".into(),
            Ty::Any => "unknown".into(),
            Ty::Empty => "{ [key: string]: never }".into(),
            Ty::Named(n) => n.clone(),
            Ty::Vec(t) => format!("{}[]", self.ts_ty(t)),
            Ty::Map(t) => format!("{{ [key: string]: {} }}", self.ts_ty(t)),
        }
    }

    fn ts(&self) -> String {
        let mut o = format!(
            "// Written by mkp-schemagen from schemas/{}.schema.json. Don't edit: change the schema, then run\n// `cargo run -p mkp-schemagen`.\n",
            self.s.module
        );
        if !self.foreign.is_empty() && self.s.module == "check" {
            let names: Vec<&String> = self.foreign.iter().collect();
            o.push_str(&format!("\nimport type {{ {} }} from \"./ir.js\";\n", names.iter().map(|s| s.as_str()).collect::<Vec<_>>().join(", ")));
        }
        for item in &self.items {
            o.push('\n');
            match item {
                Item::Struct { name, doc, fields } => {
                    ts_doc(&mut o, doc, "");
                    o.push_str(&format!("export interface {} {{\n", name));
                    for f in fields {
                        ts_doc(&mut o, &f.doc, "  ");
                        let key = if f.key.chars().all(|c| c.is_ascii_alphanumeric() || c == '_') { f.key.clone() } else { format!("\"{}\"", f.key) };
                        o.push_str(&format!("  {}{}: {};\n", key, if f.required { "" } else { "?" }, self.ts_ty(&f.ty)));
                    }
                    o.push_str("}\n");
                }
                Item::Union { name, doc, variants } => {
                    ts_doc(&mut o, doc, "");
                    o.push_str(&format!("export type {} =\n", name));
                    for (k, (key, ty, _)) in variants.iter().enumerate() {
                        let key = if key.chars().all(|c| c.is_ascii_alphanumeric() || c == '_') { key.clone() } else { format!("\"{}\"", key) };
                        o.push_str(&format!("  | {{ {}: {} }}{}\n", key, self.ts_ty(ty), if k + 1 == variants.len() { ";" } else { "" }));
                    }
                }
                Item::Strings { name, doc, values } => {
                    ts_doc(&mut o, doc, "");
                    let vs: Vec<String> = values.iter().map(|v| format!("\"{}\"", v)).collect();
                    o.push_str(&format!("export type {} = {};\n", name, vs.join(" | ")));
                }
            }
        }
        o
    }
}

fn rust_doc(o: &mut String, doc: &Option<String>, indent: &str) {
    if let Some(d) = doc {
        for line in d.lines() {
            o.push_str(&format!("{}/// {}\n", indent, line));
        }
    }
}

fn ts_doc(o: &mut String, doc: &Option<String>, indent: &str) {
    if let Some(d) = doc {
        o.push_str(&format!("{}/** {} */\n", indent, d.replace("*/", "* /")));
    }
}
