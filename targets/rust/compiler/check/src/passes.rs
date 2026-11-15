//! The bodies of every declaration, then the constants worked out by the evaluator.

use crate::body::{Cx, Local, LocalKind, LITERAL_MARK};
use crate::ty::Ty;
use crate::*;
use mkp_eval::{interp::Constants, FailKind, Machine, Program};

impl Checker {
    pub(crate) fn bodies(&mut self) {
        // fns, written in MKP or extern with a default
        let fns_end = self.fns.len();
        for f in self.from.fns..fns_end {
            let s = self.fns[f].clone();
            if s.widget.is_some() {
                continue;
            }
            let Some(body) = &s.body else { continue };
            let mut cx = Cx::new(s.file);
            cx.generics = s.generics.iter().map(|g| g.name.clone()).collect();
            cx.bounds = s.generics.clone();
            cx.ret = Some(s.ret.clone());
            cx.push();
            for p in &s.params {
                cx.scopes.last_mut().unwrap().push(Local { name: p.name.clone(), ty: p.ty.clone(), mutable: p.mutable, kind: LocalKind::Plain });
            }
            let b = self.block(&mut cx, body);
            self.out.fn_bodies.insert(f, b);
        }
        // records: defaults and rules; enums have neither
        for d in self.from.defs..self.defs.len() {
            let file = self.defs[d].file;
            let generics: Vec<String> = self.defs[d].generics.iter().map(|g| g.name.clone()).collect();
            match self.defs[d].kind.clone() {
                DefKind::Record { fields } => {
                    for fl in &fields {
                        if let Some(def) = &fl.default {
                            let mut cx = Cx::new(file);
                            cx.generics = generics.clone();
                            cx.bounds = self.defs[d].generics.clone();
                            let (x, _) = self.expr(&mut cx, def, Some(&fl.ty));
                            self.out.defaults.insert((d, fl.name.clone()), x);
                        }
                    }
                    let ast::DeclKind::Record(r) = self.decl_of(d) else { continue };
                    let mut rules = Vec::new();
                    for m in r.members.iter() {
                        if let ast::Member::Require(req) = m {
                            let mut cx = Cx::new(file);
                            cx.generics = generics.clone();
                            cx.bounds = self.defs[d].generics.clone();
                            cx.ret = Some(Some(Ty::Bool));
                            cx.push();
                            for fl in &fields {
                                cx.scopes.last_mut().unwrap().push(Local { name: fl.name.clone(), ty: fl.ty.clone(), mutable: false, kind: LocalKind::Plain });
                            }
                            let b = self.block(&mut cx, &req.body);
                            rules.push(ir::Require { message: text_of(&req.message), reads: Vec::new(), body: b });
                        }
                    }
                    self.out.requires.insert(d, rules);
                }
                DefKind::Widget { .. } => self.widget(d),
                _ => {}
            }
        }
        // tokens blocks
        for (d, case, file, value) in self.token_values.clone().into_iter().skip(self.from.tokens) {
            let DefKind::Token { value: vt, cases, .. } = self.defs[d].kind.clone() else { continue };
            let mut cx = Cx::new(file);
            let carrying = cases.iter().find(|c| c.name == case).map_or(false, |c| !c.fields.is_empty());
            if carrying {
                self.error(file, codes::MISMATCH, value.span, format!("`{}.{}` carries its value, so it needs no line in a tokens block", self.defs[d].name, case));
                continue;
            }
            let (x, _) = self.expr(&mut cx, &value, Some(&vt));
            self.out.token_values.insert((d, case), x);
        }
        // extern channels: their values' defaults
        for c in self.from.channels..self.channels.len() {
            let file = self.channels[c].file;
            for v in self.channels[c].values.clone() {
                if let Some(def) = &v.default {
                    let mut cx = Cx::new(file);
                    let (x, _) = self.expr(&mut cx, def, Some(&v.ty));
                    self.out.channel_defaults.insert((c, v.name.clone()), x);
                }
            }
        }
        // lets
        for l in self.from.lets..self.lets.len() {
            let s = self.lets[l].clone();
            let mut cx = Cx::new(s.file);
            cx.state = self.state_fields();
            let (x, _) = self.expr(&mut cx, &s.value, Some(&s.ty));
            self.out.let_values.insert(l, x);
        }
        self.state_and_expose();
        self.document();
        self.constants();
    }

