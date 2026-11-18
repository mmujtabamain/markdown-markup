# mkp-egui

MKP's desktop target, run time: pages run on the native runtime ([mkp-runtime](../runtime)) and
drawn with egui, with our default egui widgets for every core extern widget, from an IR they are
given. It needs no compiler (an app turns the `check` feature off, which the check adapters need).
The real-time target, which compiles a document's text in the app, is
[mkp-egui-live](../egui-live).

A document as an app holds one is an `MkpDoc` (`src/doc.rs`): from the IR in hand
(`MkpDoc::new`, `from_json`) or where it is (`MkpDoc::open(path)`), with `$state` the app's to
control or to start from, every write checked by mkp, and a snapshot of everything the page holds.

```rust,no_run
use mkp_egui::doc::{DocOptions, MkpDoc, State};

fn app(json: &str) -> MkpDoc {
    MkpDoc::from_json(json, DocOptions::default()).unwrap()
}

fn frame(doc: &mut MkpDoc, state: &mut State, ui: &mut egui::Ui) {
    // `state` is the app's: a change it made is written (checked), a change the page made comes back
    let r = doc.show_controlled(ui, state);
    for e in r.errors {
        eprintln!("{}", e); // a write mkp refused, a widget that failed
    }
}
```

| `MkpDoc` | |
|---|---|
| `new(ir, options)`, `from_json(text, options)`, `open(path, options)` | A document; `DocOptions` has the page's values, the `$state` (or `snapshot`) to start from (checked: what doesn't fit is refused), the externs by channel, value fns over egui's, the registry and a measure. An IR that can't be had is `DocError::Load`. |
| `show(ui)`, `show_controlled(ui, &mut state)` | One frame. Its `DocResponse` has the page's response, `state` if it changed, the app's extern fns called, and `errors`: `Refused` and `Failed`, as the web targets' `onError`. |
| `set(state)`, `state()`, `expose(channel, name, args)`, `set_extern(channel, values)`, `set_page(values)`, `markdown()` | What an app does to a document; `set` is one checked write, refused whole. |
| `snapshot()`, `restore(&snap)` | `$state` and every widget's own variables, as serde-able JSON; with the same IR all of it goes back, with another only `$state` (`RestoredHow`). |
| `replace(ir, externs)` | A new IR for the same document, `$state` kept where its fields still exist and fit. |

The page under it, `MkpPage`:

```rust,no_run
use mkp_egui::{runtime::Page, MkpPage};

fn app(json: &str) -> MkpPage {
    // once: the IR `mkp build page.mkp.md --out page.ir.json` wrote, with egui's value fns
    MkpPage::new(Page::from_json(json, MkpPage::options()).unwrap())
}

fn frame(page: &mut MkpPage, ui: &mut egui::Ui) {
    page.show(ui); // every frame, as egui draws
}
```

## The API

