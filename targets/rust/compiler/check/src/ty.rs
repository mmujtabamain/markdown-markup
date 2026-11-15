//! Types as the checker works with them: aliases worked out, contracts left to the proofs.

use std::collections::HashMap;

pub type DefId = usize;

#[derive(Clone, Debug, PartialEq)]
pub enum Ty {
    Num,
    Bool,
    Text,
    Dur,
    View,
    List(Box<Ty>),
    Opt(Box<Ty>),
    Range(Box<Ty>),
    /// A record, an enum, a token type, a widget or an extern type, with its type arguments.
    Def(DefId, Vec<Ty>),
    /// A type parameter of the declaration being checked: `T`.
    Param(String),
    /// A type being worked out.
    Var(u32),
    Fn(Vec<FnParam>, Option<Box<Ty>>),
    /// An inline record: `{ name: text, up: bool }`.
    Inline(Vec<(String, Ty)>),
    /// Any type that fits an interface.
    Any(DefId, Vec<Ty>),
    /// Inside an interface, the type that fits it.
    SelfT,
    /// After an error, so one mistake is reported once.
    Err,
}

#[derive(Clone, Debug, PartialEq)]
pub struct FnParam {
    pub ty: Ty,
    pub mutable: bool,
}

impl Ty {
    pub fn list(t: Ty) -> Ty {
        Ty::List(Box::new(t))
    }

    pub fn opt(t: Ty) -> Ty {
        Ty::Opt(Box::new(t))
    }

    pub fn is_err(&self) -> bool {
        matches!(self, Ty::Err)
    }

    /// The type parameters replaced.
    pub fn subst(&self, map: &HashMap<String, Ty>) -> Ty {
        match self {
            Ty::Param(n) => map.get(n).cloned().unwrap_or_else(|| self.clone()),
            Ty::List(t) => Ty::list(t.subst(map)),
            Ty::Opt(t) => Ty::opt(t.subst(map)),
            Ty::Range(t) => Ty::Range(Box::new(t.subst(map))),
            Ty::Def(d, args) => Ty::Def(*d, args.iter().map(|a| a.subst(map)).collect()),
            Ty::Any(d, args) => Ty::Any(*d, args.iter().map(|a| a.subst(map)).collect()),
            Ty::Fn(ps, r) => Ty::Fn(
                ps.iter().map(|p| FnParam { ty: p.ty.subst(map), mutable: p.mutable }).collect(),
                r.as_ref().map(|r| Box::new(r.subst(map))),
            ),
            Ty::Inline(fs) => Ty::Inline(fs.iter().map(|(n, t)| (n.clone(), t.subst(map))).collect()),
            _ => self.clone(),
        }
    }

    pub fn subst_self(&self, s: &Ty) -> Ty {
        match self {
            Ty::SelfT => s.clone(),
            Ty::List(t) => Ty::list(t.subst_self(s)),
            Ty::Opt(t) => Ty::opt(t.subst_self(s)),
            Ty::Range(t) => Ty::Range(Box::new(t.subst_self(s))),
            Ty::Def(d, args) => Ty::Def(*d, args.iter().map(|a| a.subst_self(s)).collect()),
            Ty::Fn(ps, r) => Ty::Fn(
                ps.iter().map(|p| FnParam { ty: p.ty.subst_self(s), mutable: p.mutable }).collect(),
                r.as_ref().map(|r| Box::new(r.subst_self(s))),
            ),
            _ => self.clone(),
        }
    }

    pub fn has_vars(&self) -> bool {
        match self {
            Ty::Var(_) => true,
            Ty::List(t) | Ty::Opt(t) | Ty::Range(t) => t.has_vars(),
            Ty::Def(_, a) | Ty::Any(_, a) => a.iter().any(|t| t.has_vars()),
            Ty::Fn(ps, r) => ps.iter().any(|p| p.ty.has_vars()) || r.as_ref().map_or(false, |r| r.has_vars()),
            Ty::Inline(fs) => fs.iter().any(|(_, t)| t.has_vars()),
            _ => false,
        }
    }
}

