# migrate-0.2: MKP 0.2 documents to MKP 0.3, by way of the IR

`mkp migrate` runs it, frozen with 0.2.10's compiler into one file: see [frozen/](frozen/README.md).
On its own, it takes a document's **0.2 IR** (shape 1, the bundle `mkp build --target ir` writes) and
writes an **MKP 0.3 document** in canonical form, along with the 0.3 packs it imports. The 0.3 compiler
then formats it (`mkp fmt`), checks it (`mkp check`) and makes its 0.3 IR (`mkp build`).

```txt
0.2 source ──(0.2.10 compiler)──▶ 0.2 IR, shape 1 ──(this tool)──▶ 0.3 syntax tree ──▶ canonical 0.3 source
                                                                                            │
                                         0.3 IR ◀──(0.3 compiler: check, lower)────────────┘
```

## Why the 0.3 side is the syntax tree and not the 0.3 IR

- **0.2's IR is a good input.** It isn't lowered. Prose stays Markdown: each block is a
  `paragraph`, `heading` or `list` node, and its inline Markdown is kept as written. A widget block is
  a use with typed, resolved inputs: the YAML is already parsed and checked against the widget, and
  defaults are filled in. A definition keeps its inputs, values, fns and view tree, with expressions
  as resolved trees. So the migration works from what things mean, not from how they were spelled.
- **0.3's IR is a poor output.** It is lowered and ready to run. Prose has become `core/paragraph` and
  `core/heading` extern calls with rich-text segments. Values read through numbered bindings with
  dependency sets, events go through handlers, every node has a site, and core's own templates come
  along with it. To write it, the migration would have to do the 0.3 checker's and lowering's work
  itself. Only the checker would then show whether that IR is valid, so the source printed from it
  would need checking anyway.
- **Writing the 0.3 syntax tree** gives the same result with none of that work. The 0.3 compiler checks
  the tree and lowers it to a valid IR. The tree can carry doc comments and `// TODO` comments, which
  the 0.3 IR can't. And the output is canonical: every file passes `mkp fmt --check` as written.

The tool builds a small mirror of the 0.3 tree (`src/tree.mjs`) and prints it. `mkp-syntax`'s own tree
holds spans into its source and has no `Deserialize`, so a tool outside the Rust workspace can't hand
it a tree. A Rust port would build `mkp_syntax::ast` directly.

`probe/ir3-source.mjs` tests the other way round: it writes canonical source back from a **0.3** IR.
It isn't part of the migration. It shows that a 0.3 IR → source writer is possible, and a useful tool
in its own right (see RESULTS.md).

## Running it

You need MKP 0.2.10's CLI (built from `main`) and 0.3's `mkp` (`targets/rust/target/release/mkp`).

```sh
# 0.2.10's CLI, built outside the repo
git archive origin/main | tar -x -C /tmp/mkp02 && cd /tmp/mkp02 && npx -y pnpm@10.34.9 install && npx -y pnpm@10.34.9 --filter @mkp/cli build

# one document
node /tmp/mkp02/packages/cli/dist/mkp.cjs build doc.mkp.md --pack <0.2 packs> --target ir --out b
node bin/migrate.mjs b/doc.ir.json --source doc.mkp.md --out out [--pack-widgets]
mkp fmt out/doc.mkp.md && mkp check --pack out/packs/<pack> out/doc.mkp.md

# the corpus, and its table (RESULTS.md)
node corpus/run.mjs --root02 /tmp/mkp02 --mkp02 /tmp/mkp02/packages/cli/dist/mkp.cjs \
  [--docs <dir of more 0.2 documents> --pack <the 0.2 pack they use>] [--cases <mkp cases output>]

# the probe: 0.3 IR back to source, over the corpus's results
node probe/roundtrip.mjs <corpus work dir>

npm test   # node --test test/
```

`--source` is optional. Without it, the migration reads only the IR. With it, `src/source.mjs` reads
the 0.2 document beside the IR for what the IR drops, and places each item by the IR's own line
numbers:

| In the 0.2 source | In the 0.3 output |
|---|---|
| `# comments` in ```` ```mkp ```` fences (on a definition, an input, a value, an element) | `//` comments in the same place. These come from the IR itself, which keeps them |
| blank lines between a definition's values and elements | blank lines in the same places |
| `# comments` in a YAML block, on a line of their own or at a line's end | `//` comments on the argument or record item they described, in the call's argument list |
| the order the YAML wrote its keys and fields in | the same order of arguments and record fields (canonical form allows any order) |
| link reference definitions (`[p]: https://…`) | kept in place. 0.3 reads them, so `[text][p]` is now a link, where 0.2 showed it as text (noted as CHANGED) |
| HTML comments in prose | in place, as prose's own comment: one `@//` line per line of the comment (0.3 shows `<!-- … -->` as text, and warns). `--html-comments header` moves them to the header with where each stood; `--html-comments inline` keeps them visible |
| front matter, its comments included | copied as written |

A definition the migration can't write keeps its 0.2 source, quoted in comments above its stand-in.

## What it does

