//! A page running: the lowered IR mounted, redrawn after every change, with every change made
//! through a transaction that is checked and undone when it fails (page 6, plan tab 11). A port
//! of @extended-mark/runtime's `page.ts`, kept to its order of evaluation, its messages and its sites, so
//! the native and web targets observe the same page.
//!
//! No drawing: a page is drawn by whoever reads its tree (the egui and Android targets, the
//! headless check adapter). Each widget is identified by its path: the sites of the template
//! instances it belongs to, each loop row as `[position]`, then its own site. Its key is who it is
//! across redraws: a loop row's widgets follow its item, not its position.
//!
//! The tree holds every prop already worked out, so a target that draws every frame (egui) only
//! reads it: nothing is evaluated per frame, only once per change.

use std::cell::{RefCell, RefMut};
use std::collections::{BTreeMap, BTreeSet, HashMap, HashSet};
use std::rc::Rc;

use xtmd_eval::interp::{Outer, Place, PlaceRoot, Step, R};
use xtmd_eval::value::{Case, Closure, List, Record, ViewValue};
use xtmd_eval::{Binding, Constants, FailKind, Failure, Host, Machine, Num, Program, Row, Value};
use xtmd_ir::check::{Call, CallCall, Mounted, PageTheme, PageWidth};
use xtmd_ir::ir::{self, Expr, Node, Stmt};

pub use xtmd_ir::check::Broken;

/// The locals around a node: values, or references to places (a `mut for` row's item).
pub type Bindings = Vec<(Rc<str>, Binding)>;

