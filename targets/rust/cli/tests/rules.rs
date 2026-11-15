//! The rule table: every compile error and warning the spec names, with the pass that reports
//! it, its codes and the target checks that prove it (targets/checks/rules.json).
//!
//! The build fails when a rule has no check, when a check doesn't expect one of its rule's
//! codes, when a code the compiler can report belongs to no rule, or when a case expects a code
//! no rule lists. So a rule without a test, or a test without a rule, shows up here.

use serde_json::Value;
use std::collections::{BTreeMap, BTreeSet};
use std::path::{Path, PathBuf};

fn repo() -> PathBuf {
    PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("../../..")
}

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

/// Every code a `codes` module declares: `pub const NAME: &str = "pass.name";`.
fn declared_codes(path: &Path) -> BTreeSet<String> {
    let src = std::fs::read_to_string(path).unwrap();
    src.lines()
        .filter_map(|l| {
            let l = l.trim();
            let rest = l.strip_prefix("pub const ")?;
            let (_, value) = rest.split_once(": &str = \"")?;
            let code = value.strip_suffix("\";")?;
            code.contains('.').then(|| code.to_string())
        })
        .collect()
}

#[test]
fn every_rule_has_a_check_and_every_code_a_rule() {
    let table: Value = serde_json::from_str(&std::fs::read_to_string(repo().join("targets/checks/rules.json")).unwrap()).unwrap();
    let rules = table["rules"].as_array().unwrap();
    // each case, by id: the codes it expects
    let mut files = Vec::new();
    walk(&repo().join("targets/checks/cases"), &mut files);
    let mut cases: BTreeMap<String, BTreeSet<String>> = BTreeMap::new();
    for f in files {
        let c: Value = serde_json::from_str(&std::fs::read_to_string(&f).unwrap()).unwrap();
        let codes = c["expect"]["diagnostics"].as_array().unwrap().iter().map(|d| d["code"].as_str().unwrap().to_string()).collect();
        cases.insert(c["id"].as_str().unwrap().to_string(), codes);
    }
    let mut problems = Vec::new();
    let mut listed: BTreeSet<String> = BTreeSet::new();
    let mut slugs = BTreeSet::new();
    for r in rules {
        let slug = r["rule"].as_str().unwrap();
        if !slugs.insert(slug.to_string()) {
            problems.push(format!("{}: listed twice", slug));
        }
        // where the spec says it
        let page = r["page"].as_str().unwrap();
        let line = r["line"].as_u64().unwrap() as usize;
        match std::fs::read_to_string(repo().join("docs/specs").join(page)) {
            Ok(text) if line >= 1 && line <= text.lines().count() => {}
            _ => problems.push(format!("{}: {}:{} isn't a line of the spec", slug, page, line)),
        }
        let codes: Vec<String> = r["codes"].as_array().unwrap().iter().map(|c| c.as_str().unwrap().to_string()).collect();
        if codes.is_empty() {
            problems.push(format!("{}: no code reports it", slug));
        }
        listed.extend(codes.iter().cloned());
        let checks: Vec<&str> = r["cases"].as_array().unwrap().iter().map(|c| c.as_str().unwrap()).collect();
        if checks.is_empty() {
            problems.push(format!("{}: no check", slug));
        }
        for id in &checks {
            match cases.get(*id) {
                None => problems.push(format!("{}: there is no case {}", slug, id)),
                Some(expects) if !codes.iter().any(|c| expects.contains(c)) => problems.push(format!("{}: {} expects none of {:?}", slug, id, codes)),
                _ => {}
            }
        }
    }
    // every code the compiler can report belongs to a rule
    let mut declared = declared_codes(&repo().join("targets/rust/compiler/syntax/src/diag.rs"));
    declared.extend(declared_codes(&repo().join("targets/rust/compiler/check/src/lib.rs")));
    // `mkp fmt`'s own refusals are a tool's, not the language's rules
    for c in declared.iter().filter(|c| !c.starts_with("fmt.")) {
        if !listed.contains(c) {
            problems.push(format!("the code {} belongs to no rule", c));
        }
    }
    // and every code a case expects
    for (id, expects) in &cases {
        for c in expects {
            if !listed.contains(c) {
                problems.push(format!("{} expects {}, which no rule lists", id, c));
            }
        }
    }
    println!("{} rules, {} codes, {} cases", rules.len(), listed.len(), cases.len());
    assert!(problems.is_empty(), "the rule table has gaps:\n{}", problems.join("\n"));
}
