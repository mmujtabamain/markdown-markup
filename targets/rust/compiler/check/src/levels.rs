//! Levels (page 6): what a target has to do to run each call, each widget and the page.
//!
//! Every call needs `core.draw`. A call needs `core.live` when it has variables of its own,
//! gives a variable to a `mut` input, or sets an event to a handler that can change something,
//! or places one that does. The canvas widgets, and a plane with a background, need `core.gfx`.

use std::collections::{HashMap, HashSet};

use mkp_ir::ir::{self, Level, Node, Stmt};

/// A set of levels, written in page 6's order.
#[derive(Clone, Copy, Debug, Default, PartialEq)]
struct Set(u8);

impl Set {
    const DRAW: Set = Set(1);
    const LIVE: Set = Set(2);
    const GFX: Set = Set(4);

    fn of(levels: &[Level]) -> Set {
        let mut s = Set(0);
        for l in levels {
            s = s.or(match l {
                Level::CoreDraw => Set::DRAW,
                Level::CoreLive => Set::LIVE,
                Level::CoreGfx => Set::GFX,
            });
        }
        s
    }

    fn or(self, o: Set) -> Set {
        Set(self.0 | o.0)
    }

    fn list(self) -> Vec<Level> {
        let mut out = Vec::new();
        if self.0 & 1 != 0 {
            out.push(Level::CoreDraw);
        }
        if self.0 & 2 != 0 {
            out.push(Level::CoreLive);
        }
        if self.0 & 4 != 0 {
            out.push(Level::CoreGfx);
        }
        out
    }
}

struct Levels<'m> {
    externs: HashMap<&'m str, Set>,
    templates: HashMap<&'m str, &'m ir::Template>,
    /// Fns that return nothing: actions, an app channel's among them.
    actions: HashSet<String>,
    handlers: HashMap<&'m str, &'m [Stmt]>,
    done: HashMap<String, Set>,
    busy: HashSet<String>,
}

