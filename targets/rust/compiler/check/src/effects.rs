//! Effects (page 2, What a fn may change): drawing a page never changes anything, so every
//! change starts in an action. A fn with a return type, a view, a `markdown` block, a `require`,
//! a contract and a starting value change only their own `mut` locals; a plain `for` can't
//! change what it walks; a lambda can't assign a `mut` local of the fn it is written in.

use std::collections::HashMap;

use xtmd_syntax::ast::{self, ExprKind as E};
use xtmd_syntax::Span;

use crate::body::{Cx, LocalKind};
use crate::{codes, Checker};

/// What a write or a `mut` argument reaches: where its place starts.
#[derive(Clone, Debug, PartialEq)]
pub enum Root {
    /// A `mut` local of the fn or lambda being checked, or one of its `mut` parameters.
    Own(String),
    /// A `mut` local of the fn a lambda is written in.
    Outer(String),
    /// A `mut for` or `if (mut …)` variable: the real item, and whether it was opened from
    /// the fn's own locals or `mut` parameters.
    Item(String, bool),
    State(String),
    Cell(String),
    Input(String),
    /// Anything else: a `let`, a plain variable, a value that isn't a place.
    Other,
}

impl Root {
    /// Whether writing here stays inside the fn: its own locals, `mut` parameters, or items of them.
    pub fn is_own(&self) -> bool {
        matches!(self, Root::Own(_) | Root::Item(_, true))
    }

    fn name(&self) -> Option<&str> {
        match self {
            Root::Own(n) | Root::Outer(n) | Root::Item(n, _) | Root::State(n) | Root::Cell(n) | Root::Input(n) => Some(n),
            Root::Other => None,
        }
    }

    fn said(&self) -> String {
        match self {
            Root::Own(n) | Root::Outer(n) => format!("`{}`", n),
            Root::Item(n, _) => format!("the item `{}`", n),
            Root::State(n) => format!("`$state.{}`", n),
            Root::Cell(n) => format!("the widget's own variable `{}`", n),
            Root::Input(n) => format!("the `mut` input `{}`", n),
            Root::Other => "it".into(),
        }
    }
}

/// What each action reaches beyond its own locals, worked out across the calls it makes.
#[derive(Clone, Debug, Default)]
pub struct Effects {
    /// Actions that change something outside: `$state`, a variable, an input, an item, an event.
    pub world: HashMap<usize, bool>,
    /// The actions each action calls.
    pub calls: HashMap<usize, Vec<usize>>,
    /// Actions called from where nothing may change, on that code's own locals: they have to
    /// change nothing else, which is known once every body is checked.
    pub from_value: Vec<(usize, Span, usize)>,
}

impl Checker {
    /// Where a place starts, as an assignment or a `mut` argument writes it.
    pub(crate) fn root_of(&self, cx: &Cx, e: &ast::Expr) -> Root {
        match &e.kind {
            E::Paren(inner) => self.root_of(cx, inner),
            E::Field { target, name } => match &target.kind {
                E::State => Root::State(name.name.clone()),
                _ => self.root_of(cx, target),
            },
            E::Index { target, .. } => self.root_of(cx, target),
            E::SelfValue => match cx.local_at("self") {
                Some((depth, _)) if depth >= cx.fn_depth => Root::Own("self".into()),
                Some(_) => Root::Outer("self".into()),
                None => Root::Other,
            },
            E::Name(n) => {
                if let Some((depth, l)) = cx.local_at(&n.name) {
                    return match l.kind {
                        LocalKind::MutFor | LocalKind::OpenMut => Root::Item(n.name.clone(), l.own_origin),
                        LocalKind::Plain if depth >= cx.fn_depth => Root::Own(n.name.clone()),
                        LocalKind::Plain => Root::Outer(n.name.clone()),
                    };
                }
                if let Some(w) = &cx.widget {
                    if w.inputs.iter().any(|i| i.0 == n.name) {
                        return Root::Input(n.name.clone());
                    }
                    if w.cells.iter().any(|c| c.0 == n.name) {
                        return Root::Cell(n.name.clone());
                    }
                }
                Root::Other
            }
            _ => Root::Other,
        }
    }

