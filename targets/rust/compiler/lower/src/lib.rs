//! Lowering (plan tab 10): the part of the IR a runtime runs.
//!
//! Every prop that isn't constant becomes a binding: its expression and the set of things it
//! reads (cells, inputs, `$state` fields, lets, extern values). The set is never too small. A
//! local stands for what it was opened from or walks, and a call reads what its fn reads; where
//! the fn can't be known exactly, every fn of that name counts, so a binding may update too
//! often but never too rarely.

use std::collections::{BTreeSet, HashMap};

use mkp_ir::ir::{self, Expr, Node};
use serde_json::Value;

/// What each fn reads beyond its own parameters, across the fns it calls.
struct Fns {
    reads: HashMap<String, BTreeSet<String>>,
}

impl Fns {
    fn new(m: &ir::Module) -> Fns {
        // each fn's own reads and the fns it calls
        let mut own: HashMap<String, (BTreeSet<String>, BTreeSet<String>)> = HashMap::new();
        let mut add = |name: &str, body: Value| {
            let mut reads = BTreeSet::new();
            let mut calls = BTreeSet::new();
            scan(&body, &HashMap::new(), &mut reads, &mut calls, true);
            own.insert(name.to_string(), (reads, calls));
        };
        for d in &m.declarations {
            match &d.declare {
                ir::Decl::Fn(f) => add(&f.name, serde_json::to_value(&f.body).unwrap()),
                ir::Decl::Extern(ir::Extern::Fn(f)) => add(&f.name, serde_json::to_value(&f.default).unwrap()),
                ir::Decl::Let(l) => add(&format!("let:{}", l.name), serde_json::to_value(&l.value).unwrap()),
                _ => {}
            }
        }
        for t in &m.templates {
            for f in &t.fns {
                add(&f.name, serde_json::to_value(&f.body).unwrap());
            }
        }
        // across calls, until nothing more is learned
        let mut reads: HashMap<String, BTreeSet<String>> = own.iter().map(|(k, v)| (k.clone(), v.0.clone())).collect();
        loop {
            let mut changed = false;
            for (f, (_, calls)) in &own {
                let mut more = BTreeSet::new();
                for c in calls {
                    for g in targets(c, &own) {
                        if let Some(r) = reads.get(&g) {
                            more.extend(r.iter().cloned());
                        }
                    }
                }
                let mine = reads.get_mut(f).unwrap();
                let before = mine.len();
                mine.extend(more);
                changed |= mine.len() != before;
            }
            if !changed {
                break;
            }
        }
        Fns { reads }
    }

    fn of(&self, call: &str) -> BTreeSet<String> {
        let mut out = BTreeSet::new();
        for g in targets(call, &self.reads) {
            if let Some(r) = self.reads.get(&g) {
                out.extend(r.iter().cloned());
            }
        }
        out
    }
}

/// The fns a call may reach: the one of that name, or, when no fn has it (an interface's fn,
/// sent to each type's), every fn of the same short name.
fn targets<V>(call: &str, fns: &HashMap<String, V>) -> Vec<String> {
    if fns.contains_key(call) {
        return vec![call.to_string()];
    }
    let short = call.rsplit('.').next().unwrap_or(call);
    fns.keys().filter(|k| k.rsplit('.').next() == Some(short)).cloned().collect()
}

/// The reads in a value written as JSON: every `get` and every place's root, a local standing
/// for what it was opened from; and every fn it calls.
fn scan(v: &Value, locals: &HashMap<String, BTreeSet<String>>, reads: &mut BTreeSet<String>, calls: &mut BTreeSet<String>, in_fn: bool) {
    match v {
        Value::Object(o) => {
            for (k, x) in o {
                match (k.as_str(), x) {
                    ("get", Value::Object(g)) | ("root", Value::Object(g)) => {
                        for (kind, name) in g {
                            let name = name.as_str().unwrap_or("");
                            match kind.as_str() {
                                "local" => match locals.get(name) {
                                    Some(r) => reads.extend(r.iter().cloned()),
                                    // a fn's own parameter or local: nothing outside it
                                    None if in_fn => {}
                                    None => {
                                        reads.insert(format!("local:{}", name));
                                    }
                                },
                                "token" => {}
                                "let" => {
                                    reads.insert(format!("let:{}", name));
                                }
                                other => {
                                    reads.insert(format!("{}:{}", other, name));
                                }
                            }
                        }
                    }
                    ("call", Value::Object(c)) => {
                        if let Some(n) = c.get("name").and_then(|n| n.as_str()) {
                            calls.insert(n.to_string());
                        }
                        scan(x, locals, reads, calls, in_fn);
                    }
                    _ => scan(x, locals, reads, calls, in_fn),
                }
            }
        }
        Value::Array(a) => {
            for x in a {
                scan(x, locals, reads, calls, in_fn);
            }
        }
        _ => {}
    }
}

