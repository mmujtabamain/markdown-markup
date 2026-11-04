# Markdown Markup (MKP)

A superset of Markdown for documents with reusable, interactive widgets: documents (`name.mkp.md`)
use widgets; definitions (`name.mkp`) build them from a small base set in a line-based language;
packs (`name.mkpack`) carry them; one build compiles everything to a JSON IR that apps render with
their own design system, or to Markdown. No HTML, JavaScript, CSS or shaders in content.

This is the implementation of the spec v0.2 draft: one TypeScript codebase.

| Part | What it is |
|---|---|
| `packages/core` | The compiler, type checker, evaluator, maths engine (MathJax SVG + speech), Markdown writer, printers, expander, schemas and runtime. No DOM: it runs in browsers, Node and Hermes. |
| `packages/react` | The web renderer: the base set as React DOM components. |
| `packages/react-native` | The React Native renderer. |
| `packages/shadcn` | A provider's definition of the whole base set, drawn with the shadcn-style components it passes in. |
| `packages/cli` | `mkp`: build, check, index, show, schema, fmt, pack — also as one executable. |
| `apps/playground` | Every fixture case and document, live, with its IR and Markdown beside it, on shadcn/ui. Hosted at <https://mmujtabamain.github.io/markdown-markup/>, rebuilt on every commit. |
| `packs/` | The derived packs: mkp-ui, mkp-charts, mkp-diagrams, mkp-math, mkp-learn, mkp-data, mkp-cs. |
| `examples/spec18` | The spec's worked examples (18.1, 18.5 and the brand from 7). |
| `conformance/` | Golden cases any provider or port runs. |
| `docs/` | The authoring guide for agents and the written runtime spec. |
| `SPEC-NOTES.md` | Every place the implementation reads, extends or departs from the spec. |
| `GAPS.md` | What building a real provider turned up, fixed or still open. |

## Use

```sh
pnpm install                     # Node 22+ (CI uses 24); builds the maths engine
pnpm test                        # every Vitest suite
pnpm conformance                 # golden cases on Node (pnpm conformance --generate to refresh)
pnpm hermes                      # the same suite under the Hermes CLI
pnpm test:rn                     # the React Native renderer
pnpm --filter @mkp/playground dev   # the playground at http://localhost:5181
pnpm --filter @mkp/cli sea       # packages/cli/dist/mkp, a single executable
```

```sh
mkp build doc.mkp.md --pack packs/mkp-ui --pack packs/mkp-math --target md --md gfm,math
mkp index --pack packs/mkp-ui      # the catalog
mkp show tabs --pack packs/mkp-ui
```

Screenshots of playground cases: `pnpm --filter @mkp/playground shot -- mkp-math/orbit@1/square`.
