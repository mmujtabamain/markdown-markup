# @mkp/cli

The mkp compiler for build tools. Every call runs the native `mkp` binary: there is one compiler
(targets/rust), and nothing here turns source into IR itself.

```js
import { build, check, md, format } from "@mkp/cli";

const page = await build("sprint.mkp.md", { packs: ["./packs/maps"] }); // { ir: … }, lowered
const diagnostics = await check("sprint.mkp.md");                       // [] when it compiles
const markdown = await md("sprint.mkp.md");                              // with its starting values
```

With Vite, `import page from "./sprint.mkp.md"` gives the page's IR:

```js
// vite.config.js
import mkp from "@mkp/cli/vite";
export default { plugins: [mkp({ packs: ["./packs/maps"] })] };
```

`npx mkp check|fmt|build|md|surface|migrate …` runs the binary with the same arguments: `npx mkp build doc.mkp.md --rir` writes its resolved IR for tools, `npx mkp surface packs/kit` writes a released version's surface, and `npx mkp migrate docs/` brings documents up to the versions of the packs they are built with (it asks first in a terminal; `--yes` writes elsewhere and answers its numbered questions, `--yes 1,3` only those; `--dry-run` only looks; `--todo` writes what it can't finish with a TODO, `--allow-errors` writes a file that doesn't compile; `--format json` prints a JSON object for each file, note and question, and `--report run.md` or `run.json` writes the whole run). In 0.3.0, a document written for MKP 0.2 is moved too, by 0.2.10's own compiler and the migrator, run with Node (tools/migrate-0.2/frozen); `--pack` takes its 0.2 packs beside the 0.3 ones. An `mkp.toml` beside the tree says what it is written for, `mkp = "0.3.0"` and `[uses]` with each pack's version, and `mkp migrate` moves both with it.

## The binary

`@mkp/cli` finds it, in order: `MKP_BINARY`; the package for this platform,
`@mkp/cli-<os>-<cpu>`, an optional dependency; inside this repository, `targets/rust/target`'s
release or debug build. Each platform package is built on its platform:

```sh
cd targets/rust && cargo build --release -p mkp-cli
cd ../ts/cli && npm run binary   # copies it to platforms/<os>-<cpu>/bin
```

`npm test` runs the JS API against the binary and builds `test/vite-app` with Vite.
