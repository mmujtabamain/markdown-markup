//! A page's Markdown nodes worked out into blocks: each widget's `markdown` with its inputs, its
//! own variables at their starting values, `$state` and the page's values as they are.

use std::cell::RefCell;
use std::collections::{BTreeMap, HashMap};
use std::rc::Rc;

use mkp_eval::interp::Outer;
use mkp_eval::value::ViewValue;
use mkp_eval::{FailKind, Host, Machine, Program, Value};
use mkp_ir::ir::{self, Expr, Node};

use crate::{join_runs, Align, Block, Inline, Item};

/// What went wrong writing the page.
#[derive(Debug)]
pub struct Failure(pub String);

type R<T> = Result<T, Failure>;

fn fail(e: mkp_eval::Failure) -> Failure {
    Failure(e.message)
}

/// Where a node's values are read: its widget instance and the locals around it.
#[derive(Clone, Default)]
struct Env {
    owner: Option<u64>,
    locals: Vec<(Rc<str>, Value)>,
}

/// One widget being written: its inputs, its own variables and its slots, with where they were
/// written.
#[derive(Default)]
struct Instance {
    inputs: HashMap<String, Value>,
    cells: HashMap<String, Value>,
    slots: HashMap<String, (Vec<Node>, Env)>,
}

#[derive(Default)]
struct Shared {
    instances: HashMap<u64, Instance>,
    state: HashMap<String, Value>,
    externs: HashMap<String, Value>,
    lets: HashMap<String, Value>,
    /// A slot read as a value: its nodes and where they were written, by the id its view holds.
    held: Vec<(Vec<Node>, Env)>,
}

const SLOT: &str = "#slot";

struct Page(Rc<RefCell<Shared>>);

impl Host for Page {
    fn read(&mut self, m: &mut Machine, what: &Outer, owner: Option<u64>) -> Result<Value, mkp_eval::Failure> {
        let mut sh = self.0.borrow_mut();
        let missing = |what: &Outer| mkp_eval::Failure::new(FailKind::Ir, format!("{:?} isn't known here", what));
        match what {
            Outer::State(n) => sh.state.get(&**n).cloned().ok_or_else(|| missing(what)),
            Outer::Extern(n) => sh.externs.get(&**n).cloned().ok_or_else(|| mkp_eval::Failure::new(FailKind::NotConstant, format!("`{}` is given when the page runs", n))),
            Outer::Let(n) => match m.prog.lets.get(&**n) {
                Some(v) => Ok(v.clone()),
                None => sh.lets.get(&**n).cloned().ok_or_else(|| missing(what)),
            },
            Outer::Input(n) => owner.and_then(|o| sh.instances.get(&o)).and_then(|i| i.inputs.get(&**n)).cloned().ok_or_else(|| missing(what)),
            Outer::Cell(n) => owner.and_then(|o| sh.instances.get(&o)).and_then(|i| i.cells.get(&**n)).cloned().ok_or_else(|| missing(what)),
            Outer::Slot(n) => {
                let held = owner.and_then(|o| sh.instances.get(&o)).and_then(|i| i.slots.get(&**n)).cloned();
                match held {
                    Some(h) => {
                        sh.held.push(h);
                        let id = sh.held.len() - 1;
                        let mut args = BTreeMap::new();
                        args.insert("id".to_string(), Value::Num(mkp_eval::Num::int(id as i64)));
                        Ok(Value::View(Rc::new(ViewValue { widget: Rc::from(SLOT), args, slots: BTreeMap::new(), events: BTreeMap::new(), exprs: BTreeMap::new(), captured: Vec::new(), owner: None })))
                    }
                    // a slot left empty
                    None => Ok(Value::none()),
                }
            }
        }
    }

    fn write(&mut self, _m: &mut Machine, what: &Outer, _owner: Option<u64>, _value: Value) -> Result<(), mkp_eval::Failure> {
        Err(mkp_eval::Failure::new(FailKind::NotConstant, format!("writing the page's Markdown changes nothing, so {:?} isn't written", what)))
    }
}

