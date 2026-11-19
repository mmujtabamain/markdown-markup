//! Extended Mark's native runtime for Android: [`xtmd_runtime::Page`] behind a UniFFI interface. uniffi-bindgen
//! writes the Kotlin bindings from this library (`xtmd.android.ffi`), and xtmd-android
//! (targets/android/compose) draws the page's tree with Compose through them.
//!
//! - **One handle, [`NativePage`],** holds a running page. Kotlin reads its tree after each change
//!   ([`NativePage::revision`] moves), and every change goes in as one call: one transaction, checked,
//!   and undone when it fails. A call that crosses into Rust does everything a change needs and
//!   brings the new tree back in one batch.
//! - **Values cross as [`Val`]:** exact decimals as text, records with their fields in order, and
//!   token cases with the build's value for them, so a composable never calls back while it draws.
//! - **The checks** load, step and observe through the `*_json` methods, in the check protocol's
//!   own JSON, so an observation is the same bytes the other targets' adapters send.

uniffi::setup_scaffolding!();

mod convert;
mod diff;
mod fns;
mod observe;

use std::collections::{BTreeMap, HashMap};
use std::fmt;
use std::rc::Rc;
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::{Arc, Mutex, MutexGuard};

use xtmd_ir::ir::{self, Expr, Stmt};
use xtmd_runtime::{Drawn, Num, Page, PageOptions, PageTheme, PageValues, PageWidth, Value};

pub use convert::{Field, Val};

/// Why a call failed: the IR doesn't read, a value isn't one, or Extended Mark code failed.
#[derive(Debug, uniffi::Error)]
pub enum XtmdError {
    Failed { why: String },
}

impl fmt::Display for XtmdError {
    fn fmt(&self, f: &mut fmt::Formatter) -> fmt::Result {
        match self {
            XtmdError::Failed { why } => f.write_str(why),
        }
    }
}

impl std::error::Error for XtmdError {}

fn failed(message: impl Into<String>) -> XtmdError {
    XtmdError::Failed { why: message.into() }
}

impl From<xtmd_eval::num::NumError> for XtmdError {
    fn from(e: xtmd_eval::num::NumError) -> Self {
        failed(e.to_string())
    }
}

impl From<xtmd_runtime::Failure> for XtmdError {
    fn from(f: xtmd_runtime::Failure) -> Self {
        failed(f.message)
    }
}

type Res<T> = Result<T, XtmdError>;

/// A drawn extern widget, as the page asks a target to draw it: its props worked out.
#[derive(Clone, Debug, uniffi::Record)]
pub struct Node {
    /// Who it is on this draw: the sites of the instances it is in, loop rows by position.
    pub path: String,
    /// Who it is across redraws: a loop row's widgets follow its item. Compose keys by this.
    pub key: String,
    /// Its full name: `core/press`.
    pub widget: String,
    pub props: HashMap<String, Val>,
    /// Its slots, in the order the widget declares them, each with its widgets in order.
    pub slots: Vec<Slot>,
    /// The events its caller set to a handler that does something: what makes it clickable.
    pub listens: Vec<String>,
    /// The events its caller set at all.
    pub events: Vec<String>,
    /// Its `mut` inputs given a variable: what it writes back to.
    pub writes: Vec<String>,
    /// From [`NativePage::tree_update`]: this widget and everything in its slots are as they were
    /// when the tree was last read, so this node is a stub (its props and slots left out) for the
    /// node with this key that the reader holds.
    pub same: bool,
}

#[derive(Clone, Debug, uniffi::Record)]
pub struct Slot {
    pub name: String,
    pub nodes: Vec<Node>,
}

/// A size on the page, in its own lengths: dp on Android.
#[derive(Clone, Copy, Debug, uniffi::Record)]
pub struct Extent {
    pub width: f64,
    pub height: f64,
}