| | |
|---|---|
| `MkpPage::new(page)` | Draws a `Page` with our widgets, and tells it what is supplied (`set_supplies`): an extern nobody draws shows its Markdown, and is in `page().missing()`. |
| `MkpPage::options()` | `PageOptions` with egui's value fns: `core/moment.local` in the reader's own zone. |
| `.widget(name, make)`, `.with_registry(r)` | An app's widget replaces ours by full name (`core/press`), or adds a pack's (`acme/chart`). |
| `.with_measure(m)` | The plane's layout from a measure of the app's (the checks' `measure::Fixed`), not from what egui drew. |
| `.follow_theme(bool)` | The page's `core/page.theme` follows egui's dark mode (the default), or is the app's to set. |
| `.id(id)` | The page's egui id: two pages in one window each need one. |
| `show(ui)` | Draws the page, then lays its planes out from what was drawn. Call it every frame. |
| `page()`, `page_mut()` | The runtime's `Page`: `set`, `expose`, `set_extern`, `take_calls`, `markdown` … |
| `act(path, Act)` | A reader's action, done by the widget with its own controls on its next frame (a slider moved, a field typed into); one it can't do goes through the page. |
| `record(true)`, `take_log()` | Every event and write the reader's actions made, the layout's included. |
| `take_errors()` | What went wrong: failed handlers, refused drawing, a layout that wouldn't settle. |
| `run_window(title, page)` | With the `app` feature: the page in a window of its own, with eframe. |

A widget implements one method, drawn every frame:

```rust,ignore
pub trait Widget {
    fn show(&mut self, ui: &mut egui::Ui, props: &Props, ctx: &mut Ctx);
}
```

- **`Props`** are the props the runtime worked out once per change; a frame only reads them
  (`text`, `flag`, `num`, `exact`, `case`, `point`, `list`, `slot`).
- **`Ctx`** is how a widget acts: `event(name, args)`; `write(input, value)`, checked, which says
  whether it took; `listens(event)`, so only what does something is clickable; `write_type(input)`,
  where a slider's ends come from; `slot(ui, name)` and `child(ui, d)` draw its slots' widgets, and
  `keep(name)` keeps a hidden slot on the page; `color`, `length` and `look()` give the tokens for
  the page's theme; `root(ui, builder, add)` is our widgets' root, named for the AccessKit tree.
- **One instance per drawn widget**, made from the registry's maker when its key is first drawn and
  dropped when it leaves the page, so a widget may keep state in `self` (what is being typed).

## Our widgets

Each is egui's own kind of control where egui has one, with its role, name and state in egui's
AccessKit tree: a screen reader reads it, and egui's keyboard drives it (Tab, Enter and Space press
what is focused, arrows move a slider, a handle or a plane's view). Each widget's root node has the
author id `<short name>@<path>` (`press@s0/s0`), and each of its parts `<short name>.<part>`, as
@mkp/dom's `data-mkp-site` and `data-part` (see [its parts table](../../ts/dom/README.md#parts)).

| Widget | egui | Role | Parts |
|---|---|---|---|
| paragraph, heading | a text layout from the rich text; links open on click | paragraph; heading with its level | |
| bullets, item | a list, markers drawn beside each item | list (`ul`/`ol` as its class); listitem | `item.check` (checkbox, disabled), `item.body` |
| quote, code, table, footnote, divider | a bar beside the quote; mono text that scrolls; columns; a mark and a body; a rule | blockquote; generic; table; note; separator | `code.text`; `table.grid`, `.header`, `.cell`; `footnote.mark`, `.body` |
| **math** | **its TeX, in mono**: egui has no maths renderer (`cannot` in target.yaml) | math, named by its TeX | |
| label, image, icon | text; `egui::Image` when the app installed loaders, else a box with its alt text; a symbol from egui's fonts | generic; img; img with a label | |
| press | a button, toggle, tab, option, switch, checkbox or radio | by kind, with its toggled or selected state | `press.label`, `press.content` |
| field | `egui::TextEdit`, one line or several | textbox, named by its label | `field.label`, `field.input` |
| slider | a rail and a thumb, written in exact decimals | slider with its value, ends and step | `slider.label`, `.input`, `.value` |
| overlay | an `egui::Area` below its anchor, or centred over a backdrop (DIALOG) | button anchor; dialog or tooltip body | `overlay.anchor`, `overlay.body` |
| flex, grid, cell, sizing | egui layouts; a grid's columns placed by hand, with spans | button when its click does something | |
| canvas, layer, circle, path, place, handle, shade | painted shapes in the canvas's units, y up; shade on the CPU | group; button or img by their events | `canvas.surface`, `layer.shapes`, `path.line`, `.head`, `place.box`, `handle.dot`, `.hit`, `shade.pixels` |
| plane, spot | egui's `Scene`, which pans and zooms its content | group; its view takes the keys | `plane.view` |

- **The plane** draws its spots unscaled in the `Scene`, so each spot's rect there is its size in
  the plane's units, steady while the reader pans and zooms; the layout writes a box only when it
  changes. A layout that keeps changing the page with nothing else changing it (a spot whose key
  moves at every redraw) is held after 8 frames, since egui lays out every frame.
- **`shade`** samples its shader on the CPU: at most 65,536 samples, fewer for a slow shader
  (a coarse 16×16 pass first, the rest in slices of 12 ms, within 1.5 s in all).
- **Not drawn**: a widget in a sentence (`rich_text`'s VIEW part) shows nothing here.

## The checks

```sh
cd targets/rust && cargo build --release -p mkp-cli -p mkp-egui
cd ../.. && targets/rust/target/release/mkp target check egui          # MKP's target checks
targets/rust/target/release/mkp target check                           # with every target compared
"$(external/omnicui/fetch.sh)" --project targets/checks check egui   # the widget contracts
cd targets/rust && cargo test -p mkp-egui                              # this crate's own tests
```

- **`mkp_check_adapter`** (target.yaml's `check_adapter:`) runs each case's page headless in
  egui_kittest's harness, with the checks' fixed sizes for the plane's layout, so every target's
  boxes agree. A press's click is a real pointer click on its node in the AccessKit tree; a slider's
  value, a field's text and an overlay's `open` are acts each widget does with its own controls;
  the rest goes through the page. The observed tree is what egui drew, a closed overlay's body
  included (kept on the page, hidden). `MKP_TEST_DEFECT` switches the runtime's defects on.
- **`mkp_omnicui_adapter`** (targets/checks/targets/egui/target.yaml) mounts one widget per
  contract on a page written as the web's adapter writes it (`check::source`), compiled with the
  compiler's own crates, at the contract's viewport and colour scheme, with what egui measures.
  Steps are real egui input at the part's node (a click, a hover, a drag, keys, text a character
  at a time); `read` comes from the AccessKit tree. It takes no screenshots: egui_kittest renders
  through wgpu, which this target leaves out, and the web takes none either.
- **Both run the prebuilt release binary**, not `cargo run` (as the plan's target.yaml has it), so
  a check run builds nothing and starts at once: build it first, as above.

## The example

```sh
cargo run -p mkp-egui --example page --features app                          # examples/demo.mkp.md
cargo run -p mkp-egui --example page --features app -- page.ir.json          # what mkp build wrote
cargo run -p mkp-egui --example page --features app -- doc.mkp.md packs/maps # compiled there
```

## Features

`fonts` (default): egui's own fonts, which egui 0.37 doesn't bundle by default. `check`
(default): the headless harness and the adapters. `app`: `run_window`, with eframe.
