//! The evaluator: it walks the IR's statements and expressions, with the limits of page 6.
//!
//! The compiler uses it to work out constants (a literal's `from`, a `require` on constants,
//! a constant `let`); the native runtime will use it when a page runs. What lives outside a
//! fn (a widget's cells and inputs, `$state`, the app's channels) is reached through [`Host`].

use crate::natives;
use crate::num::{Num, NumError};
use crate::value::*;
use mkp_ir::ir::{self, Cond, Expr, OpName, Stmt};
use std::collections::HashMap;
use std::rc::Rc;

/// Page 6's limits.
pub const MAX_STEPS: u64 = 1_000_000;
pub const MAX_ITEMS: usize = 10_000;
pub const MAX_DEPTH: u32 = 64;

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Limit {
    Steps,
    Items,
    Depth,
}

#[derive(Clone, Debug, PartialEq)]
pub enum FailKind {
    /// A number that doesn't fit: a division by zero, or a result too large.
    Number(NumError),
    /// A `require` or a contract, false for values that are not constants.
    Rule,
    /// A position outside a list.
    Position,
    /// An item used after it was removed.
    Removed,
    Limit(Limit),
    /// What is only known when the page runs: a variable, `$state`, an extern nobody supplies.
    NotConstant,
    /// A bug in the IR: a name that isn't declared, a value of the wrong kind.
    Ir,
}

#[derive(Clone, Debug, PartialEq)]
pub struct Failure {
    pub kind: FailKind,
    pub message: String,
    /// A `require`'s message, when a rule failed.
    pub rule: Option<String>,
}

impl Failure {
    pub fn new(kind: FailKind, message: impl Into<String>) -> Failure {
        Failure { kind, message: message.into(), rule: None }
    }

    pub fn ir(message: impl Into<String>) -> Failure {
        Failure::new(FailKind::Ir, message)
    }

    pub fn rule(message: &str) -> Failure {
        Failure { kind: FailKind::Rule, message: format!("broken rule: {}", message), rule: Some(message.to_string()) }
    }
}

impl From<NumError> for Failure {
    fn from(e: NumError) -> Failure {
        Failure::new(FailKind::Number(e), e.to_string())
    }
}

pub type R<T> = Result<T, Failure>;

/// What a name outside a fn's locals stands for.
#[derive(Clone, Debug, PartialEq)]
pub enum Outer {
    Cell(Rc<str>),
    Input(Rc<str>),
    State(Rc<str>),
    Let(Rc<str>),
    Extern(Rc<str>),
    Slot(Rc<str>),
}

/// Everything outside a fn: a widget instance, the document, the app, the target.
pub trait Host {
    fn read(&mut self, m: &mut Machine, what: &Outer, owner: Option<u64>) -> R<Value>;
    fn write(&mut self, m: &mut Machine, what: &Outer, owner: Option<u64>, value: Value) -> R<()>;
    /// An extern fn of a pack or of the app. `None` when nobody supplies it.
    fn call_extern(&mut self, _m: &mut Machine, _name: &str, _args: &[Value]) -> R<Option<Option<Value>>> {
        Ok(None)
    }
    fn invoke(&mut self, _m: &mut Machine, event: &str, _args: Vec<Value>, _owner: Option<u64>) -> R<()> {
        Err(Failure::new(FailKind::NotConstant, format!("`invoke {}` runs only when the page runs", event)))
    }
    /// The value a token case stands for, from the target's tokens.
    fn token_value(&mut self, m: &mut Machine, case: &Case) -> R<Value> {
        m.default_token_value(case)
    }
}

/// A host for the compiler: only constants can be worked out.
pub struct Constants;

impl Host for Constants {
    fn read(&mut self, m: &mut Machine, what: &Outer, _owner: Option<u64>) -> R<Value> {
        if let Outer::Let(name) = what {
            if let Some(v) = m.prog.lets.get(&**name) {
                return Ok(v.clone());
            }
        }
        Err(Failure::new(FailKind::NotConstant, format!("{:?} is only known when the page runs", what)))
    }

    fn write(&mut self, _m: &mut Machine, what: &Outer, _owner: Option<u64>, _value: Value) -> R<()> {
        Err(Failure::new(FailKind::NotConstant, format!("{:?} can't change while a constant is worked out", what)))
    }
}

/// A local, or a reference to a place for a `mut` parameter, a `mut for` or an `if (mut …)`.
#[derive(Clone, Debug)]
pub enum Binding {
    Value(Value),
    Ref(Place),
}

#[derive(Clone, Debug)]
pub struct Place {
    pub root: PlaceRoot,
    pub path: Vec<Step>,
}

#[derive(Clone, Debug)]
pub enum PlaceRoot {
    Local { frame: usize, name: Rc<str> },
    Outer(Outer, Option<u64>),
}

#[derive(Clone, Debug)]
pub enum Step {
    Field(Rc<str>),
    /// An item by its position, as `xs[i] = v` writes.
    Index(i64),
    /// The real item, by its identity, wherever it now is.
    Item(u64),
    /// The real item as an `opt`: `none` once it has been removed (a `mut for` variable).
    ItemOpt(u64),
    /// The value inside an `opt`.
    Inside,
}

struct Frame {
    vars: Vec<(Rc<str>, Binding)>,
    owner: Option<u64>,
}

enum Flow {
    Normal,
    Return(Option<Value>),
}

/// The declarations a program's code needs, by their full names.
#[derive(Default)]
pub struct Program {
    pub fns: HashMap<String, Rc<ir::FnDecl>>,
    pub externs: HashMap<String, Rc<ir::ExternFn>>,
    pub records: HashMap<String, Rc<ir::Record>>,
    pub enums: HashMap<String, Rc<ir::Enum>>,
    pub tokens: HashMap<String, Rc<ir::Token>>,
    pub aliases: HashMap<String, ir::Type>,
    pub interfaces: HashMap<String, Rc<ir::Interface>>,
    /// Constant lets, already worked out.
    pub lets: HashMap<String, Value>,
}

impl Program {
    pub fn add(&mut self, d: &ir::Decl) {
        match d {
            ir::Decl::Fn(f) => {
                self.fns.insert(f.name.clone(), Rc::new(f.clone()));
            }
            ir::Decl::Extern(ir::Extern::Fn(f)) => {
                self.externs.insert(f.name.clone(), Rc::new(f.clone()));
            }
            ir::Decl::Record(r) => {
                self.records.insert(r.name.clone(), Rc::new(r.clone()));
            }
            ir::Decl::Enum(e) => {
                self.enums.insert(e.name.clone(), Rc::new(e.clone()));
            }
            ir::Decl::Token(t) => {
                self.tokens.insert(t.name.clone(), Rc::new(t.clone()));
            }
            ir::Decl::Type(a) => {
                self.aliases.insert(a.name.clone(), a.is.clone());
            }
            ir::Decl::Interface(i) => {
                self.interfaces.insert(i.name.clone(), Rc::new(i.clone()));
            }
            _ => {}
        }
    }

    pub fn from_module(m: &ir::Module) -> Program {
        let mut p = Program::default();
        for d in &m.declarations {
            p.add(&d.declare);
        }
        p
    }
}

