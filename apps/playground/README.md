# Extended Mark playground

Edit an Extended Mark page on the left and see it drawn on the right, with its Markdown, its diagnostics and its `$state` under it, all live. The page compiles in the browser: `xtmd.wasm` (`@extended-mark/wasm`, the compiler built as WebAssembly) in a worker of its own, so nothing is sent to a server to compile and the editor never waits on one. Press a button in the page and the Markdown and `$state` follow; change a value in `$state` and the page follows, unless one of `$state`'s rules refuses the write.

- **Source**: [Monaco](https://microsoft.github.io/monaco-editor/) (`monaco-editor` 0.57.0, its editor API only), with Extended Mark's own Monarch tokenizer (`src/language.ts`: code above `@@@`, Markdown below it, a source with no `@@@` read as prose) and the playground's colours in a light and a dark theme (`src/themes.ts`). The compiler's diagnostics are Monaco markers, and their messages the squiggles' tooltips. A widget that fails while the page is drawn is marked too, on the call that placed it, with its notice's message: the page has no source, so the playground walks the notice's site through the IR's templates to the call, and the compile says where each call is written (`Built.sites`, beside the IR; `src/failures.ts`). <kbd>Tab</kbd> inserts four spaces (<kbd>Shift</kbd>+<kbd>Tab</kbd> outdents), brackets and quotes close themselves and typing the closing one steps over it, <kbd>Ctrl</kbd>/<kbd>Cmd</kbd>+<kbd>S</kbd> compiles now, <kbd>Ctrl</kbd>+<kbd>F</kbd> finds. Otherwise the page compiles 300 ms after you stop typing.
- **Compiler**: `src/compiler.worker.ts` loads `xtmd.wasm` as the page opens, compiling core once then, and builds every version in turn. A pack a page imports (`graphs`) is given to it as its files' text, from `/api/examples`. If the compiler can't be loaded, or stops on a page, the status says so and the browser reports it to the server, which logs it and tells the team (below).
- **Page**: drawn by `@extended-mark/dom` from `@extended-mark/runtime`. `$state` is kept across recompiles for every field that still exists with the same type. While the source has errors, the last page that compiled stays, greyed and marked stale.
- **Markdown**: `page.markdown()`, redrawn after every change; "As compiled" shows `xtmd md`'s, with the starting values: the Markdown of a page just started from the IR.
- **Diagnostics**: each with its line, column and code. Click one to put the caret there.
- **$state**: the live values. Change one to write it as an app would (`page.set`); a refused write shows the rule it broke. **Reset** goes back to the starting values.

## Run it

It needs Node 20 or later and `xtmd.wasm`.

```sh
# the compiler as WebAssembly, once: Rust's wasm32-wasip1 target and zig (targets/rust/wasm/build.sh)
targets/rust/wasm/build.sh

# the packages it uses, once
(cd targets/ts/runtime && npm ci && npm run build)
(cd targets/ts/dom && npm ci && npm run build)
(cd targets/ts/wasm && npm install && npm run build)
(cd targets/ts/bindings/embed && npm install && npm run build)       # the Targets page's two targets
(cd targets/ts/bindings/live && npm install && npm run build)
(cd targets/ts/bindings/embed-live && npm install && npm run build)

# the playground
cd apps/playground
npm install
npm run build        # bundles src/ into dist/, with xtmd.wasm (the server also does it at startup when dist/ is missing)
                     # node build.mjs --dev: readable, with source maps
npm start            # http://localhost:8080
```

`?example=slider` in the URL opens an example directly.

**`/targets`** (linked from the top bar) draws one page with the plain web's two kinds of target side
by side: run time, @extended-mark/embed's `XtmdDoc`, from an IR `build.mjs` builds ahead with xtmd.wasm
(`dist/targets-counter.ir.json`); and real time, @extended-mark/embed-live's `XtmdLiveDoc`, from the text in a
box, compiled in the browser as it changes. It shows `$state` under each, and a snapshot taken and
restored. The video's take is `devbench/takes/targets.py`.

The bundle, in `dist/`: `app.js` (the playground, @extended-mark/runtime, @extended-mark/dom and Monaco's editor API: about 3.1 MB, 0.8 MB gzipped), `app.css` (with Monaco's), Monaco's codicon font, `editor.worker.js`, Monaco's web worker, built as an entry of its own and found through `MonacoEnvironment.getWorkerUrl`, `compiler.worker.js` and `xtmd.wasm` (about 3.2 MB, 1 MB gzipped), and the Targets page's `targets.js` and `targets-counter.ir.json`. The server serves every file there with an ETag and a gzip it keeps; the font, whose name has a hash, is cached for good.

For tests and takes, `window.playground` reads the editor without touching it: `source()`, `caret()`, `markers()`, `failures()` (the marks of widgets that failed), `tokens(line)`, `language()`, `visibleLines()`, `hasFocus()`, `compiles()` (how many builds were asked for), and `select(text)`, which only moves the selection.

## Environment

| Variable | What it does |
|---|---|
| `PORT` | The port to listen on, on all interfaces (`0.0.0.0`). Default `8080`. |
| `DEVBENCH_NOTIFY_URL` | DevBench's base URL. With the token, a failure (the server's, or one a browser reports) posts an alert to `<url>/api/notify/`. |
| `DEVBENCH_NOTIFY_TOKEN` | The workspace's production notification token (DevBench → workspace settings → Production notifications). A server-side secret: never put it in the bundle. |
| `HOST` | The interface to listen on. Default `0.0.0.0`. |

