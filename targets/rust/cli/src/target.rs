//! `mkp target check`: every target check, run on targets through their check adapters
//! (plan tab 16). The compiler is checked once, by its own tests; a target is given the IR the
//! compiler wrote for each case, and is checked on running and drawing it. After every step the
//! runner asks for one observation and compares what the step states; with several targets, every
//! target's whole observation is compared with every other's too.

use std::collections::BTreeMap;
use std::io::{BufRead, BufReader, Write};
use std::path::{Path, PathBuf};
use std::process::{Child, ChildStdin, ChildStdout, Command, ExitCode, Stdio};

use serde_json::{json, Value};

/// A target, from its `target.yaml`.
pub struct Target {
    pub name: String,
    pub dir: PathBuf,
    pub levels: Vec<String>,
    pub adapter: Vec<String>,
}

/// The few lines of `target.yaml` the runner reads: `name`, `levels` and `check_adapter`.
fn read_target(path: &Path) -> Result<Target, String> {
    let text = std::fs::read_to_string(path).map_err(|e| format!("{}: {}", path.display(), e))?;
    let mut name = None;
    let mut levels = Vec::new();
    let mut adapter = None;
    for line in text.lines() {
        let line = line.split(" #").next().unwrap_or("").trim_end();
        if line.starts_with(' ') || line.is_empty() || line.starts_with('#') {
            continue;
        }
        let Some((key, value)) = line.split_once(':') else { continue };
        let value = value.trim();
        match key.trim() {
            "name" => name = Some(value.to_string()),
            "levels" => levels = value.trim_start_matches('[').trim_end_matches(']').split(',').map(|s| s.trim().to_string()).filter(|s| !s.is_empty()).collect(),
            "check_adapter" => adapter = Some(value.strip_prefix("exec ").unwrap_or(value).split_whitespace().map(str::to_string).collect::<Vec<_>>()),
            _ => {}
        }
    }
    Ok(Target {
        name: name.ok_or_else(|| format!("{}: no name", path.display()))?,
        dir: path.parent().unwrap().to_path_buf(),
        levels,
        adapter: adapter.ok_or_else(|| format!("{}: no check_adapter", path.display()))?,
    })
}

/// Every `target.yaml` under the repository's targets folder.
fn find_targets(root: &Path) -> Vec<Target> {
    fn walk(dir: &Path, out: &mut Vec<PathBuf>) {
        let Ok(entries) = std::fs::read_dir(dir) else { return };
        let mut paths: Vec<PathBuf> = entries.filter_map(|e| e.ok().map(|e| e.path())).collect();
        paths.sort();
        for p in paths {
            let name = p.file_name().and_then(|n| n.to_str()).unwrap_or("");
            if p.is_dir() && !matches!(name, "node_modules" | "target" | "dist" | ".git") {
                walk(&p, out);
            } else if name == "target.yaml" {
                out.push(p);
            }
        }
    }
    let mut files = Vec::new();
    walk(&root.join("targets"), &mut files);
    files.iter().filter_map(|f| read_target(f).ok()).collect()
}

/// A running check adapter: JSON-RPC 2.0, one message per line.
struct Adapter {
    child: Child,
    input: ChildStdin,
    output: BufReader<ChildStdout>,
    next: u64,
}

impl Adapter {
    fn start(t: &Target, defect: Option<&str>) -> Result<Adapter, String> {
        let mut cmd = Command::new(&t.adapter[0]);
        cmd.args(&t.adapter[1..]).current_dir(&t.dir).stdin(Stdio::piped()).stdout(Stdio::piped()).stderr(Stdio::inherit());
        if let Some(d) = defect {
            cmd.env("MKP_TEST_DEFECT", d);
        }
        let mut child = cmd.spawn().map_err(|e| format!("{}: can't start {:?}: {}", t.name, t.adapter, e))?;
        let input = child.stdin.take().unwrap();
        let output = BufReader::new(child.stdout.take().unwrap());
        Ok(Adapter { child, input, output, next: 1 })
    }

    fn call(&mut self, method: &str, params: Value) -> Result<Value, String> {
        let id = self.next;
        self.next += 1;
        let msg = json!({ "jsonrpc": "2.0", "id": id, "method": method, "params": params });
        writeln!(self.input, "{}", msg).map_err(|e| format!("{}: {}", method, e))?;
        self.input.flush().map_err(|e| e.to_string())?;
        let mut line = String::new();
        loop {
            line.clear();
            if self.output.read_line(&mut line).map_err(|e| e.to_string())? == 0 {
                return Err(format!("the adapter closed before answering `{}`", method));
            }
            let Ok(reply) = serde_json::from_str::<Value>(&line) else { continue };
            if reply["id"].as_u64() != Some(id) {
                continue;
            }
            if let Some(err) = reply.get("error") {
                return Err(format!("`{}` refused: {}", method, err["message"].as_str().unwrap_or("")));
            }
            return Ok(reply.get("result").cloned().unwrap_or(Value::Null));
        }
    }
}

