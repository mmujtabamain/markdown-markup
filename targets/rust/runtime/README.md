# mkp-runtime

MKP's native runtime: it runs the IR the `mkp` compiler writes, for the egui target and, through
UniFFI, for Android (plan tab 7). It is @mkp/runtime (targets/ts/runtime) in Rust, held to the
same target checks: both runtimes give the same tree, `$state`, calls, outcome, boxes and Markdown
for every case.

- **Transactions.** Every change (a reader's event, a widget's write, the app's write to
  `$state`, an exposed fn, a channel's values, the page's values) is one transaction: checked
  against contracts and `$state`'s rules, undone whole when it fails, then drawn once.
- **Identity.** A widget written in MKP keeps its own variables across redraws by its key: a loop
  row's widgets follow their item, not their position.
- **Failures** are contained (page 6): a widget that fails while drawing becomes a `#notice`, a
  handler that fails is undone, an app's write that breaks a rule is refused. Each is reported in
  `take_outcome()`.
- **Markdown out**: `markdown()` writes the live page, the same text @mkp/runtime writes.
- **Layout**: `layout(&mut measure)` lays planes out from what the target measured.
- **No drawing** and no UI dependency. Its tree holds every prop already worked out, so a target
  that draws every frame (egui) only reads it: nothing is evaluated per frame.

## Using it

```rust,no_run
use mkp_runtime::ir::Expr;
use mkp_runtime::layout::{Measure, Size};
use mkp_runtime::{Drawn, Num, Page, PageOptions, Value};

// a page from `mkp build page.mkp.md -o page.ir.json`, mounted and drawn once
let json = std::fs::read_to_string("page.ir.json").unwrap();
let mut page = Page::from_json(&json, PageOptions::default()).unwrap();

// every frame: read the tree, its props already worked out
fn draw(page: &Page, nodes: &[Drawn]) {
    for d in nodes {
        match d.widget.as_str() {
            "core/press" => {
                let _label = d.prop("label");
                // only what does something is made clickable
                let _clickable = page.listens(d, "click");
            }
            // a slider's ends and step come from the variable it writes
            "core/slider" => {
                let _range = page.write_type(d, "value").and_then(|t| t.contract);
            }
            "#notice" => { /* a widget that failed: show d.prop("message") */ }
            _ => {}
        }
        for kids in d.slots.values() {
            draw(page, kids);
        }
    }
}
draw(&page, page.tree());

// the reader acts: each call is one transaction, and the page is drawn again once
page.event("s0/s1", "click", vec![]).unwrap();
page.write("s0/s2", "value", Value::Num(Num::int(7))).unwrap();

// the app writes `$state` and gives a channel's values; values come in the IR's form
let n = page.value(&Expr::Num("3".into())).unwrap();
page.set(vec![("count".into(), n)]).unwrap();

// what happened, for the app: refused writes, failures, its extern fns called, warnings
let outcome = page.take_outcome();
for call in page.take_calls() {
    println!("the page called {} with {:?}", call.call.name, call.call.args);
}
let _ = (outcome, page.take_warnings());

// planes: the target measures each spot's child, and the layout writes the boxes
struct Measured;
impl Measure for Measured {
    fn spot(&mut self, _page: &Page, _spot: &Drawn) -> Size {
        Size { width: Num::int(80), height: Num::int(20) }
    }
    fn plane_width(&mut self, _page: &Page, _plane: &Drawn) -> Num {
        Num::int(640)
    }
}
page.layout(&mut Measured).unwrap();

// the page as Markdown, with the values it has now
println!("{}", page.markdown().unwrap());
```

## The API

| | |
|---|---|
| `Page::from_json(json, opts)`, `Page::new(ir::File, opts)`, `Page::from_module` | Mount a page and draw it once. `PageOptions { page, state, externs, fns, supplies, defects }`. |
| `tree() -> &[Drawn]`, `find(path)`, `revision()`, `on_change(f)` / `off_change(id)` | The drawn extern widgets. `revision()` moves at every redraw: a target that draws every frame rebuilds what it caches when it moves. |
| `event(path, name, args)`, `write(path, input, value)` | The reader's changes, on a drawn widget by its path. |
| `set(changes)`, `expose(channel, fn, args)`, `set_extern(channel, values)`, `set_page(PageValues)` | The app's changes: `$state` checked for type, then contract, then rules. |
| `set_supplies(f)`, `missing()` | Which extern widgets the target draws; one it doesn't shows its Markdown (page 6). |
| `take_outcome()`, `take_calls()`, `take_warnings()`, `take_errors()` | What happened since the last take. |
| `markdown()`, `markdown_blocks()` | Markdown out. |
| `layout(&mut dyn Measure)`, `layout_write(writes)` | Planes: at most 8 passes, each one transaction; a layout that never settles is `failure.layout`, and is held until the next outside change. |
| `listens(drawn, event)`, `write_type(drawn, input)` | What a target asks while it draws. |
| `value(expr)`, `eval(expr)`, `token_value(v)`, `equal(a, b)`, `apply(fn, args)` | Values in and out: `Value::to_ir()` gives the IR's form. `apply` runs a fn the tree holds (a `shade`'s shader), with the step limit to itself. |
| `observe_tree()`, `observe_state()`, `observe_shaded(samples)` | What a target check observes. |

A method returns `Err(Failure)` only for a failure outside any widget or handler, as @mkp/runtime
throws: a prop of the document's own that can't be worked out. Everything else is contained and
reported in `take_outcome()`.

`fns` are the value fns the target supplies, by full name, each given the page's machine:
`core/moment.local` reads the reader's time zone, `core/can_draw_tex` says which TeX it draws.

## On egui and Android

- **egui** reads `tree()` every frame and calls `event`, `write` and `layout` from its
  responses. A spot's box comes from its response's rect, in the plane's units; `layout` skips a
  box equal to the one there, so laying out every frame costs nothing once it has settled.
- **Android through UniFFI.** A `Page` holds `Rc` values, so it is not `Send`: the binding owns
  it on one thread (behind a `Mutex`, or on a thread of its own) and hands Kotlin plain records,
  values in the IR's form (`Value::to_ir`, `Page::value`), as the checks' JSON-RPC adapter does.

## The headless check target

`mkp_runtime_check` (src/bin) drives this crate over the checks' JSON-RPC, as
targets/ts/test/adapter.mjs drives @mkp/runtime: the test target's fixed sizes (`sizes.rs`), its
value fns (`moment.local` in UTC, all TeX drawn) and its defects (`MKP_TEST_DEFECT`). It takes no
shader samples, which are the test target's. headless/target.yaml names it `native` and runs the
release binary, which has to be built first: `cargo run` there would build on every run.

```sh
cd targets/rust && cargo build --release -p mkp-cli -p mkp-runtime
cd ../.. && targets/rust/target/release/mkp target check native        # every check
targets/rust/target/release/mkp target check test native               # and the same observations as the test target
targets/rust/target/release/mkp target check native --defect no-undo --expect-failures
cd targets/rust && cargo test -p mkp-runtime                           # this crate's own tests
```
