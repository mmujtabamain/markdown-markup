//! core compiles to IR with no errors, and its IR fits the schema's types.

use xtmd_check::{compile, Source};
use std::path::PathBuf;

pub fn repo() -> PathBuf {
    PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("../../../..")
}

pub fn core_sources() -> Vec<Source> {
    let mut files: Vec<PathBuf> = std::fs::read_dir(repo().join("core")).unwrap().map(|e| e.unwrap().path()).filter(|p| p.extension().map_or(false, |x| x == "xtmdpack")).collect();
    files.sort();
    files.into_iter().map(|p| Source { path: format!("core/{}", p.file_name().unwrap().to_str().unwrap()), text: std::fs::read_to_string(&p).unwrap() }).collect()
}

fn render(c: &xtmd_check::Compiled) -> String {
    c.diagnostics.iter().map(|d| d.diagnostic.render(&d.file, &c.texts[&d.file])).collect::<Vec<_>>().join("\n")
}

#[test]
fn core_compiles_with_no_errors() {
    let c = compile(&core_sources(), &[], &[], "core");
    let errors: Vec<_> = c.errors().collect();
    assert!(errors.is_empty(), "{} errors compiling core:\n{}", errors.len(), render(&c));
    let m = c.module.unwrap();
    let json = serde_json::to_value(&xtmd_ir::ir::File { ir: m }).unwrap();
    let back: xtmd_ir::ir::File = serde_json::from_value(json).unwrap();
    assert!(!back.ir.declarations.is_empty());
}

#[test]
fn write_core_ir_for_a_look() {
    let c = compile(&core_sources(), &[], &[], "core");
    if let Some(m) = c.module {
        let out = std::env::var("XTMD_CORE_IR").unwrap_or_default();
        if !out.is_empty() {
            std::fs::write(out, serde_json::to_string_pretty(&xtmd_ir::ir::File { ir: m }).unwrap()).unwrap();
        }
    }
}

/// core's own tests: in targets/checks/core, every `let check_…: bool` is worked out when the
/// file is compiled, and has to be true.
#[test]
fn core_own_tests_pass() {
    let dir = repo().join("targets/checks/core");
    let mut files: Vec<PathBuf> = std::fs::read_dir(&dir).unwrap().map(|e| e.unwrap().path()).collect();
    files.sort();
    let core = core_sources();
    let (mut passed, mut failed) = (0, Vec::new());
    for f in files {
        let name = format!("targets/checks/core/{}", f.file_name().unwrap().to_str().unwrap());
        let text = std::fs::read_to_string(&f).unwrap();
        let c = compile(&core, &[], &[Source { path: name.clone(), text: text.clone() }], "t");
        let errors: Vec<String> = c.errors().filter(|d| d.file == name).map(|d| d.diagnostic.render(&d.file, &text)).collect();
        if !errors.is_empty() {
            failed.push(format!("{} doesn't compile:\n{}", name, errors.join("\n")));
            continue;
        }
        for line in text.lines() {
            let Some(rest) = line.strip_prefix("let check_") else { continue };
            let check = format!("check_{}", rest.split(':').next().unwrap());
            match c.constants.get(&format!("t/{}", check)) {
                Some(xtmd_eval::Value::Bool(true)) => passed += 1,
                Some(other) => failed.push(format!("{}: {} is {:?}", name, check, other)),
                None => failed.push(format!("{}: {} couldn't be worked out at compile time", name, check)),
            }
        }
    }
    println!("core's own tests: {} pass, {} fail", passed, failed.len());
    assert!(failed.is_empty(), "{}", failed.join("\n"));
}