/// What one rendered node gives: blocks, or an item of the list around it.
enum Piece {
    Block(Block),
    Item(Item),
}

struct Writer<'p> {
    m: Machine<'p>,
    shared: Rc<RefCell<Shared>>,
    templates: HashMap<String, ir::Template>,
    externs: HashMap<String, ir::ExternWidget>,
    bindings: HashMap<String, Expr>,
    depth: usize,
}

fn get<'a>(v: &'a Value, field: &str) -> Option<&'a Value> {
    match v {
        Value::Record(r) => r.get(field),
        Value::Case(c) => c.values.iter().find(|(k, _)| &**k == field).map(|(_, x)| x),
        _ => None,
    }
}

fn text_of(v: Option<&Value>) -> String {
    match v {
        Some(Value::Text(t)) => t.to_string(),
        Some(Value::Num(n)) => n.show(),
        Some(Value::Opt(Some(x))) => text_of(Some(x)),
        _ => String::new(),
    }
}

fn items(v: Option<&Value>) -> Vec<Value> {
    match v {
        Some(Value::List(l)) => l.items.iter().map(|i| i.value.clone()).collect(),
        _ => Vec::new(),
    }
}

/// A template's text: its pieces with each hole's shown text between them (TeX, a template).
fn template_text(v: Option<&Value>) -> String {
    let Some(v) = v else { return String::new() };
    let pieces = items(get(v, "pieces"));
    let holes = items(get(v, "holes"));
    let mut out = String::new();
    for (k, p) in pieces.iter().enumerate() {
        out.push_str(&text_of(Some(p)));
        if let Some(h) = holes.get(k) {
            out.push_str(&text_of(get(h, "value")));
        }
    }
    out
}

impl<'p> Writer<'p> {
    fn eval(&mut self, env: &Env, e: &Expr) -> R<Value> {
        let e = match e {
            Expr::Bind(id) => self.bindings.get(id).cloned().ok_or_else(|| Failure(format!("no binding {}", id)))?,
            other => other.clone(),
        };
        self.m.eval_in(&env.locals, env.owner, &e).map_err(fail)
    }

    fn new_instance(&mut self, inst: Instance) -> u64 {
        let id = self.m.new_id();
        self.shared.borrow_mut().instances.insert(id, inst);
        id
    }

    fn nodes(&mut self, nodes: &[Node], env: &Env) -> R<Vec<Piece>> {
        let mut env = env.clone();
        let mut out = Vec::new();
        for n in nodes {
            match n {
                Node::Declare(d) => {
                    let v = self.eval(&env, &d.let_.value)?;
                    env.locals.push((Rc::from(d.let_.name.as_str()), v));
                }
                Node::For(f) => {
                    let over = self.eval(&env, &f.over)?;
                    let values = match &over {
                        Value::List(l) => l.items.iter().map(|i| i.value.clone()).collect(),
                        Value::Range(r) => self.m.walk_range(r).map_err(fail)?,
                        _ => Vec::new(),
                    };
                    for (k, v) in values.into_iter().enumerate() {
                        let mut inner = env.clone();
                        if let Some(p) = &f.position {
                            inner.locals.push((Rc::from(p.as_str()), Value::Num(mkp_eval::Num::int(k as i64))));
                        }
                        let v = if f.mutable { Value::some(v) } else { v };
                        inner.locals.push((Rc::from(f.name.as_str()), v));
                        out.extend(self.nodes(&f.body, &inner)?);
                    }
                }
                Node::If(i) => {
                    let mut done = false;
                    for b in &i.branches {
                        let mut inner = env.clone();
                        let pass = match &b.when {
                            ir::Cond::Cond(e) => matches!(self.eval(&env, e)?, Value::Bool(true)),
                            ir::Cond::Open(o) => match self.eval(&env, &o.opt)? {
                                Value::Opt(None) => false,
                                Value::Opt(Some(x)) => {
                                    inner.locals.push((Rc::from(o.name.as_str()), (*x).clone()));
                                    true
                                }
                                plain => {
                                    inner.locals.push((Rc::from(o.name.as_str()), plain));
                                    true
                                }
                            },
                        };
                        if pass {
                            out.extend(self.nodes(&b.then, &inner)?);
                            done = true;
                            break;
                        }
                    }
                    if !done {
                        out.extend(self.nodes(&i.else_, &env)?);
                    }
                }
                Node::Match(mt) => {
                    let v = self.eval(&env, &mt.value)?;
                    let mut done = false;
                    for c in &mt.cases {
                        let mut inner = env.clone();
                        if c.when.iter().any(|p| self.matches(&v, p, &mut inner)) {
                            out.extend(self.nodes(&c.then, &inner)?);
                            done = true;
                            break;
                        }
                    }
                    if !done {
                        out.extend(self.nodes(&mt.else_, &env)?);
                    }
                }
                Node::Place(p) => {
                    let v = self.eval(&env, &p.view)?;
                    out.extend(self.view(&v, &env)?);
                }
                Node::Extern(x) => out.extend(self.extern_call(x, &env)?),
                Node::Use(u) => out.extend(self.use_call(u, &env)?),
            }
        }
        Ok(out)
    }

