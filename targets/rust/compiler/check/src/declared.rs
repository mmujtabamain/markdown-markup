//! Rules on declarations and on the types written in them (pages 2 and 4): what an interface may
//! ask for and whether `implements` is kept, recursion only inside `list` or `opt`, type
//! parameters that the values work out, `any` of an interface that compares or adds, and
//! contracts: a range only on an ordered type, contracts that can both hold, `only` on a type
//! that fits `same`.

use std::collections::HashSet;

use mkp_ir::ir;
use mkp_syntax::Span;

use crate::ty::{FnParam, Ty};
use crate::{codes, Checker, DefId, DefKind, Recv};

/// A rule on a type as it was written, checked once every signature is known.
#[derive(Clone, Debug)]
pub enum TypeRule {
    /// A range on a type that may not be ordered.
    Range { file: usize, span: Span, def: DefId },
    /// A contract written on an alias that has its own.
    Both { file: usize, span: Span, alias: DefId, written: ir::Contract },
    /// `only (…)` on a type that may not fit `same`.
    Only { file: usize, span: Span, def: DefId },
    /// `any` of an interface.
    Any { file: usize, span: Span, iface: DefId },
}

fn mentions(t: &Ty, p: &str) -> bool {
    match t {
        Ty::Param(n) => n == p,
        Ty::List(x) | Ty::Opt(x) | Ty::Range(x) => mentions(x, p),
        Ty::Def(_, a) | Ty::Any(_, a) => a.iter().any(|x| mentions(x, p)),
        Ty::Fn(ps, r) => ps.iter().any(|q| mentions(&q.ty, p)) || r.as_ref().map_or(false, |r| mentions(r, p)),
        Ty::Inline(fs) => fs.iter().any(|(_, x)| mentions(x, p)),
        _ => false,
    }
}

fn has_self(t: &Ty) -> bool {
    match t {
        // inside an interface's own fns, `self` is the type parameter `self`
        Ty::SelfT => true,
        Ty::Param(n) if n == "self" => true,
        Ty::List(x) | Ty::Opt(x) | Ty::Range(x) => has_self(x),
        Ty::Def(_, a) | Ty::Any(_, a) => a.iter().any(has_self),
        Ty::Fn(ps, r) => ps.iter().any(|q: &FnParam| has_self(&q.ty)) || r.as_ref().map_or(false, |r| has_self(r)),
        _ => false,
    }
}

impl Checker {
    fn core_iface(&self, name: &str) -> Option<DefId> {
        self.defs.iter().position(|d| d.full == format!("core/{}", name) && matches!(d.kind, DefKind::Interface { .. }))
    }

    /// The rules on each declaration of this compile, once every signature is known.
    pub(crate) fn check_declarations(&mut self) {
        for d in self.from.defs..self.defs.len() {
            let def = self.defs[d].clone();
            match &def.kind {
                DefKind::Interface { fields, .. } => {
                    for f in fields.iter().filter(|f| f.mutable) {
                        self.error(def.file, codes::INTERFACE_MUT, f.span, format!("an interface can't ask for a `mut` field: `{}` is read through any type that fits `{}`, never written", f.name, def.name));
                    }
                }
                DefKind::Record { .. } | DefKind::Enum { .. } => self.check_recursion(d),
                _ => {}
            }
            self.check_implements(d);
            self.check_type_params(d);
            // a slot or a view held in an input can't take a visible widget's name
            if let DefKind::Widget { slots, inputs, .. } = &def.kind {
                let named: Vec<(String, bool)> = slots.iter().map(|s| (s.name.clone(), true)).chain(inputs.iter().map(|i| (i.name.clone(), self.is_view_type(&i.ty)))).collect();
                for (name, is_view) in named {
                    if is_view {
                        self.check_view_name(def.file, &name, def.span);
                    }
                }
            }
        }
        // nor can a fn that returns a view
        for f in self.from.fns..self.fns.len() {
            let s = self.fns[f].clone();
            if s.on.is_none() && s.ret.as_ref().map_or(false, |r| self.is_view_type(r)) {
                self.check_view_name(s.file, &s.name, s.span);
            }
        }
        // a generic fn's type parameters are worked out from its parameters
        for f in self.from.fns..self.fns.len() {
            let s = self.fns[f].clone();
            // `self` stands for the type that fits, inside an interface's own fns
            for g in s.generics.iter().filter(|g| g.name != "self") {
                let in_params = s.params.iter().any(|p| mentions(&p.ty, &g.name));
                // a fn added to a generic type, `fn list<T>.len(self)`, gets T from its receiver
                let on_generic = s.params.iter().any(|p| p.is_self);
                if !in_params && !on_generic {
                    self.error(s.file, codes::UNUSED_PARAM, s.span, format!("`{}` can't be worked out at a call: a type parameter has to appear in a parameter's type, as type arguments are never written at a use", g.name));
                }
            }
        }
        self.check_type_rules();
        self.check_fn_clashes();
    }

