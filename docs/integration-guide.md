# Adding MKP to a project

This guide is for a developer, or an agent, putting MKP into their own app: a React web app, a
React Native app, a server in any language, or a stack MKP has no renderer for. It assumes you
have read the first page of `README.md` and know what a document (`name.mkp.md`) and a pack are.
For writing documents, read `docs/authoring-guide.md`; this guide is about the host side.

What MKP gives you, in one line: a compiler that turns a document plus your packs into a JSON
**bundle** (the IR), a runtime that turns a bundle into a tree of base widgets with state, and
renderers that draw that tree. The same build can also write plain Markdown.

Every command and snippet below was run against this repo. Outputs are real and trimmed.

## Choose your path

| Your app | Steps |
|---|---|
| React on the web | 1, 2, 3, 4.1, 6, 7, 8 |
| React on the web, with your own component library | the above, plus 4.2 |
| Vue, Svelte, Solid, Angular, Astro or no framework | 1, 2, 3, then `mkp-dom.js` from [the recipes](recipes.md), 6, 8 |
| React Native | 1 (with 1.4), 2 (build time), 3, 4.3, 6, 7, 8 |
| A server in Python, Go, Ruby… that stores or serves documents | 1.5, 2.2, 3, then draw on a client with 4.1 or 4.3 |
| A client MKP has no renderer for (Swift, Kotlin, Flutter, a game engine…) | 1.5, 2.2, 3, 4.4, 8 |
| Only Markdown (a static site, search, email, an LLM's context) | 1.5, 2.2, 4.5 |

If you add widgets of your own, do step 5. If your app talks to widgets (sends them data, hears
from them), do step 6.

## The parts

| Package | What it is | Needs |
|---|---|---|
| `@mkp/core` | Compiler, type checker, runtime, maths engine, Markdown writer. No DOM. | Any JS engine: browsers, Node, Hermes |
| `@mkp/react` | The web renderer: `MkpDocument`, `MkpProvider`, the base set as React DOM components | React 19, react-dom 19 |
| `@mkp/shadcn` | A model provider: the whole base set drawn with shadcn-style components you pass in | `@mkp/react`, `lucide-react` |
| `@mkp/react-native` | The React Native renderer | React 19, React Native ≥ 0.78, react-native-svg 15; Skia optional |
| `@mkp/cli` | `mkp`: check, build, index, show, schema, fmt, pack, cases | Node, or nothing (the single executable) |

A release (step 1.0) carries `@mkp/core` as `mkp.js` + `mkp.d.ts`, `@mkp/react` as `mkp-react.js` +
`mkp-react.d.ts`, and `@mkp/cli` as `mkp-cli.mjs`. The snippets below import `@mkp/*`, the names
inside this repo; in your app, import the vendored files (`./vendor/mkp/mkp.js`), or alias
`@mkp/core` and `@mkp/react` to them. `@mkp/shadcn` and `@mkp/react-native` are used from source
(step 1.0a) until a release carries them.

---

## Step 1. Get MKP into the project

### 1.0 Vendor a release (recommended)

Every merge to MKP's `main` is a release `v<version>` with `mkp-web-<version>.zip` (the web files),
`mkp-cli.mjs` (the CLI) and `SHA256SUMS`. Nothing to install, no registry, no token. Put the web files
in one folder of your app; they import each other:

```sh
v=0.1.0; base=https://github.com/mmujtabamain/markdown-markup/releases/download/v$v
curl -LO $base/mkp-web-$v.zip && mkdir -p src/vendor/mkp && unzip -j mkp-web-$v.zip -d src/vendor/mkp
curl -LO $base/mkp-cli.mjs    # node mkp-cli.mjs check …, build …, --target html …
```

| File | Use it for |
|---|---|
| `mkp.js` + `mkp.d.ts` | compile and run documents, write their Markdown; `mkp.d.ts` is the whole API's types in one file, which TypeScript reads beside `mkp.js` |
| `maths-engine.js` | nothing directly: `mkp.js` loads it when a document shows maths |
| `mkp-react.js` + `mkp-react.d.ts` | drawing in React 19 (any React framework, Next.js included): `<MkpDocument>` with MKP's own look, or `components=` for your design system (4.1, 4.2). It imports React from your app |

```tsx
import { compile, Runtime } from './vendor/mkp/mkp.js';
import { MkpDocument } from './vendor/mkp/mkp-react.js';
```

The same files are served at `https://mmujtabamain.github.io/markdown-markup/v/<version>/` (and
`/latest/`) for a page that imports them by URL. `mkp.js` needs no framework: a stack without React
draws `rt.view()` itself (4.4). The rest of step 1 is for working on MKP itself, or at a commit no
release has.

### 1.0a Or use a pinned commit, as source

This gives you a copy of MKP at a commit you choose, its dependencies installed, its CLI built,
and your bundler reading its packages as source.

### 1.1 Node

Use Node 22 or later; CI uses 24. The root `package.json` says `"engines": {"node": ">=20.19"}`,
and the CLI bundle targets Node 20. pnpm is the workspace's package manager
(`"packageManager": "pnpm@10.34.9"`); the script below falls back to `npx` if pnpm is missing.

### 1.2 Pin a commit

Keep the commit in a file, fetch that commit's tarball into a git-ignored folder, install its
workspace there, and build the CLI. Commit two files to your repo: `mkp.commit` (one line, the
full hash) and the script.

```txt
your-app/
  mkp.commit              # d2b9ee129b85407acdd67963fed478edba8ff882
  scripts/ensure-mkp.mjs
  mkp/                    # git-ignored: put there by the script
```

```js
#!/usr/bin/env node
// scripts/ensure-mkp.mjs: puts MKP at the commit named in mkp.commit into ./mkp (git-ignored),
// installs its workspace and builds its CLI (mkp/packages/cli/dist/mkp.cjs).
// To work on MKP and this app together, make ./mkp a symlink to an MKP checkout: it is left alone.
import { execFileSync, execSync } from 'node:child_process';
import { existsSync, lstatSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const TARBALL = 'https://codeload.github.com/mmujtabamain/markdown-markup/tar.gz/';
const root = resolve(fileURLToPath(new URL('..', import.meta.url)));
const mkp = join(root, 'mkp');
const commit = readFileSync(join(root, 'mkp.commit'), 'utf8').trim();
const stamp = join(mkp, '.commit');
const linked = existsSync(mkp) && lstatSync(mkp).isSymbolicLink();

if (!linked && !(existsSync(stamp) && readFileSync(stamp, 'utf8').trim() === commit)) {
  console.log(`Fetching MKP ${commit.slice(0, 7)}…`);
  const res = await fetch(TARBALL + commit);
  if (!res.ok) throw new Error(`MKP ${commit} could not be fetched: HTTP ${res.status}`);
  const tmp = mkdtempSync(join(tmpdir(), 'mkp-'));
  try {
    const tgz = join(tmp, 'mkp.tgz');
    writeFileSync(tgz, Buffer.from(await res.arrayBuffer()));
    rmSync(mkp, { recursive: true, force: true });
    mkdirSync(mkp);
    execFileSync('tar', ['-xzf', tgz, '-C', mkp, '--strip-components=1']);
    writeFileSync(stamp, `${commit}\n`);
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
}

if (!existsSync(join(mkp, 'node_modules'))) {
  // MKP is a pnpm workspace; its postinstall builds the maths engine (packages/core/vendor)
  let pnpm = 'pnpm';
  try {
    execSync('pnpm --version', { stdio: 'ignore' });
  } catch {
    pnpm = `npx -y ${JSON.parse(readFileSync(join(mkp, 'package.json'), 'utf8')).packageManager}`;
  }
  execSync(`${pnpm} install --frozen-lockfile`, { cwd: mkp, stdio: 'inherit' });
}

const cli = join(mkp, 'packages/cli/dist/mkp.cjs');
if (!existsSync(cli)) execFileSync(process.execPath, [join(mkp, 'packages/cli/scripts/build.mjs')], { cwd: join(mkp, 'packages/cli'), stdio: 'inherit' });
```

Run it once, then on every install (a `postinstall` script) and in CI before anything reads MKP:

```txt
$ node scripts/ensure-mkp.mjs
Fetching MKP d2b9ee1…
…
. postinstall: maths engine built in 530 ms (2.74 MB)
Done in 6.2s using pnpm v10.34.9
dist/mkp.cjs: 4.59 MB in 782 ms
```

```json
{
  "scripts": {
    "postinstall": "node scripts/ensure-mkp.mjs",
    "mkp": "node mkp/packages/cli/dist/mkp.cjs"
  }
}
```

Add `mkp/` to `.gitignore`, and keep it out of your own linters' and type checker's `include`.

Things to know:

- The install covers the whole workspace (the playground and the React Native test tooling too),
  about 740 packages. It is a one-off per commit.
- `packages/core/vendor/` (the maths engine) is made by the workspace's `postinstall`. Aliasing to
  the source without installing gives a missing `vendor/maths-engine.js`.
- A mirror works the same: change `TARBALL` to any URL that serves a tarball of the commit with one
  top folder.

### 1.3 Alias `@mkp/*` on the web (Vite, TypeScript, Vitest)

Point each package name at its source file, and make MKP's renderer share your app's single copy
of React (otherwise `mkp/node_modules` supplies a second one and hooks fail).

```ts
// vite.config.ts
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { realpathSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

// real path: ./mkp may be a symlink to an MKP checkout
const mkp = realpathSync(fileURLToPath(new URL('./mkp/', import.meta.url))) + '/';

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      '@mkp/core': `${mkp}packages/core/src/index.ts`,
      '@mkp/react': `${mkp}packages/react/src/index.tsx`,
      // '@mkp/shadcn': `${mkp}packages/shadcn/src/index.tsx`,   // if you use it (4.2)
    },
    // MKP's renderer must use the app's one React, not the copy in mkp/node_modules
    dedupe: ['react', 'react-dom'],
  },
  server: { fs: { allow: ['.', mkp] } },
  build: { target: 'es2022' },
});
```

```jsonc
// tsconfig.json (compilerOptions)
{
  "moduleResolution": "Bundler",
  "jsx": "react-jsx",
  "resolveJsonModule": true,
  "paths": {
    "@mkp/core": ["./mkp/packages/core/src/index.ts"],
    "@mkp/react": ["./mkp/packages/react/src/index.tsx"]
  }
}
```

Alias to the files, not the folders, as above: the packages are TypeScript source, and an alias to
the exact entry file works whatever your resolver makes of a `main` field.

Vitest reads the same `resolve` block when it uses this Vite config. React tests need
`// @vitest-environment jsdom`.

The MKP sources import their own dependencies (mdast, micromark, yaml, MathJax…), which resolve
from `mkp/node_modules` because the files live there. You don't add them to your app.

Checked: a Vite 7 app with this config type-checks with `tsc`, builds, and draws a document in
Chromium with no console errors. Without `dedupe` the bundle carries a second copy of React.

Other bundlers (webpack, esbuild, Rollup) need the same three things: the aliases, TypeScript and
JSX compiled for files under `mkp/`, and one React. That is not tested here.

### 1.4 Alias `@mkp/*` in React Native (Metro)

```js
// metro.config.js
// MKP's packages are TypeScript source in ./mkp (put there by scripts/ensure-mkp.mjs).
const fs = require('node:fs');
const path = require('node:path');
const { getDefaultConfig, mergeConfig } = require('@react-native/metro-config');

const mkp = fs.realpathSync(path.join(__dirname, 'mkp'));
const alias = {
  '@mkp/core': path.join(mkp, 'packages/core/src/index.ts'),
  '@mkp/react-native': path.join(mkp, 'packages/react-native/src/index.tsx'),
};
// one React, React Native and SVG (and the Babel helpers the transform adds): the app's, never the copies in mkp/node_modules
const single = new Set(['react', 'react-native', 'react-native-svg', '@babel/runtime']);
const fromApp = path.join(__dirname, 'index.js');

module.exports = mergeConfig(getDefaultConfig(__dirname), {
  watchFolders: [mkp],
  resolver: {
    resolveRequest(context, name, platform) {
      if (alias[name]) return { type: 'sourceFile', filePath: alias[name] };
      const top = name.startsWith('@') ? name.split('/').slice(0, 2).join('/') : name.split('/')[0];
      if (single.has(top)) return context.resolveRequest({ ...context, originModulePath: fromApp }, name, platform);
      return context.resolveRequest(context, name, platform);
    },
  },
});
```

Your app's own dependencies must include `react`, `react-native`, `react-native-svg` and
`@babel/runtime` (the React Native template has them). `@shopify/react-native-skia` is optional:
with it, `gfx@1` pixel layers draw; without it, they draw their fallback.

Checked: Metro 0.87 with `@react-native/metro-config` 0.88 bundles an app that imports
`@mkp/react-native` for Android, with one React. Without `@babel/runtime` in `single`, Metro fails
to resolve `@babel/runtime/helpers/interopRequireDefault` from MKP's files. Not run on a device here.

### 1.5 The CLI, for any stack

A release's `mkp-cli.mjs` is the whole CLI in one file (the core, the maths engine and
`--target html`'s page script inside), run with Node 20.19+ from anywhere:

```txt
$ node mkp-cli.mjs --version
0.1.0
$ node mkp-cli.mjs check lesson.mkp.md --pack lib --format json
```

From source, after step 1.2, the same CLI is `mkp/packages/cli/dist/mkp.cjs`.

---

## Step 2. Lay out documents and packs; compile them

This step decides where content lives and turns each document into a bundle your renderer draws.

### 2.1 Where things live

MKP doesn't impose a layout. One that works:

```txt
your-app/
  content/                 # documents
    lab.mkp.md
    lab.mkp                # optional: lab.mkp.md's own definitions, moved out of its fences
  packs/
    myapp/                 # your pack (step 5)
      manifest.mkp
      readings.mkp
      readings.fixture.json
  mkp.lock                 # committed: pins your packs' versions and digests
  src/generated/           # build output (git-ignored), or wherever your app reads it from
```

A pack is a folder (as above) or a `.mkpack` zip made from one (step 5). A document sees core's
base set, its own definitions, and the packs you pass with `--pack`.

### 2.2 At build time, with the CLI

`mkp check` is the author's loop; `mkp build` writes what you ship.

```txt
$ mkp check content/lab.mkp.md --pack packs/myapp
ok
$ mkp build content --pack packs/myapp --target ir --out src/generated --lock mkp.lock
wrote src/generated/lab.ir.json
$ mkp build content/lab.mkp.md --pack packs/myapp --target md
<!-- generated by mkp from content/lab.mkp.md (sha256:240d0a4c…) -->

# Lab

The readings below come from the sensor.

*The room's temperature readings, newest last.*

Room temperature: 0 readings
```

(`mkp` here is `node mkp/packages/cli/dist/mkp.cjs`, or the single executable.)

`mkp build` takes:

| Flag | What it does |
|---|---|
| `<files or folders…>` | documents; a folder means every `*.mkp.md` under it |
| `-` and `--name file.mkp.md` | read one document from stdin, named for its messages |
| `--pack <folder or .mkpack>` | a pack; repeat for several |
| `--target ir` (default), `ir-expanded`, `md` | the bundle, the bundle with every use inlined (`inst`), or Markdown; several (`ir,md`) need `--out` |
| `--out <dir>` | write `<stem>.ir.json`, `<stem>.expanded.json`, `<stem>.md` there; without it, stdout |
| `--md gfm,math,mermaid,html,images` | Markdown features the reader supports (4.5) |
| `--no-answers` | Markdown with answers left out |
| `--lock <file>`, `--relock`, `--no-lock` | the lock (2.3) |
| `--profile <name>` | check front matter and sections against a profile pack (5.6) |
| `--diagnostics json` | each diagnostic on stderr as one line of JSON (step 3) |
| `--compact` | IR without indentation |
| `--no-maths`, `--no-speech` | skip typesetting, or the spoken form of maths |

Exit codes: `0` built, `1` the document or a pack has errors (diagnostics on stderr), `2` a usage
error or a crash (`mkp: no such file or folder: nope.mkp.md`).

`--out` names files by the document's file name only, so `a/intro.mkp.md` and `b/intro.mkp.md`
overwrite each other. Build folders with distinct names, or call `mkp build` once per output folder.

From a server in another language, run the CLI on stdin and read stdout and stderr. In Python:

```python
import json, subprocess

MKP = ["node", "mkp/packages/cli/dist/mkp.cjs"]  # or the single executable: ["mkp/packages/cli/dist/mkp"]

def compile_document(text: str, name: str, packs: list[str]) -> tuple[dict | None, list[dict]]:
    args = [*MKP, "build", "-", "--name", name, "--target", "ir", "--compact", "--diagnostics", "json", "--no-lock"]
    for p in packs:
        args += ["--pack", p]
    r = subprocess.run(args, input=text, capture_output=True, text=True, timeout=120)
    diagnostics = [json.loads(line) for line in r.stderr.splitlines() if line.startswith("{")]
    if r.returncode == 2:
        raise RuntimeError(r.stderr.strip())  # a usage error or a crash, not the document's fault
    return (json.loads(r.stdout) if r.returncode == 0 else None), diagnostics
```

Each call starts a process and checks the packs again (about a second here, with maths). For many
documents, pass a folder and `--out` in one call.

### 2.3 The lock

A build that uses packs writes a lock: each pack's version and digest, and each definition's
digest. The next build refuses a definition that changed under the same version:

```txt
examples/29-a-pack/pack/distance.mkp:1:1 error mkp.version-changed: units:distance@1 has changed since mkp.lock
recorded it; found a definition that differs from the locked one, and a locked version must keep its
behaviour. Undo the change, or give it a new version (distance@2); while the pack is unpublished,
add unpublished to its manifest or rebuild with --relock
```

- Pass `--lock mkp.lock` and commit the file. Without `--lock`, the CLI uses the nearest
  `mkp.lock` at or above the first document's folder (stopping at the folder with `.git`), or
  writes a new one beside the first document.
- `--relock` records the packs as they are now. `--no-lock` checks against the lock but doesn't
  write it: use `--lock mkp.lock --no-lock` on a server or in CI.
- While a pack is still changing, put `unpublished` in its manifest.

### 2.4 At runtime, with `compile()`

Compile in the app when documents are written or edited there (an editor, a preview, user
content), or when you'd rather not run a build step. `@mkp/core` runs in browsers, Node and
Hermes.

```ts
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { compile, Diagnostics, MathsEngine, prerender, type Diagnostic, type IRBundle, type PackSource } from '@mkp/core';

/** A pack folder as MKP reads it: every file, keyed by its path inside the pack. */
function packFolder(dir: string): PackSource {
  const files = new Map<string, Uint8Array>();
  const walk = (d: string): void => {
    for (const n of readdirSync(d)) {
      const p = join(d, n);
      if (statSync(p).isDirectory()) walk(p);
      else files.set(relative(dir, p).split('\\').join('/'), new Uint8Array(readFileSync(p)));
    }
  };
  walk(dir);
  return { label: dir, files };
}

/** A .mkpack file: the zip `mkp pack` writes. */
const packFile = (path: string): PackSource => ({ label: path, zip: new Uint8Array(readFileSync(path)) });

let compiled: ReturnType<typeof compile> | null = null;
let maths: MathsEngine | null = null;

async function compileDocument(text: string, file: string): Promise<{ bundle: IRBundle | null; diagnostics: Diagnostic[] }> {
  // compile() checks the packs; keep the result and reuse it for every document
  compiled ??= compile({ packs: [packFolder('packs/myapp')] });
  maths ??= await MathsEngine.create({ speech: true });
  const d = new Diagnostics();
  const bundle = compiled.document(text, file, d);
  if (bundle) prerender(bundle, maths, d); // static maths to SVG + speech, and every formula checked
  const diagnostics = [...compiled.diags.items, ...d.items];
  const ok = compiled.diags.ok && d.ok;
  return { bundle: ok ? bundle : null, diagnostics };
}
```

In a browser, build the `files` map from whatever you have (fetched text, an upload); the keys are
paths inside the pack (`manifest.mkp`, `readings.mkp`). `compile()` reports pack problems in
`compiled.diags`; `document()` reports into the `Diagnostics` you pass and returns `null` when the
document has errors.

Other options: `compile({ packs, lock, profile, capabilities })`, where `lock` is a parsed
`mkp.lock` and `capabilities` defaults to `['core@1', 'gfx@1']`. `document(text, file, diags,
{ docFile: { text, file } })` gives a document its `name.mkp` file.

`MathsEngine.create()` loads a 2.7 MB engine on first use (a separate chunk on the web). Build-time
bundles already carry their static maths, so a page that only draws them doesn't need it (4.1).

### 2.5 What the bundle is

One self-contained JSON: the document, every definition it uses, their functions, types and
tokens, and what a host can talk to. Trimmed from `lab.ir.json` (29 KB):

```json
{
 "ir": 1,
 "level": "bundle",
 "doc": {
  "file": "content/lab.mkp.md",
  "front": {},
  "body": [
   { "node": "heading", "def": "core:heading@1" },
   { "node": "paragraph", "def": "core:paragraph@1" },
   { "node": "readings", "def": "myapp:readings@1",
     "meta": { "summary": "The room's temperature readings, newest last.", "block": 0 } }
  ]
 },
 "defs": ["myapp:readings@1", "core:text@1", "core:press@1", "core:column@1", "…", "$doc:document@1"],
 "capabilities": ["core@1"],
 "interface": { "commands": ["push", "clear"], "hosts": ["unit"], "signals": ["picked"], "implements": [] },
 "tokens": ["core:core@1", "myapp:brand@1"],
 "lock": { "packs": ["core@1", "myapp@1"] }
}
```

(`defs` is an object keyed by id, and `interface` entries carry types; shown here as names.)

- `meta.block` is the widget block's index, which the runtime API uses (step 6). `meta.anchor` is
  its `#id` if the fence has one (```` ```readings #sensor ````).
- Nodes and definitions carry `pos` (source line and column). `stripPos(bundle)` removes them
  before you ship it.
- `mkp schema ir/bundle` prints the bundle's JSON Schema, for validating it in any language. Also
  `ir/definition`, `ir/node`, `ir/expr`, `ir/tokens` and `fixture`.

Store the bundle next to the document, or rebuild it on demand. Make a new bundle object only when
the document changes: the renderers make a new runtime (and reset reader state) when the bundle
object changes.

---

## Step 3. Show errors to authors

This step gets the compiler's messages in front of whoever wrote the document, in your editor or
review screen.

With `mkp check --format json` or `mkp build --diagnostics json`, each diagnostic is one line of
JSON on stderr:

```txt
$ mkp check examples/limits/02-misspelt-prop.mkp.md --format json
{"severity":"error","code":"mkp.unknown-prop","message":"text has no prop \"wieght\" (did you mean \"weight\"?); found wieght=bold. Its props are value, font, tone, weight, size, align, wrap, lines, clip, literal, caps; remove wieght=… or use one of those","file":"examples/limits/02-misspelt-prop.mkp.md","line":9,"col":40,"path":["note@1","text"]}
$ mkp check examples/limits/01-yaml-item-type.mkp.md --format json
{"severity":"error","code":"mkp.input-type","message":"xs[1] takes a number; found \"four\". Replace it, e.g. with 1","file":"examples/limits/01-yaml-item-type.mkp.md","line":17,"col":5,"path":["document@1"]}
```

| Field | Meaning |
|---|---|
| `severity` | `error` (the document doesn't build) or `warning` |
| `code` | a stable rule name, `mkp.<rule>` (the authoring guide lists the common ones) |
| `message` | what is wrong, what was found, and how to fix it |
| `file`, `line`, `col` | 1-based; `file` is the name you passed (`--name` for stdin) |
| `path` | optional: the definition and element it is in |

In TypeScript, a `Diagnostic` from `@mkp/core` has the same fields, with the position in `pos`:

```ts
const asJson = (x: Diagnostic) => ({ severity: x.severity, code: x.code, message: x.message, file: x.pos?.file, line: x.pos?.line, col: x.pos?.col, ...(x.path ? { path: x.path } : {}) });
```

`formatDiagnostic(d)` gives the text form (`file:line:col error code: message`).

Show `message` as it is: it already names the fix, so don't map codes to your own wording. Put it
at `line`/`col` in an editor (the playground uses CodeMirror's lint gutter). An agent that writes
documents runs `mkp check --format json` until it prints nothing.

Errors at run time (an evaluation over its budget, a missing key) don't stop the document: the
failing block is drawn as an error box with its summary and the message, the rest keeps working,
and the runtime sends the reserved `error` signal `{code, message, path}` (step 6). Pass
`onWarn` to `Runtime` options to log warnings (a dropped signal, a host value of the wrong type).

---

## Step 4. Draw it

### 4.1 React on the web

This gives you a drawn, interactive document.

```tsx
import { MkpDocument, type TokenMap } from '@mkp/react';
import type { IRBundle, MathsRenderer } from '@mkp/core';
import lab from './generated/lab.ir.json';

const tokens: TokenMap = {
  color: {
    accent: { value: '#0f766e', dark: '#5eead4' },
    surface: { value: 'var(--app-bg, #ffffff)', dark: 'var(--app-bg, #0b0b0c)' },
  },
  radius: { card: { value: 12 } },
  space: { m: { value: 10 } },
};

function Lesson({ bundle, maths }: { bundle: IRBundle; maths?: MathsRenderer }) {
  return <MkpDocument bundle={bundle} theme="auto" tokens={tokens} maths={maths} className="lesson" options={{ onSignal: (e) => console.log(e.name, e.payload) }} />;
}

export const Page = () => <Lesson bundle={lab as unknown as IRBundle} />;
```

`MkpDocument` props:

| Prop | |
|---|---|
| `bundle` | the `IRBundle` |
| `theme` | `'light'`, `'dark'` or `'auto'` (the default: follows `prefers-color-scheme`) |
| `tokens` | your values for token names (step 7) |
| `components` | your own components for base widgets (4.2) |
| `maths` | a `MathsRenderer` (a `MathsEngine`), for maths that changes with reader state |
| `reducedMotion` | overrides `prefers-reduced-motion` (playing sliders then move in steps) |
| `options` | `RuntimeOptions`: `onSignal`, `onWarn`, `hosts`, `budgetCap`, `capabilities`, `answers`… |
| `runtime` | a `Runtime` you made, to drive it (step 6) |
| `className` | added to the root element (`.mkp-root`) |

What to know:

- **CSS.** `MkpDocument` writes its own `<style>`: the layout rules, the shell, the neutral look and
  your tokens as `--mkp-*` custom properties, all in `@layer mkp`. There is no stylesheet to
  import. Any unlayered rule of yours beats it; if you use cascade layers, place it in your order
  (`@layer base, mkp, components, utilities`). A few display rules are `!important` so a CSS reset
  (Tailwind's preflight) can't break the layout.
- **Maths.** Static maths is typeset at build (`mkp build`, or `prerender`). Maths with a live
  value in it (`$x^{\val{k}}$`) is typeset in the browser, and only if you pass `maths`. Load it
  only when the document needs it: `MathsEngine.create({ speech: true })` from `@mkp/core`.
- **Width.** Widgets read the reader's width (`narrow` under 600 px, `medium` under 1000, `wide`)
  from the root element.
- **Your own runtime.** If you pass `runtime`, the `maths`, `reducedMotion` and `options` props are
  not used: give them to `new Runtime(bundle, { … })` yourself, with
  `capabilities: ['core@1', 'gfx@1']` (what `MkpDocument` declares on the web).

To place top-level blocks in your own layout (sections, columns, a sidebar), use `MkpProvider` and
draw each node with `Node`:

```tsx
import { useRef } from 'react';
import { MkpProvider, Node, useMkpView, useMkpWidth } from '@mkp/react';

function Sections() {
  const nodes = useMkpView(); // one node per top-level body item, in order
  const root = useRef<HTMLDivElement>(null);
  useMkpWidth(root); // widgets read `width` from this element
  return (
    <div ref={root} className="mkp-root">
      {nodes.map((n) => (
        <section key={n.key}>
          <Node n={n} />
        </section>
      ))}
    </div>
  );
}

// <MkpProvider bundle={bundle} tokens={tokens}><Sections /></MkpProvider>
```

Your element must have the class `mkp-root` (the stylesheet is scoped to it). Set
`data-theme="dark"` or `"light"` on it yourself if you don't want it to follow the OS.

### 4.2 Your own design system

This makes MKP's widgets look like the rest of your app: your buttons, sliders, tabs, tables.

MKP's whole vocabulary is the **base set**: 25 widgets (`BASE_WIDGETS` in `@mkp/react`). Every
other widget, yours and your authors', is composed from them, so a provider that draws these 25
draws everything. A provider is an `MkpComponents` object: one `HostRoute` per base widget.

```ts
// from @mkp/react
interface HostProps {
  n: VNode;                          // the node: n.t (which widget), n.p (resolved props), n.kids, n.key
  attrs: Record<string, unknown>;    // data-mkp-* and hidden: spread on the outer element
  style: CSSProperties;              // the place its parent gives it: grow, basis, span, self
  dispatch: Runtime['dispatch'];     // report an event: dispatch(n.key, 'click' | 'change' | …, payload)
}
type HostRoute = (props: HostProps) => ReactNode;   // called as a plain function: hooks go in what it returns
type MkpComponents = Record<BaseWidget, HostRoute>;
```

Components are controlled: draw what `n.p` says and report what the reader does with `dispatch`.
State stays in the runtime. Spread `attrs` on the outer element, or arrows and hidden elements
break.

**The model is `@mkp/shadcn`.** `shadcnComponents(kit)` returns a full `MkpComponents` from a
`Kit` of shadcn's components (`Button`, `Slider`, `Tabs`, `Select`, `Dialog`, `Table`…) plus a few
in shadcn's style (`OptionRow`, `Callout`, `CodeBlock`, typography). `shadcnTokens` maps MKP's
colour tokens to shadcn's CSS variables. The playground is a full example; from
`apps/site/src/kit.ts` and its preview pane (trimmed):

```tsx
import { shadcnComponents, shadcnTokens, type Kit } from '@mkp/shadcn';
import { Button } from '@/components/ui/button';
// … one import per kit component

const kit: Kit = {
  Button, Toggle, Switch, Slider, Input, Textarea, Checkbox, Progress, Separator,
  Tabs, TabsList, TabsTrigger,
  // … the rest of Kit's fields
  OptionRow, Callout, CodeBlock, Paragraph, Heading, List, Quote, Footnote,
};

export const components = shadcnComponents(kit);

// <MkpDocument bundle={bundle} runtime={runtime} theme={theme} components={components} tokens={shadcnTokens} />
```

If your library is shadcn-like, write a `Kit`. If not, copy `packages/shadcn/src/index.tsx` and
change the components it calls. `@mkp/react` exports what it uses to stay faithful: `Box`, `Kids`,
`Runs`, `TextBlock`, `MathBlock`, `Canvas`, `Frame`, `Pane`, `Zoom`, `nodeAttrs`, `layoutStyle`,
`fieldKeys`, `fieldTone`, `hoverEvents`, `color`, `size` and others.

To replace only some widgets:

```tsx
import { Kids, MkpDocument, NEUTRAL_CSS, type HostRoute, type MkpComponents } from '@mkp/react';

const press: HostRoute = ({ n, attrs, style, dispatch }) => (
  <button {...attrs} type="button" className="app-button" style={style} aria-label={n.p.label ? String(n.p.label) : undefined} disabled={!!n.p.disabled} onClick={() => dispatch(n.key, 'click')}>
    <Kids nodes={n.kids} />
  </button>
);
// MkpComponents names all 25 base widgets; the renderer draws any you leave out with its own
const mine = { press } as Partial<MkpComponents> as MkpComponents;

function Themed({ bundle }: { bundle: IRBundle }) {
  return (
    <>
      {/* with components given, the neutral look is not loaded: add it back for the widgets you did not replace */}
      <style>{NEUTRAL_CSS}</style>
      <MkpDocument bundle={bundle} components={mine} />
    </>
  );
}
```

The cast is needed because the type asks for all 25. This `press` ignores `kind` (tab, toggle,
check, radio, switch…) and `selected`; a real one handles them, as `press()` in the shadcn
provider does.

Icons: `icon` takes a name from a fixed set (`ICON_NAMES` in `@mkp/core`); map each name to your
icon library, as the shadcn provider maps them to lucide.

To prove a provider draws everything, render every conformance case with it (step 8).

### 4.3 React Native

```tsx
import { MkpDocument, type TokenMap } from '@mkp/react-native';
import type { IRBundle } from '@mkp/core';

const tokens: TokenMap = { color: { accent: { value: '#0f766e', dark: '#5eead4' } } };

function Lesson({ bundle }: { bundle: IRBundle }) {
  return <MkpDocument bundle={bundle} theme="auto" tokens={tokens} style={{ padding: 16 }} options={{ onSignal: (e) => console.log(e.name, e.payload) }} />;
}
```

Props: `bundle`, `runtime`, `maths`, `theme` (`'auto'` follows `useColorScheme()`), `tokens`,
`reducedMotion` (default: the system's setting), `options`, `style`.

- Compile at build time and ship the IR: maths then arrives typeset. `MathsEngine` does run on
  Hermes, but typesetting there is slow (spoken maths takes about 134 ms a formula).
- Token values must be colours React Native understands (hex). CSS variables like
  `var(--primary)` don't work here.
- There is no `components` prop on React Native: you can't swap in your own components; theme
  it with tokens.
- `gfx@1` pixel layers need `@shopify/react-native-skia`; without it the renderer declares only
  `core@1` and draws their fallback.

### 4.4 A stack with no renderer

You have three choices, from least to most work.

1. **Run the TypeScript runtime and draw its view.** `@mkp/core` has no DOM. If your platform can
   run JavaScript (a JS engine embedded in a native app, a WebView, a server), run `new
   Runtime(bundle)` there, read `rt.view()` (a tree of `VNode`: `t` is the base widget, `p` its
   resolved props, `kids`, `slots`, `key`), draw each base widget natively, and send the reader's
   actions back with `rt.dispatch(key, event, payload)`. `rt.subscribe(f)` tells you when to draw
   again; while `rt.playing()`, call `rt.tick(ms)` each frame. The React renderers are the
   reference for what each base widget draws.
2. **Port the runtime.** `docs/runtime-spec.md` describes it for ports: values, evaluation, budgets,
   instances and state, rendering, events, the host interface and the error boundary. A port reads
   the bundle (`--target ir`) or the expanded bundle (`--target ir-expanded`, where each use
   already has its view inlined). The compiler stays in TypeScript: run the CLI at build time or
   on your server.
3. **Show the Markdown** (4.5) and skip interactivity.

A port proves itself with the conformance suite in `mkp/conformance/`. Each
`conformance/cases/<id>.json` holds a bundle, play steps, and the expected values and visible
nodes before and after them, plus the Markdown:

```json
{
 "id": "base.actions.1.bumped",
 "steps": [{ "press": "bump" }, { "press": "bump" }, { "press": "bump" }, { "press": "go" }, { "wait": 1000 }, { "press": "stop" }],
 "initial": {
  "values": { "doc/0#actions": { "total": 0, "log": "", "s": 0 }, "doc/0#actions/0/0#inner": { "count": 0 } },
  "visible": ["scope", "column", "scope", "press#bump", "text", "press#go", "…"]
 },
 "final": { "values": { "doc/0#actions": { "total": 0, "log": "big big ", "s": 5 }, "doc/0#actions/0/0#inner": { "count": 6 } } },
 "md": { "plain": "…", "all": "…" },
 "bundle": { "…": "…" }
}
```

A port passes when, for every case listed in `conformance/index.json`, values agree within a
relative 1e-9 (absolute 1e-12 near zero), the visible nodes are the same in order, and the
Markdown agrees. The reference implementation runs it with:

```txt
$ pnpm conformance
conformance (node v24.22.2): 47/47 cases agree, compiled from source and replayed
```

and `pnpm hermes` runs the same cases under the Hermes CLI.

### 4.5 The Markdown target

Every document builds to Markdown a reader without MKP can read: each widget writes its
`project md`, with its `summary` above it in italics.

```txt
$ mkp build examples/31-markdown-output/doc.mkp.md --target md --md gfm,math
$ mkp build examples/31-markdown-output/doc.mkp.md --target md --md gfm,math --no-answers
```

The second leaves answers out; the difference between them is only:

```diff
< **Answer:**
<
< Cove to Harbour, 4.1 km.
```

Use `--no-answers` for search indexes, previews, notifications and anything a learner sees
before answering. `--md` says what the target reads: `gfm` (tables, task lists), `math` (`$…$`
kept as TeX), `mermaid` (`project mermaid` diagrams), `html` (`<details>` and the like),
`images` (canvases written as SVG files; they are written only with `--out`).

At run time: `writeMarkdown(bundle, { toggles: ['gfm', 'math'], answers: false, maths })` returns
`{ md, files }`.

### 4.6 A page with no app: `--target html`

To share a document with someone who has no app — a link, an attachment, a static site, a demo — build it as a page:

```txt
$ mkp build lesson.mkp.md --pack lib --target html,html-md --out site
```

- `site/lesson.html` is **one file that opens offline in any browser**, from `file://` too, and shows only the document. Inside it: the bundle, the page script (`@mkp/page`: `@mkp/react`'s neutral renderer, the runtime and the maths engine, about 3.4 MB), and the pictures beside the document as `data:` URLs. It follows the reader's light or dark setting; `#theme=dark` or `#theme=light` in the URL overrides it. With scripts off, or if the renderer can't start, it shows the document's Markdown, drawn as HTML, which is in the page too.
- `site/lesson.md.html` is that Markdown alone, drawn the way a plain GitHub-style renderer would (GFM, alerts, footnotes, maths as SVG), with no script. `--md` and `--no-answers` apply to both, as they do to `--target md`.

The page is MKP's own neutral look. To draw documents in your design system, use 4.1–4.2 instead.

---

## Step 5. Your own widgets: a pack

This step gives your authors widgets that only your app has, versioned and tested. MKP ships no
widgets beyond the base set; everything your app adds goes in a pack.

### 5.1 The manifest

```txt
# packs/myapp/manifest.mkp
pack myapp@1 "The widgets and interfaces this app gives its documents."
  requires core@1
  provides scored readings brand
  unpublished
```

- `pack name@N`: the pack and its version. `core` is taken.
- `requires core@1`: the base set it builds on.
- `depends other@N`: another pack whose names it uses (a pack sees no other pack's names without
  it; `mkp.unknown-widget` says so).
- `provides …`: what documents may use: widgets, interfaces, token sets, types.
- `unpublished`: still changing, so the lock allows edits under the same version. Remove it when
  documents in the wild depend on it, and from then on change a widget by adding `name@2`.

### 5.2 Definitions

Widgets go in `.mkp` files, one or more per file, with a version on each name. This one has the
host members of step 6:

```txt
# packs/myapp/readings.mkp
readings@1 "Readings the app streams in, newest last, with a button to mark one."
  in title text = "Readings" "what is measured"
  host unit text = "°C" "the unit the app measures in"
  var points list({t: num, v: num}) = []
  command push {t: num, v: num} "add one reading"
    set points=last(points + [{t: t, v: v}], 5)
  command clear "start over"
    set points=[]
  signal picked {v: num} "the reader marked the latest reading"
  n = len(points)
  column gap=s pad=m stroke=brand radius=card
    text title weight=bold
    text "\val{n} readings" tone=muted
    each p in points key=p.t
      text "\val{format(p.v, 1)} \val{unit}" font=mono
    press id=mark label="mark the latest" if=(n > 0)
      text "Mark"
      @click send picked v=(last(points).v)
  project md = title + ": " + format(n, 0) + " readings"
```

The language is in `docs/authoring-guide.md`. `part name` makes a definition only other
definitions can use. Packs may also hold png, jpg, webp, svg (sanitised) and woff2 assets; 25 MB
per pack, 10 MB per file.

### 5.3 Fixtures

Every definition needs at least one valid case in `name.fixture.json`, or `mkp check` refuses the
pack. Cases with `expect.errors` must fail with those codes.

```json
{
  "widget": "readings@1",
  "cases": {
    "titled": { "props": { "title": "Room temperature" }, "summary": "An empty list of temperature readings." },
    "two-readings": {
      "props": { "title": "Room temperature" },
      "summary": "Two readings the app pushed, in kelvin.",
      "hosts": { "unit": "K" },
      "play": [{ "command": "push", "args": { "t": 1, "v": 293.1 } }, { "command": "push", "args": { "t": 2, "v": 293.4 } }],
      "expect": { "values": { "n": 2 } }
    },
    "title-is-text": { "props": { "title": ["not", "text"] }, "expect": { "errors": ["mkp.input-type"] } }
  }
}
```

Play steps are `press` (an element id), `set` (state by name), `open` (an overlay id), `command`
with `args`, and `wait` (ms). `mkp schema fixture` prints the file's schema.

`mkp check --pack` compiles every case and checks `expect.errors`. It does **not** run `play` or
compare `expect.values`, `expect.md` or `expect.visible`; step 8 shows a test that does.

### 5.4 Tokens and interfaces in a pack

```txt
# packs/myapp/brand.mkp
tokens brand@1 "The app's own colours."
  color brand "#7c3aed" dark="#c4b5fd"
```

A token set adds names authors can use in style props (`stroke=brand`, `tint=brand`); colours are
hex, with an optional `dark=`. Step 7 covers overriding core's.

```txt
# packs/myapp/scored.mkp
interface scored@1 "A widget whose score the app adds up."
  in of int
  signal scored {got: int}
  project md
```

An interface is what one of your features relies on. Any widget, in your pack or in a document,
that says `implements scored@1` must have those inputs, host inputs, signals and `project md`
with the same types (`mkp.interface` names what is missing). Your app then finds blocks by the
interface, never by widget name (6.4). `examples/30-interface` is a full example: a pack with only
an interface (`host/`) and a document with two widgets that implement it.

### 5.5 The commands

````txt
$ mkp check --pack packs/myapp
26 definitions, 3 fixture cases: ok
$ mkp index --pack packs/myapp
readings@1(title: text = "Readings") — Readings the app streams in, newest last, with a button to mark one.
$ mkp show distance --pack examples/29-a-pack/pack
widget distance@1 (pack units)
A distance in kilometres, with its miles beside it.
inputs:
  km: num (required)  — the distance in kilometres
  label: text = ""  — what the distance is
projections: md

example (fixture marathon):
```units:distance@1
km: 42.195
label: A marathon
summary: A marathon's distance.
```
$ mkp show distance --pack examples/29-a-pack/pack --source --as my-distance
# from units:distance@1 sha256:86d3efb6…

my-distance "A distance in kilometres, with its miles beside it."
  in km num "the distance in kilometres"
  …
$ mkp pack packs/myapp -o myapp.mkpack
myapp.mkpack (5 files, 1528 bytes)
$ mkp cases --pack packs/myapp --out gallery
2 cases of 1 definitions in gallery
````

- `check` counts core's 25 base widgets in its definitions.
- `index` is the catalog: one line a widget. Give it to an agent that writes documents.
- `show --source --as` prints a copy to paste into a document and edit.
- `schema <widget>` prints the JSON Schema of its YAML inputs (for a form editor).
- `pack` zips the manifest, `.mkp` files, fixtures and assets into a `.mkpack`; `--pack` takes
  either form.
- `cases` writes each valid case's bundle (`<pack>.<widget>.cases.json`: `[{case, summary,
  bundle}]`) with maths typeset, for a gallery page in your app.
- `fmt <files> --pack … [--write]` prints the canonical form.

### 5.6 Profiles (optional)

A profile is a pack whose manifest says `profile name@N`. It types the front matter and adds
rules on sections, for an app whose documents all follow one shape:

```txt
# packs/article-profile/manifest.mkp
profile article@1 "What every article in this app must have."
  requires core@1
  front title text
  front audience choice(beginner|expert) = beginner
  roles introduction example summary
  rule required front.title "every article has a title"
  rule max-length front.title 60 "titles fit on one line"
  rule count roles.example 1..3 "one to three worked examples"
