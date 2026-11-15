//! Bodies: every expression typed and every statement checked, written as IR.

use crate::proof::Known;
use crate::ty::{FnParam, Ty};
use crate::*;
use mkp_syntax::ast::{BinOp, ExprKind as E, UnOp};
use mkp_syntax::lexer::decode_piece;

#[derive(Clone, Debug, PartialEq)]
pub enum LocalKind {
    Plain,
    /// A `mut for` variable: an `opt` for the real item.
    MutFor,
    /// A name opened with `if (mut …)`.
    OpenMut,
}

#[derive(Clone, Debug)]
pub struct Local {
    pub name: String,
    pub ty: Ty,
    pub mutable: bool,
    pub kind: LocalKind,
    /// What is known of its value: its declared type, and proofs that hold where it is read.
    pub known: Option<Known>,
}

/// The widget whose code is being checked.
#[derive(Clone, Debug)]
pub struct WidgetCx {
    pub def: DefId,
    pub inputs: Vec<(String, Ty, bool)>,
    pub slots: Vec<(String, Ty)>,
    pub events: Vec<EventSym>,
    pub cells: Vec<(String, Ty)>,
    pub fns: HashMap<String, usize>,
    /// The inputs' and own variables' declared types, with their contracts.
    pub declared: Vec<(String, ir::Type)>,
}

/// Where code is being checked.
#[derive(Clone)]
pub struct Cx {
    pub file: usize,
    pub scopes: Vec<Vec<Local>>,
    pub bounds: Vec<TParam>,
    pub generics: Vec<String>,
    /// Inside a fn or a lambda: what it returns (`None` for an action).
    pub ret: Option<Option<Ty>>,
    pub widget: Option<WidgetCx>,
    /// The document's `$state` fields.
    pub state: Option<Vec<(String, Ty)>>,
    /// Inside `$state`'s own rules, its fields are read by name.
    pub state_rules: bool,
    /// The declared return type, for its contract.
    pub ret_ir: Option<ir::Type>,
    /// Under `try`: a record's fields need no proof.
    pub trying: bool,
    /// Proofs that hold from a scope down: `if (n in 0..100)`, at the depth of its block.
    pub facts: Vec<(usize, String, Known)>,
}

impl Cx {
    pub fn new(file: usize) -> Cx {
        Cx { file, scopes: vec![Vec::new()], bounds: Vec::new(), generics: Vec::new(), ret: None, widget: None, state: None, state_rules: false, ret_ir: None, trying: false, facts: Vec::new() }
    }

    pub fn push(&mut self) {
        self.scopes.push(Vec::new());
    }

    pub fn pop(&mut self) {
        self.scopes.pop();
        let depth = self.scopes.len();
        self.facts.retain(|f| f.0 <= depth);
    }

    pub fn local(&self, name: &str) -> Option<&Local> {
        self.scopes.iter().rev().flat_map(|s| s.iter().rev()).find(|l| l.name == name)
    }
}

/// A literal whose type's `from` runs when the page is compiled.
#[derive(Clone)]
pub struct Pending {
    pub file: usize,
    pub span: Span,
    pub ty: String,
}

pub const LITERAL_MARK: &str = "@literal";

fn call(name: &str, args: Vec<ir::Expr>, ty: Option<ir::Type>) -> ir::Expr {
    ir::Expr::Call(Box::new(ir::Call { name: name.to_string(), args, ty }))
}

fn op(name: ir::OpName, args: Vec<ir::Expr>, ty: ir::Type) -> ir::Expr {
    ir::Expr::Op(Box::new(ir::ExprOp { name, args, ty: Some(ty) }))
}

impl Checker {
    pub(crate) fn declare_local(&mut self, cx: &mut Cx, name: &ast::Ident, ty: Ty, mutable: bool, kind: LocalKind) {
        if cx.local(&name.name).is_some() || self.visible_value(cx, &name.name) {
            self.error(cx.file, codes::SHADOWING, name.span, format!("`{}` is already a visible name: a declaration can't reuse it", name.name));
        }
        cx.scopes.last_mut().unwrap().push(Local { name: name.name.clone(), ty, mutable, kind, known: None });
    }

    /// Whether a name is a value outside the locals: an input, a cell, a slot or a file's name.
    fn visible_value(&self, cx: &Cx, name: &str) -> bool {
        if let Some(w) = &cx.widget {
            if w.inputs.iter().any(|i| i.0 == name) || w.cells.iter().any(|c| c.0 == name) || w.slots.iter().any(|s| s.0 == name) || w.fns.contains_key(name) {
                return true;
            }
        }
        // core's private names don't hide a pack's locals
        self.lookup_value(cx.file, name).is_some()
    }

    // ---- expressions

    pub fn expr(&mut self, cx: &mut Cx, e: &ast::Expr, expect: Option<&Ty>) -> (ir::Expr, Ty) {
        let (x, t) = self.expr_raw(cx, e, expect);
        self.note_known(cx, e, &x);
        match expect {
            Some(want) if !t.is_err() => {
                let x = self.coerce(cx.file, x, &t, want, e.span, &cx.bounds.clone());
                let t = match self.accepts(want, &t, &cx.bounds.clone()) {
                    Some(_) => want.clone(),
                    None => t,
                };
                (x, t)
            }
            _ => (x, t),
        }
    }

    fn literal_from(&mut self, cx: &mut Cx, x: ir::Expr, want: &Ty, given: &Ty, span: Span) -> Option<(ir::Expr, Ty)> {
        let w = self.vars.resolve(want);
        let target = match &w {
            Ty::Opt(inner) => (**inner).clone(),
            other => other.clone(),
        };
        let Ty::Def(d, _) = &target else { return None };
        if !matches!(self.defs[*d].kind, DefKind::Record { .. } | DefKind::Token { .. } | DefKind::ExternType) {
            return None;
        }
        let from = self.own_fn(&target, "from")?;
        let p = self.fns[from].params.first()?.ty.clone();
        if self.accepts(&p, given, &cx.bounds.clone()).is_none() {
            return None;
        }
        let full = self.fns[from].full.clone();
        let id = self.pending.len();
        self.pending.push(Pending { file: cx.file, span, ty: self.defs[*d].name.clone() });
        let mark = format!("{}#{}", LITERAL_MARK, id);
        Some((call(&mark, vec![call(&full, vec![x], Some(self.ir_ty(&Ty::opt(target.clone()))))], None), target))
    }

