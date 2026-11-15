//! Every IR the compiler writes validates against schemas/ir.schema.json: core's, every case's
//! that compiles, and every whole file and document among the spec's examples that compiles on
//! its own. MKP_SCHEMA_TRACE=1 says what each step does and why a spec example didn't compile.

use mkp_check::{compile_core, compile_on, Source};
use serde_json::Value;
use std::path::{Path, PathBuf};

fn repo() -> PathBuf {
    PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("../../../..")
}

fn core_sources() -> Vec<Source> {
    let mut files: Vec<PathBuf> = std::fs::read_dir(repo().join("core")).unwrap().map(|e| e.unwrap().path()).filter(|p| p.extension().map_or(false, |x| x == "mkp")).collect();
    files.sort();
    files.into_iter().map(|p| Source { path: format!("core/{}", p.file_name().unwrap().to_str().unwrap()), text: std::fs::read_to_string(&p).unwrap() }).collect()
}

fn walk(dir: &Path, out: &mut Vec<PathBuf>) {
    for e in std::fs::read_dir(dir).unwrap() {
        let p = e.unwrap().path();
        if p.is_dir() {
            walk(&p, out);
        } else if p.to_str().unwrap().ends_with(".mkp.md") || p.extension().map_or(false, |x| x == "mkp") {
            out.push(p);
        }
    }
}

#[test]
fn every_ir_the_compiler_writes_validates() {
    let id = "https://raw.githubusercontent.com/mmujtabamain/markdown-markup/main/schemas/ir.schema.json";
    let schema: Value = serde_json::from_str(&std::fs::read_to_string(repo().join("schemas/ir.schema.json")).unwrap()).unwrap();
    let registry = jsonschema::Registry::new().add(id, schema.clone()).unwrap().prepare().unwrap();
    let validator = jsonschema::options().with_registry(&registry).build(&schema).unwrap();
    let base = compile_core(&core_sources());
    let mut sources = Vec::new();
    walk(&repo().join("targets/checks"), &mut sources);
    let (mut checked, mut bad, mut skipped) = (0, Vec::new(), Vec::new());
    // core on its own, then each source that compiles, with core
    let mut docs: Vec<(String, Option<Source>)> = vec![("core".into(), None)];
    for p in sources {
        let path = p.strip_prefix(repo()).unwrap().to_str().unwrap().to_string();
        docs.push((path.clone(), Some(Source { path, text: std::fs::read_to_string(&p).unwrap() })));
    }
    // the spec's own files and documents, page 5's being core itself
    for (page, text, doc) in spec_files() {
        let path = format!("{}{}", page, if doc { ".mkp.md" } else { ".mkp" });
        docs.push((page, Some(Source { path, text })));
    }
    for (name, src) in docs {
        if std::env::var("MKP_SCHEMA_TRACE").is_ok() {
            eprintln!("compile {}", name);
        }
        let c = match &src {
            None => compile_on(&base, &[], &[], "core"),
            Some(s) => compile_on(&base, &[], &[s.clone()], if s.path.ends_with(".mkp.md") { "doc" } else { "t" }),
        };
        let Some(m) = c.module else {
            if name.starts_with("docs/") && std::env::var("MKP_SCHEMA_TRACE").is_ok() {
                for d in c.errors().take(2) {
                    eprintln!("{}: {}: [{}] {}", name, d.file, d.diagnostic.code, d.diagnostic.message);
                }
            }
            skipped.push(name);
            continue;
        };
        let json = serde_json::to_value(&mkp_ir::ir::File { ir: m }).unwrap();
        if std::env::var("MKP_SCHEMA_TRACE").is_ok() {
            eprintln!("validate {} ({} bytes)", name, json.to_string().len());
        }
        // errors only for an IR that doesn't validate: a oneOf's errors are costly to collect
        let errors: Vec<String> = if validator.is_valid(&json) { Vec::new() } else { vec![first_error(&validator, &json)] };
        checked += 1;
        if !errors.is_empty() {
            bad.push(format!("{}: {:?}", name, errors));
        }
    }
    println!("{} IR files validated; {} sources don't compile, as their checks expect: {:?}", checked, skipped.len(), skipped.iter().filter(|s| !s.contains("/cases/")).collect::<Vec<_>>());
    assert!(checked >= 20);
    assert!(bad.is_empty(), "{}", bad.join("\n"));
}

/// The first place an IR breaks the schema.
fn first_error(validator: &jsonschema::Validator, json: &Value) -> String {
    match validator.validate(json) {
        Ok(()) => String::new(),
        Err(e) => format!("{} at {}", e, e.instance_path()),
    }
}

/// The spec's whole files and documents, with where each is: `docs/specs/07-examples.md:12`.
fn spec_files() -> Vec<(String, String, bool)> {
    let kinds: Value = serde_json::from_str(&std::fs::read_to_string(repo().join("targets/checks/spec-examples.json")).unwrap()).unwrap();
    let mut out = Vec::new();
    for (page, tags) in kinds["pages"].as_object().unwrap() {
        if page.starts_with("05") {
            continue;
        }
        let src = std::fs::read_to_string(repo().join("docs/specs").join(page)).unwrap();
        let lines: Vec<&str> = src.lines().collect();
        let mut k = 0;
        let mut n = 0;
        while k < lines.len() {
            let l = lines[k];
            let ticks = l.bytes().take_while(|c| *c == b'`').count();
            let lang = &l[ticks..];
            if (ticks == 3 || ticks == 4) && (lang == "java" || lang == "markdown") {
                let fence = &l[..ticks];
                let start = k + 1;
                let mut end = start;
                while lines[end] != fence {
                    end += 1;
                }
                let tag = tags[n].as_str().unwrap();
                if tag == "java file" || tag == "markdown doc" {
                    out.push((format!("docs/specs/{}:{}", page, start + 1), lines[start..end].join("\n") + "\n", tag == "markdown doc"));
                }
                n += 1;
                k = end + 1;
            } else {
                k += 1;
            }
        }
    }
    out
}