```

```txt
$ mkp check content/article.mkp.md --pack packs/article-profile --profile article
content/article.mkp.md:1:1 error mkp.rule.count: one to three worked examples (profile rule: count roles.example 1..3); found 0. Add 1 more section with {role=example}: a heading, then {role=example} on the line under it
```

A heading takes its role on the line under it: `{role=example}`. Rules: `required`, `one-of`,
`pattern`, `max-length`, `count`, `depth`, `first`.

---

## Step 6. Wire the host

This step lets your app talk to widgets in a document: send them data and commands, and hear
when the reader does something.

### 6.1 What a definition declares

| Member | Direction | Example |
|---|---|---|
| `host name type = default` | app → widget, a value | `host unit text = "°C"` |
| `command name {fields}` with actions under it | app → widget, an action | `command push {t: num, v: num}` |
| `signal name {fields}` and `send name f=expr` | widget → app | `signal picked {v: num}` |

Only declared commands and host inputs are accepted, and their values are type-checked. The
bundle lists them in `interface`.

### 6.2 The runtime API

```ts
import { Runtime, type SignalEvent } from '@mkp/core';

const seen: SignalEvent[] = [];
const rt = new Runtime(bundle, {
  hosts: { '0': { unit: 'K' } }, // host inputs per block index, at mount
  onSignal: (e) => seen.push(e), // every signal from every block
  onWarn: (code, message) => console.warn(code, message),
});
rt.view();
const sensor = rt.widget(0); // the first widget block
sensor.command('push', { t: 1, v: 293.1 });
sensor.command('push', { t: 2, v: 293.4 });
sensor.host('unit', '°C'); // later, at any time
const off = sensor.on('picked', (payload) => console.log('picked', payload));
sensor.state(); // {"unit":"°C","points":[{"t":1,"v":293.1},{"t":2,"v":293.4}],"n":2}
```

When the reader presses Mark, `onSignal` gets:

```json
{"document":"content/lab.mkp.md","block":0,"widget":"readings@1","name":"picked","payload":{"v":293.4},"time":1793902523250}
```

- `rt.widget(block)` returns a `WidgetHandle` with `command(name, args?)`, `host(name, value)`,
  `on(signal, f)` (returns an unsubscribe) and `state()`. Call `rt.view()` (or render) first:
  before the first render there are no instances and `widget()` throws.
- A bad command or value throws with the fix in the message: `readings@1 has no command nope;
  found the commands push, clear. Send one of those`, or `the arguments of command push of
  readings@1 have the wrong shape (t: expected a number, found "x"). Send them as {t: num, v: num}`.
- A signal from a widget nested inside a block arrives with the top-level block's index and the
  inner widget's name in `widget`.
- Limits: at most 30 signals a second (more are dropped with a warning), payloads up to 16 KB,
  host input values up to 64 KB.
- The reserved `error` signal `{code, message, path}` arrives once when a block's error boundary
  trips (step 3).

### 6.3 In React

Make the runtime yourself and pass it in; effects run after the first render, so the instance
exists:

```tsx
import { useEffect, useMemo } from 'react';
import { Runtime, type IRBundle } from '@mkp/core';
import { MkpDocument } from '@mkp/react';