    fn expr_raw(&mut self, cx: &mut Cx, e: &ast::Expr, expect: Option<&Ty>) -> (ir::Expr, Ty) {
        let file = cx.file;
        match &e.kind {
            E::Number(n) => {
                let x = ir::Expr::Num(n.replace('_', ""));
                if let Some(want) = expect {
                    if !matches!(self.vars.resolve(want), Ty::Num | Ty::Opt(_) | Ty::Var(_) | Ty::Err) || matches!(self.vars.resolve(want), Ty::Opt(ref i) if matches!(**i, Ty::Def(..))) {
                        if let Some(out) = self.literal_from(cx, x.clone(), want, &Ty::Num, e.span) {
                            return out;
                        }
                    }
                }
                (x, Ty::Num)
            }
            E::Duration(d) => (ir::Expr::Duration(duration_ms(&d.replace('_', ""))), Ty::Dur),
            E::Bool(b) => (ir::Expr::Bool(*b), Ty::Bool),
            E::Text(t) => self.text(cx, t, expect, e.span),
            E::SelfValue => match cx.local("self") {
                Some(l) => (ir::Expr::Get(ir::Get::Local("self".into())), l.ty.clone()),
                None => {
                    self.error(file, codes::UNKNOWN_NAME, e.span, "`self` is used only in a fn added to a type");
                    (ir::Expr::Num("0".into()), Ty::Err)
                }
            },
            E::State => {
                self.error(file, codes::UNKNOWN_NAME, e.span, "`$state` is read one field at a time: `$state.name`");
                (ir::Expr::Num("0".into()), Ty::Err)
            }
            E::Name(n) => self.name(cx, n),
            E::Paren(inner) => self.expr_raw(cx, inner, expect),
            E::List(items) => {
                let item_want = match expect.map(|t| self.vars.resolve(t)) {
                    Some(Ty::List(t)) => Some(*t),
                    _ => None,
                };
                let mut item_ty = item_want.clone().unwrap_or_else(|| self.vars.fresh());
                let mut out = Vec::new();
                for (k, i) in items.iter().enumerate() {
                    let (x, t) = self.expr(cx, i, Some(&item_ty));
                    if k == 0 && item_want.is_none() {
                        item_ty = t;
                    }
                    out.push(x);
                }
                let x = ir::Expr::List(out);
                if let Some(want) = expect {
                    if !matches!(self.vars.resolve(want), Ty::List(_) | Ty::Var(_) | Ty::Err) {
                        if let Some(r) = self.literal_from(cx, x.clone(), want, &Ty::list(item_ty.clone()), e.span) {
                            return r;
                        }
                    }
                }
                (x, Ty::list(item_ty))
            }
            E::Record { ty, inits } => self.record(cx, ty.as_ref(), inits, expect, e.span),
            E::Field { target, name } => self.field(cx, target, name, e.span),
            E::Case { target, name, args } => self.case(cx, target, name, args.as_ref(), expect, e.span),
            E::Index { target, index } => {
                let (t, tt) = self.expr(cx, target, None);
                let (i, _) = self.expr(cx, index, Some(&Ty::Num));
                let item = match self.vars.resolve(&tt) {
                    Ty::List(x) => *x,
                    Ty::Err => Ty::Err,
                    other => {
                        let s = self.show(&other);
                        self.error(file, codes::MISMATCH, target.span, format!("`[…]` reaches into a list, not a {}", s));
                        Ty::Err
                    }
                };
                let ty = Ty::opt(item);
                (call("core/list.at", vec![t, i], Some(self.ir_ty(&ty))), ty)
            }
            E::Call { callee, args } => self.call_expr(cx, callee, args, expect, e.span),
            E::With { target, inits } => {
                let trying = std::mem::replace(&mut cx.trying, false);
                let (base, bt) = self.expr(cx, target, expect);
                let fields = self.fields_in(cx, &bt);
                let mut out = BTreeMap::new();
                for i in inits.iter() {
                    match fields.iter().find(|(n, _)| *n == i.name.name) {
                        Some((_, ft)) => {
                            let ft = ft.clone();
                            let (x, _) = self.expr(cx, &i.value, Some(&ft));
                            if !trying {
                                if let Some(w) = self.field_ir(cx, &bt, &i.name.name) {
                                    self.want(cx, &i.value, &x, &w, format!("`{}`", i.name.name));
                                }
                            }
                            out.insert(i.name.name.clone(), x);
                        }
                        None => {
                            let s = self.show(&bt);
                            self.error(file, codes::UNKNOWN_FIELD, i.name.span, format!("{} has no field `{}`", s, i.name.name));
                        }
                    }
                }
                (ir::Expr::With(Box::new(ir::ExprWith { value: base, fields: out })), bt)
            }
            E::Unary { op: UnOp::Not, operand } => {
                let (x, _) = self.expr(cx, operand, Some(&Ty::Bool));
                (op(ir::OpName::Not, vec![x], self.ir_ty(&Ty::Bool)), Ty::Bool)
            }
            E::Unary { op: UnOp::Neg, operand } => {
                let (x, t) = self.expr(cx, operand, expect);
                match self.vars.resolve(&t) {
                    Ty::Num | Ty::Dur | Ty::Err => {
                        let it = self.ir_ty(&t);
                        (op(ir::OpName::Minus, vec![x], it), t)
                    }
                    other => match self.methods_of(&other, "scale", &cx.bounds.clone()).first().copied() {
                        Some(f) => {
                            let name = self.fns[f].full.clone();
                            (call(&name, vec![x, ir::Expr::Num("-1".into())], Some(self.ir_ty(&other))), other)
                        }
                        None => {
                            let s = self.show(&other);
                            self.error(file, codes::MISMATCH, e.span, format!("`-` negates a number, or a type that fits scaled; not a {}", s));
                            (x, Ty::Err)
                        }
                    },
                }
            }
            E::Binary { op: o, left, right } => self.binary(cx, *o, left, right, expect, e.span),
            E::Ternary { cond, then, otherwise } => {
                let (c, _) = self.expr(cx, cond, Some(&Ty::Bool));
                let (a, at) = self.expr(cx, then, expect);
                let want = expect.cloned().unwrap_or_else(|| at.clone());
                let (b, _) = self.expr(cx, otherwise, Some(&want));
                let it = self.ir_ty(&want);
                (op(ir::OpName::Pick, vec![c, a, b], it), want)
            }
            E::Range { low, high, step } => {
                let elem_want = match expect.map(|t| self.vars.resolve(t)) {
                    Some(Ty::Range(t)) => Some(*t),
                    _ => None,
                };
                let mut elem = elem_want.clone();
                let part = |me: &mut Checker, cx: &mut Cx, x: &Option<Box<ast::Expr>>, elem: &mut Option<Ty>| -> Option<ir::Expr> {
                    let x = x.as_ref()?;
                    let (v, t) = me.expr(cx, x, elem.as_ref());
                    if elem.is_none() {
                        *elem = Some(t);
                    }
                    Some(v)
                };
                let lo = part(self, cx, low, &mut elem);
                let hi = part(self, cx, high, &mut elem);
                let st = part(self, cx, step, &mut elem);
                let t = Ty::Range(Box::new(elem.unwrap_or(Ty::Num)));
                (ir::Expr::Range(Box::new(ir::ExprRange { low: lo, high: hi, step: st })), t)
            }
            E::Try(inner) => {
                let inner_want = match expect.map(|t| self.vars.resolve(t)) {
                    Some(Ty::Opt(t)) => Some(*t),
                    _ => None,
                };
                let was = std::mem::replace(&mut cx.trying, true);
                let (x, t) = self.expr(cx, inner, inner_want.as_ref());
                cx.trying = was;
                (ir::Expr::Try(Box::new(ir::ExprTry { value: x })), Ty::opt(t))
            }
            E::Lambda(l) => self.lambda(cx, l, expect),
            E::View(v) => self.view_value(cx, v),
        }
    }

    fn name(&mut self, cx: &mut Cx, n: &ast::Ident) -> (ir::Expr, Ty) {
        if let Some(l) = cx.local(&n.name) {
            return (ir::Expr::Get(ir::Get::Local(n.name.clone())), l.ty.clone());
        }
        if let Some(w) = &cx.widget {
            if let Some((_, t, _)) = w.inputs.iter().find(|i| i.0 == n.name) {
                return (ir::Expr::Get(ir::Get::Input(n.name.clone())), t.clone());
            }
            if let Some((_, t)) = w.cells.iter().find(|c| c.0 == n.name) {
                return (ir::Expr::Get(ir::Get::Cell(n.name.clone())), t.clone());
            }
            if let Some((_, t)) = w.slots.iter().find(|s| s.0 == n.name) {
                return (ir::Expr::Get(ir::Get::Slot(n.name.clone())), t.clone());
            }
            if let Some(f) = w.fns.get(&n.name).copied() {
                return self.fn_value(f);
            }
        }
        if cx.state_rules {
            if let Some(fields) = &cx.state {
                if let Some((_, t)) = fields.iter().find(|f| f.0 == n.name) {
                    return (ir::Expr::Get(ir::Get::State(n.name.clone())), t.clone());
                }
            }
        }
        match self.lookup_value(cx.file, &n.name) {
            Some(ValueSym::Let(l)) => (ir::Expr::Get(ir::Get::Let(self.lets[l].full.clone())), self.lets[l].ty.clone()),
            Some(ValueSym::Fn(f)) => self.fn_value(f),
            Some(ValueSym::Channel(_)) => {
                self.error(cx.file, codes::UNKNOWN_NAME, n.span, format!("`{}` is an extern channel: read one of its values, `{}.name`", n.name, n.name));
                (ir::Expr::Num("0".into()), Ty::Err)
            }
            None => {
                self.error(cx.file, codes::UNKNOWN_NAME, n.span, format!("there is no `{}` here", n.name));
                (ir::Expr::Num("0".into()), Ty::Err)
            }
        }
    }

    /// A fn passed by its name: a lambda that calls it.
    fn fn_value(&mut self, f: usize) -> (ir::Expr, Ty) {
        let s = self.fns[f].clone();
        let params: Vec<ir::Param> = s.params.iter().map(|p| ir::Param { name: p.name.clone(), ty: p.ir.clone(), mutable: p.mutable }).collect();
        let args = s.params.iter().map(|p| ir::Expr::Get(ir::Get::Local(p.name.clone()))).collect();
        let c = ir::Call { name: s.full.clone(), args, ty: s.ret_ir.clone() };
        let body = if s.ret.is_some() { vec![ir::Stmt::Return(ir::StmtReturn { value: Some(ir::Expr::Call(Box::new(c))) })] } else { vec![ir::Stmt::Call(c)] };
        (ir::Expr::Fn(Box::new(ir::Lambda { params, returns: s.ret_ir.clone(), body })), self.fn_type(f))
    }

