//! The egui target's check adapter: `mkp target check egui` drives it over JSON-RPC 2.0, one
//! message per line on standard input and output (plan tab 16). Logs go to standard error only.
//!
//! Each page runs headless in egui_kittest's harness with our egui widgets ([`mkp_egui::MkpPage`]),
//! and every step runs frames until the page has settled. Steps go through the drawn widgets where
//! they can, as the web's go through its DOM: a press's click is a real pointer click on its node
//! in the AccessKit tree; a slider's value, a field's text and an overlay's `open` are acts the
//! widget does with its own controls on its next frame; anything a widget can't do itself goes
//! through the page. The observed tree is what the frames drew (a closed overlay's body included,
//! kept on the page hidden).
//!
//! The plane's layout uses the checks' fixed sizes ([`mkp_egui::measure::Fixed`]), as the web's
//! check harness does, so every target's boxes agree. `MKP_TEST_DEFECT` switches on the runtime's
//! defects, as on the test and native targets.

use std::collections::HashSet;
use std::io::{BufRead, Write};
use std::path::{Path, PathBuf};
use std::rc::Rc;

use egui::accesskit::Role;
use egui::UiBuilder;
use mkp_egui::check::{self, Headless};
use mkp_egui::measure::Fixed;
use mkp_egui::runtime::ir::Expr;
use mkp_egui::runtime::layout::region_of;
use mkp_egui::runtime::{Broken, Drawn, Page, PageOptions, PageTheme, PageValues, PageWidth, Value};
use mkp_egui::widgets::kit::{self, Lay};
use mkp_egui::{Act, Ctx, MkpPage, Props};
use serde_json::{json, Value as Json};

/// The repository: where `targets/checks` is, from the working folder or the binary, upwards.
fn repo() -> Option<PathBuf> {
    let starts = [std::env::current_dir().ok(), std::env::current_exe().ok()];
    starts.into_iter().flatten().find_map(|s| s.ancestors().find(|d| d.join("targets/checks").is_dir()).map(Path::to_path_buf))
}

/// The check packs' externs this target draws: each pack's supplies.json, under "egui".
fn pack_supplies() -> HashSet<String> {
    let mut out = HashSet::new();
    let Some(root) = repo() else { return out };
    let Ok(entries) = std::fs::read_dir(root.join("targets/checks/packs")) else { return out };
    for e in entries.flatten() {
        let Ok(text) = std::fs::read_to_string(e.path().join("supplies.json")) else { continue };
        let Ok(j) = serde_json::from_str::<Json>(&text) else { continue };
        for w in j["egui"].as_array().into_iter().flatten() {
            if let Some(w) = w.as_str() {
                out.insert(w.to_string());
            }
        }
    }
    out
}

/// The badge pack's widget for egui, as a pack ships one per target it supports: a count with
/// its label, one status node, its text following the page.
fn badge(ui: &mut egui::Ui, p: &Props<'_>, ctx: &mut Ctx<'_>) {
    let text = format!("{}: {}", p.text("label"), p.text("count"));
    let ink = ctx.core_color("INK");
    ctx.root(ui, UiBuilder::new().accessibility_role(Role::Status), |ui, ctx| {
        egui::Frame::new().stroke(egui::Stroke::new(1.0, ink)).corner_radius(999.0).inner_margin(egui::Margin::symmetric(8, 2)).show(ui, |ui| {
            kit::leaf(ui, ctx.sub_id("text"), kit::plain(&text, egui::FontId::proportional(14.0), ink), &text, Lay { wrap: false, ..Lay::default() });
        });
    });
}

fn expr(j: &Json) -> Result<Expr, String> {
    serde_json::from_value(j.clone()).map_err(|e| format!("not a value: {}", e))
}

/// The defects a run can switch on, by name: the test target's (targets/ts/test/defects.mjs).
const DEFECTS: [&str; 11] = [
    "no-redraw",
    "no-undo",
    "unchecked-writes",
    "unchecked-app-writes",
    "lost-calls",
    "rows-by-position",
    "no-notice",
    "unescaped-markdown",
    "ignores-page",
    "boxes-in-pixels",
    "boxes-follow-the-view",
];

struct Adapter {
    ui: Option<Headless>,
    defects: Vec<String>,
    packs: Rc<HashSet<String>>,
}

fn page_values(j: &Json, ignore: bool) -> PageValues {
    if ignore {
        return PageValues::default();
    }
    let width = match j["width"].as_str() {
        Some("NARROW") => Some(PageWidth::Narrow),
        Some("MEDIUM") => Some(PageWidth::Medium),
        Some("WIDE") => Some(PageWidth::Wide),
        _ => None,
    };
    let theme = match j["theme"].as_str() {
        Some("LIGHT") => Some(PageTheme::Light),
        Some("DARK") => Some(PageTheme::Dark),
        _ => None,
    };
    PageValues { width, theme }
}