function LiveSensor({ bundle, reading }: { bundle: IRBundle; reading?: { t: number; v: number } }) {
  const rt = useMemo(() => new Runtime(bundle, { capabilities: ['core@1', 'gfx@1'], hosts: { '0': { unit: 'K' } } }), [bundle]);
  // effects run after MkpDocument has drawn the view, so the block's instance exists
  useEffect(() => {
    if (reading) rt.widget(0).command('push', reading);
  }, [rt, reading]);
  return <MkpDocument bundle={bundle} runtime={rt} />;
}
```

If you only need to listen, `options={{ onSignal }}` on `MkpDocument` is enough.

### 6.4 Finding blocks by interface

Your feature looks for an interface, not a widget name. Each top-level block's `meta` says which
interfaces its widget implements, and which are implemented by widgets inside it:

```ts
import type { IRNode } from '@mkp/core';

const IFACE = 'scoreboard:scored@1';
const blocks = bundle.doc.body.filter((n: IRNode) => n.meta?.block !== undefined);
const scored = blocks.filter((n) => n.meta?.implements?.includes(IFACE)); // the block itself implements it
const holding = blocks.filter((n) => n.meta?.within?.includes(IFACE)); // something inside it does
```

On `examples/30-interface` this finds block 0 (`stars`) in `scored` and block 1 (`survey`, which
holds a `stars` and a `thumbs`) in `holding`. `bundle.interface.implements` lists every
`{def, iface}` pair. Interface ids are `pack:name@N`.

### 6.5 Saving reader state

There is no save and restore API. A reader's state lives in the runtime and starts over when the
page reloads (or the bundle object changes). What you can do:

- Have widgets `send` a signal when something worth keeping happens, store it in your app, and
  give it back as a `host` input next time. This is the supported route.
- Read `rt.widget(i).state()` and later put values back with `rt.set`:

```ts
const saved = rt.widget(1).state(); // { n: … } plus derived values
const rt2 = new Runtime(bundle);
rt2.view();
const w = rt2.widget(1);
rt2.set({ n: 4 }, w.inst); // only state cells (var, controls) can be set
```

`state()` includes derived values and host inputs, which `set` can't take, and `set` is the
fixture's play step rather than a promised API. Treat this as a workaround that may change.

---

## Step 7. Theming

This step makes documents match your app's colours, type and spacing, in light and dark.

### 7.1 The token names

Style props in documents take token names only, never raw values. Every provider supplies these
(`REQUIRED_TOKENS` in `@mkp/core`); core's own set gives defaults for all of them:

| Kind | Names | Core's light default (dark) |
|---|---|---|
| `color` | `surface ink muted line accent info ok warn bad`, `c1`–`c6` (categorical) | `accent` `#2563eb` (`#7aa7ff`), `surface` `#ffffff` (`#15171a`)… |
| `font` | `body heading mono` | `body` `system-ui, sans-serif` size 16, weight 400, line 1.5 |
| `space` | `xs s m l xl` | 2, 4, 8, 16, 32 px |
| `size` | `s m l` | 160, 320, 480 px |
| `radius` | `card` (and `pill`) | 8, 999 |
| `shadow` | `raised` | y 1, blur 3, `#0000001f` |