    /// The document's prose: its own template, `doc`.
    fn document(&mut self) {
        let Some(file) = (0..self.files.len()).find(|f| self.files[*f].ast.prose.is_some()) else { return };
        let ast = self.files[file].ast.clone();
        let mut cx = Cx::new(file);
        cx.state = self.state_fields();
        let nodes = self.prose_nodes(&mut cx, ast.prose.as_ref().unwrap());
        self.out.doc = Some(ir::Template {
            name: "doc".into(),
            generics: Vec::new(),
            inputs: Vec::new(),
            slots: Vec::new(),
            events: Vec::new(),
            cells: Vec::new(),
            requires: Vec::new(),
            fns: Vec::new(),
            view: nodes.clone(),
            markdown: nodes,
            level: ir::Level::CoreLive,
        });
    }

    pub(crate) fn state_fields(&mut self) -> Option<Vec<(String, Ty)>> {
        let (file, s) = self.state.clone()?;
        let mut out = Vec::new();
        for m in s.members.iter() {
            if let ast::Member::Field(f) = m {
                out.push((f.name.name.clone(), self.resolve(file, &f.ty, &[])));
            }
        }
        Some(out)
    }

    fn state_and_expose(&mut self) {
        let fields = self.state_fields();
        if let Some((file, s)) = self.state.clone() {
            let mut irf = Vec::new();
            let mut rules = Vec::new();
            for m in s.members.iter() {
                match m {
                    ast::Member::Field(f) => {
                        let t = self.resolve(file, &f.ty, &[]);
                        let ti = self.ir_type(file, &f.ty, &[]);
                        let mut cx = Cx::new(file);
                        let d = f.default.as_ref().map(|e| self.expr(&mut cx, e, Some(&t)).0);
                        irf.push(ir::Field { name: f.name.name.clone(), ty: ti, mutable: false, default: d });
                    }
                    ast::Member::Require(r) => {
                        let mut cx = Cx::new(file);
                        cx.state = fields.clone();
                        cx.state_rules = true;
                        cx.ret = Some(Some(Ty::Bool));
                        let b = self.block(&mut cx, &r.body);
                        rules.push(ir::Require { message: text_of(&r.message), reads: Vec::new(), body: b });
                    }
                }
            }
            self.out.state = Some(ir::State { fields: irf, requires: rules });
        }
        for (file, e) in self.exposes.clone() {
            let channel = match self.lookup_value(file, &e.name.name) {
                Some(ValueSym::Channel(c)) => self.channels[c].full.clone(),
                _ => format!("{}/{}", self.files[file].pack, e.name.name),
            };
            let mut fns = Vec::new();
            for f in e.fns.iter() {
                let mut cx = Cx::new(file);
                cx.state = fields.clone();
                cx.ret = Some(None);
                cx.push();
                let ps = self.params(file, &f.sig.params, &[], &Ty::Err, &ir::Type::named("T"));
                for p in &ps {
                    cx.scopes.last_mut().unwrap().push(Local { name: p.name.clone(), ty: p.ty.clone(), mutable: false, kind: LocalKind::Plain });
                }
                let body = f.body.as_ref().map(|b| self.block(&mut cx, b)).unwrap_or_default();
                fns.push(ir::ExposeFns { name: f.sig.name.name.clone(), params: ps.iter().map(|p| ir::Param { name: p.name.clone(), ty: p.ir.clone(), mutable: false }).collect(), body });
            }
            self.out.exposes.push(ir::Expose { channel, fns });
        }
    }

    /// The program so far, for the evaluator.
    pub fn program(&mut self) -> Program {
        let saved_out = self.out.clone();
        let saved_handlers = self.handlers.clone();
        let m = self.module_ir();
        self.out = saved_out;
        self.handlers = saved_handlers;
        let mut p = Program::from_module(&m);
        for (k, v) in &self.constants {
            p.lets.insert(k.clone(), v.clone());
        }
        p
    }

