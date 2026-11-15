//! The bodies of every declaration, then the constants worked out by the evaluator.

use crate::body::{Cx, Local, LocalKind, LITERAL_MARK};
use crate::ty::Ty;
use crate::*;
use mkp_eval::{interp::Constants, FailKind, Machine, Program};

impl Checker {
    pub(crate) fn bodies(&mut self) {
        // fns, written in MKP or extern with a default
        for f in 0..self.fns.len() {
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
        for d in 0..self.defs.len() {
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
        for (d, case, file, value) in self.token_values.clone() {
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
        for c in 0..self.channels.len() {
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
        for l in 0..self.lets.len() {
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
    fn program(&mut self) -> Program {
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
        // constant lets, each once the ones it reads are known
        let mut prog = self.program();
        let mut left: Vec<usize> = (0..self.lets.len()).collect();
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
        for (d, case, file, src) in self.token_values.clone() {
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
