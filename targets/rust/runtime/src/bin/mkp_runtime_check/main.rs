//! The headless native target's check adapter: `mkp target check native` drives mkp-runtime
//! through it over JSON-RPC 2.0, one message per line on standard input and output (plan tab 16),
//! as targets/ts/test/adapter.mjs drives @mkp/runtime. Logs go to standard error only.
//!
//! It draws nothing. It lays widgets out with the test target's fixed sizes (sizes.rs), and
//! `MKP_TEST_DEFECT` switches on the test target's defects, so each check is shown to catch a
//! broken native runtime too. Unlike the test target it takes no shader samples.

mod sizes;

use std::collections::HashSet;
use std::io::{BufRead, Write};
use std::path::{Path, PathBuf};
use std::rc::Rc;

use mkp_runtime::layout::region_of;
use mkp_runtime::ir::Expr;
use mkp_runtime::{Broken, Drawn, Page, PageOptions, PageTheme, PageValues, PageWidth, Value};
use serde_json::{json, Value as Json};

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

/// The repository: where `targets/checks` is, from the working folder or the binary, upwards.
fn repo() -> Option<PathBuf> {
    let starts = [std::env::current_dir().ok(), std::env::current_exe().ok()];
    starts.into_iter().flatten().find_map(|s| s.ancestors().find(|d| d.join("targets/checks").is_dir()).map(Path::to_path_buf))
}

/// The check packs' externs this target draws: each pack's supplies.json, under "native".
fn pack_supplies() -> HashSet<String> {
    let mut out = HashSet::new();
    let Some(root) = repo() else { return out };
    let Ok(entries) = std::fs::read_dir(root.join("targets/checks/packs")) else { return out };
    for e in entries.flatten() {
        let Ok(text) = std::fs::read_to_string(e.path().join("supplies.json")) else { continue };
        let Ok(j) = serde_json::from_str::<Json>(&text) else { continue };
        for w in j["native"].as_array().into_iter().flatten() {
            if let Some(w) = w.as_str() {
                out.insert(w.to_string());
            }
        }
    }
    out
}

fn expr(j: &Json) -> Result<Expr, String> {
    serde_json::from_value(j.clone()).map_err(|e| format!("not a value: {}", e))
}

fn fail(f: mkp_runtime::Failure) -> String {
    f.message
}

struct Adapter {
    page: Option<Page>,
    defects: Vec<String>,
    supplies: Rc<HashSet<String>>,
}

impl Adapter {
    fn page(&mut self) -> Result<&mut Page, String> {
        self.page.as_mut().ok_or_else(|| "no page is loaded".to_string())
    }

    /// Lays the planes out after every change, as a screen would after drawing.
    fn settle(&mut self) -> Result<Json, String> {
        self.page()?.layout(&mut sizes::Fixed).map_err(fail)?;
        Ok(json!({}))
    }

    fn values(&mut self, xs: &Json) -> Result<Vec<Value>, String> {
        let page = self.page()?;
        xs.as_array().into_iter().flatten().map(|x| page.value(&expr(x)?).map_err(fail)).collect()
    }

    fn record(&mut self, o: &Json) -> Result<Vec<(String, Value)>, String> {
        let page = self.page()?;
        o.as_object().into_iter().flatten().map(|(k, x)| Ok((k.clone(), page.value(&expr(x)?).map_err(fail)?))).collect()
    }

