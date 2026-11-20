//! # xtmd-egui
//!
//! Extended Mark's desktop target: pages run on the native runtime ([`xtmd_runtime`]) and drawn with egui.
//!
//! ```no_run
//! # fn app(ui: &mut egui::Ui, json: &str) {
//! use xtmd_egui::{XtmdPage, runtime::{Page, PageOptions}};
//! // once: the IR `xtmd build page.xtmd --out page.ir.json` wrote
//! let mut page = XtmdPage::new(Page::from_json(json, XtmdPage::options()).unwrap());
//! // every frame:
//! page.show(ui);
//! # }
//! ```
//!
//! - [`XtmdPage::new`] takes a [`Page`] and draws it every frame with a [`Registry`] of widgets,
//!   one per extern widget, by full name (`core/press`). Ours draw every core extern; an app's
//!   own ([`XtmdPage::widget`]) replace ours by name, and add a pack's. The page is told what is
//!   supplied, so an extern nobody draws shows its Markdown instead.
//! - A [`Widget`] is drawn every frame, as egui draws: it reads the props the runtime already
//!   worked out ([`Props`]), and acts through its [`Ctx`]: events, checked writes to its `mut`
//!   inputs, its slots' widgets, and the page's tokens.
//! - The plane's layout runs after every frame, from what egui measured, or from fixed sizes
//!   ([`measure::Fixed`]) as the checks do.
//! - Every widget is in egui's AccessKit tree with its role, name and state, and each of its
//!   parts carries an author id ([`a11y`]), which is how the check adapters find them.

pub mod a11y;
pub mod doc;
pub mod fns;
pub mod look;
pub mod measure;
pub mod rich;
pub mod values;
pub mod widgets;

#[cfg(feature = "check")]
pub mod check;

/// A page in a window of its own, with eframe (the `app` feature): scrolled, with a margin. The
/// page's errors go to standard error, and its Markdown to standard output when the window closes.
#[cfg(feature = "app")]
pub fn run_window(title: &str, mut page: XtmdPage) -> eframe::Result {
    let options = eframe::NativeOptions { viewport: egui::ViewportBuilder::default().with_inner_size([720.0, 800.0]).with_title(title), ..Default::default() };
    eframe::run_ui_native(title, options, move |ui, _frame| {
        egui::ScrollArea::vertical().auto_shrink(false).show(ui, |ui| {
            egui::Frame::new().inner_margin(16.0).show(ui, |ui| {
                page.show(ui);
            });
        });
        for e in page.take_errors() {
            eprintln!("{}", e);
        }
        if ui.ctx().input(|i| i.viewport().close_requested()) {
            println!("{}", page.page().markdown().unwrap_or_default());
        }
    })
}

use std::collections::{HashMap, HashSet};
use std::rc::Rc;

use egui::{Id, InnerResponse, Ui, UiBuilder};
pub use xtmd_runtime as runtime;
use xtmd_runtime::ir::{self, Expr};
use xtmd_runtime::{Drawn, Measure, Num, Page, PageOptions, PageTheme, PageValues, Value};

use crate::look::Look;
use crate::measure::Measured;

/// What an egui widget implements: it is drawn every frame, as egui draws, and reads the props
/// the runtime worked out once per change.
pub trait Widget {
    fn show(&mut self, ui: &mut Ui, props: &Props<'_>, ctx: &mut Ctx<'_>);
}

impl<F: FnMut(&mut Ui, &Props<'_>, &mut Ctx<'_>)> Widget for F {
    fn show(&mut self, ui: &mut Ui, props: &Props<'_>, ctx: &mut Ctx<'_>) {
        self(ui, props, ctx)
    }
}

/// How a widget is made: one instance per drawn widget, kept while it is on the page, so a
/// widget may hold state of its own in `self` (what is being typed, a drag in progress).
pub type Maker = Rc<dyn Fn() -> Box<dyn Widget>>;

/// The widgets a page is drawn with, by full name: `core/press`, `acme/chart`, and `#notice`
/// for a widget that failed.
#[derive(Clone, Default)]
pub struct Registry {
    makers: HashMap<String, Maker>,
}

impl Registry {
    /// No widgets at all.
    pub fn empty() -> Registry {
        Registry::default()
    }

