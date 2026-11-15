//! The compiler's side of the target checks: every case in targets/checks/cases is compiled,
//! and its diagnostics have to be exactly the ones the case expects, by code, line and column.
//!
//! A case whose diagnostics come from a pass the compiler doesn't have yet is counted as
//! waiting, and listed, so the gap stays visible until that pass exists.

use mkp_syntax::{entry_for, parse, Lines};
use serde_json::Value;
use std::path::{Path, PathBuf};

/// The passes that exist, by the prefix of the codes they report.
const PASSES: &[&str] = &["syntax.", "file.", "widget.", "prose.", "doc.", "layout.", "fmt.", "names.", "views.", "types.", "contracts."];

fn cases_dir() -> PathBuf {
    PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("../../checks/cases")
}

fn walk(dir: &Path, out: &mut Vec<PathBuf>) {
    let mut entries: Vec<_> = std::fs::read_dir(dir).unwrap().map(|e| e.unwrap().path()).collect();
    entries.sort();
    for p in entries {
        if p.is_dir() {
            walk(&p, out);
        } else if p.extension().map_or(false, |e| e == "json") {
            out.push(p);
        }
    }
}

type Found = (String, u32, u32);

fn core() -> Vec<mkp_check::Source> {
    let dir = PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("../../../core");
    let mut files: Vec<PathBuf> = std::fs::read_dir(&dir).unwrap().map(|e| e.unwrap().path()).filter(|p| p.extension().map_or(false, |x| x == "mkp")).collect();
    files.sort();
    files.into_iter().map(|p| mkp_check::Source { path: format!("core/{}", p.file_name().unwrap().to_str().unwrap()), text: std::fs::read_to_string(&p).unwrap() }).collect()
}

/// The case's source, compiled with core; only the source's own diagnostics.
fn compile(path: &Path, core: &[mkp_check::Source]) -> Vec<Found> {
    let name = path.to_str().unwrap().to_string();
    let src = std::fs::read_to_string(path).unwrap();
    entry_for(&name).unwrap_or_else(|| panic!("{}: not an MKP file", name));
    let parsed = parse(&src, entry_for(&name).unwrap());
    let lines = Lines::new(&src);
    let place = |d: &mkp_syntax::Diagnostic| {
        let at = lines.place(d.span.start);
        (d.code.to_string(), at.line, at.column)
    };
    if parsed.has_errors() {
        return parsed.diagnostics.iter().map(place).collect();
    }
    let main = mkp_check::Source { path: name.clone(), text: src.clone() };
    let module = if name.ends_with(".mkp.md") { "doc" } else { "t" };
    let c = mkp_check::compile(core, &[], &[main], module);
    c.diagnostics.iter().filter(|d| d.file == name).map(|d| place(&d.diagnostic)).collect()
}

#[test]
fn every_case_reports_its_diagnostics() {
    let mut files = Vec::new();
    walk(&cases_dir(), &mut files);
    assert!(!files.is_empty(), "no cases in {:?}", cases_dir());
    let (mut passed, mut waiting, mut failures) = (0, Vec::new(), Vec::new());
    let core = core();
    for file in &files {
        let case: Value = serde_json::from_str(&std::fs::read_to_string(file).unwrap())
            .unwrap_or_else(|e| panic!("{}: {}", file.display(), e));
        let id = case["id"].as_str().unwrap().to_string();
        let source = file.parent().unwrap().join(case["source"].as_str().unwrap());
        let expected: Vec<Found> = case["expect"]["diagnostics"]
            .as_array()
            .unwrap()
            .iter()
            .map(|d| (d["code"].as_str().unwrap().to_string(), d["line"].as_u64().unwrap() as u32, d["column"].as_u64().unwrap() as u32))
            .collect();
        if expected.iter().any(|(code, ..)| !PASSES.iter().any(|p| code.starts_with(p))) {
            waiting.push(id);
            continue;
        }
        let mut found = compile(&source, &core);
        let mut want = expected.clone();
        found.sort_by(|a, b| (a.1, a.2, &a.0).cmp(&(b.1, b.2, &b.0)));
        want.sort_by(|a, b| (a.1, a.2, &a.0).cmp(&(b.1, b.2, &b.0)));
        if found == want {
            passed += 1;
        } else {
            failures.push(format!("{}: expected {:?}, found {:?}", id, want, found));
        }
    }
    println!("{} cases: {} pass, {} wait for a later pass of the checker", files.len(), passed, waiting.len());
    for w in &waiting {
        println!("  waiting: {}", w);
    }
    assert!(failures.is_empty(), "{} cases failed:\n{}", failures.len(), failures.join("\n"));
}
