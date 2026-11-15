//! Markdown out: every case that expects Markdown gets it, with the page's starting values, as
//! blocks. The Markdown written is then read back by MKP's own reader, and has to give the same
//! blocks, so the one spelling (page 1) never loses a mark or a block.

use mkp_check::{compile_core, compile_on, Checker, Source};
use serde_json::Value;
use std::path::{Path, PathBuf};

fn repo() -> PathBuf {
    PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("../../..")
}

fn core() -> Vec<Source> {
    let dir = repo().join("core");
    let mut files: Vec<PathBuf> = std::fs::read_dir(&dir).unwrap().map(|e| e.unwrap().path()).filter(|p| p.extension().map_or(false, |x| x == "mkp")).collect();
    files.sort();
    files.into_iter().map(|p| Source { path: format!("core/{}", p.file_name().unwrap().to_str().unwrap()), text: std::fs::read_to_string(&p).unwrap() }).collect()
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

/// The `.mkp` files of a pack: a folder or a file beside the case.
fn pack(path: &Path, out: &mut Vec<Source>) {
    if path.is_dir() {
        let mut files: Vec<PathBuf> = std::fs::read_dir(path).unwrap().map(|e| e.unwrap().path()).collect();
        files.sort();
        for f in files {
            pack(&f, out);
        }
    } else if path.extension().map_or(false, |x| x == "mkp") {
        out.push(Source { path: path.to_string_lossy().into_owned(), text: std::fs::read_to_string(path).unwrap() });
    }
}

/// A page's blocks with its starting values.
fn blocks(base: &Checker, packs: &[Source], src: Source) -> Result<Value, String> {
    let name = src.path.clone();
    let module = if name.ends_with(".mkp.md") { "doc" } else { "t" };
    let c = compile_on(base, &[packs.to_vec()], &[src], module);
    let Some(mut m) = c.module else {
        let errs: Vec<String> = c.errors().take(3).map(|d| format!("{}: [{}] {}", d.file, d.diagnostic.code, d.diagnostic.message)).collect();
        return Err(format!("{} doesn't compile: {:?}", name, errs));
    };
    mkp_lower::lower(&mut m);
    let b = mkp_markdown::page(&m).map_err(|e| format!("{}: {}", name, e.0))?;
    Ok(mkp_markdown::blocks_json(&b))
}

/// Markdown text read as blocks, by MKP's own reader: a document of that text.
fn read(base: &Checker, text: &str) -> Result<Value, String> {
    blocks(base, &[], Source { path: "read-back.mkp.md".into(), text: text.into() })
}

#[test]
fn every_case_writes_its_expected_markdown() {
    let base = compile_core(&core());
    let mut files = Vec::new();
    walk(&repo().join("targets/checks/cases"), &mut files);
    files.sort();
    let (mut checked, mut problems) = (0, Vec::new());
    for f in files {
        let case: Value = serde_json::from_str(&std::fs::read_to_string(&f).unwrap()).unwrap();
        let Some(want) = case["expect"].get("markdown") else { continue };
        let id = case["id"].as_str().unwrap().to_string();
        let dir = f.parent().unwrap();
        let src_path = dir.join(case["source"].as_str().unwrap());
        let mut packs = Vec::new();
        for p in case["packs"].as_array().into_iter().flatten() {
            pack(&dir.join(p.as_str().unwrap()), &mut packs);
        }
        let src = Source { path: src_path.to_string_lossy().into_owned(), text: std::fs::read_to_string(&src_path).unwrap() };
        checked += 1;
        let found = match blocks(&base, &packs, src) {
            Ok(b) => b,
            Err(e) => {
                problems.push(format!("{}: {}", id, e));
                continue;
            }
        };
        // what the case expects
        let ok = if let Some(b) = want.get("blocks") {
            *b == found
        } else if let Some(has) = want.get("has") {
            has.as_array().unwrap().iter().all(|b| found.as_array().unwrap().contains(b))
        } else if let Some(file) = want.get("file") {
            match read(&base, &std::fs::read_to_string(dir.join(file.as_str().unwrap())).unwrap()) {
                Ok(b) => b == found,
                Err(e) => {
                    problems.push(format!("{}: its expected Markdown doesn't read: {}", id, e));
                    continue;
                }
            }
        } else {
            false
        };
        if !ok {
            problems.push(format!("{}: the Markdown differs\n  want {}\n  got  {}", id, want, found));
            continue;
        }
        // the text written reads back as the same blocks
        let text = written(&base, &packs, &case, dir);
        match read(&base, &text) {
            Ok(b) if b == found => {}
            Ok(b) => problems.push(format!("{}: its Markdown doesn't read back as written\n  text {:?}\n  read {}\n  was  {}", id, text, b, found)),
            Err(e) => problems.push(format!("{}: its Markdown doesn't read back: {}\n  text {:?}", id, e, text)),
        }
    }
    println!("{} cases write their Markdown", checked);
    assert!(checked > 0);
    assert!(problems.is_empty(), "{}", problems.join("\n"));
}

/// The Markdown text `mkp md` writes for a case.
fn written(base: &Checker, packs: &[Source], case: &Value, dir: &Path) -> String {
    let src_path = dir.join(case["source"].as_str().unwrap());
    let src = Source { path: src_path.to_string_lossy().into_owned(), text: std::fs::read_to_string(&src_path).unwrap() };
    let module = if src.path.ends_with(".mkp.md") { "doc" } else { "t" };
    let c = compile_on(base, &[packs.to_vec()], &[src], module);
    let mut m = c.module.unwrap();
    mkp_lower::lower(&mut m);
    mkp_markdown::write(&mkp_markdown::page(&m).unwrap())
}

/// The spec's packs, from its whole files grouped by their `package` line, and its documents,
/// named by page and line. Page 5's files are core itself; fragments are left out.
fn spec() -> (Vec<Source>, Vec<(String, Source)>) {
    let kinds: Value = serde_json::from_str(&std::fs::read_to_string(repo().join("targets/checks/spec-examples.json")).unwrap()).unwrap();
    let (mut packs, mut docs) = (Vec::new(), Vec::new());
    for (page, tags) in kinds["pages"].as_object().unwrap() {
        if page.starts_with("05") {
            continue;
        }
        let src = std::fs::read_to_string(repo().join("docs/specs").join(page)).unwrap();
        let lines: Vec<&str> = src.lines().collect();
        let (mut k, mut n) = (0, 0);
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
                let at = format!("{}-{}", page, start + 1);
                match tags[n].as_str().unwrap() {
                    "java file" => packs.push(Source { path: format!("docs/specs/{}.mkp", at), text }),
                    "markdown doc" => docs.push((at.clone(), Source { path: format!("docs/specs/{}.mkp.md", at), text })),
                    _ => {}
                }
                n += 1;
                k = end + 1;
            } else {
                k += 1;
            }
        }
    }
    (packs, docs)
}

