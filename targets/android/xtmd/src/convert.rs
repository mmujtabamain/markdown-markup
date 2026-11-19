//! Values across the bindings: the runtime's [`Value`] as a [`Val`] Kotlin reads, and a [`Val`]
//! Kotlin writes back, through the IR's form, as the runtime takes the app's values.

use std::collections::BTreeMap;

use xtmd_ir::ir::{Empty, Expr, ExprCase, ExprRange, ExprRecord};
use xtmd_runtime::{Page, Value};

/// A value, as Kotlin reads and writes it. Numbers are exact decimals, written as Extended Mark writes
/// them (`35`, `0.1`, `-2.5`), so nothing is rounded on the way across.
#[derive(Clone, Debug, PartialEq, uniffi::Enum)]
pub enum Val {
    Num { n: String },
    Text { s: String },
    Bool { b: bool },
    /// Milliseconds.
    Duration { ms: String },
    Items { items: Vec<Val> },
    /// A record, its fields in the order its type declares them.
    Record { ty: String, fields: Vec<Field> },
    /// An enum's case, or a token's. A token's `token` holds the value the build gives it
    /// (`space.M` is `8`, `color.INK` a `color_value` with both themes); an enum's is empty.
    Case { ty: String, name: String, values: Vec<Field>, token: Vec<Val> },
    /// `opt`: empty for `opt.NONE`, else its one value.
    Opt { value: Vec<Val> },
    /// A range: each end, and its step, empty when left out.
    Range { low: Vec<Val>, high: Vec<Val>, step: Vec<Val> },
    /// A fn the tree holds, by name ("" for a lambda): a shade's shader, which only Rust runs.
    Fn { name: String },
    /// A view held as a value, by its widget. One in a sentence (a VIEW part of a widget's rich
    /// text) is drawn from the widget's slot `slot` names, where the part is.
    View { widget: String, slot: Option<String> },
}

/// A named value: a record's field, a case's value, a prop.
#[derive(Clone, Debug, PartialEq, uniffi::Record)]
pub struct Field {
    pub name: String,
    pub value: Val,
}

/// The runtime's value as Kotlin reads it. Token cases carry their value, worked out once here,
/// so a composable never calls back into the page while it draws.
pub fn val(page: &Page, v: &Value) -> Val {
    val_in(Some(page), v)
}

/// A value as Kotlin reads it where no page is at hand (an app's value fn is called with its
/// arguments mid-change): a token case's value is left out.
pub fn val_in(page: Option<&Page>, v: &Value) -> Val {
    let val = |_: Option<&Page>, x: &Value| val_in(page, x);
    match v {
        Value::Num(n) => Val::Num { n: n.show() },
        Value::Text(t) => Val::Text { s: t.to_string() },
        Value::Bool(b) => Val::Bool { b: *b },
        Value::Duration(n) => Val::Duration { ms: n.show() },
        Value::List(l) => Val::Items { items: l.items.iter().map(|i| val(page, &i.value)).collect() },
        Value::Record(r) => Val::Record { ty: r.ty.to_string(), fields: r.fields.iter().map(|(k, x)| Field { name: k.to_string(), value: val(page, x) }).collect() },
        Value::Case(c) => {
            let token = match page.map(|p| p.token_value(v)) {
                Some(Ok(t)) => vec![val(page, &t)],
                _ => Vec::new(),
            };
            Val::Case { ty: c.ty.to_string(), name: c.name.to_string(), values: c.values.iter().map(|(k, x)| Field { name: k.to_string(), value: val(page, x) }).collect(), token }
        }
        Value::Opt(x) => Val::Opt { value: x.iter().map(|x| val(page, x)).collect() },
        Value::Range(r) => Val::Range {
            low: r.low.iter().map(|x| val(page, x)).collect(),
            high: r.high.iter().map(|x| val(page, x)).collect(),
            step: r.step.iter().map(|x| val(page, x)).collect(),
        },
        Value::Fn(_) => Val::Fn { name: crate::shader_name(v) },
        Value::View(view) => Val::View { widget: view.widget.to_string(), slot: xtmd_runtime::inline_slot(Some(v)) },
    }
}

/// A value Kotlin gives, in the IR's form: the runtime works it out as it does the app's.
pub fn expr(v: &Val) -> Expr {
    let one = |xs: &[Val]| xs.first().map(expr);
    let fields = |fs: &[Field]| fs.iter().map(|f| (f.name.clone(), expr(&f.value))).collect::<BTreeMap<_, _>>();
    match v {
        Val::Num { n } => Expr::Num(n.clone()),
        Val::Text { s } => Expr::Text(s.clone()),
        Val::Bool { b } => Expr::Bool(*b),
        Val::Duration { ms } => Expr::Duration(ms.clone()),
        Val::Items { items } => Expr::List(items.iter().map(expr).collect()),
        Val::Record { ty, fields: fs } => Expr::Record(ExprRecord { ty: ty.clone(), fields: fields(fs) }),
        Val::Case { ty, name, values, .. } => Expr::Case(ExprCase { enum_: ty.clone(), name: name.clone(), values: fields(values) }),
        Val::Opt { value } => match value.first() {
            Some(x) => Expr::Some(Box::new(expr(x))),
            None => Expr::None(Empty {}),
        },
        Val::Range { low, high, step } => Expr::Range(Box::new(ExprRange { low: one(low), high: one(high), step: one(step) })),
        // a fn or a view can't be written back from outside
        Val::Fn { .. } | Val::View { .. } => Expr::None(Empty {}),
    }
}