    /// Ours: one for every core extern widget, and the notice.
    pub fn ours() -> Registry {
        widgets::defaults()
    }

    /// Sets the widget for a name: an app's replaces ours.
    pub fn set<W: Widget + 'static>(&mut self, name: &str, make: impl Fn() -> W + 'static) -> &mut Registry {
        self.makers.insert(name.to_string(), Rc::new(move || Box::new(make()) as Box<dyn Widget>));
        self
    }

    pub fn has(&self, name: &str) -> bool {
        self.makers.contains_key(name)
    }

    pub fn names(&self) -> impl Iterator<Item = &str> {
        self.makers.keys().map(String::as_str)
    }

    fn make(&self, name: &str) -> Box<dyn Widget> {
        if let Some(m) = self.makers.get(name).or_else(|| if name.starts_with('#') { self.makers.get("#notice") } else { None }) {
            return m();
        }
        let missing = name.to_string();
        Box::new(move |ui: &mut Ui, _: &Props<'_>, ctx: &mut Ctx<'_>| widgets::notice::show(ui, ctx, &format!("Nothing draws {} here: its widget isn't supplied.", missing)))
    }
}

/// A drawn widget's props, as the runtime worked them out.
#[derive(Clone, Copy)]
pub struct Props<'a> {
    d: &'a Drawn,
}

impl<'a> Props<'a> {
    pub fn new(d: &'a Drawn) -> Props<'a> {
        Props { d }
    }

    /// The widget as the page drew it: its path, key, props and slots.
    pub fn drawn(&self) -> &'a Drawn {
        self.d
    }

    pub fn get(&self, name: &str) -> Option<&'a Value> {
        self.d.props.get(name)
    }

    /// A text, a number in its exact form, or a bool, as words.
    pub fn text(&self, name: &str) -> String {
        values::text(self.get(name))
    }

    pub fn flag(&self, name: &str, otherwise: bool) -> bool {
        values::flag(self.get(name), otherwise)
    }

    pub fn num(&self, name: &str) -> Option<f64> {
        values::num(self.get(name))
    }

    pub fn exact(&self, name: &str) -> Option<Num> {
        values::exact(self.get(name))
    }

    /// An enum's or a token's case name.
    pub fn case(&self, name: &str) -> Option<&'a str> {
        values::case(self.get(name))
    }

    pub fn point(&self, name: &str) -> Option<(f64, f64)> {
        values::point(self.get(name))
    }

    pub fn list(&self, name: &str) -> Vec<&'a Value> {
        values::list(self.get(name))
    }

    /// A slot's widgets, in order.
    pub fn slot(&self, name: &str) -> &'a [Drawn] {
        self.d.slots.get(name).map_or(&[], Vec::as_slice)
    }
}

/// What a reader does to a widget, in the checks' terms: an event, or a write to a `mut` input.
/// [`XtmdPage::act`] asks the widget to do it through its own controls on its next frame, as a
/// person would; one the widget doesn't take goes through the page.
#[derive(Clone, Debug)]
pub enum Act {
    Event { name: String, args: Vec<Value> },
    Write { input: String, value: Value },
}

/// What the reader's actions did, as the page heard it: each event a widget ran and each write
/// to a `mut` input, the layout's included (only a change, as a person could see it). Kept only
/// when asked for ([`XtmdPage::record`]), for the omnicui adapter.
#[derive(Clone, Debug)]
pub enum Logged {
    Event { path: String, name: String, args: Vec<Value> },
    Write { path: String, input: String, value: Value },
}

/// A canvas's or a plane's coordinates, for the shapes drawn in it: its units onto the ui's
/// points, and back.
#[derive(Clone, Copy, Debug)]
pub struct Space {
    /// The drawing's rect, in the ui's points.
    pub rect: egui::Rect,
    /// The units at the rect's left and right, and at its bottom and top.
    pub x: (f64, f64),
    pub y: (f64, f64),
    /// Points per unit along x and y; y points down on the screen, up in the units.
    pub scale: (f64, f64),
    /// Whether points outside `rect` are kept inside it (a canvas) or not (a plane).
    pub bounded: bool,
    /// How many units one point on the screen is now: rounding a write keeps a sub-pixel.
    pub units_per_px: f64,
}

