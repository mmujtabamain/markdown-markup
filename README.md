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
| `apps/playground` | Write a document and see it drawn, its Markdown, that Markdown drawn, its IR and its errors, at phone or desktop width. |
| `examples/` | 31 documents in reading order, each one idea, and `examples/limits` — 15 that fail on purpose. Each has its Markdown committed as `doc.md`. |
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
mkp index --pack lib                               # the catalog
mkp show walk --pack lib [--source --as my-walk]   # a signature, or a copy to edit
```

Read `docs/authoring-guide.md`, then the examples in order.
