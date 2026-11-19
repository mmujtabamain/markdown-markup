//! The resolved IR (schemas/rir.schema.json): what the checker understood of a build, written out.
//! It walks each file's syntax tree, with what the checker found for it: what each name
//! resolved to (the reference log), and each expression's type and what it compiled to.

use std::collections::HashMap;

use xtmd_ir::ir;
use xtmd_syntax::ast::{self, DeclKind, Expr, ExprKind, Item, Stmt};
use xtmd_syntax::span::Span;
use serde_json::{json, Map, Value};

use crate::ty::Ty;
use crate::{compile_with, Checker, Compiled, DefKind, RefTarget, Source, TypeSym};

/// Compiles as `compile_on` does, and writes the resolved IR of every file it adds when the
/// build compiles.
pub fn compile_rir(base: &Checker, packs: &[Vec<Source>], main: &[Source], module: &str) -> (Compiled, Option<Value>) {
    let mut c = base.clone();
    c.refs = Some(Vec::new());
    c.typed = Some(HashMap::new());
    let first = c.files.len();
    let (compiled, mut c) = compile_with(c, packs, main, module);
    if compiled.module.is_none() {
        return (compiled, None);
    }
    let mut w = Writer::new(&mut c);
    let files: Vec<Value> = (first..w.c.files.len()).map(|f| w.file(f)).collect();
    let packs = w.packs();
    let root = json!({ "rir": 1, "xtmd": env!("CARGO_PKG_VERSION"), "packs": packs, "files": files });
    (compiled, Some(root))
}

struct Writer<'c> {
    c: &'c mut Checker,
    /// What each name at a span resolved to: (file, start, end) → the reference.
    refs: HashMap<(usize, u32, u32), RefTarget>,
    typed: HashMap<(usize, u32, u32), (Ty, ir::Expr)>,
}