struct Lower<'f> {
    fns: &'f Fns,
    /// Lets whose value is a constant: reading one reads nothing.
    constant_lets: BTreeSet<String>,
    bindings: Vec<ir::Binding>,
}

impl<'f> Lower<'f> {
    /// Everything an expression reads, here.
    fn reads(&self, e: &Expr, locals: &HashMap<String, BTreeSet<String>>) -> BTreeSet<String> {
        let mut reads = BTreeSet::new();
        let mut calls = BTreeSet::new();
        scan(&serde_json::to_value(e).unwrap(), locals, &mut reads, &mut calls, false);
        for c in &calls {
            reads.extend(self.fns.of(c));
        }
        // a let that is a constant reads nothing; one that isn't reads what its value reads
        let lets: Vec<String> = reads.iter().filter(|r| r.starts_with("let:")).cloned().collect();
        for l in lets {
            let name = &l["let:".len()..];
            if self.constant_lets.contains(name) {
                reads.remove(&l);
            } else {
                reads.extend(self.fns.of(&l));
            }
        }
        reads
    }

    /// A prop: a constant stays as it is; anything else becomes a binding.
    fn prop(&mut self, e: &mut Expr, locals: &HashMap<String, BTreeSet<String>>) {
        if matches!(e, Expr::Place(_) | Expr::Bind(_) | Expr::Fn(_)) {
            return;
        }
        let reads = self.reads(e, locals);
        if reads.is_empty() {
            return;
        }
        let id = format!("b{}", self.bindings.len() + 1);
        let value = std::mem::replace(e, Expr::Bind(id.clone()));
        self.bindings.push(ir::Binding { id, value, reads: reads.into_iter().collect() });
    }

    fn nodes(&mut self, nodes: &mut [Node], locals: &mut HashMap<String, BTreeSet<String>>) {
        for n in nodes.iter_mut() {
            match n {
                Node::Extern(x) => {
                    for v in x.props.values_mut() {
                        self.prop(v, locals);
                    }
                    for body in x.slots.values_mut() {
                        self.nodes(body, &mut locals.clone());
                    }
                }
                Node::Use(u) => {
                    for v in u.args.values_mut() {
                        self.prop(v, locals);
                    }
                    for body in u.slots.values_mut() {
                        self.nodes(body, &mut locals.clone());
                    }
                }
                Node::For(f) => {
                    let mut inner = locals.clone();
                    let over = self.reads(&f.over, locals);
                    inner.insert(f.name.clone(), over.clone());
                    if let Some(p) = &f.position {
                        inner.insert(p.clone(), over);
                    }
                    self.nodes(&mut f.body, &mut inner);
                }
                Node::If(i) => {
                    for b in &mut i.branches {
                        let mut inner = locals.clone();
                        if let ir::Cond::Open(o) = &b.when {
                            let r = self.reads(&o.opt, locals);
                            inner.insert(o.name.clone(), r);
                        }
                        self.nodes(&mut b.then, &mut inner);
                    }
                    self.nodes(&mut i.else_, &mut locals.clone());
                }
                Node::Match(m) => {
                    let r = self.reads(&m.value, locals);
                    for c in &mut m.cases {
                        let mut inner = locals.clone();
                        for p in &c.when {
                            if let ir::Pattern::Case(pc) = p {
                                for b in &pc.binds {
                                    inner.insert(b.clone(), r.clone());
                                }
                            }
                        }
                        self.nodes(&mut c.then, &mut inner);
                    }
                    self.nodes(&mut m.else_, &mut locals.clone());
                }
                Node::Declare(d) => {
                    let r = self.reads(&d.let_.value, locals);
                    locals.insert(d.let_.name.clone(), r);
                }
                Node::Place(_) => {}
            }
        }
    }
}

/// Lowers a checked module: every prop that isn't constant becomes a binding.
pub fn lower(m: &mut ir::Module) {
    let fns = Fns::new(m);
    let constant_lets: BTreeSet<String> = m
        .declarations
        .iter()
        .filter_map(|d| match &d.declare {
            ir::Decl::Let(l) if fns.reads.get(&format!("let:{}", l.name)).map_or(true, |r| r.is_empty()) => Some(l.name.clone()),
            _ => None,
        })
        .collect();
    let mut lw = Lower { fns: &fns, constant_lets, bindings: Vec::new() };
    let mut templates = std::mem::take(&mut m.templates);
    for t in &mut templates {
        lw.nodes(&mut t.view, &mut HashMap::new());
        lw.nodes(&mut t.markdown, &mut HashMap::new());
    }
    m.templates = templates;
    m.bindings = lw.bindings;
}
