//! xtmd-live: a text built into the IR xtmd build writes, a broken draft that leaves the last IR,
//! packs given as text, and what an editor asks for: the resolved IR and the canonical layout.

use xtmd_live::{BuildOptions, Compiler, Followed, Live, Severity, Source};

const COUNTER: &str = "$state {\n    n: int 0..10 = 0;\n}\n@@@\n# Count: \\{$state.n}\n\n@press(label = \"Add one\", click = fn() {\n    $state.n = ($state.n + 1).clamp(0, 10);\n});\n";

#[test]
fn a_document_builds_into_the_binarys_ir() {
    let c = Compiler::new();
    let b = c.build("page.xtmd", COUNTER, &[]);
    assert_eq!(b.errors, 0, "{:?}", b.diagnostics);
    let ir = b.ir.expect("an IR");
    assert_eq!(ir.ir.module, "doc");
    // lowered as xtmd build lowers it: the press's label is a constant, its click a handler
    assert!(!ir.ir.handlers.is_empty());
    let sites = b.sites.clone();
    let json = xtmd_live::Built { ir: Some(ir), diagnostics: b.diagnostics, errors: 0, sites: b.sites, rir: None }.to_json();
    assert!(json.starts_with("{\"ir\":{\"ir\":{"), "{}", &json[..40]);
    // where each call is written, beside the IR and never in it: the press is a site of the
    // page's own template, from its line to the line its call ends on
    assert!(!json.contains("\"at\":{\"line\""), "the IR holds no places");
    let press = COUNTER.lines().position(|l| l.starts_with("@press(")).unwrap() as u32 + 1;
    let w = sites["doc"].values().find(|w| w.line == press).unwrap_or_else(|| panic!("{:?}", sites));
    assert_eq!((w.column, w.end.line), (1, press + 2));
}

#[test]
fn errors_give_diagnostics_with_places_and_no_ir() {
    let c = Compiler::new();
    let b = c.build("page.xtmd", "$state {\n    count: int = 0\n}\n@@@\nHello\n", &[]);
    assert!(b.ir.is_none());
    assert_eq!(b.errors, 1);
    let d = &b.diagnostics[0];
    assert_eq!((d.code.as_str(), d.severity, d.line, d.column, d.file.as_str()), ("syntax.missing-semicolon", Severity::Error, 2, 19, "page.xtmd"));
    assert!(d.end.line >= d.line);
}

#[test]
fn a_pack_given_as_text_is_used() {
    let c = Compiler::new();
    let pack = Source { path: "shapes/shapes.xtmdpack".into(), text: "package shapes;\n\npack shapes@1 {\n    provides double;\n}\n\nfn double(x: number): number {\n    return x * 2;\n}\n".into() };
    let doc = "import shapes;\n@@@\nTwice: \\{double(4)}\n";
    let b = c.build("page.xtmd", doc, &[pack]);
    assert_eq!(b.errors, 0, "{:?}", b.diagnostics);
    assert!(c.build("page.xtmd", doc, &[]).diagnostics.iter().any(|d| d.code == "names.unknown-pack"));
}

#[test]
fn a_followed_text_keeps_the_last_ir_through_a_broken_draft() {
    let c = Compiler::new();
    let mut live = Live::default();
    assert_eq!(live.follow(&c, COUNTER), Followed::Compiled);
    assert_eq!(live.revision(), 1);
    let first = live.ir().cloned();
    // the same text: nothing built
    assert_eq!(live.follow(&c, COUNTER), Followed::Same);
    // a draft with an error: the IR stays, the error is said with where it is
    let broken = COUNTER.replace("$state.n}", "$state.nope}");
    assert_eq!(live.follow(&c, &broken), Followed::Broken);
    assert_eq!(live.ir().cloned(), first);
    assert_eq!(live.revision(), 1);
    let why = live.why().expect("why");
    assert!(why.starts_with("page.xtmd doesn't compile (1 error): page.xtmd:5:"), "{}", why);
    // fixed: a new IR
    assert_eq!(live.follow(&c, &COUNTER.replace("Count", "Total")), Followed::Compiled);
    assert_eq!(live.revision(), 2);
    assert!(live.why().is_none() && live.errors() == 0);
    // new packs are a new build, with the same text
    live.set_packs(vec![Source { path: "x/x.xtmdpack".into(), text: "package x;\n\npack x@1 {\n    provides y;\n}\n\nlet y: int = 1;\n".into() }]);
    assert_ne!(live.follow(&c, &COUNTER.replace("Count", "Total")), Followed::Same);
}