/// Inference variables and what they stand for.
#[derive(Default)]
pub struct Vars {
    pub slots: Vec<Option<Ty>>,
}

impl Vars {
    pub fn fresh(&mut self) -> Ty {
        self.slots.push(None);
        Ty::Var(self.slots.len() as u32 - 1)
    }

    /// The type with every variable that is known put in.
    pub fn resolve(&self, t: &Ty) -> Ty {
        match t {
            Ty::Var(v) => match self.slots.get(*v as usize).and_then(|s| s.clone()) {
                Some(x) => self.resolve(&x),
                None => t.clone(),
            },
            Ty::List(x) => Ty::list(self.resolve(x)),
            Ty::Opt(x) => Ty::opt(self.resolve(x)),
            Ty::Range(x) => Ty::Range(Box::new(self.resolve(x))),
            Ty::Def(d, a) => Ty::Def(*d, a.iter().map(|x| self.resolve(x)).collect()),
            Ty::Any(d, a) => Ty::Any(*d, a.iter().map(|x| self.resolve(x)).collect()),
            Ty::Fn(ps, r) => Ty::Fn(
                ps.iter().map(|p| FnParam { ty: self.resolve(&p.ty), mutable: p.mutable }).collect(),
                r.as_ref().map(|r| Box::new(self.resolve(r))),
            ),
            Ty::Inline(fs) => Ty::Inline(fs.iter().map(|(n, x)| (n.clone(), self.resolve(x))).collect()),
            _ => t.clone(),
        }
    }

    fn occurs(&self, v: u32, t: &Ty) -> bool {
        match self.resolve(t) {
            Ty::Var(w) => v == w,
            Ty::List(x) | Ty::Opt(x) | Ty::Range(x) => self.occurs(v, &x),
            Ty::Def(_, a) | Ty::Any(_, a) => a.iter().any(|x| self.occurs(v, x)),
            Ty::Fn(ps, r) => ps.iter().any(|p| self.occurs(v, &p.ty)) || r.as_ref().map_or(false, |r| self.occurs(v, r)),
            _ => false,
        }
    }

    /// Makes two types the same, binding variables. Whether they could be.
    pub fn unify(&mut self, a: &Ty, b: &Ty) -> bool {
        let a = self.resolve(a);
        let b = self.resolve(b);
        match (&a, &b) {
            (Ty::Err, _) | (_, Ty::Err) => true,
            (Ty::Var(x), Ty::Var(y)) if x == y => true,
            (Ty::Var(x), t) | (t, Ty::Var(x)) => {
                if self.occurs(*x, t) {
                    return false;
                }
                self.slots[*x as usize] = Some(t.clone());
                true
            }
            (Ty::List(x), Ty::List(y)) | (Ty::Opt(x), Ty::Opt(y)) | (Ty::Range(x), Ty::Range(y)) => self.unify(x, y),
            (Ty::Def(d, xs), Ty::Def(e, ys)) | (Ty::Any(d, xs), Ty::Any(e, ys)) => {
                d == e && xs.len() == ys.len() && xs.iter().zip(ys.iter()).all(|(x, y)| self.unify(x, y))
            }
            (Ty::Fn(ps, r), Ty::Fn(qs, s)) => {
                if ps.len() != qs.len() {
                    return false;
                }
                for (p, q) in ps.iter().zip(qs.iter()) {
                    if !self.unify(&p.ty, &q.ty) {
                        return false;
                    }
                }
                match (r, s) {
                    (None, None) => true,
                    (Some(r), Some(s)) => self.unify(r, s),
                    _ => false,
                }
            }
            (Ty::Inline(f), Ty::Inline(g)) => {
                f.len() == g.len() && f.iter().zip(g.iter()).all(|((n, x), (m, y))| n == m && self.unify(x, y))
            }
            _ => a == b,
        }
    }
}
