//! The resolved IR: every case in targets/checks/cases that compiles writes one that fits
//! schemas/rir.schema.json, with every span inside the file it names.

use jsonschema::{Registry, Validator};
use serde_json::Value;
use std::path::{Path, PathBuf};

const IR_ID: &str = "https://raw.githubusercontent.com/mmujtabamain/markdown-markup/main/schemas/ir.schema.json";

fn repo() -> PathBuf {
    PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("../../..")
}

fn json(path: &Path) -> Value {
    serde_json::from_str(&std::fs::read_to_string(path).unwrap()).unwrap_or_else(|e| panic!("{}: {}", path.display(), e))
}

fn validator() -> Validator {
    let ir = json(&repo().join("schemas/ir.schema.json"));
    let schema = json(&repo().join("schemas/rir.schema.json"));
    let registry = Registry::new().add(IR_ID, ir).unwrap().prepare().unwrap();
    jsonschema::options().with_registry(&registry).build(&schema).unwrap()
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

fn sources(dir: &Path, names: &[&str]) -> Vec<mkp_check::Source> {
    fn add(p: &Path, out: &mut Vec<mkp_check::Source>) {
        if p.is_dir() {
            let mut files: Vec<PathBuf> = std::fs::read_dir(p).unwrap().map(|e| e.unwrap().path()).collect();
            files.sort();
            for f in files {
                add(&f, out);
            }
        } else if p.extension().map_or(false, |x| x == "mkp") {
            out.push(mkp_check::Source { path: p.to_string_lossy().into_owned(), text: std::fs::read_to_string(p).unwrap() });
        }
    }
    let mut out = Vec::new();
    for n in names {
        add(&dir.join(n), &mut out);
    }
    out
}

fn spans(v: &Value, out: &mut Vec<(u64, u64)>) {
    match v {
        Value::Object(m) => {
            for (k, x) in m {
                if (k == "span" || k.ends_with("_span") || k == "front_matter") && x.is_array() {
                    out.push((x[0].as_u64().unwrap(), x[1].as_u64().unwrap()));
                } else {
                    spans(x, out);
                }
            }
        }
        Value::Array(a) => a.iter().for_each(|x| spans(x, out)),
        _ => {}
    }
}

#[test]
fn every_compiling_case_writes_a_resolved_ir_that_fits_its_schema() {
    let v = validator();
    let core = sources(&repo().join("core"), &["."]);
    let base = mkp_check::compile_core(&core);
    let mut cases = Vec::new();
    walk(&repo().join("targets/checks/cases"), &mut cases);
    let (mut written, mut failures) = (0, Vec::new());
    for case_path in cases {
        let case = json(&case_path);
        let Some(source) = case["source"].as_str() else { continue };
        let dir = case_path.parent().unwrap();
        let names: Vec<&str> = case["packs"].as_array().into_iter().flatten().filter_map(Value::as_str).collect();
        let packs = sources(dir, &names);
        let path = dir.join(source);
        let name = path.to_string_lossy().into_owned();
        let main = mkp_check::Source { path: name.clone(), text: std::fs::read_to_string(&path).unwrap() };
        let module = if name.ends_with(".mkp.md") { "doc" } else { "t" };
        let (_, rir) = mkp_check::compile_rir(&base, &[packs], &[main], module);
        let Some(rir) = rir else { continue };
        let errs: Vec<String> = v.iter_errors(&rir).map(|e| format!("{} at {}", e, e.instance_path())).take(3).collect();
        if !errs.is_empty() {
            failures.push(format!("{}: {:#?}", case_path.display(), errs));
            continue;
        }
        for file in rir["files"].as_array().unwrap() {
            let len = std::fs::read_to_string(file["path"].as_str().unwrap()).unwrap().len() as u64;
            let mut all = Vec::new();
            spans(file, &mut all);
            if let Some((s, e)) = all.iter().find(|(s, e)| s > e || *e > len) {
                failures.push(format!("{}: a span [{}, {}] outside {} ({} bytes)", case_path.display(), s, e, file["path"], len));
            }
        }
        written += 1;
    }
    eprintln!("resolved IR: {} cases written", written);
    assert!(failures.is_empty(), "{} of {} fail:\n{}", failures.len(), written + failures.len(), failures.join("\n"));
    assert!(written >= 50, "only {} cases compiled", written);
}

#[test]
fn the_example_is_what_mkp_build_rir_writes() {
    let (path, want) = ("schemas/examples/counter.mkp.md", repo().join("schemas/examples/counter.rir.json"));
    let out = std::process::Command::new(env!("CARGO_BIN_EXE_mkp")).current_dir(repo()).args(["build", path, "--rir"]).output().unwrap();
    assert!(out.status.success(), "{}", String::from_utf8_lossy(&out.stderr));
    let got: Value = serde_json::from_slice(&out.stdout).unwrap();
    assert_eq!(got, json(&want), "schemas/examples/counter.rir.json is not what `mkp build --rir` writes: run it with -o");
}