#[test]
fn the_spec_documents_write_their_markdown() {
    let base = compile_core(&core());
    let (packs, docs) = spec();
    let mut problems = Vec::new();
    for (at, doc) in &docs {
        let expected = repo().join("targets/checks/spec-markdown").join(format!("{}.md", at));
        let Ok(text) = std::fs::read_to_string(&expected) else {
            problems.push(format!("{}: no expected Markdown in targets/checks/spec-markdown", at));
            continue;
        };
        let found = match blocks(&base, &packs, doc.clone()) {
            Ok(b) => b,
            Err(e) => {
                problems.push(e);
                continue;
            }
        };
        match read(&base, &text) {
            Ok(want) if want == found => {}
            Ok(want) => problems.push(format!("{}: the Markdown differs\n  want {}\n  got  {}", at, want, found)),
            Err(e) => problems.push(format!("{}: its expected Markdown doesn't read: {}", at, e)),
        }
        // and the text written reads back as the same blocks
        let c = compile_on(&base, &[packs.clone()], &[doc.clone()], "doc");
        let mut m = c.module.unwrap();
        mkp_lower::lower(&mut m);
        let written = mkp_markdown::write(&mkp_markdown::page(&m).unwrap());
        if read(&base, &written).ok().as_ref() != Some(&found) {
            problems.push(format!("{}: its Markdown doesn't read back as written: {:?}", at, written));
        }
    }
    println!("{} of the spec's documents write their Markdown", docs.len());
    assert_eq!(docs.len(), 3);
    assert!(problems.is_empty(), "{}", problems.join("\n"));
}