    /// Why a place can't be written here, if it can't.
    fn may_write(&self, cx: &Cx, root: &Root) -> Option<(&'static str, String)> {
        // a plain `for` can't change what it walks
        if let Some(n) = root.name() {
            if let Some((_, var, _)) = cx.walking.iter().rev().find(|(_, v, l)| v == n || l.as_deref() == Some(n)) {
                let what = if var == n { format!("the item `{}`", var) } else { format!("the list `{}`", n) };
                return Some((codes::FOR_CHANGES, format!("a plain `for` reads: its body can't change {} it walks. Walk it with `mut for` to change the list's items", what)));
            }
        }
        if !cx.action {
            return match root {
                Root::Own(_) => None,
                _ => Some((codes::WRITE_IN_VALUE, format!("{} changes nothing: it can't assign {}, only its own `mut` locals. A fn with no return type is an action, and may", self.value_context(cx), root.said()))),
            };
        }
        match root {
            Root::Outer(n) => Some((codes::LAMBDA_OUTER, format!("a lambda can't assign `{}`, a `mut` local of the fn it is written in: return the value, or keep it in a variable the lambda may write", n))),
            _ => None,
        }
    }

    fn value_context(&self, cx: &Cx) -> &'static str {
        match cx.ret {
            Some(Some(_)) => "a fn that returns a value",
            Some(None) => "this",
            None => "drawing the page",
        }
    }

    /// An assignment: whether it may write where it does.
    pub(crate) fn check_write(&mut self, cx: &Cx, place: &ast::Expr) {
        let root = self.root_of(cx, place);
        if let Some((code, msg)) = self.may_write(cx, &root) {
            self.error(cx.file, code, place.span, msg);
        }
        self.note_world(cx, &root);
    }

    /// An action that writes outside its own locals changes the world.
    fn note_world(&mut self, cx: &Cx, root: &Root) {
        if let (true, Some(f)) = (cx.action, cx.fn_id) {
            if !root.is_own() {
                self.effects.world.insert(f, true);
            }
        }
    }

    /// A call of an action: what it may write, and from where.
    pub(crate) fn check_action_call(&mut self, cx: &Cx, f: usize, targets: &[&ast::Expr], span: Span) {
        let roots: Vec<Root> = targets.iter().map(|t| self.root_of(cx, t)).collect();
        let name = self.fns[f].name.clone();
        // a plain `for` can't change what it walks, through a call either
        for (t, r) in targets.iter().zip(&roots) {
            if let Some(n) = r.name() {
                if cx.walking.iter().any(|(_, v, l)| v == n || l.as_deref() == Some(n)) {
                    self.error(cx.file, codes::FOR_CHANGES, t.span, format!("a plain `for` reads: its body can't change `{}`, which it walks, with `{}`. Walk it with `mut for`", n, name));
                }
            }
        }
        if !cx.action {
            let own = !roots.is_empty() && roots.iter().all(|r| matches!(r, Root::Own(_)));
            if !own {
                let what = self.value_context(cx);
                self.error(cx.file, codes::ACTION_CALL, span, format!("`{}` is an action, and {} changes nothing: an action is called from a handler or another action, or on the caller's own `mut` locals", name, what));
            } else if !self.fns[f].external {
                self.effects.from_value.push((cx.file, span, f));
            }
            return;
        }
        if let Some(me) = cx.fn_id {
            if roots.iter().any(|r| !r.is_own()) || (roots.is_empty() && self.fns[f].external) {
                self.effects.world.insert(me, true);
            }
            if !self.fns[f].external {
                self.effects.calls.entry(me).or_default().push(f);
            }
        }
    }

    /// A channel's fn with no return type is an action sent to the app (page 6): called only
    /// where things may change, and it changes the world.
    pub(crate) fn check_channel_action(&mut self, cx: &Cx, name: &str, span: Span) {
        if !cx.action {
            let what = self.value_context(cx);
            self.error(cx.file, codes::ACTION_CALL, span, format!("`{}` is an action sent to the app, and {} changes nothing: call it from a handler or another action", name, what));
        } else if let Some(me) = cx.fn_id {
            self.effects.world.insert(me, true);
        }
    }

    /// Calling a fn value that returns nothing is an action too.
    pub(crate) fn check_apply_action(&mut self, cx: &Cx, span: Span) {
        if !cx.action {
            let what = self.value_context(cx);
            self.error(cx.file, codes::ACTION_CALL, span, format!("this fn returns nothing, so it is an action, and {} changes nothing: call it from a handler or another action", what));
        } else if let Some(me) = cx.fn_id {
            self.effects.world.insert(me, true);
        }
    }

    /// `invoke` raises an event: an action's work.
    pub(crate) fn check_invoke(&mut self, cx: &Cx, span: Span) {
        if !cx.action {
            let what = self.value_context(cx);
            self.error(cx.file, codes::ACTION_CALL, span, format!("`invoke` is an action's, and {} changes nothing", what));
        } else if let Some(me) = cx.fn_id {
            self.effects.world.insert(me, true);
        }
    }

    /// A fn that returns a value can't take a `mut` parameter.
    pub(crate) fn check_value_fn_params(&mut self, file: usize, sig: &ast::FnSig) {
        if sig.ret.is_none() || matches!(sig.ret, Some(ast::RetType::Void(_))) {
            return;
        }
        for p in sig.params.iter() {
            if p.mutable {
                self.error(file, codes::MUT_PARAM, p.name.span, format!("a fn that returns a value changes nothing, so it can't take `mut {}`: drop the return type to make it an action, or return the new value", p.name.name));
            }
        }
    }

    /// Once every body is checked: an action called from where nothing may change has to
    /// change nothing beyond what it is given, across every action it calls.
    pub(crate) fn settle_effects(&mut self) {
        let fx = std::mem::take(&mut self.effects);
        let mut world = fx.world.clone();
        loop {
            let mut changed = false;
            for (f, calls) in &fx.calls {
                if !world.get(f).copied().unwrap_or(false) && calls.iter().any(|g| world.get(g).copied().unwrap_or(false)) {
                    world.insert(*f, true);
                    changed = true;
                }
            }
            if !changed {
                break;
            }
        }
        for (file, span, f) in &fx.from_value {
            if world.get(f).copied().unwrap_or(false) {
                let name = self.fns[*f].name.clone();
                self.error(*file, codes::ACTION_CALL, *span, format!("`{}` changes more than the locals it is given (`$state`, a variable, an input, an item or an event, or it sends the app an action), so only a handler or another action may call it", name));
            }
        }
        // what later pages compile on top of keeps what was learned here
        self.effects = Effects { world, calls: fx.calls, from_value: Vec::new() };
    }
}