impl Drop for Adapter {
    fn drop(&mut self) {
        let _ = self.call("quit", json!({}));
        let _ = self.child.kill();
        let _ = self.child.wait();
    }
}

/// A case that runs on targets: its id, what to load, and its steps.
struct Case {
    id: String,
    ir: PathBuf,
    page: Value,
    markdown: Option<Value>,
    steps: Vec<Value>,
    dir: PathBuf,
    /// The levels a target needs for this case.
    levels: Vec<String>,
}

/// Markdown text read as blocks, by MKP's own reader.
fn read_blocks(base: &mkp_check::Checker, text: &str) -> Result<Value, String> {
    let c = mkp_check::compile_on(base, &[], &[mkp_check::Source { path: "observed.mkp.md".into(), text: text.into() }], "doc");
    let mut m = c.module.ok_or("the Markdown doesn't read")?;
    mkp_lower::lower(&mut m);
    let b = mkp_markdown::page(&m).map_err(|e| e.0)?;
    Ok(mkp_markdown::blocks_json(&b))
}

/// What differs between a step's expectations and an observation: empty when it all holds.
fn compare(base: &mkp_check::Checker, dir: &Path, want: &Value, got: &Value) -> Vec<String> {
    let mut out = Vec::new();
    let Some(want) = want.as_object() else { return out };
    for (k, w) in want {
        match k.as_str() {
            "tree" => {
                for (site, ws) in w.as_object().into_iter().flatten() {
                    let Some(gs) = got["tree"].get(site) else {
                        out.push(format!("tree: nothing is mounted at {}", site));
                        continue;
                    };
                    if let Some(widget) = ws.get("widget") {
                        if gs.get("widget") != Some(widget) {
                            out.push(format!("tree {}: widget {} where {} was wanted", site, gs["widget"], widget));
                        }
                    }
                    for (p, v) in ws.get("props").and_then(|p| p.as_object()).into_iter().flatten() {
                        if gs["props"].get(p) != Some(v) {
                            out.push(format!("tree {}: {} is {}, not {}", site, p, gs["props"].get(p).unwrap_or(&Value::Null), v));
                        }
                    }
                    if let Some(slots) = ws.get("slots") {
                        if gs.get("slots") != Some(slots) {
                            out.push(format!("tree {}: slots {}, not {}", site, gs.get("slots").unwrap_or(&Value::Null), slots));
                        }
                    }
                }
            }
            "state" => {
                for (f, v) in w.as_object().into_iter().flatten() {
                    if got["state"].get(f) != Some(v) {
                        out.push(format!("$state.{} is {}, not {}", f, got["state"].get(f).unwrap_or(&Value::Null), v));
                    }
                }
            }
            "calls" | "boxes" => {
                if got.get(k) != Some(w) {
                    out.push(format!("{} are {}, not {}", k, got.get(k).unwrap_or(&Value::Null), w));
                }
            }
            "outcome" => {
                for part in ["refused", "failures"] {
                    if let Some(wl) = w.get(part) {
                        let gl = got["outcome"].get(part).cloned().unwrap_or(json!([]));
                        // only the fields a case states are compared: a rule, a code, a site
                        let fits = wl.as_array().map_or(0, |a| a.len()) == gl.as_array().map_or(0, |a| a.len())
                            && wl.as_array().into_iter().flatten().zip(gl.as_array().into_iter().flatten()).all(|(a, b)| a.as_object().into_iter().flatten().all(|(k, v)| b.get(k) == Some(v)));
                        if !fits {
                            out.push(format!("outcome {}: {}, not {}", part, gl, wl));
                        }
                    }
                }
            }
            "markdown" => {
                let text = got["markdown"].as_str().unwrap_or("");
                let found = match read_blocks(base, text) {
                    Ok(b) => b,
                    Err(e) => {
                        out.push(format!("markdown: {}: {:?}", e, text));
                        continue;
                    }
                };
                let ok = if let Some(b) = w.get("blocks") {
                    *b == found
                } else if let Some(has) = w.get("has") {
                    has.as_array().into_iter().flatten().all(|b| found.as_array().map_or(false, |f| f.contains(b)))
                } else if let Some(file) = w.get("file") {
                    let expected = std::fs::read_to_string(dir.join(file.as_str().unwrap_or(""))).unwrap_or_default();
                    read_blocks(base, &expected).map_or(false, |b| b == found)
                } else {
                    false
                };
                if !ok {
                    out.push(format!("markdown: {:?}", text));
                }
            }
            other => out.push(format!("the case states `{}`, which isn't observed", other)),
        }
    }
    out
}