    /// Literals become values through their type's `from`, and constants are worked out.
    fn constants(&mut self) {
        let prog = self.program();
        // literals: `"2026-11-20"` where a date is wanted is date.from("2026-11-20"), now
        let mut errors: Vec<(usize, Span, String)> = Vec::new();
        let pending = std::mem::take(&mut self.pending);
        {
            let mut patch = |e: &mut ir::Expr| {
                let ir::Expr::Call(c) = e else { return };
                let Some(id) = c.name.strip_prefix(LITERAL_MARK).and_then(|s| s.strip_prefix('#')).and_then(|s| s.parse::<usize>().ok()) else { return };
                let inner = c.args[0].clone();
                let mut m = Machine::new(&prog, Box::new(Constants));
                match m.eval(&inner) {
                    Ok(mkp_eval::Value::Opt(Some(v))) => *e = v.to_ir(),
                    Ok(_) => {
                        let p = &pending[id];
                        let why = m.last_rule.clone().map(|r| format!(": {}", r)).unwrap_or_default();
                        errors.push((p.file, p.span, format!("this literal is not a {}{}", p.ty, why)));
                        *e = inner;
                    }
                    Err(f) if f.kind == FailKind::NotConstant => *e = inner,
                    Err(f) => {
                        let p = &pending[id];
                        errors.push((p.file, p.span, format!("working out this literal failed: {}", f.message)));
                        *e = inner;
                    }
                }
            };
            walk_out(&mut self.out, &mut patch);
            for h in &mut self.handlers {
                for s in &mut h.body {
                    walk_stmt(s, &mut patch);
                }
            }
        }
        for (file, span, msg) in errors {
            self.error(file, codes::LITERAL, span, msg);
        }
        // prose: each paragraph read by core's rich_text.read, each maths block by latex.from
        let links = links_value(&self.prose_links);
        let mut errors: Vec<(usize, Span, String)> = Vec::new();
        let mut literal_errors: Vec<(usize, Span, String)> = Vec::new();
        {
            let mut patch = |e: &mut ir::Expr| {
                let ir::Expr::Call(c) = e else { return };
                let Some(id) = c.name.strip_prefix(crate::view::PROSE_MARK).and_then(|s| s.strip_prefix('#')).and_then(|s| s.parse::<usize>().ok()) else { return };
                let ir::Expr::Template(t) = c.args[0].clone() else { return };
                let holes = t.holes.clone();
                let placeholders: Vec<mkp_eval::Value> = (0..holes.len()).map(|k| placeholder_hole(k)).collect();
                let mut m = Machine::new(&prog, Box::new(Constants));
                let tpl = match template_value(&mut m, &t.pieces, placeholders) {
                    Ok(v) => v,
                    Err(_) => return,
                };
                let p = &pending[id];
                // in code, a literal is its type's `from`; a document's prose also sees its link definitions
                let literal = p.ty.strip_prefix("literal:");
                let out = if t.ty.name == "core/rich_text" && literal.is_none() {
                    m.call("core/rich_text.read", vec![mkp_eval::Binding::Value(tpl), mkp_eval::Binding::Value(links.clone())])
                } else {
                    m.call(&format!("{}.from", t.ty.name), vec![mkp_eval::Binding::Value(tpl)])
                };
                match out {
                    Ok(Some(mkp_eval::Value::Opt(Some(v)))) => {
                        *e = if t.ty.name == "core/rich_text" { rich_ir(&v, &holes) } else { put_holes(v.to_ir(), &holes) };
                    }
                    Ok(_) => {
                        let why = m.last_rule.clone().map(|r| format!(": {}", r)).unwrap_or_default();
                        match literal {
                            Some(ty) => literal_errors.push((p.file, p.span, format!("this literal is not a {}{}", ty, why))),
                            None => errors.push((p.file, p.span, format!("this {} is refused{}", if p.ty == "latex" { "maths" } else { "text" }, why))),
                        }
                    }
                    Err(f) => errors.push((p.file, p.span, format!("reading this Markdown failed: {}", f.message))),
                }
            };
            walk_out(&mut self.out, &mut patch);
            for h in &mut self.handlers {
                for s in &mut h.body {
                    walk_stmt(s, &mut patch);
                }
            }
        }
        for (file, span, msg) in errors {
            self.error(file, codes::INLINE_REFUSED, span, msg);
        }
        for (file, span, msg) in literal_errors {
            self.error(file, codes::LITERAL, span, msg);
        }
        // constant lets, each once the ones it reads are known
        let mut prog = self.program();
        let mut left: Vec<usize> = (self.from.lets..self.lets.len()).collect();
        loop {
            let mut progress = false;
            let mut still = Vec::new();
            for l in left {
                let Some(value) = self.out.let_values.get(&l).cloned() else { continue };
                let out = {
                    let mut m = Machine::new(&prog, Box::new(Constants));
                    m.eval(&value)
                };
                match out {
                    Ok(v) => {
                        let full = self.lets[l].full.clone();
                        prog.lets.insert(full.clone(), v.clone());
                        self.constants.insert(full, v.clone());
                        self.out.let_values.insert(l, v.to_ir());
                        progress = true;
                    }
                    Err(f) if f.kind == FailKind::NotConstant => still.push(l),
                    Err(f) => {
                        let (file, span) = (self.lets[l].file, self.lets[l].span);
                        self.error(file, codes::CONSTANT, span, format!("working out `{}` failed: {}", self.lets[l].name, f.message));
                    }
                }
            }
            left = still;
            if !progress || left.is_empty() {
                break;
            }
        }
        // token values: constants, with their records' rules checked now
        for (d, case, file, src) in self.token_values.clone().into_iter().skip(self.from.tokens) {
            let Some(x) = self.out.token_values.get(&(d, case.clone())).cloned() else { continue };
            let mut m = Machine::new(&prog, Box::new(Constants));
            match m.eval(&x) {
                Ok(v) => {
                    self.out.token_values.insert((d, case), v.to_ir());
                }
                Err(f) if f.kind == FailKind::NotConstant => {}
                Err(f) => self.error(file, codes::CONSTANT, src.span, format!("`{}.{}`'s value is refused: {}", self.defs[d].name, case, f.rule.unwrap_or(f.message))),
            }
        }
        // defaults that are constants become their values
        let keys: Vec<(DefId, String)> = self.out.defaults.keys().cloned().collect();
        for k in keys {
            let x = self.out.defaults[&k].clone();
            let mut m = Machine::new(&prog, Box::new(Constants));
            match m.eval(&x) {
                Ok(v) if !matches!(v, mkp_eval::Value::Fn(_) | mkp_eval::Value::View(_)) => {
                    self.out.defaults.insert(k, v.to_ir());
                }
                Err(f) if !matches!(f.kind, FailKind::NotConstant | FailKind::Ir) => {
                    let (file, span) = self.field_span(k.0, &k.1);
                    self.error(file, codes::CONSTANT, span, format!("the default of `{}` is refused: {}", k.1, f.rule.unwrap_or(f.message)));
                }
                _ => {}
            }
        }
        let keys: Vec<(usize, String)> = self.out.channel_defaults.keys().cloned().collect();
        for k in keys {
            let x = self.out.channel_defaults[&k].clone();
            let mut m = Machine::new(&prog, Box::new(Constants));
            if let Ok(v) = m.eval(&x) {
                self.out.channel_defaults.insert(k, v.to_ir());
            }
        }
    }

