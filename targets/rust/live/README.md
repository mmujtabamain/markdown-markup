# mkp-live

What a real-time MKP target embeds: the compiler, with core compiled once when it is made, which
builds a document's text (and its packs' files, as text) into the IR `mkp build` writes; and
`Live`, a text followed as it is edited, which keeps the last IR that compiled while a draft has
errors. The run-time targets don't depend on it.

- `Compiler::new()` compiles core (the slow part); `build(path, text, packs)` gives a `Built`:
  the IR or none, the diagnostics as `mkp check --format json` writes them, and the error count.
  `Built::to_json()` is the JSON mkp-wasm hands the browser.
- `Live::new(path).with_packs(packs)`, then `follow(&compiler, text)`: `Same`, `Compiled` (a new
  `ir()`, `revision()` moved) or `Broken` (the last `ir()` stays; `diagnostics()` and `why()`
  say why).

Used by [mkp-wasm](../wasm) (the browser's, through @mkp/wasm), [mkp-egui-live](../egui-live)
and mkp-android-live. `cargo test -p mkp-live` runs `tests/live.rs`.