## The API

| Request | Answer |
|---|---|
| `GET /api/examples` | `{examples: [{id, title, description, packs, source}], packs, packFiles}`, from `examples/index.json`; `packFiles` holds each pack's files as the compiler is given them: `{graphs: [{path: "graphs/graphs.xtmdpack", text}]}`. |
| `POST /api/report` `{kind, message, bytes?, agent?}` | `202`: a failure in the reader's browser (`compiler-load`, `compiler-crash`), logged and told to the team. A body over 16 KB is refused (413). |
| `GET /healthz` | `200 {ok: true}`, or `503` when `dist/` has no `app.js`, `compiler.worker.js` or `xtmd.wasm`. |

Nothing is compiled on the server: `/api/compile` is gone.

## Monitoring

Every failure is logged to stderr. Two kinds also post an alert to DevBench, when both `DEVBENCH_NOTIFY_*` variables are set: an unexpected exception in the server, and a failure a reader's browser reports through `/api/report`. The compiler runs in the browser, so when `xtmd.wasm` can't be loaded, or stops on a page (a panic), the page tells the server:

```json
{"text": "**Extended Mark playground: compiler-crash** in a reader's browser\n- the compiler stopped on page.xtmd: panicked at … | …\n- report 3f2a9c1e on host, page 1027 B, Mozilla/5.0 …", "level": "error", "source": "xtmd-playground"}
```

Alerts of one kind are sent at most once every five minutes, with a count of the ones held back. A diagnostic in the reader's page is not a failure and never alerts.

## Tests

```sh
npm test            # node --test test/*.test.mjs
npm run typecheck   # tsc over src/
```

- `test/server.test.mjs`: the server (healthz, the examples with the packs' files, the page, the bundle's files with their types, `xtmd.wasm` as `application/wasm`, gzip and ETags and nothing outside `dist/`, `/api/compile` gone), the browser's reports with a fake notify endpoint (an alert once per kind, bad reports refused, the token never logged), healthz failing without `xtmd.wasm`, `server.mjs` run as a program; and every example compiled and run with the `xtmd.wasm` the page uses, errors with their lines and columns, and a pack given as its files.
- `test/browser.test.mjs`: the UI in Chromium through `playwright-core`, typing as a person does (a click, <kbd>Control</kbd>+<kbd>End</kbd>, keys): it loads, the editor colours `$state` and a heading with their tokens and colours, typing redraws the page, a press in the page updates the Markdown and `$state`, `$state` survives a recompile (and a value that no longer fits goes back to its default), an error lists its diagnostics and leaves the last page stale, clicking a diagnostic moves Monaco's caret there and reveals it, a mistake's markers appear and clear when it is taken out, a widget that fails while drawn is marked on its call until it draws, a `$state` write refused by a rule, a list edited as JSON, the graphs pack, the narrow layout, starting again, Tab and Ctrl+S, and a source with no `@@@` read as prose, a compile that sends nothing to the server, and a compiler that can't be loaded (the status says so, and `/api/report` is told). Chromium is `XTMD_CHROMIUM` or `/usr/bin/chromium`; no browser is downloaded. Skipped when `@extended-mark/dom` is not built, or there is no Chromium or `xtmd.wasm`.

## Docker

The image builds `xtmd.wasm` (Rust's wasm32-wasip1 target, with zig from pip for decNumber's C), the packages and the bundle, and runs `node apps/playground/server.mjs` on port 8080. Build it from the repository root:

```sh
docker build -f apps/playground/Dockerfile -t xtmd-playground .
docker run --rm -p 8080:8080 \
  -e DEVBENCH_NOTIFY_URL=https://devbench.example.com \
  -e DEVBENCH_NOTIFY_TOKEN=… \
  xtmd-playground
```