The full table is `tokens core@1` at the end of `packages/core/src/base.ts`.

### 7.2 Where values come from

In order, later wins: core's set, token sets in packs (`tokens brand@1`, 5.4), then the `tokens`
prop of the renderer. A pack token set may also add new names (`brand`), which authors can then
use; the renderer's `tokens` prop only changes values.

```ts
import type { TokenMap } from '@mkp/react';   // kind → name → { value, dark?, …props }

const tokens: TokenMap = {
  color: { accent: { value: '#0f766e', dark: '#5eead4' } },
  font: { body: { value: 'Inter, sans-serif', size: 16, weight: 400, line: 1.5 } },
  space: { m: { value: 10 } },
  radius: { card: { value: 12 } },
};
```

On the web each token becomes a custom property on `.mkp-root`: `--mkp-color-accent`,
`--mkp-space-m`, `--mkp-font-body-size` and so on. Numbers are pixels.

### 7.3 Light and dark

- A colour's `dark` value is used under `prefers-color-scheme: dark` (unless the root has
  `data-theme="light"`) and whenever the root has `data-theme="dark"`. `theme="dark"` or
  `"light"` on `MkpDocument` sets that attribute.
- If your app switches dark mode with its own class or setting rather than the OS, pass `theme`
  from that setting, or point both values at your own CSS variables so your stylesheet decides.
  `shadcnTokens` does the second: `{ value: 'var(--primary, #171717)', dark: 'var(--primary, #171717)' }`.