/// What the target tells the plane's layout: each spot's child's size, and the width a plane
/// is given when it says none, in dp. Called while the page lays out, so it must not call the
/// page back: the node it is given holds everything it needs.
#[uniffi::export(callback_interface)]
pub trait Measure: Send + Sync {
    fn spot(&self, spot: Node) -> Extent;
    fn plane_width(&self, plane: Node) -> f64;
}

/// Where the reader is in time, for `core/moment.local`: the zone's offset from UTC, in
/// minutes east, at an instant (minutes since 1970-01-01T00:00 UTC). The checks' zone is UTC.
#[uniffi::export(callback_interface)]
pub trait Zone: Send + Sync {
    fn offset_minutes(&self, utc_minutes: i64) -> i32;
}

/// The value fns an app supplies (a page's `extern fn` that gives a value): called with the fn's
/// full name and its arguments, mid-change, so it must not call the page back. None is a fn that
/// can't answer, a failure of the page's.
#[uniffi::export(callback_interface)]
pub trait AppFns: Send + Sync {
    fn call(&self, name: String, args: Vec<Val>) -> Option<Val>;
}

/// A rule a write broke, or a failure: its rule's message or its code, and where.
#[derive(Clone, Debug, PartialEq, uniffi::Record)]
pub struct Broken {
    pub code: Option<String>,
    pub rule: Option<String>,
    pub site: Option<String>,
}

/// What the page refused and what failed, since they were last taken.
#[derive(Clone, Debug, Default, PartialEq, uniffi::Record)]
pub struct Outcome {
    pub refused: Vec<Broken>,
    pub failures: Vec<Broken>,
}

/// How a page starts: what the app tells it, and what the target draws.
#[derive(Clone, Debug, Default, uniffi::Record)]
pub struct PageInit {
    /// `NARROW`, `MEDIUM` or `WIDE`.
    pub width: Option<String>,
    /// `LIGHT` or `DARK`.
    pub theme: Option<String>,
    /// `$state`'s values over its starting ones, as the IR writes values: `{"count": {"num": "3"}}`.
    pub state_json: Option<String>,
    /// Each channel's values: `{"doc/scores": {"unit": {"text": "pts"}}}`.
    pub externs_json: Option<String>,
    /// The extern widgets the target draws, by full name or as a whole pack as `pack/` and a star; one it doesn't shows its
    /// Markdown. Left out, every one is drawn.
    pub supplies: Option<Vec<String>>,
    /// The test targets' defects, for the checks only.
    pub defects: Vec<String>,
}

/// A slider's ends and step: from its `range`, else its variable's contract, else 0..1, as
/// @extended-mark/dom works them out.
#[derive(Clone, Debug, uniffi::Record)]
pub struct Ends {
    pub low: String,
    pub high: String,
    pub step: String,
}

/// Where a page's time went, since it was mounted: in the runtime (each change, its redraw and
/// the plane's layout) and in turning its tree into `Node`s for Kotlin. For measuring.
#[derive(Clone, Copy, Debug, Default, uniffi::Record)]
pub struct Timings {
    pub runtime_nanos: u64,
    pub runtime_calls: u64,
    pub convert_nanos: u64,
    pub convert_calls: u64,
}

/// An extern fn of the app Extended Mark called: its full name (`doc/scores.saved`) and its arguments.
#[derive(Clone, Debug, uniffi::Record)]
pub struct ExternCall {
    pub name: String,
    pub args: Vec<Val>,
}

struct Inner {
    page: Page,
    /// Time spent in the runtime (changes, redraws, layouts) and turning the tree into `Node`s.
    timings: Timings,
    /// The IR's type aliases, for a slider's variable's contract.
    aliases: HashMap<String, ir::Type>,
    /// The tree as Kotlin last read it, the events each widget listened to then, and the
    /// revision it was read at: what [`NativePage::tree_update`] sends the changes since.
    sent: Vec<Drawn>,
    listening: HashMap<String, Vec<String>>,
    sent_revision: Option<u64>,
}

