//! Every MKP code block in docs/specs reads, and `mkp fmt` prints it back unchanged.
//!
//! targets/checks/spec-examples.json says which entry each block is read with.

use mkp_syntax::{format, parse, Entry, Lines};
use std::path::PathBuf;

fn repo() -> PathBuf {
    PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("../../../..")
}

struct Example {
    page: String,
    line: usize,
    lang: String,
    text: String,
}

fn examples(page: &str) -> Vec<Example> {
    let src = std::fs::read_to_string(repo().join("docs/specs").join(page)).unwrap();
    let lines: Vec<&str> = src.lines().collect();
    let mut out = Vec::new();
    let mut k = 0;
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
            let mut text = lines[start..end].join("\n");
            text.push('\n');
            out.push(Example { page: page.to_string(), line: start + 1, lang: lang.to_string(), text });
            k = end + 1;
        } else {
            k += 1;
        }
    }
    out
}

fn entry(tag: &str) -> Entry {
    match tag {
        "java file" | "java later" => Entry::Mkp,
        "java decls" => Entry::Decls,
        "java body" => Entry::Body,
        "java fields" => Entry::Fields,
        "java sigs" => Entry::Sigs,
        "markdown doc" | "markdown fragment" => Entry::Document,
        other => panic!("unknown entry {}", other),
    }
}

fn first_difference(a: &str, b: &str) -> String {
    for (k, (x, y)) in a.lines().zip(b.lines()).enumerate() {
        if x != y {
            return format!("line {}:\n  source: {:?}\n  fmt:    {:?}", k + 1, x, y);
        }
    }
    format!("lengths differ: {} lines vs {} lines", a.lines().count(), b.lines().count())
}

#[test]
fn every_spec_example_reads_and_prints_back_unchanged() {
    let manifest: serde_json::Value =
        serde_json::from_str(&std::fs::read_to_string(repo().join("targets/checks/spec-examples.json")).unwrap()).unwrap();
    let mut failures = Vec::new();
    let mut count = 0;
    for (page, tags) in manifest["pages"].as_object().unwrap() {
        let found = examples(page);
        let tags: Vec<&str> = tags.as_array().unwrap().iter().map(|t| t.as_str().unwrap()).collect();
        assert_eq!(found.len(), tags.len(), "{}: {} MKP blocks on the page, {} in the manifest", page, found.len(), tags.len());
        for (ex, tag) in found.iter().zip(tags) {
            assert!(tag.starts_with(&ex.lang), "{}:{}: a {} block tagged {}", ex.page, ex.line, ex.lang, tag);
            count += 1;
            let parsed = parse(&ex.text, entry(tag));
            if parsed.file.is_some() && !parsed.diagnostics.is_empty() {
                let lines = Lines::new(&ex.text);
                for d in &parsed.diagnostics {
                    let at = lines.place(d.span.start);
                    failures.push(format!("{}:{} ({}) reads with a diagnostic at block line {}, column {}: [{}] {}", ex.page, ex.line, tag, at.line, at.column, d.code, d.message));
                }
            }
            match format(&ex.text, entry(tag)) {
                Ok(out) if out == ex.text => {}
                Ok(out) => failures.push(format!("{}:{} ({}) prints back differently, {}", ex.page, ex.line, tag, first_difference(&ex.text, &out))),
                Err(diags) => {
                    let lines = Lines::new(&ex.text);
                    let d = &diags[diags.len() - 1];
                    let at = lines.place(d.span.start);
                    failures.push(format!(
                        "{}:{} ({}) doesn't read: block line {}, column {}: [{}] {}",
                        ex.page, ex.line, tag, at.line, at.column, d.code, d.message
                    ));
                }
            }
        }
    }
    assert_eq!(count, 58, "the spec has 58 MKP code blocks");
    assert!(failures.is_empty(), "{} of {} examples failed:\n{}", failures.len(), count, failures.join("\n"));
}
