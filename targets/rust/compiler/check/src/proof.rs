//! Contracts and proofs (page 2): what the checker knows of a value, and whether that is enough
//! where a contract is wanted. Bounds are constants, so a proof is settled once the constants
//! are worked out. A value with no proof is then worked out itself: a constant is checked on its
//! own line, and anything else is an error that asks for a proof.

use std::collections::HashMap;

use xtmd_eval::interp::Constants;
use xtmd_eval::{Machine, Num, Program, Value};
use xtmd_ir::ir;
use xtmd_syntax::Span;

use crate::{codes, Checker};

/// What the checker knows of a value: facts that all hold. Each is worked out with the
/// constants; one that can't be (a bound that isn't a constant) tells nothing.
#[derive(Clone, Debug, Default)]
pub struct Known {
    /// Declared types: their contracts, their aliases' and their items'.
    pub types: Vec<ir::Type>,
    /// The expression itself: exact, when it is a constant.
    pub value: Option<ir::Expr>,
    /// A whole number: `round`, `floor`, `ceil`, a position.
    pub whole: bool,
    /// Whole when each of these is: whole-number arithmetic, `clamp`.
    pub whole_if: Vec<Known>,
    /// From the lowest value of this: `clamp`'s low bound, `x in low..high`.
    pub low_of: Option<Box<Known>>,
    /// To the highest value of this.
    pub high_of: Option<Box<Known>>,
    /// A whole number of steps from a start, both constants: a range loop, `x in a..b step s`.
    pub steps: Option<(ir::Expr, ir::Expr)>,
    /// In the length range of this value: `len()`.
    pub length_of: Option<Box<Known>>,
    /// A length from the lowest value of this, to the highest of that: `x.len() in low..high`.
    pub len_low_of: Option<Box<Known>>,
    pub len_high_of: Option<Box<Known>>,
    /// Exactly this many items: a list literal.
    pub len_exact: Option<usize>,
    /// What each item is known to be.
    pub items: Option<Box<Known>>,
    /// An item of this list, or the value inside this opt: a loop's variable, `xs[i]`'s inside.
    pub item_of: Option<Box<Known>>,
    /// An `opt` holding a value known as this: `xs[i]`, `list<T>.last()` for a known `T`.
    pub opt_of: Option<Box<Known>>,
    /// `? :`: what covers both sides.
    pub either: Option<Box<(Known, Known)>>,
    /// Facts added later: `if (x in 0..100)` inside its block.
    pub also: Vec<Known>,
}

impl Known {
    pub fn of(t: &ir::Type) -> Known {
        Known { types: vec![t.clone()], ..Known::default() }
    }

    pub fn value(x: &ir::Expr) -> Known {
        Known { value: Some(x.clone()), ..Known::default() }
    }

    pub fn whole() -> Known {
        Known { whole: true, ..Known::default() }
    }

    pub fn and(mut self, o: Known) -> Known {
        self.also.push(o);
        self
    }
}

/// A proof wanted where a value meets a contract.
#[derive(Clone, Debug)]
pub struct Proof {
    pub file: usize,
    pub span: Span,
    /// The value, worked out when nothing else proves it; `None` for a variable shared with a
    /// `mut` input, which has to be proved by its own contract.
    pub value: Option<ir::Expr>,
    pub want: ir::Type,
    pub known: Known,
    /// Where the value goes, for messages: "`level`", "the return value".
    pub what: String,
}

/// A value's range, steps, length, allowed values and items, worked out.
#[derive(Clone, Debug, Default)]
struct Shape {
    low: Option<Value>,
    high: Option<Value>,
    /// A whole number of `step`s from `from`: `int` is (0, 1).
    steps: Option<(Num, Num)>,
    len_low: Option<i64>,
    len_high: Option<i64>,
    only: Option<Vec<Value>>,
    /// A list's items, or the value inside an `opt`.
    item: Option<Box<Shape>>,
    opt: bool,
}

impl Shape {
    fn says_anything(&self) -> bool {
        self.low.is_some() || self.high.is_some() || self.steps.is_some() || self.len_low.is_some() || self.len_high.is_some() || self.only.is_some() || self.item.as_ref().map_or(false, |i| i.says_anything())
    }

    fn is_whole(&self) -> bool {
        self.steps.as_ref().map_or(false, |(f, s)| f.is_int() && s.is_int())
    }
}

/// Whether every value of `from + k * step` is also one of `wfrom + k * wstep`.
fn steps_within(from: Num, step: Num, wfrom: Num, wstep: Num) -> bool {
    if wstep.is_zero() {
        return step.is_zero() && from.sub(wfrom).map_or(false, |d| d.is_zero());
    }
    let ratio = step.div(wstep).map_or(false, |r| r.is_int());
    let offset = from.sub(wfrom).and_then(|d| d.div(wstep)).map_or(false, |r| r.is_int());
    ratio && offset
}

struct Solver<'p> {
    m: Machine<'p>,
    aliases: HashMap<String, ir::Type>,
}

impl<'p> Solver<'p> {
    fn eval(&mut self, x: &ir::Expr) -> Option<Value> {
        self.m.eval(x).ok()
    }

    fn num(&mut self, x: &ir::Expr) -> Option<Num> {
        self.eval(x).and_then(|v| v.as_num())
    }

    fn lower(&mut self, a: &Value, b: &Value) -> bool {
        self.m.before(a, b).unwrap_or(false)
    }

    fn same(&mut self, a: &Value, b: &Value) -> bool {
        self.m.equal(a, b).unwrap_or(false)
    }