    fn field_span(&self, d: DefId, name: &str) -> (usize, Span) {
        let file = self.defs[d].file;
        let span = match &self.defs[d].kind {
            DefKind::Record { fields } => fields.iter().find(|f| f.name == name).map(|f| f.span),
            DefKind::Widget { inputs, .. } => inputs.iter().find(|f| f.name == name).map(|f| f.span),
            _ => None,
        };
        (file, span.unwrap_or(self.defs[d].span))
    }
}

/// The document's link definitions as core's `map<text>`.
fn links_value(links: &[(String, String)]) -> mkp_eval::Value {
    use mkp_eval::Value;
    use std::rc::Rc;
    let entries: Vec<Value> = links
        .iter()
        .map(|(k, v)| Value::Record(Rc::new(mkp_eval::value::Record { ty: Rc::from("record"), fields: vec![(Rc::from("key"), Value::text(k)), (Rc::from("value"), Value::text(v))] })))
        .collect();
    let mut ids = 0;
    let list = Value::list(entries, &mut ids);
    Value::Record(Rc::new(mkp_eval::value::Record { ty: Rc::from("core/map"), fields: vec![(Rc::from("entries"), list)] }))
}

fn placeholder(k: usize) -> String {
    char::from_u32(0xE000 + k as u32).unwrap_or('\u{E000}').to_string()
}