    /// The type a literal is wanted as, when it fits `literal<template>`: its `from` takes a template.
    fn template_literal(&mut self, expect: Option<&Ty>) -> Option<Ty> {
        let w = self.vars.resolve(expect?);
        let target = match &w {
            Ty::Opt(inner) => (**inner).clone(),
            other => other.clone(),
        };
        let Ty::Def(d, _) = &target else { return None };
        if !matches!(self.defs[*d].kind, DefKind::Record { .. } | DefKind::ExternType) {
            return None;
        }
        let from = self.own_fn(&target, "from")?;
        match &self.fns[from].params.first()?.ty {
            Ty::Def(p, _) if self.defs[*p].full == "core/template" => Some(target),
            _ => None,
        }
    }

    fn text(&mut self, cx: &mut Cx, t: &ast::TextLit, expect: Option<&Ty>, span: Span) -> (ir::Expr, Ty) {
        let mut pieces = Vec::new();
        let mut holes = Vec::new();
        let mut piece = String::new();
        let mut opt_hole = None;
        let as_template = self.template_literal(expect);
        for part in &t.parts {
            match part {
                ast::TextPart::Piece { raw, .. } => piece.push_str(&decode_piece(raw)),
                ast::TextPart::Hole(h) => {
                    pieces.push(std::mem::take(&mut piece));
                    let (x, ht) = self.expr(cx, h, None);
                    let ht = self.vars.resolve(&ht);
                    if matches!(ht, Ty::Opt(_)) {
                        opt_hole = opt_hole.or(Some(h.span));
                    }
                    let as_is = ht == Ty::Text || (as_template.is_some() && self.is_view_type(&ht));
                    holes.push(if as_is { x } else { ir::Expr::Show(Box::new(ir::ExprShow { value: x })) });
                }
            }
        }
        pieces.push(piece);
        // a literal where a type that fits literal<template> is wanted reaches its `from` as a template, at compile time
        if let Some(target) = as_template {
            if let Some(at) = opt_hole {
                self.error(cx.file, codes::OPT_HOLE, at, "this literal is read by its type's `from`, which places each hole as a value: give this hole a fallback, `\\{x.or(…)}`, or open it first with `if (let …)`");
            }
            let name = self.defs[match &target { Ty::Def(d, _) => *d, _ => unreachable!() }].full.clone();
            let x = ir::Expr::Template(Box::new(ir::ExprTemplate { pieces, holes, ty: ir::Type::named(&name) }));
            let id = self.pending.len();
            self.pending.push(Pending { file: cx.file, span, ty: format!("literal:{}", name.rsplit('/').next().unwrap_or(&name)) });
            return (ir::Expr::Call(Box::new(ir::Call { name: format!("{}#{}", crate::view::PROSE_MARK, id), args: vec![x], ty: None })), target);
        }
        let opt_hole = opt_hole.is_some();
        if holes.is_empty() {
            let x = ir::Expr::Text(pieces.pop().unwrap());
            if let Some(want) = expect {
                if !matches!(self.vars.resolve(want), Ty::Text | Ty::Var(_) | Ty::Err) {
                    if let Some(out) = self.literal_from(cx, x.clone(), want, &Ty::Text, span) {
                        return out;
                    }
                }
            }
            return (x, Ty::Text);
        }
        let ty = if opt_hole { Ty::opt(Ty::Text) } else { Ty::Text };
        (ir::Expr::Template(Box::new(ir::ExprTemplate { pieces, holes, ty: ir::Type::named("core/text") })), ty)
    }

    /// The fields a value has where it is read: a type parameter's, `self` in an interface fn
    /// included, are its bounds' interface fields.
    pub(crate) fn fields_in(&mut self, cx: &Cx, t: &Ty) -> Vec<(String, Ty)> {
        let Ty::Param(p) = self.vars.resolve(t) else { return self.record_fields(t) };
        let Some(tp) = cx.bounds.iter().find(|b| b.name == p) else { return Vec::new() };
        let mut out: Vec<(String, Ty)> = Vec::new();
        for (d, args) in &tp.bounds {
            let map = self.generic_map(*d, args);
            if let DefKind::Interface { fields, .. } = &self.defs[*d].kind {
                for f in fields {
                    if !out.iter().any(|(n, _)| *n == f.name) {
                        out.push((f.name.clone(), f.ty.subst(&map).subst_self(&Ty::Param(p.clone()))));
                    }
                }
            }
        }
        out
    }

    /// The fields a record-like type has: a record's, an inline record's, a widget's inputs.
    pub(crate) fn record_fields(&mut self, t: &Ty) -> Vec<(String, Ty)> {
        match self.vars.resolve(t) {
            Ty::Def(d, args) => {
                let map = self.generic_map(d, &args);
                match &self.defs[d].kind {
                    DefKind::Record { fields } => fields.iter().map(|f| (f.name.clone(), f.ty.subst(&map))).collect(),
                    DefKind::Widget { inputs, .. } => inputs.iter().map(|f| (f.name.clone(), f.ty.subst(&map))).collect(),
                    DefKind::Interface { fields, .. } => fields.iter().map(|f| (f.name.clone(), f.ty.clone())).collect(),
                    DefKind::Token { value, .. } => {
                        let v = value.clone();
                        self.record_fields(&v)
                    }
                    _ => Vec::new(),
                }
            }
            Ty::Any(d, _) => match &self.defs[d].kind {
                DefKind::Interface { fields, .. } => fields.iter().map(|f| (f.name.clone(), f.ty.clone())).collect(),
                _ => Vec::new(),
            },
            Ty::Inline(fs) => fs,
            _ => Vec::new(),
        }
    }

    fn record(&mut self, cx: &mut Cx, ty: Option<&ast::Ident>, inits: &ast::Group<ast::Init>, expect: Option<&Ty>, span: Span) -> (ir::Expr, Ty) {
        let file = cx.file;
        let Some(name) = ty else {
            // an inline record
            let want: Vec<(String, Ty)> = match expect.map(|t| self.vars.resolve(t)) {
                Some(Ty::Inline(fs)) => fs,
                _ => Vec::new(),
            };
            let mut fields = BTreeMap::new();
            let mut tys = Vec::new();
            for i in inits.iter() {
                let w = want.iter().find(|(n, _)| *n == i.name.name).map(|(_, t)| t.clone());
                let (x, t) = self.expr(cx, &i.value, w.as_ref());
                fields.insert(i.name.name.clone(), x);
                tys.push((i.name.name.clone(), w.unwrap_or(t)));
            }
            return (ir::Expr::Record(ir::ExprRecord { ty: "record".into(), fields }), Ty::Inline(tys));
        };
        let d = match self.lookup_type(file, &name.name) {
            Some(TypeSym::Def(d)) if matches!(self.defs[d].kind, DefKind::Record { .. }) => d,
            _ => {
                self.error(file, codes::UNKNOWN_TYPE, name.span, format!("there is no record `{}`", name.name));
                return (ir::Expr::Num("0".into()), Ty::Err);
            }
        };
        let args: Vec<Ty> = match expect.map(|t| self.vars.resolve(t)) {
            Some(Ty::Def(e, a)) if e == d => a,
            _ => self.defs[d].generics.clone().iter().map(|_| self.vars.fresh()).collect(),
        };
        let map = self.generic_map(d, &args);
        let DefKind::Record { fields } = self.defs[d].kind.clone() else { unreachable!() };
        let trying = std::mem::replace(&mut cx.trying, false);
        let mut out = BTreeMap::new();
        for i in inits.iter() {
            match fields.iter().find(|f| f.name == i.name.name) {
                Some(f) => {
                    let ft = f.ty.subst(&map);
                    let (x, _) = self.expr(cx, &i.value, Some(&ft));
                    if !trying {
                        self.want(cx, &i.value, &x, &f.ir, format!("`{}`'s `{}`", self.defs[d].name, f.name));
                    }
                    out.insert(i.name.name.clone(), x);
                }
                None => self.error(file, codes::UNKNOWN_FIELD, i.name.span, format!("record `{}` has no field `{}`", name.name, i.name.name)),
            }
        }
        for f in &fields {
            if f.default.is_none() && !out.contains_key(&f.name) {
                self.error(file, codes::MISSING_INPUT, span, format!("`{}` is made without its field `{}`, which has no default", name.name, f.name));
            }
        }
        let full = self.defs[d].full.clone();
        (ir::Expr::Record(ir::ExprRecord { ty: full, fields: out }), Ty::Def(d, args))
    }