impl Space {
    /// A canvas: x and y ranges spread over a rect, y up.
    pub fn canvas(rect: egui::Rect, x: (f64, f64), y: (f64, f64)) -> Space {
        let sx = rect.width() as f64 / (x.1 - x.0).max(f64::MIN_POSITIVE);
        let sy = rect.height() as f64 / (y.1 - y.0).max(f64::MIN_POSITIVE);
        Space { rect, x, y, scale: (sx, sy), bounded: true, units_per_px: 1.0 / sx }
    }

    /// A unit point on the screen.
    pub fn to_screen(&self, p: (f64, f64)) -> egui::Pos2 {
        egui::pos2(self.rect.left() + ((p.0 - self.x.0) * self.scale.0) as f32, self.rect.bottom() - ((p.1 - self.y.0) * self.scale.1) as f32)
    }

    /// A screen point in units.
    pub fn to_units(&self, p: egui::Pos2) -> (f64, f64) {
        (self.x.0 + (p.x - self.rect.left()) as f64 / self.scale.0, self.y.0 + (self.rect.bottom() - p.y) as f64 / self.scale.1)
    }

    /// A length along x, in points.
    pub fn len(&self, u: f64) -> f32 {
        (u * self.scale.0) as f32
    }

    /// A point kept inside what the space shows.
    pub fn keep(&self, p: (f64, f64)) -> (f64, f64) {
        if !self.bounded {
            return p;
        }
        (p.0.clamp(self.x.0.min(self.x.1), self.x.0.max(self.x.1)), p.1.clamp(self.y.0.min(self.y.1), self.y.0.max(self.y.1)))
    }
}

/// What lives across frames and is lent to every widget while a frame is drawn.
struct Frame {
    registry: Registry,
    instances: HashMap<(String, String), Box<dyn Widget>>,
    used: HashSet<(String, String)>,
    /// The paths drawn this frame, or kept on the page hidden (a closed overlay's body).
    shown: HashSet<String>,
    acts: HashMap<String, Vec<Act>>,
    left: Vec<(String, Act)>,
    look: Look,
    measured: Measured,
    spaces: Vec<Space>,
    errors: Vec<String>,
    log: Option<Vec<Logged>>,
    /// The page's own id: every widget's id is made from it, so two pages can share a window.
    page_id: Id,
}

impl Frame {
    fn new(registry: Registry, page_id: Id) -> Frame {
        Frame {
            registry,
            instances: HashMap::new(),
            used: HashSet::new(),
            shown: HashSet::new(),
            acts: HashMap::new(),
            left: Vec::new(),
            look: Look::default(),
            measured: Measured::default(),
            spaces: Vec::new(),
            errors: Vec::new(),
            log: None,
            page_id,
        }
    }

    fn note(&mut self, l: Logged) {
        if let Some(log) = &mut self.log {
            log.push(l);
        }
    }
}

/// What a widget can do while it is drawn: on the page, with its slots, and with the tokens.
pub struct Ctx<'a> {
    page: &'a mut Page,
    frame: &'a mut Frame,
    at: &'a Drawn,
    id: Id,
    acts: Vec<Act>,
}

impl<'a> Ctx<'a> {
    pub fn page(&self) -> &Page {
        self.page
    }