    /// A declared type's shape: its contract, its aliases', and its items' or inner value's.
    fn of_type(&mut self, t: &ir::Type) -> Shape {
        let mut s = Shape::default();
        let mut t = t.clone();
        for _ in 0..16 {
            if let Some(c) = t.contract.clone() {
                let c = self.of_contract(&c);
                s = self.meet(s, c);
            }
            match self.aliases.get(&t.name) {
                Some(next) => t = next.clone(),
                None => break,
            }
        }
        match t.name.as_str() {
            "core/list" => {
                if let Some(a) = t.args.first() {
                    let i = self.of_type(a);
                    if i.says_anything() {
                        s.item = Some(Box::new(i));
                    }
                }
            }
            "core/opt" => {
                s.opt = true;
                if let Some(a) = t.args.first() {
                    let i = self.of_type(a);
                    s.item = Some(Box::new(i));
                }
            }
            _ => {}
        }
        s
    }

    fn of_contract(&mut self, c: &ir::Contract) -> Shape {
        let mut s = Shape::default();
        if let Some(r) = &c.range {
            s.low = r.low.as_ref().and_then(|x| self.eval(x));
            s.high = r.high.as_ref().and_then(|x| self.eval(x));
        }
        if let Some(step) = &c.step {
            let from = match c.range.as_ref().and_then(|r| r.low.as_ref()) {
                Some(l) => self.num(l),
                None => Some(Num::zero()),
            };
            if let (Some(f), Some(st)) = (from, self.num(step)) {
                s.steps = Some((f, st));
            }
        }
        if let Some(l) = &c.length {
            s.len_low = l.low.as_ref().and_then(|x| self.num(x)).and_then(|n| n.to_i64());
            s.len_high = l.high.as_ref().and_then(|x| self.num(x)).and_then(|n| n.to_i64());
        }
        if !c.only.is_empty() {
            let vals: Vec<Value> = c.only.iter().filter_map(|x| self.eval(x)).collect();
            if vals.len() == c.only.len() {
                s.only = Some(vals);
            }
        }
        s
    }

    /// A constant's shape: exactly itself.
    fn exact(&mut self, v: &Value) -> Shape {
        let mut s = Shape::default();
        if let Some(n) = v.as_num() {
            if n.is_int() {
                s.steps = Some((Num::zero(), Num::int(1)));
            } else {
                s.steps = Some((n, Num::zero()));
            }
        }
        match v {
            Value::Num(_) | Value::Duration(_) => {
                s.low = Some(v.clone());
                s.high = Some(v.clone());
            }
            Value::Text(t) => {
                let n = t.chars().count() as i64;
                s.len_low = Some(n);
                s.len_high = Some(n);
            }
            Value::List(l) => {
                let n = l.items.len() as i64;
                s.len_low = Some(n);
                s.len_high = Some(n);
                let mut item: Option<Shape> = None;
                for i in l.items.clone().iter() {
                    let e = self.exact(&i.value);
                    item = Some(match item {
                        None => e,
                        Some(a) => self.hull(a, e),
                    });
                }
                s.item = item.map(Box::new);
            }
            Value::Opt(Some(x)) => {
                s.opt = true;
                let x = (**x).clone();
                s.item = Some(Box::new(self.exact(&x)));
            }
            _ => {}
        }
        if !matches!(v, Value::List(_) | Value::Opt(_)) {
            s.only = Some(vec![v.clone()]);
        }
        s
    }

    fn of_known(&mut self, k: &Known) -> Shape {
        let mut s = Shape::default();
        for t in &k.types {
            let t = self.of_type(t);
            s = self.meet(s, t);
        }
        if let Some(x) = &k.value {
            if let Some(v) = self.eval(x) {
                let e = self.exact(&v);
                s = self.meet(s, e);
            }
        }
        if k.whole || (!k.whole_if.is_empty() && k.whole_if.iter().all(|w| self.of_known(w).is_whole())) {
            s = self.meet(s, Shape { steps: Some((Num::zero(), Num::int(1))), ..Shape::default() });
        }
        if let Some(l) = &k.low_of {
            let low = self.of_known(l).low;
            s = self.meet(s, Shape { low, ..Shape::default() });
        }
        if let Some(h) = &k.high_of {
            let high = self.of_known(h).high;
            s = self.meet(s, Shape { high, ..Shape::default() });
        }
        if let Some((from, step)) = &k.steps {
            if let (Some(f), Some(st)) = (self.num(from), self.num(step)) {
                s = self.meet(s, Shape { steps: Some((f, st)), ..Shape::default() });
            }
        }
        if let Some(of) = &k.length_of {
            let x = self.of_known(of);
            let low = Some(Value::Num(Num::int(x.len_low.unwrap_or(0))));
            let high = x.len_high.map(|h| Value::Num(Num::int(h)));
            s = self.meet(s, Shape { low, high, steps: Some((Num::zero(), Num::int(1))), ..Shape::default() });
        }
        if let Some(l) = &k.len_low_of {
            let low = self.of_known(l).low.and_then(|v| v.as_num()).and_then(|n| n.ceil().to_i64());
            s = self.meet(s, Shape { len_low: low, ..Shape::default() });
        }
        if let Some(h) = &k.len_high_of {
            let high = self.of_known(h).high.and_then(|v| v.as_num()).and_then(|n| n.floor().to_i64());
            s = self.meet(s, Shape { len_high: high, ..Shape::default() });
        }
        if let Some(n) = k.len_exact {
            s = self.meet(s, Shape { len_low: Some(n as i64), len_high: Some(n as i64), ..Shape::default() });
        }
        if let Some(i) = &k.items {
            let i = self.of_known(i);
            s = self.meet(s, Shape { item: Some(Box::new(i)), ..Shape::default() });
        }
        if let Some(of) = &k.item_of {
            if let Some(i) = self.of_known(of).item {
                s = self.meet(s, *i);
            }
        }
        if let Some(inner) = &k.opt_of {
            let i = self.of_known(inner);
            s = self.meet(s, Shape { opt: true, item: Some(Box::new(i)), ..Shape::default() });
        }
        if let Some(both) = &k.either {
            let (a, b) = (self.of_known(&both.0), self.of_known(&both.1));
            let h = self.hull(a, b);
            s = self.meet(s, h);
        }
        for o in &k.also {
            let o = self.of_known(o);
            s = self.meet(s, o);
        }
        s
    }