pub struct Machine<'p> {
    pub prog: &'p Program,
    pub steps: u64,
    pub depth: u32,
    pub next_id: u64,
    frames: Vec<Frame>,
    pub host: Option<Box<dyn Host + 'p>>,
    /// The message of the last rule a `try` turned into `none`, for a literal's error.
    pub last_rule: Option<String>,
}

impl<'p> Machine<'p> {
    pub fn new(prog: &'p Program, host: Box<dyn Host + 'p>) -> Machine<'p> {
        Machine { prog, steps: 0, depth: 0, next_id: 0, frames: vec![Frame { vars: Vec::new(), owner: None }], host: Some(host), last_rule: None }
    }

    /// Starts counting steps again, for one redraw, one event or one constant.
    pub fn reset_steps(&mut self) {
        self.steps = 0;
    }

    fn step(&mut self) -> R<()> {
        self.steps += 1;
        if self.steps > MAX_STEPS {
            return Err(Failure::new(FailKind::Limit(Limit::Steps), "more than 1,000,000 steps"));
        }
        Ok(())
    }

    pub fn new_id(&mut self) -> u64 {
        self.next_id += 1;
        self.next_id
    }

    pub fn make_list(&mut self, values: Vec<Value>) -> R<Value> {
        if values.len() > MAX_ITEMS {
            return Err(Failure::new(FailKind::Limit(Limit::Items), "a list of more than 10,000 items"));
        }
        let mut ids = self.next_id;
        let v = Value::list(values, &mut ids);
        self.next_id = ids;
        Ok(v)
    }

    fn with_host<T>(&mut self, f: impl FnOnce(&mut dyn Host, &mut Machine<'p>) -> R<T>) -> R<T> {
        let mut host = self.host.take().expect("the host is in use");
        let out = f(&mut *host, self);
        self.host = Some(host);
        out
    }

    fn frame(&self) -> &Frame {
        self.frames.last().unwrap()
    }

    fn owner(&self) -> Option<u64> {
        self.frame().owner
    }

    /// Works out an expression with these locals, inside the widget instance `owner`: how a
    /// runtime or the Markdown writer reads a node's values.
    pub fn eval_in(&mut self, locals: &[(Rc<str>, Value)], owner: Option<u64>, e: &Expr) -> R<Value> {
        let vars = locals.iter().map(|(n, v)| (n.clone(), Binding::Value(v.clone()))).collect();
        self.frames.push(Frame { vars, owner });
        let out = self.eval(e);
        self.frames.pop();
        out
    }

    fn bind(&mut self, name: &str, b: Binding) {
        self.frames.last_mut().unwrap().vars.push((Rc::from(name), b));
    }

    fn lookup(&self, name: &str) -> Option<(usize, usize)> {
        let f = self.frames.len() - 1;
        self.frames[f].vars.iter().rposition(|(n, _)| &**n == name).map(|k| (f, k))
    }

    // ---- places

    fn read_root(&mut self, root: &PlaceRoot) -> R<Value> {
        match root {
            PlaceRoot::Local { frame, name } => {
                let vars = &self.frames.get(*frame).ok_or_else(|| Failure::ir("a reference outlived its fn"))?.vars;
                match vars.iter().rev().find(|(n, _)| n == name).map(|(_, b)| b.clone()) {
                    Some(Binding::Value(v)) => Ok(v),
                    Some(Binding::Ref(p)) => self.read_place(&p),
                    None => Err(Failure::ir(format!("no local `{}`", name))),
                }
            }
            PlaceRoot::Outer(o, owner) => {
                let (o, owner) = (o.clone(), *owner);
                self.with_host(|h, m| h.read(m, &o, owner))
            }
        }
    }

    pub fn read_place(&mut self, p: &Place) -> R<Value> {
        let mut v = self.read_root(&p.root)?;
        for s in &p.path {
            v = match (s, &v) {
                (Step::Field(f), Value::Record(r)) => r.get(f).cloned().ok_or_else(|| Failure::ir(format!("no field `{}`", f)))?,
                (Step::Index(i), Value::List(l)) => l.items.get(*i as usize).map(|i| i.value.clone()).ok_or_else(|| Failure::new(FailKind::Position, "a position outside the list"))?,
                (Step::Item(id), Value::List(l)) => {
                    l.items.iter().find(|i| i.id == *id).map(|i| i.value.clone()).ok_or_else(|| Failure::new(FailKind::Removed, "an item used after it was removed"))?
                }
                (Step::ItemOpt(id), Value::List(l)) => match l.items.iter().find(|i| i.id == *id) {
                    Some(i) => Value::some(i.value.clone()),
                    None => Value::none(),
                },
                (Step::Inside, Value::Opt(Some(x))) => (**x).clone(),
                (Step::Inside, Value::Opt(None)) => return Err(Failure::new(FailKind::Removed, "an opt that is empty")),
                _ => return Err(Failure::ir("a place that doesn't fit its value")),
            };
        }
        Ok(v)
    }

    pub fn write_place(&mut self, p: &Place, value: Value) -> R<()> {
        if p.path.is_empty() {
            return self.write_root(&p.root, value);
        }
        let mut whole = self.read_root(&p.root)?;
        write_path(&mut whole, &p.path, value)?;
        self.write_root(&p.root, whole)
    }

    fn write_root(&mut self, root: &PlaceRoot, value: Value) -> R<()> {
        match root {
            PlaceRoot::Local { frame, name } => {
                let target = {
                    let vars = &mut self.frames.get_mut(*frame).ok_or_else(|| Failure::ir("a reference outlived its fn"))?.vars;
                    let slot = vars.iter_mut().rev().find(|(n, _)| n == name).ok_or_else(|| Failure::ir(format!("no local `{}`", name)))?;
                    match &slot.1 {
                        Binding::Value(_) => {
                            slot.1 = Binding::Value(value);
                            return Ok(());
                        }
                        Binding::Ref(p) => p.clone(),
                    }
                };
                self.write_place(&target, value)
            }
            PlaceRoot::Outer(o, owner) => {
                let (o, owner) = (o.clone(), *owner);
                self.with_host(|h, m| h.write(m, &o, owner, value))
            }
        }
    }

    fn place(&mut self, p: &ir::Place) -> R<Place> {
        let mut out = match &p.root {
            ir::Root::Local(n) => match self.lookup(n) {
                Some((f, k)) => match &self.frames[f].vars[k].1 {
                    Binding::Ref(r) => r.clone(),
                    Binding::Value(_) => Place { root: PlaceRoot::Local { frame: f, name: Rc::from(n.as_str()) }, path: Vec::new() },
                },
                None => return Err(Failure::ir(format!("no local `{}`", n))),
            },
            ir::Root::Cell(n) => Place { root: PlaceRoot::Outer(Outer::Cell(Rc::from(n.as_str())), self.owner()), path: Vec::new() },
            ir::Root::Input(n) => Place { root: PlaceRoot::Outer(Outer::Input(Rc::from(n.as_str())), self.owner()), path: Vec::new() },
            ir::Root::State(n) => Place { root: PlaceRoot::Outer(Outer::State(Rc::from(n.as_str())), None), path: Vec::new() },
        };
        for s in &p.path {
            match s {
                ir::Step::Field(f) => out.path.push(Step::Field(Rc::from(f.name.as_str()))),
                ir::Step::Item(i) => {
                    let at = self.eval(&i.at)?;
                    let n = at.as_num().and_then(|n| n.to_i64()).ok_or_else(|| Failure::new(FailKind::Position, "a position that isn't a whole number"))?;
                    out.path.push(Step::Index(n));
                }
            }
        }
        Ok(out)
    }

    // ---- statements

    fn block(&mut self, stmts: &[Stmt]) -> R<Flow> {
        let mark = self.frame().vars.len();
        let mut flow = Flow::Normal;
        for s in stmts {
            flow = self.stmt(s)?;
            if let Flow::Return(_) = flow {
                break;
            }
        }
        self.frames.last_mut().unwrap().vars.truncate(mark);
        Ok(flow)
    }

    fn stmt(&mut self, s: &Stmt) -> R<Flow> {
        self.step()?;
        match s {
            Stmt::Declare(d) => {
                let (name, value) = match d {
                    ir::StmtDeclare::Let(l) | ir::StmtDeclare::Mut(l) => (&l.name, &l.value),
                };
                let v = self.eval(value)?;
                self.bind(name, Binding::Value(v));
            }
            Stmt::Set(set) => {
                let v = self.eval(&set.value)?;
                let p = self.place(&set.place)?;
                self.write_place(&p, v)?;
            }
            Stmt::Return(r) => {
                let v = match &r.value {
                    Some(e) => Some(self.eval(e)?),
                    None => None,
                };
                return Ok(Flow::Return(v));
            }
            Stmt::If(i) => {
                for b in &i.branches {
                    let mark = self.frame().vars.len();
                    if self.cond(&b.when)? {
                        let flow = self.block(&b.then);
                        self.frames.last_mut().unwrap().vars.truncate(mark);
                        return flow;
                    }
                }
                return self.block(&i.else_);
            }
            Stmt::For(f) => return self.for_loop(f),
            Stmt::Match(m) => {
                let v = self.eval(&m.value)?;
                for c in &m.cases {
                    let mark = self.frame().vars.len();
                    if self.patterns(&c.when, &v)? {
                        let flow = self.block(&c.then);
                        self.frames.last_mut().unwrap().vars.truncate(mark);
                        return flow;
                    }
                }
                return self.block(&m.else_);
            }
            Stmt::Invoke(i) => {
                let mut args = Vec::new();
                for a in &i.args {
                    args.push(self.eval(a)?);
                }
                let owner = self.owner();
                let event = i.event.clone();
                self.with_host(|h, m| h.invoke(m, &event, args, owner))?;
            }
            Stmt::Call(c) => {
                self.call_expr(c)?;
            }
            Stmt::Apply(a) => {
                let f = self.eval(&a.fn_)?;
                let args = self.args(&a.args)?;
                self.apply(&f, args)?;
            }
        }
        Ok(Flow::Normal)
    }

    fn cond(&mut self, c: &Cond) -> R<bool> {
        match c {
            Cond::Cond(e) => self.eval(e)?.as_bool().ok_or_else(|| Failure::ir("a condition that isn't a bool")),
            Cond::Open(o) => {
                if o.mutable {
                    let mut target = self.place_of(&o.opt)?;
                    // `xs[i]` is an opt: none past the end, and otherwise the item itself, by its identity
                    if let Some(Step::Index(i)) = target.path.last() {
                        let i = *i;
                        let mut list = target.clone();
                        list.path.pop();
                        let id = match self.read_place(&list)? {
                            Value::List(l) => usize::try_from(i).ok().and_then(|i| l.items.get(i)).map(|item| item.id),
                            _ => None,
                        };
                        let Some(id) = id else { return Ok(false) };
                        target.path.pop();
                        target.path.push(Step::Item(id));
                    }
                    let (inside, now) = match target.path.last() {
                        Some(Step::ItemOpt(id)) => {
                            let mut p = target.clone();
                            let id = *id;
                            p.path.pop();
                            p.path.push(Step::Item(id));
                            (p, self.read_place(&target)?)
                        }
                        _ => {
                            let mut p = target.clone();
                            p.path.push(Step::Inside);
                            (p, self.read_place(&target)?)
                        }
                    };
                    match now {
                        Value::Opt(Some(_)) => {
                            self.bind(&o.name, Binding::Ref(inside));
                            Ok(true)
                        }
                        Value::Opt(None) => Ok(false),
                        // a plain value where an opt is wanted is always there
                        _ => {
                            let mut p = inside;
                            p.path.pop();
                            self.bind(&o.name, Binding::Ref(p));
                            Ok(true)
                        }
                    }
                } else {
                    match self.eval(&o.opt)? {
                        Value::Opt(Some(v)) => {
                            self.bind(&o.name, Binding::Value((*v).clone()));
                            Ok(true)
                        }
                        Value::Opt(None) => Ok(false),
                        v => {
                            self.bind(&o.name, Binding::Value(v));
                            Ok(true)
                        }
                    }
                }
            }
        }
    }

    /// The place an expression stands for: a `place`, or a local that refers to one.
    fn place_of(&mut self, e: &Expr) -> R<Place> {
        match e {
            Expr::Place(p) => self.place(p),
            Expr::Get(ir::Get::Local(n)) => self.place(&ir::Place { root: ir::Root::Local(n.clone()), path: Vec::new() }),
            Expr::Get(ir::Get::Cell(n)) => self.place(&ir::Place { root: ir::Root::Cell(n.clone()), path: Vec::new() }),
            Expr::Get(ir::Get::Input(n)) => self.place(&ir::Place { root: ir::Root::Input(n.clone()), path: Vec::new() }),
            Expr::Get(ir::Get::State(n)) => self.place(&ir::Place { root: ir::Root::State(n.clone()), path: Vec::new() }),
            Expr::Field(f) => {
                let mut p = self.place_of(&f.value)?;
                p.path.push(Step::Field(Rc::from(f.name.as_str())));
                Ok(p)
            }
            _ => Err(Failure::ir("a mut place that isn't a variable")),
        }
    }

    fn for_loop(&mut self, f: &ir::StmtFor) -> R<Flow> {
        if f.mutable {
            let list_place = self.place_of(&f.over)?;
            let ids: Vec<u64> = match self.read_place(&list_place)? {
                Value::List(l) => l.items.iter().map(|i| i.id).collect(),
                _ => return Err(Failure::ir("`mut for` over something that isn't a list")),
            };
            for (k, id) in ids.into_iter().enumerate() {
                self.step()?;
                let mark = self.frame().vars.len();
                if let Some(p) = &f.position {
                    self.bind(p, Binding::Value(Value::Num(Num::int(k as i64))));
                }
                let mut item = list_place.clone();
                item.path.push(Step::ItemOpt(id));
                self.bind(&f.name, Binding::Ref(item));
                let flow = self.block(&f.body)?;
                self.frames.last_mut().unwrap().vars.truncate(mark);
                if let Flow::Return(_) = flow {
                    return Ok(flow);
                }
            }
            return Ok(Flow::Normal);
        }
        let over = self.eval(&f.over)?;
        match over {
            Value::List(l) => {
                for (k, item) in l.items.iter().enumerate() {
                    self.step()?;
                    let mark = self.frame().vars.len();
                    if let Some(p) = &f.position {
                        self.bind(p, Binding::Value(Value::Num(Num::int(k as i64))));
                    }
                    self.bind(&f.name, Binding::Value(item.value.clone()));
                    let flow = self.block(&f.body)?;
                    self.frames.last_mut().unwrap().vars.truncate(mark);
                    if let Flow::Return(_) = flow {
                        return Ok(flow);
                    }
                }
                Ok(Flow::Normal)
            }
            Value::Range(r) => {
                let values = self.walk_range(&r)?;
                for (k, v) in values.into_iter().enumerate() {
                    self.step()?;
                    let mark = self.frame().vars.len();
                    if let Some(p) = &f.position {
                        self.bind(p, Binding::Value(Value::Num(Num::int(k as i64))));
                    }
                    self.bind(&f.name, Binding::Value(v));
                    let flow = self.block(&f.body)?;
                    self.frames.last_mut().unwrap().vars.truncate(mark);
                    if let Flow::Return(_) = flow {
                        return Ok(flow);
                    }
                }
                Ok(Flow::Normal)
            }
            _ => Err(Failure::ir("`for` over something that isn't a list or a range")),
        }
    }

    /// The numbers a range walks: from its low end to its high one, by its step (1 when none).
    pub fn walk_range(&mut self, r: &RangeValue) -> R<Vec<Value>> {
        let low = r.low.as_ref().and_then(|v| v.as_num()).ok_or_else(|| Failure::ir("a range with no start can't be walked"))?;
        let step = r.step.as_ref().and_then(|v| v.as_num()).unwrap_or(Num::int(1));
        if step.is_zero() {
            return Err(Failure::new(FailKind::Limit(Limit::Items), "a range walked by a step of 0"));
        }
        let high = r.high.as_ref().and_then(|v| v.as_num());
        let mut out = Vec::new();
        let mut x = low;
        loop {
            match high {
                Some(h) if (!step.is_negative() && x > h) || (step.is_negative() && x < h) => break,
                _ => {}
            }
            if out.len() >= MAX_ITEMS {
                return Err(Failure::new(FailKind::Limit(Limit::Items), "a range of more than 10,000 items"));
            }
            out.push(Value::Num(x));
            x = x.add(step)?;
        }
        Ok(out)
    }

    fn patterns(&mut self, pats: &[ir::Pattern], v: &Value) -> R<bool> {
        for p in pats {
            let hit = match (p, v) {
                (ir::Pattern::Case(c), Value::Case(x)) => {
                    if &*x.ty == c.enum_ && &*x.name == c.name {
                        for (name, (_, val)) in c.binds.iter().zip(x.values.iter()) {
                            self.bind(name, Binding::Value(val.clone()));
                        }
                        true
                    } else {
                        false
                    }
                }
                (ir::Pattern::Case(c), Value::Opt(o)) => match (c.name.as_str(), o) {
                    ("SOME", Some(inner)) => {
                        if let Some(name) = c.binds.first() {
                            self.bind(name, Binding::Value((**inner).clone()));
                        }
                        true
                    }
                    ("NONE", None) => true,
                    _ => false,
                },
                (ir::Pattern::Case(c), Value::Bool(b)) => c.name == if *b { "TRUE" } else { "FALSE" },
                (ir::Pattern::Num(n), Value::Num(x)) => Num::parse(n).map_or(false, |n| n == *x),
                (ir::Pattern::Text(t), Value::Text(x)) => t.as_str() == &**x,
                (ir::Pattern::Bool(b), Value::Bool(x)) => b == x,
                _ => false,
            };
            if hit {
                return Ok(true);
            }
        }
        Ok(false)
    }

    // ---- expressions

    pub fn eval(&mut self, e: &Expr) -> R<Value> {
        Ok(match e {
            Expr::Num(n) => Value::Num(Num::parse(n).ok_or_else(|| Failure::ir(format!("`{}` is not a number", n)))?),
            Expr::Text(t) => Value::text(t),
            Expr::Bool(b) => Value::Bool(*b),
            Expr::Duration(n) => Value::Duration(Num::parse(n).ok_or_else(|| Failure::ir("a duration that isn't a number"))?),
            Expr::List(items) => {
                let mut out = Vec::with_capacity(items.len());
                for i in items {
                    out.push(self.eval(i)?);
                }
                self.make_list(out)?
            }
            Expr::Record(r) => {
                let mut given = Vec::new();
                for (k, v) in &r.fields {
                    given.push((k.clone(), self.eval(v)?));
                }
                self.make_record(&r.ty, given, false)?
            }
            Expr::Case(c) => {
                let mut values = Vec::new();
                for (k, v) in &c.values {
                    values.push((Rc::from(k.as_str()), self.eval(v)?));
                }
                let values = self.order_case_values(&c.enum_, &c.name, values);
                Value::Case(Rc::new(Case { ty: Rc::from(c.enum_.as_str()), name: Rc::from(c.name.as_str()), values }))
            }
            Expr::Some(x) => Value::some(self.eval(x)?),
            Expr::None(_) => Value::none(),
            Expr::Range(r) => Value::Range(Rc::new(RangeValue {
                low: r.low.as_ref().map(|x| self.eval(x)).transpose()?,
                high: r.high.as_ref().map(|x| self.eval(x)).transpose()?,
                step: r.step.as_ref().map(|x| self.eval(x)).transpose()?,
            })),
            Expr::Token(name) => {
                let (ty, case) = name.rsplit_once('.').ok_or_else(|| Failure::ir("a token without a case"))?;
                Value::Case(Rc::new(Case { ty: Rc::from(ty), name: Rc::from(case), values: Vec::new() }))
            }
            Expr::Tokval(t) => {
                let v = self.eval(&t.value)?;
                let field = self.case_fields(&t.ty, &t.name).into_iter().next().unwrap_or_else(|| "value".into());
                Value::Case(Rc::new(Case { ty: Rc::from(t.ty.as_str()), name: Rc::from(t.name.as_str()), values: vec![(Rc::from(field.as_str()), v)] }))
            }
            Expr::Rich(r) => self.rich(r)?,
            Expr::Template(t) => self.template(t)?,
            Expr::View(v) => {
                let mut args = std::collections::BTreeMap::new();
                for (k, x) in &v.args {
                    args.insert(k.clone(), self.eval(x)?);
                }
                let captured = self.frame().vars.clone();
                Value::View(Rc::new(ViewValue { widget: Rc::from(v.widget.as_str()), args, slots: v.slots.clone(), events: v.events.clone(), exprs: v.args.clone(), captured, owner: self.owner() }))
            }
            Expr::Get(g) => self.get(g)?,
            Expr::Bind(id) => return Err(Failure::new(FailKind::NotConstant, format!("binding {} is worked out when the page runs", id))),
            Expr::Field(f) => {
                let v = self.eval(&f.value)?;
                self.field(&v, &f.name)?
            }
            Expr::Call(c) => self.call_expr(c)?.ok_or_else(|| Failure::ir(format!("`{}` returns nothing", c.name)))?,
            Expr::Apply(a) => {
                let f = self.eval(&a.fn_)?;
                let args = self.args(&a.args)?;
                self.apply(&f, args)?.ok_or_else(|| Failure::ir("a fn value that returns nothing"))?
            }
            Expr::Op(op) => self.op(op)?,
            Expr::Show(s) => {
                let v = self.eval(&s.value)?;
                Value::text(&self.show(&v)?)
            }
            Expr::Fn(l) => {
                let captured = self.frame().vars.clone();
                Value::Fn(Rc::new(Closure { params: l.params.clone(), body: Rc::new(l.body.clone()), captured, owner: self.owner() }))
            }
            Expr::Place(p) => {
                let p = self.place(p)?;
                self.read_place(&p)?
            }
            Expr::Try(t) => self.try_value(&t.value)?,
            Expr::With(w) => {
                let base = self.eval(&w.value)?;
                let mut given = Vec::new();
                for (k, v) in &w.fields {
                    given.push((k.clone(), self.eval(v)?));
                }
                self.with(base, given, false)?
            }
        })
    }

    fn get(&mut self, g: &ir::Get) -> R<Value> {
        let outer = match g {
            ir::Get::Local(n) => {
                let (f, k) = self.lookup(n).ok_or_else(|| Failure::ir(format!("no local `{}`", n)))?;
                return match self.frames[f].vars[k].1.clone() {
                    Binding::Value(v) => Ok(v),
                    Binding::Ref(p) => self.read_place(&p),
                };
            }
            ir::Get::Input(n) => Outer::Input(Rc::from(n.as_str())),
            ir::Get::Cell(n) => Outer::Cell(Rc::from(n.as_str())),
            ir::Get::State(n) => Outer::State(Rc::from(n.as_str())),
            ir::Get::Let(n) => Outer::Let(Rc::from(n.as_str())),
            ir::Get::Slot(n) => Outer::Slot(Rc::from(n.as_str())),
            ir::Get::Extern(n) => Outer::Extern(Rc::from(n.as_str())),
            ir::Get::Token(n) => return self.eval(&Expr::Token(n.clone())),
        };
        let owner = self.owner();
        self.with_host(|h, m| h.read(m, &outer, owner))
    }

    pub fn field(&mut self, v: &Value, name: &str) -> R<Value> {
        match v {
            Value::Record(r) => r.get(name).cloned().ok_or_else(|| Failure::ir(format!("`{}` has no field `{}`", r.ty, name))),
            Value::View(view) => view.args.get(name).cloned().ok_or_else(|| Failure::ir(format!("the view has no input `{}`", name))),
            // a token's record value lets its fields through: color.INK.light
            Value::Case(c) if self.prog.tokens.contains_key(&*c.ty) => {
                let c = c.clone();
                let value = self.with_host(|h, m| h.token_value(m, &c))?;
                self.field(&value, name)
            }
            _ => Err(Failure::ir(format!("no field `{}` on a {}", name, v.type_name()))),
        }
    }

    pub fn default_token_value(&mut self, case: &Case) -> R<Value> {
        let t = self.prog.tokens.get(&*case.ty).cloned().ok_or_else(|| Failure::ir(format!("`{}` is not a token type", case.ty)))?;
        if let Some((_, v)) = case.values.first() {
            return Ok(v.clone());
        }
        let e = t.values.get(&*case.name).ok_or_else(|| Failure::ir(format!("no value for `{}.{}`", case.ty, case.name)))?;
        self.eval(e)
    }

    fn case_fields(&self, ty: &str, name: &str) -> Vec<String> {
        let cases = if let Some(e) = self.prog.enums.get(ty) {
            &e.cases
        } else if let Some(t) = self.prog.tokens.get(ty) {
            &t.cases
        } else {
            return Vec::new();
        };
        cases.iter().find(|c| c.name == name).map(|c| c.fields.iter().map(|f| f.name.clone()).collect()).unwrap_or_default()
    }

    fn order_case_values(&self, ty: &str, name: &str, values: Vec<(Rc<str>, Value)>) -> Vec<(Rc<str>, Value)> {
        let order = self.case_fields(ty, name);
        if order.is_empty() {
            return values;
        }
        let mut out = Vec::new();
        for f in order {
            if let Some((k, v)) = values.iter().find(|(k, _)| **k == *f) {
                out.push((k.clone(), v.clone()));
            }
        }
        out
    }

    fn args(&mut self, args: &[Expr]) -> R<Vec<Binding>> {
        let mut out = Vec::with_capacity(args.len());
        for a in args {
            out.push(match a {
                Expr::Place(p) => Binding::Ref(self.place(p)?),
                other => Binding::Value(self.eval(other)?),
            });
        }
        Ok(out)
    }

    pub fn value_of(&mut self, b: &Binding) -> R<Value> {
        match b {
            Binding::Value(v) => Ok(v.clone()),
            Binding::Ref(p) => self.read_place(p),
        }
    }

    fn call_expr(&mut self, c: &ir::Call) -> R<Option<Value>> {
        let args = self.args(&c.args)?;
        self.call(&c.name, args)
    }

    /// Calls a fn by its full name: a native, an extern, one written in MKP, or an interface's.
    pub fn call(&mut self, name: &str, args: Vec<Binding>) -> R<Option<Value>> {
        self.step()?;
        if let Some(f) = self.prog.fns.get(name).cloned() {
            return self.run_fn(&f.params, &f.body, args, None);
        }
        if let Some(out) = natives::call(self, name, &args) {
            return out;
        }
        if let Some(ext) = self.prog.externs.get(name).cloned() {
            let mut values = Vec::new();
            for a in &args {
                values.push(self.value_of(a)?);
            }
            let n = name.to_string();
            if let Some(answer) = self.with_host(|h, m| h.call_extern(m, &n, &values))? {
                return Ok(answer);
            }
            if !ext.default.is_empty() {
                return self.run_fn(&ext.params, &ext.default, args, None);
            }
            return Err(Failure::new(FailKind::NotConstant, format!("nobody supplies `{}`", name)));
        }
        if let Some((iface, f)) = name.rsplit_once('.') {
            if self.prog.interfaces.contains_key(iface) {
                return self.dispatch(iface, f, args);
            }
        }
        Err(Failure::ir(format!("no fn `{}`", name)))
    }

    /// An interface's fn, sent to the fn of the first argument's own type.
    fn dispatch(&mut self, iface: &str, f: &str, args: Vec<Binding>) -> R<Option<Value>> {
        let first = self.value_of(args.first().ok_or_else(|| Failure::ir("an interface fn with no value"))?)?;
        let own = format!("{}.{}", first.type_name(), f);
        if self.prog.fns.contains_key(&own) || natives::exists(&own) || self.prog.externs.contains_key(&own) {
            return self.call(&own, args);
        }
        // what the language gives every type: same field by field, and enums in their order
        match (iface, f) {
            ("core/same", "same") => {
                let b = self.value_of(&args[1])?;
                Ok(Some(Value::Bool(self.equal(&first, &b)?)))
            }
            ("core/ordered", "before") => {
                let b = self.value_of(&args[1])?;
                Ok(Some(Value::Bool(self.before(&first, &b)?)))
            }
            ("core/shown", "show") => Ok(Some(Value::text(&self.show(&first)?))),
            _ => Err(Failure::ir(format!("`{}` has no fn `{}`", first.type_name(), f))),
        }
    }

    fn run_fn(&mut self, params: &[ir::Param], body: &[Stmt], args: Vec<Binding>, closure: Option<&Closure>) -> R<Option<Value>> {
        if self.depth >= MAX_DEPTH {
            return Err(Failure::new(FailKind::Limit(Limit::Depth), "calls more than 64 deep"));
        }
        let mut vars = Vec::new();
        let mut owner = self.owner();
        if let Some(c) = closure {
            vars.extend(c.captured.iter().cloned());
            owner = c.owner;
        }
        for (p, a) in params.iter().zip(args) {
            vars.push((Rc::from(p.name.as_str()), if p.mutable { a } else { Binding::Value(self.value_of(&a)?) }));
        }
        self.depth += 1;
        self.frames.push(Frame { vars, owner });
        let flow = self.block(body);
        self.frames.pop();
        self.depth -= 1;
        Ok(match flow? {
            Flow::Return(v) => v,
            Flow::Normal => None,
        })
    }

    pub fn apply(&mut self, f: &Value, args: Vec<Binding>) -> R<Option<Value>> {
        self.step()?;
        match f {
            Value::Fn(c) => {
                let c = c.clone();
                self.run_fn(&c.params, &c.body, args, Some(&c))
            }
            _ => Err(Failure::ir("a call of something that isn't a fn")),
        }
    }

    fn op(&mut self, op: &ir::ExprOp) -> R<Value> {
        let a = &op.args;
        match op.name {
            OpName::And => {
                let l = self.eval(&a[0])?.as_bool().unwrap_or(false);
                return Ok(Value::Bool(l && self.eval(&a[1])?.as_bool().unwrap_or(false)));
            }
            OpName::Or => {
                let l = self.eval(&a[0])?.as_bool().unwrap_or(false);
                return Ok(Value::Bool(l || self.eval(&a[1])?.as_bool().unwrap_or(false)));
            }
            OpName::Pick => {
                let c = self.eval(&a[0])?.as_bool().unwrap_or(false);
                return self.eval(if c { &a[1] } else { &a[2] });
            }
            OpName::Not => return Ok(Value::Bool(!self.eval(&a[0])?.as_bool().unwrap_or(false))),
            OpName::Minus if a.len() == 1 => {
                return match self.eval(&a[0])? {
                    Value::Num(n) => Ok(Value::Num(n.neg())),
                    Value::Duration(n) => Ok(Value::Duration(n.neg())),
                    _ => Err(Failure::ir("`-` on something that isn't a number")),
                };
            }
            _ => {}
        }
        let l = self.eval(&a[0])?;
        let r = self.eval(&a[1])?;
        Ok(match op.name {
            OpName::Eq => Value::Bool(self.equal(&l, &r)?),
            OpName::Ne => Value::Bool(!self.equal(&l, &r)?),
            OpName::Lt => Value::Bool(self.before(&l, &r)?),
            OpName::Gt => Value::Bool(self.before(&r, &l)?),
            OpName::Le => Value::Bool(!self.before(&r, &l)?),
            OpName::Ge => Value::Bool(!self.before(&l, &r)?),
            _ => {
                let (x, y) = match (&l, &r) {
                    (Value::Num(x), Value::Num(y)) | (Value::Duration(x), Value::Duration(y)) | (Value::Duration(x), Value::Num(y)) => (*x, *y),
                    _ => return Err(Failure::ir(format!("`{:?}` on values that aren't numbers", op.name))),
                };
                let n = match op.name {
                    OpName::Plus => x.add(y)?,
                    OpName::Minus => x.sub(y)?,
                    OpName::Times => x.mul(y)?,
                    OpName::Divide => x.div(y)?,
                    OpName::Rem => x.rem(y)?,
                    _ => return Err(Failure::ir("an operator that isn't arithmetic")),
                };
                if matches!(l, Value::Duration(_)) && matches!(op.name, OpName::Plus | OpName::Minus | OpName::Times | OpName::Divide) {
                    Value::Duration(n)
                } else {
                    Value::Num(n)
                }
            }
        })
    }

    /// `==`: field by field, unless a type's pack writes its own `same`.
    pub fn equal(&mut self, a: &Value, b: &Value) -> R<bool> {
        Ok(match (a, b) {
            (Value::Num(x), Value::Num(y)) | (Value::Duration(x), Value::Duration(y)) => x == y,
            (Value::Text(x), Value::Text(y)) => x == y,
            (Value::Bool(x), Value::Bool(y)) => x == y,
            (Value::List(x), Value::List(y)) => {
                if x.items.len() != y.items.len() {
                    return Ok(false);
                }
                for (p, q) in x.items.iter().zip(y.items.iter()) {
                    if !self.equal(&p.value, &q.value)? {
                        return Ok(false);
                    }
                }
                true
            }
            (Value::Record(x), Value::Record(y)) => {
                if x.ty != y.ty {
                    return Ok(false);
                }
                if let Some(same) = self.prog.records.get(&*x.ty).and_then(|r| r.same.clone()) {
                    let out = self.call(&same, vec![Binding::Value(a.clone()), Binding::Value(b.clone())])?;
                    return Ok(out.and_then(|v| v.as_bool()).unwrap_or(false));
                }
                for ((_, p), (_, q)) in x.fields.iter().zip(y.fields.iter()) {
                    if !self.equal(p, q)? {
                        return Ok(false);
                    }
                }
                true
            }
            (Value::Case(x), Value::Case(y)) => {
                if x.ty != y.ty || x.name != y.name || x.values.len() != y.values.len() {
                    return Ok(false);
                }
                for ((_, p), (_, q)) in x.values.iter().zip(y.values.iter()) {
                    if !self.equal(p, q)? {
                        return Ok(false);
                    }
                }
                true
            }
            (Value::Opt(None), Value::Opt(None)) => true,
            (Value::Opt(Some(x)), Value::Opt(Some(y))) => self.equal(x, y)?,
            (Value::Opt(_), Value::Opt(_)) => false,
            // a plain value where an opt is wanted
            (Value::Opt(Some(x)), y) | (y, Value::Opt(Some(x))) if !matches!(y, Value::Opt(_)) => self.equal(x, y)?,
            (Value::Range(x), Value::Range(y)) => {
                let parts = |r: &RangeValue| [r.low.clone(), r.high.clone(), r.step.clone()];
                for (p, q) in parts(x).iter().zip(parts(y).iter()) {
                    match (p, q) {
                        (None, None) => {}
                        (Some(p), Some(q)) if self.equal(p, q)? => {}
                        _ => return Ok(false),
                    }
                }
                true
            }
            _ => false,
        })
    }

    /// `<`: numbers and texts by value, enums in the order written, anything else by `before`.
    pub fn before(&mut self, a: &Value, b: &Value) -> R<bool> {
        Ok(match (a, b) {
            (Value::Num(x), Value::Num(y)) | (Value::Duration(x), Value::Duration(y)) => x < y,
            (Value::Text(x), Value::Text(y)) => x < y,
            (Value::Bool(x), Value::Bool(y)) => !x && *y,
            (Value::Case(x), Value::Case(y)) if x.ty == y.ty => {
                let order = self.prog.enums.get(&*x.ty).map(|e| e.cases.iter().map(|c| c.name.clone()).collect::<Vec<_>>()).unwrap_or_default();
                let at = |n: &str| order.iter().position(|c| c == n).unwrap_or(0);
                at(&x.name) < at(&y.name)
            }
            _ => {
                let own = format!("{}.before", a.type_name());
                let out = self.call(&own, vec![Binding::Value(a.clone()), Binding::Value(b.clone())])?;
                out.and_then(|v| v.as_bool()).unwrap_or(false)
            }
        })
    }

    /// How a value is shown in a hole (page 5).
    pub fn show(&mut self, v: &Value) -> R<String> {
        Ok(match v {
            Value::Num(n) => n.show(),
            Value::Text(t) => t.to_string(),
            Value::Bool(b) => b.to_string(),
            Value::Duration(n) => natives::show_duration(n),
            Value::Opt(Some(x)) => self.show(x)?,
            _ => {
                let own = format!("{}.show", v.type_name());
                match self.call(&own, vec![Binding::Value(v.clone())])? {
                    Some(Value::Text(t)) => t.to_string(),
                    _ => return Err(Failure::ir(format!("`{}` has no show", v.type_name()))),
                }
            }
        })
    }

    // ---- records

    /// A record from its fields, with the defaults it has, its rules run. With `checked`, its
    /// fields' contracts are checked too, as `try` does.
    pub fn make_record(&mut self, ty: &str, given: Vec<(String, Value)>, checked: bool) -> R<Value> {
        let decl = match self.prog.records.get(ty).cloned() {
            Some(d) => d,
            None => {
                // an inline record: the fields as given
                let fields = given.into_iter().map(|(k, v)| (Rc::from(k.as_str()), v)).collect();
                return Ok(Value::Record(Rc::new(Record { ty: Rc::from(ty), fields })));
            }
        };
        let mut fields = Vec::with_capacity(decl.fields.len());
        for f in &decl.fields {
            let v = match given.iter().find(|(k, _)| *k == f.name) {
                Some((_, v)) => v.clone(),
                None => match &f.default {
                    Some(d) => self.eval(d)?,
                    None => return Err(Failure::ir(format!("`{}` is made without its field `{}`", ty, f.name))),
                },
            };
            if checked && !self.fits(&v, &f.ty)? {
                return Err(Failure::rule(&format!("{}'s {} is outside its contract", short(ty), f.name)));
            }
            fields.push((Rc::from(f.name.as_str()), v));
        }
        let record = Value::Record(Rc::new(Record { ty: Rc::from(ty), fields }));
        self.check_requires(&decl, &record)?;
        Ok(record)
    }

    fn with(&mut self, base: Value, given: Vec<(String, Value)>, checked: bool) -> R<Value> {
        let Value::Record(r) = base else {
            return Err(Failure::ir("`with` on something that isn't a record"));
        };
        let mut r = (*r).clone();
        for (k, v) in given {
            if let Some(slot) = r.get_mut(&k) {
                *slot = v;
            }
        }
        if checked {
            if let Some(decl) = self.prog.records.get(&*r.ty).cloned() {
                for f in &decl.fields {
                    if let Some(v) = r.get(&f.name) {
                        if !self.fits(&v.clone(), &f.ty)? {
                            return Err(Failure::rule(&format!("{}'s {} is outside its contract", short(&r.ty), f.name)));
                        }
                    }
                }
            }
        }
        let ty = r.ty.clone();
        let record = Value::Record(Rc::new(r));
        if let Some(decl) = self.prog.records.get(&*ty).cloned() {
            self.check_requires(&decl, &record)?;
        }
        Ok(record)
    }

    fn check_requires(&mut self, decl: &ir::Record, record: &Value) -> R<()> {
        if decl.requires.is_empty() {
            return Ok(());
        }
        let Value::Record(r) = record else { return Ok(()) };
        for rule in &decl.requires {
            let args: Vec<Binding> = r.fields.iter().map(|(_, v)| Binding::Value(v.clone())).collect();
            let params: Vec<ir::Param> = r.fields.iter().map(|(n, _)| ir::Param { name: n.to_string(), ty: ir::Type::named("core/any"), mutable: false }).collect();
            match self.run_fn(&params, &rule.body, args, None)? {
                Some(Value::Bool(true)) => {}
                _ => return Err(Failure::rule(&rule.message)),
            }
        }
        Ok(())
    }

    fn try_value(&mut self, e: &Expr) -> R<Value> {
        let out = match e {
            Expr::Record(r) => {
                let mut given = Vec::new();
                for (k, v) in &r.fields {
                    given.push((k.clone(), self.eval(v)?));
                }
                self.make_record(&r.ty, given, true)
            }
            Expr::With(w) => {
                let base = self.eval(&w.value)?;
                let mut given = Vec::new();
                for (k, v) in &w.fields {
                    given.push((k.clone(), self.eval(v)?));
                }
                self.with(base, given, true)
            }
            Expr::Case(c) => {
                let v = self.eval(e)?;
                let fields = self.case_field_types(&c.enum_, &c.name);
                if let Value::Case(cv) = &v {
                    for ((_, value), ty) in cv.values.iter().zip(fields.iter()) {
                        if !self.fits(value, ty)? {
                            return Ok(Value::none());
                        }
                    }
                }
                Ok(v)
            }
            Expr::Tokval(t) => {
                let v = self.eval(e)?;
                let fields = self.case_field_types(&t.ty, &t.name);
                if let (Value::Case(cv), Some(ty)) = (&v, fields.first()) {
                    if let Some((_, value)) = cv.values.first() {
                        if !self.fits(value, ty)? {
                            return Ok(Value::none());
                        }
                    }
                }
                Ok(v)
            }
            other => self.eval(other),
        };
        match out {
            Ok(v) => Ok(Value::some(v)),
            Err(f) if f.kind == FailKind::Rule => {
                self.last_rule = f.rule.clone();
                Ok(Value::none())
            }
            Err(f) => Err(f),
        }
    }

    fn case_field_types(&self, ty: &str, name: &str) -> Vec<ir::Type> {
        let cases = if let Some(e) = self.prog.enums.get(ty) {
            e.cases.clone()
        } else if let Some(t) = self.prog.tokens.get(ty) {
            t.cases.clone()
        } else {
            return Vec::new();
        };
        cases.iter().find(|c| c.name == name).map(|c| c.fields.iter().map(|f| f.ty.clone()).collect()).unwrap_or_default()
    }

    /// Whether a value is inside a type's contract, its aliases' contracts included.
    pub fn fits(&mut self, v: &Value, ty: &ir::Type) -> R<bool> {
        let mut contracts = Vec::new();
        let mut t = ty.clone();
        let mut guard = 0;
        loop {
            if let Some(c) = &t.contract {
                contracts.push(c.clone());
            }
            match self.prog.aliases.get(&t.name) {
                Some(next) if guard < 16 => {
                    t = next.clone();
                    guard += 1;
                }
                _ => break,
            }
        }
        for c in &contracts {
            if !self.fits_contract(v, c)? {
                return Ok(false);
            }
        }
        // the items of a list, and the value inside an opt
        match (v, t.name.as_str()) {
            (Value::List(l), "core/list") => {
                if let Some(item) = t.args.first() {
                    for i in l.items.clone().iter() {
                        if !self.fits(&i.value, item)? {
                            return Ok(false);
                        }
                    }
                }
            }
            (Value::Opt(Some(x)), "core/opt") => {
                if let Some(inner) = t.args.first() {
                    return self.fits(&x.clone(), inner);
                }
            }
            _ => {}
        }
        Ok(true)
    }

    fn fits_contract(&mut self, v: &Value, c: &ir::Contract) -> R<bool> {
        if let Some(r) = &c.range {
            if let Some(low) = &r.low {
                let low = self.eval(low)?;
                if self.before(v, &low)? {
                    return Ok(false);
                }
            }
            if let Some(high) = &r.high {
                let high = self.eval(high)?;
                if self.before(&high, v)? {
                    return Ok(false);
                }
            }
        }
        if let Some(step) = &c.step {
            let step = self.eval(step)?.as_num().unwrap_or(Num::int(1));
            let from = match c.range.as_ref().and_then(|r| r.low.as_ref()) {
                Some(l) => self.eval(l)?.as_num().unwrap_or(Num::zero()),
                None => Num::zero(),
            };
            if let Some(x) = v.as_num() {
                let k = x.sub(from)?.div(step)?;
                if !k.is_int() {
                    return Ok(false);
                }
            }
        }
        if let Some(len) = &c.length {
            let n = match v {
                Value::Text(t) => t.chars().count() as i64,
                Value::List(l) => l.items.len() as i64,
                _ => 0,
            };
            if let Some(low) = &len.low {
                if let Some(l) = self.eval(low)?.as_num().and_then(|x| x.to_i64()) {
                    if n < l {
                        return Ok(false);
                    }
                }
            }
            if let Some(high) = &len.high {
                if let Some(h) = self.eval(high)?.as_num().and_then(|x| x.to_i64()) {
                    if n > h {
                        return Ok(false);
                    }
                }
            }
        }
        if !c.only.is_empty() {
            let mut any = false;
            for o in &c.only {
                let o = self.eval(o)?;
                if self.equal(v, &o)? {
                    any = true;
                    break;
                }
            }
            if !any {
                return Ok(false);
            }
        }
        Ok(true)
    }

    // ---- prose values

    fn rich(&mut self, r: &ir::Rich) -> R<Value> {
        let mut segments = Vec::new();
        for s in &r.segments {
            let s = &s.segment;
            let part = |name: &str, values: Vec<(&str, Value)>| {
                Value::Case(Rc::new(Case {
                    ty: Rc::from("core/part"),
                    name: Rc::from(name),
                    values: values.into_iter().map(|(k, v)| (Rc::from(k), v)).collect(),
                }))
            };
            let value = match &s.value {
                Some(v) => Some(self.eval(v)?),
                None => None,
            };
            let name = format!("{:?}", s.part).to_uppercase();
            let p = match name.as_str() {
                "TEXT" | "CODE" => part(&name, vec![("value", value.unwrap_or_else(|| Value::text("")))]),
                "MATH" => part("MATH", vec![("tex", value.ok_or_else(|| Failure::ir("maths with no TeX"))?)]),
                "NOTE" => part("NOTE", vec![("mark", value.unwrap_or_else(|| Value::text("")))]),
                "VIEW" => part("VIEW", vec![("child", value.ok_or_else(|| Failure::ir("a view segment with no view"))?)]),
                "IMAGE" => {
                    let src = match &s.src {
                        Some(x) => self.eval(x)?,
                        None => Value::text(""),
                    };
                    let alt = match &s.alt {
                        Some(x) => self.eval(x)?,
                        None => Value::text(""),
                    };
                    part("IMAGE", vec![("src", src), ("alt", alt)])
                }
                _ => part("BREAK", vec![]),
            };
            let m = s.marks.clone().unwrap_or(ir::Marks { bold: false, italic: false, strike: false, link: None });
            let link = match &m.link {
                Some(l) => Value::some(self.eval(l)?),
                None => Value::none(),
            };
            let marks = Value::Record(Rc::new(Record {
                ty: Rc::from("core/marks"),
                fields: vec![
                    (Rc::from("bold"), Value::Bool(m.bold)),
                    (Rc::from("italic"), Value::Bool(m.italic)),
                    (Rc::from("strike"), Value::Bool(m.strike)),
                    (Rc::from("link"), link),
                ],
            }));
            segments.push(Value::Record(Rc::new(Record { ty: Rc::from("core/segment"), fields: vec![(Rc::from("part"), p), (Rc::from("marks"), marks)] })));
        }
        let list = self.make_list(segments)?;
        Ok(Value::Record(Rc::new(Record { ty: Rc::from("core/rich_text"), fields: vec![(Rc::from("segments"), list)] })))
    }

    fn template(&mut self, t: &ir::ExprTemplate) -> R<Value> {
        if t.ty.name == "core/text" {
            let mut out = String::new();
            for (k, piece) in t.pieces.iter().enumerate() {
                out.push_str(piece);
                if let Some(h) = t.holes.get(k) {
                    let v = self.eval(h)?;
                    out.push_str(&self.show(&v)?);
                }
            }
            return Ok(Value::text(&out));
        }
        let pieces: Vec<Value> = t.pieces.iter().map(|p| Value::text(p)).collect();
        let pieces = self.make_list(pieces)?;
        let mut holes = Vec::new();
        for h in &t.holes {
            let v = self.eval(h)?;
            let (name, field) = if matches!(v, Value::View(_)) { ("VIEW", "child") } else { ("TEXT", "value") };
            let v = if name == "TEXT" { Value::text(&self.show(&v)?) } else { v };
            holes.push(Value::Case(Rc::new(Case { ty: Rc::from("core/hole"), name: Rc::from(name), values: vec![(Rc::from(field), v)] })));
        }
        let holes = self.make_list(holes)?;
        Ok(Value::Record(Rc::new(Record { ty: Rc::from("core/template"), fields: vec![(Rc::from("pieces"), pieces), (Rc::from("holes"), holes)] })))
    }
}

