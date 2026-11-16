//! The egui target's omnicui adapter: omnicui (targets/checks, the widget contracts) starts it once
//! per check and sends JSON-RPC 2.0 requests, one per line, on standard input; every reply is one
//! line on standard output, and logs go to standard error (omnicui's SPEC §4.4).
//!
//! For `mount {component: "core.slider", props, viewport, colorScheme}` it writes a small MKP page
//! that calls that one extern widget (as the web's omnicui adapter does: `check::source`), compiles
//! it with the compiler's own crates (core is compiled once, at start), and draws it headless with
//! our egui widgets in egui_kittest's harness, at the viewport and theme asked for. Steps are real
//! egui input aimed at the part's node in the AccessKit tree; reads come from that tree. Each reply
//! waits for the page to settle.
//!
//! Part ids are `<component id>.<part>`, found as the web finds them (see `find` below):
//! aliases first, then the widget's own root, `<short>.<part>` inside it, `<part>` anywhere, and the
//! nth of those for a name ending in a number.
//!
//!   mkp_omnicui_adapter [--contracts <file>]      the adapter
//!   mkp_omnicui_adapter --write-contracts <file>  omnicui's `stubs:`: every contract, from standard
//!                                                 input, kept where the adapter reads each one's
//!                                                 prop defaults

use std::collections::BTreeMap;
use std::io::{BufRead, Read, Write};
use std::path::{Path, PathBuf};

use egui_kittest::kittest::AccessKitNode;
use mkp_egui::check::source::{self, Decls, Report};
use mkp_egui::check::{self, Headless};
use mkp_egui::runtime::{Drawn, Page, PageOptions, PageTheme, PageValues, Value};
use mkp_egui::{Logged, MkpPage};
use serde_json::{json, Map, Value as Json};

// protocol: error codes
const NO_COMPONENT: i64 = -32001;
const NO_PART: i64 = -32002;
const STEP_FAILED: i64 = -32003;
const NO_METHOD: i64 = -32601;

struct Rpc(i64, String);

fn fail(code: i64, msg: impl Into<String>) -> Rpc {
    Rpc(code, msg.into())
}

fn log(msg: &str) {
    eprintln!("[egui] {}", msg);
}

/// The repository: where `core/` and `targets/checks` are, from the working folder or the binary.
fn repo() -> Option<PathBuf> {
    let starts = [std::env::current_dir().ok(), std::env::current_exe().ok()];
    starts.into_iter().flatten().find_map(|s| s.ancestors().find(|d| d.join("targets/checks").is_dir() && d.join("core").is_dir()).map(Path::to_path_buf))
}

fn core_sources(root: &Path) -> Vec<mkp_check::Source> {
    let mut files: Vec<PathBuf> = std::fs::read_dir(root.join("core")).map(|d| d.filter_map(|e| e.ok().map(|e| e.path())).collect()).unwrap_or_default();
    files.retain(|p| p.extension().is_some_and(|x| x == "mkp"));
    files.sort();
    files.into_iter().map(|p| mkp_check::Source { path: p.to_string_lossy().into_owned(), text: std::fs::read_to_string(&p).unwrap_or_default() }).collect()
}

/// A value as an event's fields, under a name, as the web's harness gives them: a number, a text,
/// a bool or a case's name as it is; an opt as its value, or null; a record's fields each under
/// the name and the field's (`at` → `atX`, `atY`); a list or a range as JSON text.
fn fields_of(name: &str, v: &Value, out: &mut Map<String, Json>) {
    let cap = |s: &str| {
        let c = source::camel(s);
        let mut ch = c.chars();
        ch.next().map(|f| f.to_uppercase().collect::<String>() + ch.as_str()).unwrap_or_default()
    };
    match v {
        Value::Num(n) => {
            out.insert(name.into(), json!(mkp_egui::values::to_f64(n)));
        }
        Value::Text(t) => {
            out.insert(name.into(), json!(t.to_string()));
        }
        Value::Bool(b) => {
            out.insert(name.into(), json!(b));
        }
        Value::Case(c) => {
            out.insert(name.into(), json!(c.name.to_string()));
            for (f, x) in &c.values {
                fields_of(&format!("{}{}", name, cap(f)), x, out);
            }
        }
        Value::Opt(None) => {
            out.insert(name.into(), Json::Null);
        }
        Value::Opt(Some(x)) => fields_of(name, x, out),
        Value::Record(r) => {
            for (f, x) in &r.fields {
                fields_of(&format!("{}{}", name, cap(f)), x, out);
            }
        }
        other => {
            out.insert(name.into(), json!(serde_json::to_string(&other.to_ir()).unwrap_or_default()));
        }
    }
}

