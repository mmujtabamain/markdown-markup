//! The `mkp` binary itself: `check` runs the whole checker, and `--pack` takes folders and files.

use std::path::PathBuf;
use std::process::Command;

fn mkp(args: &[&str]) -> (i32, String, String) {
    let out = Command::new(env!("CARGO_BIN_EXE_mkp")).args(args).output().unwrap();
    (out.status.code().unwrap_or(-1), String::from_utf8_lossy(&out.stdout).into_owned(), String::from_utf8_lossy(&out.stderr).into_owned())
}

fn scratch(name: &str, files: &[(&str, &str)]) -> PathBuf {
    let dir = std::env::temp_dir().join(format!("mkp-cli-{}-{}", name, std::process::id()));
    let _ = std::fs::remove_dir_all(&dir);
    for (path, text) in files {
        let p = dir.join(path);
        std::fs::create_dir_all(p.parent().unwrap()).unwrap();
        std::fs::write(p, text).unwrap();
    }
    dir
}

const SHELF: &str = "package shelf;\n\npack shelf@1 {\n    provides row_of_books;\n}\n\nwidget row_of_books(title: text) {\n    view {\n        @label(value = title);\n    }\n    markdown {\n        \\{title}\n    }\n}\n";
const DOC: &str = "import shelf;\n@@@\n# Books\n\n@row_of_books(title = \"Read\");\n";

#[test]
fn check_reports_the_checker_s_errors() {
    let dir = scratch("check", &[("bad.mkp", "package t;\n\nlet x: number = y;\n")]);
    let (code, _, err) = mkp(&["check", dir.join("bad.mkp").to_str().unwrap()]);
    assert_eq!(code, 1);
    assert!(err.contains("bad.mkp:3:17: error[names.unknown-name]"), "{}", err);
    let (code, out, _) = mkp(&["check", "--json", dir.join("bad.mkp").to_str().unwrap()]);
    assert_eq!(code, 1);
    let found: serde_json::Value = serde_json::from_str(&out).unwrap();
    assert_eq!(found[0]["code"], "names.unknown-name");
    assert_eq!((found[0]["line"].as_u64(), found[0]["column"].as_u64()), (Some(3), Some(17)));
}

#[test]
fn packs_from_folders_and_files() {
    let dir = scratch("packs", &[("packs/shelf/shelf.mkp", SHELF), ("extra.mkp", "package extra;\n\nlet answer: number = 42;\n"), ("doc.mkp.md", DOC)]);
    let doc = dir.join("doc.mkp.md");
    let (code, _, err) = mkp(&["check", doc.to_str().unwrap()]);
    assert_eq!(code, 1, "no pack given: {}", err);
    assert!(err.contains("names.unknown-pack"), "{}", err);
    let packs = format!("{},{}", dir.join("packs").display(), dir.join("extra.mkp").display());
    let (code, _, err) = mkp(&["check", "--pack", &packs, doc.to_str().unwrap()]);
    assert_eq!(code, 0, "{}", err);
    let out = dir.join("doc.ir.json");
    let (code, _, err) = mkp(&["build", doc.to_str().unwrap(), "--pack", &packs, "-o", out.to_str().unwrap()]);
    assert_eq!(code, 0, "{}", err);
    let ir: serde_json::Value = serde_json::from_str(&std::fs::read_to_string(&out).unwrap()).unwrap();
    assert!(ir.to_string().contains("shelf/row_of_books"), "the pack's widget is in the IR");
    let (code, _, err) = mkp(&["build", doc.to_str().unwrap(), "--pack", "nowhere.txt"]);
    assert_eq!(code, 2);
    assert!(err.contains("not a folder or a .mkp file"), "{}", err);
}

#[test]
fn an_mkp_toml_names_the_packs() {
    // beside the document
    let dir = scratch("config", &[("packs/shelf/shelf.mkp", SHELF), ("mkp.toml", "packs = [\"packs\"]\n"), ("doc.mkp.md", DOC)]);
    let doc = dir.join("doc.mkp.md");
    let (code, _, err) = mkp(&["check", doc.to_str().unwrap()]);
    assert_eq!(code, 0, "{}", err);
    // in a folder above, and named with -c
    let dir = scratch("config-above", &[("site/packs/shelf/shelf.mkp", SHELF), ("site/mkp.toml", "packs = [\"packs\"]\n"), ("site/pages/doc.mkp.md", DOC), ("other.toml", "packs = [\"site/packs\"]\n")]);
    let doc = dir.join("site/pages/doc.mkp.md");
    let (code, _, err) = mkp(&["check", doc.to_str().unwrap()]);
    assert_eq!(code, 0, "{}", err);
    let (code, _, err) = mkp(&["build", doc.to_str().unwrap(), "-c", dir.join("other.toml").to_str().unwrap(), "-o", dir.join("doc.ir.json").to_str().unwrap()]);
    assert_eq!(code, 0, "{}", err);
    // a key mkp.toml doesn't have
    let dir = scratch("config-bad", &[("mkp.toml", "pack = [\"packs\"]\n"), ("doc.mkp.md", "# Hi\n")]);
    let (code, _, err) = mkp(&["check", dir.join("doc.mkp.md").to_str().unwrap()]);
    assert_eq!(code, 2, "{}", err);
    assert!(err.contains("unknown field `pack`"), "{}", err);
}