impl Inner {
    /// Remembers the tree as Kotlin has just read it.
    fn sent_now(&mut self) {
        fn walk(page: &Page, nodes: &[Drawn], out: &mut HashMap<String, Vec<String>>) {
            for d in nodes {
                out.insert(d.key.clone(), d.events.keys().filter(|e| page.listens(d, e)).cloned().collect());
                for kids in d.slots.values() {
                    walk(page, kids, out);
                }
            }
        }
        let mut listening = HashMap::new();
        walk(&self.page, self.page.tree(), &mut listening);
        self.listening = listening;
        self.sent = self.page.tree().to_vec();
        self.sent_revision = Some(self.page.revision());
    }
}

/// The page lives on one thread at a time behind the lock; nothing of it (an `Rc`) is handed out.
struct Locked(Inner);
unsafe impl Send for Locked {}

/// A running page.
#[derive(uniffi::Object)]
pub struct NativePage {
    inner: Mutex<Locked>,
    /// The thread holding the lock, so a call back into the page from inside it (a Measure's)
    /// is an error instead of waiting for itself. Another thread waits its turn.
    owner: AtomicU64,
}

/// A thread's number, for [`NativePage::owner`]: never 0.
fn thread_number() -> u64 {
    use std::sync::atomic::AtomicU64 as Counter;
    static NEXT: Counter = Counter::new(1);
    thread_local!(static ME: u64 = NEXT.fetch_add(1, Ordering::Relaxed));
    ME.with(|m| *m)
}

/// The page while one call has it: gives it back, and forgets its owner, when dropped.
struct Held<'a> {
    guard: MutexGuard<'a, Locked>,
    owner: &'a AtomicU64,
}

impl Drop for Held<'_> {
    fn drop(&mut self) {
        self.owner.store(0, Ordering::SeqCst);
    }
}

fn page_values(width: Option<&str>, theme: Option<&str>) -> PageValues {
    PageValues {
        width: match width {
            Some("NARROW") => Some(PageWidth::Narrow),
            Some("MEDIUM") => Some(PageWidth::Medium),
            Some("WIDE") => Some(PageWidth::Wide),
            _ => None,
        },
        theme: match theme {
            Some("LIGHT") => Some(PageTheme::Light),
            Some("DARK") => Some(PageTheme::Dark),
            _ => None,
        },
    }
}

fn exprs(json: &str) -> Res<Vec<(String, Expr)>> {
    let m: BTreeMap<String, Expr> = serde_json::from_str(json).map_err(|e| failed(format!("not values: {}", e)))?;
    Ok(m.into_iter().collect())
}

fn expr_json(json: &str) -> Res<Expr> {
    serde_json::from_str(json).map_err(|e| failed(format!("not a value: {}", e)))
}

/// Whether a widget is in a supplies list: by its name, or its pack's a whole pack as `pack/` and a star.
fn supplied(list: &[String], widget: &str) -> bool {
    list.iter().any(|s| s == widget || s.strip_suffix("/*").map_or(false, |pack| widget.strip_prefix(pack).map_or(false, |rest| rest.starts_with('/'))))
}

fn supplies_fn(list: Option<Vec<String>>) -> Option<xtmd_runtime::Supplies> {
    list.map(|l| Rc::new(move |w: &str| supplied(&l, w)) as xtmd_runtime::Supplies)
}

/// A drawn widget as Kotlin reads it, without its slots.
pub(crate) fn node_shallow(page: &Page, d: &Drawn) -> Node {
    Node {
        path: d.path.clone(),
        key: d.key.clone(),
        widget: d.widget.clone(),
        props: d.props.iter().map(|(k, v)| (k.clone(), convert::val(page, v))).collect(),
        slots: Vec::new(),
        listens: d.events.keys().filter(|e| page.listens(d, e)).cloned().collect(),
        events: d.events.keys().cloned().collect(),
        writes: d.writes.keys().cloned().collect(),
        same: false,
    }
}