    /// Two visible fns with one name on one type are a compile error, on the import that brings
    /// in the second; one of them is imported under another name instead (page 4).
    fn check_fn_clashes(&mut self) {
        for file in self.from.files..self.files.len() {
            let own = self.files[file].pack.clone();
            // the packs a file sees whole, and the names it brings in one by one, by import
            let mut whole: Vec<(String, Span)> = Vec::new();
            let mut one_by_one: Vec<(String, String, Span)> = Vec::new();
            let ast = self.files[file].ast.clone();
            for node in &ast.items {
                let mkp_syntax::ast::Item::Import(imp) = &node.item else { continue };
                match imp.path.get(1) {
                    None => whole.push((imp.path[0].name.clone(), imp.span)),
                    Some(n) if imp.alias.is_none() => one_by_one.push((imp.path[0].name.clone(), n.name.clone(), imp.span)),
                    _ => {}
                }
            }
            let provided = |c: &Checker, pack: &str, name: &str| c.packs.get(pack).and_then(|p| p.provides.as_ref()).map_or(false, |ps| ps.contains(name));
            for (recv, by_name) in self.methods.clone() {
                if !matches!(recv, Recv::Def(_) | Recv::Builtin(_)) {
                    continue;
                }
                for (name, fns) in by_name {
                    // where each visible pack's fn of this name comes into the file
                    let mut seen: Vec<(String, Option<Span>)> = Vec::new();
                    for f in fns {
                        let pack = self.fns[f].pack.clone();
                        let at = if pack == own || pack == "core" {
                            Some(None)
                        } else if let Some((_, s)) = whole.iter().find(|(p, _)| *p == pack).filter(|_| provided(self, &pack, &name)) {
                            Some(Some(*s))
                        } else {
                            one_by_one.iter().find(|(p, n, _)| *p == pack && *n == name).map(|(_, _, s)| Some(*s))
                        };
                        if let Some(at) = at {
                            if !seen.iter().any(|(p, _)| *p == pack) {
                                seen.push((pack, at));
                            }
                        }
                    }
                    if seen.len() > 1 {
                        let later = seen.iter().filter_map(|(_, s)| *s).max_by_key(|s| s.start);
                        let packs: Vec<String> = seen.iter().map(|(p, _)| format!("`{}`", p)).collect();
                        if let Some(at) = later {
                            self.error(file, codes::FN_CLASH, at, format!("`{}` comes from {} on one type: import one under another name, `import {}.{} as {}_{};`", name, packs.join(" and "), seen.last().unwrap().0, name, seen.last().unwrap().0, name));
                        }
                    }
                }
            }
        }
    }

    /// `implements` is a checked promise: every field and fn the interface asks for is there.
    fn check_implements(&mut self, d: DefId) {
        let def = self.defs[d].clone();
        for (i, args) in &def.implements {
            let iface = self.defs[*i].clone();
            let DefKind::Interface { fields: want, fns, .. } = &iface.kind else { continue };
            let have: Vec<(String, Ty)> = match &def.kind {
                DefKind::Record { fields } | DefKind::Widget { inputs: fields, .. } => fields.iter().map(|f| (f.name.clone(), f.ty.clone())).collect(),
                _ => Vec::new(),
            };
            let map = self.generic_map(*i, args);
            for w in want {
                let wt = w.ty.subst(&map).subst_self(&Ty::Def(d, Vec::new()));
                match have.iter().find(|(n, _)| *n == w.name) {
                    Some((_, t)) => {
                        if self.accepts(&wt, t, &def.generics.clone()).is_none() {
                            let (a, b) = (self.show(&wt), self.show(t));
                            self.error(def.file, codes::IMPLEMENTS, def.span, format!("`{}` implements `{}`, which asks for `{}: {}`; it has `{}: {}`", def.name, iface.name, w.name, a, w.name, b));
                        }
                    }
                    None => {
                        let a = self.show(&wt);
                        self.error(def.file, codes::IMPLEMENTS, def.span, format!("`{}` implements `{}`, which asks for a field `{}: {}`", def.name, iface.name, w.name, a));
                    }
                }
            }
            for name in fns {
                // a fn the interface gives a body to is there already
                let declared = self.methods.get(&Recv::Iface(*i)).and_then(|m| m.get(name)).and_then(|fs| fs.first().copied());
                // and one core declares extern is supplied for every type: records compare field by
                // field unless their pack writes `same` (page 2)
                if declared.map_or(false, |f| self.fns[f].body.is_some() || self.fns[f].external) {
                    continue;
                }
                // only fns of the type's pack or the interface's count
                let own = self.methods.get(&Recv::Def(d)).and_then(|m| m.get(name)).map_or(false, |fs| fs.iter().any(|f| self.fns[*f].pack == def.pack || self.fns[*f].pack == iface.pack));
                if !own {
                    self.error(def.file, codes::IMPLEMENTS, def.span, format!("`{}` implements `{}`, which asks for `fn {}.{}`, declared in `{}`'s pack or `{}`'s", def.name, iface.name, def.name, name, def.name, iface.name));
                }
            }
        }
    }