    /// Both hold: the narrower of each part.
    fn meet(&mut self, a: Shape, b: Shape) -> Shape {
        let low = match (a.low, b.low) {
            (Some(x), Some(y)) => Some(if self.lower(&x, &y) { y } else { x }),
            (x, y) => x.or(y),
        };
        let high = match (a.high, b.high) {
            (Some(x), Some(y)) => Some(if self.lower(&x, &y) { x } else { y }),
            (x, y) => x.or(y),
        };
        let steps = match (a.steps, b.steps) {
            (Some(x), Some(y)) => Some(if steps_within(x.0, x.1, y.0, y.1) { x } else { y }),
            (x, y) => x.or(y),
        };
        let len_low = match (a.len_low, b.len_low) {
            (Some(x), Some(y)) => Some(x.max(y)),
            (x, y) => x.or(y),
        };
        let len_high = match (a.len_high, b.len_high) {
            (Some(x), Some(y)) => Some(x.min(y)),
            (x, y) => x.or(y),
        };
        let only = match (a.only, b.only) {
            (Some(x), Some(y)) => {
                let mut keep = Vec::new();
                for v in x {
                    if y.iter().any(|w| self.same(&v, w)) {
                        keep.push(v);
                    }
                }
                Some(keep)
            }
            (x, y) => x.or(y),
        };
        let item = match (a.item, b.item) {
            (Some(x), Some(y)) => Some(Box::new(self.meet(*x, *y))),
            (x, y) => x.or(y),
        };
        Shape { low, high, steps, len_low, len_high, only, item, opt: a.opt || b.opt }
    }

    /// Either holds: what covers both.
    fn hull(&mut self, a: Shape, b: Shape) -> Shape {
        let low = match (a.low, b.low) {
            (Some(x), Some(y)) => Some(if self.lower(&x, &y) { x } else { y }),
            _ => None,
        };
        let high = match (a.high, b.high) {
            (Some(x), Some(y)) => Some(if self.lower(&x, &y) { y } else { x }),
            _ => None,
        };
        let steps = match (a.steps, b.steps) {
            (Some(x), Some(y)) if steps_within(x.0, x.1, y.0, y.1) => Some(y),
            (Some(x), Some(y)) if steps_within(y.0, y.1, x.0, x.1) => Some(x),
            (Some(x), Some(y)) if x.0.is_int() && y.0.is_int() && x.1.is_int() && y.1.is_int() => Some((Num::zero(), Num::int(1))),
            _ => None,
        };
        let len_low = a.len_low.zip(b.len_low).map(|(x, y)| x.min(y));
        let len_high = a.len_high.zip(b.len_high).map(|(x, y)| x.max(y));
        let only = match (a.only, b.only) {
            (Some(mut x), Some(y)) => {
                for v in y {
                    if !x.iter().any(|w| self.m.equal(&v, w).unwrap_or(false)) {
                        x.push(v);
                    }
                }
                Some(x)
            }
            _ => None,
        };
        let item = match (a.item, b.item) {
            (Some(x), Some(y)) => Some(Box::new(self.hull(*x, *y))),
            _ => None,
        };
        Shape { low, high, steps, len_low, len_high, only, item, opt: a.opt && b.opt }
    }

    /// What a known value may break of a wanted shape, or `None` when it is proved.
    fn missing(&mut self, k: &Shape, w: &Shape) -> Option<String> {
        // a plain value where an opt is wanted is the value inside it
        if w.opt && !k.opt {
            return match &w.item {
                Some(wi) => self.missing(k, wi),
                None => None,
            };
        }
        if let Some(wl) = &w.low {
            match &k.low {
                Some(kl) if !self.lower(kl, wl) => {}
                _ => return Some(format!("it may be below {}", show_value(wl))),
            }
        }
        if let Some(wh) = &w.high {
            match &k.high {
                Some(kh) if !self.lower(wh, kh) => {}
                _ => return Some(format!("it may be above {}", show_value(wh))),
            }
        }
        if let Some((wf, ws)) = &w.steps {
            let ok = matches!(&k.steps, Some((f, s)) if steps_within(f.clone(), s.clone(), wf.clone(), ws.clone()));
            if !ok {
                return Some(if wf.is_int() && ws.is_int() && ws.to_i64() == Some(1) { "it may not be a whole number".to_string() } else { format!("it may not be a whole number of steps of {}", ws.show()) });
            }
        }
        if let Some(wl) = w.len_low {
            if !matches!(k.len_low, Some(kl) if kl >= wl) {
                return Some(format!("its length may be under {}", wl));
            }
        }
        if let Some(wh) = w.len_high {
            if !matches!(k.len_high, Some(kh) if kh <= wh) {
                return Some(format!("its length may be over {}", wh));
            }
        }
        if let Some(wo) = &w.only {
            let ok = match &k.only {
                Some(ko) => ko.clone().iter().all(|v| wo.iter().any(|x| self.m.equal(v, x).unwrap_or(false))),
                None => false,
            };
            if !ok {
                return Some("it may be a value the contract doesn't list".to_string());
            }
        }
        if let Some(wi) = &w.item {
            if wi.says_anything() {
                let ki = k.item.as_deref().cloned().unwrap_or_default();
                if let Some(why) = self.missing(&ki, wi) {
                    return Some(if w.opt { format!("inside the opt, {}", why) } else { format!("an item: {}", why) });
                }
            }
        }
        None
    }
}