fn placeholder_hole(k: usize) -> mkp_eval::Value {
    use std::rc::Rc;
    mkp_eval::Value::Case(Rc::new(mkp_eval::value::Case { ty: Rc::from("core/hole"), name: Rc::from("TEXT"), values: vec![(Rc::from("value"), mkp_eval::Value::text(&placeholder(k)))] }))
}

fn template_value(m: &mut Machine, pieces: &[String], holes: Vec<mkp_eval::Value>) -> Result<mkp_eval::Value, mkp_eval::Failure> {
    use std::rc::Rc;
    let pieces = m.make_list(pieces.iter().map(|p| mkp_eval::Value::text(p)).collect())?;
    let holes = m.make_list(holes)?;
    Ok(mkp_eval::Value::Record(Rc::new(mkp_eval::value::Record { ty: Rc::from("core/template"), fields: vec![(Rc::from("pieces"), pieces), (Rc::from("holes"), holes)] })))
}

/// Which hole a placeholder text stands for.
fn hole_of(s: &str) -> Option<usize> {
    let mut it = s.chars();
    let c = it.next()?;
    if it.next().is_none() && ('\u{E000}'..='\u{F8FF}').contains(&c) {
        Some(c as usize - 0xE000)
    } else {
        None
    }
}

/// The IR with each placeholder text replaced by its hole's expression.
fn put_holes(mut x: ir::Expr, holes: &[ir::Expr]) -> ir::Expr {
    walk_expr(&mut x, &mut |e| {
        if let ir::Expr::Text(s) = e {
            if let Some(k) = hole_of(s) {
                if let Some(h) = holes.get(k) {
                    *e = h.clone();
                }
            }
        }
    });
    x
}

/// A rich_text value as the IR's `rich` form, its holes put back as expressions.
fn rich_ir(v: &mkp_eval::Value, holes: &[ir::Expr]) -> ir::Expr {
    use mkp_eval::Value;
    use ir::SegmentSegmentPart as P;
    let mut segments = Vec::new();
    let Value::Record(r) = v else { return v.to_ir() };
    let Some(Value::List(list)) = r.get("segments") else { return v.to_ir() };
    for item in &list.items {
        let Value::Record(seg) = &item.value else { continue };
        let (Some(Value::Case(part)), Some(Value::Record(marks))) = (seg.get("part"), seg.get("marks")) else { continue };
        let get = |n: &str| part.values.iter().find(|(k, _)| &**k == n).map(|(_, x)| x.clone());
        let text = |n: &str| get(n).map(|x| x.to_ir());
        let (kind, value, src, alt) = match &*part.name {
            "TEXT" => match get("value") {
                Some(Value::Text(t)) => match hole_of(&t) {
                    Some(k) => {
                        let h = holes.get(k).cloned().unwrap_or(ir::Expr::Text(String::new()));
                        let is_view = !matches!(h, ir::Expr::Show(_) | ir::Expr::Text(_)) && !matches!(&h, ir::Expr::Get(_) | ir::Expr::Field(_) | ir::Expr::Call(_) | ir::Expr::Template(_) | ir::Expr::Op(_));
                        (if is_view { P::View } else { P::Text }, Some(h), None, None)
                    }
                    None => (P::Text, Some(ir::Expr::Text(t.to_string())), None, None),
                },
                _ => (P::Text, text("value"), None, None),
            },
            "CODE" => (P::Code, text("value"), None, None),
            "MATH" => (P::Math, get("tex").map(|x| put_holes(x.to_ir(), holes)), None, None),
            "IMAGE" => (P::Image, None, text("src"), text("alt")),
            "NOTE" => (P::Note, text("mark"), None, None),
            "VIEW" => (P::View, text("child"), None, None),
            _ => (P::Break, None, None, None),
        };
        let flag = |n: &str| matches!(marks.get(n), Some(Value::Bool(true)));
        let link = match marks.get("link") {
            Some(Value::Opt(Some(l))) => Some(l.to_ir()),
            _ => None,
        };
        let any = flag("bold") || flag("italic") || flag("strike") || link.is_some();
        let m = any.then(|| ir::Marks { bold: flag("bold"), italic: flag("italic"), strike: flag("strike"), link });
        segments.push(ir::Segment { segment: ir::SegmentSegment { part: kind, value, src, alt, marks: m } });
    }
    ir::Expr::Rich(ir::Rich { segments })
}