- On React Native, `theme="auto"` follows `useColorScheme()`, and values must be hex.

---

## Step 8. Keep it working

This step makes a broken document, pack or provider fail CI rather than reach a reader.

### 8.1 In CI

```sh
node scripts/ensure-mkp.mjs
MKP="node mkp/packages/cli/dist/mkp.cjs"
$MKP check --pack packs/myapp                                   # every definition has a valid case; failing cases fail as expected
$MKP check content --pack packs/myapp --format json             # every document, with maths checked
$MKP build content --pack packs/myapp --out build/mkp --target ir,md --lock mkp.lock --no-lock   # against the committed lock
```

Each exits non-zero on an error. `mkp check <folder>` checks every `*.mkp.md` under it.

`mkp check` doesn't run fixture play steps (5.3). This Vitest test does, for every case of your
packs, and checks `expect.values`:

```ts
import { describe, expect, it } from 'vitest';
import { compile, compileCase, fixtureCases, Runtime } from '@mkp/core';
// packFolder: as in 2.4

describe('pack fixtures', () => {
  it('plays every case and gets the values it expects', () => {
    const c = compile({ packs: [packFolder('packs/myapp')] });
    for (const fc of fixtureCases(c)) {
      if (fc.expect?.errors?.length) continue;
      const r = compileCase(c, fc);
      expect(r.ok, `${fc.widget} ${fc.name}`).toBe(true);
      const rt = new Runtime(r.bundle!, { hosts: fc.hosts ? { '0': fc.hosts } : undefined, now: () => 0 });
      rt.view(); // instances exist once the view has been drawn
      for (const s of fc.play ?? []) {
        if (s.press) rt.press(s.press);
        if (s.set) rt.set(s.set);
        if (s.open) rt.open(s.open);
        if (s.command) rt.widget(0).command(s.command, s.args);
        if (s.wait) rt.tick(s.wait);
      }
      for (const [k, v] of Object.entries(fc.expect?.values ?? {})) expect(rt.widget(0).state()[k], `${fc.name}: ${k}`).toEqual(v);
    }
  });
});
```

