//! MkpLiveDoc: a text compiled in the app and drawn, an edit that keeps `$state`, a broken draft
//! that leaves the last page and says why, a page that never compiled, and packs given as text.

use mkp_egui::doc::{DocError, DocOptions, State};
use mkp_egui::runtime::ir::Expr;
use mkp_egui_live::{compiler, Followed, MkpLiveDoc, Source};

fn testing(name: &str) -> String {
    let repo = std::path::Path::new(env!("CARGO_MANIFEST_DIR")).ancestors().nth(3).unwrap().to_path_buf();
    std::fs::read_to_string(repo.join("targets/ts/bindings/testing").join(name)).unwrap()
}

fn num(n: i64) -> Expr {
    serde_json_value(serde_json::json!({ "num": n.to_string() }))
}

fn serde_json_value(j: serde_json::Value) -> Expr {
    serde_json::from_value(j).unwrap()
}

fn items() -> DocOptions {
    DocOptions { externs: vec![("app".into(), [("unit".to_string(), serde_json_value(serde_json::json!({ "text": "items" })))].into_iter().collect::<State>())], ..DocOptions::default() }
}

fn frame(ctx: &egui::Context, doc: &mut MkpLiveDoc) -> mkp_egui::doc::DocResponse {
    let mut out = None;
    let mut output = ctx.run_ui(egui::RawInput::default(), |ui| out = Some(doc.show(ui)));
    // no painter here to take the font atlas's changes
    output.textures_delta.clear();
    out.unwrap()
}

#[test]
fn a_text_is_compiled_drawn_and_followed_through_a_broken_draft() {
    let ctx = egui::Context::default();
    let v1 = testing("counter.mkp.md");
    let mut doc = MkpLiveDoc::new(&v1, items());
    let r = frame(&ctx, &mut doc);
    assert!(r.errors.is_empty(), "{:?}", r.errors);
    assert_eq!(doc.doc().unwrap().markdown(), "# Count: 0 items\n\nAdd one\n");
    doc.doc_mut().unwrap().set([("n".to_string(), num(1))].into_iter().collect()).unwrap();
    // an edit that compiles: the new page, $state kept
    assert_eq!(doc.set_text(&testing("counter-v2.mkp.md")), Followed::Compiled);
    frame(&ctx, &mut doc);
    assert!(doc.doc().unwrap().markdown().starts_with("# Total: 1 items, by 2"), "{}", doc.doc().unwrap().markdown());
    // the same text: nothing built
    assert_eq!(doc.set_text(&testing("counter-v2.mkp.md")), Followed::Same);
    // a broken draft: the last page stays, and the next frame says why
    let broken = v1.replace("# Count: \\{$state.n}", "# Count: \\{$state.nope}");
    assert_eq!(doc.set_text(&broken), Followed::Broken);
    let r = frame(&ctx, &mut doc);
    assert!(matches!(&r.errors[..], [DocError::Compile(m)] if m.starts_with("page.mkp.md doesn't compile (1 error): page.mkp.md:")), "{:?}", r.errors);
    assert!(doc.diagnostics().iter().any(|d| d.is_error()));
    assert!(doc.doc().unwrap().markdown().starts_with("# Total: 1 items"));
    // fixed
    assert_eq!(doc.set_text(&v1), Followed::Compiled);
    assert!(frame(&ctx, &mut doc).errors.is_empty());
    assert_eq!(doc.doc().unwrap().markdown(), "# Count: 1 items\n\nAdd one\n");
}

#[test]
fn a_text_that_never_compiled_draws_why() {
    let ctx = egui::Context::default();
    let mut doc = MkpLiveDoc::new("$state {\n    n: int = 0\n}\n@@@\n", DocOptions::default());
    assert!(doc.doc().is_none());
    let r = frame(&ctx, &mut doc);
    assert!(r.response.is_some());
    assert!(matches!(&r.errors[..], [DocError::Compile(m)] if m.contains("syntax.") || m.contains("page.mkp.md:2:")), "{:?}", r.errors);
    // then a good one starts the page with the options it was made with
    assert_eq!(doc.set_text("# Hello\n"), Followed::Compiled);
    assert_eq!(doc.doc().unwrap().markdown(), "# Hello\n");
}

#[test]
fn packs_are_given_as_text_and_the_compiler_is_the_apps() {
    let pack = Source { path: "shapes/shapes.mkp".into(), text: "package shapes;\n\npack shapes@1 {\n    provides double;\n}\n\nfn double(x: number): number {\n    return x * 2;\n}\n".into() };
    let doc = MkpLiveDoc::with(compiler(), "page.mkp.md", vec![pack], "import shapes;\n@@@\nTwice: \\{double(4)}\n", DocOptions::default());
    assert_eq!(doc.doc().unwrap().markdown(), "Twice: 8\n");
    assert!(std::rc::Rc::ptr_eq(&compiler(), &compiler()));
}
