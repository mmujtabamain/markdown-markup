//! [`MkpDoc`]: a document as an egui app holds one, egui's run-time target. It is made from its IR,
//! in hand or read from a path. `$state` is the app's to control ([`MkpDoc::show_controlled`]) or
//! to start from. Every write is checked by mkp, and what is refused comes back to the app. A
//! [`Snapshot`] takes out everything the page holds and puts it back. There is no compiler here:
//! mkp-egui-live compiles a document's text.
//!
//! egui draws every frame, so what a frame did comes back from it, as egui's own widgets answer:
//! [`DocResponse`] has the `$state` if it changed, the app's extern fns the page called, and the
//! errors.

use std::collections::{BTreeMap, HashMap};
use std::path::Path;

use egui::Ui;
use mkp_runtime::ir::{self, Expr};
use mkp_runtime::{Broken, Call, Measure, Page, PageOptions, PageValues, Value, ValueFn};
use serde::{Deserialize, Serialize};

use crate::{fns, MkpPage, Registry};

/// `$state`, or a widget's own variables: values by name, in the IR's form.
pub type State = BTreeMap<String, Expr>;

/// The release snapshots are taken in: one of another can't be read.
pub const RELEASE: &str = "0.3.0";

/// What went wrong, for the app.
#[derive(Clone, Debug, PartialEq)]
pub enum DocError {
    /// A write mkp refused: the app's, or a reader's.
    Refused(Broken),
    /// A handler or a widget that failed.
    Failed(Broken),
    /// An IR that couldn't be had: read, parsed or started.
    Load(String),
    /// A text that didn't compile: a real-time target's (mkp-egui-live).
    Compile(String),
}

impl std::fmt::Display for DocError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        let broken = |b: &Broken| b.rule.clone().or_else(|| b.code.clone()).unwrap_or_default() + &b.site.as_ref().map(|s| format!(" at {}", s)).unwrap_or_default();
        match self {
            DocError::Refused(b) => write!(f, "refused: {}", broken(b)),
            DocError::Failed(b) => write!(f, "failed: {}", broken(b)),
            DocError::Load(m) | DocError::Compile(m) => f.write_str(m),
        }
    }
}

/// Everything the page holds: `$state`, and every widget's own variables by the place it is drawn
/// at. Opaque to the app, which keeps it (it is JSON) and gives it back.
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
pub struct Snapshot {
    pub mkp: String,
    /// A hash of the IR it was taken from: places mean the same widgets only in the same IR.
    pub ir: String,
    pub state: State,
    pub own: BTreeMap<String, State>,
}

/// How much of a snapshot went back.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum RestoredHow {
    /// All of it: the IR is the one it was taken from.
    All,
    /// `$state` only: the IR is another, whose places may be other widgets.
    State,
    /// Nothing: it can't be read, or its `$state` was refused.
    None,
}

/// What [`MkpDoc::restore`] did.
#[derive(Clone, Debug, PartialEq)]
pub struct Restored {
    pub restored: RestoredHow,
    /// What was left out: refused fields and places, or `own` for every widget's variables.
    pub dropped: Vec<String>,
    pub why: Option<String>,
}

/// How a document starts.
#[derive(Default)]
pub struct DocOptions {
    /// The page's own values: its width and theme.
    pub page: PageValues,
    /// `$state` to start from, checked as an app's write is: a field that doesn't fit is refused,
    /// and starts from its default.
    pub state: Option<State>,
    /// A snapshot to start from, instead.
    pub snapshot: Option<Snapshot>,
    /// Each extern channel's values, by its name in the document (`tracker`) or in full.
    pub externs: Vec<(String, State)>,
    /// Value fns the app supplies, by full name, over egui's own.
    pub fns: HashMap<String, ValueFn>,
    /// The widgets: left out, ours ([`Registry::ours`]), with a pack's added by the app.
    pub registry: Option<Registry>,
    /// How the plane's spots are measured: left out, from what egui drew.
    pub measure: Option<Box<dyn Measure>>,
    /// Whether the page's theme follows egui's dark mode (the default), or is the app's to set.
    pub fixed_theme: bool,
    /// For the check adapters only: the runtime's defects to switch on.
    #[doc(hidden)]
    pub defects: Vec<String>,
}