    /// A record or an enum holds its own type only inside a `list` or an `opt`.
    fn check_recursion(&mut self, d: DefId) {
        fn direct(c: &Checker, t: &Ty, out: &mut Vec<DefId>) {
            match t {
                Ty::Def(e, _) if matches!(c.defs[*e].kind, DefKind::Record { .. } | DefKind::Enum { .. }) => out.push(*e),
                Ty::Inline(fs) => fs.iter().for_each(|(_, x)| direct(c, x, out)),
                // a list or an opt may be empty, so it ends the chain
                _ => {}
            }
        }
        let next = |c: &Checker, e: DefId| -> Vec<DefId> {
            let mut out = Vec::new();
            match &c.defs[e].kind {
                DefKind::Record { fields } => fields.iter().for_each(|f| direct(c, &f.ty, &mut out)),
                // an enum is one of its cases: it holds itself only when every case does
                DefKind::Enum { cases } if cases.iter().all(|k| !k.fields.is_empty()) => cases.iter().flat_map(|k| k.fields.iter()).for_each(|f| direct(c, &f.ty, &mut out)),
                _ => {}
            }
            out
        };
        let mut seen = HashSet::new();
        let mut todo = next(self, d);
        while let Some(e) = todo.pop() {
            if e == d {
                let def = self.defs[d].clone();
                self.error(def.file, codes::RECURSIVE, def.span, format!("`{}` holds its own type directly, so a value of it could never end: hold it inside a `list` or an `opt`", def.name));
                return;
            }
            if seen.insert(e) {
                todo.extend(next(self, e));
            }
        }
    }

    /// Every type parameter of a type or a widget appears in a field, an input or a slot.
    fn check_type_params(&mut self, d: DefId) {
        let def = self.defs[d].clone();
        let types: Vec<Ty> = match &def.kind {
            DefKind::Record { fields } => fields.iter().map(|f| f.ty.clone()).collect(),
            DefKind::Enum { cases } => cases.iter().flat_map(|c| c.fields.iter().map(|f| f.ty.clone())).collect(),
            DefKind::Widget { inputs, slots, events, .. } => inputs.iter().map(|f| f.ty.clone()).chain(slots.iter().map(|s| s.ty.clone())).chain(events.iter().flat_map(|e| e.params.iter().map(|p| p.ty.clone()))).collect(),
            _ => return,
        };
        for g in &def.generics {
            if !types.iter().any(|t| mentions(t, &g.name)) {
                self.error(def.file, codes::UNUSED_PARAM, def.span, format!("`{}` can't be worked out from a value of `{}`: a type parameter has to appear in a field, an input or a slot", g.name, def.name));
            }
        }
    }

