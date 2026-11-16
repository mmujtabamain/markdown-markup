//! Which drawn widgets are as they were when Kotlin last read the tree, so a redraw sends only
//! what changed across the bindings: an unchanged widget, with everything in its slots, crosses
//! as a stub (its path, key and widget, `same: true`) that Kotlin replaces with the node it holds.
//! Values are compared as they are, so the work is the runtime's own data, not a converted copy.
//! A widget the page reused is the very node Kotlin read last ([`Drawn::same`]): it and everything
//! in it are as they were, so it is a stub without comparing a value.

use std::collections::{HashMap, HashSet};
use std::rc::Rc;

use mkp_eval::Binding;
use mkp_runtime::{Drawn, Page, Value};

use crate::Node;

/// Whether two values are the same value, as Kotlin would read them.
pub fn same_value(a: &Value, b: &Value) -> bool {
    match (a, b) {
        (Value::Num(x), Value::Num(y)) | (Value::Duration(x), Value::Duration(y)) => x == y,
        (Value::Text(x), Value::Text(y)) => x == y,
        (Value::Bool(x), Value::Bool(y)) => x == y,
        (Value::List(x), Value::List(y)) => Rc::ptr_eq(x, y) || (x.items.len() == y.items.len() && x.items.iter().zip(&y.items).all(|(p, q)| same_value(&p.value, &q.value))),
        (Value::Record(x), Value::Record(y)) => {
            Rc::ptr_eq(x, y) || (x.ty == y.ty && x.fields.len() == y.fields.len() && x.fields.iter().zip(&y.fields).all(|((n, p), (m, q))| n == m && same_value(p, q)))
        }
        (Value::Case(x), Value::Case(y)) => {
            Rc::ptr_eq(x, y) || (x.ty == y.ty && x.name == y.name && x.values.len() == y.values.len() && x.values.iter().zip(&y.values).all(|((n, p), (m, q))| n == m && same_value(p, q)))
        }
        (Value::Opt(x), Value::Opt(y)) => match (x, y) {
            (None, None) => true,
            (Some(p), Some(q)) => same_value(p, q),
            _ => false,
        },
        (Value::Range(x), Value::Range(y)) => Rc::ptr_eq(x, y) || (same_end(&x.low, &y.low) && same_end(&x.high, &y.high) && same_end(&x.step, &y.step)),
        // a lambda made again on each draw is the same fn when it is the same code, made in the
        // same widget, with the same values around it
        (Value::Fn(x), Value::Fn(y)) => {
            Rc::ptr_eq(x, y)
                || (Rc::ptr_eq(&x.body, &y.body)
                    && x.owner == y.owner
                    && x.captured.len() == y.captured.len()
                    && x.captured.iter().zip(&y.captured).all(|((n, p), (m, q))| n == m && same_binding(p, q)))
        }
        (Value::View(x), Value::View(y)) => Rc::ptr_eq(x, y),
        _ => false,
    }
}

fn same_end(a: &Option<Value>, b: &Option<Value>) -> bool {
    match (a, b) {
        (None, None) => true,
        (Some(p), Some(q)) => same_value(p, q),
        _ => false,
    }
}

fn same_binding(a: &Binding, b: &Binding) -> bool {
    match (a, b) {
        (Binding::Value(p), Binding::Value(q)) => same_value(p, q),
        // a place may hold anything by now: never the same
        _ => false,
    }
}

/// Whether a widget itself is as it was: its identity, its props, what it listens to and writes,
/// and the widgets in its slots, by key and in order (they are compared on their own).
fn same_shallow(page: &Page, d: &Drawn, p: &Drawn, was_listening: &[String]) -> bool {
    d.path == p.path
        && d.key == p.key
        && d.widget == p.widget
        && d.props.len() == p.props.len()
        && d.props.iter().all(|(k, v)| p.props.get(k).map_or(false, |w| same_value(v, w)))
        && d.events.len() == p.events.len()
        && d.events.iter().all(|(k, h)| p.events.get(k).map_or(false, |g| g.handler == h.handler))
        && d.writes.keys().eq(p.writes.keys())
        && d.slots.len() == p.slots.len()
        && d.slots.iter().all(|(k, kids)| p.slots.get(k).map_or(false, |was| kids.len() == was.len() && kids.iter().zip(was).all(|(a, b)| a.key == b.key)))
        && d.events.keys().filter(|e| page.listens(d, e)).eq(was_listening.iter())
}

