//! XtmdDoc, egui's run-time target, on the pages the web targets' tests use
//! (targets/ts/bindings/testing): a starting `$state` checked, `$state` controlled by the app,
//! externs, extern fns and exposed fns, snapshots, a new IR, and an IR that can't be had.

mod common;

use xtmd_egui::doc::{DocError, DocOptions, XtmdDoc, RestoredHow, State};
use xtmd_egui::runtime::ir::{self, Expr};

fn page(name: &str) -> ir::File {
    common::ir(&std::fs::read_to_string(common::repo().join("targets/ts/bindings/testing").join(name)).unwrap(), &[])
}

fn num(n: i64) -> Expr {
    serde_json::from_value(serde_json::json!({ "num": n.to_string() })).unwrap()
}

fn text(t: &str) -> Expr {
    serde_json::from_value(serde_json::json!({ "text": t })).unwrap()
}

fn state(pairs: &[(&str, Expr)]) -> State {
    pairs.iter().map(|(k, v)| (k.to_string(), v.clone())).collect()
}

fn items() -> Vec<(String, State)> {
    vec![("app".into(), state(&[("unit", text("items"))]))]
}

/// One frame of the document, headless, with `$state` controlled when given.
fn frame(ctx: &egui::Context, doc: &mut XtmdDoc, controlled: Option<&mut State>) -> xtmd_egui::doc::DocResponse {
    let mut out = None;
    let mut controlled = controlled;
    let mut output = ctx.run_ui(egui::RawInput::default(), |ui| {
        out = Some(match controlled.as_deref_mut() {
            Some(s) => doc.show_controlled(ui, s),
            None => doc.show(ui),
        });
    });
    // no painter here to take the font atlas's changes
    output.textures_delta.clear();
    out.unwrap()
}

/// The path of the first drawn widget of a kind.
fn path_of(doc: &XtmdDoc, widget: &str) -> String {
    fn walk(nodes: &[xtmd_egui::runtime::Drawn], widget: &str) -> Option<String> {
        nodes.iter().find_map(|n| if n.widget == widget { Some(n.path.clone()) } else { n.slots.values().find_map(|k| walk(k, widget)) })
    }
    walk(doc.page().tree(), widget).unwrap()
}

#[test]
fn a_document_draws_its_page_from_the_state_it_starts_from_checked() {
    let ctx = egui::Context::default();
    let mut doc = XtmdDoc::new(page("counter.xtmd"), DocOptions { state: Some(state(&[("n", num(2))])), externs: items(), ..DocOptions::default() }).unwrap();
    let r = frame(&ctx, &mut doc, None);
    assert!(r.response.is_some() && r.errors.is_empty(), "{:?}", r.errors);
    assert_eq!(doc.markdown(), "# Count: 2 items\n\nAdd one\n");
    // one that doesn't fit: refused, told at the first frame, and the page starts from its default
    let mut bad = XtmdDoc::new(page("counter.xtmd"), DocOptions { state: Some(state(&[("n", num(11))])), externs: items(), ..DocOptions::default() }).unwrap();
    let r = frame(&ctx, &mut bad, None);
    assert!(matches!(&r.errors[..], [DocError::Refused(b)] if b.site.as_deref() == Some("$state.n")), "{:?}", r.errors);
    assert_eq!(bad.state(), state(&[("n", num(0))]));
}

#[test]
fn a_controlled_state_is_written_checked_and_follows_the_page() {
    let ctx = egui::Context::default();
    let mut doc = XtmdDoc::new(page("counter.xtmd"), DocOptions { externs: items(), ..DocOptions::default() }).unwrap();
    let mut app = state(&[("n", num(0))]);
    frame(&ctx, &mut doc, Some(&mut app));
    // the app's change is written
    app.insert("n".into(), num(4));
    let r = frame(&ctx, &mut doc, Some(&mut app));
    assert!(r.errors.is_empty());
    assert_eq!(doc.markdown(), "# Count: 4 items\n\nAdd one\n");
    // one that doesn't fit: refused, and the app's goes back to the page's
    app.insert("n".into(), num(20));
    let r = frame(&ctx, &mut doc, Some(&mut app));
    assert!(matches!(&r.errors[..], [DocError::Refused(b)] if b.code.as_deref() == Some("contracts.outside")), "{:?}", r.errors);
    assert_eq!(app, state(&[("n", num(4))]));
    // refused once, not every frame
    assert!(frame(&ctx, &mut doc, Some(&mut app)).errors.is_empty());
    // the reader's press: the page changes, and so does the app's, with the extern fn it called
    let press = path_of(&doc, "core/press");
    doc.view_mut().page_mut().event(&press, "click", vec![]).unwrap();
    let r = frame(&ctx, &mut doc, Some(&mut app));
    assert_eq!(app, state(&[("n", num(5))]));
    assert_eq!(r.state, Some(state(&[("n", num(5))])));
    assert_eq!(r.calls.len(), 1);
    assert!(format!("{:?}", r.calls[0]).contains("doc/app.saved"), "{:?}", r.calls);
}

