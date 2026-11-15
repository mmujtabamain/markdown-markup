//! Values while a page runs, or while the compiler works out a constant.
//!
//! Values have no cycles and are shared until one is changed (page 2: assigning makes a value
//! of its own, and the implementer copies only when one of them is changed). Every item of a
//! list has a hidden identity, kept through `add`, `insert`, `remove`, `move`, `sort` and
//! writes, so `mut for` can find the real item and rows can follow their items.

use crate::num::Num;
use mkp_ir::ir::{Expr, Node, Param, Stmt};
use std::collections::BTreeMap;
use std::rc::Rc;

#[derive(Clone, Debug)]
pub enum Value {
    Num(Num),
    Text(Rc<str>),
    Bool(bool),
    /// Milliseconds.
    Duration(Num),
    List(Rc<List>),
    Record(Rc<Record>),
    /// An enum's case, a token among them, with the values it carries.
    Case(Rc<Case>),
    Opt(Option<Rc<Value>>),
    Range(Rc<RangeValue>),
    Fn(Rc<Closure>),
    View(Rc<ViewValue>),
}

#[derive(Clone, Debug)]
pub struct Item {
    pub id: u64,
    pub value: Value,
}

#[derive(Clone, Debug, Default)]
pub struct List {
    pub items: Vec<Item>,
}

#[derive(Clone, Debug)]
pub struct Record {
    pub ty: Rc<str>,
    /// In the order the record declares them.
    pub fields: Vec<(Rc<str>, Value)>,
}

impl Record {
    pub fn get(&self, name: &str) -> Option<&Value> {
        self.fields.iter().find(|(n, _)| &**n == name).map(|(_, v)| v)
    }

    pub fn get_mut(&mut self, name: &str) -> Option<&mut Value> {
        self.fields.iter_mut().find(|(n, _)| &**n == name).map(|(_, v)| v)
    }
}

#[derive(Clone, Debug)]
pub struct Case {
    /// The enum or token type: `core/stage`, `core/color`.
    pub ty: Rc<str>,
    pub name: Rc<str>,
    pub values: Vec<(Rc<str>, Value)>,
}

#[derive(Clone, Debug)]
pub struct RangeValue {
    pub low: Option<Value>,
    pub high: Option<Value>,
    pub step: Option<Value>,
}

/// A lambda: its code, and what it saw when it was made.
#[derive(Debug)]
pub struct Closure {
    pub params: Vec<Param>,
    pub body: Rc<Vec<Stmt>>,
    pub captured: Vec<(Rc<str>, crate::interp::Binding)>,
    /// The widget instance it was made in, for its cells and inputs.
    pub owner: Option<u64>,
}

/// A view as a value: a description of a call, drawn where it is placed.
#[derive(Debug)]
pub struct ViewValue {
    pub widget: Rc<str>,
    pub args: BTreeMap<String, Value>,
    pub slots: BTreeMap<String, Vec<Node>>,
    pub events: BTreeMap<String, String>,
    pub exprs: BTreeMap<String, Expr>,
    /// The locals where it was made, which its slots' nodes read, as a lambda's body does.
    pub captured: Vec<(Rc<str>, crate::interp::Binding)>,
    /// The widget instance it was made in, for its cells and inputs.
    pub owner: Option<u64>,
}

impl Value {
    pub fn text(s: &str) -> Value {
        Value::Text(Rc::from(s))
    }

    pub fn some(v: Value) -> Value {
        Value::Opt(Some(Rc::new(v)))
    }

    pub fn none() -> Value {
        Value::Opt(None)
    }

    pub fn list(values: Vec<Value>, ids: &mut u64) -> Value {
        let items = values
            .into_iter()
            .map(|value| {
                *ids += 1;
                Item { id: *ids, value }
            })
            .collect();
        Value::List(Rc::new(List { items }))
    }

    pub fn as_num(&self) -> Option<Num> {
        match self {
            Value::Num(n) | Value::Duration(n) => Some(*n),
            _ => None,
        }
    }

    pub fn as_bool(&self) -> Option<bool> {
        match self {
            Value::Bool(b) => Some(*b),
            _ => None,
        }
    }

    pub fn as_text(&self) -> Option<&str> {
        match self {
            Value::Text(t) => Some(t),
            _ => None,
        }
    }

    /// The name of the value's own type, which an interface's fn is sent to.
    pub fn type_name(&self) -> &str {
        match self {
            Value::Num(_) => "core/number",
            Value::Text(_) => "core/text",
            Value::Bool(_) => "core/bool",
            Value::Duration(_) => "core/duration",
            Value::List(_) => "core/list",
            Value::Record(r) => &r.ty,
            Value::Case(c) => &c.ty,
            Value::Opt(_) => "core/opt",
            Value::Range(_) => "core/range",
            Value::Fn(_) => "fn",
            Value::View(_) => "core/view",
        }
    }

    /// The IR's form of a value, for the IR, observations and Markdown.
    pub fn to_ir(&self) -> Expr {
        use mkp_ir::ir::{Empty, ExprCase, ExprRange, ExprRecord};
        match self {
            Value::Num(n) => Expr::Num(n.show()),
            Value::Text(t) => Expr::Text(t.to_string()),
            Value::Bool(b) => Expr::Bool(*b),
            Value::Duration(n) => Expr::Duration(n.show()),
            Value::List(l) => Expr::List(l.items.iter().map(|i| i.value.to_ir()).collect()),
            Value::Record(r) => Expr::Record(ExprRecord {
                ty: r.ty.to_string(),
                fields: r.fields.iter().map(|(n, v)| (n.to_string(), v.to_ir())).collect(),
            }),
            Value::Case(c) => Expr::Case(ExprCase {
                enum_: c.ty.to_string(),
                name: c.name.to_string(),
                values: c.values.iter().map(|(n, v)| (n.to_string(), v.to_ir())).collect(),
            }),
            Value::Opt(Some(v)) => Expr::Some(Box::new(v.to_ir())),
            Value::Opt(None) => Expr::None(Empty {}),
            Value::Range(r) => Expr::Range(Box::new(ExprRange {
                low: r.low.as_ref().map(|v| v.to_ir()),
                high: r.high.as_ref().map(|v| v.to_ir()),
                step: r.step.as_ref().map(|v| v.to_ir()),
            })),
            Value::Fn(_) => Expr::Text("<fn>".into()),
            Value::View(v) => Expr::View(mkp_ir::ir::ViewValue {
                widget: v.widget.to_string(),
                args: v.args.iter().map(|(k, x)| (k.clone(), x.to_ir())).collect(),
                slots: v.slots.clone(),
                events: v.events.clone(),
            }),
        }
    }
}