    fn field(&mut self, cx: &mut Cx, target: &ast::Expr, name: &ast::Ident, span: Span) -> (ir::Expr, Ty) {
        let file = cx.file;
        if let E::State = target.kind {
            return match cx.state.as_ref().and_then(|s| s.iter().find(|f| f.0 == name.name)).map(|f| f.1.clone()) {
                Some(t) => {
                    if let Some(w) = self.state_ir(&name.name) {
                        self.known_at.insert((file, span.start, span.end), Known::of(&w));
                    }
                    (ir::Expr::Get(ir::Get::State(name.name.clone())), t)
                }
                None => {
                    self.error(file, codes::UNKNOWN_FIELD, name.span, format!("`$state` has no field `{}`", name.name));
                    (ir::Expr::Num("0".into()), Ty::Err)
                }
            };
        }
        if let E::Name(n) = &target.kind {
            if cx.local(&n.name).is_none() && !self.visible_in_widget(cx, &n.name) {
                if let Some(ValueSym::Channel(c)) = self.lookup_value(file, &n.name) {
                    let ch = self.channels[c].clone();
                    return match ch.values.iter().find(|v| v.name == name.name) {
                        Some(v) => (ir::Expr::Get(ir::Get::Extern(format!("{}.{}", ch.full, name.name))), v.ty.clone()),
                        None => {
                            self.error(file, codes::UNKNOWN_FIELD, name.span, format!("extern `{}` has no value `{}`", n.name, name.name));
                            (ir::Expr::Num("0".into()), Ty::Err)
                        }
                    };
                }
            }
        }
        let (x, t) = self.expr(cx, target, None);
        let fields = self.fields_in(cx, &t);
        match fields.into_iter().find(|(n, _)| *n == name.name) {
            Some((_, ft)) => {
                let mut k = self.field_ir(cx, &t, &name.name).map(|w| Known::of(&w)).unwrap_or_default();
                // a constant's field is a constant
                if self.known_of(cx, target).value.is_some() {
                    k.value = Some(ir::Expr::Field(Box::new(ir::ExprField { value: x.clone(), name: name.name.clone() })));
                }
                self.known_at.insert((file, span.start, span.end), k);
                (ir::Expr::Field(Box::new(ir::ExprField { value: x, name: name.name.clone() })), ft)
            }
            None => {
                if !t.is_err() {
                    let s = self.show(&t);
                    self.error(file, codes::UNKNOWN_FIELD, name.span, format!("{} has no field `{}`", s, name.name));
                }
                let _ = span;
                (x, Ty::Err)
            }
        }
    }

    fn visible_in_widget(&self, cx: &Cx, name: &str) -> bool {
        cx.widget.as_ref().map_or(false, |w| w.inputs.iter().any(|i| i.0 == name) || w.cells.iter().any(|c| c.0 == name) || w.slots.iter().any(|s| s.0 == name))
    }

    fn case(&mut self, cx: &mut Cx, target: &ast::Expr, name: &ast::Ident, args: Option<&ast::Group<ast::Arg>>, expect: Option<&Ty>, span: Span) -> (ir::Expr, Ty) {
        let file = cx.file;
        let E::Name(tn) = &target.kind else {
            self.error(file, codes::UNKNOWN_TYPE, target.span, "a case is written after its type's name: `type.CASE`");
            return (ir::Expr::Num("0".into()), Ty::Err);
        };
        match self.lookup_type(file, &tn.name) {
            Some(TypeSym::Builtin("opt")) => {
                let inner_want = match expect.map(|t| self.vars.resolve(t)) {
                    Some(Ty::Opt(t)) => Some(*t),
                    _ => None,
                };
                match name.name.as_str() {
                    "NONE" => (ir::Expr::None(ir::Empty {}), Ty::opt(inner_want.unwrap_or_else(|| self.vars.fresh()))),
                    "SOME" => {
                        let Some(a) = args.and_then(|g| g.items.first()) else {
                            self.error(file, codes::ARGUMENTS, span, "`opt.SOME` takes the value it holds: `opt.SOME(x)`");
                            return (ir::Expr::None(ir::Empty {}), Ty::Err);
                        };
                        let (x, t) = self.expr(cx, &a.item.value, inner_want.as_ref());
                        (ir::Expr::Some(Box::new(x)), Ty::opt(t))
                    }
                    _ => {
                        self.error(file, codes::UNKNOWN_CASE, name.span, format!("`opt` has the cases SOME and NONE, not `{}`", name.name));
                        (ir::Expr::None(ir::Empty {}), Ty::Err)
                    }
                }
            }
            Some(TypeSym::Def(d)) => {
                let (cases, token) = match &self.defs[d].kind {
                    DefKind::Enum { cases } => (cases.clone(), false),
                    DefKind::Token { cases, .. } => (cases.clone(), true),
                    _ => {
                        self.error(file, codes::UNKNOWN_CASE, name.span, format!("`{}` is not an enum or a token type, so it has no cases", tn.name));
                        return (ir::Expr::Num("0".into()), Ty::Err);
                    }
                };
                let Some(c) = cases.iter().find(|c| c.name == name.name).cloned() else {
                    self.error(file, codes::UNKNOWN_CASE, name.span, format!("`{}` has no case `{}`", tn.name, name.name));
                    return (ir::Expr::Num("0".into()), Ty::Err);
                };
                let targs: Vec<Ty> = match expect.map(|t| self.vars.resolve(t)) {
                    Some(Ty::Def(e, a)) if e == d => a,
                    _ => self.defs[d].generics.clone().iter().map(|_| self.vars.fresh()).collect(),
                };
                let map = self.generic_map(d, &targs);
                let full = self.defs[d].full.clone();
                let given: Vec<&ast::Arg> = args.map(|g| g.iter().collect()).unwrap_or_default();
                if given.len() != c.fields.len() {
                    self.error(file, codes::ARGUMENTS, span, format!("`{}.{}` carries {} value(s), and {} are given", tn.name, name.name, c.fields.len(), given.len()));
                }
                let mut values = BTreeMap::new();
                let trying = std::mem::replace(&mut cx.trying, false);
                for (f, a) in c.fields.iter().zip(given.iter()) {
                    let ft = f.ty.subst(&map);
                    let (x, _) = self.expr(cx, &a.value, Some(&ft));
                    if !trying {
                        self.want(cx, &a.value, &x, &f.ir, format!("`{}.{}`'s `{}`", tn.name, name.name, f.name));
                    }
                    values.insert(f.name.clone(), x);
                }
                let ty = Ty::Def(d, targs);
                if token {
                    if values.is_empty() {
                        return (ir::Expr::Token(format!("{}.{}", full, name.name)), ty);
                    }
                    let (_, v) = values.into_iter().next().unwrap();
                    return (ir::Expr::Tokval(Box::new(ir::ExprTokval { ty: full, name: name.name.clone(), value: v })), ty);
                }
                (ir::Expr::Case(ir::ExprCase { enum_: full, name: name.name.clone(), values }), ty)
            }
            _ => {
                self.error(file, codes::UNKNOWN_TYPE, tn.span, format!("there is no type `{}`", tn.name));
                (ir::Expr::Num("0".into()), Ty::Err)
            }
        }
    }