/// A value fn the target supplies, by full name (`core/moment.local`): given the page's machine
/// and the arguments, its value, or `None` when it returns nothing.
pub type ValueFn = Rc<dyn Fn(&mut Machine<'_>, &[Value]) -> R<Option<Value>>>;

/// Whether the target draws an extern widget, by full name.
pub type Supplies = Rc<dyn Fn(&str) -> bool>;

/// What the app tells the page about where it is read.
#[derive(Clone, Copy, Debug, Default, PartialEq)]
pub struct PageValues {
    pub width: Option<PageWidth>,
    pub theme: Option<PageTheme>,
}

/// How a page is mounted: what the app and the target give it.
#[derive(Clone)]
pub struct PageOptions {
    pub page: PageValues,
    /// `$state`'s values, in the IR's form, over its starting ones.
    pub state: Vec<(String, Expr)>,
    /// Each channel's values, in the IR's form: `("doc/scores", [("unit", …)])`.
    pub externs: Vec<(String, Vec<(String, Expr)>)>,
    /// The value fns the target supplies, by full name.
    pub fns: HashMap<String, ValueFn>,
    /// Whether the target draws an extern widget. One it doesn't shows its Markdown instead
    /// (page 6), and is reported in [`Page::missing`]. Left out, every one is drawn.
    pub supplies: Option<Supplies>,
    /// For the test targets only: defects to switch on, each of which a check must catch.
    pub defects: Vec<String>,
    /// Reuse a widget's drawn subtree when nothing it read has changed (on by default). Off
    /// draws every widget anew on every change, for comparing the two.
    pub memo: bool,
}

impl Default for PageOptions {
    fn default() -> PageOptions {
        PageOptions { page: PageValues::default(), state: Vec::new(), externs: Vec::new(), fns: HashMap::new(), supplies: None, defects: Vec::new(), memo: true }
    }
}

/// Where a node's values are read: its widget instance, the locals around it, its path as
/// observed (loop rows by position) and its identity (loop rows by their item).
#[derive(Clone, Debug, Default)]
pub struct Env {
    pub owner: Option<u64>,
    pub bindings: Bindings,
    pub path: String,
    pub key: Option<String>,
}

impl Env {
    fn key_or_path(&self) -> &str {
        self.key.as_deref().unwrap_or(&self.path)
    }
}

/// An event a drawn widget's caller set: its handler, and where it runs.
#[derive(Clone, Debug)]
pub struct Handle {
    pub handler: String,
    pub env: Env,
}

/// A `mut` input given a variable: where the widget writes.
#[derive(Clone, Debug)]
pub struct WriteTo {
    pub place: ir::Place,
    pub env: Env,
}

/// A drawn extern widget, as the page asks a target to draw it: a shared node that never
/// changes once drawn. A redraw that reuses a widget's subtree (nothing it read changed) hands out
/// the very same nodes, so a target can skip one with [`Drawn::same`] as the one it drew last.
/// Its fields are read through `Deref`, as [`DrawnNode`]'s.
#[derive(Clone, Debug)]
pub struct Drawn(Rc<DrawnNode>);

impl Drawn {
    pub fn new(node: DrawnNode) -> Drawn {
        Drawn(Rc::new(node))
    }

    /// Whether two are the very same node: the page reused it, and nothing in it changed.
    pub fn same(a: &Drawn, b: &Drawn) -> bool {
        Rc::ptr_eq(&a.0, &b.0)
    }
}

impl std::ops::Deref for Drawn {
    type Target = DrawnNode;

    fn deref(&self) -> &DrawnNode {
        &self.0
    }
}

/// What a drawn widget holds. Its props are worked out: a target only reads them.
#[derive(Clone, Debug)]
pub struct DrawnNode {
    pub path: String,
    /// Who it is across redraws: a loop row's widgets follow its item, not its position.
    pub key: String,
    pub widget: String,
    pub props: BTreeMap<String, Value>,
    pub slots: BTreeMap<String, Vec<Drawn>>,
    /// Events the caller set, each to a handler.
    pub events: BTreeMap<String, Handle>,
    /// `mut` inputs given a variable.
    pub writes: BTreeMap<String, WriteTo>,
    pub levels: Vec<ir::Level>,
}

impl DrawnNode {
    pub fn prop(&self, name: &str) -> Option<&Value> {
        self.props.get(name)
    }

    /// Every widget in a slot, in order.
    pub fn children(&self) -> impl Iterator<Item = &Drawn> {
        self.slots.values().flatten()
    }
}

/// Refused writes and failures since they were last taken.
#[derive(Clone, Debug, Default, PartialEq)]
pub struct Outcome {
    pub refused: Vec<Broken>,
    pub failures: Vec<Broken>,
}

/// A shade drawn: the fn it was given, by name ("" for a lambda), and its arguments; with
/// samples, the colour at the area's two corners and its middle.
#[derive(Clone, Debug, PartialEq)]
pub struct Shaded {
    pub shader: String,
    pub args: Expr,
    pub samples: Option<Vec<(Expr, Expr)>>,
}

fn broken_code(code: &str, site: &str) -> Broken {
    Broken { code: Some(code.to_string()), rule: None, site: Some(site.to_string()) }
}

fn broken_rule(rule: &str) -> Broken {
    Broken { code: None, rule: Some(rule.to_string()), site: None }
}

pub(crate) fn join(path: &str, part: &str) -> String {
    if path.is_empty() {
        part.to_string()
    } else {
        format!("{}/{}", path, part)
    }
}

fn last_part(path: &str) -> &str {
    path.rsplit('/').next().unwrap_or(path)
}

fn parent(path: &str) -> &str {
    path.rsplit_once('/').map_or("", |(a, _)| a)
}

/// A failure's code, as the checks report it: `failure.rule`, `failure.limit`.
pub fn failure_code(f: &Failure) -> String {
    let kind = match f.kind {
        FailKind::Number(_) => "number",
        FailKind::Rule => "rule",
        FailKind::Position => "position",
        FailKind::Removed => "removed",
        FailKind::Limit(_) => "limit",
        FailKind::NotConstant => "notconstant",
        FailKind::Ir => "ir",
    };
    format!("failure.{}", kind)
}

fn outer_kind(o: &Outer) -> (&'static str, &str) {
    match o {
        Outer::Cell(n) => ("cell", n),
        Outer::Input(n) => ("input", n),
        Outer::State(n) => ("state", n),
        Outer::Let(n) => ("let", n),
        Outer::Extern(n) => ("extern", n),
        Outer::Slot(n) => ("slot", n),
    }
}

pub(crate) fn num_value(n: i64) -> Value {
    Value::Num(Num::int(n))
}

/// The widget's slot a VIEW part of its rich text is drawn in: what the part's `#inline` view
/// names. A target draws that slot where the part is.
pub fn inline_slot(child: Option<&Value>) -> Option<String> {
    match child {
        Some(Value::View(v)) if &*v.widget == "#inline" => match v.args.get("id") {
            Some(Value::Num(n)) => Some(format!("~{}", n.show())),
            _ => None,
        },
        _ => None,
    }
}

/// What a VIEW part holds once its view is drawn as the widget's slot `~id`.
fn inline_view(id: usize) -> Value {
    let mut args = BTreeMap::new();
    args.insert("id".to_string(), num_value(id as i64));
    Value::View(Rc::new(ViewValue { widget: Rc::from("#inline"), args, slots: BTreeMap::new(), events: BTreeMap::new(), exprs: BTreeMap::new(), captured: Vec::new(), owner: None }))
}

pub(crate) fn case_value(ty: &str, name: &str) -> Value {
    Value::Case(Rc::new(Case { ty: Rc::from(ty), name: Rc::from(name), values: Vec::new() }))
}

pub(crate) type Nodes = Rc<Vec<Node>>;
type Body = Rc<Vec<Stmt>>;

/// A rule: its body and its message.
type Rules = Rc<Vec<(Body, String)>>;

struct HandlerFn {
    params: Vec<ir::Param>,
    body: Body,
    /// The event it only passes on: `fn() { invoke click(); }`.
    passes: Option<String>,
}

/// What a page knows from its IR and its options, which never changes.
pub(crate) struct Shared {
    pub(crate) module: ir::Module,
    pub(crate) program: Program,
    pub(crate) templates: HashMap<String, Rc<ir::Template>>,
    template_rules: HashMap<String, Rules>,
    pub(crate) extern_widgets: HashMap<String, Rc<ir::ExternWidget>>,
    /// Each extern widget as a template, for the instance its Markdown is written in.
    extern_templates: HashMap<String, Rc<ir::Template>>,
    handlers: HashMap<String, HandlerFn>,
    bindings: HashMap<String, Expr>,
    app_fns: HashSet<String>,
    state_decl: Option<ir::State>,
    state_rules: Rules,
    lets: HashMap<String, Expr>,
    defects: HashSet<String>,
    target_fns: HashMap<String, ValueFn>,
    /// The nodes the page owns, so an instance holds a slot's content without a copy, and a
    /// memo knows its call again.
    stable: Stable,
}

impl Shared {
    /// Nodes an instance or a held slot keeps: the template's own when they are its, a copy when
    /// a value made them.
    fn nodes_rc(&self, nodes: &Vec<Node>) -> Nodes {
        match self.stable.lists.get(&addr(nodes)) {
            Some(n) => n.clone(),
            None => Rc::new(nodes.clone()),
        }
    }

    /// The extern call a node stands for, when the page owns it: a node made by a value has none,
    /// and is never the same call as another.
    fn call_id(&self, x: &ir::NodeExtern) -> Option<usize> {
        self.stable.externs.get(&addr(x)).copied()
    }

    /// Whether two slots hold the same content: the same shared copy, or nodes that are equal.
    fn same_slot(&self, held: &Nodes, now: &Vec<Node>) -> bool {
        match self.stable.lists.get(&addr(now)) {
            Some(rc) if Rc::ptr_eq(rc, held) => true,
            _ => **held == *now,
        }
    }

    pub(crate) fn defect(&self, name: &str) -> bool {
        self.defects.contains(name)
    }
}

fn addr<T>(x: &T) -> usize {
    x as *const T as usize
}

/// The nodes a page owns for as long as it runs: its templates' views and Markdown, its extern
/// widgets' Markdown, and one shared copy of each slot's content, which instances and held slots
/// draw from. Every copy of a slot's content maps to that one copy, and every copy of an extern
/// call to the call it copies, so "the same slot" and "the same call" are decided as the web
/// decides them, by identity, where nothing is ever copied.
#[derive(Default)]
struct Stable {
    lists: HashMap<usize, Nodes>,
    /// Each extern call the page owns, by where it is, to the original it stands for.
    externs: HashMap<usize, usize>,
}

impl Stable {
    /// A slot's content as the one shared copy every instance holds.
    fn share(&mut self, s: &Vec<Node>) -> Nodes {
        if let Some(rc) = self.lists.get(&addr(s)) {
            return rc.clone();
        }
        let rc = Rc::new(s.clone());
        self.lists.insert(addr(s), rc.clone());
        self.link(s, &rc);
        rc
    }

    /// Registers the extern calls and slot contents of `orig`, an original, and of `copy`, a
    /// copy of it (or `orig` itself): each copy's to its original's.
    fn link(&mut self, orig: &[Node], copy: &[Node]) {
        for (o, c) in orig.iter().zip(copy) {
            match (o, c) {
                (Node::Extern(xo), Node::Extern(xc)) => {
                    self.externs.insert(addr(xo), addr(xo));
                    self.externs.insert(addr(xc), addr(xo));
                    self.slots(&xo.slots, &xc.slots);
                }
                (Node::Use(uo), Node::Use(uc)) => self.slots(&uo.slots, &uc.slots),
                (Node::For(fo), Node::For(fc)) => self.link(&fo.body, &fc.body),
                (Node::If(io), Node::If(ic)) => {
                    for (bo, bc) in io.branches.iter().zip(&ic.branches) {
                        self.link(&bo.then, &bc.then);
                    }
                    self.link(&io.else_, &ic.else_);
                }
                (Node::Match(mo), Node::Match(mc)) => {
                    for (co, cc) in mo.cases.iter().zip(&mc.cases) {
                        self.link(&co.then, &cc.then);
                    }
                    self.link(&mo.else_, &mc.else_);
                }
                _ => {}
            }
        }
    }

    fn slots(&mut self, orig: &BTreeMap<String, Vec<Node>>, copy: &BTreeMap<String, Vec<Node>>) {
        for ((_, so), (_, sc)) in orig.iter().zip(copy) {
            let rc = self.share(so);
            if !std::ptr::eq(so, sc) {
                self.lists.insert(addr(sc), rc);
                self.link(so, sc);
            }
        }
    }
}

/// What a widget's drawing read and made, so a redraw can reuse it while none of it changed.
#[derive(Debug, Default)]
struct Frame {
    /// Each outside value read, by key (`s:field`, `x:channel.value`, `c:id:cell`, `o:key`),
    /// with its version then.
    deps: HashMap<String, u64>,
    /// The instances drawn inside it, with their paths: seen again when it is reused.
    nested: Vec<(u64, String)>,
    own: Vec<String>,
    missed: Vec<String>,
    /// The extern calls drawn inside it, whose memos a reuse keeps.
    ext: Vec<String>,
    /// It failed, or asked the app for a value: drawn anew every time.
    dirty: bool,
}

/// A widget written in Extended Mark as it was last drawn, with what its drawing read.
struct Memo {
    frame: Frame,
    template: String,
    path: String,
    owner: Option<u64>,
    args: Vec<Value>,
    bindings: Bindings,
    slots: Vec<(String, Nodes)>,
    events: BTreeMap<String, String>,
    epoch: u64,
    drawn: Vec<Drawn>,
}

/// An extern call as it was last drawn, with what its drawing read.
struct ExternMemo {
    frame: Frame,
    /// The call it was: [`Shared::call_id`].
    node: usize,
    path: String,
    owner: Option<u64>,
    bindings: Bindings,
    epoch: u64,
    drawn: Vec<Drawn>,
}

/// Whether two values are the very same one, as `===` says on the web: shared, not equal.
fn same_ptr(a: &Value, b: &Value) -> bool {
    match (a, b) {
        (Value::Text(x), Value::Text(y)) => Rc::ptr_eq(x, y),
        (Value::List(x), Value::List(y)) => Rc::ptr_eq(x, y),
        (Value::Record(x), Value::Record(y)) => Rc::ptr_eq(x, y),
        (Value::Case(x), Value::Case(y)) => Rc::ptr_eq(x, y),
        (Value::Range(x), Value::Range(y)) => Rc::ptr_eq(x, y),
        (Value::Fn(x), Value::Fn(y)) => Rc::ptr_eq(x, y),
        (Value::View(x), Value::View(y)) => Rc::ptr_eq(x, y),
        (Value::Opt(Some(x)), Value::Opt(Some(y))) => Rc::ptr_eq(x, y),
        _ => false,
    }
}

/// Whether two references are to the same place.
fn same_place(a: &Place, b: &Place) -> bool {
    let root = match (&a.root, &b.root) {
        (PlaceRoot::Local { frame: f, name: n }, PlaceRoot::Local { frame: g, name: o }) => f == g && n == o,
        (PlaceRoot::Outer(x, p), PlaceRoot::Outer(y, q)) => x == y && p == q,
        _ => false,
    };
    root && a.path.len() == b.path.len()
        && a.path.iter().zip(&b.path).all(|(s, t)| match (s, t) {
            (Step::Field(x), Step::Field(y)) => x == y,
            (Step::Index(x), Step::Index(y)) => x == y,
            (Step::Item(x), Step::Item(y)) | (Step::ItemOpt(x), Step::ItemOpt(y)) => x == y,
            (Step::Inside, Step::Inside) => true,
            _ => false,
        })
}

/// A widget instance: one call of a widget written in Extended Mark, kept by its key across redraws.
struct Instance {
    id: u64,
    path: String,
    template: Rc<ir::Template>,
    inputs: HashMap<String, Value>,
    /// `mut` inputs: the caller's place, read and written live.
    places: HashMap<String, WriteTo>,
    cells: HashMap<String, Value>,
    slots: HashMap<String, (Nodes, Env)>,
    events: HashMap<String, Handle>,
    seen: bool,
}

/// What changes while a page runs.
#[derive(Default)]
pub(crate) struct World {
    instances: HashMap<u64, Instance>,
    /// Instances by identity: rows follow their items, so a row's widget keeps its variables.
    by_path: HashMap<String, u64>,
    /// The same instances by the path they were last drawn at.
    at_path: HashMap<String, u64>,
    /// Extern widgets' own `mut` values, for inputs the caller gave no variable, by identity.
    own: HashMap<String, BTreeMap<String, Value>>,
    own_seen: HashSet<String>,
    /// Slots read as values, by the id their view holds.
    held: Vec<(Nodes, Env)>,
    /// `$state`, in the order its values were given.
    state: Vec<(String, Value)>,
    externs: HashMap<String, Value>,
    calls: Vec<Call>,
    outcome: Outcome,
    /// Extern widgets drawn as their Markdown because the target doesn't supply them.
    missed: BTreeSet<String>,
    supplies: Option<Supplies>,
    errors: Vec<Failure>,
    /// Warnings for the app, since it last took them: not failures, the page carries on.
    warnings: Vec<Broken>,
    /// The spots outside their plane's bounds now, so each is reported once as it moves out.
    outside: HashSet<String>,
    /// The machine's step count and its last identity, kept between the machines a page makes.
    steps: u64,
    next_id: u64,
    /// Each outside value's version, bumped when it is written, and the epoch, bumped when every
    /// memo must go (an undo, what the target supplies).
    versions: HashMap<String, u64>,
    epoch: u64,
    memo: HashMap<String, Rc<Memo>>,
    extern_memo: HashMap<String, Rc<ExternMemo>>,
    /// The extern calls drawn this redraw: the memos of the rest are dropped after it.
    extern_seen: HashSet<String>,
    /// What each widget being drawn has read and made so far, outermost first.
    frames: Vec<Frame>,
    memo_on: bool,
}

impl World {
    fn state_get(&self, name: &str) -> Option<Value> {
        self.state.iter().find(|(k, _)| k == name).map(|(_, v)| v.clone())
    }

    /// A read of an outside value, for every widget being drawn.
    fn track(&mut self, key: impl FnOnce() -> String) {
        if self.frames.is_empty() {
            return;
        }
        let k = key();
        let v = self.versions.get(&k).copied().unwrap_or(0);
        for f in self.frames.iter_mut() {
            if !f.deps.contains_key(&k) {
                f.deps.insert(k.clone(), v);
            }
        }
    }

    /// An outside value written: every memo that read it is out of date.
    fn bump(&mut self, key: String) {
        *self.versions.entry(key).or_insert(0) += 1;
    }

    /// Whether every value a memo read is as it was.
    fn current(&self, deps: &HashMap<String, u64>) -> bool {
        deps.iter().all(|(k, v)| self.versions.get(k).copied().unwrap_or(0) == *v)
    }

    fn state_set(&mut self, name: &str, v: Value) {
        match self.state.iter_mut().find(|(k, _)| k == name) {
            Some(slot) => slot.1 = v,
            None => self.state.push((name.to_string(), v)),
        }
    }
}

/// The page's two halves, shared with the host its machines call back.
#[derive(Clone)]
pub(crate) struct Rt {
    pub(crate) s: Rc<Shared>,
    w: Rc<RefCell<World>>,
}

struct PageHost(Rt);

impl Host for PageHost {
    fn read(&self, m: &mut Machine, what: &Outer, owner: Option<u64>) -> R<Value> {
        self.0.host_read(m, what, owner)
    }

    fn write(&self, m: &mut Machine, what: &Outer, owner: Option<u64>, value: Value) -> R<()> {
        self.0.host_write(m, what, owner, value)
    }

    fn call_extern(&self, m: &mut Machine, name: &str, args: &[Value]) -> R<Option<Option<Value>>> {
        let rt = &self.0;
        if let Some(f) = rt.s.target_fns.get(name).cloned() {
            return f(m, args).map(Some);
        }
        if !rt.s.app_fns.contains(name) {
            return Ok(None);
        }
        // a widget that asks the app is drawn anew every time
        for f in rt.w().frames.iter_mut() {
            f.dirty = true;
        }
        if !rt.s.defect("lost-calls") {
            rt.w().calls.push(Call { call: CallCall { name: name.to_string(), args: args.iter().map(Value::to_ir).collect() } });
        }
        Ok(Some(None))
    }

    fn invoke(&self, m: &mut Machine, event: &str, args: Vec<Value>, owner: Option<u64>) -> R<()> {
        let ev = owner.and_then(|o| self.0.w.borrow().instances.get(&o).and_then(|i| i.events.get(event).cloned()));
        match ev {
            Some(ev) => self.0.run_handler(m, &ev.handler, &ev.env, args).map(|_| ()),
            None => Ok(()),
        }
    }
}

impl Rt {
    fn w(&self) -> RefMut<'_, World> {
        self.w.borrow_mut()
    }

    pub(crate) fn defect(&self, name: &str) -> bool {
        self.s.defect(name)
    }

    // ---- the host: what lives outside a fn

    fn host_read(&self, m: &mut Machine, what: &Outer, owner: Option<u64>) -> R<Value> {
        match what {
            Outer::State(n) => {
                let mut w = self.w();
                w.track(|| format!("s:{}", n));
                w.state_get(n).ok_or_else(|| Failure::ir(format!("$state has no field {}", n)))
            }
            Outer::Extern(n) => {
                let mut w = self.w();
                w.track(|| format!("x:{}", n));
                w.externs.get(&**n).cloned().ok_or_else(|| Failure::new(FailKind::NotConstant, format!("{} is given by the app", n)))
            }
            Outer::Let(n) => {
                if let Some(v) = m.prog.lets.get(&**n) {
                    return Ok(v.clone());
                }
                match self.s.lets.get(&**n) {
                    Some(e) => m.eval(e),
                    None => Err(Failure::ir(format!("no let {}", n))),
                }
            }
            Outer::Input(n) => {
                let found = {
                    let w = self.w.borrow();
                    match owner.and_then(|o| w.instances.get(&o)) {
                        None => return Err(Failure::ir(format!("no input {} here", n))),
                        Some(i) => (i.places.get(&**n).cloned(), i.inputs.get(&**n).cloned()),
                    }
                };
                match found {
                    (Some(p), _) => m.eval_with(&p.env.bindings, p.env.owner, &Expr::Place(p.place)),
                    (None, Some(v)) => {
                        // a slot's content reads its caller's inputs inside the widget it is placed
                        // in, whose own inputs may not change: the read is what makes that widget
                        // be drawn again
                        if let Some(o) = owner {
                            self.w().track(|| format!("i:{}:{}", o, n));
                        }
                        Ok(v)
                    }
                    (None, None) => Err(Failure::ir(format!("no input {}", n))),
                }
            }
            Outer::Cell(n) => {
                let mut w = self.w();
                if let Some(o) = owner {
                    w.track(|| format!("c:{}:{}", o, n));
                }
                owner.and_then(|o| w.instances.get(&o)).and_then(|i| i.cells.get(&**n)).cloned().ok_or_else(|| Failure::ir(format!("no variable {}", n)))
            }
            Outer::Slot(n) => {
                let found = {
                    let w = self.w.borrow();
                    owner.and_then(|o| w.instances.get(&o)).and_then(|i| i.slots.get(&**n).map(|s| (i.template.clone(), s.clone())))
                };
                match found {
                    None => Ok(Value::none()),
                    Some((t, (nodes, env))) => self.slot_value(m, &t, n, nodes, env),
                }
            }
        }
    }

    fn host_write(&self, m: &mut Machine, what: &Outer, owner: Option<u64>, value: Value) -> R<()> {
        match what {
            Outer::State(n) => {
                let ty = self.s.state_decl.as_ref().and_then(|s| s.fields.iter().find(|f| *f.name == **n)).map(|f| f.ty.clone());
                if let Some(ty) = ty {
                    if !self.defect("unchecked-writes") && !m.fits(&value, &ty)? {
                        return Err(Failure::new(FailKind::Rule, format!("$state.{} is outside its contract", n)));
                    }
                }
                let mut w = self.w();
                w.state_set(n, value);
                w.bump(format!("s:{}", n));
                Ok(())
            }
            Outer::Cell(n) => {
                let ty = {
                    let w = self.w.borrow();
                    let Some(inst) = owner.and_then(|o| w.instances.get(&o)) else {
                        return Err(Failure::ir(format!("no variable {} here", n)));
                    };
                    inst.template.cells.iter().find(|c| *c.name == **n).map(|c| c.ty.clone())
                };
                if let Some(ty) = ty {
                    if !self.defect("unchecked-writes") && !m.fits(&value, &ty)? {
                        return Err(Failure::new(FailKind::Rule, format!("{} is outside its contract", n)));
                    }
                }
                if let Some(o) = owner {
                    let mut w = self.w();
                    if let Some(inst) = w.instances.get_mut(&o) {
                        inst.cells.insert(n.to_string(), value);
                        w.bump(format!("c:{}:{}", o, n));
                    }
                }
                Ok(())
            }
            Outer::Input(n) => {
                let p = owner.and_then(|o| self.w.borrow().instances.get(&o).and_then(|i| i.places.get(&**n).cloned()));
                match p {
                    Some(p) => m.set_place(&p.env.bindings, p.env.owner, &p.place, value),
                    None => Err(Failure::ir(format!("{} is not a mut input given a variable", n))),
                }
            }
            other => {
                let (kind, name) = outer_kind(other);
                Err(Failure::ir(format!("{} {} can't be written", kind, name)))
            }
        }
    }

    /// A slot read as a value: a list slot gives its calls as views; any other, one view.
    fn slot_value(&self, m: &mut Machine, t: &ir::Template, name: &str, nodes: Nodes, env: Env) -> R<Value> {
        let decl = t.slots.iter().find(|s| s.name == name);
        if decl.map_or(false, |d| d.ty.name == "core/list") {
            let views = self.expand_views(m, &nodes, &env)?;
            return m.make_list(views);
        }
        let id = {
            let mut w = self.w();
            w.held.push((nodes, env));
            w.held.len() - 1
        };
        let mut args = BTreeMap::new();
        args.insert("id".to_string(), num_value(id as i64));
        Ok(Value::View(Rc::new(ViewValue { widget: Rc::from("#slot"), args, slots: BTreeMap::new(), events: BTreeMap::new(), exprs: BTreeMap::new(), captured: Vec::new(), owner: None })))
    }

    /// A slot's calls as views, through its loops and branches.
    fn expand_views(&self, m: &mut Machine, nodes: &[Node], env: &Env) -> R<Vec<Value>> {
        let mut out = Vec::new();
        for n in nodes {
            match n {
                Node::Extern(_) | Node::Use(_) => {
                    let (name, given, slots, events) = match n {
                        Node::Extern(x) => (&x.name, &x.props, &x.slots, &x.events),
                        Node::Use(u) => (&u.name, &u.args, &u.slots, &u.events),
                        _ => unreachable!(),
                    };
                    let mut args = BTreeMap::new();
                    for (k, e) in given {
                        args.insert(k.clone(), self.eval_in(m, env, e)?);
                    }
                    out.push(Value::View(Rc::new(ViewValue {
                        widget: Rc::from(name.as_str()),
                        args,
                        slots: slots.clone(),
                        events: events.clone(),
                        exprs: given.clone(),
                        captured: env.bindings.clone(),
                        owner: env.owner,
                    })));
                }
                Node::For(f) => {
                    for row in self.loop_rows(m, f, env)? {
                        let mut inner = env.clone();
                        inner.bindings.extend(row.bindings);
                        out.extend(self.expand_views(m, &f.body, &inner)?);
                    }
                }
                Node::If(i) => {
                    let (nodes, env) = self.pick_branch(m, i, env)?;
                    out.extend(self.expand_views(m, nodes, &env)?);
                }
                _ => {}
            }
        }
        Ok(out)
    }

    pub(crate) fn eval_in(&self, m: &mut Machine, env: &Env, e: &Expr) -> R<Value> {
        let x = match e {
            Expr::Bind(id) => self.s.bindings.get(id).ok_or_else(|| Failure::ir("a binding the page doesn't have"))?,
            other => other,
        };
        m.eval_with(&env.bindings, env.owner, x)
    }

    fn write_place(&self, m: &mut Machine, w: &WriteTo, value: Value) -> R<()> {
        m.set_place(&w.env.bindings, w.env.owner, &w.place, value)
    }

    pub(crate) fn loop_rows(&self, m: &mut Machine, f: &ir::NodeFor, env: &Env) -> R<Vec<Row>> {
        m.loop_rows(&env.bindings, env.owner, &f.over, &f.name, f.position.as_deref(), f.mutable)
    }

    /// The same rows with their keys: a list row's is its item's identity.
    pub(crate) fn keyed_rows(&self, m: &mut Machine, f: &ir::NodeFor, env: &Env) -> R<Vec<Row>> {
        let mut rows = self.loop_rows(m, f, env)?;
        if self.defect("rows-by-position") {
            for (k, r) in rows.iter_mut().enumerate() {
                r.key = k.to_string();
            }
        }
        Ok(rows)
    }

    /// Whether the variable a place writes now breaks its own contract.
    fn contract_broken(&self, m: &mut Machine, w: &WriteTo) -> R<bool> {
        if !w.place.path.is_empty() {
            return Ok(false);
        }
        let found = match &w.place.root {
            ir::Root::State(n) => {
                let ty = self.s.state_decl.as_ref().and_then(|s| s.fields.iter().find(|f| f.name == *n)).map(|f| f.ty.clone());
                ty.zip(self.w.borrow().state_get(n))
            }
            ir::Root::Cell(n) => {
                let world = self.w.borrow();
                let inst = w.env.owner.and_then(|o| world.instances.get(&o));
                let ty = inst.and_then(|i| i.template.cells.iter().find(|c| c.name == *n)).map(|c| c.ty.clone());
                ty.zip(inst.and_then(|i| i.cells.get(n).cloned()))
            }
            _ => None,
        };
        match found {
            Some((ty, v)) => Ok(!m.fits(&v, &ty)?),
            None => Ok(false),
        }
    }

    /// The message of the first of `$state`'s rules that no longer holds.
    fn state_rule_broken(&self, m: &mut Machine) -> R<Option<String>> {
        for (body, message) in self.s.state_rules.iter() {
            let ok = self.run_body(m, &[], body.clone(), &Env::default(), Vec::new())?;
            if let Some(Value::Bool(false)) = ok {
                return Ok(Some(message.clone()));
            }
        }
        Ok(None)
    }

    fn run_handler(&self, m: &mut Machine, id: &str, env: &Env, args: Vec<Value>) -> R<Option<Value>> {
        let h = self.s.handlers.get(id).ok_or_else(|| Failure::ir(format!("no handler {}", id)))?;
        self.run_body(m, &h.params, h.body.clone(), env, args)
    }

    fn run_body(&self, m: &mut Machine, params: &[ir::Param], body: Body, env: &Env, args: Vec<Value>) -> R<Option<Value>> {
        let f = Value::Fn(Rc::new(Closure { params: params.to_vec(), body, captured: env.bindings.clone(), owner: env.owner }));
        m.apply(&f, args.into_iter().map(Binding::Value).collect())
    }

    // ---- drawing

    pub(crate) fn pick_branch<'n>(&self, m: &mut Machine, n: &'n ir::NodeIf, env: &Env) -> R<(&'n Vec<Node>, Env)> {
        for b in &n.branches {
            match &b.when {
                ir::Cond::Cond(c) => {
                    if let Value::Bool(true) = self.eval_in(m, env, c)? {
                        return Ok((&b.then, env.clone()));
                    }
                }
                ir::Cond::Open(o) => {
                    if let Some(opened) = m.open_cond(&env.bindings, env.owner, o)? {
                        let mut inner = env.clone();
                        inner.bindings.push((Rc::from(o.name.as_str()), opened));
                        return Ok((&b.then, inner));
                    }
                }
            }
        }
        Ok((&n.else_, env.clone()))
    }

    pub(crate) fn draw_nodes(&self, m: &mut Machine, nodes: &[Node], env0: &Env) -> R<Vec<Drawn>> {
        let mut env = env0.clone();
        let mut out = Vec::new();
        for n in nodes {
            match n {
                Node::Declare(d) => {
                    let v = self.eval_in(m, &env, &d.let_.value)?;
                    env.bindings.push((Rc::from(d.let_.name.as_str()), Binding::Value(v)));
                }
                Node::For(f) => {
                    let rows = self.loop_rows(m, f, &env)?;
                    for (k, row) in rows.into_iter().enumerate() {
                        let key = if self.defect("rows-by-position") { k.to_string() } else { row.key };
                        let mut bindings = env.bindings.clone();
                        bindings.extend(row.bindings);
                        let inner = Env { owner: env.owner, bindings, path: join(&env.path, &format!("{}[{}]", f.site, k)), key: Some(join(env.key_or_path(), &format!("{}[{}]", f.site, key))) };
                        out.extend(self.draw_nodes(m, &f.body, &inner)?);
                    }
                }
                Node::If(i) => {
                    let (nodes, inner) = self.pick_branch(m, i, &env)?;
                    out.extend(self.draw_nodes(m, nodes, &inner)?);
                }
                Node::Match(mt) => {
                    let v = self.eval_in(m, &env, &mt.value)?;
                    let mut done = false;
                    for c in &mt.cases {
                        if let Some(binds) = self.matches(m, &v, &c.when)? {
                            let mut inner = env.clone();
                            inner.bindings.extend(binds);
                            out.extend(self.draw_nodes(m, &c.then, &inner)?);
                            done = true;
                            break;
                        }
                    }
                    if !done {
                        out.extend(self.draw_nodes(m, &mt.else_, &env)?);
                    }
                }
                Node::Place(p) => {
                    let v = self.eval_in(m, &env, &p.view)?;
                    out.extend(self.draw_view(m, &v, &join(&env.path, &p.site), &env)?);
                }
                Node::Extern(x) => out.extend(self.draw_extern(m, self.s.call_id(x), &x.name, &x.site, &x.props, &x.slots, &x.events, &x.writes, &x.levels, &env)?),
                Node::Use(u) => {
                    let path = join(&env.path, &u.site);
                    let key = join(env.key_or_path(), &u.site);
                    out.extend(self.draw_use(m, &u.name, &path, &u.args, &u.slots, &u.events, &env, &u.levels, &key)?);
                }
            }
        }
        Ok(out)
    }

    /// A match's case against a value: the locals it binds, or `None` when it doesn't match.
    pub(crate) fn matches(&self, m: &mut Machine, v: &Value, patterns: &[ir::Pattern]) -> R<Option<Bindings>> {
        for p in patterns {
            match p {
                ir::Pattern::Case(pc) => match v {
                    Value::Case(c) if *c.name == *pc.name => {
                        let binds = pc.binds.iter().enumerate().map(|(k, b)| (Rc::from(b.as_str()), Binding::Value(c.values.get(k).map_or_else(Value::none, |x| x.1.clone())))).collect();
                        return Ok(Some(binds));
                    }
                    Value::Opt(Some(x)) if pc.name == "SOME" => return Ok(Some(pc.binds.iter().take(1).map(|b| (Rc::from(b.as_str()), Binding::Value((**x).clone()))).collect())),
                    Value::Opt(None) if pc.name == "NONE" => return Ok(Some(Vec::new())),
                    _ => {}
                },
                ir::Pattern::Num(n) => {
                    if let Value::Num(_) = v {
                        let x = Num::parse(n).ok_or_else(|| Failure::ir(format!("`{}` is not a number", n)))?;
                        if m.equal(v, &Value::Num(x))? {
                            return Ok(Some(Vec::new()));
                        }
                    }
                }
                ir::Pattern::Text(t) => {
                    if matches!(v, Value::Text(x) if **x == **t) {
                        return Ok(Some(Vec::new()));
                    }
                }
                ir::Pattern::Bool(b) => {
                    if matches!(v, Value::Bool(x) if x == b) {
                        return Ok(Some(Vec::new()));
                    }
                }
            }
        }
        Ok(None)
    }

    fn supplies(&self, widget: &str) -> bool {
        let s = self.w.borrow().supplies.clone();
        s.map_or(true, |f| f(widget))
    }

    /// An extern widget's call: reused from the last redraw when it is the same call at the same
    /// place, with the same locals around it, and nothing it read has changed.
    #[allow(clippy::too_many_arguments)]
    fn draw_extern(
        &self,
        m: &mut Machine,
        node: Option<usize>,
        name: &str,
        site: &str,
        given: &BTreeMap<String, Expr>,
        slots: &BTreeMap<String, Vec<Node>>,
        events: &BTreeMap<String, String>,
        writes: &BTreeMap<String, ir::Place>,
        levels: &[ir::Level],
        env: &Env,
    ) -> R<Vec<Drawn>> {
        let key = join(env.key_or_path(), site);
        let path = join(&env.path, site);
        let memo_on = self.w.borrow().memo_on;
        if let (true, Some(id)) = (memo_on, node) {
            let hit = {
                let w = self.w.borrow();
                w.extern_memo.get(&key).filter(|x| x.node == id && x.epoch == w.epoch && x.path == path && x.owner == env.owner && w.current(&x.frame.deps)).cloned()
            };
            if let Some(x) = hit {
                if self.same_bindings(m, &x.bindings, &env.bindings) {
                    self.replay(&x.frame);
                    self.saw_extern(&key);
                    return Ok(x.drawn.clone());
                }
            }
        }
        self.w().frames.push(Frame::default());
        let drawn = self.draw_extern_now(m, name, site, given, slots, events, writes, levels, env);
        let frame = self.w().frames.pop().unwrap_or_default();
        let drawn = drawn?;
        {
            let mut w = self.w();
            match node {
                Some(id) if w.memo_on && !frame.dirty => {
                    let epoch = w.epoch;
                    w.extern_memo.insert(key.clone(), Rc::new(ExternMemo { frame, node: id, path, owner: env.owner, bindings: env.bindings.clone(), epoch, drawn: drawn.clone() }));
                }
                _ => {
                    w.extern_memo.remove(&key);
                }
            }
        }
        self.saw_extern(&key);
        Ok(drawn)
    }

    /// An extern call drawn this redraw, and inside every widget being drawn around it.
    fn saw_extern(&self, key: &str) {
        let mut w = self.w();
        w.extern_seen.insert(key.to_string());
        for f in w.frames.iter_mut() {
            f.ext.push(key.to_string());
        }
    }

    /// What a reused subtree did when it was drawn: its instances are seen again, and every
    /// widget being drawn around it is told what it read.
    fn replay(&self, f: &Frame) {
        let mut guard = self.w();
        let w = &mut *guard;
        for (id, p) in &f.nested {
            if let Some(i) = w.instances.get_mut(id) {
                i.seen = true;
            }
            w.at_path.insert(p.clone(), *id);
        }
        w.own_seen.extend(f.own.iter().cloned());
        w.missed.extend(f.missed.iter().cloned());
        w.extern_seen.extend(f.ext.iter().cloned());
        for fr in w.frames.iter_mut() {
            for (k, v) in &f.deps {
                if !fr.deps.contains_key(k) {
                    fr.deps.insert(k.clone(), *v);
                }
            }
            fr.nested.extend(f.nested.iter().cloned());
            fr.own.extend(f.own.iter().cloned());
            fr.missed.extend(f.missed.iter().cloned());
            fr.ext.extend(f.ext.iter().cloned());
        }
    }

    /// Whether the locals around a call are the ones it was drawn with.
    fn same_bindings(&self, m: &mut Machine, a: &Bindings, b: &Bindings) -> bool {
        a.len() == b.len()
            && a.iter().zip(b).all(|((n, x), (o, y))| {
                n == o
                    && match (x, y) {
                        (Binding::Value(p), Binding::Value(q)) => same_ptr(p, q) || m.equal(p, q).unwrap_or(false),
                        (Binding::Ref(p), Binding::Ref(q)) => same_place(p, q),
                        _ => false,
                    }
            })
    }

    /// A call's arguments as values, in their names' order.
    fn arg_values(&self, m: &mut Machine, args: &BTreeMap<String, Expr>, env: &Env) -> R<Vec<Value>> {
        args.values().map(|e| if let Expr::Place(_) = e { m.eval_with(&env.bindings, env.owner, e) } else { self.eval_in(m, env, e) }).collect()
    }

    /// The widget's subtree from the last redraw, when it is called the same way at the same
    /// place and nothing it read has changed since: its instances, own values and missing widgets
    /// are seen again, and every widget around it is told what it read. A failure working out
    /// whether it is the same is a no: the widget is drawn, and fails there, as without reuse.
    #[allow(clippy::too_many_arguments)]
    fn reuse(&self, m: &mut Machine, name: &str, path: &str, key: &str, args: &BTreeMap<String, Expr>, slots: &BTreeMap<String, Vec<Node>>, events: &BTreeMap<String, String>, env: &Env) -> Option<Vec<Drawn>> {
        let memo = {
            let w = self.w.borrow();
            if !w.memo_on {
                return None;
            }
            let x = w.memo.get(key)?;
            if x.epoch != w.epoch || x.template != name || x.path != path || x.owner != env.owner {
                return None;
            }
            x.clone()
        };
        if memo.slots.len() != slots.len() || !memo.slots.iter().zip(slots).all(|((k, held), (n, now))| k == n && self.s.same_slot(held, now)) || memo.events != *events {
            return None;
        }
        if !self.w.borrow().current(&memo.frame.deps) || !self.same_bindings(m, &memo.bindings, &env.bindings) {
            return None;
        }
        let now = self.arg_values(m, args, env).ok()?;
        if now.len() != memo.args.len() {
            return None;
        }
        for (v, was) in now.iter().zip(&memo.args) {
            if !m.equal(v, was).unwrap_or(false) {
                return None;
            }
        }
        self.replay(&memo.frame);
        Some(memo.drawn.clone())
    }

    #[allow(clippy::too_many_arguments)]
    fn draw_extern_now(
        &self,
        m: &mut Machine,
        name: &str,
        site: &str,
        given: &BTreeMap<String, Expr>,
        slots: &BTreeMap<String, Vec<Node>>,
        events: &BTreeMap<String, String>,
        writes: &BTreeMap<String, ir::Place>,
        levels: &[ir::Level],
        env: &Env,
    ) -> R<Vec<Drawn>> {
        let path = join(&env.path, site);
        let key = join(env.key_or_path(), site);
        let mut props = BTreeMap::new();
        for (k, e) in given {
            props.insert(k.clone(), self.eval_in(m, env, e)?);
        }
        let mut written = BTreeMap::new();
        for (k, p) in writes {
            props.insert(k.clone(), m.eval_with(&env.bindings, env.owner, &Expr::Place(p.clone()))?);
            written.insert(k.clone(), WriteTo { place: p.clone(), env: env.clone() });
        }
        let w = self.s.extern_widgets.get(name).cloned();
        for f in w.iter().flat_map(|w| w.inputs.iter()) {
            if !props.contains_key(&f.name) {
                if let Some(d) = &f.default {
                    let v = self.eval_in(m, env, d)?;
                    props.insert(f.name.clone(), v);
                }
            }
        }
        // a widget the target doesn't draw shows its Markdown instead (page 6), drawn with the
        // blocks the target does: its markdown block, in an instance holding its inputs
        if let Some(w) = &w {
            if !self.supplies(name) {
                {
                    let mut w = self.w();
                    w.missed.insert(name.to_string());
                    for f in w.frames.iter_mut() {
                        f.missed.push(name.to_string());
                    }
                }
                let inst = self.enter_extern(m, w, &path, &props, slots, env)?;
                let out = self.draw_nodes(m, &w.markdown, &Env { path: path.clone(), key: Some(key.clone()), ..inst.clone() });
                self.leave(&inst);
                return out;
            }
        }
        // what it wrote to its own `mut` inputs stands until the caller gives them a variable
        {
            let mut world = self.w();
            world.track(|| format!("o:{}", key));
            if let Some(own) = world.own.get(&key).cloned() {
                world.own_seen.insert(key.clone());
                for f in world.frames.iter_mut() {
                    f.own.push(key.clone());
                }
                for (k, v) in own {
                    if !written.contains_key(&k) {
                        props.insert(k, v);
                    }
                }
            }
        }
        let mut drawn_slots = BTreeMap::new();
        for (s, nodes) in slots {
            drawn_slots.insert(s.clone(), self.draw_nodes(m, nodes, env)?);
        }
        self.inline_views(m, &mut props, &mut drawn_slots, &path, &key)?;
        let events = events.iter().map(|(e, h)| (e.clone(), Handle { handler: h.clone(), env: env.clone() })).collect();
        Ok(vec![Drawn::new(DrawnNode { path, key, widget: name.to_string(), props, slots: drawn_slots, events, writes: written, levels: levels.to_vec() })])
    }

    /// A sentence's views, in the tree: each VIEW part of a rich_text in a widget's props is
    /// drawn as its slot `~n`, numbered in the props' order, and holds an `#inline` view with the
    /// number instead, so a target draws the slot where the part is. Its widgets are the page's
    /// like any slot's, their events and writes found by path.
    fn inline_views(&self, m: &mut Machine, props: &mut BTreeMap<String, Value>, slots: &mut BTreeMap<String, Vec<Drawn>>, path: &str, key: &str) -> R<()> {
        let mut n = 0;
        for v in props.values_mut() {
            if let Some(w) = self.inline_in(m, v, slots, path, key, &mut n)? {
                *v = w;
            }
        }
        Ok(())
    }

    /// `v` with its sentences' views drawn, or None when it holds none.
    fn inline_in(&self, m: &mut Machine, v: &Value, slots: &mut BTreeMap<String, Vec<Drawn>>, path: &str, key: &str, n: &mut usize) -> R<Option<Value>> {
        Ok(match v {
            Value::List(l) => {
                let mut items = None;
                for (k, i) in l.items.iter().enumerate() {
                    if let Some(w) = self.inline_in(m, &i.value, slots, path, key, n)? {
                        items.get_or_insert_with(|| l.items.clone())[k].value = w;
                    }
                }
                items.map(|items| Value::List(Rc::new(List { items })))
            }
            Value::Record(r) => {
                let mut fields = None;
                for (k, (_, x)) in r.fields.iter().enumerate() {
                    if let Some(w) = self.inline_in(m, x, slots, path, key, n)? {
                        fields.get_or_insert_with(|| r.fields.clone())[k].1 = w;
                    }
                }
                fields.map(|fields| Value::Record(Rc::new(Record { ty: r.ty.clone(), fields })))
            }
            Value::Case(c) if &*c.ty == "core/part" && &*c.name == "VIEW" => {
                let id = *n;
                *n += 1;
                let child = c.values.iter().find(|(f, _)| &**f == "child").map_or_else(Value::none, |(_, x)| x.clone());
                let at = Env { owner: None, bindings: Vec::new(), path: path.to_string(), key: Some(key.to_string()) };
                let drawn = self.draw_view(m, &child, &join(path, &format!("~{}", id)), &at)?;
                slots.insert(format!("~{}", id), drawn);
                Some(Value::Case(Rc::new(Case { ty: c.ty.clone(), name: c.name.clone(), values: vec![(Rc::from("child"), inline_view(id))] })))
            }
            Value::Case(c) => {
                let mut values = None;
                for (k, (_, x)) in c.values.iter().enumerate() {
                    if let Some(w) = self.inline_in(m, x, slots, path, key, n)? {
                        values.get_or_insert_with(|| c.values.clone())[k].1 = w;
                    }
                }
                values.map(|values| Value::Case(Rc::new(Case { ty: c.ty.clone(), name: c.name.clone(), values })))
            }
            Value::Opt(Some(x)) => self.inline_in(m, x, slots, path, key, n)?.map(Value::some),
            _ => None,
        })
    }

    /// A widget written in Extended Mark: its instance, kept by its key, and its view.
    #[allow(clippy::too_many_arguments)]
    fn draw_use(
        &self,
        m: &mut Machine,
        name: &str,
        path: &str,
        args: &BTreeMap<String, Expr>,
        slots: &BTreeMap<String, Vec<Node>>,
        events: &BTreeMap<String, String>,
        env: &Env,
        levels: &[ir::Level],
        key: &str,
    ) -> R<Vec<Drawn>> {
        let Some(t) = self.s.templates.get(name).cloned() else {
            // an extern widget held as a view value
            let at = Env { path: parent(path).to_string(), ..env.clone() };
            return self.draw_extern(m, None, name, last_part(path), args, slots, events, &BTreeMap::new(), levels, &at);
        };
        if let Some(reused) = self.reuse(m, name, path, key, args, slots, events, env) {
            return Ok(reused);
        }
        self.w().frames.push(Frame::default());
        let drawn = match self.enter_use(m, &t, path, args, slots, events, env, key).and_then(|own| self.draw_nodes(m, &t.view, &own)) {
            Ok(out) => out,
            Err(f) => vec![self.failed(name, path, &f)],
        };
        let frame = self.w().frames.pop().unwrap_or_default();
        let (memo_on, kept) = {
            let w = self.w.borrow();
            (w.memo_on, w.by_path.contains_key(key))
        };
        // its arguments are worked out again outside its frame, as the web does: a failure there
        // only means it isn't kept
        let args = if memo_on && !frame.dirty && kept { self.arg_values(m, args, env).ok() } else { None };
        match args {
            Some(args) => {
                let slots = slots.iter().map(|(k, v)| (k.clone(), self.s.nodes_rc(v))).collect();
                let mut w = self.w();
                let epoch = w.epoch;
                w.memo.insert(key.to_string(), Rc::new(Memo { frame, template: name.to_string(), path: path.to_string(), owner: env.owner, args, bindings: env.bindings.clone(), slots, events: events.clone(), epoch, drawn: drawn.clone() }));
            }
            None => {
                self.w().memo.remove(key);
            }
        }
        Ok(drawn)
    }

    /// A widget that failed: reported once, and a notice in its place (page 6).
    fn failed(&self, name: &str, path: &str, f: &Failure) -> Drawn {
        let broken = match (&f.kind, &f.rule) {
            (FailKind::Rule, Some(rule)) => Broken { code: None, rule: Some(rule.clone()), site: Some(path.to_string()) },
            _ => broken_code(&failure_code(f), path),
        };
        {
            let mut w = self.w();
            for fr in w.frames.iter_mut() {
                fr.dirty = true;
            }
            if !w.outcome.failures.iter().any(|b| b.site.as_deref() == Some(path) && b.code == broken.code && b.rule == broken.rule) {
                w.outcome.failures.push(broken);
            }
        }
        let mut props = BTreeMap::new();
        props.insert("message".to_string(), Value::text(&format!("{} failed: {}", last_part(name), f.message)));
        Drawn::new(DrawnNode { path: path.to_string(), key: path.to_string(), widget: "#notice".to_string(), props, slots: BTreeMap::new(), events: BTreeMap::new(), writes: BTreeMap::new(), levels: Vec::new() })
    }

    /// A widget's instance at a key, made or kept, with its inputs, slots and events from this
    /// call: the env its own code runs in. Its rules have to hold.
    #[allow(clippy::too_many_arguments)]
    pub(crate) fn enter_use(
        &self,
        m: &mut Machine,
        t: &Rc<ir::Template>,
        path: &str,
        args: &BTreeMap<String, Expr>,
        slots: &BTreeMap<String, Vec<Node>>,
        events: &BTreeMap<String, String>,
        env: &Env,
        key: &str,
    ) -> R<Env> {
        let kept = {
            let w = self.w.borrow();
            w.by_path.get(key).and_then(|id| w.instances.get(id)).filter(|i| i.template.name == t.name).map(|i| i.id)
        };
        let fresh = kept.is_none();
        let id = match kept {
            Some(id) => id,
            None => {
                let id = m.new_id();
                let inst = Instance {
                    id,
                    path: key.to_string(),
                    template: t.clone(),
                    inputs: HashMap::new(),
                    places: HashMap::new(),
                    cells: HashMap::new(),
                    slots: HashMap::new(),
                    events: HashMap::new(),
                    seen: true,
                };
                let mut w = self.w();
                w.instances.insert(id, inst);
                w.by_path.insert(key.to_string(), id);
                id
            }
        };
        let was = {
            let mut w = self.w();
            w.at_path.insert(path.to_string(), id);
            for f in w.frames.iter_mut() {
                f.nested.push((id, path.to_string()));
            }
            let it = w.instances.get_mut(&id).unwrap();
            it.seen = true;
            it.places.clear();
            std::mem::take(&mut it.inputs)
        };
        for (k, e) in args {
            match e {
                Expr::Place(p) => {
                    self.with_instance(id, |i| i.places.insert(k.clone(), WriteTo { place: p.clone(), env: env.clone() }));
                }
                _ => {
                    let v = self.eval_in(m, env, e)?;
                    self.with_instance(id, |i| i.inputs.insert(k.clone(), v));
                }
            }
        }
        let own = Env { owner: Some(id), bindings: Vec::new(), path: path.to_string(), key: Some(key.to_string()) };
        for f in &t.inputs {
            let given = self.with_instance(id, |i| i.inputs.contains_key(&f.name) || i.places.contains_key(&f.name)).unwrap_or(true);
            if !given {
                let v = match &f.default {
                    Some(d) => self.eval_in(m, &own, d)?,
                    None => Value::none(),
                };
                self.with_instance(id, |i| i.inputs.insert(f.name.clone(), v));
            }
        }
        // an input given a new value: whatever read it, in the widget's slots too, is out of date
        if !fresh {
            let now = self.with_instance(id, |i| i.inputs.clone()).unwrap_or_default();
            for (k, v) in &now {
                let same = was.get(k).map_or(false, |b| m.equal(b, v).unwrap_or(false));
                if !same {
                    self.w().bump(format!("i:{}:{}", id, k));
                }
            }
        }
        let held: HashMap<String, (Nodes, Env)> = slots.iter().map(|(s, nodes)| (s.clone(), (self.s.nodes_rc(nodes), env.clone()))).collect();
        let handles: HashMap<String, Handle> = events.iter().map(|(e, h)| (e.clone(), Handle { handler: h.clone(), env: env.clone() })).collect();
        self.with_instance(id, |i| {
            i.slots = held;
            i.events = handles;
        });
        if fresh {
            for c in &t.cells {
                let v = match &c.default {
                    Some(d) => self.eval_in(m, &own, d)?,
                    None => Value::none(),
                };
                self.with_instance(id, |i| i.cells.insert(c.name.clone(), v));
            }
        }
        if let Some(rules) = self.s.template_rules.get(&t.name).cloned() {
            for (body, message) in rules.iter() {
                if let Some(Value::Bool(false)) = self.run_body(m, &[], body.clone(), &own, Vec::new())? {
                    return Err(Failure { kind: FailKind::Rule, message: message.clone(), rule: Some(message.clone()) });
                }
            }
        }
        Ok(own)
    }

    fn with_instance<T>(&self, id: u64, f: impl FnOnce(&mut Instance) -> T) -> Option<T> {
        self.w().instances.get_mut(&id).map(f)
    }

    /// An extern widget's instance, for its markdown block: its inputs' values and its slots.
    pub(crate) fn enter_extern(&self, m: &mut Machine, w: &ir::ExternWidget, path: &str, props: &BTreeMap<String, Value>, slots: &BTreeMap<String, Vec<Node>>, env: &Env) -> R<Env> {
        let t = self.s.extern_templates.get(&w.name).cloned().ok_or_else(|| Failure::ir(format!("no extern widget {}", w.name)))?;
        let id = m.new_id();
        let mut inputs: HashMap<String, Value> = props.iter().map(|(k, v)| (k.clone(), v.clone())).collect();
        for f in &w.inputs {
            if !inputs.contains_key(&f.name) {
                let v = match &f.default {
                    Some(d) => self.eval_in(m, env, d)?,
                    None => Value::none(),
                };
                inputs.insert(f.name.clone(), v);
            }
        }
        let held = slots.iter().map(|(s, nodes)| (s.clone(), (self.s.nodes_rc(nodes), env.clone()))).collect();
        let inst = Instance { id, path: format!("{}#md", path), template: t, inputs, places: HashMap::new(), cells: HashMap::new(), slots: held, events: HashMap::new(), seen: true };
        self.w().instances.insert(id, inst);
        Ok(Env { owner: Some(id), bindings: Vec::new(), path: path.to_string(), key: None })
    }

    /// Drops an instance made only to write Markdown.
    pub(crate) fn leave(&self, env: &Env) {
        let mut w = self.w();
        if let Some(id) = env.owner {
            if w.instances.get(&id).map_or(false, |i| i.path.ends_with("#md")) {
                w.instances.remove(&id);
            }
        }
    }

    pub(crate) fn held_slot(&self, id: &Value) -> Option<(Nodes, Env)> {
        let k = match id {
            Value::Num(n) => n.to_i64()?,
            _ => return None,
        };
        self.w.borrow().held.get(usize::try_from(k).ok()?).cloned()
    }

    /// A view held in a value: a slot's content, or a call made as a value.
    fn draw_view(&self, m: &mut Machine, v: &Value, path: &str, env: &Env) -> R<Vec<Drawn>> {
        let view = match v {
            Value::Opt(Some(x)) => return self.draw_view(m, x, path, env),
            Value::List(l) => {
                let mut out = Vec::new();
                for (k, i) in l.items.iter().enumerate() {
                    out.extend(self.draw_view(m, &i.value, &format!("{}[{}]", path, k), env)?);
                }
                return Ok(out);
            }
            Value::View(view) if &*view.widget != "#inline" => view.clone(),
            _ => return Ok(Vec::new()),
        };
        if &*view.widget == "#slot" {
            return match view.args.get("id").and_then(|id| self.held_slot(id)) {
                Some((nodes, at)) => self.draw_nodes(m, &nodes, &at),
                None => Ok(Vec::new()),
            };
        }
        let made = Env { owner: view.owner, bindings: view.captured.clone(), path: env.path.clone(), key: None };
        if self.s.templates.contains_key(&*view.widget) {
            let args: BTreeMap<String, Expr> = view.args.iter().map(|(k, x)| (k.clone(), x.to_ir())).collect();
            return self.draw_use(m, &view.widget, path, &args, &view.slots, &view.events, &made, &[], path);
        }
        let mut props = view.args.clone();
        let w = self.s.extern_widgets.get(&*view.widget).cloned();
        for f in w.iter().flat_map(|w| w.inputs.iter()) {
            if !props.contains_key(&f.name) {
                if let Some(d) = &f.default {
                    let v = self.eval_in(m, &made, d)?;
                    props.insert(f.name.clone(), v);
                }
            }
        }
        let mut slots = BTreeMap::new();
        for (s, nodes) in &view.slots {
            slots.insert(s.clone(), self.draw_nodes(m, nodes, &made)?);
        }
        let key = join(env.key_or_path(), last_part(path));
        self.inline_views(m, &mut props, &mut slots, path, &key)?;
        let events = view.events.iter().map(|(e, h)| (e.clone(), Handle { handler: h.clone(), env: made.clone() })).collect();
        Ok(vec![Drawn::new(DrawnNode {
            path: path.to_string(),
            key,
            widget: view.widget.to_string(),
            props,
            slots,
            events,
            writes: BTreeMap::new(),
            levels: w.map(|w| w.levels.clone()).unwrap_or_default(),
        })])
    }
}