struct Mounted {
    ui: Headless,
    component: String,
    widget: String,
    path: String,
    report: Report,
    events: Vec<Json>,
    viewport: egui::Vec2,
}

struct Adapter {
    root: PathBuf,
    core: mkp_check::Checker,
    decls: Decls,
    defaults: BTreeMap<String, Map<String, Json>>,
    mounted: Option<Mounted>,
}

/// The path of the widget under test: the first one of its kind, in the order it is drawn.
fn target_path(nodes: &[Drawn], widget: &str) -> Option<String> {
    for n in nodes {
        if n.widget == widget {
            return Some(n.path.clone());
        }
        for kids in n.slots.values() {
            if let Some(p) = target_path(kids, widget) {
                return Some(p);
            }
        }
    }
    None
}

impl Adapter {
    fn compile(&self, src: &str) -> Result<mkp_egui::runtime::ir::Module, String> {
        let c = mkp_check::compile_on(&self.core, &[], &[mkp_check::Source { path: "widget.mkp.md".into(), text: src.into() }], "doc");
        match c.module {
            Some(mut m) => {
                mkp_lower::lower(&mut m);
                Ok(m)
            }
            None => Err(format!("the page didn't build: {}", c.errors().map(|e| format!("{:?}", e)).collect::<Vec<_>>().join("; "))),
        }
    }

    fn mounted(&mut self) -> Result<&mut Mounted, Rpc> {
        self.mounted.as_mut().ok_or_else(|| fail(NO_PART, "nothing is mounted"))
    }

    /// Settles the page, then turns what the widget under test did into events.
    fn settle(&mut self) -> Result<(), Rpc> {
        let m = self.mounted()?;
        m.ui.settle().map_err(|e| fail(STEP_FAILED, e))?;
        for e in m.ui.page().take_errors() {
            log(&format!("[page caught] {}", e));
        }
        let outcome = m.ui.page().page_mut().take_outcome();
        for r in outcome.refused.iter().chain(outcome.failures.iter()) {
            log(&format!("[page caught] refused or failed: {}", serde_json::to_string(r).unwrap_or_default()));
        }
        for l in m.ui.page().take_log() {
            match l {
                Logged::Event { path, name, args } if path == m.path => {
                    if let Some((camel, params)) = m.report.events.get(&name) {
                        let mut f = Map::new();
                        for (k, p) in params.iter().enumerate() {
                            match args.get(k) {
                                Some(v) => fields_of(&source::camel(p), v, &mut f),
                                None => {
                                    f.insert(source::camel(p), Json::Null);
                                }
                            }
                        }
                        m.events.push(json!({ "name": camel, "fields": f }));
                    }
                }
                Logged::Write { path, input, value } if path == m.path => {
                    if let Some(name) = m.report.writes.get(&input) {
                        let mut f = Map::new();
                        fields_of("value", &value, &mut f);
                        m.events.push(json!({ "name": name, "fields": f }));
                    }
                }
                _ => {}
            }
        }
        Ok(())
    }