/// A drawn widget as Kotlin reads it, with everything in its slots.
fn node(page: &Page, d: &Drawn) -> Node {
    let mut n = node_shallow(page, d);
    n.slots = d.slots.iter().map(|(name, kids)| Slot { name: name.clone(), nodes: kids.iter().map(|k| node(page, k)).collect() }).collect();
    n
}

/// A shader's name: a named fn is lowered to a lambda that calls it with its own parameters
/// (as xtmd-runtime names it in `observe_shaded`).
pub(crate) fn shader_name(f: &Value) -> String {
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

/// A length Kotlin measured, as an exact number: dp to a hundredth, so a box doesn't move by
/// rounding noise.
fn num_of(x: f64) -> Num {
    let x = if x.is_finite() { (x * 100.0).round() / 100.0 } else { 0.0 };
    if x.fract() == 0.0 && x.abs() < 1e15 {
        Num::int(x as i64)
    } else {
        Num::parse(&format!("{}", x)).unwrap_or_else(Num::zero)
    }
}

struct MeasureFrom<'a>(&'a dyn Measure);

impl xtmd_runtime::Measure for MeasureFrom<'_> {
    fn spot(&mut self, page: &Page, spot: &Drawn) -> xtmd_runtime::Size {
        let e = self.0.spot(node(page, spot));
        xtmd_runtime::Size { width: num_of(e.width), height: num_of(e.height) }
    }

    fn plane_width(&mut self, page: &Page, plane: &Drawn) -> Num {
        num_of(self.0.plane_width(node(page, plane)))
    }
}

fn num_text(v: &Value) -> Option<Num> {
    match v {
        Value::Num(n) => Some(*n),
        Value::Opt(Some(x)) => num_text(x),
        _ => None,
    }
}

impl NativePage {
    fn lock(&self) -> Res<Held<'_>> {
        // the page is never called from inside its own call (a Measure's): that would wait for itself
        let me = thread_number();
        if self.owner.load(Ordering::SeqCst) == me {
            return Err(failed("the page is busy: a Measure or Zone called it back"));
        }
        let guard = self.inner.lock().unwrap_or_else(|e| e.into_inner());
        self.owner.store(me, Ordering::SeqCst);
        Ok(Held { guard, owner: &self.owner })
    }

    fn with<T>(&self, f: impl FnOnce(&mut Inner) -> Res<T>) -> Res<T> {
        let mut g = self.lock()?;
        f(&mut g.guard.0)
    }

    /// A change: timed as the runtime's.
    fn change<T>(&self, f: impl FnOnce(&mut Inner) -> Res<T>) -> Res<T> {
        let mut g = self.lock()?;
        let started = std::time::Instant::now();
        let out = f(&mut g.guard.0);
        let t = &mut g.guard.0.timings;
        t.runtime_nanos += started.elapsed().as_nanos() as u64;
        t.runtime_calls += 1;
        out
    }
}

#[uniffi::export]
impl NativePage {
    /// Mounts a page from the IR file `xtmd build` writes, as JSON, and draws it once. `zone`
    /// gives `core/moment.local` the reader's offset.
    #[uniffi::constructor]
    pub fn new(ir_json: String, init: PageInit, zone: Box<dyn Zone>) -> Res<Arc<Self>> {
        NativePage::start(ir_json, init, zone, None)
    }

    /// As [`NativePage::new`], with the value fns the app supplies, by full name (`acme/rate`).
    #[uniffi::constructor]
    pub fn with_fns(ir_json: String, init: PageInit, zone: Box<dyn Zone>, names: Vec<String>, fns: Box<dyn AppFns>) -> Res<Arc<Self>> {
        NativePage::start(ir_json, init, zone, Some((names, Arc::from(fns))))
    }
}

