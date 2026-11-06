# Markdown Markup (MKP)

A superset of Markdown for documents with interactive widgets. A document (`name.mkp.md`) is
Markdown with widget blocks; MKP itself provides only a small **base set** (the Markdown blocks,
four containers, a few controls, the host's shells and a canvas), and every other widget is
**composed** from it: in the document itself (an ```` ```mkp ```` fence), in a file beside it
(`name.mkp`), or in a pack (`name.mkpack`) a host loads. One build compiles a document to a JSON IR
that apps draw with their own design system, or to Markdown for readers without it. No HTML,
JavaScript, CSS or shaders in content.

| Part | What it is |
|---|---|
| `packages/core` | The compiler, type checker, evaluator, maths engine (MathJax SVG + speech), Markdown writer, printers, expander, schemas and runtime. No DOM: it runs in browsers, Node and Hermes. The base set is `src/base.ts`. |
| `packages/react` | The web renderer: the base set as React DOM components. |
| `packages/react-native` | The React Native renderer. |
| `packages/shadcn` | A provider's definition of the whole base set, drawn with the shadcn-style components it passes in. |
| `packages/cli` | `mkp`: build, check, index, show, schema, fmt, pack — also as one executable. |
| `packages/page` | A document as one standalone HTML page (`mkp build --target html`: `@mkp/react`'s neutral renderer, the runtime and the maths engine inlined, with the Markdown inside for readers with scripts off), and its Markdown drawn as HTML (`--target html-md`). The playground's Markdown preview is this one too. |
| `apps/playground` | Write a document and see it drawn, its Markdown, that Markdown drawn, its IR and its errors, at phone or desktop width. |
| `examples/` | 31 documents in reading order, each one idea, and `examples/limits`: 14 that fail on purpose. Each has its Markdown committed as `doc.md`. |
| `widgets/` | The playground's component pages: `base/`, each of the 25 base widgets on its own in its states, and `derived/`, everyday widgets (a card, tabs, an accordion, a stepper…) composed from them. |
| `conformance/` | Golden cases any provider or port runs: a test-only pack that uses every extern and prop (`conformance/packs/base`), and every example. |
| `docs/` | The authoring guide for agents and the written runtime spec. |
| `SPEC-NOTES.md` | Every place the implementation reads, extends or departs from the spec. |
| `GAPS.md` | What building a real provider turned up, fixed or still open. |

MKP ships no widgets of its own: a host brings its own library as a pack, and declares the
interfaces its features look for. MKP names no host anywhere (`pnpm check:neutral`).

## A first document

<!-- example 05-counter -->
````markdown
# A counter

```mkp
counter "A number the reader steps up or down."
  in start int = 0 "where it begins"
  var n int = start
  row gap=m align=center
    press label="one less"
      icon name=minus
      @click set n=(n - 1)
    text "\val{n}" font=mono size=large weight=bold
    press label="one more"
      icon name=plus
      @click set n=(n + 1)
  project md = "Count: " + format(n, 0)
```

```counter
start: 3
summary: A counter that starts at 3.
```
````

## Use

```sh
pnpm install                     # Node 22+ (CI uses 24); builds the maths engine
pnpm test                        # every Vitest suite, the examples and limits among them
pnpm conformance                 # compile every case again and replay it (--generate [filter] to refresh)
pnpm hermes                      # the same cases under the Hermes CLI
pnpm test:rn                     # the React Native renderer
pnpm examples:coverage           # every extern, control, action, event and feature in an example
pnpm examples:sync               # the guide's copies of the examples are the examples
pnpm check:neutral               # no host's name in MKP
pnpm --filter @mkp/playground dev   # the playground at http://localhost:5181
pnpm --filter @mkp/cli sea       # packages/cli/dist/mkp, a single executable
```

```sh
mkp check lesson.mkp.md --pack lib --format json   # errors, one a line, at the exact line and column
mkp build lesson.mkp.md --pack lib --target md --md gfm,math [--no-answers]
mkp build lesson.mkp.md --pack lib --target html,html-md --out site   # site/lesson.html: one offline page; lesson.md.html: its Markdown
mkp index --pack lib                               # the catalog
mkp show walk --pack lib [--source --as my-walk]   # a signature, or a copy to edit
```

Read `docs/authoring-guide.md`, then the examples in order. To put MKP into an app (web, React Native,
any other stack, or Markdown only), follow `docs/integration-guide.md`.

## Install

Each merge to `main` is a release (`v` + `VERSION`; its notes are `notes/<version>.md`). A release
has three files, no npm and no token:

| File | What it is |
|---|---|
| `mkp-web-<version>.zip` | The web files, which import each other: keep them in one folder. `mkp.js` (the core) with `mkp.d.ts` (its types, one self-contained header), `maths-engine.js` (loaded by `mkp.js` when maths shows), `mkp-react.js` (draws documents with your React 19: MKP's own look, or your components) with `mkp-react.d.ts`. |
| `mkp-cli.mjs` | The CLI, in one file: `node mkp-cli.mjs check / build / …`. Node 20.19+. |
| `SHA256SUMS` | Their checksums. |

```sh
v=0.1.0; base=https://github.com/mmujtabamain/markdown-markup/releases/download/v$v
curl -LO $base/mkp-cli.mjs && node mkp-cli.mjs build lesson.mkp.md --target html --out out
curl -LO $base/mkp-web-$v.zip && mkdir -p vendor/mkp && unzip -j mkp-web-$v.zip -d vendor/mkp
```

```ts
import { compile, Runtime } from './vendor/mkp/mkp.js';
import { MkpDocument } from './vendor/mkp/mkp-react.js';
```

The web files are also served, unpacked, at `https://mmujtabamain.github.io/markdown-markup/v/<version>/`
(and `/latest/`). `pnpm dist` builds the same files into `dist/`. To release: raise `VERSION` and add
`notes/<version>.md` in the merge request (`pnpm check:notes` checks both); the merge publishes it.
