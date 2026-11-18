//! Lowering (plan tab 10): the part of the IR a runtime runs.
//!
//! Every prop that isn't constant becomes a binding: its expression and the set of things it
//! reads (cells, inputs, `$state` fields, lets, extern values). The set is never too small. A
//! local stands for what it was opened from or walks, and a call reads what its fn reads; where
//! the fn can't be known exactly, every fn of that name counts, so a binding may update too
//! often but never too rarely.

use std::collections::{BTreeSet, HashMap, HashSet};

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

/// Lowers a checked module: every prop that isn't constant becomes a binding, and a page keeps
/// only what it uses.
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
    // a page's IR is what the page uses; a pack's keeps all it declares and builds on
    if m.module == "doc" {
        prune(m);
    }
}

/// Core's extern fns an implementer is told to build on other fns of core.
const BUILDS_ON: &[(&str, &[&str])] = &[("core/moment.local", &["core/moment.utc", "core/moment_at"])];

/// A page's IR (a document's, module `doc`) holds only what the page uses: the document's own
/// widget and declarations, and the declarations, widgets written in MKP, bindings and handlers
/// they reach, and what those reach in turn. The IR names everything it refers to in full
/// (`core/press`, `core/list.some`, a binding's `b4`), so a string that is one, or a member of one
/// (`core/page.width`), is a use of it; and a type kept keeps the fns a runtime finds by its name.
/// `needs` then lists only what is kept. Every token type is kept, as a target styles a page from
/// its tokens by name, and so is a declaration with no name of its own.
pub fn prune(m: &mut ir::Module) {
    // every part that can be left out, as JSON, with what it is called
    let mut parts: Vec<(String, Value)> = Vec::new();
    for d in &m.declarations {
        let v = serde_json::to_value(d).unwrap_or(Value::Null);
        parts.push((declared_name(&v).unwrap_or_default(), v));
    }
    let decl_count = parts.len();
    for t in &m.templates {
        parts.push((t.name.clone(), serde_json::to_value(t).unwrap_or(Value::Null)));
    }
    for b in &m.bindings {
        parts.push((b.id.clone(), serde_json::to_value(b).unwrap_or(Value::Null)));
    }
    for h in &m.handlers {
        parts.push((h.id.clone(), serde_json::to_value(h).unwrap_or(Value::Null)));
    }
    let index: HashMap<&str, Vec<usize>> = parts.iter().enumerate().filter(|(_, (n, _))| !n.is_empty()).fold(HashMap::new(), |mut acc, (k, (n, _))| {
        acc.entry(n.as_str()).or_default().push(k);
        acc
    });
    let mut keep = vec![false; parts.len()];
    let mut todo: Vec<usize> = Vec::new();
    let own = format!("{}/", m.module);
    for (k, (n, _)) in parts.iter().enumerate() {
        // a target styles a page from its tokens by name (`--mkp-color-ok`), whether the page names one or not
        let token = k < decl_count && matches!(m.declarations[k].declare, ir::Decl::Token(_));
        let root = if k < decl_count { token || n.is_empty() || n.starts_with(&own) } else { n == &m.module };
        if root {
            keep[k] = true;
            todo.push(k);
        }
    }
    // a type a page keeps brings the fns a runtime finds by the value's type: `show` for a hole,
    // `same` and `before` for == and <, and the fns of each interface the page calls, which a call
    // sends to the value's own type
    let mut by_type: HashSet<String> = ["show", "same", "before"].iter().map(|f| f.to_string()).collect();
    let mut methods: HashMap<&str, Vec<(String, usize)>> = HashMap::new();
    for (k, (n, _)) in parts.iter().enumerate().take(decl_count) {
        if let Some((ty, f)) = n.rsplit_once('.') {
            methods.entry(ty).or_default().push((f.to_string(), k));
        }
    }
    // what an implementer builds a core extern fn on, which it calls by name (page 5)
    let builds_on: HashMap<&str, &[&str]> = BUILDS_ON.iter().copied().collect();
    let interfaces: HashMap<usize, Vec<String>> = m.declarations.iter().enumerate().filter_map(|(k, d)| if let ir::Decl::Interface(i) = &d.declare { Some((k, i.fns.clone())) } else { None }).collect();
    loop {
        while let Some(k) = todo.pop() {
            uses(&parts[k].1, &index, &mut keep, &mut todo);
            if let Some(fns) = interfaces.get(&k) {
                by_type.extend(fns.iter().cloned());
            }
            for n in builds_on.get(parts[k].0.as_str()).into_iter().flat_map(|ns| ns.iter()) {
                for &j in index.get(n).into_iter().flatten() {
                    if !keep[j] {
                        keep[j] = true;
                        todo.push(j);
                    }
                }
            }
            for (f, m) in methods.get(parts[k].0.as_str()).into_iter().flatten() {
                if by_type.contains(f) && !keep[*m] {
                    keep[*m] = true;
                    todo.push(*m);
                }
            }
        }
        // an interface met late: the types kept before it bring its fns too
        for (k, (n, _)) in parts.iter().enumerate().take(decl_count) {
            if !keep[k] {
                continue;
            }
            for (f, m) in methods.get(n.as_str()).into_iter().flatten() {
                if by_type.contains(f) && !keep[*m] {
                    keep[*m] = true;
                    todo.push(*m);
                }
            }
        }
        if todo.is_empty() {
            break;
        }
    }
    let kept: HashSet<String> = parts.iter().zip(&keep).filter(|(_, k)| **k).map(|((n, _), _)| n.clone()).collect();
    let mut k = 0;
    let mut next = || {
        k += 1;
        keep[k - 1]
    };
    m.declarations.retain(|_| next());
    m.templates.retain(|_| next());
    m.bindings.retain(|_| next());
    m.handlers.retain(|_| next());
    m.needs.core.retain(|n| kept.contains(n));
    for p in &mut m.needs.packs {
        p.externs.retain(|n| kept.contains(n));
    }
    m.needs.packs.retain(|p| !p.externs.is_empty());
}

/// A declaration's full name: the `name` of the one kind it is (`{ "declare": { "fn": { "name" } } }`,
/// or one more level down for an extern's).
fn declared_name(d: &Value) -> Option<String> {
    let mut v = d.get("declare")?;
    for _ in 0..3 {
        let o = v.as_object()?;
        if let Some(Value::String(n)) = o.get("name") {
            return Some(n.clone());
        }
        if o.len() != 1 {
            return None;
        }
        v = o.values().next()?;
    }
    None
}

/// Every part a value names, marked to keep, and queued to be read in turn.
fn uses(v: &Value, index: &HashMap<&str, Vec<usize>>, keep: &mut [bool], todo: &mut Vec<usize>) {
    match v {
        Value::String(s) => {
            // a name, a binding's read of one (`extern:core/page.width`), and a member's owner
            // (`core/page` of `core/page.width`, a channel whose values a page reads)
            let name = s.split_once(':').map_or(s.as_str(), |(_, n)| n);
            let owner = name.rsplit_once('.').map(|(o, _)| o);
            for n in [Some(s.as_str()), Some(name), owner].into_iter().flatten() {
                for &k in index.get(n).into_iter().flatten() {
                    if !keep[k] {
                        keep[k] = true;
                        todo.push(k);
                    }
                }
            }
        }
        Value::Array(xs) => xs.iter().for_each(|x| uses(x, index, keep, todo)),
        Value::Object(o) => o.values().for_each(|x| uses(x, index, keep, todo)),
        _ => {}
    }
}