impl NativePage {
    fn start(ir_json: String, init: PageInit, zone: Box<dyn Zone>, app: Option<(Vec<String>, Arc<dyn AppFns>)>) -> Res<Arc<Self>> {
        let file: ir::File = serde_json::from_str(&ir_json).map_err(|e| failed(format!("the IR doesn't read: {}", e)))?;
        let aliases = file.ir.declarations.iter().filter_map(|d| match &d.declare {
            ir::Decl::Type(a) => Some((a.name.clone(), a.is.clone())),
            _ => None,
        }).collect();
        let mut opts = PageOptions { page: page_values(init.width.as_deref(), init.theme.as_deref()), defects: init.defects.clone(), ..PageOptions::default() };
        if let Some(s) = &init.state_json {
            opts.state = exprs(s)?;
        }
        if let Some(x) = &init.externs_json {
            let m: BTreeMap<String, BTreeMap<String, Expr>> = serde_json::from_str(x).map_err(|e| failed(format!("not channel values: {}", e)))?;
            opts.externs = m.into_iter().map(|(c, v)| (c, v.into_iter().collect())).collect();
        }
        opts.fns = fns::target_fns(Arc::from(zone));
        if let Some((names, app)) = app {
            for name in names {
                let (app, called) = (app.clone(), name.clone());
                let f: xtmd_runtime::ValueFn = Rc::new(move |m, args| {
                    let given = args.iter().map(|a| convert::val_in(None, a)).collect();
                    match app.call(called.clone(), given) {
                        Some(v) => Ok(Some(m.eval(&convert::expr(&v))?)),
                        None => Err(xtmd_runtime::Failure::new(xtmd_runtime::FailKind::NotConstant, format!("{} gave no value", called))),
                    }
                });
                opts.fns.insert(name, f);
            }
        }
        opts.supplies = supplies_fn(init.supplies);
        let page = Page::new(file, opts)?;
        Ok(Arc::new(NativePage { inner: Mutex::new(Locked(Inner { page, aliases, timings: Timings::default(), sent: Vec::new(), listening: HashMap::new(), sent_revision: None })), owner: AtomicU64::new(0) }))
    }
}

#[uniffi::export]
impl NativePage {

    // ---- reading it

    /// How many times the page has been drawn: read the tree again when it moves.
    pub fn revision(&self) -> u64 {
        self.lock().map(|g| g.guard.0.page.revision()).unwrap_or(0)
    }

    /// How many changes came from outside the layout.
    pub fn changes(&self) -> u64 {
        self.lock().map(|g| g.guard.0.page.changes()).unwrap_or(0)
    }

    /// The drawn extern widgets, in order, with their props worked out.
    pub fn tree(&self) -> Res<Vec<Node>> {
        self.with(|i| {
            let started = std::time::Instant::now();
            let out: Vec<Node> = i.page.tree().iter().map(|d| node(&i.page, d)).collect();
            i.sent_now();
            i.timings.convert_nanos += started.elapsed().as_nanos() as u64;
            i.timings.convert_calls += 1;
            Ok(out)
        })
    }

    /// The drawn widgets, as [`NativePage::tree`] gives them, but with each widget that is as it
    /// was when the tree was read at revision `since` (and everything in its slots) left as a stub,
    /// `same: true`, for the node with its key the reader holds. Read at any other revision than
    /// the last one this page sent, every node is whole.
    pub fn tree_update(&self, since: u64) -> Res<Vec<Node>> {
        self.with(|i| {
            let started = std::time::Instant::now();
            let out: Vec<Node> = if i.sent_revision == Some(since) {
                let d = diff::Diff::new(&i.page, &i.sent, &i.listening);
                i.page.tree().iter().map(|n| d.node(n).0).collect()
            } else {
                i.page.tree().iter().map(|d| node(&i.page, d)).collect()
            };
            i.sent_now();
            i.timings.convert_nanos += started.elapsed().as_nanos() as u64;
            i.timings.convert_calls += 1;
            Ok(out)
        })
    }