    fn binary(&mut self, cx: &mut Cx, o: BinOp, left: &ast::Expr, right: &ast::Expr, expect: Option<&Ty>, span: Span) -> (ir::Expr, Ty) {
        let file = cx.file;
        let bounds = cx.bounds.clone();
        match o {
            BinOp::And | BinOp::Or => {
                let (a, _) = self.expr(cx, left, Some(&Ty::Bool));
                let (b, _) = self.expr(cx, right, Some(&Ty::Bool));
                let name = if o == BinOp::And { ir::OpName::And } else { ir::OpName::Or };
                (op(name, vec![a, b], self.ir_ty(&Ty::Bool)), Ty::Bool)
            }
            BinOp::Eq | BinOp::Ne => {
                let (a, at) = self.expr(cx, left, None);
                let (b, _) = self.expr(cx, right, Some(&at));
                let name = if o == BinOp::Eq { ir::OpName::Eq } else { ir::OpName::Ne };
                (op(name, vec![a, b], self.ir_ty(&Ty::Bool)), Ty::Bool)
            }
            BinOp::In => {
                let (r, rt) = self.expr(cx, right, None);
                let elem = match self.vars.resolve(&rt) {
                    Ty::Range(t) => *t,
                    _ => Ty::Err,
                };
                let (x, _) = self.expr(cx, left, Some(&elem));
                (call("core/range.has", vec![r, x], Some(self.ir_ty(&Ty::Bool))), Ty::Bool)
            }
            BinOp::Lt | BinOp::Le | BinOp::Gt | BinOp::Ge => {
                let (a, at) = self.expr(cx, left, None);
                let (b, _) = self.expr(cx, right, Some(&at));
                let name = match o {
                    BinOp::Lt => ir::OpName::Lt,
                    BinOp::Le => ir::OpName::Le,
                    BinOp::Gt => ir::OpName::Gt,
                    _ => ir::OpName::Ge,
                };
                (op(name, vec![a, b], self.ir_ty(&Ty::Bool)), Ty::Bool)
            }
            BinOp::Add | BinOp::Sub | BinOp::Mul | BinOp::Div | BinOp::Rem => {
                let (a, at) = self.expr(cx, left, expect.filter(|t| matches!(self.vars.resolve(t), Ty::Num | Ty::Dur)));
                let at = self.vars.resolve(&at);
                let name = match o {
                    BinOp::Add => ir::OpName::Plus,
                    BinOp::Sub => ir::OpName::Minus,
                    BinOp::Mul => ir::OpName::Times,
                    BinOp::Div => ir::OpName::Divide,
                    _ => ir::OpName::Rem,
                };
                match &at {
                    Ty::Num | Ty::Err => {
                        let (b, bt) = self.expr(cx, right, None);
                        let bt = self.vars.resolve(&bt);
                        if o == BinOp::Mul && !matches!(bt, Ty::Num | Ty::Err) {
                            // k * a, for a type that fits scaled
                            if let Some(f) = self.methods_of(&bt, "scale", &bounds).first().copied() {
                                let n = self.fns[f].full.clone();
                                return (call(&n, vec![b, a], Some(self.ir_ty(&bt))), bt);
                            }
                        }
                        if !matches!(bt, Ty::Num | Ty::Err | Ty::Dur) {
                            let s = self.show(&bt);
                            self.error(file, codes::MISMATCH, right.span, format!("expected number, found {}", s));
                        }
                        let rt = if bt == Ty::Dur { Ty::Dur } else { Ty::Num };
                        let it = self.ir_ty(&rt);
                        (op(name, vec![a, b], it), rt)
                    }
                    Ty::Dur if matches!(o, BinOp::Add | BinOp::Sub) => {
                        let (b, _) = self.expr(cx, right, Some(&Ty::Dur));
                        (op(name, vec![a, b], self.ir_ty(&Ty::Dur)), Ty::Dur)
                    }
                    Ty::Dur if matches!(o, BinOp::Mul | BinOp::Div) => {
                        let (b, _) = self.expr(cx, right, Some(&Ty::Num));
                        (op(name, vec![a, b], self.ir_ty(&Ty::Dur)), Ty::Dur)
                    }
                    other => {
                        let other = other.clone();
                        let (fname, arg_ty) = match o {
                            BinOp::Add => ("add", other.clone()),
                            BinOp::Sub => ("sub", other.clone()),
                            BinOp::Mul | BinOp::Div => ("scale", Ty::Num),
                            _ => ("", Ty::Err),
                        };
                        let f = if fname.is_empty() { None } else { self.methods_of(&other, fname, &bounds).first().copied() };
                        match f {
                            Some(f) => {
                                let full = self.fns[f].full.clone();
                                let (mut b, _) = self.expr(cx, right, Some(&arg_ty));
                                if o == BinOp::Div {
                                    b = op(ir::OpName::Divide, vec![ir::Expr::Num("1".into()), b], self.ir_ty(&Ty::Num));
                                }
                                (call(&full, vec![a, b], Some(self.ir_ty(&other))), other)
                            }
                            None => {
                                let s = self.show(&other);
                                self.error(file, codes::MISMATCH, span, format!("`{}` works on numbers, or on a type that fits numeric or scaled; not on {}", o.text(), s));
                                (a, Ty::Err)
                            }
                        }
                    }
                }
            }
        }
    }

    fn lambda(&mut self, cx: &mut Cx, l: &ast::Lambda, expect: Option<&Ty>) -> (ir::Expr, Ty) {
        let file = cx.file;
        let want = expect.map(|t| self.vars.resolve(t));
        let (want_ps, want_ret) = match &want {
            Some(Ty::Fn(ps, r)) => (Some(ps.clone()), Some(r.clone())),
            _ => (None, None),
        };
        let mut inner = cx.clone();
        inner.push();
        // a lambda's own return; its parameters' contracts are read where it is called
        inner.ret_ir = None;
        let mut params = Vec::new();
        let mut ptys = Vec::new();
        for (k, p) in l.params.iter().enumerate() {
            let ty = match &p.ty {
                Some(t) => self.resolve(file, t, &cx.generics.clone()),
                None => match want_ps.as_ref().and_then(|ps| ps.get(k)) {
                    Some(fp) => self.vars.resolve(&fp.ty),
                    None => {
                        self.error(file, codes::MISMATCH, p.name.span, format!("`{}` needs its type: this lambda isn't given where a fn type is expected", p.name.name));
                        Ty::Err
                    }
                },
            };
            self.declare_local(&mut inner, &p.name, ty.clone(), p.mutable, LocalKind::Plain);
            params.push(ir::Param { name: p.name.name.clone(), ty: self.ir_ty(&ty), mutable: p.mutable });
            ptys.push(FnParam { ty, mutable: p.mutable });
        }
        let ret: Option<Ty> = match &l.ret {
            Some(ast::RetType::Type(t)) => Some(self.resolve(file, t, &cx.generics.clone())),
            Some(ast::RetType::Void(_)) => None,
            None => match want_ret {
                Some(r) => r.map(|r| *r),
                None => {
                    // with nothing to aim for, a lambda that returns a value says so by returning one
                    if block_returns_value(&l.body) {
                        Some(self.vars.fresh())
                    } else {
                        None
                    }
                }
            },
        };
        inner.ret = Some(ret.clone());
        let body = self.block(&mut inner, &l.body);
        let ret_ir = ret.as_ref().map(|r| self.ir_ty(r));
        (ir::Expr::Fn(Box::new(ir::Lambda { params, returns: ret_ir, body })), Ty::Fn(ptys, ret.map(Box::new)))
    }

    // ---- calls

    fn call_expr(&mut self, cx: &mut Cx, callee: &ast::Expr, args: &ast::Group<ast::Arg>, expect: Option<&Ty>, span: Span) -> (ir::Expr, Ty) {
        let file = cx.file;
        match &callee.kind {
            E::Name(n) if cx.local(&n.name).is_none() => {
                if let Some(f) = cx.widget.as_ref().and_then(|w| w.fns.get(&n.name)).copied() {
                    return self.call_fn(cx, f, None, args, expect, span);
                }
                match self.lookup_value(file, &n.name) {
                    Some(ValueSym::Fn(f)) => self.call_fn(cx, f, None, args, expect, span),
                    _ if self.visible_in_widget(cx, &n.name) => self.apply(cx, callee, args, span),
                    _ => {
                        self.error(file, codes::UNKNOWN_FN, n.span, format!("there is no fn `{}`", n.name));
                        (ir::Expr::Num("0".into()), Ty::Err)
                    }
                }
            }
            E::Field { target, name } => {
                // a fn on a type: date.from(…), when no value of that name is visible
                if let E::Name(tn) = &target.kind {
                    let is_value = cx.local(&tn.name).is_some() || self.visible_in_widget(cx, &tn.name) || self.lookup_value(file, &tn.name).is_some();
                    if let (false, Some(t)) = (is_value, self.lookup_type(file, &tn.name)) {
                        let key = match t {
                            TypeSym::Builtin(b) => Some(Recv::Builtin(b)),
                            TypeSym::Def(d) => Some(if matches!(self.defs[d].kind, DefKind::Interface { .. }) { Recv::Iface(d) } else { Recv::Def(d) }),
                        };
                        let found = key.and_then(|k| self.methods.get(&k)).and_then(|m| m.get(&name.name)).and_then(|f| f.first()).copied();
                        return match found {
                            Some(f) => self.call_fn(cx, f, None, args, expect, span),
                            None => {
                                self.error(file, codes::UNKNOWN_FN, name.span, format!("`{}` has no fn `{}`", tn.name, name.name));
                                (ir::Expr::Num("0".into()), Ty::Err)
                            }
                        };
                    }
                    if let Some(ValueSym::Channel(c)) = self.lookup_value(file, &tn.name) {
                        if cx.local(&tn.name).is_none() {
                            return self.channel_call(cx, c, name, args, span);
                        }
                    }
                }
                let (recv, rt) = self.expr(cx, target, None);
                let bounds = cx.bounds.clone();
                let found = self.methods_of(&rt, &name.name, &bounds);
                if let Some(f) = self.pick(cx, &found, &rt) {
                    return self.call_fn(cx, f, Some((recv, rt, target)), args, expect, span);
                }
                // a field that holds a fn
                let fields = self.fields_in(cx, &rt);
                if let Some((_, ft)) = fields.into_iter().find(|(n, _)| *n == name.name) {
                    let fx = ir::Expr::Field(Box::new(ir::ExprField { value: recv, name: name.name.clone() }));
                    return self.apply_value(cx, fx, ft, args, span);
                }
                if !rt.is_err() {
                    let s = self.show(&rt);
                    self.error(file, codes::UNKNOWN_FN, name.span, format!("{} has no fn `{}`", s, name.name));
                }
                (ir::Expr::Num("0".into()), Ty::Err)
            }
            _ => self.apply(cx, callee, args, span),
        }
    }