/// What a tree update holds: each drawn widget, as a stub when it and everything in it are as
/// they were.
pub struct Diff<'a> {
    page: &'a Page,
    prev: HashMap<&'a str, &'a Drawn>,
    listening: &'a HashMap<String, Vec<String>>,
    /// Keys drawn once only, now: only those can stand for a node Kotlin holds.
    unique: HashSet<&'a str>,
}

impl<'a> Diff<'a> {
    pub fn new(page: &'a Page, prev: &'a [Drawn], listening: &'a HashMap<String, Vec<String>>) -> Diff<'a> {
        fn index<'b>(nodes: &'b [Drawn], out: &mut HashMap<&'b str, &'b Drawn>) {
            for n in nodes {
                out.insert(n.key.as_str(), n);
                for kids in n.slots.values() {
                    index(kids, out);
                }
            }
        }
        fn count<'b>(nodes: &'b [Drawn], seen: &mut HashMap<&'b str, usize>) {
            for n in nodes {
                *seen.entry(n.key.as_str()).or_default() += 1;
                for kids in n.slots.values() {
                    count(kids, seen);
                }
            }
        }
        let mut map = HashMap::new();
        index(prev, &mut map);
        let mut seen = HashMap::new();
        count(page.tree(), &mut seen);
        count(prev, &mut seen);
        Diff { page, prev: map, listening, unique: seen.into_iter().filter(|(_, n)| *n == 2).map(|(k, _)| k).collect() }
    }

    /// Whether what each widget in a reused subtree listens to is as it was, and its key still
    /// stands for one node: what a reused node can't say by itself.
    fn listening_as_was(&self, d: &Drawn) -> bool {
        self.unique.contains(d.key.as_str())
            && d.events.keys().filter(|e| self.page.listens(d, e)).eq(self.listening.get(&d.key).map_or(&[][..], |l| l.as_slice()).iter())
            && d.slots.values().flatten().all(|k| self.listening_as_was(k))
    }

    /// A drawn widget as Kotlin reads it, and whether it is as it was, all of it.
    pub fn node(&self, d: &Drawn) -> (Node, bool) {
        let prev = if self.unique.contains(d.key.as_str()) { self.prev.get(d.key.as_str()) } else { None };
        // the page reused it: the very node Kotlin holds, with everything in it
        if prev.map_or(false, |p| Drawn::same(d, p)) && self.listening_as_was(d) {
            return (stub(d), true);
        }
        let mut slots = Vec::new();
        let mut kids_same = true;
        for (name, kids) in &d.slots {
            let mut nodes = Vec::new();
            for k in kids {
                let (n, same) = self.node(k);
                kids_same &= same;
                nodes.push(n);
            }
            slots.push(crate::Slot { name: name.clone(), nodes });
        }
        let same = kids_same
            && prev.map_or(false, |p| same_shallow(self.page, d, p, self.listening.get(&d.key).map_or(&[][..], |l| l.as_slice())));
        if same {
            return (stub(d), true);
        }
        let mut n = crate::node_shallow(self.page, d);
        n.slots = slots;
        (n, false)
    }
}

/// A widget as it was: its path, key and widget, for the node with its key Kotlin holds.
fn stub(d: &Drawn) -> Node {
    Node { path: d.path.clone(), key: d.key.clone(), widget: d.widget.clone(), props: HashMap::new(), slots: Vec::new(), listens: Vec::new(), events: Vec::new(), writes: Vec::new(), same: true }
}