    /// Where the page's time went, since it was mounted.
    pub fn timings(&self) -> Timings {
        self.lock().map(|g| g.guard.0.timings).unwrap_or_default()
    }

    /// The drawn widget at a path.
    pub fn node(&self, path: String) -> Res<Option<Node>> {
        self.with(|i| Ok(i.page.find(&path).map(|d| node(&i.page, d))))
    }

    /// The page as Markdown, with the values it has now: the same text on every target.
    pub fn markdown(&self) -> Res<String> {
        self.with(|i| Ok(i.page.markdown()?))
    }

    /// The extern widgets this page uses that the target doesn't supply: each shows its Markdown.
    pub fn missing(&self) -> Res<Vec<String>> {
        self.with(|i| Ok(i.page.missing()))
    }

    /// One of `$state`'s values.
    pub fn state(&self, name: String) -> Res<Option<Val>> {
        self.with(|i| Ok(i.page.state_value(&name).map(|v| convert::val(&i.page, &v))))
    }

    /// The app's extern fns Extended Mark called since they were last taken.
    pub fn take_calls(&self) -> Res<Vec<ExternCall>> {
        self.with(|i| {
            let calls = i.page.take_calls();
            let mut out = Vec::new();
            for c in calls {
                let mut args = Vec::new();
                for a in &c.call.args {
                    args.push(convert::val(&i.page, &i.page.value(a)?));
                }
                out.push(ExternCall { name: c.call.name.clone(), args });
            }
            Ok(out)
        })
    }

    /// What was refused and what failed since they were last taken: what a document tells the app.
    pub fn take_outcome(&self) -> Res<Outcome> {
        self.with(|i| {
            let o = i.page.take_outcome();
            let one = |b: xtmd_runtime::Broken| Broken { code: b.code, rule: b.rule, site: b.site };
            Ok(Outcome { refused: o.refused.into_iter().map(one).collect(), failures: o.failures.into_iter().map(one).collect() })
        })
    }

    /// `$state` as it is now, in the IR's form: `{"count": {"num": "3"}}`.
    pub fn state_json(&self) -> Res<String> {
        self.with(|i| serde_json::to_string(&i.page.observe_state()).map_err(|e| failed(e.to_string())))
    }

    /// Every widget's own variables, by the place it is drawn at, in the IR's form: with
    /// `$state`, what a snapshot holds.
    pub fn own_json(&self) -> Res<String> {
        self.with(|i| serde_json::to_string(&i.page.observe_own()).map_err(|e| failed(e.to_string())))
    }

    /// Widgets' own variables put back by place, as one change, each checked: the `place.name`s
    /// that didn't fit, or whose widget isn't drawn there, come back.
    pub fn restore_own_json(&self, own_json: String) -> Res<Vec<String>> {
        self.change(|i| {
            let own: BTreeMap<String, BTreeMap<String, Expr>> = serde_json::from_str(&own_json).map_err(|e| failed(format!("not widgets' variables: {}", e)))?;
            Ok(i.page.restore_own(&own)?)
        })
    }

    /// Every failure caught since they were last taken, with its message, for the app's log.
    pub fn take_errors(&self) -> Res<Vec<String>> {
        self.with(|i| Ok(i.page.take_errors().into_iter().map(|f| format!("{}: {}", xtmd_runtime::failure_code(&f), f.message)).collect()))
    }