    fn matches(&mut self, v: &Value, p: &ir::Pattern, env: &mut Env) -> bool {
        match (p, v) {
            (ir::Pattern::Case(pc), Value::Case(c)) if *c.name == *pc.name => {
                for (k, b) in pc.binds.iter().enumerate() {
                    if let Some((_, x)) = c.values.get(k) {
                        env.locals.push((Rc::from(b.as_str()), x.clone()));
                    }
                }
                true
            }
            (ir::Pattern::Case(pc), Value::Opt(o)) => match (pc.name.as_str(), o) {
                ("SOME", Some(x)) => {
                    if let Some(b) = pc.binds.first() {
                        env.locals.push((Rc::from(b.as_str()), (**x).clone()));
                    }
                    true
                }
                ("NONE", None) => true,
                _ => false,
            },
            (ir::Pattern::Num(n), Value::Num(x)) => mkp_eval::Num::parse(n).map_or(false, |n| self.m.equal(&Value::Num(n), &Value::Num(*x)).unwrap_or(false)),
            (ir::Pattern::Text(t), Value::Text(x)) => **x == **t,
            (ir::Pattern::Bool(b), Value::Bool(x)) => b == x,
            _ => false,
        }
    }

    /// A view held in a value: a slot's content, or a call made as a value.
    fn view(&mut self, v: &Value, env: &Env) -> R<Vec<Piece>> {
        match v {
            Value::View(view) if &*view.widget == SLOT => {
                let id = match view.args.get("id") {
                    Some(Value::Num(n)) => n.to_i64().unwrap_or(-1),
                    _ => -1,
                };
                let held = self.shared.borrow().held.get(id as usize).cloned();
                match held {
                    Some((nodes, at)) => self.nodes(&nodes, &at),
                    None => Ok(Vec::new()),
                }
            }
            Value::View(view) => {
                let props: BTreeMap<String, Value> = view.args.clone();
                // its slots are read where the view was made
                let mut at = Env { owner: view.owner.or(env.owner), locals: Vec::new() };
                for (n, b) in &view.captured {
                    at.locals.push((n.clone(), self.m.value_of(b).map_err(fail)?));
                }
                let slots: HashMap<String, (Vec<Node>, Env)> = view.slots.iter().map(|(k, n)| (k.clone(), (n.clone(), at.clone()))).collect();
                self.widget(&view.widget, props, slots)
            }
            Value::Opt(Some(x)) => self.view(&x.clone(), env),
            _ => Ok(Vec::new()),
        }
    }

    fn extern_call(&mut self, x: &ir::NodeExtern, env: &Env) -> R<Vec<Piece>> {
        let mut props = BTreeMap::new();
        for (k, e) in &x.props {
            props.insert(k.clone(), self.eval(env, e)?);
        }
        for (k, p) in &x.writes {
            props.insert(k.clone(), self.eval(env, &Expr::Place(p.clone()))?);
        }
        let slots: HashMap<String, (Vec<Node>, Env)> = x.slots.iter().map(|(k, n)| (k.clone(), (n.clone(), env.clone()))).collect();
        self.widget(&x.name, props, slots)
    }