#[test]
fn the_resolved_ir_comes_when_asked_and_only_then() {
    let c = Compiler::new();
    assert!(c.build("page.xtmd", COUNTER, &[]).rir.is_none());
    assert!(!c.build("page.xtmd", COUNTER, &[]).to_json().contains("\"rir\""));
    let b = c.build_with("page.xtmd", COUNTER, &[], BuildOptions { rir: true, core: false });
    let rir = b.rir.expect("a resolved IR");
    assert_eq!(rir["rir"], 1);
    let files = rir["files"].as_array().unwrap();
    assert_eq!(files.len(), 1);
    assert_eq!(files[0]["path"], "page.xtmd");
    // the press's label is resolved to the input it sets
    assert!(rir.to_string().contains("\"target\":\"core/press.label\""), "{}", rir);
    // the IR is the same as without it
    assert_eq!(b.ir, c.build("page.xtmd", COUNTER, &[]).ir);
}

#[test]
fn a_draft_with_errors_still_has_its_resolved_ir() {
    let c = Compiler::new();
    let broken = COUNTER.replace("label = \"Add one\"", "label = 3");
    let b = c.build_with("page.xtmd", &broken, &[], BuildOptions { rir: true, core: false });
    assert!(b.errors > 0 && b.ir.is_none());
    let rir = b.rir.expect("the resolved IR of a broken draft");
    // what was resolved before the error is there: $state's field and its type
    assert!(rir.to_string().contains("\"core/int\""), "{}", rir);
}

#[test]
fn cores_files_come_first_and_resolved_when_asked() {
    let c = Compiler::new();
    let b = c.build_with("page.xtmd", COUNTER, &[], BuildOptions { rir: true, core: true });
    let rir = b.rir.unwrap();
    let files = rir["files"].as_array().unwrap();
    assert!(files.len() > 10 && files.last().unwrap()["path"] == "page.xtmd", "{}", files.len());
    let controls = files.iter().find(|f| f["path"] == "core/controls.xtmdpack").expect("core's controls");
    let press = controls["declarations"].as_array().unwrap().iter().find(|d| d["extern_widget"]["id"] == "core/press").expect("press");
    assert_eq!(press["extern_widget"]["inputs"][0]["id"], "core/press.label");
    assert!(press["extern_widget"]["doc"]["about"].as_str().unwrap().starts_with("Something to press"));
    // core's own expressions are typed: what a name resolves to is kept for core too
    let list = files.iter().find(|f| f["path"] == "core/list.xtmdpack").unwrap().to_string();
    assert!(list.matches("\"type\":").count() > 50);
    // a second build reuses the logged core
    assert_eq!(c.build_with("page.xtmd", COUNTER, &[], BuildOptions { rir: true, core: true }).rir.unwrap()["files"].as_array().unwrap().len(), files.len());
}

#[test]
fn a_text_formats_as_xtmd_fmt_writes_it() {
    let c = Compiler::new();
    let f = c.format("page.xtmd", "$state {\n  n: int = 0;\n}\n@@@\n# Hi\n");
    assert_eq!(f.text.as_deref(), Some("$state {\n    n: int = 0;\n}\n@@@\n# Hi\n"));
    assert!(f.diagnostics.is_empty());
    // a pack's file, by its path
    let p = c.format("kit/kit.xtmdpack", "package kit;\nlet   a: int = 1;\n");
    assert_eq!(p.text.as_deref(), Some("package kit;\nlet a: int = 1;\n"));
    // a path that is neither: said, and no text
    let n = c.format("notes.md", "# Hi\n");
    assert!(n.text.is_none() && n.diagnostics[0].message.contains("not an Extended Mark file"));
}