    fn page_values(&self, j: &Json) -> PageValues {
        if self.defects.iter().any(|d| d == "ignores-page") {
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

    fn call(&mut self, method: &str, p: &Json) -> Result<Json, String> {
        match method {
            "advertise" => Ok(json!({ "name": "native", "protocol": "1", "levels": ["core.draw", "core.live", "core.gfx"], "supplies": ["core/*", "core/can_draw_tex", "core/moment.local"] })),
            "load" => {
                let path = p["ir"].as_str().ok_or("load takes the IR's path")?;
                let text = std::fs::read_to_string(path).map_err(|e| format!("{}: {}", path, e))?;
                let mut opts = PageOptions { page: self.page_values(&p["page"]), defects: self.defects.clone(), ..PageOptions::default() };
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
                opts.fns = sizes::target_fns().into_iter().collect();
                let packs = self.supplies.clone();
                opts.supplies = Some(Rc::new(move |w: &str| w.starts_with("core/") || packs.contains(w)));
                // a page that doesn't mount leaves the last one where it was
                self.page = Some(Page::from_json(&text, opts).map_err(fail)?);
                self.settle()
            }
            "event" => {
                let args = self.values(&p["args"])?;
                self.page()?.event(p["site"].as_str().unwrap_or(""), p["name"].as_str().unwrap_or(""), args).map_err(fail)?;
                self.settle()
            }
            "write" => {
                let page = self.page()?;
                let value = page.value(&expr(&p["value"])?).map_err(fail)?;
                page.write(p["site"].as_str().unwrap_or(""), p["input"].as_str().unwrap_or(""), value).map_err(fail)?;
                self.settle()
            }
            "set" => {
                let changes = self.record(&p["$state"])?;
                self.page()?.set(changes).map_err(fail)?;
                self.settle()
            }
            "expose" => {
                let args = self.values(&p["args"])?;
                self.page()?.expose(p["channel"].as_str().unwrap_or(""), p["name"].as_str().unwrap_or(""), args).map_err(fail)?;
                self.settle()
            }
            "extern" => {
                let given = self.record(&p["values"])?;
                self.page()?.set_extern(p["channel"].as_str().unwrap_or(""), given).map_err(fail)?;
                self.settle()
            }
            "page" => {
                if !self.defects.iter().any(|d| d == "ignores-page") {
                    let values = self.page_values(&p["page"]);
                    self.page()?.set_page(values).map_err(fail)?;
                }
                self.settle()
            }
            "observe" => {
                let page = self.page()?;
                let found = boxes(page.tree());
                let tree = serde_json::to_value(page.observe_tree()).map_err(|e| e.to_string())?;
                let state = serde_json::to_value(page.observe_state()).map_err(|e| e.to_string())?;
                let calls = serde_json::to_value(page.take_calls()).map_err(|e| e.to_string())?;
                let outcome = page.take_outcome();
                let markdown = page.markdown().map_err(fail)?;
                let broken = |b: &[Broken]| serde_json::to_value(b).unwrap_or(Json::Null);
                let mut o = json!({ "tree": tree, "state": state, "calls": calls, "outcome": { "refused": broken(&outcome.refused), "failures": broken(&outcome.failures) }, "markdown": markdown });
                if !found.is_empty() {
                    o["boxes"] = Json::Object(found);
                }
                // a shade's fn and arguments: no samples, which are the test target's
                let shaded = page.observe_shaded(false).map_err(fail)?;
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

/// Where each spot landed, by its path, as the observation reports it.
fn boxes(nodes: &[Drawn]) -> serde_json::Map<String, Json> {
    fn walk(nodes: &[Drawn], out: &mut serde_json::Map<String, Json>) {
        for n in nodes {
            if n.widget == "core/spot" {
                if let Some(r) = region_of(n.props.get("box")) {
                    let num = |x: mkp_runtime::Num| json!({ "num": x.show() });
                    out.insert(n.path.clone(), json!({ "from": { "x": num(r.from.x), "y": num(r.from.y) }, "to": { "x": num(r.to.x), "y": num(r.to.y) } }));
                }
            }
            for kids in n.slots.values() {
                walk(kids, out);
            }
        }
    }
    let mut out = serde_json::Map::new();
    walk(nodes, &mut out);
    out
}

fn main() {
    let defects: Vec<String> = std::env::var("MKP_TEST_DEFECT").unwrap_or_default().split(',').filter(|s| !s.is_empty()).map(str::to_string).collect();
    for d in &defects {
        if !DEFECTS.contains(&d.as_str()) {
            eprintln!("native target: no defect {}; the defects are {}", d, DEFECTS.join(", "));
            std::process::exit(2);
        }
    }
    let mut adapter = Adapter { page: None, defects, supplies: Rc::new(pack_supplies()) };
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
                eprintln!("native target: not JSON: {}", line);
                continue;
            }
        };
        let method = req["method"].as_str().unwrap_or("").to_string();
        let known = matches!(method.as_str(), "advertise" | "load" | "event" | "write" | "set" | "expose" | "extern" | "page" | "observe" | "quit");
        let reply = if !known {
            json!({ "jsonrpc": "2.0", "id": req["id"], "error": { "code": -32601, "message": format!("no method {}", method) } })
        } else if !matches!(method.as_str(), "advertise" | "load" | "quit") && adapter.page.is_none() {
            json!({ "jsonrpc": "2.0", "id": req["id"], "error": { "code": -32000, "message": "no page is loaded" } })
        } else {
            let params = req.get("params").cloned().unwrap_or(json!({}));
            match adapter.call(&method, &params) {
                Ok(result) => json!({ "jsonrpc": "2.0", "id": req["id"], "result": result }),
                Err(e) => {
                    eprintln!("native target: {}: {}", method, e);
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
