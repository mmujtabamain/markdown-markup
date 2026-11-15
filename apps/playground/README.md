# MKP playground

Edit an MKP page on the left and see it drawn on the right, with its Markdown, its diagnostics and its `$state` under it, all live. Press a button in the page and the Markdown and `$state` follow; change a value in `$state` and the page follows, unless one of `$state`'s rules refuses the write.

- **Source**: a plain textarea with line numbers, colours and the compiler's underlines. <kbd>Tab</kbd> indents by four spaces (<kbd>Shift</kbd>+<kbd>Tab</kbd> outdents), <kbd>Ctrl</kbd>/<kbd>Cmd</kbd>+<kbd>S</kbd> compiles now. Otherwise the page compiles 300 ms after you stop typing.
- **Page**: drawn by `@mkp/dom` from `@mkp/runtime`. `$state` is kept across recompiles for every field that still exists with the same type. While the source has errors, the last page that compiled stays, greyed and marked stale.
- **Markdown**: `page.markdown()`, redrawn after every change; "As compiled" shows `mkp md`'s, with the starting values.
- **Diagnostics**: each with its line, column and code. Click one to put the caret there.
- **$state**: the live values. Change one to write it as an app would (`page.set`); a refused write shows the rule it broke. **Reset** goes back to the starting values.

## Run it

It needs Node 20 or later and the `mkp` binary.

```sh
# the compiler, once
(cd targets/rust && cargo build --release -p mkp-cli)

# the packages it uses, once
(cd targets/ts/runtime && npm ci && npm run build)
(cd targets/ts/dom && npm ci && npm run build)

# the playground
cd apps/playground
npm install
npm run build        # bundles src/ into dist/ (the server also does it at startup when dist/ is missing)
npm start            # http://localhost:8080
```

`?example=slider` in the URL opens an example directly.

## Environment

| Variable | What it does |
|---|---|
| `MKP_BINARY` | The `mkp` binary. Left out, the repo's `targets/rust/target/release/mkp`, else its debug build. |
| `PORT` | The port to listen on, on all interfaces (`0.0.0.0`). Default `8080`. |
| `DEVBENCH_NOTIFY_URL` | DevBench's base URL. With the token, a server failure posts an alert to `<url>/api/notify/`. |
| `DEVBENCH_NOTIFY_TOKEN` | The workspace's production notification token (DevBench → workspace settings → Production notifications). A server-side secret: never put it in the bundle. |
| `MKP_TIMEOUT_MS` | How long one run of the binary may take before it is killed. Default `10000`. |
| `HOST` | The interface to listen on. Default `0.0.0.0`. |

## The API

| Request | Answer |
|---|---|
| `POST /api/compile` `{source, packs?}` | `{diagnostics: [{line, col, severity, code, message, end?}], ir \| null, markdown \| null, ms}`. Runs `mkp check --json`, `mkp build` and `mkp md` at once in a temp dir of its own, which is always removed. A source over 200 KB is refused (413); `packs` names packs the server knows (`graphs`). |
| `GET /api/examples` | `{examples: [{id, title, description, packs, source}], packs}`, from `examples/index.json`. |
| `GET /healthz` | `200 {ok: true}`, or `503` when the binary is missing. |

## Monitoring

Every compile is logged to stderr with its time and its error and warning counts, and every failure path is logged too. A **server failure** (the binary crashed, timed out or printed nonsense, or an unexpected exception) also posts an alert to DevBench, when both `DEVBENCH_NOTIFY_*` variables are set:

```json
{"text": "**MKP playground: compile failed** (timeout)\n- mkp build timed out after 10000 ms and was killed\n- request 3f2a9c1e on host, source 1027 B", "level": "error", "source": "mkp-playground"}
```

Alerts of one kind are sent at most once every five minutes, with a count of the ones held back. A diagnostic in the reader's page is not a failure and never alerts.

## Tests

```sh
npm test            # node --test test/*.test.mjs
npm run typecheck   # tsc over src/
```

- `test/server.test.mjs`: the API with the real compiler (a page that compiles, every example, errors with their lines and columns, packs, the size limit, bad requests, gzip, temp dirs removed), and the alerts with a fake notify endpoint: a broken binary (`/bin/false`), one that hangs past the time limit, one that panics, the same failure twice (one alert), no alert without the settings, and `server.mjs` run as a program with its environment variables.
- `test/browser.test.mjs`: the UI in Chromium through `playwright-core`: it loads, typing redraws the page, a press in the page updates the Markdown and `$state`, `$state` survives a recompile (and a value that no longer fits goes back to its default), an error lists its diagnostics and leaves the last page stale, clicking a diagnostic moves the caret, a `$state` write refused by a rule, a list edited as JSON, the graphs pack, and the narrow layout. Chromium is `MKP_CHROMIUM` or `/usr/bin/chromium`; no browser is downloaded. Skipped when `@mkp/dom` is not built, or there is no Chromium or `mkp` binary.

## Docker

The image builds the compiler, the packages and the bundle, and runs `node apps/playground/server.mjs` on port 8080. Build it from the repository root:

```sh
docker build -f apps/playground/Dockerfile -t mkp-playground .
docker run --rm -p 8080:8080 \
  -e DEVBENCH_NOTIFY_URL=https://devbench.example.com \
  -e DEVBENCH_NOTIFY_TOKEN=… \
  mkp-playground
```
