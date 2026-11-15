//! Fitting interfaces, finding a value's fns, and accepting one type where another is wanted.

use crate::ty::Ty;
use crate::*;

/// What turns a value of one type into the type wanted.
#[derive(Clone, Debug, PartialEq)]
pub enum Conv {
    Same,
    /// A plain value where an `opt` is wanted, wrapped this many times.
    Wrap(usize),
}

impl Checker {
    /// The fns of `ty`'s own type are found under this key.
    pub fn recv_key(&self, ty: &Ty) -> Option<Recv> {
        Some(match self.vars.resolve(ty) {
            Ty::Num => Recv::Builtin("number"),
            Ty::Text => Recv::Builtin("text"),
            Ty::Bool => Recv::Builtin("bool"),
            Ty::Dur => Recv::Builtin("duration"),
            Ty::List(_) => Recv::Builtin("list"),
            Ty::Opt(_) => Recv::Builtin("opt"),
            Ty::Range(_) => Recv::Builtin("range"),
            Ty::View => Recv::Builtin("view"),
            Ty::Def(d, _) => Recv::Def(d),
            Ty::Any(d, _) => Recv::Iface(d),
            _ => return None,
        })
    }

    /// The pack a type is declared in: core for the built-in types.
    fn pack_of(&self, ty: &Ty) -> String {
        match self.vars.resolve(ty) {
            Ty::Def(d, _) | Ty::Any(d, _) => self.defs[d].pack.clone(),
            _ => "core".into(),
        }
    }

    fn is_std(&self, d: DefId, name: &str) -> bool {
        self.defs[d].pack == "core" && self.defs[d].name == name
    }

    /// Whether a type fits an interface: it has what the interface asks for (page 4).
    pub fn fits(&mut self, ty: &Ty, iface: DefId, args: &[Ty], bounds: &[TParam]) -> bool {
        let ty = self.vars.resolve(ty);
        match &ty {
            Ty::Err | Ty::Var(_) => return true,
            Ty::Param(p) => {
                return bounds.iter().filter(|b| &b.name == p).any(|b| b.bounds.iter().any(|(d, _)| *d == iface || self.extends(*d, iface)));
            }
            Ty::Any(d, _) => {
                if *d == iface {
                    return true;
                }
            }
            _ => {}
        }
        // what the language gives every type
        if self.is_std(iface, "same") {
            match &ty {
                Ty::Def(d, targs) => match self.defs[*d].kind.clone() {
                    DefKind::Enum { cases } => {
                        let map = self.generic_map(*d, targs);
                        return cases.iter().all(|c| c.fields.iter().all(|f| self.fits(&f.ty.subst(&map), iface, &[], bounds)));
                    }
                    DefKind::Token { .. } => return true,
                    DefKind::Record { fields } => {
                        if self.own_fn(&ty, "same").is_some() {
                            return true;
                        }
                        let map = self.generic_map(*d, targs);
                        return fields.iter().all(|f| self.fits(&f.ty.subst(&map), iface, &[], bounds));
                    }
                    _ => {}
                },
                Ty::List(x) | Ty::Opt(x) => return self.fits(x, iface, &[], bounds),
                Ty::Inline(fs) => return fs.clone().iter().all(|(_, t)| self.fits(t, iface, &[], bounds)),
                _ => {}
            }
        }
        if self.is_std(iface, "ordered") {
            if let Ty::Def(d, _) = &ty {
                if let DefKind::Enum { cases } = &self.defs[*d].kind {
                    if cases.iter().all(|c| c.fields.is_empty()) {
                        return true;
                    }
                }
            }
        }
        if self.is_std(iface, "literal") {
            let Some(want) = args.first().cloned() else { return false };
            let Some(from) = self.own_fn(&ty, "from") else { return false };
            let p = self.fns[from].params.first().map(|p| p.ty.clone());
            return match p {
                Some(p) => {
                    let save = self.vars.slots.len();
                    let ok = self.vars.unify(&p, &want);
                    self.vars.slots.truncate(save);
                    ok
                }
                None => false,
            };
        }
        let DefKind::Interface { widget, fields, fns, events } = self.defs[iface].kind.clone() else { return false };
        // fields: a record's or an inline record's fields, or a widget's inputs
        let have: Vec<(String, Ty)> = match &ty {
            Ty::Def(d, targs) => {
                let map = self.generic_map(*d, targs);
                match &self.defs[*d].kind {
                    DefKind::Record { fields } => fields.iter().map(|f| (f.name.clone(), f.ty.subst(&map))).collect(),
                    DefKind::Widget { inputs, .. } => inputs.iter().map(|f| (f.name.clone(), f.ty.subst(&map))).collect(),
                    _ => Vec::new(),
                }
            }
            Ty::Inline(fs) => fs.clone(),
            _ => Vec::new(),
        };
        if widget && !matches!(&ty, Ty::Def(d, _) if matches!(self.defs[*d].kind, DefKind::Widget { .. })) {
            return false;
        }
        for f in &fields {
            match have.iter().find(|(n, _)| *n == f.name) {
                Some((_, t)) => {
                    let t = t.clone();
                    if self.accepts(&f.ty, &t, bounds).is_none() {
                        return false;
                    }
                }
                None => return false,
            }
        }
        if !events.is_empty() {
            let Ty::Def(d, _) = &ty else { return false };
            let DefKind::Widget { events: have, .. } = &self.defs[*d].kind else { return false };
            if !events.iter().all(|e| have.iter().any(|h| h.name == e.name)) {
                return false;
            }
        }
        // fns: only those declared in the type's pack or the interface's count
        let packs = [self.pack_of(&ty), self.defs[iface].pack.clone()];
        for name in &fns {
            let found = self.own_fn(&ty, name).map_or(false, |f| packs.contains(&self.fns[f].pack));
            if !found {
                return false;
            }
        }
        true
    }

