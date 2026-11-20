# ide/lsp: Extended Mark's language server

The editor features, worked out once from the checker's resolved IR (`xtmd build --rir`, with
core's own declarations in it), and the server that gives them to any editor over the Language
Server Protocol. `xtmd lsp` runs it over stdin and stdout; `@extended-mark/wasm` runs the same
server in a browser or a worker (`LanguageServer`), which is how the VS Code extension
(ide/vscode) runs it, with nothing to install.

| Feature | What it gives |
|---|---|
| Diagnostics | each document's errors and warnings as it is edited, each code linking to its rule in the spec |
| Hover | a name's declaration as it is written, with its doc comment; an expression's type |
| Go to definition | a widget, input, fn, record or `$state` field's declaration, in the document, its packs or core (`xtmd-core:/core/…`, its text from the `xtmd/core` request) |
| References | every place a declaration is named |
| Outline | a file's declarations, a widget's inputs and events, `$state`'s fields |
| Completion | widgets after `@`, with the inputs they need as snippet stops; inside a call, the inputs and events not given yet; `$state.` fields; an enum's or a token's cases |
| Formatting | the canonical layout, `xtmd fmt`'s |
| Quick fixes | a diagnostic's fix where there is exactly one right one: the name a slip most likely meant ("did you mean `press`?") for an unknown widget, input, slot, name, field, case, type or fn, a name written in capitals or with `-`; and the canonical layout for a layout warning |

A document's packs are the ones its `xtmd.toml` names, read from disk. A client that reads them
itself (a browser has no disk) gives them with the `xtmd/packs` notification:
`{ "uri": "<the document's>", "packs": [{ "path": "<a pack file's URI>", "text": "…" }] }`.

## Editors

Any editor with a language client starts `xtmd lsp` for `.xtmd` and `.xtmdpack` files.

**VS Code:** the extension in ide/vscode.

**Neovim** (0.11):

```lua
vim.filetype.add({ extension = { xtmd = "xtmd", xtmdpack = "xtmd" } })
vim.lsp.config("xtmd", { cmd = { "xtmd", "lsp" }, filetypes = { "xtmd" }, root_markers = { "xtmd.toml", ".git" } })
vim.lsp.enable("xtmd")
```

**Helix** (`languages.toml`):

```toml
[language-server.xtmd]
command = "xtmd"
args = ["lsp"]

[[language]]
name = "xtmd"
scope = "source.xtmd"
file-types = ["xtmd", "xtmdpack"]
roots = ["xtmd.toml"]
language-servers = ["xtmd"]
```

**Zed:** a language entry for `*.xtmd` and `*.xtmdpack` whose language server runs `xtmd lsp`.

## Tests

```sh
cd targets/rust && cargo test -p xtmd-lsp          # the analysis and the server, end to end
cargo test -p xtmd-cli --test cli -- lsp_serves     # xtmd lsp over stdio
```
