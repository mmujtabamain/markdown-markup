# xtmd

The xtmd compiler for build tools. Every call runs the native `xtmd` binary: there is one compiler
(targets/rust), and nothing here turns source into IR itself. On a platform with no binary,
`build` and `check` run the same compiler built as WebAssembly (@extended-mark/wasm), so they work wherever
Node does.

```js
import { build, check, md, format } from "xtmd";

const page = await build("sprint.xt.md", { packs: ["./packs/maps"] }); // { ir: … }, lowered
const diagnostics = await check("sprint.xt.md");                       // [] when it compiles
const markdown = await md("sprint.xt.md");                              // with its starting values
```

With Vite, `import page from "./sprint.xt.md"` gives the page's IR:

```js
// vite.config.js
import xtmd from "xtmd/vite";
export default { plugins: [xtmd({ packs: ["./packs/maps"] })] };
```

`npx xtmd check|fmt|build|md|surface|migrate …` runs the binary with the same arguments: `npx xtmd build doc.xt.md --rir` writes its resolved IR for tools, `npx xtmd surface packs/kit` writes a released version's surface, and `npx xtmd migrate docs/` brings documents up to the versions of the packs they are built with (`fmt`, `surface` and `migrate` each take `--check` to fail if anything would change, `--diff` to show the change and `--stdout` to print one file's result, and write in place otherwise; migrate asks first in a terminal; `--yes` writes elsewhere, `--yes all` also answers every numbered question yes and `--yes 1,3` those only, while a bare `--yes` with questions open lists them and writes nothing; `--dry-run` only looks; `--allow-todos` writes what it can't finish with a TODO, `--allow-errors` writes a file that doesn't compile; `--format json` prints a JSON object for each file, note and question, and `--report run.md` or `run.json` writes the whole run). In 0.3.0, a document written for MKP 0.2 is moved too, by 0.2.10's own compiler and the migrator, run with Node (tools/migrate-0.2/frozen); `--pack` takes its 0.2 packs beside the 0.3 ones. An `xtmd.toml` beside the tree says what it is written for, `xtmd = "0.3.0"` and `[uses]` with each pack's version, and `xtmd migrate` moves both with it.

## The binary

`xtmd` finds it, in order: `XTMD_BINARY`; the package for this platform,
`@extended-mark/cli-<os>-<cpu>`, an optional dependency; inside this repository, `targets/rust/target`'s
release or debug build. With none of them, `build` and `check` compile with @extended-mark/wasm, which
gives the same IR and the same diagnostics; it reads no `xtmd.toml`, so a document whose packs'
versions one names needs the binary, and `md`, `format` and the `xtmd` command need it too.

There is a package for Linux on x64 and arm64, macOS on Intel and Apple silicon, and Windows on
x64. The release builds every one on Linux with cargo-zigbuild (.github/workflows/release.yml);
by hand:

```sh
cd targets/rust && cargo build --release -p xtmd-cli
cd ../ts/cli && npm run binary                  # this machine's, to platforms/<os>-<cpu>/bin
cd ../../rust && cargo zigbuild --release -p xtmd-cli --target aarch64-apple-darwin
cd ../ts/cli && npm run binary -- --target aarch64-apple-darwin   # to platforms/darwin-arm64/bin
```

`npm test` runs the JS API against the binary and builds `test/vite-app` with Vite.