impl<'c> Writer<'c> {
    fn new(c: &'c mut Checker) -> Writer<'c> {
        let mut refs = HashMap::new();
        for r in c.refs.clone().unwrap_or_default() {
            refs.entry((r.file, r.at.start, r.at.end)).or_insert(r.target);
        }
        let typed = c.typed.clone().unwrap_or_default();
        Writer { c, refs, typed }
    }

    fn packs(&self) -> Vec<Value> {
        let mut out = Vec::new();
        for (name, rec) in &self.c.packs {
            if name == "core" || *name == self.c.module || rec.files.is_empty() {
                continue;
            }
            let (base, surface) = match name.split_once('@') {
                Some((b, _)) => (b.to_string(), true),
                None => (name.clone(), false),
            };
            let mut p = Map::new();
            p.insert("name".into(), json!(base));
            let version = match name.split_once('@') {
                Some((_, v)) => v.parse::<i64>().unwrap_or(0),
                None => self.c.pack_block(name).map(|(_, _, v)| v as i64).unwrap_or(0),
            };
            p.insert("version".into(), json!(version));
            if surface {
                p.insert("surface".into(), json!(true));
            }
            let mut uses = Vec::new();
            for &f in &rec.files {
                for n in &self.c.files[f].ast.items {
                    if let Item::Decl(ast::Decl { kind: DeclKind::Pack(b), .. }) = &n.item {
                        for l in b.lines.iter() {
                            if let ast::PackLine::Uses(rs) = l {
                                for r in rs {
                                    uses.push(json!({ "name": r.name.name, "version": r.version.name.parse::<i64>().unwrap_or(0) }));
                                }
                            }
                        }
                    }
                }
            }
            if !uses.is_empty() {
                p.insert("uses".into(), json!(uses));
            }
            if let Some(pr) = &rec.provides {
                let mut v: Vec<&String> = pr.iter().collect();
                v.sort();
                p.insert("provides".into(), json!(v));
            }
            out.push(Value::Object(p));
        }
        out
    }

    // ---- files

    fn file(&mut self, f: usize) -> Value {
        let rec = self.c.files[f].clone();
        let ast = rec.ast.clone();
        let mut o = Map::new();
        o.insert("path".into(), json!(rec.path));
        let kind = if ast.surface.is_some() {
            "surface"
        } else if matches!(ast.kind, ast::FileKind::Document) {
            "document"
        } else {
            "pack"
        };
        o.insert("kind".into(), json!(kind));
        if let Some(p) = &ast.package {
            o.insert("package".into(), json!(p.item.name));
        }
        o.insert("sha256".into(), json!(sha256_hex(rec.src.as_bytes())));
        if let Some(fm) = ast.front_matter {
            o.insert("front_matter".into(), span(fm));
        }
        let mut imports = Vec::new();
        let mut decls = Vec::new();
        let mut expose = Vec::new();
        for n in &ast.items {
            match &n.item {
                Item::Import(i) => imports.push(self.import(f, i, n)),
                Item::Decl(d) => {
                    if let Some(v) = self.decl(f, d, n) {
                        decls.push(v);
                    }
                }
                Item::State(s) => {
                    o.insert("state".into(), self.state(f, s, n));
                }
                Item::Expose(e) => expose.push(self.expose(f, e, n)),
                _ => {}
            }
        }
        o.insert("imports".into(), json!(imports));
        o.insert("declarations".into(), json!(decls));
        if !expose.is_empty() {
            o.insert("expose".into(), json!(expose));
        }
        if let Some(p) = &ast.prose {
            o.insert("prose".into(), json!(self.prose(f, p)));
        }
        let dangling = leading_comments(&ast.dangling);
        if !dangling.is_empty() {
            o.insert("comments".into(), json!(dangling));
        }
        Value::Object(o)
    }

    fn import(&mut self, f: usize, i: &ast::Import, n: &ast::Node<Item>) -> Value {
        let mut o = Map::new();
        o.insert("pack".into(), json!(i.path[0].name));
        if let Some(one) = i.path.get(1) {
            o.insert("name".into(), json!(one.name));
            if let Some(t) = self.target_at(f, one.span) {
                o.insert("target".into(), json!(t));
            }
        }
        if let Some(a) = &i.alias {
            o.insert("as".into(), json!(a.name));
        }
        node_parts(&mut o, i.span, n);
        Value::Object(o)
    }

    // ---- declarations

    fn decl(&mut self, f: usize, d: &ast::Decl, n: &ast::Node<Item>) -> Option<Value> {
        let name = d.kind.name().clone();
        let id = self.def_at(f, name.span).map(|d| self.c.defs[d].full.clone()).unwrap_or_else(|| format!("{}/{}", self.c.files[f].pack, name.name));
        let mut o = Map::new();
        o.insert("id".into(), json!(id));
        o.insert("name_span".into(), span(name.span));
        let doc = doc_of(&n.leading);
        if !doc.is_empty() {
            o.insert("doc".into(), Value::Object(doc));
        }
        node_parts(&mut o, d.span, n);
        let key = match &d.kind {
            DeclKind::Enum(e) => {
                o.insert("cases".into(), json!(e.cases.items.iter().map(|c| self.case_decl(f, &id, c)).collect::<Vec<_>>()));
                "enum"
            }
            DeclKind::Token(t) => {
                o.insert("value".into(), json!(self.ty_of_ast(f, &t.ty)));
                o.insert("cases".into(), json!(t.cases.items.iter().map(|c| self.case_decl(f, &id, c)).collect::<Vec<_>>()));
                "token"
            }
            DeclKind::Record(r) => {
                let mut fields = Vec::new();
                let mut requires = Vec::new();
                for m in &r.members.items {
                    match &m.item {
                        ast::Member::Field(fl) => fields.push(self.field(f, &id, fl, Some(m.leading.as_slice()), m.trailing.as_slice())),
                        ast::Member::Require(q) => requires.push(self.require(f, q)),
                    }
                }
                o.insert("fields".into(), json!(fields));
                if !requires.is_empty() {
                    o.insert("requires".into(), json!(requires));
                }
                "record"
            }
            DeclKind::Alias(a) => {
                o.insert("is".into(), json!(self.ty_of_ast(f, &a.ty)));
                "type"
            }
            DeclKind::Interface(i) => {
                if i.widget {
                    o.insert("widget".into(), json!(true));
                }
                let (mut fields, mut fns, mut events) = (Vec::new(), Vec::new(), Vec::new());
                for m in &i.members.items {
                    match &m.item {
                        ast::IfaceMember::Field(fl) => fields.push(self.field(f, &id, fl, Some(m.leading.as_slice()), m.trailing.as_slice())),
                        ast::IfaceMember::Fn(sig) => fns.push(self.signature(f, &id, sig)),
                        ast::IfaceMember::Event(e) => events.push(self.event(f, &id, e)),
                    }
                }
                o.insert("fields".into(), json!(fields));
                o.insert("fns".into(), json!(fns));
                o.insert("events".into(), json!(events));
                "interface"
            }
            DeclKind::Widget(w) | DeclKind::ExternWidget(w) => {
                self.widget(f, &id, w, &mut o);
                if matches!(d.kind, DeclKind::Widget(_)) {
                    "widget"
                } else {
                    "extern_widget"
                }
            }
            DeclKind::Fn(fd) | DeclKind::ExternFn(fd) => {
                let fid = self.fn_id(f, &fd.sig).unwrap_or(id.clone());
                o.insert("id".into(), json!(fid));
                self.fn_parts(f, fd, &mut o);
                if matches!(d.kind, DeclKind::Fn(_)) {
                    "fn"
                } else {
                    "extern_fn"
                }
            }
            DeclKind::ExternType(_) => "extern_type",
            DeclKind::ExternBlock(b) => {
                let (mut values, mut fns) = (Vec::new(), Vec::new());
                for m in &b.members.items {
                    match &m.item {
                        ast::ExternMember::Field(fl) => values.push(self.field(f, &id, fl, Some(m.leading.as_slice()), m.trailing.as_slice())),
                        ast::ExternMember::Fn(sig) => fns.push(self.signature(f, &id, sig)),
                    }
                }
                o.insert("values".into(), json!(values));
                o.insert("fns".into(), json!(fns));
                "extern"
            }
            DeclKind::Let(v) => {
                o.insert("type".into(), json!(self.ty_of_ast(f, &v.ty)));
                o.insert("value".into(), self.expr(f, &v.value));
                "let"
            }
            DeclKind::Tokens(t) => {
                let lines: Vec<Value> = t
                    .lines
                    .items
                    .iter()
                    .map(|l| {
                        let token = self.type_full(f, &l.item.ty.name).unwrap_or_else(|| l.item.ty.name.clone());
                        let mut lo = Map::new();
                        lo.insert("token".into(), json!(token));
                        lo.insert("case".into(), json!(l.item.case.name));
                        lo.insert("value".into(), self.expr(f, &l.item.value));
                        node_parts(&mut lo, l.item.ty.span.to(l.item.value.span), l);
                        Value::Object(lo)
                    })
                    .collect();
                o.insert("lines".into(), json!(lines));
                "tokens"
            }
            DeclKind::Pack(p) => {
                o.insert("version".into(), json!(p.version.name.parse::<i64>().unwrap_or(0)));
                let (mut uses, mut provides, mut implements) = (Vec::new(), Vec::new(), Vec::new());
                for l in p.lines.iter() {
                    match l {
                        ast::PackLine::Uses(rs) => uses.extend(rs.iter().map(|r| json!({ "name": r.name.name, "version": r.version.name.parse::<i64>().unwrap_or(0), "span": span(r.name.span.to(r.version.span)) }))),
                        ast::PackLine::Provides(ns) => provides.extend(ns.iter().map(|n| json!(n.name))),
                        ast::PackLine::Implements(rs) => implements.extend(rs.iter().map(|r| json!(format!("{}.{}@{}", r.pack.name, r.level.name, r.version.name)))),
                    }
                }
                o.insert("uses".into(), json!(uses));
                o.insert("provides".into(), json!(provides));
                if !implements.is_empty() {
                    o.insert("implements".into(), json!(implements));
                }
                "pack"
            }
            DeclKind::Migration(m) => {
                o.remove("id");
                o.remove("name_span");
                o.insert("from".into(), json!({ "name": m.from.name.name, "version": m.from.version.name.parse::<i64>().unwrap_or(0) }));
                o.insert("to".into(), json!({ "name": m.to.name.name, "version": m.to.version.name.parse::<i64>().unwrap_or(0) }));
                let (mut fns, mut blocks) = (Vec::new(), Vec::new());
                for item in &m.items.items {
                    match &item.item {
                        ast::MigrationItem::Fn(fd) => {
                            let mut fo = Map::new();
                            fo.insert("id".into(), json!(format!("{}/{}", self.c.files[f].pack, fd.sig.name.name)));
                            fo.insert("name_span".into(), span(fd.sig.name.span));
                            node_parts(&mut fo, fd.sig.span, item);
                            self.fn_parts(f, fd, &mut fo);
                            fns.push(Value::Object(fo));
                        }
                        ast::MigrationItem::Block(b) => {
                            let key = b.path.iter().map(|i| i.name.as_str()).collect::<Vec<_>>().join(".");
                            let mut bo = Map::new();
                            bo.insert("kind".into(), json!(b.kind.name));
                            bo.insert("target".into(), json!(format!("{}@{}/{}", m.from.name.name, m.from.version.name, key)));
                            bo.insert("name_span".into(), span(b.path[0].span.to(b.path[b.path.len() - 1].span)));
                            bo.insert("body".into(), json!(self.migration_body(f, &b.body)));
                            node_parts(&mut bo, b.kind.span.to(b.body.span), item);
                            blocks.push(Value::Object(bo));
                        }
                    }
                }
                if !fns.is_empty() {
                    o.insert("fns".into(), json!(fns));
                }
                o.insert("blocks".into(), json!(blocks));
                "migration"
            }
            DeclKind::MigrationFn(mf) => {
                o.insert("id".into(), json!(format!("{}/{}", self.c.files[f].pack, mf.sig.name.name)));
                o.insert("params".into(), json!(mf.sig.params.items.iter().map(|p| self.param(f, &p.item, p)).collect::<Vec<_>>()));
                o.insert("body".into(), json!(self.migration_body(f, &mf.body)));
                "migration_fn"
            }
        };
        Some(json!({ key: Value::Object(o) }))
    }

    fn widget(&mut self, f: usize, id: &str, w: &ast::WidgetDecl, o: &mut Map<String, Value>) {
        let inputs: Vec<Value> = w.inputs.items.iter().map(|i| self.field(f, id, &i.item, Some(i.leading.as_slice()), i.trailing.as_slice())).collect();
        o.insert("inputs".into(), json!(inputs));
        let (mut slots, mut events, mut requires, mut own, mut lets, mut fns, mut view, mut markdown) = (Vec::new(), Vec::new(), Vec::new(), Vec::new(), Vec::new(), Vec::new(), Vec::new(), Vec::new());
        for m in w.body.iter().flat_map(|b| b.items.iter()) {
            match &m.item {
                ast::WidgetMember::Param(fl) => {
                    let mut v = self.field(f, id, fl, Some(m.leading.as_slice()), m.trailing.as_slice());
                    v["param"] = json!(true);
                    o.entry("inputs").or_insert(json!([])).as_array_mut().unwrap().push(v);
                }
                ast::WidgetMember::Slot(s) => {
                    let mut so = Map::new();
                    so.insert("name".into(), json!(s.name.name));
                    so.insert("id".into(), json!(format!("{}.{}", id, s.name.name)));
                    so.insert("type".into(), json!(self.ty_of_ast(f, &s.ty)));
                    node_parts(&mut so, s.name.span.to(s.ty.span), m);
                    slots.push(Value::Object(so));
                }
                ast::WidgetMember::Event(e) => events.push(self.event(f, id, e)),
                ast::WidgetMember::Require(q) => requires.push(self.require(f, q)),
                ast::WidgetMember::Own(v) => own.push(self.var(f, v, true, Some(m))),
                ast::WidgetMember::Let(v) => lets.push(self.var(f, v, false, Some(m))),
                ast::WidgetMember::Fn(fd) => {
                    let mut fo = Map::new();
                    fo.insert("id".into(), json!(self.fn_id(f, &fd.sig).unwrap_or_else(|| format!("{}.{}", id, fd.sig.name.name))));
                    fo.insert("name_span".into(), span(fd.sig.name.span));
                    node_parts(&mut fo, fd.sig.span, m);
                    self.fn_parts(f, fd, &mut fo);
                    fns.push(Value::Object(fo));
                }
                ast::WidgetMember::View(b) => view = self.stmts(f, b),
                ast::WidgetMember::Markdown(md) => markdown = self.prose(f, &md.prose),
            }
        }
        for (k, v) in [("slots", slots), ("events", events), ("requires", requires), ("own", own), ("lets", lets), ("fns", fns), ("view", view), ("markdown", markdown)] {
            if !v.is_empty() || k == "slots" || k == "events" {
                o.insert(k.into(), json!(v));
            }
        }
    }

    fn fn_parts(&mut self, f: usize, fd: &ast::FnDecl, o: &mut Map<String, Value>) {
        if let Some((on, _)) = &fd.sig.on {
            let t = self.type_full(f, &on.name).unwrap_or_else(|| on.name.clone());
            o.insert("on".into(), json!(t));
        }
        o.insert("params".into(), json!(fd.sig.params.items.iter().map(|p| self.param(f, &p.item, p)).collect::<Vec<_>>()));
        if let Some(ast::RetType::Type(t)) = &fd.sig.ret {
            o.insert("returns".into(), json!(self.ty_of_ast(f, t)));
        }
        if let Some(b) = &fd.body {
            o.insert("body".into(), json!(self.stmts(f, b)));
        }
    }

    fn signature(&mut self, f: usize, owner: &str, s: &ast::FnSig) -> Value {
        let mut o = Map::new();
        o.insert("name".into(), json!(s.name.name));
        o.insert("id".into(), json!(format!("{}.{}", owner, s.name.name)));
        o.insert("params".into(), json!(s.params.items.iter().map(|p| self.param(f, &p.item, p)).collect::<Vec<_>>()));
        if let Some(ast::RetType::Type(t)) = &s.ret {
            o.insert("returns".into(), json!(self.ty_of_ast(f, t)));
        }
        o.insert("span".into(), span(s.span));
        Value::Object(o)
    }

    fn event(&mut self, f: usize, owner: &str, e: &ast::EventDecl) -> Value {
        json!({
            "name": e.name.name,
            "id": format!("{}.{}", owner, e.name.name),
            "params": e.params.items.iter().map(|p| self.param(f, &p.item, p)).collect::<Vec<_>>(),
            "span": span(e.name.span.to(e.params.span)),
        })
    }

    fn param<T>(&mut self, f: usize, p: &ast::Param, n: &ast::Node<T>) -> Value {
        let mut o = Map::new();
        o.insert("name".into(), json!(p.name.name));
        if let Some(t) = &p.ty {
            o.insert("type".into(), json!(self.ty_of_ast(f, t)));
        }
        if p.mutable {
            o.insert("mutable".into(), json!(true));
        }
        if p.is_self {
            o.insert("self".into(), json!(true));
        }
        node_parts(&mut o, p.ty.as_ref().map_or(p.name.span, |t| p.name.span.to(t.span)), n);
        Value::Object(o)
    }

    fn case_decl(&mut self, f: usize, owner: &str, c: &ast::Node<ast::CaseDecl>) -> Value {
        let mut o = Map::new();
        o.insert("name".into(), json!(c.item.name.name));
        let fields: Vec<Value> = c.item.fields.iter().flat_map(|g| g.items.iter()).map(|fl| self.field(f, &format!("{}.{}", owner, c.item.name.name), &fl.item, None, &[])).collect();
        if !fields.is_empty() {
            o.insert("fields".into(), json!(fields));
        }
        let sp = c.item.fields.as_ref().map_or(c.item.name.span, |g| c.item.name.span.to(g.span));
        node_parts(&mut o, sp, c);
        Value::Object(o)
    }

    fn field(&mut self, f: usize, owner: &str, fl: &ast::Field, leading: Option<&[ast::Leading]>, trailing: &[xtmd_syntax::lexer::Comment]) -> Value {
        let mut o = Map::new();
        o.insert("name".into(), json!(fl.name.name));
        o.insert("id".into(), json!(format!("{}.{}", owner, fl.name.name)));
        o.insert("type".into(), json!(self.ty_of_ast(f, &fl.ty)));
        if let Some(d) = &fl.default {
            o.insert("default".into(), self.expr(f, d));
        }
        if fl.mutable {
            o.insert("mutable".into(), json!(true));
        }
        if fl.param {
            o.insert("param".into(), json!(true));
        }
        o.insert("name_span".into(), span(fl.name.span));
        o.insert("span".into(), span(fl.span));
        if let Some(c) = comments_of(leading.unwrap_or(&[]), trailing) {
            o.insert("comments".into(), c);
        }
        Value::Object(o)
    }

    fn require(&mut self, f: usize, q: &ast::Require) -> Value {
        json!({ "message": text_of(&q.message), "body": self.stmts(f, &q.body), "span": span(q.message.span.to(q.body.span)) })
    }

    fn var(&mut self, f: usize, v: &ast::Var, mutable: bool, n: Option<&ast::Node<ast::WidgetMember>>) -> Value {
        let mut o = Map::new();
        o.insert("name".into(), json!(v.name.name));
        o.insert("type".into(), json!(self.ty_of_ast(f, &v.ty)));
        o.insert("value".into(), self.expr(f, &v.value));
        if mutable {
            o.insert("mutable".into(), json!(true));
        }
        o.insert("span".into(), span(v.name.span.to(v.value.span)));
        if let Some(n) = n {
            if let Some(c) = comments_of(&n.leading, &n.trailing) {
                o.insert("comments".into(), c);
            }
        }
        Value::Object(o)
    }

    fn state(&mut self, f: usize, s: &ast::StateBlock, n: &ast::Node<Item>) -> Value {
        let mut fields = Vec::new();
        let mut requires = Vec::new();
        for m in &s.members.items {
            match &m.item {
                ast::Member::Field(fl) => {
                    let mut v = self.field(f, "$state", fl, Some(m.leading.as_slice()), m.trailing.as_slice());
                    v["id"] = json!(format!("$state.{}", fl.name.name));
                    v["mutable"] = json!(true);
                    fields.push(v);
                }
                ast::Member::Require(q) => requires.push(self.require(f, q)),
            }
        }
        let mut o = Map::new();
        o.insert("fields".into(), json!(fields));
        if !requires.is_empty() {
            o.insert("requires".into(), json!(requires));
        }
        node_parts(&mut o, s.span, n);
        Value::Object(o)
    }

    fn expose(&mut self, f: usize, e: &ast::Expose, n: &ast::Node<Item>) -> Value {
        let channel = self.channel_full(f, &e.name.name).unwrap_or_else(|| e.name.name.clone());
        let fns: Vec<Value> = e
            .fns
            .items
            .iter()
            .map(|fd| {
                let mut fo = Map::new();
                fo.insert("id".into(), json!(format!("{}.{}", channel, fd.item.sig.name.name)));
                fo.insert("name_span".into(), span(fd.item.sig.name.span));
                node_parts(&mut fo, fd.item.sig.span, fd);
                self.fn_parts(f, &fd.item, &mut fo);
                Value::Object(fo)
            })
            .collect();
        let mut o = Map::new();
        o.insert("channel".into(), json!(channel));
        o.insert("fns".into(), json!(fns));
        node_parts(&mut o, e.name.span.to(e.fns.span), n);
        Value::Object(o)
    }

    fn migration_body(&mut self, f: usize, b: &ast::Body<ast::MigrationStmt>) -> Vec<Value> {
        b.items
            .iter()
            .map(|n| {
                let mut o = Map::new();
                let (key, value, sp) = match &n.item {
                    ast::MigrationStmt::Execute(blk) => ("execute", json!(self.stmts(f, blk)), blk.span),
                    ast::MigrationStmt::Event { name, body } => ("event", json!({ "name": name.name, "body": self.migration_body(f, body) }), name.span.to(body.span)),
                    ast::MigrationStmt::Stmt(Stmt::Expr(e)) if matches!(&e.kind, ExprKind::Call { callee, .. } if matches!(callee.kind, ExprKind::Name(_))) => {
                        let ExprKind::Call { callee, args } = &e.kind else { unreachable!() };
                        let ExprKind::Name(nm) = &callee.kind else { unreachable!() };
                        let args: Vec<Value> = args.items.iter().map(|a| self.named(f, a.item.name.as_ref(), &a.item.value, None, a)).collect();
                        ("call", json!({ "name": nm.name, "args": args }), e.span)
                    }
                    ast::MigrationStmt::Stmt(s) => ("stmt", self.stmt(f, s), stmt_span(s)),
                };
                o.insert(key.into(), value);
                node_parts(&mut o, sp, n);
                Value::Object(o)
            })
            .collect()
    }

    // ---- statements

    fn stmts(&mut self, f: usize, b: &ast::Block) -> Vec<Value> {
        b.stmts
            .iter()
            .map(|n| {
                let mut v = self.stmt(f, &n.item);
                // a statement ends at its `;`, where it has one
                if let Some(end) = v["span"][1].as_u64() {
                    let src = &self.c.files[f].src;
                    let rest = &src[end as usize..];
                    let gap = rest.len() - rest.trim_start_matches([' ', '\t']).len();
                    if rest[gap..].starts_with(';') {
                        v["span"][1] = json!(end as usize + gap + 1);
                    }
                }
                if let (Value::Object(o), Some(c)) = (&mut v, comments_of(&n.leading, &n.trailing)) {
                    o.insert("comments".into(), c);
                }
                v
            })
            .collect()
    }

    fn stmt(&mut self, f: usize, s: &Stmt) -> Value {
        let sp = stmt_span(s);
        let (key, value) = match s {
            Stmt::Let(v) => ("let", self.var(f, v, false, None)),
            Stmt::Mut(v) => ("mut", self.var(f, v, true, None)),
            Stmt::Return(e) => ("return", match e {
                Some(e) => json!({ "value": self.expr(f, e) }),
                None => json!({}),
            }),
            Stmt::Invoke { name, args } => ("invoke", json!({ "event": name.name, "args": args.items.iter().map(|a| self.expr(f, &a.item.value)).collect::<Vec<_>>() })),
            Stmt::If(i) => {
                let branches: Vec<Value> = i
                    .branches
                    .iter()
                    .map(|(c, b)| {
                        let mut bo = Map::new();
                        match c {
                            ast::Cond::Expr(e) => {
                                bo.insert("cond".into(), self.expr(f, e));
                            }
                            ast::Cond::Open { mutable, name, ty, value } => {
                                let v = ast::Var { name: name.clone(), ty: ty.clone(), value: value.clone() };
                                bo.insert("opens".into(), self.var(f, &v, *mutable, None));
                            }
                        }
                        bo.insert("body".into(), json!(self.stmts(f, b)));
                        Value::Object(bo)
                    })
                    .collect();
                let mut io = Map::new();
                io.insert("branches".into(), json!(branches));
                if let Some(o) = &i.otherwise {
                    io.insert("else".into(), json!(self.stmts(f, o)));
                }
                ("if", Value::Object(io))
            }
            Stmt::For(fo) => {
                let mut o = Map::new();
                o.insert("name".into(), json!(fo.name.name));
                if let Some(k) = &fo.key {
                    o.insert("key".into(), json!(k.name));
                }
                if fo.mutable {
                    o.insert("mutable".into(), json!(true));
                }
                o.insert("over".into(), self.expr(f, &fo.over));
                o.insert("body".into(), json!(self.stmts(f, &fo.body)));
                ("for", Value::Object(o))
            }
            Stmt::Match(m) => {
                let cases: Vec<Value> = m.cases.items.iter().map(|c| json!({ "patterns": c.item.patterns.iter().map(|p| self.pattern(f, p)).collect::<Vec<_>>(), "body": self.stmts(f, &c.item.body), "span": span(c.item.span) })).collect();
                ("match", json!({ "subject": self.expr(f, &m.subject), "cases": cases }))
            }
            Stmt::Expr(Expr { kind: ExprKind::View(v), .. }) => ("use", self.use_(f, v)),
            Stmt::Expr(e) => ("expr", self.expr(f, e)),
            Stmt::Assign { place, value } => ("set", json!({ "place": self.expr(f, place), "value": self.expr(f, value) })),
        };
        json!({ key: value, "span": span(sp) })
    }

    fn pattern(&mut self, f: usize, p: &ast::Pattern) -> Value {
        match p {
            ast::Pattern::Case { ty, case, binds } => {
                let mut c = Map::new();
                c.insert("enum".into(), json!(self.type_full(f, &ty.name).unwrap_or_else(|| ty.name.clone())));
                c.insert("name".into(), json!(case.name));
                if let Some(b) = binds {
                    c.insert("binds".into(), json!(b.iter().map(|i| i.name.clone()).collect::<Vec<_>>()));
                }
                json!({ "case": c })
            }
            ast::Pattern::Number { negative, text, .. } => json!({ "num": if *negative { format!("-{}", text) } else { text.clone() } }),
            ast::Pattern::Text(t) => json!({ "text": text_of(t) }),
            ast::Pattern::Bool(b, _) => json!({ "bool": b }),
        }
    }

    // ---- uses

    fn use_(&mut self, f: usize, v: &ast::ViewCall) -> Value {
        let widget = match self.refs.get(&(f, v.name.span.start, v.name.span.end)) {
            Some(RefTarget::Decl(d)) => Some(*d),
            _ => None,
        };
        let full = widget.map(|d| self.c.defs[d].full.clone()).unwrap_or_else(|| v.name.name.clone());
        let mut args = Vec::new();
        let mut slots = Vec::new();
        for a in v.args.iter().flat_map(|g| g.items.iter()) {
            args.push(self.named(f, a.item.name.as_ref(), &a.item.value, Some(&full), a));
        }
        match &v.block {
            Some(ast::CallBlock::Children(b)) => {
                let slot = widget.and_then(|d| self.only_slot(d)).unwrap_or_default();
                slots.push(json!({ "slot": format!("{}.{}", full, slot), "view": self.stmts(f, b), "span": span(b.span) }));
            }
            Some(ast::CallBlock::Named(body)) => {
                for e in &body.items {
                    match &e.item {
                        ast::NamedEntry::Input { name, value } => args.push(self.named(f, Some(name), value, Some(&full), e)),
                        ast::NamedEntry::Slot { name, block } => slots.push(json!({ "slot": format!("{}.{}", full, name.name), "view": self.stmts(f, block), "span": span(name.span.to(block.span)) })),
                    }
                }
            }
            None => {}
        }
        let mut o = Map::new();
        o.insert("widget".into(), json!(full));
        o.insert("name_span".into(), span(v.name.span));
        o.insert("args".into(), json!(args));
        if !slots.is_empty() {
            o.insert("slots".into(), json!(slots));
        }
        o.insert("span".into(), span(v.span));
        Value::Object(o)
    }

    fn only_slot(&self, d: usize) -> Option<String> {
        match &self.c.defs[d].kind {
            DefKind::Widget { slots, .. } if slots.len() == 1 => Some(slots[0].name.clone()),
            _ => None,
        }
    }

    /// A named argument: of a use (`owner` is the widget), a record's field, or a migration's.
    fn named<T>(&mut self, f: usize, name: Option<&ast::Ident>, value: &Expr, owner: Option<&str>, n: &ast::Node<T>) -> Value {
        let mut o = Map::new();
        let nm = name.map(|i| i.name.clone()).unwrap_or_default();
        o.insert("name".into(), json!(nm));
        if let (Some(owner), Some(_)) = (owner, name) {
            o.insert("target".into(), json!(format!("{}.{}", owner, nm)));
        }
        if let Some(i) = name {
            o.insert("name_span".into(), span(i.span));
        }
        o.insert("value".into(), self.expr(f, value));
        let sp = name.map_or(value.span, |i| i.span.to(value.span));
        node_parts(&mut o, sp, n);
        Value::Object(o)
    }

    // ---- expressions

    fn expr(&mut self, f: usize, e: &Expr) -> Value {
        let mut o = Map::new();
        let (key, value) = self.expr_kind(f, e);
        o.insert(key.into(), value);
        if let Some((t, _)) = self.typed.get(&(f, e.span.start, e.span.end)).cloned() {
            if !matches!(t, Ty::Err | Ty::Var(_)) {
                let t = self.c.vars.resolve(&t);
                o.insert("type".into(), json!(self.c.ir_ty(&t)));
            }
        }
        o.insert("span".into(), span(e.span));
        Value::Object(o)
    }

    fn expr_kind(&mut self, f: usize, e: &Expr) -> (&'static str, Value) {
        match &e.kind {
            ExprKind::Number(n) => ("num", json!(n)),
            ExprKind::Duration(d) => ("duration", json!(d)),
            ExprKind::Bool(b) => ("bool", json!(b)),
            ExprKind::Text(t) if !t.has_holes() => ("text", json!(text_of(t))),
            ExprKind::Text(t) => {
                let mut pieces = vec![String::new()];
                let mut holes = Vec::new();
                for p in &t.parts {
                    match p {
                        ast::TextPart::Piece { raw, .. } => pieces.last_mut().unwrap().push_str(&unescape(raw)),
                        ast::TextPart::Hole(h) => {
                            holes.push(self.expr(f, h));
                            pieces.push(String::new());
                        }
                    }
                }
                ("template", json!({ "pieces": pieces, "holes": holes }))
            }
            ExprKind::SelfValue => ("get", json!({ "self": true })),
            ExprKind::State => ("get", json!({ "state": "" })),
            ExprKind::Name(n) => ("get", self.get(f, e, n)),
            ExprKind::Paren(x) => self.expr_kind(f, x),
            ExprKind::List(g) => ("list", json!(g.items.iter().map(|x| self.expr(f, &x.item)).collect::<Vec<_>>())),
            ExprKind::Record { ty, inits } => {
                let of = ty.as_ref().and_then(|t| self.target_at(f, t.span));
                let fields: Vec<Value> = inits.items.iter().map(|i| self.named(f, Some(&i.item.name), &i.item.value, of.as_deref(), i)).collect();
                let mut r = Map::new();
                if let Some(of) = of {
                    r.insert("of".into(), json!(of));
                }
                r.insert("fields".into(), json!(fields));
                ("record", Value::Object(r))
            }
            ExprKind::Field { target, name } => {
                if let ExprKind::State = target.kind {
                    return ("get", json!({ "state": name.name, "name_span": span(name.span) }));
                }
                if let ExprKind::Name(tn) = &target.kind {
                    if let Some(ch) = self.channel_full(f, &tn.name) {
                        if !self.typed.contains_key(&(f, target.span.start, target.span.end)) {
                            return ("get", json!({ "extern": format!("{}.{}", ch, name.name), "name_span": span(name.span) }));
                        }
                    }
                }
                let mut fo = Map::new();
                fo.insert("of".into(), self.expr(f, target));
                fo.insert("field".into(), json!(name.name));
                if let Some(RefTarget::Member(d, m)) = self.refs.get(&(f, name.span.start, name.span.end)).cloned() {
                    fo.insert("member".into(), json!(format!("{}.{}", self.c.defs[d].full, m)));
                }
                fo.insert("name_span".into(), span(name.span));
                ("field", Value::Object(fo))
            }
            ExprKind::Case { target, name, args } => {
                if let ExprKind::Name(tn) = &target.kind {
                    if tn.name == "opt" && name.name == "NONE" {
                        return ("none", json!({}));
                    }
                    if tn.name == "opt" && name.name == "SOME" {
                        if let Some(a) = args.as_ref().and_then(|g| g.items.first()) {
                            return ("some", self.expr(f, &a.item.value));
                        }
                    }
                }
                let of = self.target_at(f, target.span).unwrap_or_default();
                let mut co = Map::new();
                co.insert("of".into(), json!(of));
                co.insert("case".into(), json!(name.name));
                co.insert("case_span".into(), span(name.span));
                if let Some(g) = args {
                    co.insert("args".into(), json!(g.items.iter().map(|a| self.expr(f, &a.item.value)).collect::<Vec<_>>()));
                }
                ("case", Value::Object(co))
            }
            ExprKind::Index { target, index } => ("index", json!({ "of": self.expr(f, target), "index": self.expr(f, index) })),
            ExprKind::Call { callee, args } => {
                let call_args: Vec<Value> = args.items.iter().map(|a| self.expr(f, &a.item.value)).collect();
                match &callee.kind {
                    ExprKind::Name(n) => {
                        if let Some(RefTarget::Fn(fid)) = self.refs.get(&(f, n.span.start, n.span.end)).cloned() {
                            return ("call", json!({ "fn": self.c.fns[fid].full, "args": call_args, "name_span": span(n.span) }));
                        }
                    }
                    ExprKind::Field { target, name } => {
                        if let Some(RefTarget::Fn(fid)) = self.refs.get(&(f, name.span.start, name.span.end)).cloned() {
                            let mut co = Map::new();
                            co.insert("fn".into(), json!(self.c.fns[fid].full));
                            // a fn called on a value has it as self; one called on a type has none
                            if self.typed.contains_key(&(f, target.span.start, target.span.end)) {
                                co.insert("self".into(), self.expr(f, target));
                            }
                            co.insert("args".into(), json!(call_args));
                            co.insert("name_span".into(), span(name.span));
                            return ("call", Value::Object(co));
                        }
                    }
                    _ => {}
                }
                ("apply", json!({ "fn": self.expr(f, callee), "args": call_args }))
            }
            ExprKind::With { target, inits } => {
                let of = self.typed.get(&(f, target.span.start, target.span.end)).and_then(|(t, _)| if let Ty::Def(d, _) = t { Some(self.c.defs[*d].full.clone()) } else { None });
                let fields: Vec<Value> = inits.items.iter().map(|i| self.named(f, Some(&i.item.name), &i.item.value, of.as_deref(), i)).collect();
                ("with", json!({ "of": self.expr(f, target), "fields": fields }))
            }
            ExprKind::Unary { op, operand } => ("op", json!({ "op": match op { ast::UnOp::Not => "!", ast::UnOp::Neg => "-" }, "args": [self.expr(f, operand)] })),
            ExprKind::Binary { op, left, right } => ("op", json!({ "op": bin_symbol(*op), "args": [self.expr(f, left), self.expr(f, right)] })),
            ExprKind::Ternary { cond, then, otherwise } => ("pick", json!({ "cond": self.expr(f, cond), "then": self.expr(f, then), "else": self.expr(f, otherwise) })),
            ExprKind::Range { low, high, step } => {
                let mut r = Map::new();
                if let Some(l) = low {
                    r.insert("low".into(), self.expr(f, l));
                }
                if let Some(h) = high {
                    r.insert("high".into(), self.expr(f, h));
                }
                if let Some(s) = step {
                    r.insert("step".into(), self.expr(f, s));
                }
                ("range", Value::Object(r))
            }
            ExprKind::Try(x) => ("try", self.expr(f, x)),
            ExprKind::Lambda(l) => {
                let params: Vec<Value> = l.params.items.iter().map(|p| self.param(f, &p.item, p)).collect();
                let mut lo = Map::new();
                lo.insert("params".into(), json!(params));
                if let Some(ast::RetType::Type(t)) = &l.ret {
                    lo.insert("returns".into(), json!(self.ty_of_ast(f, t)));
                }
                lo.insert("body".into(), json!(self.stmts(f, &l.body)));
                ("lambda", Value::Object(lo))
            }
            ExprKind::View(v) => ("use", self.use_(f, v)),
        }
    }

    /// What a name is, from what it compiled to.
    fn get(&mut self, f: usize, e: &Expr, n: &ast::Ident) -> Value {
        let compiled = self.typed.get(&(f, e.span.start, e.span.end)).map(|(_, x)| x.clone());
        let mut o = Map::new();
        match compiled {
            Some(ir::Expr::Get(g)) => match g {
                ir::Get::Local(l) => {
                    o.insert("local".into(), json!(l));
                }
                ir::Get::Input(i) => {
                    o.insert("input".into(), json!(i));
                }
                ir::Get::Cell(c) => {
                    o.insert("own".into(), json!(c));
                }
                ir::Get::State(s) => {
                    o.insert("state".into(), json!(s));
                }
                ir::Get::Let(l) => {
                    o.insert("let".into(), json!(l));
                }
                ir::Get::Slot(s) => {
                    o.insert("slot".into(), json!(s));
                }
                ir::Get::Extern(x) => {
                    o.insert("extern".into(), json!(x));
                }
                _ => {
                    o.insert("local".into(), json!(n.name));
                }
            },
            _ => {
                o.insert("local".into(), json!(n.name));
            }
        }
        o.insert("name_span".into(), span(n.span));
        Value::Object(o)
    }

    // ---- prose

    fn prose(&mut self, f: usize, p: &ast::Prose) -> Vec<Value> {
        let src = self.c.files[f].src.clone();
        let mut out = Vec::new();
        let mut run: Vec<&ast::TextLine> = Vec::new();
        let flush = |w: &mut Self, run: &mut Vec<&ast::TextLine>, out: &mut Vec<Value>| {
            // blank lines around a run are the layout's, not the run's
            let blank = |l: &&ast::TextLine| l.holes.is_empty() && src[l.span.range()].trim().is_empty();
            while run.last().map_or(false, blank) {
                run.pop();
            }
            let lead = run.iter().take_while(|l| blank(l)).count();
            run.drain(..lead);
            if run.is_empty() {
                return;
            }
            let mut text = String::new();
            let mut holes = Vec::new();
            for (k, line) in run.iter().enumerate() {
                if k > 0 {
                    text.push('\n');
                }
                let mut at = line.span.start as usize;
                for h in &line.holes {
                    text.push_str(&src[at..h.span.start as usize]);
                    text.push('\u{fffc}');
                    holes.push(w.expr(f, &h.expr));
                    at = h.span.end as usize;
                }
                text.push_str(&src[at..line.span.end as usize]);
            }
            let sp = run[0].span.to(run[run.len() - 1].span);
            out.push(json!({ "markdown": { "markdown": text, "holes": holes }, "span": span(sp) }));
            run.clear();
        };
        for n in &p.nodes {
            match n {
                ast::ProseNode::Text(l) => run.push(l),
                ast::ProseNode::Fence(ls) | ast::ProseNode::Maths(ls) => run.extend(ls.iter()),
                other => {
                    flush(self, &mut run, &mut out);
                    out.push(self.prose_node(f, other));
                }
            }
        }
        flush(self, &mut run, &mut out);
        out
    }

    fn prose_node(&mut self, f: usize, n: &ast::ProseNode) -> Value {
        match n {
            ast::ProseNode::Call(c) => {
                let mut u = self.use_(f, &c.call);
                if let Some((body, _)) = &c.block {
                    let widget = match self.refs.get(&(f, c.call.name.span.start, c.call.name.span.end)) {
                        Some(RefTarget::Decl(d)) => Some(*d),
                        _ => None,
                    };
                    let full = u["widget"].as_str().unwrap_or("").to_string();
                    // a named slot's prose is its own; the rest is the one slot's
                    let mut slots: Vec<Value> = Vec::new();
                    let mut rest = ast::Prose { nodes: Vec::new() };
                    for node in &body.nodes {
                        if let ast::ProseNode::Slot { name, body: sb, span: sp, .. } = node {
                            slots.push(json!({ "slot": format!("{}.{}", full, name.name), "prose": self.prose(f, sb), "span": span(*sp) }));
                        } else {
                            rest.nodes.push(node.clone());
                        }
                    }
                    if !rest.nodes.is_empty() {
                        let slot = widget.and_then(|d| self.only_slot(d)).unwrap_or_default();
                        slots.insert(0, json!({ "slot": format!("{}.{}", full, slot), "prose": self.prose(f, &rest), "span": span(c.span) }));
                    }
                    if !slots.is_empty() {
                        u["slots"] = json!(slots);
                    }
                }
                json!({ "call": u, "span": span(c.span) })
            }
            ast::ProseNode::If { branches, otherwise, span: sp, .. } => {
                let bs: Vec<Value> = branches
                    .iter()
                    .map(|(c, body, _)| {
                        let mut bo = Map::new();
                        match c {
                            ast::Cond::Expr(e) => {
                                bo.insert("cond".into(), self.expr(f, e));
                            }
                            ast::Cond::Open { mutable, name, ty, value } => {
                                let v = ast::Var { name: name.clone(), ty: ty.clone(), value: value.clone() };
                                bo.insert("opens".into(), self.var(f, &v, *mutable, None));
                            }
                        }
                        bo.insert("prose".into(), json!(self.prose(f, body)));
                        Value::Object(bo)
                    })
                    .collect();
                let mut io = Map::new();
                io.insert("branches".into(), json!(bs));
                if let Some((o, _)) = otherwise {
                    io.insert("else".into(), json!(self.prose(f, o)));
                }
                json!({ "if": io, "span": span(*sp) })
            }
            ast::ProseNode::For { mutable, key, name, over, body, span: sp, .. } => {
                let mut o = Map::new();
                o.insert("name".into(), json!(name.name));
                if let Some(k) = key {
                    o.insert("key".into(), json!(k.name));
                }
                if *mutable {
                    o.insert("mutable".into(), json!(true));
                }
                o.insert("over".into(), self.expr(f, over));
                o.insert("prose".into(), json!(self.prose(f, body)));
                json!({ "for": o, "span": span(*sp) })
            }
            ast::ProseNode::Match { subject, cases, span: sp, .. } => {
                let cs: Vec<Value> = cases.iter().map(|c| json!({ "patterns": c.patterns.iter().map(|p| self.pattern(f, p)).collect::<Vec<_>>(), "prose": self.prose(f, &c.body), "span": span(c.span) })).collect();
                json!({ "match": { "subject": self.expr(f, subject), "cases": cs }, "span": span(*sp) })
            }
            ast::ProseNode::Slot { name, body, span: sp, .. } => json!({ "slot": { "slot": name.name, "prose": self.prose(f, body) }, "span": span(*sp) }),
            ast::ProseNode::Comment { span: sp, .. } => {
                let text = self.c.files[f].src[sp.range()].trim().to_string();
                json!({ "comment": text, "span": span(*sp) })
            }
            ast::ProseNode::Text(_) | ast::ProseNode::Fence(_) | ast::ProseNode::Maths(_) => Value::Null,
        }
    }

    // ---- names

    fn target_at(&self, f: usize, at: Span) -> Option<String> {
        match self.refs.get(&(f, at.start, at.end))? {
            RefTarget::Decl(d) => Some(self.c.defs[*d].full.clone()),
            RefTarget::Member(d, m) | RefTarget::Case(d, m) => Some(format!("{}.{}", self.c.defs[*d].full, m)),
            RefTarget::Fn(x) => Some(self.c.fns[*x].full.clone()),
        }
    }

    fn def_at(&self, f: usize, at: Span) -> Option<usize> {
        self.c.defs.iter().position(|d| d.file == f && d.span == at)
    }

    fn fn_id(&self, f: usize, s: &ast::FnSig) -> Option<String> {
        self.c.fns.iter().find(|x| x.file == f && x.span == s.name.span).map(|x| x.full.clone())
    }

    fn type_full(&self, f: usize, name: &str) -> Option<String> {
        match self.c.lookup_type(f, name)? {
            TypeSym::Def(d) => Some(self.c.defs[d].full.clone()),
            TypeSym::Builtin(b) => Some(b.to_string()),
        }
    }

    fn channel_full(&self, f: usize, name: &str) -> Option<String> {
        match self.c.lookup_value(f, name)? {
            crate::ValueSym::Channel(c) => Some(self.c.channels[c].full.clone()),
            _ => None,
        }
    }

    fn ty_of_ast(&mut self, f: usize, t: &ast::Type) -> ir::Type {
        // the checker's own reading of a type written in this file
        let before = self.c.diags.len();
        let generics: Vec<String> = Vec::new();
        let x = self.c.ir_type(f, t, &generics);
        self.c.diags.truncate(before);
        x
    }
}

// ---- small helpers

fn span(s: Span) -> Value {
    json!([s.start, s.end])
}

fn node_parts<T>(o: &mut Map<String, Value>, sp: Span, n: &ast::Node<T>) {
    o.insert("span".into(), span(sp));
    if let Some(c) = comments_of(&n.leading, &n.trailing) {
        o.insert("comments".into(), c);
    }
}

/// The comments before a node and after it, its doc comments left to `doc`.
fn comments_of(leading: &[ast::Leading], trailing: &[xtmd_syntax::lexer::Comment]) -> Option<Value> {
    let before: Vec<String> = leading.iter().filter_map(|l| if let ast::Leading::Comment(c) = l { (!c.is_doc()).then(|| c.text.clone()) } else { None }).collect();
    let after: Vec<String> = trailing.iter().map(|c| c.text.clone()).collect();
    if before.is_empty() && after.is_empty() {
        return None;
    }
    let mut o = Map::new();
    if !before.is_empty() {
        o.insert("before".into(), json!(before));
    }
    if !after.is_empty() {
        o.insert("after".into(), json!(after));
    }
    Some(Value::Object(o))
}

fn leading_comments(leading: &[ast::Leading]) -> Vec<String> {
    leading.iter().filter_map(|l| if let ast::Leading::Comment(c) = l { Some(c.text.clone()) } else { None }).collect()
}

/// `//@about`, `//@param name …` and `//@deprecated` above a declaration.
fn doc_of(leading: &[ast::Leading]) -> Map<String, Value> {
    let mut o = Map::new();
    let mut params = Map::new();
    for l in leading {
        let ast::Leading::Comment(c) = l else { continue };
        if let Some(t) = c.text.strip_prefix("//@about") {
            o.insert("about".into(), json!(t.trim()));
        } else if let Some(t) = c.text.strip_prefix("//@deprecated") {
            o.insert("deprecated".into(), json!(t.trim()));
        } else if let Some(t) = c.text.strip_prefix("//@param") {
            let t = t.trim();
            let (name, rest) = t.split_once(' ').unwrap_or((t, ""));
            params.insert(name.to_string(), json!(rest.trim()));
        }
    }
    if !params.is_empty() {
        o.insert("params".into(), Value::Object(params));
    }
    o
}

fn text_of(t: &ast::TextLit) -> String {
    t.parts.iter().map(|p| if let ast::TextPart::Piece { raw, .. } = p { unescape(raw) } else { String::new() }).collect()
}

/// A text's characters: its escapes read.
fn unescape(raw: &str) -> String {
    let mut out = String::new();
    let mut cs = raw.chars().peekable();
    while let Some(c) = cs.next() {
        if c != '\\' {
            out.push(c);
            continue;
        }
        match cs.next() {
            Some('n') => out.push('\n'),
            Some('t') => out.push('\t'),
            Some('u') if cs.peek() == Some(&'{') => {
                cs.next();
                let hex: String = cs.by_ref().take_while(|c| *c != '}').collect();
                if let Some(ch) = u32::from_str_radix(&hex, 16).ok().and_then(char::from_u32) {
                    out.push(ch);
                }
            }
            Some(other) => out.push(other),
            None => out.push('\\'),
        }
    }
    out
}

fn bin_symbol(op: ast::BinOp) -> &'static str {
    use ast::BinOp as B;
    match op {
        B::Or => "||",
        B::And => "&&",
        B::Eq => "==",
        B::Ne => "!=",
        B::Lt => "<",
        B::Le => "<=",
        B::Gt => ">",
        B::Ge => ">=",
        B::In => "in",
        B::Add => "+",
        B::Sub => "-",
        B::Mul => "*",
        B::Div => "/",
        B::Rem => "%",
    }
}