/// What a frame did.
#[derive(Debug, Default)]
pub struct DocResponse {
    /// The page's own response, when it was drawn.
    pub response: Option<egui::Response>,
    /// `$state`, when it changed in this frame.
    pub state: Option<State>,
    /// The app's extern fns the page called.
    pub calls: Vec<Call>,
    /// What was refused or failed.
    pub errors: Vec<DocError>,
}

/// A short, stable hash of a text: FNV-1a, in base 36 (as @mkp/view's).
fn hash(text: &str) -> String {
    let (mut h1, mut h2): (u32, u32) = (0x811c9dc5, 0x01000193);
    for c in text.encode_utf16() {
        h1 = (h1 ^ c as u32).wrapping_mul(16777619);
        h2 = (h2 ^ c as u32).wrapping_mul(2246822519);
    }
    let b36 = |mut n: u64| {
        let digits = b"0123456789abcdefghijklmnopqrstuvwxyz";
        let mut s = Vec::new();
        loop {
            s.push(digits[(n % 36) as usize]);
            n /= 36;
            if n == 0 {
                break;
            }
        }
        s.reverse();
        String::from_utf8(s).unwrap()
    };
    b36((h2 % 0x100000) as u64) + &b36(h1 as u64)
}

/// A channel's full name: `tracker` is the document's own (`doc/tracker`).
fn channel(module: &str, name: &str) -> String {
    if name.contains('/') {
        name.to_string()
    } else {
        format!("{}/{}", module, name)
    }
}

/// A document, drawn by egui.
pub struct MkpDoc {
    view: MkpPage,
    /// The document's module: its channels are named in it.
    module: String,
    defects: Vec<String>,
    hash: String,
    /// The `$state` the app last heard.
    shown: State,
    /// The `$state` the app last gave (show_controlled), so it is written once, not every frame.
    given: Option<State>,
    errors: Vec<DocError>,
}

impl MkpDoc {
    /// A document from its IR in hand.
    pub fn new(file: ir::File, mut opts: DocOptions) -> Result<MkpDoc, DocError> {
        let hash = hash(&serde_json::to_string(&file).unwrap_or_default());
        let module = file.ir.module.clone();
        let mut page = start(file, &mut opts)?;
        let errors = match opts.state.take() {
            Some(given) => give(&mut page, &given, true)?,
            None => Vec::new(),
        };
        let mut view = MkpPage::new(page);
        if let Some(r) = opts.registry.take() {
            view = view.with_registry(r);
        }
        if let Some(m) = opts.measure.take() {
            view = view.with_measure(m);
        }
        view.set_follow_theme(!opts.fixed_theme);
        let shown = view.page().observe_state();
        let mut doc = MkpDoc { view, module, defects: opts.defects.clone(), hash, shown, given: None, errors };
        if let Some(snap) = opts.snapshot.take() {
            doc.restore(&snap);
        }
        Ok(doc)
    }

    /// A document from the IR file `mkp build` wrote, as JSON.
    pub fn from_json(json: &str, opts: DocOptions) -> Result<MkpDoc, DocError> {
        let file: ir::File = serde_json::from_str(json).map_err(|e| DocError::Load(format!("the IR doesn't read: {}", e)))?;
        MkpDoc::new(file, opts)
    }

    /// A document from where its IR is: a file `mkp build` wrote.
    pub fn open(src: impl AsRef<Path>, opts: DocOptions) -> Result<MkpDoc, DocError> {
        let src = src.as_ref();
        let json = std::fs::read_to_string(src).map_err(|e| DocError::Load(format!("the page at {} couldn't be loaded: {}", src.display(), e)))?;
        MkpDoc::from_json(&json, opts)
    }

    /// A new IR for the same document, drawn in its place: `$state` carried over where its fields
    /// still exist and their values still fit (the rest start from their defaults), and the same
    /// widgets, measure and id. `externs` are the channels' values, as at the start.
    pub fn replace(&mut self, file: ir::File, externs: Vec<(String, State)>) -> Result<(), DocError> {
        let carried = self.state();
        self.hash = hash(&serde_json::to_string(&file).unwrap_or_default());
        self.module = file.ir.module.clone();
        let mut page = start(file, &mut DocOptions { externs, defects: self.defects.clone(), ..DocOptions::default() })?;
        let fields = page.observe_state();
        let kept: State = carried.into_iter().filter(|(k, _)| fields.contains_key(k)).collect();
        // what no longer fits isn't the app's write: it starts from its default, unsaid
        let failed = give(&mut page, &kept, false)?;
        self.errors.extend(failed);
        self.view.replace(page);
        self.shown = self.view.page().observe_state();
        self.given = None;
        Ok(())
    }