#[test]
fn set_expose_and_externs_go_through_the_page() {
    let ctx = egui::Context::default();
    let mut doc = XtmdDoc::new(page("counter.xtmd"), DocOptions { externs: items(), ..DocOptions::default() }).unwrap();
    frame(&ctx, &mut doc, None);
    assert!(matches!(doc.set(state(&[("n", num(20))])), Err(DocError::Refused(_))));
    doc.set(state(&[("n", num(3))])).unwrap();
    assert_eq!(frame(&ctx, &mut doc, None).state, Some(state(&[("n", num(3))])));
    doc.set_extern("app", state(&[("unit", text("pts"))])).unwrap();
    assert_eq!(doc.markdown(), "# Count: 3 pts\n\nAdd one\n");
    doc.expose("app", "reset", vec![]).unwrap();
    assert_eq!(doc.state(), state(&[("n", num(0))]));
}

#[test]
fn a_snapshot_brings_back_state_and_widgets_own_variables() {
    let ctx = egui::Context::default();
    let mut doc = XtmdDoc::new(page("notes.xtmd"), DocOptions::default()).unwrap();
    frame(&ctx, &mut doc, None);
    doc.set(state(&[("n", num(2))])).unwrap();
    let press = path_of(&doc, "core/press");
    for _ in 0..2 {
        doc.view_mut().page_mut().event(&press, "click", vec![]).unwrap();
    }
    frame(&ctx, &mut doc, None);
    assert!(doc.markdown().contains("Apples: 2"), "{}", doc.markdown());
    let snap = doc.snapshot();
    let json = serde_json::to_string(&snap).unwrap();
    assert!(snap.own.values().any(|o| o.get("k") == Some(&num(2))), "{}", json);
    // the same IR: all of it
    let mut again = XtmdDoc::new(page("notes.xtmd"), DocOptions::default()).unwrap();
    let back = again.restore(&serde_json::from_str(&json).unwrap());
    assert_eq!((back.restored, back.dropped), (RestoredHow::All, vec![]));
    assert!(again.markdown().contains("Apples: 2") && again.markdown().contains("# Notes: 2"), "{}", again.markdown());
    // started from it
    let started = XtmdDoc::new(page("notes.xtmd"), DocOptions { snapshot: Some(snap.clone()), ..DocOptions::default() }).unwrap();
    assert!(started.markdown().contains("Apples: 2"));
    // another IR: $state only
    let mut other = XtmdDoc::new(page("counter.xtmd"), DocOptions { externs: items(), ..DocOptions::default() }).unwrap();
    let back = other.restore(&snap);
    assert_eq!((back.restored, back.dropped), (RestoredHow::State, vec!["own".to_string()]));
    assert_eq!(other.state(), state(&[("n", num(2))]));
    // another release, or a $state refused: nothing
    let mut old = snap.clone();
    old.xtmd = "0.2.0".into();
    assert_eq!(other.restore(&old).restored, RestoredHow::None);
    let mut bad = snap.clone();
    bad.state = state(&[("n", num(11))]);
    assert_eq!(other.restore(&bad).restored, RestoredHow::None);
    assert_eq!(other.state(), state(&[("n", num(2))]));
}

#[test]
fn a_new_ir_keeps_the_state_whose_fields_it_still_has() {
    let ctx = egui::Context::default();
    let mut doc = XtmdDoc::new(page("counter.xtmd"), DocOptions { externs: items(), ..DocOptions::default() }).unwrap();
    doc.set(state(&[("n", num(3))])).unwrap();
    doc.replace(page("counter-v2.xtmd"), items()).unwrap();
    frame(&ctx, &mut doc, None);
    assert_eq!(doc.state(), state(&[("n", num(3)), ("stride", num(2))]));
    assert!(doc.markdown().starts_with("# Total: 3 items, by 2"), "{}", doc.markdown());
}

#[test]
fn an_ir_that_cant_be_had_says_why() {
    let missing = XtmdDoc::open("/no/such/page.ir.json", DocOptions::default()).err().unwrap();
    assert!(matches!(&missing, DocError::Load(m) if m.starts_with("the page at /no/such/page.ir.json couldn't be loaded")), "{}", missing);
    assert!(matches!(XtmdDoc::from_json("{}", DocOptions::default()), Err(DocError::Load(m)) if m.starts_with("the IR doesn't read")));
}