/// A value as a message shows it.
fn show_value(v: &Value) -> String {
    match v {
        Value::Num(n) => n.show(),
        Value::Duration(ms) => format!("{}ms", ms.show()),
        Value::Text(t) => format!("\"{}\"", t),
        Value::Bool(b) => b.to_string(),
        Value::Case(c) => format!("{}.{}", c.ty.rsplit('/').next().unwrap_or(&c.ty), c.name),
        Value::List(l) => format!("a list of {}", l.items.len()),
        _ => "this value".into(),
    }
}

/// A contract as it is written: `0..10 step 1`, `[1...]`.
pub fn show_contract(t: &ir::Type) -> String {
    fn bound(x: &Option<ir::Expr>) -> String {
        match x {
            Some(ir::Expr::Num(n)) => n.clone(),
            Some(ir::Expr::Duration(ms)) => format!("{}ms", ms),
            Some(ir::Expr::Get(ir::Get::Let(n))) => n.rsplit('/').next().unwrap_or(n).to_string(),
            Some(_) => "(…)".into(),
            None => String::new(),
        }
    }
    let name = t.name.rsplit('/').next().unwrap_or(&t.name).to_string();
    let mut out = name;
    if !t.args.is_empty() {
        out.push('<');
        out.push_str(&t.args.iter().map(show_contract).collect::<Vec<_>>().join(", "));
        out.push('>');
    }
    if let Some(c) = &t.contract {
        if let Some(l) = &c.length {
            if l.low.is_some() && l.low == l.high {
                out.push_str(&format!("[{}]", bound(&l.low)));
            } else {
                out.push_str(&format!("[{}{}{}]", bound(&l.low), if l.high.is_some() { ".." } else { "..." }, bound(&l.high)));
            }
        }
        if let Some(r) = &c.range {
            let dots = if r.high.is_some() && r.low.is_some() { ".." } else { "..." };
            out.push_str(&format!(" {}{}{}", bound(&r.low), dots, bound(&r.high)));
        }
        if let Some(s) = &c.step {
            out.push_str(&format!(" step {}", bound(&Some(s.clone()))));
        }
        if !c.only.is_empty() {
            out.push_str(" only (…)");
        }
    }
    out
}

impl Checker {
    /// Whether a type, its aliases or its arguments carry a contract.
    pub(crate) fn has_contract(&self, t: &ir::Type) -> bool {
        if t.contract.is_some() || t.args.iter().any(|a| self.has_contract(a)) {
            return true;
        }
        self.defs.iter().any(|d| d.full == t.name && matches!(&d.kind, crate::DefKind::Alias { target: Some((_, ir)) } if self.has_contract(ir)))
    }

    /// Whether a type, or the alias it names, has a length contract.
    pub(crate) fn has_length(&self, t: &ir::Type) -> bool {
        if t.contract.as_ref().map_or(false, |c| c.length.is_some()) {
            return true;
        }
        self.defs.iter().any(|d| d.full == t.name && matches!(&d.kind, crate::DefKind::Alias { target: Some((_, ir)) } if self.has_length(ir)))
    }

    /// A widget's `require` blocks, run by the compiler for a call whose inputs are all
    /// constants: a `false` is a compile error on the call (page 2).
    pub(crate) fn settle_widget_requires(&mut self, prog: &Program) {
        struct Inputs(HashMap<String, Value>);
        impl xtmd_eval::Host for Inputs {
            fn read(&self, m: &mut Machine, what: &xtmd_eval::interp::Outer, owner: Option<u64>) -> Result<Value, xtmd_eval::Failure> {
                match what {
                    xtmd_eval::interp::Outer::Input(n) => self.0.get(&**n).cloned().ok_or_else(|| xtmd_eval::Failure::new(xtmd_eval::FailKind::NotConstant, "an input with no value")),
                    _ => Constants.read(m, what, owner),
                }
            }
            fn write(&self, m: &mut Machine, what: &xtmd_eval::interp::Outer, owner: Option<u64>, v: Value) -> Result<(), xtmd_eval::Failure> {
                Constants.write(m, what, owner, v)
            }
        }
        for (file, span, d, args) in std::mem::take(&mut self.require_checks) {
            let full = self.defs[d].full.clone();
            let Some((_, t)) = self.out.templates.iter().find(|(e, _)| *e == d).cloned() else { continue };
            if t.requires.is_empty() {
                continue;
            }
            // every input a constant: given, or its default
            let mut inputs = HashMap::new();
            let mut constant = true;
            for f in &t.inputs {
                let x = args.get(&f.name).cloned().or_else(|| f.default.clone());
                let Some(x) = x else { continue };
                let mut m = Machine::new(prog, Box::new(Constants));
                match m.eval(&x) {
                    Ok(v) => {
                        inputs.insert(f.name.clone(), v);
                    }
                    Err(_) => {
                        constant = false;
                        break;
                    }
                }
            }
            if !constant {
                continue;
            }
            for (k, r) in t.requires.iter().enumerate() {
                let mut p = prog.clone();
                let name = format!("{}@require#{}", full, k);
                p.fns.insert(name.clone(), std::rc::Rc::new(ir::FnDecl { name: name.clone(), generics: Vec::new(), params: Vec::new(), returns: Some(ir::Type::named("core/bool")), body: r.body.clone() }));
                let mut m = Machine::new(&p, Box::new(Inputs(inputs.clone())));
                if let Ok(Some(Value::Bool(false))) = m.call(&name, Vec::new()) {
                    let short = full.rsplit('/').next().unwrap_or(&full).to_string();
                    self.error(file, codes::WIDGET_REQUIRE, span, format!("`{}`'s rule is broken by these inputs: {}", short, r.message));
                }
            }
        }
    }