impl Checker {
    /// A loop begins: a plain `for` reads what it walks; a `mut for` over what isn't the
    /// action's own changes the world.
    pub(crate) fn begin_walk(&mut self, cx: &mut Cx, mutable: bool, over: &ast::Expr, var: &ast::Ident) {
        let root = self.root_of(cx, over);
        if mutable {
            self.note_world(cx, &root);
            set_own_origin(cx, &var.name, root.is_own());
            return;
        }
        let list = root.name().map(str::to_string);
        let depth = cx.scopes.len();
        cx.walking.push((depth, var.name.clone(), list));
    }
}

/// Marks a `mut for` or `if (mut …)` variable as opened from the fn's own values.
pub(crate) fn set_own_origin(cx: &mut Cx, name: &str, own: bool) {
    if let Some(l) = cx.scopes.iter_mut().rev().flat_map(|s| s.iter_mut().rev()).find(|l| l.name == name) {
        l.own_origin = own;
    }
}

impl Checker {
    /// One value, one `mut`: a variable given to a `mut` parameter can't also be given, or a
    /// part of it, to another parameter of the same call.
    pub(crate) fn check_one_mut(&mut self, cx: &Cx, targets: &[&ast::Expr], all: &[&ast::Expr]) {
        for t in targets {
            let Some(n) = self.root_of(cx, t).name().map(str::to_string) else { continue };
            for a in all {
                if std::ptr::eq(*a, *t) {
                    continue;
                }
                if self.root_of(cx, a).name() == Some(n.as_str()) && mentions_root(a) {
                    self.error(cx.file, codes::ONE_MUT, a.span, format!("`{}` is given to a `mut` parameter of this call, so neither it nor a part of it can be given to another of its parameters: put that value in a `let` first", n));
                }
            }
        }
    }
}