/// What a transaction undoes.
struct Snapshot {
    state: Vec<(String, Value)>,
    cells: Vec<(u64, HashMap<String, Value>)>,
    calls: usize,
}

/// One write a layout makes: a `mut` input of a drawn widget.
#[derive(Clone, Debug)]
pub struct LayoutWrite {
    pub path: String,
    pub input: String,
    pub value: Value,
}

/// The page: mount it, read its tree, its `$state` and its Markdown, and change it.
pub struct Page {
    rt: Rt,
    drawn: Vec<Drawn>,
    /// How many changes came from outside the layout: the reader's, the app's, the page's
    /// values. A layout that didn't settle is held until the next one.
    changes: u64,
    /// How many times the page was drawn: a target that draws every frame redraws its own
    /// widgets when this moves.
    revision: u64,
    listeners: Vec<(usize, Box<dyn FnMut()>)>,
    next_listener: usize,
    /// The planes already laid out once, by identity: `fit` only sets where they start.
    pub(crate) started: HashSet<String>,
    /// The outside change a layout that didn't settle is held at.
    pub(crate) held_layout: Option<u64>,
}

impl Page {
    /// A page from the IR file `xtmd build` writes, as JSON.
    pub fn from_json(json: &str, opts: PageOptions) -> R<Page> {
        let file: ir::File = serde_json::from_str(json).map_err(|e| Failure::ir(format!("the IR doesn't read: {}", e)))?;
        Page::new(file, opts)
    }