pub(crate) fn text_of(t: &ast::TextLit) -> String {
    t.parts.iter().map(|p| if let ast::TextPart::Piece { raw, .. } = p { mkp_syntax::lexer::decode_piece(raw) } else { String::new() }).collect()
}

fn walk_out(out: &mut decl::Out, f: &mut dyn FnMut(&mut ir::Expr)) {
    for b in out.fn_bodies.values_mut() {
        for s in b {
            walk_stmt(s, f);
        }
    }
    for x in out.let_values.values_mut() {
        walk_expr(x, f);
    }
    for rs in out.requires.values_mut() {
        for r in rs {
            for s in &mut r.body {
                walk_stmt(s, f);
            }
        }
    }
    for x in out.defaults.values_mut().chain(out.token_values.values_mut()).chain(out.channel_defaults.values_mut()).chain(out.case_defaults.values_mut()) {
        walk_expr(x, f);
    }
    if let Some(s) = &mut out.state {
        for fl in &mut s.fields {
            if let Some(d) = &mut fl.default {
                walk_expr(d, f);
            }
        }
        for r in &mut s.requires {
            for st in &mut r.body {
                walk_stmt(st, f);
            }
        }
    }
    for e in &mut out.exposes {
        for fun in &mut e.fns {
            for s in &mut fun.body {
                walk_stmt(s, f);
            }
        }
    }
    for (_, t) in &mut out.templates {
        walk_template(t, f);
    }
    if let Some(t) = &mut out.doc {
        walk_template(t, f);
    }
    for ns in out.extern_markdown.values_mut() {
        for n in ns {
            walk_node(n, f);
        }
    }
}

pub(crate) fn walk_template(t: &mut ir::Template, f: &mut dyn FnMut(&mut ir::Expr)) {
    for c in t.cells.iter_mut().chain(t.inputs.iter_mut()) {
        if let Some(d) = &mut c.default {
            walk_expr(d, f);
        }
    }
    for fun in &mut t.fns {
        for s in &mut fun.body {
            walk_stmt(s, f);
        }
    }
    for r in &mut t.requires {
        for s in &mut r.body {
            walk_stmt(s, f);
        }
    }
    for n in t.view.iter_mut().chain(t.markdown.iter_mut()) {
        walk_node(n, f);
    }
}

pub(crate) fn walk_expr(e: &mut ir::Expr, f: &mut dyn FnMut(&mut ir::Expr)) {
    use ir::Expr as X;
    match e {
        X::List(v) => v.iter_mut().for_each(|x| walk_expr(x, f)),
        X::Record(r) => r.fields.values_mut().for_each(|x| walk_expr(x, f)),
        X::Case(c) => c.values.values_mut().for_each(|x| walk_expr(x, f)),
        X::Some(x) => walk_expr(x, f),
        X::Range(r) => {
            for x in [&mut r.low, &mut r.high, &mut r.step].into_iter().flatten() {
                walk_expr(x, f);
            }
        }
        X::Tokval(t) => walk_expr(&mut t.value, f),
        X::Rich(r) => {
            for s in &mut r.segments {
                for x in [&mut s.segment.value, &mut s.segment.src, &mut s.segment.alt].into_iter().flatten() {
                    walk_expr(x, f);
                }
            }
        }
        X::Template(t) => t.holes.iter_mut().for_each(|x| walk_expr(x, f)),
        X::View(v) => {
            v.args.values_mut().for_each(|x| walk_expr(x, f));
            for ns in v.slots.values_mut() {
                ns.iter_mut().for_each(|n| walk_node(n, f));
            }
        }
        X::Field(x) => walk_expr(&mut x.value, f),
        X::Call(c) => c.args.iter_mut().for_each(|x| walk_expr(x, f)),
        X::Apply(a) => {
            walk_expr(&mut a.fn_, f);
            a.args.iter_mut().for_each(|x| walk_expr(x, f));
        }
        X::Op(o) => o.args.iter_mut().for_each(|x| walk_expr(x, f)),
        X::Show(s) => walk_expr(&mut s.value, f),
        X::Fn(l) => l.body.iter_mut().for_each(|s| walk_stmt(s, f)),
        X::Place(p) => walk_place(p, f),
        X::Try(t) => walk_expr(&mut t.value, f),
        X::With(w) => {
            walk_expr(&mut w.value, f);
            w.fields.values_mut().for_each(|x| walk_expr(x, f));
        }
        _ => {}
    }
    f(e);
}