    fn mount(&mut self, p: &Json) -> Result<Json, Rpc> {
        let component = p["component"].as_str().unwrap_or_default().to_string();
        let widget = source::widget_of(&component).filter(|w| self.decls.widgets.contains_key(w)).ok_or_else(|| fail(NO_COMPONENT, format!("no component {}: this target mounts core's extern widgets, core.<widget>", component)))?;
        let mut props = self.defaults.get(&component).cloned().unwrap_or_default();
        for (k, v) in p["props"].as_object().into_iter().flatten() {
            props.insert(k.clone(), v.clone());
        }
        let src = source::page_source(&widget, &props, &self.decls).map_err(|e| fail(STEP_FAILED, format!("mount {}: {}", component, e)))?;
        let module = self.compile(&src).map_err(|e| fail(STEP_FAILED, e))?;
        let dark = p["colorScheme"].as_str() == Some("dark");
        let opts = PageOptions { page: PageValues { width: None, theme: Some(if dark { PageTheme::Dark } else { PageTheme::Light }) }, fns: mkp_egui::fns::check_fns(), ..PageOptions::default() };
        let page = Page::from_module(module, opts).map_err(|f| fail(NO_COMPONENT, f.message))?;
        let path = target_path(page.tree(), &widget).ok_or_else(|| fail(NO_COMPONENT, format!("{} is not on the page", widget)))?;
        let viewport = egui::vec2(p["viewport"]["width"].as_f64().unwrap_or(320.0) as f32, p["viewport"]["height"].as_f64().unwrap_or(240.0) as f32);
        let mkp = MkpPage::new(page).follow_theme(false).record(true);
        let ui = Headless::new(mkp, viewport, dark);
        let report = source::reporting(&widget, &self.decls);
        self.mounted = Some(Mounted { ui, component, widget, path, report, events: Vec::new(), viewport });
        self.settle()?;
        Ok(Json::Null)
    }