fn stmt_span(s: &Stmt) -> Span {
    match s {
        Stmt::Let(v) | Stmt::Mut(v) => v.name.span.to(v.value.span),
        Stmt::Return(Some(e)) | Stmt::Expr(e) => e.span,
        Stmt::Return(None) => Span::default(),
        Stmt::Invoke { name, args } => name.span.to(args.span),
        Stmt::If(i) => {
            let first = i.branches.first().map(|(_, b)| b.span).unwrap_or_default();
            let last = i.otherwise.as_ref().map(|b| b.span).or_else(|| i.branches.last().map(|(_, b)| b.span)).unwrap_or_default();
            first.to(last)
        }
        Stmt::For(f) => f.name.span.to(f.body.span),
        Stmt::Match(m) => m.span.to(m.cases.span),
        Stmt::Assign { place, value } => place.span.to(value.span),
    }
}

/// SHA-256, for the hash that names a file's source.
pub fn sha256_hex(data: &[u8]) -> String {
    const K: [u32; 64] = [
        0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1, 0x923f82a4, 0xab1c5ed5, 0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3, 0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174, 0xe49b69c1, 0xefbe4786, 0x0fc19dc6, 0x240ca1cc, 0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da, 0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7, 0xc6e00bf3, 0xd5a79147, 0x06ca6351, 0x14292967, 0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13, 0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85,
        0xa2bfe8a1, 0xa81a664b, 0xc24b8b70, 0xc76c51a3, 0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070, 0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a, 0x5b9cca4f, 0x682e6ff3, 0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208, 0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2,
    ];
    let mut h: [u32; 8] = [0x6a09e667, 0xbb67ae85, 0x3c6ef372, 0xa54ff53a, 0x510e527f, 0x9b05688c, 0x1f83d9ab, 0x5be0cd19];
    let mut msg = data.to_vec();
    let bits = (data.len() as u64).wrapping_mul(8);
    msg.push(0x80);
    while msg.len() % 64 != 56 {
        msg.push(0);
    }
    msg.extend_from_slice(&bits.to_be_bytes());
    for chunk in msg.chunks(64) {
        let mut w = [0u32; 64];
        for i in 0..16 {
            w[i] = u32::from_be_bytes([chunk[4 * i], chunk[4 * i + 1], chunk[4 * i + 2], chunk[4 * i + 3]]);
        }
        for i in 16..64 {
            let s0 = w[i - 15].rotate_right(7) ^ w[i - 15].rotate_right(18) ^ (w[i - 15] >> 3);
            let s1 = w[i - 2].rotate_right(17) ^ w[i - 2].rotate_right(19) ^ (w[i - 2] >> 10);
            w[i] = w[i - 16].wrapping_add(s0).wrapping_add(w[i - 7]).wrapping_add(s1);
        }
        let mut v = h;
        for i in 0..64 {
            let s1 = v[4].rotate_right(6) ^ v[4].rotate_right(11) ^ v[4].rotate_right(25);
            let ch = (v[4] & v[5]) ^ (!v[4] & v[6]);
            let t1 = v[7].wrapping_add(s1).wrapping_add(ch).wrapping_add(K[i]).wrapping_add(w[i]);
            let s0 = v[0].rotate_right(2) ^ v[0].rotate_right(13) ^ v[0].rotate_right(22);
            let maj = (v[0] & v[1]) ^ (v[0] & v[2]) ^ (v[1] & v[2]);
            let t2 = s0.wrapping_add(maj);
            v = [t1.wrapping_add(t2), v[0], v[1], v[2], v[3].wrapping_add(t1), v[4], v[5], v[6]];
        }
        for i in 0..8 {
            h[i] = h[i].wrapping_add(v[i]);
        }
    }
    h.iter().map(|x| format!("{:08x}", x)).collect()
}