    fn use_call(&mut self, u: &ir::NodeUse, env: &Env) -> R<Vec<Piece>> {
        let mut props = BTreeMap::new();
        for (k, e) in &u.args {
            props.insert(k.clone(), self.eval(env, e)?);
        }
        let slots: HashMap<String, (Vec<Node>, Env)> = u.slots.iter().map(|(k, n)| (k.clone(), (n.clone(), env.clone()))).collect();
        self.widget(&u.name, props, slots)
    }

    /// A widget, given its inputs' values and its slots: Markdown's own blocks are written
    /// directly; any other widget writes its `markdown`.
    fn widget(&mut self, name: &str, props: BTreeMap<String, Value>, slots: HashMap<String, (Vec<Node>, Env)>) -> R<Vec<Piece>> {
        self.depth += 1;
        if self.depth > 64 {
            self.depth -= 1;
            return Err(Failure(format!("`{}` places itself more than 64 deep", name)));
        }
        let out = self.widget_inner(name, props, slots);
        self.depth -= 1;
        out
    }

    fn slot_blocks(&mut self, slots: &HashMap<String, (Vec<Node>, Env)>, name: &str) -> R<Vec<Piece>> {
        match slots.get(name) {
            Some((nodes, env)) => {
                let (nodes, env) = (nodes.clone(), env.clone());
                self.nodes(&nodes, &env)
            }
            None => Ok(Vec::new()),
        }
    }