impl<'m> Levels<'m> {
    fn new(m: &'m ir::Module) -> Levels<'m> {
        let mut externs = HashMap::new();
        let mut actions = HashSet::new();
        for d in &m.declarations {
            match &d.declare {
                ir::Decl::Extern(ir::Extern::Widget(w)) => {
                    externs.insert(w.name.as_str(), Set::of(&w.levels).or(Set::DRAW));
                }
                ir::Decl::Extern(ir::Extern::Fn(f)) if f.returns.is_none() => {
                    actions.insert(f.name.clone());
                }
                ir::Decl::Extern(ir::Extern::Channel(c)) => {
                    for f in c.fns.iter().filter(|f| f.returns.is_none()) {
                        actions.insert(format!("{}.{}", c.name, f.name));
                    }
                }
                ir::Decl::Fn(f) if f.returns.is_none() => {
                    actions.insert(f.name.clone());
                }
                _ => {}
            }
        }
        Levels {
            externs,
            templates: m.templates.iter().map(|t| (t.name.as_str(), t)).collect(),
            actions,
            handlers: m.handlers.iter().map(|h| (h.id.as_str(), h.body.as_slice())).collect(),
            done: HashMap::new(),
            busy: HashSet::new(),
        }
    }

    /// Whether a handler can change something: it assigns, invokes an event, or calls an action.
    fn changes(&self, body: &[Stmt]) -> bool {
        body.iter().any(|s| match s {
            Stmt::Set(_) | Stmt::Invoke(_) | Stmt::Apply(_) => true,
            Stmt::Call(c) => self.actions.contains(&c.name),
            Stmt::If(i) => i.branches.iter().any(|b| self.changes(&b.then)) || self.changes(&i.else_),
            Stmt::For(f) => self.changes(&f.body),
            Stmt::Match(m) => m.cases.iter().any(|c| self.changes(&c.then)) || self.changes(&m.else_),
            _ => false,
        })
    }

    fn handler_live(&self, events: &std::collections::BTreeMap<String, String>) -> bool {
        events.values().any(|id| self.handlers.get(id.as_str()).map_or(false, |b| self.changes(b)))
    }

    /// A widget written in MKP: its own variables and everything its view calls.
    fn template(&mut self, name: &str) -> Set {
        if let Some(s) = self.done.get(name) {
            return *s;
        }
        let Some(t) = self.templates.get(name).copied() else { return Set::DRAW };
        // a widget that places itself: the rest of its view still counts
        if !self.busy.insert(name.to_string()) {
            return Set(0);
        }
        let mut s = self.nodes(&t.view);
        if !t.cells.is_empty() {
            s = s.or(Set::LIVE);
        }
        self.busy.remove(name);
        self.done.insert(name.to_string(), s);
        s
    }

    fn nodes(&mut self, nodes: &[Node]) -> Set {
        nodes.iter().fold(Set(0), |s, n| s.or(self.node(n)))
    }

    /// One node: a call's own levels, or what a branch or loop holds.
    fn node(&mut self, n: &Node) -> Set {
        match n {
            Node::Extern(e) => {
                let mut s = self.externs.get(e.name.as_str()).copied().unwrap_or(Set::DRAW);
                if !e.writes.is_empty() || self.handler_live(&e.events) {
                    s = s.or(Set::LIVE);
                }
                if e.name == "core/plane" && e.slots.get("background").map_or(false, |b| !b.is_empty()) {
                    s = s.or(Set::GFX);
                }
                for body in e.slots.values() {
                    s = s.or(self.nodes(body));
                }
                s
            }
            Node::Use(u) => {
                let mut s = self.template(&u.name).or(Set::DRAW);
                if u.args.values().any(|a| matches!(a, ir::Expr::Place(_))) || self.handler_live(&u.events) {
                    s = s.or(Set::LIVE);
                }
                for body in u.slots.values() {
                    s = s.or(self.nodes(body));
                }
                s
            }
            Node::For(f) => self.nodes(&f.body),
            Node::If(i) => {
                let s = i.branches.iter().fold(Set(0), |s, b| s.or(self.nodes(&b.then)));
                s.or(self.nodes(&i.else_))
            }
            Node::Match(m) => {
                let s = m.cases.iter().fold(Set(0), |s, c| s.or(self.nodes(&c.then)));
                s.or(self.nodes(&m.else_))
            }
            // a view held in a value: drawn, whatever it is
            Node::Place(_) => Set::DRAW,
            Node::Declare(_) => Set(0),
        }
    }

    /// Writes each call's levels into it.
    fn write(&mut self, nodes: &mut [Node]) {
        for n in nodes.iter_mut() {
            let s = self.node(n);
            match n {
                Node::Extern(e) => {
                    e.levels = s.list();
                    for body in e.slots.values_mut() {
                        self.write(body);
                    }
                }
                Node::Use(u) => {
                    u.levels = s.list();
                    for body in u.slots.values_mut() {
                        self.write(body);
                    }
                }
                Node::For(f) => self.write(&mut f.body),
                Node::If(i) => {
                    for b in &mut i.branches {
                        self.write(&mut b.then);
                    }
                    self.write(&mut i.else_);
                }
                Node::Match(m) => {
                    for c in &mut m.cases {
                        self.write(&mut c.then);
                    }
                    self.write(&mut m.else_);
                }
                _ => {}
            }
        }
    }
}

/// Works out every call's, widget's and the page's levels.
pub fn compute(m: &mut ir::Module) {
    let (per_template, page) = {
        let mut lv = Levels::new(m);
        let names: Vec<String> = m.templates.iter().map(|t| t.name.clone()).collect();
        let per: Vec<Set> = names.iter().map(|n| lv.template(n)).collect();
        let page = match m.templates.iter().position(|t| t.name == "doc") {
            Some(k) => per[k],
            None => {
                let own = format!("{}/", m.module);
                names.iter().zip(&per).filter(|(n, _)| n.starts_with(&own)).fold(Set(0), |s, (_, l)| s.or(*l))
            }
        };
        // each node's levels, worked out against the module as it is
        let mut views: Vec<Vec<Node>> = m.templates.iter().map(|t| t.view.clone()).collect();
        let mut marks: Vec<Vec<Node>> = m.templates.iter().map(|t| t.markdown.clone()).collect();
        for v in views.iter_mut().chain(marks.iter_mut()) {
            lv.write(v);
        }
        (per.into_iter().zip(views.into_iter().zip(marks)).collect::<Vec<_>>(), page)
    };
    for (t, (s, (view, md))) in m.templates.iter_mut().zip(per_template) {
        t.levels = s.list();
        t.view = view;
        t.markdown = md;
    }
    m.levels = page.list();
}