    /// A page from an IR file: mounted, and drawn once.
    pub fn new(file: ir::File, opts: PageOptions) -> R<Page> {
        Page::from_module(file.ir, opts)
    }

    pub fn from_module(module: ir::Module, opts: PageOptions) -> R<Page> {
        let mut program = Program::from_module(&module);
        let mut templates = HashMap::new();
        let mut template_rules = HashMap::new();
        let mut nodes = Stable::default();
        for t in &module.templates {
            for f in &t.fns {
                program.fns.insert(f.name.clone(), Rc::new(f.clone()));
            }
            let t = Rc::new(t.clone());
            nodes.link(&t.view, &t.view);
            nodes.link(&t.markdown, &t.markdown);
            template_rules.insert(t.name.clone(), Rc::new(t.requires.iter().map(|r| (Rc::new(r.body.clone()), r.message.clone())).collect::<Vec<_>>()));
            templates.insert(t.name.clone(), t);
        }
        let handlers = module
            .handlers
            .iter()
            .map(|h| {
                let passes = match h.body.as_slice() {
                    [Stmt::Invoke(i)] => Some(i.event.clone()),
                    _ => None,
                };
                (h.id.clone(), HandlerFn { params: h.params.clone(), body: Rc::new(h.body.clone()), passes })
            })
            .collect();
        let bindings = module.bindings.iter().map(|b| (b.id.clone(), b.value.clone())).collect();
        let app_fns = module.needs.app.iter().cloned().collect();
        let mut state_decl = None;
        let mut extern_widgets = HashMap::new();
        let mut extern_templates = HashMap::new();
        let mut lets = HashMap::new();
        for d in &module.declarations {
            match &d.declare {
                ir::Decl::State(s) => state_decl = Some(s.clone()),
                ir::Decl::Extern(ir::Extern::Widget(w)) => {
                    let w = Rc::new(w.clone());
                    nodes.link(&w.markdown, &w.markdown);
                    extern_templates.insert(
                        w.name.clone(),
                        Rc::new(ir::Template {
                            name: w.name.clone(),
                            generics: Vec::new(),
                            inputs: w.inputs.clone(),
                            slots: w.slots.clone(),
                            events: w.events.clone(),
                            cells: Vec::new(),
                            requires: Vec::new(),
                            fns: Vec::new(),
                            view: Vec::new(),
                            markdown: Vec::new(),
                            levels: w.levels.clone(),
                        }),
                    );
                    extern_widgets.insert(w.name.clone(), w);
                }
                ir::Decl::Let(l) => {
                    lets.entry(l.name.clone()).or_insert_with(|| l.value.clone());
                }
                _ => {}
            }
        }
        let state_rules = Rc::new(state_decl.iter().flat_map(|s: &ir::State| s.requires.iter()).map(|r| (Rc::new(r.body.clone()), r.message.clone())).collect::<Vec<_>>());
        let shared = Shared {
            program,
            templates,
            template_rules,
            extern_widgets,
            extern_templates,
            handlers,
            bindings,
            app_fns,
            state_decl,
            state_rules,
            lets,
            defects: opts.defects.iter().cloned().collect(),
            target_fns: opts.fns.clone(),
            stable: nodes,
            module,
        };
        let world = World { supplies: opts.supplies.clone(), memo_on: opts.memo, ..World::default() };
        let mut page = Page {
            rt: Rt { s: Rc::new(shared), w: Rc::new(RefCell::new(world)) },
            drawn: Vec::new(),
            changes: 0,
            revision: 0,
            listeners: Vec::new(),
            next_listener: 0,
            started: HashSet::new(),
            held_layout: None,
        };
        // the page's values, then $state's starting values, then what the app gives
        let s = page.rt.s.clone();
        for d in &s.module.declarations {
            if let ir::Decl::Extern(ir::Extern::Channel(c)) = &d.declare {
                for f in &c.values {
                    if let Some(x) = &f.default {
                        let v = page.constant(x)?;
                        page.rt.w().externs.insert(format!("{}.{}", c.name, f.name), v);
                    }
                }
            }
        }
        for f in s.state_decl.iter().flat_map(|s| s.fields.iter()) {
            if let Some(x) = &f.default {
                let v = page.constant(x)?;
                page.rt.w().state_set(&f.name, v);
            }
        }
        for (k, x) in &opts.state {
            let v = page.constant(x)?;
            page.rt.w().state_set(k, v);
        }
        for (c, values) in &opts.externs {
            for (k, x) in values {
                let v = page.constant(x)?;
                page.rt.w().externs.insert(format!("{}.{}", c, k), v);
            }
        }
        page.apply_page(opts.page);
        page.redraw()?;
        Ok(page)
    }