/// Where each spot landed, by its path, as the observation reports it.
fn boxes(nodes: &[Drawn], out: &mut serde_json::Map<String, Json>) {
    for n in nodes {
        if n.widget == "core/spot" {
            if let Some(r) = region_of(n.props.get("box")) {
                let num = |x: mkp_egui::runtime::Num| json!({ "num": x.show() });
                out.insert(n.path.clone(), json!({ "from": { "x": num(r.from.x), "y": num(r.from.y) }, "to": { "x": num(r.to.x), "y": num(r.to.y) } }));
            }
        }
        for kids in n.slots.values() {
            boxes(kids, out);
        }
    }
}

impl Adapter {
    fn ui(&mut self) -> Result<&mut Headless, String> {
        self.ui.as_mut().ok_or_else(|| "no page is loaded".to_string())
    }

    fn page(&mut self) -> Result<&mut Page, String> {
        Ok(self.ui()?.page().page_mut())
    }

    fn settle(&mut self) -> Result<Json, String> {
        let ui = self.ui()?;
        ui.settle()?;
        for e in ui.page().take_errors() {
            eprintln!("egui target: {}", e);
        }
        Ok(json!({}))
    }

    fn values(&mut self, xs: &Json) -> Result<Vec<Value>, String> {
        let page = self.page()?;
        xs.as_array().into_iter().flatten().map(|x| page.value(&expr(x)?).map_err(|f| f.message)).collect()
    }

    fn record(&mut self, o: &Json) -> Result<Vec<(String, Value)>, String> {
        let page = self.page()?;
        o.as_object().into_iter().flatten().map(|(k, x)| Ok((k.clone(), page.value(&expr(x)?).map_err(|f| f.message)?))).collect()
    }

    /// A press's click: a real one, at the middle of its node, when it is on the screen.
    fn press(&mut self, site: &str) -> Result<bool, String> {
        let ui = self.ui()?;
        let Some(node) = ui.widget(site) else { return Ok(false) };
        if !node.author_id().is_some_and(|a| a.starts_with("press@")) {
            return Ok(false);
        }
        let screen = ui.harness.ctx.content_rect();
        let Some(r) = check::rect(&node).filter(|r| r.is_positive() && screen.contains(r.center())) else { return Ok(false) };
        ui.click_at(r.center());
        Ok(true)
    }

    fn call(&mut self, method: &str, p: &Json) -> Result<Json, String> {
        let ignores = self.defects.iter().any(|d| d == "ignores-page");
        match method {
            "advertise" => Ok(json!({
                "name": "egui", "protocol": "1", "levels": ["core.draw", "core.live", "core.gfx"],
                "supplies": ["core/*", "core/moment.local"],
                "cannot": { "core/math": "egui has no maths renderer; the formula shows as its TeX" },
            })),
            "load" => {
                let path = p["ir"].as_str().ok_or("load takes the IR's path")?;
                let text = std::fs::read_to_string(path).map_err(|e| format!("{}: {}", path, e))?;
                let mut opts = PageOptions { page: page_values(&p["page"], ignores), defects: self.defects.clone(), fns: mkp_egui::fns::check_fns(), ..PageOptions::default() };
                for (k, x) in p["state"].as_object().into_iter().flatten() {
                    opts.state.push((k.clone(), expr(x)?));
                }
                for (c, values) in p["externs"].as_object().into_iter().flatten() {
                    let mut given = Vec::new();
                    for (k, x) in values.as_object().into_iter().flatten() {
                        given.push((k.clone(), expr(x)?));
                    }
                    opts.externs.push((c.clone(), given));
                }
                let page = Page::from_json(&text, opts).map_err(|f| f.message)?;
                let mut mkp = MkpPage::new(page).with_measure(Box::new(Fixed)).follow_theme(false);
                if self.packs.contains("badge/badge") {
                    mkp = mkp.widget("badge/badge", || badge as fn(&mut egui::Ui, &Props<'_>, &mut Ctx<'_>));
                }
                // a page that doesn't mount leaves the last one where it was
                self.ui = Some(Headless::new(mkp, egui::vec2(800.0, 1600.0), false));
                self.settle()
            }
            "event" => {
                let site = p["site"].as_str().unwrap_or("").to_string();
                let name = p["name"].as_str().unwrap_or("").to_string();
                let args = self.values(&p["args"])?;
                let real = name == "click" && args.is_empty() && self.press(&site)?;
                if !real {
                    self.ui()?.page().act(&site, Act::Event { name, args });
                }
                self.settle()
            }
            "write" => {
                let site = p["site"].as_str().unwrap_or("").to_string();
                let input = p["input"].as_str().unwrap_or("").to_string();
                let value = self.page()?.value(&expr(&p["value"])?).map_err(|f| f.message)?;
                self.ui()?.page().act(&site, Act::Write { input, value });
                self.settle()
            }
            "set" => {
                let changes = self.record(&p["$state"])?;
                self.page()?.set(changes).map_err(|f| f.message)?;
                self.settle()
            }
            "expose" => {
                let args = self.values(&p["args"])?;
                self.page()?.expose(p["channel"].as_str().unwrap_or(""), p["name"].as_str().unwrap_or(""), args).map_err(|f| f.message)?;
                self.settle()
            }
            "extern" => {
                let given = self.record(&p["values"])?;
                self.page()?.set_extern(p["channel"].as_str().unwrap_or(""), given).map_err(|f| f.message)?;
                self.settle()
            }
            "page" => {
                if !ignores {
                    let values = page_values(&p["page"], false);
                    self.page()?.set_page(values).map_err(|f| f.message)?;
                }
                self.settle()
            }
            "observe" => {
                let ui = self.ui()?;
                let shown = ui.page().shown().clone();
                let page = ui.page().page_mut();
                let mut found = serde_json::Map::new();
                boxes(page.tree(), &mut found);
                // the observed tree is what egui drew: a widget only the page knows isn't on the screen
                let tree: serde_json::Map<String, Json> = page.observe_tree().into_iter().filter(|(path, _)| shown.contains(path)).map(|(k, v)| (k, serde_json::to_value(v).unwrap_or(Json::Null))).collect();
                let state = serde_json::to_value(page.observe_state()).map_err(|e| e.to_string())?;
                let calls = serde_json::to_value(page.take_calls()).map_err(|e| e.to_string())?;
                let outcome = page.take_outcome();
                let markdown = page.markdown().map_err(|f| f.message)?;
                let broken = |b: &[Broken]| serde_json::to_value(b).unwrap_or(Json::Null);
                let mut o = json!({ "tree": tree, "state": state, "calls": calls, "outcome": { "refused": broken(&outcome.refused), "failures": broken(&outcome.failures) }, "markdown": markdown });
                if !found.is_empty() {
                    o["boxes"] = Json::Object(found);
                }
                // a shade's fn and arguments: no samples, which are the test target's
                let shaded = page.observe_shaded(false).map_err(|f| f.message)?;
                if !shaded.is_empty() {
                    let mut s = serde_json::Map::new();
                    for (path, sh) in shaded {
                        s.insert(path, json!({ "shader": sh.shader, "args": serde_json::to_value(&sh.args).unwrap_or(Json::Null) }));
                    }
                    o["shaded"] = Json::Object(s);
                }
                Ok(o)
            }
            "quit" => Ok(json!({})),
            other => Err(format!("no method {}", other)),
        }
    }
}