    /// The widget being drawn.
    pub fn drawn(&self) -> &'a Drawn {
        self.at
    }

    /// Its path on the page: `s0/s1[2]/s3`.
    pub fn path(&self) -> &'a str {
        &self.at.path
    }

    /// Its egui id: the same across frames, following its key, so a loop row's widget keeps its
    /// focus and state when the row moves.
    pub fn id(&self) -> Id {
        self.id
    }

    /// An id for one of its parts.
    pub fn sub_id(&self, part: &str) -> Id {
        self.id.with(part)
    }

    /// The reader's event on this widget: runs the caller's handler, as one change.
    pub fn event(&mut self, name: &str, args: Vec<Value>) {
        self.frame.note(Logged::Event { path: self.at.path.clone(), name: name.to_string(), args: args.clone() });
        if let Err(f) = self.page.event(&self.at.path, name, args) {
            self.frame.errors.push(format!("{} {}: {}", self.at.path, name, f.message));
        }
    }

    /// This widget writing one of its `mut` inputs, as a slider does: checked, then one change.
    /// Whether it took: a refused write leaves the value as it was.
    pub fn write(&mut self, input: &str, value: Value) -> bool {
        self.frame.note(Logged::Write { path: self.at.path.clone(), input: input.to_string(), value: value.clone() });
        if let Err(f) = self.page.write(&self.at.path, input, value.clone()) {
            self.frame.errors.push(format!("{} {}: {}", self.at.path, input, f.message));
            return false;
        }
        match self.page.find(&self.at.path).and_then(|n| n.props.get(input)) {
            Some(now) => self.page.equal(now, &value).unwrap_or(false),
            None => false,
        }
    }

    /// Whether an event does something: a widget is clickable only when its click is.
    pub fn listens(&self, event: &str) -> bool {
        self.page.listens(self.at, event)
    }

    /// The type of the variable a `mut` input writes, its contract included: a slider's ends.
    pub fn write_type(&self, input: &str) -> Option<ir::Type> {
        self.page.write_type(self.at, input)
    }

    /// An act a check asked of this widget, to do through its own controls. One it doesn't take
    /// goes through the page after the frame.
    pub fn take_act(&mut self) -> Option<Act> {
        if self.acts.is_empty() {
            None
        } else {
            Some(self.acts.remove(0))
        }
    }

    /// Puts back an act this widget can't do itself.
    pub fn decline(&mut self, act: Act) {
        self.frame.left.push((self.at.path.clone(), act));
    }

    /// Draws one widget of the page into a ui.
    pub fn child(&mut self, ui: &mut Ui, d: &Drawn) {
        draw(self.page, self.frame, ui, d);
    }

    /// Draws a slot's widgets into a ui, in order.
    pub fn slot(&mut self, ui: &mut Ui, name: &str) {
        let at = self.at;
        for d in at.slots.get(name).into_iter().flatten() {
            draw(self.page, self.frame, ui, d);
        }
    }

    /// A slot's widgets, kept on the page but not drawn: a closed overlay's body.
    pub fn keep(&mut self, name: &str) {
        fn walk(f: &mut Frame, nodes: &[Drawn]) {
            for d in nodes {
                f.shown.insert(d.path.clone());
                f.used.insert((d.key.clone(), d.widget.clone()));
                for kids in d.slots.values() {
                    walk(f, kids);
                }
            }
        }
        let at = self.at;
        walk(self.frame, at.slots.get(name).map_or(&[], Vec::as_slice));
    }

    /// The page's tokens, for its theme.
    pub fn look(&self) -> &Look {
        &self.frame.look
    }

    /// A colour token, for the page's theme.
    pub fn color(&self, v: Option<&Value>) -> Option<egui::Color32> {
        self.frame.look.color(self.page, v)
    }

    /// One of core's colours by name: `INK`, `ACCENT` …
    pub fn core_color(&self, name: &str) -> egui::Color32 {
        self.frame.look.core_color(self.page, name)
    }

    /// A length token, in points.
    pub fn length(&self, v: Option<&Value>) -> Option<f32> {
        self.frame.look.number(self.page, v)
    }

    /// The root of one of our widgets: a ui with this widget's id, named as its root for the
    /// AccessKit tree (`press@s0/s0`), its bounds set once it is drawn.
    pub fn root<R>(&mut self, ui: &mut Ui, builder: UiBuilder, add: impl FnOnce(&mut Ui, &mut Ctx<'a>) -> R) -> InnerResponse<R> {
        let id = self.id;
        let author = a11y::root_id(&self.at.widget, &self.at.path);
        ui.scope_builder(builder.scope_id(id), |ui| {
            a11y::part(ui, ui.unique_id(), &author);
            let r = add(ui, self);
            a11y::bounds(ui, ui.unique_id(), ui.min_rect());
            r
        })
    }

    /// Names a node as one of this widget's parts: `slider.input`.
    pub fn part(&self, ui: &Ui, id: Id, part: &str) {
        a11y::part(ui, id, &format!("{}.{}", a11y::short(&self.at.widget), part));
    }

    /// The drawing space shapes are in now: the canvas's or the plane's.
    pub fn space(&self) -> Option<Space> {
        self.frame.spaces.last().copied()
    }

    /// Draws with a space for the shapes inside.
    pub fn in_space<R>(&mut self, space: Space, f: impl FnOnce(&mut Ctx<'a>) -> R) -> R {
        self.frame.spaces.push(space);
        let r = f(self);
        self.frame.spaces.pop();
        r
    }

    /// A spot's size as drawn, in the plane's units, for the plane's layout.
    pub fn measured_spot(&mut self, size: egui::Vec2) {
        self.frame.measured.spots.insert(self.at.path.clone(), size);
    }

    /// A plane's width as drawn, in points, for its layout.
    pub fn measured_plane(&mut self, width: f32) {
        self.frame.measured.planes.insert(self.at.path.clone(), width);
    }

    /// Something went wrong drawing: kept for the app's log ([`XtmdPage::take_errors`]).
    pub fn error(&mut self, message: String) {
        self.frame.errors.push(message);
    }
}

/// Draws one widget: its instance, made the first time its key is seen and kept while it is.
fn draw(page: &mut Page, frame: &mut Frame, ui: &mut Ui, d: &Drawn) {
    frame.shown.insert(d.path.clone());
    let mut key = d.key.clone();
    let mut n = 2;
    while frame.used.contains(&(key.clone(), d.widget.clone())) {
        key = format!("{}#{}", d.key, n);
        n += 1;
    }
    let k = (key, d.widget.clone());
    frame.used.insert(k.clone());
    let mut w = match frame.instances.remove(&k) {
        Some(w) => w,
        None => frame.registry.make(&d.widget),
    };
    let acts = frame.acts.remove(&d.path).unwrap_or_default();
    let id = frame.page_id.with((&k.0, &k.1));
    let props = Props { d };
    let mut ctx = Ctx { page, frame, at: d, id, acts };
    w.show(ui, &props, &mut ctx);
    let left = std::mem::take(&mut ctx.acts);
    for a in left {
        frame.left.push((d.path.clone(), a));
    }
    frame.instances.insert(k, w);
}

/// What the layout writes, as it is now: each plane's `zoom`, `center` and `drawn`, each spot's
/// `box`.
fn laid_out(page: &Page) -> Vec<(String, String, Value)> {
    fn walk(nodes: &[Drawn], out: &mut Vec<(String, String, Value)>) {
        for n in nodes {
            let inputs: &[&str] = match n.widget.as_str() {
                "core/plane" => &["zoom", "center", "drawn"],
                "core/spot" => &["box"],
                _ => &[],
            };
            for i in inputs {
                if let Some(v) = n.props.get(*i) {
                    out.push((n.path.clone(), i.to_string(), v.clone()));
                }
            }
            for kids in n.slots.values() {
                walk(kids, out);
            }
        }
    }
    let mut out = Vec::new();
    walk(page.tree(), &mut out);
    out
}

/// How the plane's layout measures spots.
pub enum Sizes {
    /// From what egui drew: each spot's rect, each plane's width.
    Measured,
    /// From a measure of the app's, such as the checks' fixed sizes.
    Given(Box<dyn Measure>),
}

/// A page drawn with egui.
pub struct XtmdPage {
    page: Page,
    frame: Frame,
    tree: Rc<Vec<Drawn>>,
    revision: Option<u64>,
    sizes: Sizes,
    follow_theme: bool,
    id: Id,
    /// The theme last given to the page from egui's.
    pushed: Option<bool>,
    /// Frames in a row whose layout changed the page while nothing outside it did, and the
    /// outside change they counted from.
    streak: (u64, usize),
    /// The outside change a layout that keeps changing is held at.
    held: Option<u64>,
}

impl XtmdPage {
    /// Draws a page with our widgets. Its value fns are egui's ([`fns::egui_fns`]) where the page
    /// was made with [`XtmdPage::options`].
    pub fn new(page: Page) -> XtmdPage {
        let mut p = XtmdPage {
            page,
            frame: Frame::new(Registry::ours(), Id::unique("xtmd-page")),
            tree: Rc::new(Vec::new()),
            revision: None,
            sizes: Sizes::Measured,
            follow_theme: true,
            id: Id::unique("xtmd-page"),
            streak: (0, 0),
            held: None,
            pushed: None,
        };
        p.tell_supplies();
        p
    }

    /// Draws another page in this one's place, with the same widgets, measure and id: a new IR for
    /// the same document. Nothing drawn for the last page is kept.
    pub fn replace(&mut self, page: Page) {
        self.page = page;
        self.tree = Rc::new(Vec::new());
        self.revision = None;
        self.pushed = None;
        self.streak = (0, 0);
        self.held = None;
        self.frame.instances.clear();
        self.tell_supplies();
    }

    /// Page options with egui's value fns: what [`Page::from_json`] wants for a page drawn here.
    pub fn options() -> PageOptions {
        PageOptions { fns: fns::egui_fns(), ..PageOptions::default() }
    }

    /// Replaces our widget for a name, or adds one: an app's own, or a pack's.
    pub fn widget<W: Widget + 'static>(mut self, name: &str, make: impl Fn() -> W + 'static) -> XtmdPage {
        self.frame.registry.set(name, make);
        self.frame.instances.retain(|(_, w), _| w != name);
        self.tell_supplies();
        self
    }

    /// Replaces the whole registry.
    pub fn with_registry(mut self, registry: Registry) -> XtmdPage {
        self.frame.registry = registry;
        self.frame.instances.clear();
        self.tell_supplies();
        self
    }

    /// The plane's layout from a measure of the app's (the checks' fixed sizes), not egui's.
    pub fn with_measure(mut self, measure: Box<dyn Measure>) -> XtmdPage {
        self.sizes = Sizes::Given(measure);
        self
    }

    /// Whether the page's theme follows egui's dark mode (the default), or is the app's to set.
    pub fn follow_theme(mut self, follow: bool) -> XtmdPage {
        self.follow_theme = follow;
        self
    }

    /// [`XtmdPage::follow_theme`], on a page already made.
    pub fn set_follow_theme(&mut self, follow: bool) {
        self.follow_theme = follow;
    }

    /// The egui id of the page's own ui, and every widget's in it: two pages in one window each
    /// need one of their own.
    pub fn id(mut self, id: Id) -> XtmdPage {
        self.id = id;
        self.frame.page_id = id;
        self.frame.instances.clear();
        self
    }

    pub fn page(&self) -> &Page {
        &self.page
    }

    pub fn page_mut(&mut self) -> &mut Page {
        &mut self.page
    }

    /// The paths drawn in the last frame, and the ones kept on the page hidden.
    pub fn shown(&self) -> &HashSet<String> {
        &self.frame.shown
    }

    /// Asks the widget at a path to do something through its own controls on the next frame;
    /// one it can't goes through the page after that frame.
    pub fn act(&mut self, path: &str, act: Act) {
        self.frame.acts.entry(path.to_string()).or_default().push(act);
    }

    /// Whether acts are waiting for a frame.
    pub fn acting(&self) -> bool {
        !self.frame.acts.is_empty()
    }

    /// Keeps a log of what the reader's actions did ([`Logged`]), from now on.
    pub fn record(mut self, on: bool) -> XtmdPage {
        self.frame.log = if on { Some(Vec::new()) } else { None };
        self
    }

    /// The log since the last call.
    pub fn take_log(&mut self) -> Vec<Logged> {
        self.frame.log.as_mut().map(std::mem::take).unwrap_or_default()
    }

    /// What went wrong since the last call: failed handlers, refused drawing.
    pub fn take_errors(&mut self) -> Vec<String> {
        let mut out = std::mem::take(&mut self.frame.errors);
        out.extend(self.page.take_errors().into_iter().map(|f| f.message));
        out
    }

    /// Tells the page which extern widgets are drawn here: one that isn't shows its Markdown.
    fn tell_supplies(&mut self) {
        let names: HashSet<String> = self.frame.registry.names().map(str::to_string).collect();
        if let Err(f) = self.page.set_supplies(Some(Rc::new(move |w: &str| names.contains(w)))) {
            self.frame.errors.push(f.message);
        }
    }

    /// The page's theme now: `core/page.theme`.
    fn page_dark(&self) -> bool {
        match self.page.eval(&Expr::Get(ir::Get::Extern("core/page.theme".into()))) {
            Ok(v) => values::case(Some(&v)) == Some("DARK"),
            Err(_) => false,
        }
    }

    /// Draws the page, then lays its planes out from what was drawn. Call it every frame.
    pub fn show(&mut self, ui: &mut Ui) -> egui::Response {
        if self.follow_theme {
            let dark = ui.visuals().dark_mode;
            if self.pushed != Some(dark) {
                self.pushed = Some(dark);
                if dark != self.page_dark() {
                    let theme = if dark { PageTheme::Dark } else { PageTheme::Light };
                    if let Err(f) = self.page.set_page(PageValues { width: None, theme: Some(theme) }) {
                        self.frame.errors.push(f.message);
                    }
                }
            }
        }
        let rev = self.page.revision();
        if self.revision != Some(rev) {
            self.tree = Rc::new(self.page.tree().to_vec());
            self.revision = Some(rev);
            let dark = self.page_dark();
            self.frame.look.set_dark(dark);
        }
        let tree = self.tree.clone();
        self.frame.shown.clear();
        self.frame.used.clear();
        self.frame.measured = Measured::default();
        let page = &mut self.page;
        let frame = &mut self.frame;
        let r = ui.scope_builder(UiBuilder::new().scope_id(self.id), |ui| {
            let gap = frame.look.space(page, "M");
            ui.spacing_mut().item_spacing = egui::vec2(gap, gap);
            ui.style_mut().interaction.selectable_labels = false;
            for d in tree.iter() {
                draw(page, frame, ui, d);
            }
        });
        // what the widgets didn't do themselves goes through the page
        let left: Vec<(String, Act)> = std::mem::take(&mut self.frame.left);
        let waiting: Vec<(String, Act)> = self.frame.acts.drain().flat_map(|(p, acts)| acts.into_iter().map(move |a| (p.clone(), a))).collect();
        for (path, act) in left.into_iter().chain(waiting) {
            let r = match act {
                Act::Event { name, args } => {
                    self.frame.note(Logged::Event { path: path.clone(), name: name.clone(), args: args.clone() });
                    self.page.event(&path, &name, args)
                }
                Act::Write { input, value } => {
                    self.frame.note(Logged::Write { path: path.clone(), input: input.clone(), value: value.clone() });
                    self.page.write(&path, &input, value)
                }
            };
            if let Err(f) = r {
                self.frame.errors.push(format!("{}: {}", path, f.message));
            }
        }
        // a widget that left the page leaves with its instance
        let used = std::mem::take(&mut self.frame.used);
        self.frame.instances.retain(|k, _| used.contains(k));
        self.frame.used = used;
        let before = if self.frame.log.is_some() { laid_out(&self.page) } else { Vec::new() };
        // egui lays out every frame: a layout that changes the page frame after frame while
        // nothing outside it does (a spot whose key moves at every redraw, so its own box is
        // never kept) is held until something outside changes the page, or it would never settle
        let outside = self.page.changes();
        if self.held != Some(outside) {
            self.held = None;
            let at = self.page.revision();
            let laid = match &mut self.sizes {
                Sizes::Given(m) => self.page.layout(m.as_mut()),
                Sizes::Measured => {
                    let mut m = self.frame.measured.clone();
                    self.page.layout(&mut m)
                }
            };
            if let Err(f) = laid {
                self.frame.errors.push(f.message);
            }
            if self.page.revision() == at {
                self.streak = (outside, 0);
            } else {
                self.streak = if self.streak.0 == outside { (outside, self.streak.1 + 1) } else { (outside, 1) };
                if self.streak.1 >= xtmd_runtime::MAX_LAYOUT_PASSES {
                    self.held = Some(outside);
                    self.frame.errors.push(format!("the layout still changed the page after {} frames with nothing else changing it: held until something does", self.streak.1));
                }
            }
        }
        if self.frame.log.is_some() {
            // the layout's writes: only a change is one a person could see
            for (path, input, value) in laid_out(&self.page) {
                let was = before.iter().find(|(p, i, _)| *p == path && *i == input).map(|(_, _, v)| v);
                if was.is_none_or(|w| !self.page.equal(w, &value).unwrap_or(false)) {
                    self.frame.note(Logged::Write { path, input, value });
                }
            }
        }
        if self.page.revision() != rev {
            ui.ctx().request_repaint();
        }
        r.response
    }
}