    /// A spot outside its plane's bounds warns, when both are constants (page 5).
    pub(crate) fn settle_spots(&mut self, prog: &Program) {
        for (file, span, at, bounds) in std::mem::take(&mut self.spot_checks) {
            let mut m = Machine::new(prog, Box::new(Constants));
            let (Ok(p), Ok(b)) = (m.eval(&at), m.eval(&bounds)) else { continue };
            let b = match b {
                Value::Opt(Some(x)) => (*x).clone(),
                Value::Opt(None) => continue,
                other => other,
            };
            let num = |v: Option<&Value>, f: &str| -> Option<Num> {
                match v? {
                    Value::Record(r) => r.get(f).and_then(|x| x.as_num()),
                    _ => None,
                }
            };
            let field = |v: &Value, f: &str| -> Option<Value> {
                match v {
                    Value::Record(r) => r.get(f).cloned(),
                    _ => None,
                }
            };
            let (from, to) = (field(&b, "from"), field(&b, "to"));
            let coords = [num(Some(&p), "x"), num(Some(&p), "y"), num(from.as_ref(), "x"), num(from.as_ref(), "y"), num(to.as_ref(), "x"), num(to.as_ref(), "y")];
            let [Some(x), Some(y), Some(x0), Some(y0), Some(x1), Some(y1)] = coords else { continue };
            let inside = |v: Num, a: Num, c: Num| {
                let (lo, hi) = if a.sub(c).map_or(false, |d| d.is_negative()) { (a, c) } else { (c, a) };
                !v.sub(lo).map_or(true, |d| d.is_negative()) && !hi.sub(v).map_or(true, |d| d.is_negative())
            };
            if !(inside(x, x0, x1) && inside(y, y0, y1)) {
                self.warning(file, codes::SPOT_OUTSIDE, span, format!("this spot, at ({}, {}), is outside its plane's bounds: it is clipped and the reader can't pan to it", x.show(), y.show()));
            }
        }
    }

    /// Settles every proof once the constants are known.
    pub(crate) fn settle_proofs(&mut self, prog: &Program) {
        // bounds are constants: one that can't be worked out now never can be
        let mut seen = std::collections::HashSet::new();
        for (file, span, x) in std::mem::take(&mut self.bound_checks) {
            if !seen.insert((file, span.start, span.end)) {
                continue;
            }
            let mut m = Machine::new(prog, Box::new(Constants));
            if let Err(f) = m.eval(&x) {
                let why = if f.kind == xtmd_eval::FailKind::NotConstant { "it reads something only known when the page runs".to_string() } else { f.message };
                self.error(file, codes::BOUND_NOT_CONSTANT, span, format!("a contract's bound is a constant: {}", why));
            }
        }
        let proofs = std::mem::take(&mut self.proofs);
        let aliases = prog.aliases.clone();
        let mut errors = Vec::new();
        for p in proofs {
            let mut s = Solver { m: Machine::new(prog, Box::new(Constants)), aliases: aliases.clone() };
            let want = s.of_type(&p.want);
            if !want.says_anything() {
                continue;
            }
            let known = s.of_known(&p.known);
            let Some(why) = s.missing(&known, &want) else { continue };
            // no proof: a constant is checked on the spot
            if let Some(x) = &p.value {
                let mut m = Machine::new(prog, Box::new(Constants));
                if let Ok(v) = m.eval(x) {
                    match m.fits(&v, &p.want) {
                        Ok(true) => {}
                        _ => errors.push((p.file, p.span, codes::OUTSIDE, format!("{} is outside {}'s contract, {}", show_value(&v), p.what, show_contract(&p.want)))),
                    }
                    continue;
                }
            }
            errors.push((
                p.file,
                p.span,
                codes::NEEDS_PROOF,
                {
                    let want = show_contract(&p.want);
                    let a = if want.starts_with(['a', 'e', 'i', 'o', 'u']) { "an" } else { "a" };
                    format!("{} is {} {}, and nothing proves this value is: {}. Prove it first, with `if (x in low..high) {{ … }}`, `.clamp(low, high)` or `try`", p.what, a, want, why)
                },
            ));
        }
        for (file, span, code, msg) in errors {
            self.error(file, code, span, msg);
        }
    }
}

// ---- what the checker knows, as it checks each expression

use crate::body::Cx;
use crate::ty::Ty;
use crate::DefKind;
use xtmd_syntax::ast::{self, BinOp, ExprKind as E, UnOp};