    fn extends(&self, _a: DefId, _b: DefId) -> bool {
        false
    }

    /// The type's own fn of that name, declared on its type.
    pub fn own_fn(&self, ty: &Ty, name: &str) -> Option<usize> {
        let key = self.recv_key(ty)?;
        self.methods.get(&key)?.get(name)?.first().copied()
    }

    pub fn generic_map(&self, d: DefId, args: &[Ty]) -> HashMap<String, Ty> {
        self.defs[d].generics.iter().zip(args.iter()).map(|(g, a)| (g.name.clone(), a.clone())).collect()
    }

    /// Every fn named `name` a value of `ty` has: its type's own, then its interfaces'.
    pub fn methods_of(&mut self, ty: &Ty, name: &str, bounds: &[TParam]) -> Vec<usize> {
        let ty = self.vars.resolve(ty);
        let mut out = Vec::new();
        if let Some(key) = self.recv_key(&ty) {
            if let Some(fs) = self.methods.get(&key).and_then(|m| m.get(name)) {
                out.extend(fs.iter().copied());
            }
        }
        if let Ty::Param(p) = &ty {
            for b in bounds.iter().filter(|b| &b.name == p) {
                for (d, _) in &b.bounds {
                    if let Some(fs) = self.methods.get(&Recv::Iface(*d)).and_then(|m| m.get(name)) {
                        out.extend(fs.iter().copied());
                    }
                }
            }
        }
        if !out.is_empty() {
            return out;
        }
        let ifaces: Vec<(DefId, usize)> = self
            .methods
            .iter()
            .filter_map(|(k, m)| match k {
                Recv::Iface(d) => m.get(name).map(|fs| fs.iter().map(move |f| (*d, *f)).collect::<Vec<_>>()),
                _ => None,
            })
            .flatten()
            .collect();
        for (d, f) in ifaces {
            if self.fits(&ty, d, &[], bounds) {
                out.push(f);
            }
        }
        out
    }