If you wrote your own components (4.2), render every conformance case with them. This is the
check that matters for a provider: the runtime is MKP's, so what can break is your drawing.

```tsx
// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';
import { cleanup, render } from '@testing-library/react';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { IRBundle } from '@mkp/core';
import { MkpDocument } from '@mkp/react';
import { components } from '../src/mkp-components'; // your MkpComponents

describe('my components draw every conformance case', () => {
  const dir = 'mkp/conformance/cases';
  for (const f of readdirSync(dir).filter((x) => x.endsWith('.json'))) {
    it(f, () => {
      const { bundle } = JSON.parse(readFileSync(join(dir, f), 'utf8')) as { bundle: IRBundle };
      const { container } = render(<MkpDocument bundle={bundle} components={components} reducedMotion />);
      expect(container.querySelector('.mkp-error')).toBeNull();
      cleanup();
    });
  }
});
```

Add your own assertions on top, as `packages/shadcn/test/provider.test.tsx` does: that no neutral
control is left (`.mkp-press`, `.mkp-range`, `.mkp-field`, `.mkp-meter`), and that each of your
controls drives the runtime. If your components measure themselves (Radix's Slider does), jsdom
needs a `ResizeObserver` stub.

A port of the runtime (4.4) runs every `conformance/cases/*.json` in its own language.

### 8.2 Moving the pin

1. Read the new commits' changes in `SPEC-NOTES.md` and `GAPS.md`.
2. Put the new hash in `mkp.commit` and run `node scripts/ensure-mkp.mjs` (it replaces `mkp/`).
3. Run step 8.1. The lock guards your packs, not MKP itself: a changed core definition does not
   fail the lock check, so the tests are what catch a change in behaviour. Rebuild once without
   `--no-lock` so `mkp.lock` records the new core digests, and commit it.
4. If you have your own components, check the new commit's `BASE_WIDGETS` and props against them:
   the conformance render test catches a base widget you don't draw.
5. Rebuild stored bundles: an old bundle may not match the new runtime.

To work on MKP and your app together, replace `mkp/` with a symlink to an MKP checkout; the
script leaves a symlink alone.

---

## Known gaps

Things you will hit, as of this commit:

- **A release carries the core, the React renderer and the CLI only.** The shadcn provider and the
  React Native renderer are used from source (step 1.0a). `mkp-react.js` needs React 19.
- **`rt.widget('#id')` doesn't work.** The message says a block can be found by its `#anchor`, but
  only the index works (the same for `hosts` keys). Look the index up:
  `bundle.doc.body.find((n) => n.meta?.anchor === 'sensor')?.meta?.block`.
- **`rt.widget()` before the first render throws**, saying there are no widget blocks. Call
  `rt.view()` first.
- **`WidgetHandle.on` chains `onSignal`.** Unsubscribing restores the handler that was there
  before it, so unsubscribing out of order drops a later listener. Prefer one `onSignal` in the
  options and route by `block` and `name`.
- **No saving and restoring reader state** (6.5).
- **`mkp check --pack` doesn't run fixture play steps** or compare expected values, Markdown or
  visible nodes (8.1 has a test that does values).
- **Partial `components`**: the type asks for all 25 base widgets, and passing any drops the
  neutral stylesheet (4.2).
- **React Native has no `components` prop**, so its look comes from tokens only.
- **`mkp build --out` names outputs by file name only**, so documents with one name in different
  folders overwrite each other.
- **`--md images` writes its SVG files only with `--out`.**
- Open items from building a real widget library are in `GAPS.md` 175 and 176 (for example, a `ref`
  input can't be optional; `mkp check --pack` doesn't type-check a pack function nothing calls;
  any gfx use makes the whole widget require `gfx@1`).

## Checklist

- [ ] Node 22+ where MKP builds; `mkp.commit` and `scripts/ensure-mkp.mjs` committed; `mkp/` ignored.
- [ ] `@mkp/*` aliased to the source files in the bundler, TypeScript and the test runner; one
      React (`dedupe` in Vite, `resolveRequest` in Metro, with `@babel/runtime`).
- [ ] Documents and packs in known folders; `mkp.lock` committed; builds pass `--lock`.
- [ ] Documents compiled at build (`mkp build`) or at run time (`compile()` + `prerender`), with
      positions stripped before shipping if size matters.
- [ ] Diagnostics shown to authors as they are, at their line and column; runtime warnings logged.
- [ ] Renderer in place: `MkpDocument` (web or React Native), your own `components`, a port, or
      the Markdown target.
- [ ] `maths` passed if documents have live maths; reduced motion respected.
- [ ] Your widgets in a pack with a manifest, a fixture case per definition, and `unpublished`
      until they are stable.
- [ ] Host features find blocks by interface, call only declared commands and host inputs, and
      handle the `error` signal.
- [ ] Tokens give your colours, fonts and spacing, with `dark` values or variables your theme
      controls.
- [ ] CI runs `mkp check` on packs and documents, the fixture play test, and (for a provider) the
      conformance render test.
- [ ] Markdown built with `--no-answers` wherever a reader shouldn't see answers.