    /// The rules on types as they were written, now that every signature is known.
    pub(crate) fn check_type_rules(&mut self) {
        let rules = std::mem::take(&mut self.type_rules);
        let ordered = self.core_iface("ordered");
        let same = self.core_iface("same");
        let mut seen = HashSet::new();
        for r in rules {
            match r {
                TypeRule::Range { file, span, def } => {
                    let t = self.alias_end(Ty::Def(def, Vec::new()));
                    let ok = match &t {
                        Ty::Num | Ty::Dur => true,
                        Ty::Def(d, _) => ordered.map_or(true, |o| self.fits(&t, o, &[], &[])) && !matches!(self.defs[*d].kind, DefKind::Widget { .. }),
                        Ty::Err | Ty::Param(_) => true,
                        _ => false,
                    };
                    if !ok {
                        let s = self.show(&t);
                        self.error(file, codes::RANGE_UNORDERED, span, format!("a range is for numbers, durations, dates and other types that fit `ordered`; `{}` doesn't", s));
                    }
                }
                TypeRule::Only { file, span, def } => {
                    let t = self.alias_end(Ty::Def(def, Vec::new()));
                    if !matches!(t, Ty::Num | Ty::Dur | Ty::Text | Ty::Bool | Ty::Err) && same.map_or(false, |s| !self.fits(&t, s, &[], &[])) {
                        let s = self.show(&t);
                        self.error(file, codes::ONLY_NOT_SAME, span, format!("`only (…)` lists values of a type that fits `same`, so they can be compared; `{}` doesn't", s));
                    }
                }
                TypeRule::Both { file, span, alias, written } => {
                    let DefKind::Alias { target: Some((_, own)) } = self.defs[alias].kind.clone() else { continue };
                    let Some(c) = own.contract else { continue };
                    let steps = (c.step.as_ref(), written.step.as_ref());
                    let clash = match steps {
                        (Some(a), Some(b)) => a != b,
                        _ => false,
                    };
                    let apart = match (&c.range, &written.range) {
                        (Some(a), Some(b)) => disjoint(a, b),
                        _ => false,
                    };
                    if clash || apart {
                        let name = self.defs[alias].name.clone();
                        self.error(file, codes::CANNOT_BOTH, span, format!("this contract and `{}`'s own can't both hold: {}", name, if clash { "a value has one step" } else { "the two ranges don't meet" }));
                    }
                }
                TypeRule::Any { file, span, iface } => {
                    if !seen.insert((file, span.start)) {
                        continue;
                    }
                    let compares = self.methods.get(&Recv::Iface(iface)).map_or(false, |m| {
                        m.values().flatten().any(|f| self.fns[*f].params.iter().any(|p| !p.is_self && has_self(&p.ty)))
                    });
                    if compares {
                        let name = self.defs[iface].name.clone();
                        self.error(file, codes::ANY_SELF, span, format!("`any {}` can't work: `{}` takes a second value of the same type, and two `any {}` values may be different types. Use a type parameter, `<T: {}>`", name, name, name, name));
                    }
                }
            }
        }
    }

    /// An alias worked out to the type it names.
    fn alias_end(&self, t: Ty) -> Ty {
        let mut t = t;
        for _ in 0..16 {
            match &t {
                Ty::Def(d, _) => match &self.defs[*d].kind {
                    DefKind::Alias { target: Some((x, _)) } => t = x.clone(),
                    _ => return t,
                },
                _ => return t,
            }
        }
        t
    }
}

/// Two ranges with number bounds that don't meet.
fn disjoint(a: &ir::Bounds, b: &ir::Bounds) -> bool {
    let num = |x: &Option<ir::Expr>| match x {
        Some(ir::Expr::Num(t)) => t.parse::<f64>().ok(),
        _ => None,
    };
    let (al, ah, bl, bh) = (num(&a.low), num(&a.high), num(&b.low), num(&b.high));
    matches!((ah, bl), (Some(h), Some(l)) if h < l) || matches!((bh, al), (Some(h), Some(l)) if h < l)
}

impl Checker {
    /// `==` and `!=` need `same`; `<`, `<=`, `>`, `>=` and `in` need `ordered`. A view, a widget
    /// and a fn fit neither (page 4).
    pub(crate) fn check_comparable(&mut self, cx: &crate::body::Cx, t: &Ty, iface: &str, op: mkp_syntax::ast::BinOp, span: Span) {
        let t = self.vars.resolve(t);
        let never = match &t {
            Ty::View | Ty::Fn(..) => true,
            Ty::Def(d, _) => matches!(self.defs[*d].kind, DefKind::Widget { .. }),
            Ty::Any(d, _) => matches!(self.defs[*d].kind, DefKind::Interface { widget: true, .. }),
            _ => false,
        };
        let fits = !never
            && match (&t, self.core_iface(iface)) {
                (Ty::Err | Ty::Var(_), _) | (_, None) => true,
                // records compare field by field unless their pack writes `same` (page 2)
                (Ty::Def(d, _), _) if iface == "same" && matches!(self.defs[*d].kind, DefKind::Record { .. } | DefKind::Enum { .. } | DefKind::Token { .. }) => true,
                // a list, an opt and a range compare item by item, as a record that holds one must
                (Ty::Inline(_), _) if iface == "same" => true,
                (Ty::List(x) | Ty::Opt(x) | Ty::Range(x), _) if iface == "same" => {
                    let inner = (**x).clone();
                    let before = self.diags.len();
                    self.check_comparable(cx, &inner, iface, op, span);
                    let ok = self.diags.len() == before;
                    self.diags.truncate(before);
                    ok
                }
                (_, Some(i)) => self.fits(&t, i, &[], &cx.bounds.clone()),
            };
        if !fits {
            let s = self.show(&t);
            self.error(cx.file, codes::NOT_COMPARABLE, span, format!("`{}` needs values that fit `{}`, and `{}` doesn't", op.text(), iface, s));
        }
    }
}