fn repo() -> PathBuf {
    // the repository: where `targets/checks` is, from here or above
    let here = std::env::current_dir().unwrap_or_default();
    here.ancestors().find(|d| d.join("targets/checks/cases").is_dir()).map(Path::to_path_buf).unwrap_or(here)
}

/// The cases that run on targets: every one whose source compiles. A case that expects a compile
/// error checks the compiler only.
fn cases(base: &mkp_check::Checker, dir: &Path, tmp: &Path) -> Vec<Case> {
    fn walk(dir: &Path, out: &mut Vec<PathBuf>) {
        let Ok(entries) = std::fs::read_dir(dir) else { return };
        let mut paths: Vec<PathBuf> = entries.filter_map(|e| e.ok().map(|e| e.path())).collect();
        paths.sort();
        for p in paths {
            if p.is_dir() {
                walk(&p, out);
            } else if p.extension().map_or(false, |x| x == "json") {
                out.push(p);
            }
        }
    }
    let mut files = Vec::new();
    if dir.is_dir() {
        walk(dir, &mut files);
    } else {
        files.push(dir.to_path_buf());
    }
    let mut out = Vec::new();
    for f in files {
        let Ok(case) = serde_json::from_str::<Value>(&std::fs::read_to_string(&f).unwrap_or_default()) else { continue };
        let Some(id) = case["id"].as_str() else { continue };
        let cdir = f.parent().unwrap().to_path_buf();
        let src = cdir.join(case["source"].as_str().unwrap_or(""));
        let Ok(text) = std::fs::read_to_string(&src) else { continue };
        let mut packs = Vec::new();
        for p in case["packs"].as_array().into_iter().flatten() {
            let p = cdir.join(p.as_str().unwrap_or(""));
            let mut files = Vec::new();
            if p.is_dir() {
                walk_mkp(&p, &mut files);
            } else {
                files.push(p);
            }
            for f in files {
                packs.push(mkp_check::Source { path: f.to_string_lossy().into_owned(), text: std::fs::read_to_string(&f).unwrap_or_default() });
            }
        }
        let path = src.to_string_lossy().into_owned();
        let module = if path.ends_with(".mkp.md") { "doc" } else { "t" };
        let c = mkp_check::compile_on(base, &[packs], &[mkp_check::Source { path, text }], module);
        let Some(mut m) = c.module else { continue };
        mkp_lower::lower(&mut m);
        let ir = tmp.join(format!("{}.ir.json", id));
        if std::fs::write(&ir, serde_json::to_string(&mkp_ir::ir::File { ir: m }).unwrap()).is_err() {
            continue;
        }
        out.push(Case {
            id: id.to_string(),
            ir,
            page: case.get("page").cloned().unwrap_or(json!({})),
            markdown: case["expect"].get("markdown").cloned(),
            steps: case["steps"].as_array().cloned().unwrap_or_default(),
            dir: cdir,
            levels: case["target"]["levels"].as_array().into_iter().flatten().filter_map(|l| l.as_str().map(str::to_string)).collect(),
        });
    }
    out
}

fn walk_mkp(dir: &Path, out: &mut Vec<PathBuf>) {
    let Ok(entries) = std::fs::read_dir(dir) else { return };
    let mut paths: Vec<PathBuf> = entries.filter_map(|e| e.ok().map(|e| e.path())).collect();
    paths.sort();
    for p in paths {
        if p.is_dir() {
            walk_mkp(&p, out);
        } else if p.extension().map_or(false, |x| x == "mkp") {
            out.push(p);
        }
    }
}