    fn widget_inner(&mut self, name: &str, props: BTreeMap<String, Value>, slots: HashMap<String, (Vec<Node>, Env)>) -> R<Vec<Piece>> {
        let p = |k: &str| props.get(k);
        let block = |b: Block| Ok(vec![Piece::Block(b)]);
        match name {
            "core/paragraph" => {
                let runs = self.inline(p("value"))?;
                return if runs.is_empty() { Ok(Vec::new()) } else { block(Block::Paragraph(runs)) };
            }
            "core/heading" => {
                let level = match p("level") {
                    Some(Value::Num(n)) => n.to_i64().unwrap_or(1).clamp(1, 6) as u8,
                    _ => 1,
                };
                let inline = self.inline(p("value"))?;
                return block(Block::Heading { level, inline });
            }
            "core/bullets" => {
                let ordered = matches!(p("ordered"), Some(Value::Bool(true)));
                let start = match p("start") {
                    Some(Value::Num(n)) => n.to_i64().unwrap_or(1),
                    _ => 1,
                };
                let pieces = self.slot_blocks(&slots, "items")?;
                let items: Vec<Item> = pieces
                    .into_iter()
                    .map(|x| match x {
                        Piece::Item(i) => i,
                        Piece::Block(b) => Item { done: None, blocks: vec![b] },
                    })
                    .collect();
                // a list with no items writes nothing
                return if items.is_empty() { Ok(Vec::new()) } else { block(Block::Bullets { ordered, start, items }) };
            }
            "core/item" => {
                let done = match p("done") {
                    Some(Value::Opt(Some(d))) => d.as_bool(),
                    Some(Value::Bool(b)) => Some(*b),
                    _ => None,
                };
                let blocks = blocks_of(self.slot_blocks(&slots, "body")?);
                return Ok(vec![Piece::Item(Item { done, blocks })]);
            }
            "core/quote" => {
                let blocks = blocks_of(self.slot_blocks(&slots, "body")?);
                return block(Block::Quote(blocks));
            }
            "core/code" => return block(Block::Code { lang: text_of(p("lang")), src: text_of(p("src")) }),
            "core/math" => return block(Block::Math(template_text(p("tex").and_then(|t| get(t, "tex"))))),
            "core/divider" => return block(Block::Divider),
            "core/footnote" => {
                let blocks = blocks_of(self.slot_blocks(&slots, "body")?);
                return block(Block::Footnote { mark: text_of(p("mark")), blocks });
            }
            "core/table" => {
                let mut head = Vec::new();
                for c in items(p("head")) {
                    head.push(self.inline(Some(&c))?);
                }
                let mut rows = Vec::new();
                for r in items(p("rows")) {
                    let mut row = Vec::new();
                    for c in items(Some(&r)) {
                        row.push(self.inline(Some(&c))?);
                    }
                    rows.push(row);
                }
                let align = items(p("align"))
                    .iter()
                    .map(|a| match a {
                        Value::Case(c) if &*c.name == "CENTER" => Align::Center,
                        Value::Case(c) if &*c.name == "END" => Align::End,
                        _ => Align::Start,
                    })
                    .collect();
                return block(Block::Table { head, rows, align });
            }
            _ => {}
        }
        // a widget written in MKP: its markdown, with its inputs and its own variables
        if let Some(t) = self.templates.get(name).cloned() {
            let id = self.new_instance(Instance::default());
            let env = Env { owner: Some(id), locals: Vec::new() };
            let mut inputs = HashMap::new();
            for f in &t.inputs {
                let v = match props.get(&f.name) {
                    Some(v) => v.clone(),
                    None => match &f.default {
                        Some(d) => self.eval(&env, d)?,
                        None => Value::none(),
                    },
                };
                inputs.insert(f.name.clone(), v);
            }
            {
                let mut sh = self.shared.borrow_mut();
                let inst = sh.instances.get_mut(&id).unwrap();
                inst.inputs = inputs;
                inst.slots = slots;
            }
            for c in &t.cells {
                let v = match &c.default {
                    Some(d) => self.eval(&env, d)?,
                    None => Value::none(),
                };
                self.shared.borrow_mut().instances.get_mut(&id).unwrap().cells.insert(c.name.clone(), v);
            }
            return self.nodes(&t.markdown, &env);
        }
        // an extern widget: its markdown block, with its inputs
        if let Some(w) = self.externs.get(name).cloned() {
            let id = self.new_instance(Instance { slots, ..Instance::default() });
            let env = Env { owner: Some(id), locals: Vec::new() };
            for f in &w.inputs {
                let v = match props.get(&f.name) {
                    Some(v) => v.clone(),
                    None => match &f.default {
                        Some(d) => self.eval(&env, d)?,
                        None => Value::none(),
                    },
                };
                self.shared.borrow_mut().instances.get_mut(&id).unwrap().inputs.insert(f.name.clone(), v);
            }
            return self.nodes(&w.markdown, &env);
        }
        Err(Failure(format!("there is no widget `{}` to write", name)))
    }

    /// A rich text's segments as runs; a view in a sentence puts its own Markdown's text there.
    fn inline(&mut self, v: Option<&Value>) -> R<Vec<Inline>> {
        let Some(v) = v else { return Ok(Vec::new()) };
        let mut out = Vec::new();
        for seg in items(get(v, "segments")) {
            let Some(part @ Value::Case(c)) = get(&seg, "part") else { continue };
            let marks = get(&seg, "marks");
            let flag = |n: &str| matches!(marks.and_then(|m| get(m, n)), Some(Value::Bool(true)));
            let link = match marks.and_then(|m| get(m, "link")) {
                Some(Value::Opt(Some(l))) => Some(text_of(Some(l))),
                _ => None,
            };
            let text = |value: String| Inline::Text { value, bold: flag("bold"), italic: flag("italic"), strike: flag("strike"), link: link.clone() };
            match &*c.name {
                "TEXT" => out.push(text(text_of(get(part, "value")))),
                "CODE" => out.push(Inline::Code(text_of(get(part, "value")))),
                "MATH" => out.push(Inline::Math(template_text(get(part, "tex").and_then(|t| get(t, "tex"))))),
                "IMAGE" => out.push(Inline::Image { src: text_of(get(part, "src")), alt: text_of(get(part, "alt")) }),
                "NOTE" => out.push(Inline::Note(text_of(get(part, "mark")))),
                "BREAK" => out.push(Inline::Break),
                "VIEW" => {
                    let child = get(part, "child").cloned().unwrap_or(Value::none());
                    let blocks = blocks_of(self.view(&child, &Env::default())?);
                    let words: Vec<String> = blocks.iter().map(plain).filter(|s| !s.is_empty()).collect();
                    out.push(text(words.join(" ")));
                }
                _ => {}
            }
        }
        Ok(join_runs(out))
    }
}