    /// Of several fns of one name on a type, the one its receiver fits.
    fn pick(&mut self, cx: &Cx, found: &[usize], rt: &Ty) -> Option<usize> {
        if found.len() <= 1 {
            return found.first().copied();
        }
        let bounds = cx.bounds.clone();
        for f in found {
            let s = self.fns[*f].clone();
            let ok = s.generics.iter().all(|g| {
                g.bounds.iter().all(|(iface, _)| {
                    // a bound on the receiver's own type parameter: list<T: same>.has
                    match (self.vars.resolve(rt), g.name.as_str()) {
                        (Ty::List(item), _) if g.name != "self" => self.fits(&item, *iface, &[], &bounds),
                        _ => true,
                    }
                })
            });
            if ok {
                return Some(*f);
            }
        }
        found.first().copied()
    }

    fn apply(&mut self, cx: &mut Cx, callee: &ast::Expr, args: &ast::Group<ast::Arg>, span: Span) -> (ir::Expr, Ty) {
        let (f, ft) = self.expr(cx, callee, None);
        self.apply_value(cx, f, ft, args, span)
    }

    fn apply_value(&mut self, cx: &mut Cx, f: ir::Expr, ft: Ty, args: &ast::Group<ast::Arg>, span: Span) -> (ir::Expr, Ty) {
        let file = cx.file;
        let Ty::Fn(ps, ret) = self.vars.resolve(&ft) else {
            if !ft.is_err() {
                let s = self.show(&ft);
                self.error(file, codes::NOT_CALLABLE, span, format!("a {} can't be called", s));
            }
            return (ir::Expr::Num("0".into()), Ty::Err);
        };
        if ps.len() != args.len() {
            self.error(file, codes::ARGUMENTS, span, format!("this fn takes {} argument(s), and {} are given", ps.len(), args.len()));
        }
        let mut out = Vec::new();
        for (p, a) in ps.iter().zip(args.iter()) {
            let (x, _) = self.expr(cx, &a.value, Some(&p.ty));
            out.push(x);
        }
        let ret_ty = ret.map(|r| *r);
        let ty_ir = ret_ty.as_ref().map(|r| self.ir_ty(r));
        (ir::Expr::Apply(Box::new(ir::ExprApply { fn_: f, args: out, ty: ty_ir })), ret_ty.unwrap_or(Ty::Err))
    }

    fn channel_call(&mut self, cx: &mut Cx, c: usize, name: &ast::Ident, args: &ast::Group<ast::Arg>, span: Span) -> (ir::Expr, Ty) {
        let file = cx.file;
        let ch = self.channels[c].clone();
        let Some((_, ps, ret, ret_ir)) = ch.fns.iter().find(|f| f.0 == name.name).cloned() else {
            self.error(file, codes::UNKNOWN_FN, name.span, format!("extern `{}` has no fn `{}`", ch.name, name.name));
            return (ir::Expr::Num("0".into()), Ty::Err);
        };
        if ps.len() != args.len() {
            self.error(file, codes::ARGUMENTS, span, format!("`{}.{}` takes {} argument(s), and {} are given", ch.name, name.name, ps.len(), args.len()));
        }
        let mut out = Vec::new();
        for (p, a) in ps.iter().zip(args.iter()) {
            let (x, _) = self.expr(cx, &a.value, Some(&p.ty));
            out.push(x);
        }
        (call(&format!("{}.{}", ch.full, name.name), out, ret_ir), ret.unwrap_or(Ty::Err))
    }

    /// A call of a fn by its symbol, with a receiver when it is called on a value.
    pub(crate) fn call_fn(&mut self, cx: &mut Cx, f: usize, recv: Option<(ir::Expr, Ty, &ast::Expr)>, args: &ast::Group<ast::Arg>, _expect: Option<&Ty>, span: Span) -> (ir::Expr, Ty) {
        let file = cx.file;
        let s = self.fns[f].clone();
        let map: HashMap<String, Ty> = s.generics.iter().map(|g| (g.name.clone(), self.vars.fresh())).collect();
        let mut out = Vec::new();
        let mut params = s.params.iter();
        let recv_src = recv.as_ref().map(|r| r.2);
        if let Some((rx, rt, rsrc)) = recv {
            match params.next() {
                Some(p) if p.is_self => {
                    let pt = p.ty.subst(&map);
                    let bounds = cx.bounds.clone();
                    if self.accepts(&pt, &rt, &bounds).is_none() {
                        let (a, b) = (self.show(&pt), self.show(&rt));
                        self.error(file, codes::MISMATCH, rsrc.span, format!("`{}` is a fn on {}, not on {}", s.name, a, b));
                    }
                    if p.mutable {
                        out.push(self.place_arg(cx, rsrc));
                    } else {
                        out.push(self.coerce(file, rx, &rt, &pt, rsrc.span, &bounds));
                    }
                }
                _ => {
                    self.error(file, codes::ARGUMENTS, span, format!("`{}` is called on its type, not on a value", s.name));
                }
            }
        }
        let rest: Vec<&ParamSym> = params.collect();
        if args.iter().any(|a| a.name.is_some()) {
            let at = args.iter().find(|a| a.name.is_some()).unwrap().name.as_ref().unwrap().span;
            self.error(file, codes::NAMED_TO_FN, at, format!("`{}` is a fn: its arguments go in order, without names", s.name));
        }
        if rest.len() != args.len() {
            self.error(file, codes::ARGUMENTS, span, format!("`{}` takes {} argument(s), and {} are given", s.name, rest.len(), args.len()));
        }
        for (p, a) in rest.iter().zip(args.iter()) {
            let pt = p.ty.subst(&map);
            if p.mutable {
                let place = self.place_arg(cx, &a.value);
                if let Some(k) = self.place_known(cx, &a.value) {
                    self.known_at.insert((cx.file, a.value.span.start, a.value.span.end), k);
                    self.want_shared(cx, &a.value, &p.ir, format!("`{}`'s `mut {}`", s.name, p.name));
                }
                out.push(place);
            } else {
                let (x, _) = self.expr(cx, &a.value, Some(&pt));
                self.want(cx, &a.value, &x, &p.ir, format!("`{}`'s `{}`", s.name, p.name));
                out.push(x);
            }
        }
        // add, insert and the removes change a list's length: not for a list with a length contract
        if matches!(s.full.as_str(), "core/list.add" | "core/list.insert" | "core/list.remove" | "core/list.remove_at" | "core/list.remove_where") {
            if let Some(r) = recv_src {
                if let Some(t) = self.place_ir(cx, r) {
                    if self.has_length(&t) {
                        self.error(file, codes::LENGTH_CHANGE, span, format!("`{}` changes a list's length, and this list has a length contract, {}: build a new list instead", s.name, crate::proof::show_contract(&t)));
                    }
                }
            }
        }
        let arg_exprs: Vec<&ast::Expr> = args.iter().map(|a| &a.value).collect();
        self.note_call_known(cx, span, f, recv_src, &arg_exprs);
        let ret = s.ret.as_ref().map(|r| self.vars.resolve(&r.subst(&map)));
        let ty = ret.as_ref().map(|r| self.ir_ty(r));
        (call(&s.full, out, ty), ret.unwrap_or(Ty::Err))
    }