    /// The node of a part, `<component id>.<part>`.
    fn find<'t>(m: &'t Mounted, part_id: &str) -> Result<AccessKitNode<'t>, Rpc> {
        let prefix = format!("{}.", m.component);
        let part = part_id.strip_prefix(&prefix).ok_or_else(|| fail(NO_PART, format!("no part {}: {} is mounted", part_id, m.component)))?;
        let short = m.widget.trim_start_matches("core/");
        let nodes = check::all(m.ui.root());
        let root = m.ui.widget(&m.path);
        // aliases, for what an author id alone doesn't say
        let alias: Option<Vec<AccessKitNode<'t>>> = match (short, part) {
            ("heading", p) if p.starts_with("level") => {
                let n: usize = p[5..].parse().unwrap_or(0);
                Some(root.filter(|r| r.level() == Some(n)).into_iter().collect())
            }
            ("bullets", "ordered") => Some(root.filter(|r| r.class_name() == Some("ol")).into_iter().collect()),
            ("bullets", "unordered") => Some(root.filter(|r| r.class_name() == Some("ul")).into_iter().collect()),
            ("press", "switch") | ("press", "checkbox") => Some(root.into_iter().collect()),
            _ => None,
        };
        let all = |name: &str| -> Vec<AccessKitNode<'t>> {
            if name == short {
                return root.into_iter().collect();
            }
            let inside_id = format!("{}.{}", short, name);
            let inside: Vec<_> = match root {
                Some(r) => check::all(r).into_iter().filter(|n| n.author_id() == Some(inside_id.as_str())).collect(),
                None => Vec::new(),
            };
            if !inside.is_empty() {
                return inside;
            }
            let anywhere = format!("{}@", name);
            nodes.iter().copied().filter(|n| n.author_id().is_some_and(|a| a == name || a.starts_with(&anywhere))).collect()
        };
        let found = match alias {
            Some(v) => v,
            None => {
                let mut v = all(part);
                if v.is_empty() {
                    let digits = part.trim_end_matches(|c: char| c.is_ascii_digit());
                    if digits.len() < part.len() {
                        let n: usize = part[digits.len()..].parse().unwrap_or(0);
                        v = all(digits).into_iter().skip(n.saturating_sub(1)).take(if n == 0 { 0 } else { 1 }).collect();
                    }
                }
                v
            }
        };
        found.into_iter().next().ok_or_else(|| fail(NO_PART, format!("no part {}", part_id)))
    }

    /// What a pointer acts on: the middle of the part's box, which must be on the screen.
    fn on_screen(m: &Mounted, part: &str) -> Result<egui::Rect, Rpc> {
        let n = Self::find(m, part)?;
        let r = check::rect(&n).filter(|r| r.width() > 0.0 && r.height() > 0.0).ok_or_else(|| fail(STEP_FAILED, format!("{} is not on screen", part)))?;
        let screen = egui::Rect::from_min_size(egui::Pos2::ZERO, m.viewport);
        if !screen.contains(r.center()) {
            return Err(fail(STEP_FAILED, format!("{} is not on screen", part)));
        }
        Ok(r)
    }

    fn step(&mut self, method: &str, p: &Json) -> Result<Json, Rpc> {
        let part = p["part"].as_str().unwrap_or_default().to_string();
        let m = self.mounted()?;
        match method {
            // a real click where the part is, as a person's: a disabled control takes it and does nothing
            "press" => {
                let r = Self::on_screen(m, &part)?;
                m.ui.click_at(r.center());
            }
            "hover" => {
                let r = Self::on_screen(m, &part)?;
                m.ui.hover_at(r.center());
            }
            "focus" => {
                let n = Self::find(m, &part)?.locate();
                m.ui.focus(n);
            }
            // the key goes wherever the focus really is, so a part that can't take it fails honestly
            "key" => {
                Self::find(m, &part)?;
                m.ui.key(p["key"].as_str().unwrap_or_default()).map_err(|e| fail(STEP_FAILED, e))?;
            }
            "type" => {
                let n = Self::find(m, &part)?;
                let (focused, id) = (n.is_focused(), n.locate());
                if !focused {
                    m.ui.focus(id);
                    m.ui.settle().map_err(|e| fail(STEP_FAILED, e))?;
                }
                m.ui.type_text(p["text"].as_str().unwrap_or_default());
            }
            "drag" => {
                let r = Self::on_screen(m, &part)?;
                m.ui.drag(r.center(), egui::vec2(p["dx"].as_f64().unwrap_or(0.0) as f32, p["dy"].as_f64().unwrap_or(0.0) as f32));
            }
            other => return Err(fail(NO_METHOD, format!("unknown step {}", other))),
        }
        self.settle()?;
        Ok(Json::Null)
    }

    fn read(&mut self, p: &Json) -> Result<Json, Rpc> {
        let part = p["part"].as_str().unwrap_or_default().to_string();
        let m = self.mounted()?;
        let n = Self::find(m, &part)?;
        Ok(match p["field"].as_str().unwrap_or_default() {
            "text" => json!(check::text(&n)),
            "name" => json!(check::name(&n)),
            "checked" => json!(check::checked(&n)),
            "expanded" => json!(n.data().is_expanded()),
            "disabled" => json!(n.is_disabled()),
            "value" => json!(n.numeric_value()),
            "focused" => json!(n.is_focused()),
            "selected" => json!(check::selected(&n)),
            "role" => json!(check::aria_role(n.role())),
            other => return Err(fail(STEP_FAILED, format!("unknown field {}", other))),
        })
    }

    fn handle(&mut self, method: &str, p: &Json) -> Result<Json, Rpc> {
        match method {
            // protocol: the first request; what this target can do on this run
            "advertise" => {
                let why = "MKP's widget contracts compare behaviour, keyboard and roles: this target takes no pictures";
                Ok(json!({
                    "protocol": "1",
                    "can": ["mount", "press", "focus", "key", "type", "drag", "hover", "read", "events", "bounds", "role", "focused", "selected"],
                    "cannot": {
                        "screenshot": format!("{} (egui_kittest renders through wgpu, which this target leaves out)", why),
                        "probe": format!("{} (no screenshots, so no render check)", why),
                        "trace": format!("{} (no motion is compared)", why),
                        "trace.opacity": "egui has no per-widget opacity to read: it is multiplied into the painted colours",
                        "trace.scale": "egui widgets have no transform to read",
                        "record": format!("{} (no clips are compared)", why),
                    },
                    "platform": { "os": std::env::consts::OS },
                }))
            }
            "mount" => self.mount(p),
            "press" | "hover" | "focus" | "key" | "type" | "drag" => self.step(method, p),
            "read" => self.read(p),
            // protocol: where a part is on screen, in points; a part not on the page is 0×0
            "bounds" => {
                let part = p["part"].as_str().unwrap_or_default().to_string();
                let m = self.mounted()?;
                match Self::find(m, &part) {
                    Ok(n) => Ok(match check::rect(&n) {
                        Some(r) => json!({ "x": r.min.x, "y": r.min.y, "width": r.width(), "height": r.height() }),
                        None => json!({ "x": 0, "y": 0, "width": 0, "height": 0 }),
                    }),
                    Err(Rpc(NO_PART, _)) => Ok(json!({ "x": 0, "y": 0, "width": 0, "height": 0 })),
                    Err(e) => Err(e),
                }
            }
            // contract: expect[] with event:. Since the last call; a mount starts afresh, and its own
            // writes (a spot's box, a plane's drawn region, from the first layout) are reported
            "events" => Ok(match &mut self.mounted {
                Some(m) => Json::Array(std::mem::take(&mut m.events)),
                None => json!([]),
            }),
            other => Err(fail(NO_METHOD, format!("unknown method {}", other))),
        }
    }
}

