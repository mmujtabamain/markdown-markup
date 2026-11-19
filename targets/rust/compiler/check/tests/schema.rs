//! Every IR the compiler writes validates against schemas/ir.schema.json: core's, every case's
//! that compiles, and every whole file and document among the spec's examples that compiles on
//! its own. XTMD_SCHEMA_TRACE=1 says what each step does and why a spec example didn't compile.

use xtmd_check::{compile_core, compile_on, Source};
use serde_json::Value;
use std::path::{Path, PathBuf};

fn repo() -> PathBuf {
    PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("../../../..")
}

fn core_sources() -> Vec<Source> {
    let mut files: Vec<PathBuf> = std::fs::read_dir(repo().join("core")).unwrap().map(|e| e.unwrap().path()).filter(|p| p.extension().map_or(false, |x| x == "xtpack")).collect();
    files.sort();
    files.into_iter().map(|p| Source { path: format!("core/{}", p.file_name().unwrap().to_str().unwrap()), text: std::fs::read_to_string(&p).unwrap() }).collect()
}

fn walk(dir: &Path, out: &mut Vec<PathBuf>) {
    for e in std::fs::read_dir(dir).unwrap() {
        let p = e.unwrap().path();
        if p.is_dir() {
            walk(&p, out);
        } else if p.to_str().unwrap().ends_with(".xt.md") || p.extension().map_or(false, |x| x == "xtpack") {
            out.push(p);
        }
    }
}

#[test]
fn every_ir_the_compiler_writes_validates() {
    // a case runs Extended Mark to the depth limit at compile time, deeper than a test thread's stack
    std::thread::Builder::new().stack_size(64 << 20).spawn(validate_all).unwrap().join().unwrap();
}

fn validate_all() {
    let id = "https://raw.githubusercontent.com/mmujtabamain/markdown-markup/main/schemas/ir.schema.json";
    let schema: Value = serde_json::from_str(&std::fs::read_to_string(repo().join("schemas/ir.schema.json")).unwrap()).unwrap();
    let registry = jsonschema::Registry::new().add(id, schema.clone()).unwrap().prepare().unwrap();
    let validator = jsonschema::options().with_registry(&registry).build(&schema).unwrap();
    let trace = std::env::var("XTMD_SCHEMA_TRACE").is_ok();
    let base = compile_core(&core_sources());
    // (name, what it compiled to, whether it must compile)
    let mut compiled: Vec<(String, xtmd_check::Compiled, bool)> = vec![("core".into(), compile_on(&base, &[], &[], "core"), true)];
    // each check's source, with core: an error case doesn't compile, as its check expects
    let mut sources = Vec::new();
    walk(&repo().join("targets/checks"), &mut sources);
    for p in sources {
        let path = p.strip_prefix(repo()).unwrap().to_str().unwrap().to_string();
        let src = Source { path: path.clone(), text: std::fs::read_to_string(&p).unwrap() };
        let module = if path.ends_with(".xt.md") { "doc" } else { "t" };
        compiled.push((path, compile_on(&base, &[], &[src], module), false));
    }
    // the spec's packs, each compiled whole from its files across the pages (page 5's being core
    // itself), and its documents, each with every pack: all of them must compile
    let (packs, documents) = spec_packs();
    for (name, files) in &packs {
        compiled.push((format!("the spec's pack {}", name), compile_on(&base, &[], files, name), true));
    }
    let all: Vec<Source> = packs.iter().flat_map(|(_, f)| f.clone()).collect();
    for d in documents {
        let c = compile_on(&base, &[all.clone()], &[d.clone()], "doc");
        compiled.push((d.path.clone(), c, true));
    }
    let (mut checked, mut bad, mut skipped) = (0, Vec::new(), 0);
    for (name, c, must) in compiled {
        let Some(m) = c.module else {
            if must {
                let errs: Vec<String> = c.errors().take(3).map(|d| format!("{}: [{}] {}", d.file, d.diagnostic.code, d.diagnostic.message)).collect();
                bad.push(format!("{} doesn't compile: {:?}", name, errs));
            }
            skipped += 1;
            continue;
        };
        // the IR as the compiler writes it: lowered
        let mut m = m;
        xtmd_lower::lower(&mut m);
        let json = serde_json::to_value(&xtmd_ir::ir::File { ir: m }).unwrap();
        if trace {
            eprintln!("validate {} ({} bytes)", name, json.to_string().len());
        }
        // errors only for an IR that doesn't validate: a oneOf's errors are costly to collect
        if !validator.is_valid(&json) {
            bad.push(format!("{}: {}", name, first_error(&validator, &json)));
        }
        checked += 1;
    }
    println!("{} IR files validated; {} error cases don't compile, as their checks expect", checked, skipped);
    assert!(checked >= 15);
    assert!(bad.is_empty(), "{}", bad.join("\n"));
}

/// The first place an IR breaks the schema.
fn first_error(validator: &jsonschema::Validator, json: &Value) -> String {
    match validator.validate(json) {
        Ok(()) => String::new(),
        Err(e) => format!("{} at {}", e, e.instance_path()),
    }
}

/// The spec's packs, from its whole files grouped by their `package` line, and its documents,
/// with where each is: `docs/specs/07-examples.md:12`. Fragments are left out.
fn spec_packs() -> (Vec<(String, Vec<Source>)>, Vec<Source>) {
    let kinds: Value = serde_json::from_str(&std::fs::read_to_string(repo().join("targets/checks/spec-examples.json")).unwrap()).unwrap();
    let mut packs: Vec<(String, Vec<Source>)> = Vec::new();
    let mut documents = Vec::new();
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
                let text = lines[start..end].join("\n") + "\n";
                let at = format!("docs/specs/{}:{}", page, start + 1);
                match tags[n].as_str().unwrap() {
                    "java file" => {
                        let name = text.lines().find_map(|l| l.strip_prefix("package ")).map(|l| l.trim_end_matches(';').trim().to_string()).unwrap_or_default();
                        let src = Source { path: format!("{}.xtpack", at), text };
                        match packs.iter_mut().find(|(p, _)| *p == name) {
                            Some((_, files)) => files.push(src),
                            None => packs.push((name, vec![src])),
                        }
                    }
                    "markdown doc" => documents.push(Source { path: format!("{}.xt.md", at), text }),
                    _ => {}
                }
                n += 1;
                k = end + 1;
            } else {
                k += 1;
            }
        }
    }
    (packs, documents)
}