    /// A slider's ends and step, worked out exactly.
    pub fn slider_ends(&self, path: String) -> Res<Ends> {
        self.with(|i| {
            let page = &i.page;
            let d = page.find(&path).ok_or_else(|| failed(format!("nothing is drawn at {}", path)))?;
            let mut low = None;
            let mut high = None;
            let mut step = None;
            if let Some(Value::Range(r)) = d.props.get("range").map(|v| match v {
                Value::Opt(Some(x)) => (**x).clone(),
                other => other.clone(),
            }) {
                low = r.low.as_ref().and_then(num_text);
                high = r.high.as_ref().and_then(num_text);
                step = r.step.as_ref().and_then(num_text);
            }
            // then the variable's contract, its aliases' included: `int 0..10` is 0, 10, 1
            let mut t = page.write_type(d, "value");
            let n = |x: &Option<Expr>| x.as_ref().and_then(|x| page.value(x).ok()).as_ref().and_then(num_text);
            for _ in 0..16 {
                let Some(ty) = t else { break };
                if let Some(c) = &ty.contract {
                    if low.is_none() {
                        low = c.range.as_ref().and_then(|r| n(&r.low));
                    }
                    if high.is_none() {
                        high = c.range.as_ref().and_then(|r| n(&r.high));
                    }
                    if step.is_none() {
                        step = n(&c.step);
                    }
                }
                t = i.aliases.get(&ty.name).cloned();
            }
            let low = low.unwrap_or_else(Num::zero);
            let mut high = high.filter(|h| *h > low);
            if high.is_none() {
                high = Some(match step {
                    Some(s) => low.add(s.mul(Num::int(10))?)?,
                    None => low.add(Num::int(1))?,
                });
            }
            let high = high.unwrap();
            let step = match step.filter(|s| *s > Num::zero()) {
                Some(s) => s,
                // no step anywhere: a hundredth of the way, so a drag writes a number a person would
                None => high.sub(low)?.div(Num::int(100))?,
            };
            Ok(Ends { low: low.show(), high: high.show(), step: step.show() })
        })
    }

    /// The colours a `shade` paints: `cols` by `rows` pixels over its area, each worked out by
    /// its shader at the pixel's middle, as ARGB, row by row from the top. A pixel whose shader
    /// fails is transparent.
    pub fn shade(&self, path: String, cols: u32, rows: u32) -> Res<Vec<i32>> {
        self.with(|i| fns::shade(&i.page, &path, cols, rows))
    }

    // ---- changing it: each call is one change

    /// The reader's event on a drawn widget: runs its caller's handler.
    pub fn event(&self, path: String, name: String, args: Vec<Val>) -> Res<()> {
        self.change(|i| {
            let args = args.iter().map(|a| i.page.value(&convert::expr(a))).collect::<Result<Vec<_>, _>>()?;
            Ok(i.page.event(&path, &name, args)?)
        })
    }

    /// A drawn widget writing one of its `mut` inputs, as a slider does: checked, then one change.
    pub fn write(&self, path: String, input: String, value: Val) -> Res<()> {
        self.change(|i| {
            let v = i.page.value(&convert::expr(&value))?;
            Ok(i.page.write(&path, &input, v)?)
        })
    }

    /// The app's write to `$state`: one change, checked once.
    pub fn set(&self, changes: Vec<Field>) -> Res<()> {
        self.change(|i| {
            let changes = changes.iter().map(|f| Ok((f.name.clone(), i.page.value(&convert::expr(&f.value))?))).collect::<Res<Vec<_>>>()?;
            Ok(i.page.set(changes)?)
        })
    }

    /// The app calling a fn the document exposes.
    pub fn expose(&self, channel: String, name: String, args: Vec<Val>) -> Res<()> {
        self.change(|i| {
            let args = args.iter().map(|a| i.page.value(&convert::expr(a))).collect::<Result<Vec<_>, _>>()?;
            Ok(i.page.expose(&channel, &name, args)?)
        })
    }

    /// The app giving a channel's values.
    pub fn set_extern(&self, channel: String, values: Vec<Field>) -> Res<()> {
        self.change(|i| {
            let values = values.iter().map(|f| Ok((f.name.clone(), i.page.value(&convert::expr(&f.value))?))).collect::<Res<Vec<_>>>()?;
            Ok(i.page.set_extern(&channel, values)?)
        })
    }

