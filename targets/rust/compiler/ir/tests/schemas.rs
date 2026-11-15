//! The schemas, their examples and the generated types agree.

use jsonschema::{Resource, Validator};
use serde_json::Value;
use std::path::{Path, PathBuf};

const IR_ID: &str = "https://raw.githubusercontent.com/mmujtabamain/markdown-markup/main/schemas/ir.schema.json";

fn repo() -> PathBuf {
    PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("../../../..")
}

fn json(path: &Path) -> Value {
    serde_json::from_str(&std::fs::read_to_string(path).unwrap()).unwrap_or_else(|e| panic!("{}: {}", path.display(), e))
}

fn validator(name: &str) -> Validator {
    let ir = json(&repo().join("schemas/ir.schema.json"));
    let schema = json(&repo().join("schemas").join(name));
    jsonschema::options()
        .with_resource(IR_ID, Resource::from_contents(ir).unwrap())
        .build(&schema)
        .unwrap_or_else(|e| panic!("schemas/{}: {}", name, e))
}

fn errors(v: &Validator, doc: &Value) -> Vec<String> {
    v.iter_errors(doc).map(|e| format!("{} at {}", e, e.instance_path)).take(5).collect()
}

#[test]
fn the_generated_types_are_current() {
    for (path, text) in mkp_schemagen::generate(&repo()) {
        let current = std::fs::read_to_string(repo().join(&path)).unwrap_or_default();
        assert!(current == text, "{} is not current: run `cargo run -p mkp-schemagen`", path.display());
    }
}

#[test]
fn the_ir_examples_fit_the_schema_and_the_rust_types() {
    let v = validator("ir.schema.json");
    let dir = repo().join("schemas/examples");
    let mut n = 0;
    for entry in std::fs::read_dir(&dir).unwrap() {
        let path = entry.unwrap().path();
        if !path.to_str().unwrap().ends_with(".ir.json") {
            continue;
        }
        let doc = json(&path);
        let errs = errors(&v, &doc);
        assert!(errs.is_empty(), "{}: {:#?}", path.display(), errs);
        let typed: mkp_ir::ir::File = serde_json::from_value(doc.clone()).unwrap_or_else(|e| panic!("{}: {}", path.display(), e));
        let back = serde_json::to_value(&typed).unwrap();
        assert_eq!(back, doc, "{} doesn't come back the same through the Rust types", path.display());
        n += 1;
    }
    assert!(n >= 2);
}

#[test]
fn every_check_case_fits_the_schema_and_the_rust_types() {
    let v = validator("check.schema.json");
    let mut files = Vec::new();
    fn walk(dir: &Path, out: &mut Vec<PathBuf>) {
        for e in std::fs::read_dir(dir).unwrap() {
            let p = e.unwrap().path();
            if p.is_dir() {
                walk(&p, out);
            } else if p.extension().map_or(false, |x| x == "json") {
                out.push(p);
            }
        }
    }
    walk(&repo().join("targets/checks/cases"), &mut files);
    assert!(!files.is_empty());
    for path in files {
        let doc = json(&path);
        let errs = errors(&v, &doc);
        assert!(errs.is_empty(), "{}: {:#?}", path.display(), errs);
        let _: mkp_ir::check::Case = serde_json::from_value(doc).unwrap_or_else(|e| panic!("{}: {}", path.display(), e));
    }
}

#[test]
fn a_value_outside_the_schema_is_refused() {
    let v = validator("ir.schema.json");
    let mut doc = json(&repo().join("schemas/examples/counter.ir.json"));
    doc["ir"]["bindings"][0]["value"] = serde_json::json!({"nothing": 1});
    assert!(!errors(&v, &doc).is_empty());
    assert!(serde_json::from_value::<mkp_ir::ir::File>(doc).is_err());
}
