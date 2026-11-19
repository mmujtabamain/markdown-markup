# xtmd-egui-live

Extended Mark's desktop target, real time: a document's text compiled in the app as it is edited, by
[xtmd-live](../live)'s compiler (core compiled once for the app), and drawn by
[xtmd-egui](../egui)'s `XtmdDoc`. The run-time target, xtmd-egui, carries no compiler; an app that
only draws pages it was given uses that one.

```rust,no_run
use xtmd_egui::doc::DocOptions;
use xtmd_egui_live::XtmdLiveDoc;

fn app(text: &str) -> XtmdLiveDoc {
    XtmdLiveDoc::new(text, DocOptions::default())
}

fn frame(doc: &mut XtmdLiveDoc, editor_text: &str, ui: &mut egui::Ui) {
    // when to compile is the app's: each key, a pause, a save
    doc.set_text(editor_text);
    let r = doc.show(ui);
    for e in r.errors {
        eprintln!("{}", e); // a draft that doesn't compile is DocError::Compile, with its first error and where
    }
}
```

- A text that compiles replaces the page, keeping `$state` where its fields still exist and fit.
- One that doesn't leaves the last page that did. `diagnostics()` has every diagnostic of the
  latest text, and `why()` gives the first error as one line.
- Before any text has compiled, `show` draws the reason.
- `XtmdLiveDoc::with(compiler, path, packs, text, options)` gives the path, the packs' files as text,
  and a compiler of the app's; `compiler()` is the app's own, made the first time it is asked for.
- Everything else is the `XtmdDoc` it draws: `doc()`, `doc_mut()` (`set`, `snapshot`, `restore` …).

## The checks

`xtmd target check egui-live` runs every conformance case through `xtmd_egui_live_check_adapter`,
which compiles each case's own text in the app and drives the document as egui's adapter does
(`xtmd_egui::check::adapter`). Build it first: `cargo build --release -p xtmd-egui-live`.
`cargo test -p xtmd-egui-live` runs `tests/live.rs`.