    /// The page's own values: its width (`NARROW`, `MEDIUM`, `WIDE`) and theme (`LIGHT`, `DARK`).
    pub fn set_page(&self, width: Option<String>, theme: Option<String>) -> Res<()> {
        self.change(|i| Ok(i.page.set_page(page_values(width.as_deref(), theme.as_deref()))?))
    }

    /// Which extern widgets the target draws, from its registry: by full name or a whole pack as `pack/` and a star.
    pub fn set_supplies(&self, supplies: Option<Vec<String>>) -> Res<()> {
        self.change(|i| Ok(i.page.set_supplies(supplies_fn(supplies))?))
    }

    /// Lays the page's planes out until nothing changes, from the target's measure.
    pub fn layout(&self, measure: Box<dyn Measure>) -> Res<()> {
        self.change(|i| Ok(i.page.layout(&mut MeasureFrom(measure.as_ref()))?))
    }

    // ---- the checks: the check protocol's own JSON, in and out

    /// A value in the IR's form (`{"num": "35"}`), worked out on this page.
    pub fn value_json(&self, json: String) -> Res<Val> {
        self.with(|i| {
            let v = i.page.value(&expr_json(&json)?)?;
            Ok(convert::val(&i.page, &v))
        })
    }

    /// `event`, its arguments in the IR's form (a JSON list).
    pub fn event_json(&self, path: String, name: String, args_json: String) -> Res<()> {
        self.change(|i| {
            let xs: Vec<Expr> = serde_json::from_str(&args_json).map_err(|e| failed(format!("not values: {}", e)))?;
            let args = xs.iter().map(|x| i.page.value(x)).collect::<Result<Vec<_>, _>>()?;
            Ok(i.page.event(&path, &name, args)?)
        })
    }

    /// `write`, its value in the IR's form.
    pub fn write_json(&self, path: String, input: String, value_json: String) -> Res<()> {
        self.change(|i| {
            let v = i.page.value(&expr_json(&value_json)?)?;
            Ok(i.page.write(&path, &input, v)?)
        })
    }

    /// `set`, `$state`'s values in the IR's form (a JSON object).
    pub fn set_json(&self, state_json: String) -> Res<()> {
        self.change(|i| {
            let changes = exprs(&state_json)?.into_iter().map(|(k, x)| Ok((k, i.page.value(&x)?))).collect::<Res<Vec<_>>>()?;
            Ok(i.page.set(changes)?)
        })
    }

    /// `expose`, its arguments in the IR's form (a JSON list).
    pub fn expose_json(&self, channel: String, name: String, args_json: String) -> Res<()> {
        self.change(|i| {
            let xs: Vec<Expr> = serde_json::from_str(&args_json).map_err(|e| failed(format!("not values: {}", e)))?;
            let args = xs.iter().map(|x| i.page.value(x)).collect::<Result<Vec<_>, _>>()?;
            Ok(i.page.expose(&channel, &name, args)?)
        })
    }

    /// `extern`, the channel's values in the IR's form (a JSON object).
    pub fn extern_json(&self, channel: String, values_json: String) -> Res<()> {
        self.change(|i| {
            let values = exprs(&values_json)?.into_iter().map(|(k, x)| Ok((k, i.page.value(&x)?))).collect::<Res<Vec<_>>>()?;
            Ok(i.page.set_extern(&channel, values)?)
        })
    }

    /// Everything a check observes after a step, as the check protocol's JSON: the tree (only
    /// the widgets in `drawn`, when it is given: what the target actually drew), `$state`, the
    /// extern calls and the outcome since the last observation, the Markdown, the spots' boxes
    /// and the shades.
    pub fn observe_json(&self, drawn: Option<Vec<String>>) -> Res<String> {
        self.with(|i| observe::observe(&mut i.page, drawn))
    }
}

/// Whether `widget` is in `supplies` (by full name or a whole pack as `pack/` and a star): what a registry says it draws.
#[uniffi::export]
pub fn supplies_widget(supplies: Vec<String>, widget: String) -> bool {
    supplied(&supplies, &widget)
}