fn arg(flag: &str) -> Option<String> {
    let args: Vec<String> = std::env::args().collect();
    args.iter().position(|a| a == flag).and_then(|k| args.get(k + 1).cloned())
}

fn main() {
    // omnicui's `stubs:`: every contract, kept as it is, where the adapter reads its defaults
    if let Some(out) = arg("--write-contracts") {
        let mut text = String::new();
        std::io::stdin().read_to_string(&mut text).expect("read the contracts");
        let contracts: Json = serde_json::from_str(&text).expect("the contracts are JSON");
        if let Some(dir) = Path::new(&out).parent() {
            let _ = std::fs::create_dir_all(dir);
        }
        std::fs::write(&out, serde_json::to_string_pretty(&contracts).unwrap() + "\n").expect("write the contracts");
        return;
    }
    let Some(root) = repo() else {
        log("no repository here: run from inside markdown-markup, where core/ and targets/checks are");
        std::process::exit(2);
    };
    // each contract's prop defaults, by contract id: a prop a test leaves out takes its default
    let mut defaults = BTreeMap::new();
    let contracts = arg("--contracts");
    match contracts.as_deref().and_then(|f| std::fs::read_to_string(f).ok()) {
        Some(text) => {
            for c in serde_json::from_str::<Json>(&text).ok().and_then(|j| j.as_array().cloned()).unwrap_or_default() {
                let d: Map<String, Json> = c["props"].as_array().into_iter().flatten().filter(|p| p["hasDefault"].as_bool() == Some(true)).map(|p| (p["name"].as_str().unwrap_or("").to_string(), p["default"].clone())).collect();
                defaults.insert(c["id"].as_str().unwrap_or("").to_string(), d);
            }
        }
        None => log("no contracts file (omnicui writes it with the target's stubs:); props left out take the widget's own defaults"),
    }
    let core = mkp_check::compile_core(&core_sources(&root));
    let mut adapter = Adapter { root, core, decls: Decls::default(), defaults, mounted: None };
    match adapter.compile("@@@\nThe core declarations.\n") {
        Ok(m) => adapter.decls = source::declarations(&serde_json::to_value(mkp_egui::runtime::ir::File { ir: m }).unwrap()),
        Err(e) => {
            log(&format!("core doesn't compile: {}", e));
            std::process::exit(2);
        }
    }
    log(&format!("ready · core from {} · contract defaults from {}", adapter.root.join("core").display(), contracts.as_deref().unwrap_or("(none)")));
    let stdin = std::io::stdin();
    let mut out = std::io::stdout().lock();
    for line in stdin.lock().lines() {
        let Ok(line) = line else { break };
        if line.trim().is_empty() {
            continue;
        }
        let reply = match serde_json::from_str::<Json>(&line) {
            Err(_) => json!({ "jsonrpc": "2.0", "id": null, "error": { "code": -32700, "message": "parse error" } }),
            Ok(req) => {
                let method = req["method"].as_str().unwrap_or_default().to_string();
                let params = req.get("params").cloned().unwrap_or(json!({}));
                let result = std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| adapter.handle(&method, &params))).unwrap_or_else(|p| {
                    let why = p.downcast_ref::<String>().cloned().or_else(|| p.downcast_ref::<&str>().map(|s| s.to_string())).unwrap_or_default();
                    Err(fail(STEP_FAILED, format!("{} panicked: {}", method, why.lines().next().unwrap_or_default())))
                });
                match result {
                    Ok(v) => json!({ "jsonrpc": "2.0", "id": req["id"], "result": v }),
                    Err(Rpc(code, message)) => {
                        log(&format!("{} failed: {}", method, message));
                        json!({ "jsonrpc": "2.0", "id": req["id"], "error": { "code": code, "message": message } })
                    }
                }
            }
        };
        // protocol: exactly one reply per request, one line, on standard output
        if writeln!(out, "{}", reply).and_then(|_| out.flush()).is_err() {
            break;
        }
    }
}
