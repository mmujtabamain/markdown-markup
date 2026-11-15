# schemas

The contracts between the compiler and every target, as JSON Schema (draft 2020-12). They are the source: the Rust and TypeScript types are generated from them.

| File | What it describes |
|---|---|
| `ir.schema.json` | IR 3: the one checked, lowered IR the `mkp` compiler writes and every target runs. Declarations, templates (widgets written in MKP, lowered to nodes), bindings with what each reads, and handlers. No Markdown is left in it. |
| `check.schema.json` | The target checks: a case (a source, its diagnostics, and steps), what a target observes after each step, and the JSON-RPC messages `mkp target check` sends a target's check adapter. |
| `examples/*.ir.json` | Whole IR files, from the plan's counter and sprint pages, held to the schema and to the Rust types by `cargo test -p mkp-ir`. |

The IR follows five rules: one key per node where a value can be of several kinds; every part named; one key, one meaning (`get` for every read, `declare` for every declaration); linked parts together (an `if` holds all its branches); and MKP's own words (`requires`, `default`, `$state`, operators by their symbol).

## The generated types

```sh
cd targets/rust
cargo run -p mkp-schemagen            # writes the types
cargo run -p mkp-schemagen -- --check # only says whether they are current
```

| Generated | From |
|---|---|
| `targets/rust/compiler/ir/src/ir.rs`, `check.rs` | the crate `mkp-ir` |
| `targets/ts/runtime/src/generated/ir.ts`, `check.ts` | `@mkp/runtime` |

`cargo test -p mkp-ir` fails when a generated file is not current, when an example or a check case doesn't fit its schema, or when the Rust types don't read and write it back unchanged.