fn short(ty: &str) -> &str {
    ty.rsplit('/').next().unwrap_or(ty)
}

/// Writes `value` at `path` inside `whole`, copying only what is shared.
fn write_path(whole: &mut Value, path: &[Step], value: Value) -> R<()> {
    let Some((first, rest)) = path.split_first() else {
        *whole = value;
        return Ok(());
    };
    match (first, whole) {
        (Step::Field(f), Value::Record(r)) => {
            let r = Rc::make_mut(r);
            let slot = r.get_mut(f).ok_or_else(|| Failure::ir(format!("no field `{}`", f)))?;
            write_path(slot, rest, value)
        }
        (Step::Index(i), Value::List(l)) => {
            let l = Rc::make_mut(l);
            let slot = l.items.get_mut(*i as usize).ok_or_else(|| Failure::new(FailKind::Position, "a position outside the list"))?;
            write_path(&mut slot.value, rest, value)
        }
        (Step::Item(id), Value::List(l)) | (Step::ItemOpt(id), Value::List(l)) => {
            let l = Rc::make_mut(l);
            let slot = l.items.iter_mut().find(|i| i.id == *id).ok_or_else(|| Failure::new(FailKind::Removed, "an item used after it was removed"))?;
            write_path(&mut slot.value, rest, value)
        }
        (Step::Inside, Value::Opt(Some(x))) => write_path(Rc::make_mut(x), rest, value),
        (Step::Inside, w @ Value::Opt(None)) => {
            *w = Value::none();
            Err(Failure::new(FailKind::Removed, "an opt that is empty"))
        }
        _ => Err(Failure::ir("a place that doesn't fit its value")),
    }
}