    /// Runs `f` with a machine on the page's program, its host the page: one per change, its
    /// step count and identities carried from the last.
    pub(crate) fn with_machine<T>(&self, f: impl FnOnce(&Rt, &mut Machine) -> T) -> T {
        let rt = self.rt.clone();
        let s = rt.s.clone();
        let mut m = Machine::new(&s.program, Box::new(PageHost(rt.clone())));
        {
            let w = rt.w.borrow();
            m.steps = w.steps;
            m.next_id = w.next_id;
        }
        let out = f(&rt, &mut m);
        let mut w = rt.w.borrow_mut();
        w.steps = m.steps;
        w.next_id = m.next_id;
        out
    }

    fn reset_steps(&self) {
        self.rt.w().steps = 0;
    }

    pub(crate) fn rt(&self) -> &Rt {
        &self.rt
    }

    // ---- reading the page

    /// The drawn extern widgets, in order, with their props worked out.
    pub fn tree(&self) -> &[Drawn] {
        &self.drawn
    }

    /// How many times the page has been drawn. A target that draws every frame keeps the
    /// revision it last drew and rebuilds what it holds when this moves.
    pub fn revision(&self) -> u64 {
        self.revision
    }

    /// How many changes came from outside the layout.
    pub fn changes(&self) -> u64 {
        self.changes
    }