| 0.2 | 0.3 |
|---|---|
| Markdown blocks (paragraph, heading, list, quote, code, maths, table, footnote, divider) | Markdown again. Only what 0.3 reads differently is escaped: a line starting with `@`, a line holding only `}`, and `\{` (CommonMark's escaped brace in text; `\\{` in TeX) |
| a widget fence with YAML | `@name(…);` with record literals. Fields equal to their defaults are left out, and `summary:` becomes an input |
| `:::card title="x"` | `@card(title = "x") { … }` |
| `:::tabs` / `:::tab "Web"` | `@tabs {` / `@tab(title = "Web") {`. A record with content becomes a widget of its own, filling a list slot |
| `:::fill footer`, several slots | `@slot footer { … }` |
| a choice, `none` included | an `enum` with a `NONE` case, and a `show` fn, so it still shows as its name in holes and text |
| a token or an icon with `none` | `opt<color>`, `opt<glyph>` and `opt.NONE`; `x == none` becomes `x == opt.NONE` |
| a bare word in an expression (`ok`, `check`, `done`) | its case, from the type the context expects |
| `in`, `var`, derived values, `fn`, `out` | inputs, `mut`, `let`, fns, `event`; `//@about` and `//@param` from the descriptions |
| `each k in 0..(len(xs) - 1)` with `xs[k]` | `for (k, k_item in xs)` with `k_item` |
| `@click set n=(n + 1)`, `emit` | `click = fn() { n = n + 1; }`, `invoke` |
| `"a" + b`, `format(x, 2)`, `if(c, a, b)`, `not`/`and`/`or` | `"a\{b}"`, `x.fmt(2)`, `c ? a : b`, `!`/`&&`/`\|\|` |
| `project md = …` | a `markdown` block. Text joined with `+` becomes prose with holes, `join(map(…))` becomes `@for`, `if` becomes `@if` |
| a ```` ```state ```` block | `$state` fields; a slider becomes `@slider`, a toggle a switch `@press` |
| a pack (a conformance pack, an example's, any other) | a 0.3 pack. By default it is a shim: each widget an `extern widget` with the same signature and a generic markdown block. With `--pack-widgets`, each widget whose 0.2 view migrates is written with its view |

Anything the tool can't write isn't dropped:

- A widget block it can't write is kept as Markdown: its summary, its inputs as YAML in a code block,
  and its content.
- A definition it can't write becomes a stand-in with the same inputs (so its uses still check). The
  stand-in shows the widget's name, and the 0.2 source sits above it in comments.
- Every change in meaning or look is listed in the header comment with its 0.2 line, as `TODO`,
  `TODO (kept as Markdown)` or `CHANGED`.

## Layout

```txt
bin/migrate.mjs          the CLI: one bundle → a document and its packs, plus notes.json
src/migrate.mjs          the driver: the document's fns, definitions, state, body and header
src/prose.mjs            the body: Markdown blocks, the escapes, fallbacks
src/view.mjs             definitions: inputs, values, fns, the view tree, project md
src/values.mjs           types, values and expressions, typed by what the context expects
src/decls.mjs            the enums and records a document or pack needs, each declared once
src/packs.mjs            a 0.2 pack as a 0.3 pack: a shim of externs, or views (--pack-widgets)
src/source.mjs           the 0.2 source beside the IR: comments, link definitions, YAML key order
src/tree.mjs             the 0.3 syntax tree's mirror, and its printer
corpus/run.mjs           the corpus run and its table (RESULTS.md, RESULTS-pack-widgets.md)
probe/ir3-source.mjs     the probe: 0.3 IR → canonical source
probe/roundtrip.mjs      the probe's test: IR → source → fmt --check → check → IR, compared
test/                    node --test, on three real 0.2 bundles (one written to hold every kind of comment)
```

## Limits

- **Not covered yet**: canvas and gfx, arrows, zoom; the `play`, `steps`, `drag` and `clock` controls;
  signals, commands and hosts (0.3's extern channels); `hidden`, `span` and `keep`; grid tracks;
  `reveal`, `hide`, `open`, `close`, `play` and `reset` actions; operators (`op`); generic fns; about
  20 builtins (`fold`, `lcat`, `tslice`, `log`…); indexing outside a walk over the same list.
- **Proofs**: 0.3 asks for proofs that 0.2 didn't, such as a meter's value being at least 0, or a
  division giving an `int`. The tool doesn't write them, so `mkp check` reports them.
- **opt**: a 0.2 value that could be `none` (an icon, a colour) is an `opt` in 0.3. Reading one where a
  plain value is wanted needs opening (`if (let …)`), and the tool does this only for `icon`.
- **Inline Markdown in `text`**: 0.2's `text` drew its value as inline Markdown. The shim keeps the
  meaning with `rich_text` fields, but a widget written with `--pack-widgets` hands plain `text` to
  `label`, so the formatting shows as written.
- **Lost on the way through the IR**: without `--source`, HTML comments, link reference definitions
  and YAML comments. With it or without it, the spelling of list markers, and the per-use `summary:`
  of a document's own widgets: 0.3 builds such a widget's Markdown from the widget, so a per-use
  summary has no home.
- **Comments in prose**: 0.3 prose has its own comment, `@//` to the end of the line, and an HTML
  comment there is shown as text with a warning, so the migration writes 0.2's HTML comments as
  `@//` lines in place. Inside a Markdown quote or list item there is no comment, so one there moves
  to the next block.
- **`$`**: maths is paired again by 0.3's rule (no digit after the closing `$`), and the tool doesn't
  check whether 0.2's micromark paired it differently.