impl Checker {
    pub(crate) fn known_of(&self, cx: &Cx, e: &ast::Expr) -> Known {
        self.known_at.get(&(cx.file, e.span.start, e.span.end)).cloned().unwrap_or_default()
    }

    /// Records what is known of an expression just checked, unless where it was worked out did.
    pub(crate) fn note_known(&mut self, cx: &Cx, e: &ast::Expr, x: &ir::Expr) {
        let key = (cx.file, e.span.start, e.span.end);
        if self.known_at.contains_key(&key) {
            return;
        }
        let has_value = |k: &Known| k.value.is_some();
        let k = match &e.kind {
            E::Number(_) | E::Duration(_) | E::Bool(_) | E::Text(_) | E::Case { args: None, .. } => Known::value(x),
            E::Paren(inner) => {
                // a parenthesised expression is worked out as its inner one, so note that too
                self.note_known(cx, inner, x);
                self.known_of(cx, inner)
            }
            E::Name(n) => self.name_known(cx, &n.name, x),
            E::Unary { op: UnOp::Neg, operand } => {
                // `-a` is `0 - a`: whole when `a` is
                let k = self.known_of(cx, operand);
                Known { value: has_value(&k).then(|| x.clone()), whole_if: vec![k], ..Known::default() }
            }
            E::Binary { op, left, right } if matches!(op, BinOp::Add | BinOp::Sub | BinOp::Mul | BinOp::Rem | BinOp::Div) => {
                let (l, r) = (self.known_of(cx, left), self.known_of(cx, right));
                // arithmetic over constants is a constant; whole-number arithmetic is whole
                let value = (has_value(&l) && has_value(&r)).then(|| x.clone());
                let whole_if = if matches!(op, BinOp::Div) { Vec::new() } else { vec![l, r] };
                Known { value, whole_if, ..Known::default() }
            }
            E::Index { target, .. } => Known { opt_of: Some(Box::new(Known { item_of: Some(Box::new(self.known_of(cx, target))), ..Known::default() })), ..Known::default() },
            E::Ternary { then, otherwise, .. } => Known { either: Some(Box::new((self.known_of(cx, then), self.known_of(cx, otherwise)))), ..Known::default() },
            E::List(items) => {
                let mut item: Option<Known> = None;
                for i in items.iter() {
                    let k = self.known_of(cx, i);
                    item = Some(match item {
                        None => k,
                        Some(a) => Known { either: Some(Box::new((a, k))), ..Known::default() },
                    });
                }
                Known { len_exact: Some(items.len()), items: item.map(Box::new), ..Known::default() }
            }
            _ => Known::default(),
        };
        self.known_at.insert(key, k);
    }

    /// What is known of a name where it is read: a local's, an input's or a variable's declared
    /// type, a constant's value, and the proofs that hold here.
    fn name_known(&self, cx: &Cx, name: &str, x: &ir::Expr) -> Known {
        let mut k = if let Some(l) = cx.local(name) {
            l.known.clone().unwrap_or_default()
        } else if let Some(t) = cx.widget.as_ref().and_then(|w| w.declared.iter().find(|(n, _)| n == name)).map(|(_, t)| t.clone()) {
            Known::of(&t)
        } else if let Some(crate::ValueSym::Let(l)) = self.lookup_value(cx.file, name) {
            Known { types: vec![self.lets[l].ir.clone()], value: Some(x.clone()), ..Known::default() }
        } else {
            Known::default()
        };
        for (_, n, f) in &cx.facts {
            if n == name {
                k = k.and(f.clone());
            }
        }
        k
    }

    /// A field's declared type, with its contract.
    pub(crate) fn field_ir(&mut self, cx: &Cx, t: &Ty, name: &str) -> Option<ir::Type> {
        let find = |fields: &[crate::FieldSym]| fields.iter().find(|f| f.name == name).map(|f| f.ir.clone());
        match self.vars.resolve(t) {
            Ty::Def(d, _) | Ty::Any(d, _) => match &self.defs[d].kind {
                DefKind::Record { fields } | DefKind::Interface { fields, .. } => find(fields),
                DefKind::Widget { inputs, .. } => find(inputs),
                _ => None,
            },
            Ty::Param(p) => {
                let tp = cx.bounds.iter().find(|b| b.name == p)?;
                tp.bounds.iter().find_map(|(d, _)| match &self.defs[*d].kind {
                    DefKind::Interface { fields, .. } => find(fields),
                    _ => None,
                })
            }
            _ => None,
        }
    }

    /// A `$state` field's declared type.
    pub(crate) fn state_ir(&mut self, name: &str) -> Option<ir::Type> {
        let (file, s) = self.state.clone()?;
        let ty = s.members.iter().find_map(|m| match m {
            ast::Member::Field(f) if f.name.name == name => Some(f.ty.clone()),
            _ => None,
        })?;
        Some(self.ir_type(file, &ty, &[]))
    }