    /// An argument to a `mut` parameter: the place it writes.
    fn place_arg(&mut self, cx: &mut Cx, e: &ast::Expr) -> ir::Expr {
        match self.place(cx, e) {
            Some((p, _)) => ir::Expr::Place(p),
            None => {
                self.error(cx.file, codes::NOT_MUT, e.span, "a `mut` parameter is given something it can write: a `mut` variable, a field of one, or a `mut for` variable");
                let (x, _) = self.expr(cx, e, None);
                x
            }
        }
    }

    /// Where an assignment or a `mut` argument writes, and its type.
    pub(crate) fn place(&mut self, cx: &mut Cx, e: &ast::Expr) -> Option<(ir::Place, Ty)> {
        match &e.kind {
            E::Name(n) => {
                if let Some(l) = cx.local(&n.name).cloned() {
                    if !l.mutable && l.kind == LocalKind::Plain {
                        return None;
                    }
                    let ty = if l.kind == LocalKind::MutFor { l.ty.clone() } else { l.ty.clone() };
                    return Some((ir::Place { root: ir::Root::Local(n.name.clone()), path: Vec::new() }, ty));
                }
                let w = cx.widget.clone()?;
                if let Some((_, t, m)) = w.inputs.iter().find(|i| i.0 == n.name) {
                    return m.then(|| (ir::Place { root: ir::Root::Input(n.name.clone()), path: Vec::new() }, t.clone()));
                }
                if let Some((_, t)) = w.cells.iter().find(|c| c.0 == n.name) {
                    return Some((ir::Place { root: ir::Root::Cell(n.name.clone()), path: Vec::new() }, t.clone()));
                }
                None
            }
            E::SelfValue => {
                let l = cx.local("self")?.clone();
                l.mutable.then(|| (ir::Place { root: ir::Root::Local("self".into()), path: Vec::new() }, l.ty))
            }
            E::Field { target, name } => {
                if let E::State = target.kind {
                    let t = cx.state.as_ref()?.iter().find(|f| f.0 == name.name)?.1.clone();
                    return Some((ir::Place { root: ir::Root::State(name.name.clone()), path: Vec::new() }, t));
                }
                let (mut p, t) = self.place(cx, target)?;
                let fields = self.fields_in(cx, &t);
                let (_, ft) = fields.into_iter().find(|(n, _)| *n == name.name)?;
                p.path.push(ir::Step::Field(ir::StepField { name: name.name.clone() }));
                Some((p, ft))
            }
            E::Index { target, index } => {
                let (mut p, t) = self.place(cx, target)?;
                let item = match self.vars.resolve(&t) {
                    Ty::List(x) => *x,
                    _ => return None,
                };
                let (i, _) = self.expr(cx, index, Some(&Ty::Num));
                p.path.push(ir::Step::Item(ir::StepItem { at: i }));
                Some((p, item))
            }
            E::Paren(inner) => self.place(cx, inner),
            _ => None,
        }
    }

    // ---- statements

    pub fn block(&mut self, cx: &mut Cx, b: &ast::Block) -> Vec<ir::Stmt> {
        cx.push();
        let mut out = Vec::new();
        for s in &b.stmts {
            out.extend(self.stmt(cx, &s.item));
        }
        cx.pop();
        out
    }

    pub fn stmt(&mut self, cx: &mut Cx, s: &ast::Stmt) -> Vec<ir::Stmt> {
        let file = cx.file;
        use ast::Stmt as S;
        let one = match s {
            S::Let(v) | S::Mut(v) => {
                let mutable = matches!(s, S::Mut(_));
                let ty = self.resolve(file, &v.ty, &cx.generics.clone());
                let ty_ir = self.ir_type(file, &v.ty, &cx.generics.clone());
                let (x, _) = self.expr(cx, &v.value, Some(&ty));
                self.want(cx, &v.value, &x, &ty_ir, format!("`{}`", v.name.name));
                self.declare_local(cx, &v.name, ty, mutable, LocalKind::Plain);
                crate::proof::set_known(cx, &v.name.name, Known::of(&ty_ir));
                let l = ir::Local { name: v.name.name.clone(), ty: ty_ir, value: x };
                ir::Stmt::Declare(if mutable { ir::StmtDeclare::Mut(l) } else { ir::StmtDeclare::Let(l) })
            }
            S::Return(e) => {
                let want = cx.ret.clone().flatten();
                let value = match (e, &want) {
                    (Some(e), Some(w)) => {
                        let w = w.clone();
                        let x = self.expr(cx, e, Some(&w)).0;
                        if let Some(r) = cx.ret_ir.clone() {
                            self.want(cx, e, &x, &r, "the return value");
                        }
                        Some(x)
                    }
                    (Some(e), None) => {
                        self.error(file, codes::RETURN, e.span, "this fn has no return type, so `return` gives back nothing: add a return type to return a value");
                        Some(self.expr(cx, e, None).0)
                    }
                    (None, Some(_)) => {
                        self.error(file, codes::RETURN, Span::default(), "this fn returns a value: `return` needs one");
                        None
                    }
                    (None, None) => None,
                };
                ir::Stmt::Return(ir::StmtReturn { value })
            }
            S::Invoke { name, args } => {
                let ev = cx.widget.as_ref().and_then(|w| w.events.iter().find(|e| e.name == name.name).cloned());
                let Some(ev) = ev else {
                    self.error(file, codes::UNKNOWN_NAME, name.span, format!("there is no event `{}` here", name.name));
                    return Vec::new();
                };
                let mut out = Vec::new();
                for (p, a) in ev.params.iter().zip(args.iter()) {
                    let x = self.expr(cx, &a.value, Some(&p.ty)).0;
                    self.want(cx, &a.value, &x, &p.ir, format!("`{}`'s `{}`", name.name, p.name));
                    out.push(x);
                }
                ir::Stmt::Invoke(ir::StmtInvoke { event: name.name.clone(), args: out })
            }
            S::If(i) => {
                let mut branches = Vec::new();
                for (c, b) in &i.branches {
                    cx.push();
                    let when = self.cond(cx, c);
                    let then = self.block(cx, b);
                    cx.pop();
                    branches.push(ir::StmtIfBranches { when, then });
                }
                let else_ = i.otherwise.as_ref().map(|b| self.block(cx, b)).unwrap_or_default();
                ir::Stmt::If(ir::StmtIf { branches, else_ })
            }
            S::For(f) => {
                cx.push();
                let (over, item) = self.loop_over(cx, f.mutable, &f.over);
                if let Some(k) = &f.key {
                    self.declare_local(cx, k, Ty::Num, false, LocalKind::Plain);
                }
                let var_ty = if f.mutable { Ty::opt(item.clone()) } else { item.clone() };
                self.declare_local(cx, &f.name, var_ty, false, if f.mutable { LocalKind::MutFor } else { LocalKind::Plain });
                if !f.mutable {
                    self.loop_known(cx, &f.over, f.key.as_ref(), &f.name);
                }
                let body = self.block(cx, &f.body);
                cx.pop();
                ir::Stmt::For(ir::StmtFor { mutable: f.mutable, name: f.name.name.clone(), position: f.key.as_ref().map(|k| k.name.clone()), ty: self.ir_ty(&item), over, body })
            }
            S::Match(m) => {
                let (v, vt) = self.expr(cx, &m.subject, None);
                let mut cases = Vec::new();
                let mut else_ = Vec::new();
                let mut has_else = false;
                for c in m.cases.iter() {
                    cx.push();
                    if c.patterns.is_empty() {
                        has_else = true;
                        else_ = self.block(cx, &c.body);
                    } else {
                        let when = self.patterns(cx, &c.patterns, &vt);
                        let then = self.block(cx, &c.body);
                        cases.push(ir::StmtMatchCases { when, then });
                    }
                    cx.pop();
                }
                self.check_match(file, &vt, &m.cases.items.iter().map(|n| n.item.patterns.clone()).collect::<Vec<_>>(), has_else, m.span);
                ir::Stmt::Match(ir::StmtMatch { value: v, cases, else_ })
            }
            S::Expr(e) => {
                let (x, _) = self.expr(cx, e, None);
                match x {
                    ir::Expr::Call(c) => ir::Stmt::Call(*c),
                    ir::Expr::Apply(a) => ir::Stmt::Apply(ir::StmtApply { fn_: a.fn_, args: a.args }),
                    _ => {
                        self.error(file, codes::MISMATCH, e.span, "a statement on its own is a call of an action");
                        return Vec::new();
                    }
                }
            }
            S::Assign { place, value } => {
                let Some((p, t)) = self.place(cx, place) else {
                    self.error(file, codes::NOT_MUT, place.span, "only a `mut` variable, a field of one, or a `mut` input can be assigned");
                    return Vec::new();
                };
                let (x, _) = self.expr(cx, value, Some(&t));
                // every write needs the same proof: `level = (level + 1).clamp(0, 10);`
                if let Some(w) = self.place_ir(cx, place) {
                    self.want(cx, value, &x, &w, "this place");
                }
                ir::Stmt::Set(ir::StmtSet { place: p, value: x })
            }
        };
        vec![one]
    }