/// One target, every case: each case's observations, by step (0 is the page as loaded), and
/// what differed from the case.
fn run_target(base: &mkp_check::Checker, t: &Target, cases: &[Case], defect: Option<&str>) -> Result<(BTreeMap<String, Vec<Value>>, Vec<String>, usize), String> {
    let mut adapter = Adapter::start(t, defect)?;
    let ad = adapter.call("advertise", json!({ "protocol": "1" }))?;
    if ad["protocol"].as_str() != Some("1") {
        return Err(format!("{} speaks protocol {}, not 1", t.name, ad["protocol"]));
    }
    let mut observed = BTreeMap::new();
    let mut failures = Vec::new();
    let mut steps = 0;
    for c in cases {
        // a case that needs a level the target doesn't have isn't run on it
        if !c.levels.iter().all(|l| t.levels.contains(l)) {
            continue;
        }
        let mut seen = Vec::new();
        let mut fail = |what: String| failures.push(format!("{} {}: {}", t.name, c.id, what));
        if let Err(e) = adapter.call("load", json!({ "ir": c.ir.to_string_lossy(), "page": c.page })) {
            fail(e);
            continue;
        }
        let first = match adapter.call("observe", json!({})) {
            Ok(o) => o,
            Err(e) => {
                fail(e);
                continue;
            }
        };
        if let Some(md) = &c.markdown {
            for d in compare(base, &c.dir, &json!({ "markdown": md }), &first) {
                fail(format!("as loaded: {}", d));
            }
        }
        seen.push(first);
        for (k, step) in c.steps.iter().enumerate() {
            steps += 1;
            let Some((method, params)) = step["do"].as_object().and_then(|o| o.iter().next()) else {
                fail(format!("step {} does nothing", k + 1));
                continue;
            };
            let params = if method == "page" { json!({ "page": params }) } else { params.clone() };
            if let Err(e) = adapter.call(method, params) {
                fail(format!("step {}: {}", k + 1, e));
                continue;
            }
            match adapter.call("observe", json!({})) {
                Ok(o) => {
                    for d in compare(base, &c.dir, step.get("expect").unwrap_or(&json!({})), &o) {
                        fail(format!("step {}: {}", k + 1, d));
                    }
                    seen.push(o);
                }
                Err(e) => fail(format!("step {}: {}", k + 1, e)),
            }
        }
        observed.insert(c.id.clone(), seen);
    }
    Ok((observed, failures, steps))
}

/// `mkp target check [target…] [--cases dir] [--defect name] [--expect-failures]`
pub fn target_check(args: &[String]) -> ExitCode {
    let root = repo();
    let mut names = Vec::new();
    let mut cases_dir = root.join("targets/checks/cases");
    let mut defect = None;
    let mut expect_failures = false;
    let mut k = 0;
    while k < args.len() {
        match args[k].as_str() {
            "--cases" => {
                cases_dir = PathBuf::from(args.get(k + 1).cloned().unwrap_or_default());
                k += 2;
            }
            "--defect" => {
                defect = args.get(k + 1).cloned();
                k += 2;
            }
            "--expect-failures" => {
                expect_failures = true;
                k += 1;
            }
            other => {
                names.push(other.to_string());
                k += 1;
            }
        }
    }
    let all = find_targets(&root);
    let targets: Vec<&Target> = if names.is_empty() { all.iter().collect() } else { all.iter().filter(|t| names.contains(&t.name)).collect() };
    if targets.is_empty() {
        eprintln!("no target {:?}: the targets are {:?}", names, all.iter().map(|t| &t.name).collect::<Vec<_>>());
        return ExitCode::from(2);
    }
    let base = mkp_check::compile_core(&crate::core_sources());
    let tmp = std::env::temp_dir().join(format!("mkp-target-check-{}", std::process::id()));
    let _ = std::fs::create_dir_all(&tmp);
    let cases = cases(&base, &cases_dir, &tmp);
    let mut results = Vec::new();
    let mut failures = Vec::new();
    for t in &targets {
        match run_target(&base, t, &cases, defect.as_deref()) {
            Ok((obs, fails, steps)) => {
                println!("{}: {} cases, {} steps, {} differ from the case", t.name, cases.len(), steps, fails.len());
                failures.extend(fails);
                results.push((t.name.clone(), obs));
            }
            Err(e) => failures.push(format!("{}: {}", t.name, e)),
        }
    }
    // every target's whole observation against every other's
    for i in 0..results.len() {
        for j in i + 1..results.len() {
            let (a, oa) = &results[i];
            let (b, ob) = &results[j];
            for (id, sa) in oa {
                let Some(sb) = ob.get(id) else { continue };
                for (k, (x, y)) in sa.iter().zip(sb.iter()).enumerate() {
                    if x != y {
                        failures.push(format!("{} and {} disagree on {} after step {}", a, b, id, k));
                    }
                }
            }
        }
    }
    let _ = std::fs::remove_dir_all(&tmp);
    for f in failures.iter().take(60) {
        eprintln!("{}", f);
    }
    if failures.len() > 60 {
        eprintln!("… and {} more", failures.len() - 60);
    }
    match (failures.is_empty(), expect_failures) {
        (true, false) => ExitCode::SUCCESS,
        (false, true) => {
            println!("caught: {} differences", failures.len());
            ExitCode::SUCCESS
        }
        (true, true) => {
            eprintln!("nothing caught the defect");
            ExitCode::from(1)
        }
        (false, false) => ExitCode::from(1),
    }
}