/// Whether an argument is the variable or a part of it, rather than a value worked out from it.
fn mentions_root(e: &ast::Expr) -> bool {
    match &e.kind {
        E::Name(_) | E::SelfValue => true,
        E::Paren(inner) => mentions_root(inner),
        E::Field { target, .. } | E::Index { target, .. } => mentions_root(target),
        _ => false,
    }
}

/// The item a statement removes from its list: `xs.remove(x);`.
pub(crate) fn removes(s: &ast::Stmt) -> Option<String> {
    let ast::Stmt::Expr(ast::Expr { kind: E::Call { callee, args }, .. }) = s else { return None };
    let E::Field { name, .. } = &callee.kind else { return None };
    if name.name != "remove" || args.len() != 1 {
        return None;
    }
    match &args.iter().next()?.value.kind {
        E::Name(n) => Some(n.name.clone()),
        _ => None,
    }
}

/// Where a statement first mentions a name, if it does.
pub(crate) fn first_mention(s: &ast::Stmt, name: &str) -> Option<Span> {
    use ast::Stmt as S;
    let block = |b: &ast::Block| b.stmts.iter().find_map(|x| first_mention(&x.item, name));
    match s {
        S::Let(v) | S::Mut(v) => mention(&v.value, name),
        S::Return(e) => e.as_ref().and_then(|e| mention(e, name)),
        S::Invoke { args, .. } => args.iter().find_map(|a| mention(&a.value, name)),
        S::If(i) => i
            .branches
            .iter()
            .find_map(|(c, b)| {
                let in_cond = match c {
                    ast::Cond::Expr(e) => mention(e, name),
                    ast::Cond::Open { value, .. } => mention(value, name),
                };
                in_cond.or_else(|| block(b))
            })
            .or_else(|| i.otherwise.as_ref().and_then(block)),
        S::For(f) => mention(&f.over, name).or_else(|| block(&f.body)),
        S::Match(m) => mention(&m.subject, name).or_else(|| m.cases.iter().find_map(|c| block(&c.body))),
        S::Expr(e) => mention(e, name),
        S::Assign { place, value } => mention(place, name).or_else(|| mention(value, name)),
    }
}

fn mention(e: &ast::Expr, name: &str) -> Option<Span> {
    let m = |x: &ast::Expr| mention(x, name);
    match &e.kind {
        E::Name(n) if n.name == name => Some(e.span),
        E::Paren(x) | E::Try(x) => m(x),
        E::Field { target, .. } => m(target),
        E::Index { target, index } => m(target).or_else(|| m(index)),
        E::Call { callee, args } => m(callee).or_else(|| args.iter().find_map(|a| m(&a.value))),
        E::Case { target, args, .. } => m(target).or_else(|| args.as_ref().and_then(|a| a.iter().find_map(|x| m(&x.value)))),
        E::With { target, inits } => m(target).or_else(|| inits.iter().find_map(|i| m(&i.value))),
        E::Record { inits, .. } => inits.iter().find_map(|i| m(&i.value)),
        E::List(items) => items.iter().find_map(m),
        E::Unary { operand, .. } => m(operand),
        E::Binary { left, right, .. } => m(left).or_else(|| m(right)),
        E::Ternary { cond, then, otherwise } => m(cond).or_else(|| m(then)).or_else(|| m(otherwise)),
        E::Range { low, high, step } => [low, high, step].iter().find_map(|x| x.as_ref().and_then(|x| m(x))),
        E::Text(t) => t.parts.iter().find_map(|p| match p {
            ast::TextPart::Hole(h) => m(h),
            _ => None,
        }),
        E::Lambda(l) => l.body.stmts.iter().find_map(|s| first_mention(&s.item, name)),
        _ => None,
    }
}