    /// Draws the page; call it every frame. What the frame did comes back.
    pub fn show(&mut self, ui: &mut Ui) -> DocResponse {
        let response = self.view.show(ui);
        self.heard(Some(response))
    }

    /// Draws the page with `$state` controlled by the app: a `state` the app changed is written
    /// first, checked (refused, it goes back to the page's, and the error is in the response), and
    /// a change the page made is written into `state`.
    pub fn show_controlled(&mut self, ui: &mut Ui, state: &mut State) -> DocResponse {
        if self.given.as_ref() != Some(state) && *state != self.view.page().observe_state() {
            if let Err(e) = self.set(state.clone()) {
                self.errors.push(e);
            }
        }
        let r = self.show(ui);
        *state = self.view.page().observe_state();
        self.given = Some(state.clone());
        r
    }

    /// Writes `$state`'s fields as one change, checked: refused whole, or done.
    pub fn set(&mut self, changes: State) -> Result<(), DocError> {
        let values = self.values(&changes)?;
        let page = self.view.page_mut();
        page.set(values).map_err(|f| DocError::Failed(Broken { rule: None, code: Some(f.message), site: None }))?;
        // a widget that failed as the page redrew is told with the next frame
        let o = page.take_outcome();
        self.errors.extend(o.failures.into_iter().map(DocError::Failed));
        match o.refused.into_iter().next() {
            Some(b) => Err(DocError::Refused(b)),
            None => Ok(()),
        }
    }

    /// `$state` now.
    pub fn state(&self) -> State {
        self.view.page().observe_state()
    }

    /// The page as Markdown, with the values it has now.
    pub fn markdown(&self) -> String {
        self.view.page().markdown().unwrap_or_default()
    }

    /// Calls a fn the document exposes.
    pub fn expose(&mut self, channel_name: &str, name: &str, args: Vec<Expr>) -> Result<(), DocError> {
        let args = args.iter().map(|x| self.view.page().value(x)).collect::<Result<Vec<Value>, _>>().map_err(|f| DocError::Load(f.message))?;
        let c = channel(&self.module, channel_name);
        self.view.page_mut().expose(&c, name, args).map_err(|f| DocError::Failed(Broken { rule: None, code: Some(f.message), site: None }))
    }

    /// Gives an extern channel new values.
    pub fn set_extern(&mut self, channel_name: &str, values: State) -> Result<(), DocError> {
        let values: Vec<(String, Value)> = values.into_iter().map(|(k, x)| self.view.page().value(&x).map(|v| (k, v))).collect::<Result<_, _>>().map_err(|f| DocError::Load(f.message))?;
        let c = channel(&self.module, channel_name);
        self.view.page_mut().set_extern(&c, values).map_err(|f| DocError::Failed(Broken { rule: None, code: Some(f.message), site: None }))
    }

    /// The page's own values: its width and theme.
    pub fn set_page(&mut self, page: PageValues) {
        if let Err(f) = self.view.page_mut().set_page(page) {
            self.errors.push(DocError::Failed(Broken { rule: None, code: Some(f.message), site: None }));
        }
    }

    /// Everything the page holds now.
    pub fn snapshot(&self) -> Snapshot {
        Snapshot { mkp: RELEASE.into(), ir: self.hash.clone(), state: self.state(), own: self.view.page().observe_own() }
    }