fn main() {
    let defects: Vec<String> = std::env::var("MKP_TEST_DEFECT").unwrap_or_default().split(',').filter(|s| !s.is_empty()).map(str::to_string).collect();
    for d in &defects {
        if !DEFECTS.contains(&d.as_str()) {
            eprintln!("egui target: no defect {}; the defects are {}", d, DEFECTS.join(", "));
            std::process::exit(2);
        }
    }
    let mut adapter = Adapter { ui: None, defects, packs: Rc::new(pack_supplies()) };
    let stdin = std::io::stdin();
    let mut out = std::io::stdout().lock();
    for line in stdin.lock().lines() {
        let Ok(line) = line else { break };
        if line.trim().is_empty() {
            continue;
        }
        let req: Json = match serde_json::from_str(&line) {
            Ok(r) => r,
            Err(_) => {
                let _ = writeln!(out, "{}", json!({ "jsonrpc": "2.0", "id": null, "error": { "code": -32700, "message": "parse error" } }));
                let _ = out.flush();
                continue;
            }
        };
        let method = req["method"].as_str().unwrap_or("").to_string();
        let known = matches!(method.as_str(), "advertise" | "load" | "event" | "write" | "set" | "expose" | "extern" | "page" | "observe" | "quit");
        let reply = if !known {
            json!({ "jsonrpc": "2.0", "id": req["id"], "error": { "code": -32601, "message": format!("no method {}", method) } })
        } else if !matches!(method.as_str(), "advertise" | "load" | "quit") && adapter.ui.is_none() {
            json!({ "jsonrpc": "2.0", "id": req["id"], "error": { "code": -32000, "message": "no page is loaded" } })
        } else {
            let params = req.get("params").cloned().unwrap_or(json!({}));
            let r = std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| adapter.call(&method, &params))).unwrap_or_else(|p| {
                let why = p.downcast_ref::<String>().cloned().or_else(|| p.downcast_ref::<&str>().map(|s| s.to_string())).unwrap_or_default();
                Err(format!("{} panicked: {}", method, why))
            });
            match r {
                Ok(result) => json!({ "jsonrpc": "2.0", "id": req["id"], "result": result }),
                Err(e) => {
                    eprintln!("egui target: {}: {}", method, e);
                    json!({ "jsonrpc": "2.0", "id": req["id"], "error": { "code": -32000, "message": e } })
                }
            }
        };
        let _ = writeln!(out, "{}", reply);
        let _ = out.flush();
        if method == "quit" {
            break;
        }
    }
}
