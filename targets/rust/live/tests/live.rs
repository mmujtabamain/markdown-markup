//! mkp-live: a text built into the IR mkp build writes, a broken draft that leaves the last IR, and
//! packs given as text.

use mkp_live::{Compiler, Followed, Live, Severity, Source};

const COUNTER: &str = "$state {\n    n: int 0..10 = 0;\n}\n@@@\n# Count: \\{$state.n}\n\n@press(label = \"Add one\", click = fn() {\n    $state.n = ($state.n + 1).clamp(0, 10);\n});\n";

#[test]
fn a_document_builds_into_the_binarys_ir() {
    let c = Compiler::new();
    let b = c.build("page.mkp.md", COUNTER, &[]);
    assert_eq!(b.errors, 0, "{:?}", b.diagnostics);
    let ir = b.ir.expect("an IR");
    assert_eq!(ir.ir.module, "doc");
    // lowered as mkp build lowers it: the press's label is a constant, its click a handler
    assert!(!ir.ir.handlers.is_empty());
    let sites = b.sites.clone();
    let json = mkp_live::Built { ir: Some(ir), diagnostics: b.diagnostics, errors: 0, sites: b.sites }.to_json();
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
    let b = c.build("page.mkp.md", "$state {\n    count: int = 0\n}\n@@@\nHello\n", &[]);
    assert!(b.ir.is_none());
    assert_eq!(b.errors, 1);
    let d = &b.diagnostics[0];
    assert_eq!((d.code.as_str(), d.severity, d.line, d.column, d.file.as_str()), ("syntax.missing-semicolon", Severity::Error, 2, 19, "page.mkp.md"));
    assert!(d.end.line >= d.line);
}

#[test]
fn a_pack_given_as_text_is_used() {
    let c = Compiler::new();
    let pack = Source { path: "shapes/shapes.mkp".into(), text: "package shapes;\n\npack shapes@1 {\n    provides double;\n}\n\nfn double(x: number): number {\n    return x * 2;\n}\n".into() };
    let doc = "import shapes;\n@@@\nTwice: \\{double(4)}\n";
    let b = c.build("page.mkp.md", doc, &[pack]);
    assert_eq!(b.errors, 0, "{:?}", b.diagnostics);
    assert!(c.build("page.mkp.md", doc, &[]).diagnostics.iter().any(|d| d.code == "names.unknown-pack"));
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
    assert!(why.starts_with("page.mkp.md doesn't compile (1 error): page.mkp.md:5:"), "{}", why);
    // fixed: a new IR
    assert_eq!(live.follow(&c, &COUNTER.replace("Count", "Total")), Followed::Compiled);
    assert_eq!(live.revision(), 2);
    assert!(live.why().is_none() && live.errors() == 0);
    // new packs are a new build, with the same text
    live.set_packs(vec![Source { path: "x/x.mkp".into(), text: "package x;\n\npack x@1 {\n    provides y;\n}\n\nlet y: int = 1;\n".into() }]);
    assert_ne!(live.follow(&c, &COUNTER.replace("Count", "Total")), Followed::Same);
}