    /// What a call gives: its declared return type, and page 2's proofs for `clamp`, `round`,
    /// `floor`, `ceil` and `len()`.
    pub(crate) fn note_call_known(&mut self, cx: &Cx, span: xtmd_syntax::Span, f: usize, recv: Option<&ast::Expr>, args: &[&ast::Expr]) {
        let r = recv.map(|e| self.known_of(cx, e)).unwrap_or_default();
        let a: Vec<Known> = args.iter().map(|e| self.known_of(cx, e)).collect();
        let k = match self.fns[f].full.as_str() {
            "core/ordered.clamp" | "core/number.clamp" if a.len() == 2 => Known {
                low_of: Some(Box::new(a[0].clone())),
                high_of: Some(Box::new(a[1].clone())),
                whole_if: vec![r, a[0].clone(), a[1].clone()],
                ..Known::default()
            },
            "core/number.round" | "core/number.floor" | "core/number.ceil" => Known::whole(),
            "core/list.len" | "core/text.len" => Known { length_of: Some(Box::new(r)), ..Known::default() },
            _ => match self.fns[f].ret_ir.clone() {
                Some(ret) => {
                    // a generic fn: its type parameters stand for what is known of what fills them
                    let generics: Vec<String> = self.fns[f].generics.iter().map(|g| g.name.clone()).collect();
                    let mut map: Vec<(String, Known)> = Vec::new();
                    let params = self.fns[f].params.clone();
                    let mut given = params.iter().filter(|p| !p.is_self).zip(a.iter());
                    if let Some(p) = params.iter().find(|p| p.is_self) {
                        bind_param(&generics, &p.ir, r.clone(), &mut map);
                    }
                    for (p, k) in &mut given {
                        bind_param(&generics, &p.ir, k.clone(), &mut map);
                    }
                    subst_known(&generics, &ret, &map)
                }
                None => Known::default(),
            },
        };
        self.known_at.insert((cx.file, span.start, span.end), k);
    }

    /// A value meets a declared type: when it has a contract, a proof is wanted.
    pub(crate) fn want(&mut self, cx: &Cx, e: &ast::Expr, x: &ir::Expr, want: &ir::Type, what: impl Into<String>) {
        if !self.has_contract(want) {
            return;
        }
        let known = self.known_of(cx, e);
        self.proofs.push(Proof { file: cx.file, span: e.span, value: Some(x.clone()), want: want.clone(), known, what: what.into() });
    }

    /// A variable given to a `mut` parameter or input: its own contract has to be inside the one wanted.
    pub(crate) fn want_shared(&mut self, cx: &Cx, e: &ast::Expr, want: &ir::Type, what: impl Into<String>) {
        if !self.has_contract(want) {
            return;
        }
        let known = self.known_of(cx, e);
        self.proofs.push(Proof { file: cx.file, span: e.span, value: None, want: want.clone(), known, what: what.into() });
    }

    /// `if (x in low..high)` and `if (x.len() in low..high)`, joined by `&&`: inside the block,
    /// what they prove holds for `x`.
    pub(crate) fn narrow(&mut self, cx: &mut Cx, e: &ast::Expr) {
        match &e.kind {
            E::Paren(inner) => self.narrow(cx, inner),
            E::Binary { op: BinOp::And, left, right } => {
                self.narrow(cx, left);
                self.narrow(cx, right);
            }
            E::Binary { op: BinOp::In, left, right } => {
                let E::Range { low, high, step } = &right.kind else { return };
                let low_k = low.as_ref().map(|l| self.known_of(cx, l));
                let high_k = high.as_ref().map(|h| self.known_of(cx, h));
                let (name, fact) = match &left.kind {
                    E::Name(n) => {
                        let steps = match (low_k.as_ref().and_then(|k| k.value.clone()), step.as_ref().and_then(|s| self.known_of(cx, s).value)) {
                            (Some(from), Some(st)) => Some((from, st)),
                            (None, Some(st)) if low.is_none() => Some((ir::Expr::Num("0".into()), st)),
                            _ => None,
                        };
                        (n.name.clone(), Known { low_of: low_k.map(Box::new), high_of: high_k.map(Box::new), steps, ..Known::default() })
                    }
                    E::Call { callee, args } if args.is_empty() => {
                        let E::Field { target, name } = &callee.kind else { return };
                        let E::Name(n) = &target.kind else { return };
                        if name.name != "len" {
                            return;
                        }
                        (n.name.clone(), Known { len_low_of: low_k.map(Box::new), len_high_of: high_k.map(Box::new), ..Known::default() })
                    }
                    _ => return,
                };
                let depth = cx.scopes.len();
                cx.facts.push((depth, name, fact));
            }
            _ => {}
        }
    }

    /// A loop's variables: a position is an `int 0...`; a range loop's variable is in its range
    /// when the start, end and step are constants; an item is what the list's items are.
    pub(crate) fn loop_known(&mut self, cx: &mut Cx, over: &ast::Expr, key: Option<&ast::Ident>, name: &ast::Ident) {
        if let Some(k) = key {
            let zero = Known::value(&ir::Expr::Num("0".into()));
            set_known(cx, &k.name, Known { whole: true, low_of: Some(Box::new(zero)), ..Known::default() });
        }
        let item = match &over.kind {
            E::Range { low, high, step } => {
                let v = |s: &Self, x: &Option<Box<ast::Expr>>| x.as_ref().and_then(|x| s.known_of(cx, x).value);
                let (lo, hi) = (v(self, low), v(self, high));
                let st = match step {
                    Some(_) => v(self, step),
                    None => Some(ir::Expr::Num("1".into())),
                };
                Known {
                    low_of: lo.as_ref().map(|x| Box::new(Known::value(x))),
                    high_of: hi.as_ref().map(|x| Box::new(Known::value(x))),
                    steps: lo.clone().zip(st),
                    ..Known::default()
                }
            }
            _ => Known { item_of: Some(Box::new(self.known_of(cx, over))), ..Known::default() },
        };
        set_known(cx, &name.name, item);
    }
}