/// A block's words, for a view placed in a sentence.
fn plain(b: &Block) -> String {
    let runs = |r: &[Inline]| {
        r.iter()
            .map(|i| match i {
                Inline::Text { value, .. } | Inline::Code(value) | Inline::Math(value) => value.clone(),
                Inline::Image { alt, .. } => alt.clone(),
                _ => String::new(),
            })
            .collect::<String>()
    };
    match b {
        Block::Paragraph(r) | Block::Heading { inline: r, .. } => runs(r),
        Block::Quote(bs) => bs.iter().map(plain).collect::<Vec<_>>().join(" "),
        _ => String::new(),
    }
}

/// Pieces as blocks: list items that follow one another make one list, across a loop's turns
/// too, and any other block ends it (page 3).
fn blocks_of(pieces: Vec<Piece>) -> Vec<Block> {
    let mut out: Vec<Block> = Vec::new();
    for p in pieces {
        let b = match p {
            Piece::Block(b) => b,
            Piece::Item(i) => Block::Bullets { ordered: false, start: 1, items: vec![i] },
        };
        if let (Some(Block::Bullets { ordered: o1, items: i1, .. }), Block::Bullets { ordered: o2, items: i2, .. }) = (out.last_mut(), &b) {
            if *o1 == *o2 {
                i1.extend(i2.iter().cloned());
                continue;
            }
        }
        out.push(b);
    }
    out
}

/// The page's Markdown, with the values it starts with: a document's own, or for a pack, nothing.
pub fn page(m: &ir::Module) -> R<Vec<Block>> {
    let mut prog = Program::from_module(m);
    for t in &m.templates {
        for f in &t.fns {
            prog.fns.insert(f.name.clone(), Rc::new(f.clone()));
        }
    }
    let shared = Rc::new(RefCell::new(Shared::default()));
    let mut w = Writer {
        m: Machine::new(&prog, Box::new(Page(shared.clone()))),
        shared: shared.clone(),
        templates: m.templates.iter().map(|t| (t.name.clone(), t.clone())).collect(),
        externs: HashMap::new(),
        bindings: m.bindings.iter().map(|b| (b.id.clone(), b.value.clone())).collect(),
        depth: 0,
    };
    let none = Env::default();
    // the page's values, $state's starting values, then lets that read them
    for d in &m.declarations {
        match &d.declare {
            ir::Decl::Extern(ir::Extern::Widget(x)) => {
                w.externs.insert(x.name.clone(), x.clone());
            }
            ir::Decl::Extern(ir::Extern::Channel(c)) => {
                for f in &c.values {
                    if let Some(v) = f.default.as_ref().and_then(|d| w.eval(&none, d).ok()) {
                        shared.borrow_mut().externs.insert(format!("{}.{}", c.name, f.name), v);
                    }
                }
            }
            _ => {}
        }
    }
    for d in &m.declarations {
        if let ir::Decl::State(s) = &d.declare {
            for f in &s.fields {
                if let Some(v) = f.default.as_ref().and_then(|d| w.eval(&none, d).ok()) {
                    shared.borrow_mut().state.insert(f.name.clone(), v);
                }
            }
        }
    }
    for d in &m.declarations {
        if let ir::Decl::Let(l) = &d.declare {
            if let Ok(v) = w.eval(&none, &l.value) {
                shared.borrow_mut().lets.insert(l.name.clone(), v);
            }
        }
    }
    let Some(doc) = m.templates.iter().find(|t| t.name == "doc").cloned() else { return Ok(Vec::new()) };
    let pieces = w.nodes(&doc.markdown, &none)?;
    Ok(blocks_of(pieces))
}