fn walk_place(p: &mut ir::Place, f: &mut dyn FnMut(&mut ir::Expr)) {
    for s in &mut p.path {
        if let ir::Step::Item(i) = s {
            walk_expr(&mut i.at, f);
        }
    }
}

fn walk_cond(c: &mut ir::Cond, f: &mut dyn FnMut(&mut ir::Expr)) {
    match c {
        ir::Cond::Cond(x) => walk_expr(x, f),
        ir::Cond::Open(o) => walk_expr(&mut o.opt, f),
    }
}

pub(crate) fn walk_stmt(s: &mut ir::Stmt, f: &mut dyn FnMut(&mut ir::Expr)) {
    use ir::Stmt as S;
    match s {
        S::Declare(ir::StmtDeclare::Let(l)) | S::Declare(ir::StmtDeclare::Mut(l)) => walk_expr(&mut l.value, f),
        S::Set(x) => {
            walk_place(&mut x.place, f);
            walk_expr(&mut x.value, f);
        }
        S::Return(r) => {
            if let Some(v) = &mut r.value {
                walk_expr(v, f);
            }
        }
        S::If(i) => {
            for b in &mut i.branches {
                walk_cond(&mut b.when, f);
                b.then.iter_mut().for_each(|s| walk_stmt(s, f));
            }
            i.else_.iter_mut().for_each(|s| walk_stmt(s, f));
        }
        S::For(x) => {
            walk_expr(&mut x.over, f);
            x.body.iter_mut().for_each(|s| walk_stmt(s, f));
        }
        S::Match(m) => {
            walk_expr(&mut m.value, f);
            for c in &mut m.cases {
                c.then.iter_mut().for_each(|s| walk_stmt(s, f));
            }
            m.else_.iter_mut().for_each(|s| walk_stmt(s, f));
        }
        S::Invoke(i) => i.args.iter_mut().for_each(|x| walk_expr(x, f)),
        S::Call(c) => c.args.iter_mut().for_each(|x| walk_expr(x, f)),
        S::Apply(a) => {
            walk_expr(&mut a.fn_, f);
            a.args.iter_mut().for_each(|x| walk_expr(x, f));
        }
    }
}

pub(crate) fn walk_node(n: &mut ir::Node, f: &mut dyn FnMut(&mut ir::Expr)) {
    use ir::Node as N;
    match n {
        N::Extern(e) => {
            e.props.values_mut().for_each(|x| walk_expr(x, f));
            for ns in e.slots.values_mut() {
                ns.iter_mut().for_each(|n| walk_node(n, f));
            }
            e.writes.values_mut().for_each(|p| walk_place(p, f));
            e.fallback.iter_mut().for_each(|n| walk_node(n, f));
        }
        N::Use(u) => {
            u.args.values_mut().for_each(|x| walk_expr(x, f));
            for ns in u.slots.values_mut() {
                ns.iter_mut().for_each(|n| walk_node(n, f));
            }
            u.fallback.iter_mut().for_each(|n| walk_node(n, f));
        }
        N::For(x) => {
            walk_expr(&mut x.over, f);
            x.body.iter_mut().for_each(|n| walk_node(n, f));
        }
        N::If(i) => {
            for b in &mut i.branches {
                walk_cond(&mut b.when, f);
                b.then.iter_mut().for_each(|n| walk_node(n, f));
            }
            i.else_.iter_mut().for_each(|n| walk_node(n, f));
        }
        N::Match(m) => {
            walk_expr(&mut m.value, f);
            for c in &mut m.cases {
                c.then.iter_mut().for_each(|n| walk_node(n, f));
            }
            m.else_.iter_mut().for_each(|n| walk_node(n, f));
        }
        N::Place(p) => walk_expr(&mut p.view, f),
        N::Declare(d) => walk_expr(&mut d.let_.value, f),
    }
}