/// What a type parameter stands for, from a parameter's declared type and what fills it.
fn bind_param(generics: &[String], t: &ir::Type, k: Known, map: &mut Vec<(String, Known)>) {
    if generics.contains(&t.name) {
        map.push((t.name.clone(), k));
        return;
    }
    if let (Some(arg), "core/list" | "core/opt") = (t.args.first(), t.name.as_str()) {
        bind_param(generics, arg, Known { item_of: Some(Box::new(k)), ..Known::default() }, map);
    }
}

/// What a generic fn's declared return type says, its type parameters put in.
fn subst_known(generics: &[String], t: &ir::Type, map: &[(String, Known)]) -> Known {
    if generics.contains(&t.name) {
        // every value that filled it: what covers them all
        let mut out: Option<Known> = None;
        for (_, k) in map.iter().filter(|(n, _)| *n == t.name) {
            out = Some(match out {
                None => k.clone(),
                Some(a) => Known { either: Some(Box::new((a, k.clone()))), ..Known::default() },
            });
        }
        return out.unwrap_or_default();
    }
    let mentions = |t: &ir::Type| -> bool {
        fn any(t: &ir::Type, g: &[String]) -> bool {
            g.contains(&t.name) || t.args.iter().any(|a| any(a, g))
        }
        any(t, generics)
    };
    if !mentions(t) {
        return Known::of(t);
    }
    match (t.name.as_str(), t.args.first()) {
        ("core/opt", Some(a)) => Known { opt_of: Some(Box::new(subst_known(generics, a, map))), ..Known::default() },
        ("core/list", Some(a)) => Known { items: Some(Box::new(subst_known(generics, a, map))), ..Known::default() },
        _ => Known::default(),
    }
}

/// Sets what is known of the innermost local of that name.
pub(crate) fn set_known(cx: &mut Cx, name: &str, k: Known) {
    if let Some(l) = cx.scopes.iter_mut().rev().flat_map(|s| s.iter_mut().rev()).find(|l| l.name == name) {
        l.known = Some(k);
    }
}

impl Checker {
    /// The declared type of the place an assignment writes: a variable's, an input's, a
    /// `$state` field's or a record field's.
    pub(crate) fn place_ir(&mut self, cx: &mut Cx, e: &ast::Expr) -> Option<ir::Type> {
        match &e.kind {
            E::Name(n) => match cx.local(&n.name) {
                Some(l) => l.known.as_ref().and_then(|k| k.types.first().cloned()),
                None => cx.widget.as_ref().and_then(|w| w.declared.iter().find(|(m, _)| *m == n.name)).map(|(_, t)| t.clone()),
            },
            E::Field { target, name } => {
                if let E::State = target.kind {
                    return self.state_ir(&name.name);
                }
                let (_, t) = self.place(cx, target)?;
                self.field_ir(cx, &t, &name.name)
            }
            // an item of a list: its item type, `xs[0] = v` on a `list<number 0..10>`
            E::Index { target, .. } => {
                let t = self.place_ir(cx, target)?;
                self.unalias(&t).filter(|t| t.name == "core/list").and_then(|t| t.args.first().cloned())
            }
            _ => None,
        }
    }

    /// A type with its aliases followed to what they name, the alias's own contract kept when it
    /// is the only one.
    pub(crate) fn unalias(&self, t: &ir::Type) -> Option<ir::Type> {
        let mut t = t.clone();
        for _ in 0..32 {
            let Some(target) = self.defs.iter().find(|d| d.full == t.name).and_then(|d| match &d.kind {
                crate::DefKind::Alias { target: Some((_, ir)) } => Some(ir.clone()),
                _ => None,
            }) else {
                return Some(t);
            };
            let mut next = target;
            if next.contract.is_none() {
                next.contract = t.contract.clone();
            }
            t = next;
        }
        None
    }

    /// What a generic fn's type parameters stand for, read from the declared type of a `mut`
    /// place it writes, contracts and all: `list<T>` given a `list<number 0..10>` makes `T` a
    /// `number 0..10`.
    pub(crate) fn bind_ir(&self, generics: &[String], param: &ir::Type, place: &ir::Type, out: &mut Vec<(String, ir::Type)>) {
        if generics.contains(&param.name) {
            if !out.iter().any(|(n, _)| *n == param.name) {
                out.push((param.name.clone(), place.clone()));
            }
            return;
        }
        let Some(place) = self.unalias(place) else { return };
        if place.name == param.name {
            for (p, a) in param.args.iter().zip(&place.args) {
                self.bind_ir(generics, p, a, out);
            }
        }
    }
}

/// A declared type with its type parameters put in, or None when one isn't bound.
pub(crate) fn subst_ir(generics: &[String], t: &ir::Type, bound: &[(String, ir::Type)]) -> Option<ir::Type> {
    if generics.contains(&t.name) {
        return bound.iter().find(|(n, _)| *n == t.name).map(|(_, x)| x.clone());
    }
    let args = t.args.iter().map(|a| subst_ir(generics, a, bound)).collect::<Option<Vec<_>>>()?;
    Some(ir::Type { args, ..t.clone() })
}

impl Checker {

    /// What is known of a variable given to a `mut` parameter or input: its declared type.
    pub(crate) fn place_known(&mut self, cx: &mut Cx, e: &ast::Expr) -> Option<Known> {
        match &e.kind {
            E::Name(n) => Some(self.name_known(cx, &n.name, &ir::Expr::Num("0".into()))).map(|mut k| {
                k.value = None;
                k
            }),
            E::Field { .. } => self.place_ir(cx, e).map(|t| Known::of(&t)),
            _ => None,
        }
    }
}
