---
description: The mkp command line - check, build to pages, Markdown or IR, list and copy widgets, format, and pack.
---
# The CLI

The CLI is one file in every release, `mkp-cli.mjs`, for Node 20.19 or later. Below, `mkp` means
`node mkp-cli.mjs`.

```sh
node mkp-cli.mjs --version
node mkp-cli.mjs check lesson.mkp.md
```

Every command that reads widgets from a pack takes `--pack` (a folder or a `.mkpack`), as many
times as needed.

## check

```sh
mkp check lesson.mkp.md [more.mkp.md…] --pack lib [--format json]
mkp check --pack lib                  # the pack itself: every widget has a valid case
```

Each error says where it is, which rule it broke, what was found and how to fix it. `--format json`
writes one error a line. It exits non-zero when anything is wrong.

## build

```sh
mkp build lesson.mkp.md --pack lib --target html --out out
```

| `--target` | Writes | For |
| --- | --- | --- |
| `html` | `name.html` | One offline page that draws the document. |
| `html-md` | `name.md.html` | Its Markdown drawn as HTML, with no script. |
| `md` | `name.md` | The Markdown a reader without MKP gets. |
| `ir` | `name.ir.json` | The compiled bundle, for an app to draw. |
| `ir-expanded` | `name.expanded.json` | The bundle with every widget expanded to the base set. |
| `fragment` | `name.fragment.html` | The document's first paint, for the element `mount(el, bundle, { hydrate: true })` takes over. |

Several targets at once, comma-separated, need `--out`. More options:

- `--md gfm,math,mermaid,html,images` chooses what the Markdown may use (GitHub's flavour and maths
  by default).
- `--no-answers` leaves answers out, for what a reader sees before trying.
- `-` reads the document from standard input (named by `--name`).

## Widgets in a pack

```sh
mkp index --pack lib                              # every widget, one a line
mkp show walk --pack lib                          # its inputs and a valid example
mkp show walk --pack lib --source --as my-walk    # its source, renamed, ready to paste and edit
mkp schema walk --pack lib                        # JSON Schema of its inputs
```

`mkp index` is short enough for an agent to keep in context while it writes.

## Formatting and packing

```sh
mkp fmt lesson.mkp.md --pack lib --write          # the canonical layout
mkp pack packs/lib -o lib.mkpack                  # a pack folder as one file
mkp cases --pack lib --out gallery                # every widget's valid cases, compiled
```

## migrate

```sh
mkp migrate notes/ --pack lib --check
mkp migrate lib/ notes/ --write
```

Brings documents, packs (folders or `.mkpack` files) and stored bundles (`name.ir.json`) written
for an older release up to this one: each file is compiled by the release it was written for (its
stamp says which), the steps between run, and it is written back in canonical form with a new
stamp, after this release has checked it. Each change is a warning at its line.

- `--keep id,…` or `--keep all` keeps an old look where it can be kept (written into the source);
  `--take all` takes every new behaviour. On a terminal, it asks.
- `--check` exits 1 while anything is written for an older release: a CI gate.
- `--core mkp-web-0.2.1.zip` gives the older release's web files, to work offline.
- A pack's `migrate walk@1 -> walk@2` block moves documents' uses of `walk@1` too.

## The loop

Write, `mkp check` until it is clean, `mkp build --target html` and look. Repeat.
