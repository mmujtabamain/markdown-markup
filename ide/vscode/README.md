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
  ide/lsp into xtmd.wasm. The extension is self-contained: it needs no xtmd binary.
- **Packs**: a document is built with the packs its `xtmd.toml` names, read through VS Code (so in
  vscode.dev too) and given to the server.
- **The preview** (Extended Mark: Open Preview to the Side) compiles the text as it is edited and
  draws it beside the editor. A draft that doesn't compile keeps the last page that did, and says
  why at its top; a widget that fails while drawn is marked on its call in the editor. Reset the
  Preview's $state starts it again.
- **Commands**, from xtmd.wasm, in a browser too:
  - **Show the IR** and **Show as Markdown** open what `xtmd build` and `xtmd md` write on a page
    of its own beside the document; nothing is saved.
  - **Check a Folder** checks every `.xt.md` and `.xtpack` file under it as the language server
    checks an open one, into Problems.
  - **Migrate** plans what `xtmd migrate` would do (xtmd-migrate, in xtmd.wasm), asks its questions
    one at a time, shows every change side by side with the file as it is, and on Write Them writes
    it as one edit: Undo in any file it wrote takes the whole migration back. A document written for MKP 0.2 is moved by 0.2's frozen step (`dist/migrate-0.2.cjs`),
    run with VS Code's own Node, with the 0.2 packs (folders with a `manifest.mkp`) in the
    workspace; a browser has no Node, so there it is left as it is, and says why. A document still
    named `name.mkp.md` offers to migrate.
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