impl Checker {
    /// A hole's value fits `shown`, is a view where views go, or is an `opt` of one (page 1).
    pub(crate) fn check_hole(&mut self, cx: &crate::body::Cx, t: &Ty, span: Span, views_go: bool) {
        let t = match self.vars.resolve(t) {
            Ty::Opt(inner) => self.vars.resolve(&inner),
            other => other,
        };
        if t.is_err() || matches!(t, Ty::Var(_)) {
            return;
        }
        // a type parameter bounded by a widget interface is a view too: `<T: chart>`
        let widget_param = match &t {
            Ty::Param(p) => cx.bounds.iter().filter(|b| &b.name == p).any(|b| b.bounds.iter().any(|(d, _)| matches!(self.defs[*d].kind, DefKind::Interface { widget: true, .. }))),
            _ => false,
        };
        // a view: `view`, a widget, `any` of a widget interface, or a parameter bounded by one
        let view = match &t {
            Ty::View => true,
            Ty::Def(d, _) => matches!(self.defs[*d].kind, DefKind::Widget { .. }),
            Ty::Any(d, _) => matches!(self.defs[*d].kind, DefKind::Interface { widget: true, .. }),
            _ => false,
        };
        if view || widget_param {
            if !views_go {
                self.error(cx.file, codes::VIEW_IN_TEXT, span, "a `text` can't hold a view: place it with `@`, or put it in prose or a `rich_text`, where a view goes in a sentence");
            }
            return;
        }
        // an md holds blocks: reported on its own
        if matches!(&t, Ty::Def(d, _) if self.defs[*d].full == "core/md") {
            return;
        }
        let shown = self.core_iface("shown");
        let ok = match (&t, shown) {
            (Ty::Num | Ty::Text | Ty::Bool | Ty::Dur, _) | (_, None) => true,
            (_, Some(s)) => self.fits(&t, s, &[], &cx.bounds.clone()),
        };
        if !ok {
            let s = self.show(&t);
            self.error(cx.file, codes::HOLE_NOT_SHOWN, span, format!("a hole's value is written as text, so it has to fit `shown`; a {} doesn't. Give its type a `show` fn, or put in one of its fields", s));
        }
    }
}

impl Checker {
    /// A slot, a fn that returns a view and a value that holds a view can't take the name of a
    /// visible widget, so what follows `@` has one reading whatever the order (page 1).
    pub(crate) fn check_view_name(&mut self, file: usize, name: &str, span: Span) {
        if let Some(crate::TypeSym::Def(w)) = self.lookup_type(file, name) {
            if matches!(self.defs[w].kind, DefKind::Widget { .. }) {
                self.error(file, codes::VIEW_NAMED_LIKE_WIDGET, span, format!("`{}` is a visible widget's name, so `@{}` would mean two things: give this view another name", name, name));
            }
        }
    }
}

impl Checker {
    /// `//@deprecated` on a declaration: its uses warn with that text. Read before signatures,
    /// which use types too.
    pub(crate) fn collect_deprecated(&mut self) {
        // `//@deprecated` on a declaration: its uses warn with that text
        for file in self.from.files..self.files.len() {
            let ast = self.files[file].ast.clone();
            for node in &ast.items {
                let Some(text) = node.docs().find_map(|c| c.text.strip_prefix("//@deprecated").map(|t| t.trim().to_string())) else { continue };
                if let mkp_syntax::ast::Item::Decl(d) = &node.item {
                    self.deprecated.insert((file, d.kind.name().span.start), text);
                }
            }
        }
    }

    /// A use of a `//@deprecated` declaration warns, with the declaration's text.
    pub(crate) fn warn_deprecated(&mut self, file: usize, decl_file: usize, decl_span: Span, at: Span) {
        if let Some(text) = self.deprecated.get(&(decl_file, decl_span.start)).cloned() {
            let said = if text.is_empty() { "this is deprecated".to_string() } else { format!("deprecated: {}", text) };
            self.warning(file, codes::DEPRECATED, at, said);
        }
    }
}