    /// Every drawn extern widget by its path, as a check observes it.
    pub fn observe_tree(&self) -> BTreeMap<String, Mounted> {
        fn walk(nodes: &[Drawn], out: &mut BTreeMap<String, Mounted>) {
            for n in nodes {
                let props = n.props.iter().filter(|(_, v)| !matches!(v, Value::Fn(_))).map(|(k, v)| (k.clone(), v.to_ir())).collect();
                let slots = n.slots.iter().map(|(s, kids)| (s.clone(), kids.iter().map(|k| k.path.clone()).collect())).collect();
                out.insert(n.path.clone(), Mounted { widget: n.widget.clone(), props, slots });
                for kids in n.slots.values() {
                    walk(kids, out);
                }
            }
        }
        let mut out = BTreeMap::new();
        walk(&self.drawn, &mut out);
        out
    }

    /// Every `shade` drawn, by path: the fn it was given, by name, and its arguments (plan tab
    /// 16, `shaded`). With `samples`, also the colour at the area's two corners and its middle,
    /// worked out by the shader itself, as the test target does.
    pub fn observe_shaded(&self, samples: bool) -> R<BTreeMap<String, Shaded>> {
        fn shades<'a>(nodes: &'a [Drawn], out: &mut Vec<&'a Drawn>) {
            for n in nodes {
                if n.widget == "core/shade" {
                    out.push(n);
                }
                for kids in n.slots.values() {
                    shades(kids, out);
                }
            }
        }
        let mut found = Vec::new();
        shades(&self.drawn, &mut found);
        let mut out = BTreeMap::new();
        for n in found {
            let f = n.props.get("shader");
            let args = n.props.get("args").cloned().unwrap_or_else(Value::none);
            let mut entry = Shaded { shader: f.map_or_else(String::new, shader_name), args: args.to_ir(), samples: None };
            let corners = match n.props.get("area") {
                Some(Value::Record(area)) => {
                    let coord = |p: &str, k: &str| match area.get(p) {
                        Some(Value::Record(pt)) => pt.get(k).and_then(|v| match v {
                            Value::Num(n) => Some(*n),
                            _ => None,
                        }),
                        _ => None,
                    };
                    match (coord("from", "x"), coord("from", "y"), coord("to", "x"), coord("to", "y")) {
                        (Some(fx), Some(fy), Some(tx), Some(ty)) => Some((fx, fy, tx, ty)),
                        _ => None,
                    }
                }
                _ => None,
            };
            if let (true, Some(f), Some((fx, fy, tx, ty))) = (samples, f, corners) {
                let half = Num::parse("0.5").unwrap();
                let point = |x: Num, y: Num| crate::layout::pt_value(&crate::layout::Pt { x, y });
                let px = Value::Num(tx.sub(fx)?.abs().div(Num::int(64))?);
                let ats = [point(fx, fy), point(fx.add(tx)?.mul(half)?, fy.add(ty)?.mul(half)?), point(tx, ty)];
                let mut taken = Vec::new();
                for at in ats {
                    self.reset_steps();
                    let pixel = self.with_machine(|_, m| m.apply(f, vec![Binding::Value(at.clone()), Binding::Value(px.clone()), Binding::Value(args.clone())]))?;
                    taken.push((at.to_ir(), pixel.map_or(Expr::None(ir::Empty {}), |p| p.to_ir())));
                }
                entry.samples = Some(taken);
            }
            out.insert(n.path.clone(), entry);
        }
        Ok(out)
    }

    /// `$state` as it is now, in the IR's form.
    pub fn observe_state(&self) -> BTreeMap<String, Expr> {
        self.rt.w.borrow().state.iter().map(|(k, v)| (k.clone(), v.to_ir())).collect()
    }

    /// Every widget's own variables, by the place it is drawn at: an Extended Mark widget's `mut` variables,
    /// and an extern widget's own values for `mut` inputs its caller gave no variable. With
    /// `$state`, what a snapshot holds.
    pub fn observe_own(&self) -> BTreeMap<String, BTreeMap<String, Expr>> {
        let w = self.rt.w.borrow();
        let mut out: BTreeMap<String, BTreeMap<String, Expr>> = BTreeMap::new();
        for (path, id) in &w.at_path {
            if let Some(i) = w.instances.get(id).filter(|i| !i.cells.is_empty()) {
                out.insert(path.clone(), i.cells.iter().map(|(k, v)| (k.clone(), v.to_ir())).collect());
            }
        }
        fn walk(nodes: &[Drawn], w: &World, out: &mut BTreeMap<String, BTreeMap<String, Expr>>) {
            for n in nodes {
                if let Some(own) = w.own.get(&n.key) {
                    for (k, v) in own.iter().filter(|(k, _)| !n.writes.contains_key(*k)) {
                        out.entry(n.path.clone()).or_default().insert(k.clone(), v.to_ir());
                    }
                }
                for kids in n.slots.values() {
                    walk(kids, w, out);
                }
            }
        }
        walk(&self.drawn, &w, &mut out);
        out
    }

    /// Widgets' own variables put back by place, as one change: each value checked against its
    /// variable's type. One that doesn't fit, or whose widget isn't drawn at that place, is left
    /// out, and returned as `place.name`.
    pub fn restore_own(&mut self, values: &BTreeMap<String, BTreeMap<String, Expr>>) -> R<Vec<String>> {
        self.changes += 1;
        self.reset_steps();
        let mut left = Vec::new();
        for (path, vars) in values {
            let node = self.find(path).cloned();
            let id = self.rt.w.borrow().at_path.get(path).copied();
            for (name, x) in vars {
                let Ok(v) = self.value(x) else {
                    left.push(format!("{}.{}", path, name));
                    continue;
                };
                let cell = id.and_then(|id| self.rt.w.borrow().instances.get(&id).and_then(|i| i.template.cells.iter().find(|c| c.name == *name).map(|c| c.ty.clone())));
                if let (Some(id), Some(ty)) = (id, cell) {
                    if self.with_machine(|_, m| m.fits(&v, &ty))? {
                        let mut w = self.rt.w();
                        if let Some(i) = w.instances.get_mut(&id) {
                            i.cells.insert(name.clone(), v);
                        }
                        w.bump(format!("c:{}:{}", id, name));
                        continue;
                    }
                }
                let input = node.as_ref().filter(|n| !n.writes.contains_key(name)).and_then(|n| self.rt.s.extern_widgets.get(&n.widget).and_then(|w| w.inputs.iter().find(|f| f.name == *name && f.mutable)).map(|f| (n.key.clone(), f.ty.clone())));
                if let Some((key, ty)) = input {
                    if self.with_machine(|_, m| m.fits(&v, &ty))? {
                        let mut w = self.rt.w();
                        w.own.entry(key.clone()).or_default().insert(name.clone(), v);
                        w.bump(format!("o:{}", key));
                        continue;
                    }
                }
                left.push(format!("{}.{}", path, name));
            }
        }
        self.redraw()?;
        Ok(left)
    }

    /// One of `$state`'s values.
    pub fn state_value(&self, name: &str) -> Option<Value> {
        self.rt.w.borrow().state_get(name)
    }

    /// The extern fns of the app called since they were last taken.
    pub fn take_calls(&mut self) -> Vec<Call> {
        std::mem::take(&mut self.rt.w().calls)
    }

    /// Refused writes and failures since they were last taken.
    pub fn take_outcome(&mut self) -> Outcome {
        std::mem::take(&mut self.rt.w().outcome)
    }

    /// Every failure caught since they were last taken, with its message, for a host's log.
    pub fn take_errors(&mut self) -> Vec<Failure> {
        std::mem::take(&mut self.rt.w().errors)
    }

    /// The extern widgets this page uses that the target doesn't supply, each shown as its
    /// Markdown: reported when the page is mounted, and kept up to date as it changes.
    pub fn missing(&self) -> Vec<String> {
        self.rt.w.borrow().missed.iter().cloned().collect()
    }

    /// Called after every redraw, with nothing: the listener reads the page again. Returns an
    /// id for [`Page::off_change`].
    pub fn on_change(&mut self, listener: impl FnMut() + 'static) -> usize {
        self.next_listener += 1;
        self.listeners.push((self.next_listener, Box::new(listener)));
        self.next_listener
    }

    pub fn off_change(&mut self, id: usize) {
        self.listeners.retain(|(k, _)| *k != id);
    }

    // ---- changing it: every change is one transaction, checked, and undone when it fails

    /// A reader's event on a drawn widget, by its path.
    pub fn event(&mut self, path: &str, name: &str, args: Vec<Value>) -> R<()> {
        let Some(ev) = self.find(path).and_then(|n| n.events.get(name).cloned()) else { return Ok(()) };
        self.transaction(path, move |rt, m| rt.run_handler(m, &ev.handler, &ev.env, args).map(|_| ()))
    }

    /// A drawn widget writing one of its `mut` inputs, as a slider does.
    pub fn write(&mut self, path: &str, input: &str, value: Value) -> R<()> {
        self.changes += 1;
        self.reset_steps();
        let Some(node) = self.find(path) else { return Ok(()) };
        let (to, widget, key) = (node.writes.get(input).cloned(), node.widget.clone(), node.key.clone());
        let Some(to) = to else {
            // a widget's own value: kept by the page for it, checked against the input's type
            let Some(f) = self.rt.s.extern_widgets.get(&widget).and_then(|w| w.inputs.iter().find(|f| f.name == input && f.mutable)).cloned() else { return Ok(()) };
            if !self.with_machine(|_, m| m.fits(&value, &f.ty))? {
                self.rt.w().outcome.refused.push(broken_code("contracts.outside", path));
                return Ok(());
            }
            {
                let mut w = self.rt.w();
                w.own.entry(key.clone()).or_default().insert(input.to_string(), value);
                w.bump(format!("o:{}", key));
            }
            return self.redraw();
        };
        enum Refused {
            Contract,
            Rule(String),
        }
        let snap = self.snapshot();
        let unchecked = self.rt.defect("unchecked-writes");
        let r = self.with_machine(|rt, m| -> R<Option<Refused>> {
            rt.write_place(m, &to, value)?;
            if !unchecked && rt.contract_broken(m, &to)? {
                return Ok(Some(Refused::Contract));
            }
            Ok(rt.state_rule_broken(m)?.map(Refused::Rule))
        });
        match r {
            Ok(None) => {}
            Ok(Some(Refused::Rule(rule))) => {
                self.restore(snap);
                self.rt.w().outcome.refused.push(broken_rule(&rule));
            }
            Ok(Some(Refused::Contract)) | Err(_) => {
                self.restore(snap);
                self.rt.w().outcome.refused.push(broken_code("contracts.outside", path));
            }
        }
        self.redraw()
    }

    /// A layout pass's writes, as one change: a value equal to the one there is no change, and a
    /// refused write undoes the pass. Whether the layout has to run again: only when a variable
    /// changed, since a widget's own values are read by no Extended Mark code.
    pub fn layout_write(&mut self, writes: Vec<LayoutWrite>) -> R<bool> {
        self.reset_steps();
        let snap = self.snapshot();
        let own_before = self.rt.w.borrow().own.clone();
        let mut changed = false;
        let mut shared = false;
        for LayoutWrite { path, input, value } in writes {
            let Some(node) = self.find(&path) else { continue };
            if let Some(now) = node.props.get(&input) {
                if self.with_machine(|_, m| m.equal(now, &value))? {
                    continue;
                }
            }
            let (to, key) = (node.writes.get(&input).cloned(), node.key.clone());
            let r = match to {
                Some(to) => {
                    let r = self.with_machine(|rt, m| -> R<()> {
                        rt.write_place(m, &to, value)?;
                        if rt.contract_broken(m, &to)? {
                            return Err(Failure::new(FailKind::Rule, "contracts.outside"));
                        }
                        Ok(())
                    });
                    if r.is_ok() {
                        shared = true;
                    }
                    r
                }
                None => {
                    let mut w = self.rt.w();
                    w.own.entry(key.clone()).or_default().insert(input.clone(), value);
                    w.bump(format!("o:{}", key));
                    Ok(())
                }
            };
            if r.is_err() {
                self.restore(snap);
                let mut w = self.rt.w();
                w.own = own_before;
                w.outcome.refused.push(broken_code("contracts.outside", &path));
                return Ok(false);
            }
            changed = true;
        }
        if !changed {
            return Ok(false);
        }
        if let Some(rule) = self.with_machine(|rt, m| rt.state_rule_broken(m))? {
            self.restore(snap);
            let mut w = self.rt.w();
            w.own = own_before;
            w.outcome.refused.push(broken_rule(&rule));
            return Ok(false);
        }
        self.redraw()?;
        Ok(shared)
    }

    /// The warnings since the app last took them: a spot outside its plane's bounds (page 5,
    /// plane), reported when the page runs as it can't be known when it is compiled.
    pub fn take_warnings(&mut self) -> Vec<Broken> {
        std::mem::take(&mut self.rt.w().warnings)
    }

    /// Where a spot is, against its plane's bounds: a warning when it moves outside them.
    pub fn spot_inside(&self, path: &str, inside: bool) {
        let mut w = self.rt.w();
        if inside {
            w.outside.remove(path);
        } else if !w.outside.contains(path) {
            w.outside.insert(path.to_string());
            w.warnings.push(broken_code("views.spot-outside-bounds", path));
        }
    }

    /// A plane whose layout didn't settle (page 6, failures).
    pub fn layout_failed(&mut self, path: &str) {
        let mut w = self.rt.w();
        if !w.outcome.failures.iter().any(|b| b.site.as_deref() == Some(path) && b.code.as_deref() == Some("failure.layout")) {
            w.outcome.failures.push(broken_code("failure.layout", path));
        }
    }

    /// An app's write to `$state`: one change, checked once: each value's type, then its
    /// contract, then `$state`'s rules.
    pub fn set(&mut self, changes: Vec<(String, Value)>) -> R<()> {
        self.changes += 1;
        self.reset_steps();
        let snap = self.snapshot();
        for (k, v) in changes {
            let f = self.rt.s.state_decl.as_ref().and_then(|s| s.fields.iter().find(|f| f.name == k)).cloned();
            let ok = match &f {
                Some(f) => self.of_type(&v, &f.ty, 0) && self.with_machine(|_, m| m.fits(&v, &f.ty))?,
                None => false,
            };
            if !ok {
                self.restore(snap);
                self.rt.w().outcome.refused.push(broken_code("contracts.outside", &format!("$state.{}", k)));
                return Ok(());
            }
            let mut w = self.rt.w();
            w.state_set(&k, v);
            w.bump(format!("s:{}", k));
        }
        let rule = if self.rt.defect("unchecked-app-writes") { None } else { self.with_machine(|rt, m| rt.state_rule_broken(m))? };
        if let Some(rule) = rule {
            self.restore(snap);
            self.rt.w().outcome.refused.push(broken_rule(&rule));
            return Ok(());
        }
        self.redraw()
    }

    /// An app calling a fn the document exposes.
    pub fn expose(&mut self, channel: &str, name: &str, args: Vec<Value>) -> R<()> {
        let s = self.rt.s.clone();
        for d in &s.module.declarations {
            let ir::Decl::Expose(e) = &d.declare else { continue };
            if e.channel != channel {
                continue;
            }
            let Some(f) = e.fns.iter().find(|f| f.name == name) else { continue };
            let body = Rc::new(f.body.clone());
            return self.transaction(&format!("{}.{}", channel, name), move |rt, m| rt.run_body(m, &f.params, body, &Env::default(), args).map(|_| ()));
        }
        Ok(())
    }

    /// The app giving a channel's values.
    pub fn set_extern(&mut self, channel: &str, values: Vec<(String, Value)>) -> R<()> {
        self.changes += 1;
        {
            let mut w = self.rt.w();
            for (k, v) in values {
                w.externs.insert(format!("{}.{}", channel, k), v);
                w.bump(format!("x:{}.{}", channel, k));
            }
        }
        self.redraw()
    }

    /// The page's own values: its width and theme.
    pub fn set_page(&mut self, page: PageValues) -> R<()> {
        self.changes += 1;
        self.apply_page(page);
        self.redraw()
    }

    /// Which extern widgets the target draws: set by a target before it first draws the page,
    /// from its registry. The page is drawn again.
    pub fn set_supplies(&mut self, supplies: Option<Supplies>) -> R<()> {
        {
            let mut w = self.rt.w();
            w.supplies = supplies;
            w.epoch += 1;
            w.missed.clear();
        }
        self.redraw()
    }

    /// Turns reuse on or off: off draws every widget anew on every change, for comparing the
    /// two. What was kept stays until it is drawn again.
    pub fn set_memo(&mut self, on: bool) {
        self.rt.w().memo_on = on;
    }

    // ---- the page's Markdown

    /// The page as Markdown, with the values it has now: the same text on every target.
    pub fn markdown(&self) -> R<String> {
        self.reset_steps();
        let blocks = self.with_machine(|rt, m| crate::markdown::page_blocks(rt, m))?;
        Ok(if self.rt.defect("unescaped-markdown") { xtmd_markdown::write_unescaped(&blocks) } else { xtmd_markdown::write(&blocks) })
    }

    /// The page's Markdown as blocks, before they are written.
    pub fn markdown_blocks(&self) -> R<Vec<xtmd_markdown::Block>> {
        self.reset_steps();
        self.with_machine(|rt, m| crate::markdown::page_blocks(rt, m))
    }

    // ---- what a target asks while it draws

    /// A value in the IR's form, as the app and the checks give them.
    pub fn value(&self, x: &Expr) -> R<Value> {
        self.constant(x)
    }

    /// Works out an expression on the page, outside any widget: a binding, a `let`, `$state`.
    pub fn eval(&self, x: &Expr) -> R<Value> {
        self.reset_steps();
        self.with_machine(|rt, m| rt.eval_in(m, &Env::default(), x))
    }

    /// The value a token stands for, from the build's tokens: `core/space.M` is 12.
    pub fn token_value(&self, v: &Value) -> R<Value> {
        match v {
            Value::Case(c) => self.with_machine(|_, m| m.default_token_value(c)),
            other => Ok(other.clone()),
        }
    }

    /// Whether two values are the same, as `==` says.
    pub fn equal(&self, a: &Value, b: &Value) -> R<bool> {
        self.with_machine(|_, m| m.equal(a, b))
    }

    /// Runs a fn the tree holds, outside any change, with the step limit to itself: how a target
    /// paints a `shade`, one pixel at a time from its shader.
    pub fn apply(&self, f: &Value, args: Vec<Value>) -> R<Option<Value>> {
        self.reset_steps();
        self.with_machine(|_, m| m.apply(f, args.into_iter().map(Binding::Value).collect()))
    }

    /// Whether a drawn widget's event runs anything. A handler that only passes the event on, as
    /// `column` gives its `flex` `click = fn() { invoke click(); }`, counts only when the caller
    /// of the widget it passes it to set that event in turn: so a target makes only what does
    /// something clickable.
    pub fn listens(&self, d: &Drawn, event: &str) -> bool {
        let w = self.rt.w.borrow();
        let mut ev = d.events.get(event).cloned();
        for _ in 0..64 {
            let Some(e) = ev else { return false };
            let Some(h) = self.rt.s.handlers.get(&e.handler) else { return false };
            let Some(only) = &h.passes else { return true };
            ev = e.env.owner.and_then(|o| w.instances.get(&o)).and_then(|i| i.events.get(only).cloned());
        }
        false
    }

    /// The type of the variable a drawn widget's `mut` input writes, its contract included:
    /// where a slider's ends and step come from (page 5). The input's own type when the caller
    /// gave no variable; `None` for a local, whose type the IR doesn't keep.
    pub fn write_type(&self, d: &Drawn, input: &str) -> Option<ir::Type> {
        let s = &self.rt.s;
        let Some(to) = d.writes.get(input) else {
            return s.extern_widgets.get(&d.widget).and_then(|w| w.inputs.iter().find(|f| f.name == input)).map(|f| f.ty.clone());
        };
        let w = self.rt.w.borrow();
        let inst = to.env.owner.and_then(|o| w.instances.get(&o));
        let mut t = match &to.place.root {
            ir::Root::State(n) => s.state_decl.as_ref().and_then(|st| st.fields.iter().find(|f| f.name == *n)).map(|f| f.ty.clone()),
            ir::Root::Cell(n) => inst.and_then(|i| i.template.cells.iter().find(|c| c.name == *n)).map(|c| c.ty.clone()),
            ir::Root::Input(n) => inst.and_then(|i| i.template.inputs.iter().find(|f| f.name == *n)).map(|f| f.ty.clone()),
            ir::Root::Local(_) => None,
        };
        for step in &to.place.path {
            let mut base = t.clone();
            for _ in 0..16 {
                match base.as_ref().and_then(|b| s.program.aliases.get(&b.name)) {
                    Some(next) => base = Some(next.clone()),
                    None => break,
                }
            }
            let base = base?;
            t = match step {
                // a record's field, or a list's item
                ir::Step::Field(f) => {
                    let fields = if base.fields.is_empty() { s.program.records.get(&base.name).map(|r| r.fields.clone()).unwrap_or_default() } else { base.fields.clone() };
                    fields.iter().find(|x| x.name == f.name).map(|x| x.ty.clone())
                }
                ir::Step::Item(_) => base.args.first().cloned(),
            };
        }
        t
    }

    // ---- inside

    fn apply_page(&mut self, page: PageValues) {
        let mut w = self.rt.w();
        if let Some(width) = page.width {
            let name = match width {
                PageWidth::Narrow => "NARROW",
                PageWidth::Medium => "MEDIUM",
                PageWidth::Wide => "WIDE",
            };
            w.externs.insert("core/page.width".into(), case_value("core/width", name));
            w.bump("x:core/page.width".into());
        }
        if let Some(theme) = page.theme {
            let name = match theme {
                PageTheme::Light => "LIGHT",
                PageTheme::Dark => "DARK",
            };
            w.externs.insert("core/page.theme".into(), case_value("core/theme", name));
            w.bump("x:core/page.theme".into());
        }
    }

    /// Whether a value has a type's shape. The app's values come from outside, so their type is
    /// checked before their contract: the compiler has proved only the page's own.
    pub fn of_type(&self, v: &Value, t: &ir::Type, depth: u32) -> bool {
        let p = &self.rt.s.program;
        let mut ty = t;
        let mut guard = 0;
        while let Some(next) = p.aliases.get(&ty.name) {
            if guard >= 16 {
                break;
            }
            ty = next;
            guard += 1;
        }
        let arg = ty.args.first();
        if depth > 64 {
            return false;
        }
        match ty.name.as_str() {
            "core/number" | "core/int" => return matches!(v, Value::Num(_)),
            "core/text" => return matches!(v, Value::Text(_)),
            "core/bool" => return matches!(v, Value::Bool(_)),
            "core/duration" => return matches!(v, Value::Duration(_)),
            "core/list" => {
                return match v {
                    Value::List(l) => arg.map_or(true, |a| l.items.iter().all(|i| self.of_type(&i.value, a, depth + 1))),
                    _ => false,
                }
            }
            "core/opt" => {
                return match v {
                    Value::Opt(None) => true,
                    Value::Opt(Some(x)) => arg.map_or(true, |a| self.of_type(x, a, depth + 1)),
                    _ => false,
                }
            }
            "core/range" => return matches!(v, Value::Range(_)),
            _ => {}
        }
        if let Some(rec) = p.records.get(&ty.name) {
            let Value::Record(r) = v else { return false };
            if *r.ty != *ty.name {
                return false;
            }
            return rec.fields.iter().all(|f| match r.get(&f.name) {
                Some(x) => self.of_type(x, &f.ty, depth + 1),
                None => false,
            });
        }
        if p.enums.contains_key(&ty.name) || p.tokens.contains_key(&ty.name) {
            return matches!(v, Value::Case(c) if *c.ty == *ty.name);
        }
        // a type parameter, or a fn or view, which the app doesn't write
        true
    }

    fn constant(&self, x: &Expr) -> R<Value> {
        Machine::new(&self.rt.s.program, Box::new(Constants)).eval(x)
    }

    fn snapshot(&self) -> Snapshot {
        let w = self.rt.w.borrow();
        Snapshot { state: w.state.clone(), cells: w.instances.iter().map(|(id, i)| (*id, i.cells.clone())).collect(), calls: w.calls.len() }
    }

    fn restore(&self, s: Snapshot) {
        let mut w = self.rt.w();
        // what was drawn from the undone values goes with them
        w.epoch += 1;
        w.state = s.state;
        for (id, cells) in s.cells {
            if let Some(i) = w.instances.get_mut(&id) {
                i.cells = cells;
            }
        }
        w.calls.truncate(s.calls);
    }

    /// A change from outside: done whole, with `$state`'s rules after it, or undone.
    fn transaction(&mut self, site: &str, run: impl FnOnce(&Rt, &mut Machine) -> R<()>) -> R<()> {
        self.changes += 1;
        let snap = self.snapshot();
        let r = self.with_machine(|rt, m| -> R<()> {
            m.reset_steps();
            run(rt, m)?;
            if let Some(rule) = rt.state_rule_broken(m)? {
                return Err(Failure { kind: FailKind::Rule, message: rule.clone(), rule: Some(rule) });
            }
            Ok(())
        });
        if let Err(f) = r {
            if !self.rt.defect("no-undo") {
                self.restore(snap);
            }
            let broken = match (&f.kind, &f.rule) {
                (FailKind::Rule, Some(rule)) => Broken { code: None, rule: Some(rule.clone()), site: Some(site.to_string()) },
                _ => broken_code(&failure_code(&f), site),
            };
            let mut w = self.rt.w();
            w.outcome.failures.push(broken);
            w.errors.push(f);
        }
        self.redraw()
    }

    /// The drawn widget at a path.
    pub fn find(&self, path: &str) -> Option<&Drawn> {
        fn walk<'a>(nodes: &'a [Drawn], path: &str) -> Option<&'a Drawn> {
            for n in nodes {
                if n.path == path {
                    return Some(n);
                }
                for kids in n.slots.values() {
                    if let Some(f) = walk(kids, path) {
                        return Some(f);
                    }
                }
            }
            None
        }
        walk(&self.drawn, path)
    }

    /// Draws the whole page again: once per change.
    pub fn redraw(&mut self) -> R<()> {
        // a target that doesn't redraw after a change keeps showing the old page
        if self.rt.defect("no-redraw") && !self.drawn.is_empty() {
            return Ok(());
        }
        let drawn = self.with_machine(|rt, m| -> R<Vec<Drawn>> {
            // each redraw has the step limit to itself, as each event does: steps never pile up
            m.reset_steps();
            {
                let mut w = rt.w();
                for i in w.instances.values_mut() {
                    i.seen = false;
                }
                w.held.clear();
                w.missed.clear();
                w.at_path.clear();
                w.own_seen.clear();
                w.extern_seen.clear();
                w.frames.clear();
            }
            let drawn = match rt.s.templates.get("doc") {
                Some(doc) => rt.draw_nodes(m, &doc.view, &Env::default())?,
                None => Vec::new(),
            };
            // a widget that left the page leaves with its variables
            let mut w = rt.w();
            let gone: Vec<(u64, String)> = w.instances.values().filter(|i| !i.seen).map(|i| (i.id, i.path.clone())).collect();
            for (id, path) in gone {
                w.instances.remove(&id);
                // only its own: a widget of another kind may have taken its key this time
                if w.by_path.get(&path) == Some(&id) {
                    w.by_path.remove(&path);
                    w.memo.remove(&path);
                }
            }
            let seen = std::mem::take(&mut w.own_seen);
            w.own.retain(|k, _| seen.contains(k));
            w.own_seen = seen;
            let seen = std::mem::take(&mut w.extern_seen);
            w.extern_memo.retain(|k, _| seen.contains(k));
            w.extern_seen = seen;
            Ok(drawn)
        })?;
        self.drawn = drawn;
        self.revision += 1;
        for (_, l) in self.listeners.iter_mut() {
            l();
        }
        Ok(())
    }
}

/// A shader's name: a named fn is lowered to a lambda that calls it with its own parameters.
fn shader_name(f: &Value) -> String {
    let Value::Fn(c) = f else { return String::new() };
    let [Stmt::Return(r)] = c.body.as_slice() else { return String::new() };
    let Some(Expr::Call(call)) = &r.value else { return String::new() };
    let passes = call.args.len() == c.params.len() && call.args.iter().zip(c.params.iter()).all(|(a, p)| matches!(a, Expr::Get(ir::Get::Local(n)) if *n == p.name));
    if passes {
        call.name.clone()
    } else {
        String::new()
    }
}
