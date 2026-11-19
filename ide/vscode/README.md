# Extended Mark for VS Code

Extended Mark in VS Code, and in vscode.dev and github.dev: highlighting, errors as you type,
hover, go to definition, references, the outline, completion and formatting, from xtmd's own
language server (ide/lsp), built in as WebAssembly so there is nothing to install; and a live
preview, the `vscode` target, that draws the page with VS Code's own components in the editor's
theme.

- **Highlighting** for `.xt.md` and `.xtpack`: the code above a document's `@@@` line, and the
  Markdown below it with widget calls, holes, control lines and `@//` comments. A document with no
  `@@@` line is read as prose all through.
- **The language server** answers in a Node process (or a web worker in a browser), built from
  ide/lsp into xtmd.wasm. `xtmd.server: "xtmd"` uses `xtmd lsp` from the binary instead.
- **Packs**: a document is built with the packs its `xtmd.toml` names, read through VS Code (so in
  vscode.dev too) and given to the server.
- **The preview** (Extended Mark: Open Preview to the Side) compiles the text as it is edited and
  draws it beside the editor. A draft that doesn't compile keeps the last page that did, and says
  why at its top; a widget that fails while drawn is marked on its call in the editor. Reset the
  Preview's $state starts it again.
- **Commands**: Show the IR; on the desktop, with the xtmd binary, Show as Markdown, Check a
  Folder (into Problems) and Migrate (the diff first, then written). A document still named
  `name.mkp.md` offers to migrate.
- `*.ir.json` and `*.rir.json` are checked against the IR schemas.

What it does is logged in its output channel (Extended Mark: Show the Log); nothing is sent
anywhere.

## The vscode target

The preview is a target like any other (`checks/target.yaml`): core's 30 extern widgets, drawn by
`src/target/widgets.ts` as VS Code draws its own UI. press is VS Code's button, checkbox, radio,
toggle, tab or list option; field its input box; slider, overlay and label in its colours; icon a
codicon. Markdown's blocks look as VS Code's Markdown preview draws them. The widgets keep the web
target's behaviour (events, keyboard, roles), which core's contracts hold every target to, and the
target is checked as every target is:

```sh
xtmd target check vscode                                              # every case, in Chromium
external/omnicui/fetch.sh && omnicui --project targets/checks check vscode   # the widget contracts
```

## Building and testing

```sh
npm install
npm test              # builds dist/ (types checked first), then the grammar and language tests
npm run vscode        # VS Code itself (downloaded into .vscode-test), driven and photographed into test/out
npm run package       # xtmd-0.3.0.vsix
```

`npm run vscode` needs a screen; on a box without one, run it under Xvfb:
`Xvfb :97 -screen 0 1600x1000x24 & DISPLAY=:97 npm run vscode`.