    pub(crate) fn cond(&mut self, cx: &mut Cx, c: &ast::Cond) -> ir::Cond {
        let file = cx.file;
        match c {
            ast::Cond::Expr(e) => {
                let x = self.expr(cx, e, Some(&Ty::Bool)).0;
                self.narrow(cx, e);
                ir::Cond::Cond(x)
            }
            ast::Cond::Open { mutable, name, ty, value } => {
                let t = self.resolve(file, ty, &cx.generics.clone());
                let opt = if *mutable {
                    match self.place(cx, value) {
                        Some((p, _)) => ir::Expr::Place(p),
                        None => {
                            self.error(file, codes::NOT_MUT, value.span, "`if (mut …)` opens an opt it can write: a `mut` variable, a field of one, or a `mut for` variable");
                            self.expr(cx, value, None).0
                        }
                    }
                } else {
                    self.expr(cx, value, Some(&Ty::opt(t.clone()))).0
                };
                self.declare_local(cx, name, t.clone(), *mutable, if *mutable { LocalKind::OpenMut } else { LocalKind::Plain });
                let declared = self.ir_type(file, ty, &cx.generics.clone());
                crate::proof::set_known(cx, &name.name, Known::of(&declared));
                ir::Cond::Open(ir::CondOpen { mutable: *mutable, name: name.name.clone(), ty: self.ir_ty(&t), opt })
            }
        }
    }

    /// What a loop walks, and the type of each item.
    pub(crate) fn loop_over(&mut self, cx: &mut Cx, mutable: bool, over: &ast::Expr) -> (ir::Expr, Ty) {
        let file = cx.file;
        if mutable {
            return match self.place(cx, over) {
                Some((p, t)) => {
                    let item = match self.vars.resolve(&t) {
                        Ty::List(x) => *x,
                        _ => Ty::Err,
                    };
                    (ir::Expr::Place(p), item)
                }
                None => {
                    self.error(file, codes::NOT_MUT, over.span, "`mut for` walks a `mut` list");
                    (self.expr(cx, over, None).0, Ty::Err)
                }
            };
        }
        let (x, t) = self.expr(cx, over, None);
        let item = match self.vars.resolve(&t) {
            Ty::List(i) => *i,
            Ty::Range(i) => *i,
            Ty::Err => Ty::Err,
            other => {
                let s = self.show(&other);
                self.error(file, codes::MISMATCH, over.span, format!("`for` walks a list or a range, not a {}", s));
                Ty::Err
            }
        };
        (x, item)
    }

    pub(crate) fn patterns(&mut self, cx: &mut Cx, pats: &[ast::Pattern], vt: &Ty) -> Vec<ir::Pattern> {
        let file = cx.file;
        let mut out = Vec::new();
        for p in pats {
            out.push(match p {
                ast::Pattern::Case { ty, case, binds } => {
                    // each bound value's declared type, for its contract
                    let mut declared: Vec<ir::Type> = Vec::new();
                    let fields: Vec<Ty> = match self.lookup_type(file, &ty.name) {
                        Some(TypeSym::Builtin("opt")) => match self.vars.resolve(vt) {
                            Ty::Opt(inner) if case.name == "SOME" => vec![*inner],
                            _ => Vec::new(),
                        },
                        Some(TypeSym::Def(d)) => {
                            let cases = match &self.defs[d].kind {
                                DefKind::Enum { cases } | DefKind::Token { cases, .. } => cases.clone(),
                                _ => Vec::new(),
                            };
                            let map = match self.vars.resolve(vt) {
                                Ty::Def(e, a) if e == d => self.generic_map(d, &a),
                                _ => HashMap::new(),
                            };
                            match cases.iter().find(|c| c.name == case.name) {
                                Some(c) => {
                                    declared = c.fields.iter().map(|f| f.ir.clone()).collect();
                                    c.fields.iter().map(|f| f.ty.subst(&map)).collect()
                                }
                                None => {
                                    self.error(file, codes::UNKNOWN_CASE, case.span, format!("`{}` has no case `{}`", ty.name, case.name));
                                    Vec::new()
                                }
                            }
                        }
                        _ => {
                            self.error(file, codes::UNKNOWN_TYPE, ty.span, format!("there is no type `{}`", ty.name));
                            Vec::new()
                        }
                    };
                    let mut names = Vec::new();
                    for (k, b) in binds.iter().flatten().enumerate() {
                        let t = fields.get(k).cloned().unwrap_or(Ty::Err);
                        self.declare_local(cx, b, t, false, LocalKind::Plain);
                        if let Some(d) = declared.get(k) {
                            crate::proof::set_known(cx, &b.name, Known::of(d));
                        }
                        names.push(b.name.clone());
                    }
                    let full = match self.lookup_type(file, &ty.name) {
                        Some(TypeSym::Def(d)) => self.defs[d].full.clone(),
                        _ => format!("core/{}", ty.name),
                    };
                    ir::Pattern::Case(ir::PatternCase { enum_: full, name: case.name.clone(), binds: names })
                }
                ast::Pattern::Number { negative, text, .. } => ir::Pattern::Num(format!("{}{}", if *negative { "-" } else { "" }, text.replace('_', ""))),
                ast::Pattern::Text(t) => ir::Pattern::Text(t.parts.iter().map(|p| if let ast::TextPart::Piece { raw, .. } = p { decode_piece(raw) } else { String::new() }).collect()),
                ast::Pattern::Bool(b, _) => ir::Pattern::Bool(*b),
            });
        }
        out
    }

    /// A match covers every case of an enum or a bool; a token, a number or a text needs `case else`.
    pub(crate) fn check_match(&mut self, file: usize, vt: &Ty, cases: &[Vec<ast::Pattern>], has_else: bool, at: Span) {
        if has_else {
            return;
        }
        match self.vars.resolve(vt) {
            Ty::Def(d, _) => match &self.defs[d].kind {
                DefKind::Token { .. } => {
                    let n = self.defs[d].name.clone();
                    self.error(file, codes::MATCH_ELSE, at, format!("a match on the token type `{}` needs `case else`: a pack may add cases to it", n));
                }
                DefKind::Enum { cases: all } => {
                    let named: HashSet<String> = cases.iter().flatten().filter_map(|p| if let ast::Pattern::Case { case, .. } = p { Some(case.name.clone()) } else { None }).collect();
                    let missing: Vec<String> = all.iter().filter(|c| !named.contains(&c.name)).map(|c| c.name.clone()).collect();
                    if !missing.is_empty() {
                        self.error(file, codes::MATCH_CASES, at, format!("this match misses {}: list every case, or add `case else`", missing.join(", ")));
                    }
                }
                _ => {}
            },
            Ty::Opt(_) | Ty::Bool | Ty::Err => {}
            Ty::Num | Ty::Text => self.error(file, codes::MATCH_ELSE, at, "a match on a number or a text needs `case else`"),
            _ => {}
        }
    }
}

/// Whether a block returns a value somewhere in it.
fn block_returns_value(b: &ast::Block) -> bool {
    b.stmts.iter().any(|s| match &s.item {
        ast::Stmt::Return(Some(_)) => true,
        ast::Stmt::If(i) => i.branches.iter().any(|(_, b)| block_returns_value(b)) || i.otherwise.as_ref().map_or(false, block_returns_value),
        ast::Stmt::For(f) => block_returns_value(&f.body),
        ast::Stmt::Match(m) => m.cases.iter().any(|c| block_returns_value(&c.body)),
        _ => false,
    })
}