    /// Puts a snapshot back: with the same IR, all of it; with another, `$state` only. `$state`
    /// goes back as one checked write.
    pub fn restore(&mut self, snap: &Snapshot) -> Restored {
        if snap.mkp != RELEASE {
            return Restored { restored: RestoredHow::None, dropped: Vec::new(), why: Some(format!("a snapshot this mkp ({}) can't read", RELEASE)) };
        }
        if let Err(e) = self.set(snap.state.clone()) {
            let dropped = match &e {
                DocError::Refused(b) => vec![b.site.clone().or_else(|| b.rule.clone()).unwrap_or_else(|| "$state".into())],
                _ => vec!["$state".into()],
            };
            let why = Some(e.to_string());
            self.errors.push(e);
            return Restored { restored: RestoredHow::None, dropped, why };
        }
        if snap.ir != self.hash {
            return Restored { restored: RestoredHow::State, dropped: vec!["own".into()], why: None };
        }
        match self.view.page_mut().restore_own(&snap.own) {
            Ok(left) => Restored { restored: RestoredHow::All, dropped: left, why: None },
            Err(f) => Restored { restored: RestoredHow::State, dropped: vec!["own".into()], why: Some(f.message) },
        }
    }

    /// The running page.
    pub fn page(&self) -> &Page {
        self.view.page()
    }

    /// What draws it: to act on a widget through its own controls, as the checks do.
    pub fn view(&self) -> &MkpPage {
        &self.view
    }

    pub fn view_mut(&mut self) -> &mut MkpPage {
        &mut self.view
    }

    /// What happened since the last frame, for the app.
    pub fn heard(&mut self, response: Option<egui::Response>) -> DocResponse {
        let page = self.view.page_mut();
        let state = page.observe_state();
        let changed = (state != self.shown).then(|| state.clone());
        self.shown = state;
        let calls = page.take_calls();
        let o = page.take_outcome();
        let mut errors = std::mem::take(&mut self.errors);
        errors.extend(o.refused.into_iter().map(DocError::Refused));
        errors.extend(o.failures.into_iter().map(DocError::Failed));
        DocResponse { response, state: changed, calls, errors }
    }

    fn values(&self, xs: &State) -> Result<Vec<(String, Value)>, DocError> {
        let page = self.view.page();
        xs.iter()
            .map(|(k, x)| page.value(x).map(|v| (k.clone(), v)).map_err(|_| DocError::Refused(Broken { rule: None, code: Some("contracts.outside".into()), site: Some(format!("$state.{}", k)) })))
            .collect()
    }
}

/// A page from its IR: egui's value fns with the app's over them, and the externs by their full
/// names.
fn start(file: ir::File, opts: &mut DocOptions) -> Result<Page, DocError> {
    let module = file.ir.module.clone();
    let mut fns = fns::egui_fns();
    fns.extend(opts.fns.drain());
    let externs = opts.externs.iter().map(|(c, values)| (channel(&module, c), values.iter().map(|(k, x)| (k.clone(), x.clone())).collect())).collect();
    Page::new(file, PageOptions { page: opts.page, externs, fns, defects: opts.defects.clone(), ..PageOptions::default() }).map_err(|f| DocError::Load(format!("the page couldn't start: {}", f.message)))
}

/// `$state` as the app gives it, checked as an app's write is: all together, or else each field
/// that fits and keeps the rules, one at a time. What was refused, when `tell`.
fn give(page: &mut Page, given: &State, tell: bool) -> Result<Vec<DocError>, DocError> {
    let mut errors = Vec::new();
    let mut values = Vec::new();
    for (k, x) in given {
        match page.value(x) {
            Ok(v) => values.push((k.clone(), v)),
            Err(_) => errors.push(DocError::Refused(Broken { rule: None, code: Some("contracts.outside".into()), site: Some(format!("$state.{}", k)) })),
        }
    }
    if values.is_empty() {
        if !tell {
            errors.clear();
        }
        return Ok(errors);
    }
    page.set(values.clone()).map_err(|f| DocError::Load(f.message))?;
    let o = page.take_outcome();
    let mut failed: Vec<DocError> = o.failures.into_iter().map(DocError::Failed).collect();
    if !o.refused.is_empty() {
        for (k, v) in values {
            page.set(vec![(k, v)]).map_err(|f| DocError::Load(f.message))?;
            let o = page.take_outcome();
            errors.extend(o.refused.into_iter().map(DocError::Refused));
            failed.extend(o.failures.into_iter().map(DocError::Failed));
        }
    }
    // what failed is told either way: it isn't the app's write that was wrong
    if !tell {
        errors.clear();
    }
    errors.extend(failed);
    Ok(errors)
}