    /// How a value of `got` is accepted where `want` is wanted, if it is.
    pub fn accepts(&mut self, want: &Ty, got: &Ty, bounds: &[TParam]) -> Option<Conv> {
        let want = self.vars.resolve(want);
        let got = self.vars.resolve(got);
        if want.is_err() || got.is_err() {
            return Some(Conv::Same);
        }
        let save: Vec<Option<Ty>> = self.vars.slots.clone();
        if self.vars.unify(&want, &got) {
            return Some(Conv::Same);
        }
        self.vars.slots = save;
        match (&want, &got) {
            (Ty::Opt(w), Ty::Opt(g)) => {
                // opt<opt<T>> from opt<T>: the inner one is wrapped
                if let Some(c) = self.accepts(w, g, bounds) {
                    return Some(c);
                }
                if let Some(Conv::Wrap(n)) = self.accepts(w, &got, bounds) {
                    return Some(Conv::Wrap(n));
                }
                self.accepts(w, &got, bounds).map(|c| match c {
                    Conv::Same => Conv::Wrap(1),
                    Conv::Wrap(n) => Conv::Wrap(n + 1),
                })
            }
            (Ty::Opt(w), _) => self.accepts(w, &got, bounds).map(|c| match c {
                Conv::Same => Conv::Wrap(1),
                Conv::Wrap(n) => Conv::Wrap(n + 1),
            }),
            (Ty::View, Ty::Def(d, _)) if matches!(self.defs[*d].kind, DefKind::Widget { .. }) => Some(Conv::Same),
            (Ty::View, Ty::Any(d, _)) if matches!(self.defs[*d].kind, DefKind::Interface { widget: true, .. }) => Some(Conv::Same),
            (Ty::View, Ty::Param(p)) => {
                let widgety = bounds.iter().filter(|b| &b.name == p).any(|b| b.bounds.iter().any(|(d, _)| matches!(self.defs[*d].kind, DefKind::Interface { widget: true, .. })));
                widgety.then_some(Conv::Same)
            }
            (Ty::Any(d, args), _) => {
                let (d, args) = (*d, args.clone());
                self.fits(&got, d, &args, bounds).then_some(Conv::Same)
            }
            (Ty::List(w), Ty::List(g)) => match self.accepts(w, g, bounds) {
                Some(Conv::Same) => Some(Conv::Same),
                _ => None,
            },
            // a token case where its value's type is wanted
            (_, Ty::Def(d, _)) if matches!(self.defs[*d].kind, DefKind::Token { .. }) => {
                let DefKind::Token { value, .. } = self.defs[*d].kind.clone() else { unreachable!() };
                let save: Vec<Option<Ty>> = self.vars.slots.clone();
                if self.vars.unify(&want, &value) {
                    return Some(Conv::Same);
                }
                self.vars.slots = save;
                None
            }
            (Ty::Fn(ps, r), Ty::Fn(qs, s)) if ps.len() == qs.len() => {
                for (p, q) in ps.iter().zip(qs.iter()) {
                    if self.accepts(&q.ty, &p.ty, bounds) != Some(Conv::Same) {
                        return None;
                    }
                }
                match (r, s) {
                    (None, None) => Some(Conv::Same),
                    (Some(r), Some(s)) => (self.accepts(r, s, bounds) == Some(Conv::Same)).then_some(Conv::Same),
                    _ => None,
                }
            }
            _ => None,
        }
    }

    /// The expression, converted to the type wanted, or a mismatch reported.
    pub fn coerce(&mut self, file: usize, x: ir::Expr, got: &Ty, want: &Ty, span: Span, bounds: &[TParam]) -> ir::Expr {
        match self.accepts(want, got, bounds) {
            Some(Conv::Same) => x,
            Some(Conv::Wrap(n)) => {
                let mut x = x;
                for _ in 0..n {
                    x = ir::Expr::Some(Box::new(x));
                }
                x
            }
            None => {
                let (w, g) = (self.show(want), self.show(got));
                self.error(file, codes::MISMATCH, span, format!("expected {}, found {}", w, g));
                x
            }
        }
    }
}
