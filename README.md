# Extended Mark 0.3

Extended Mark (called MKP, Markdown Markup, up to 0.2) is a statically typed language for widgets in Markdown documents. A document is its definitions, a line that holds only `@@@`, and Markdown with `@widget` calls in it. Extended Mark lowers a page onto extern widgets, and whoever supplies those widgets decides how the page looks.

0.3 is a complete break from 0.2: no 0.2 source compiles, and there is no migration. 0.2 is in this repository's history.

This repository holds only the syntax for now. The implementation starts again from scratch.

## The syntax

| Page | What it covers |
|---|---|
| [1 Overview](docs/specs/01-overview.md) | The rules, the words, the two kinds of file, and how a document is read |
| [2 Values and types](docs/specs/02-values-and-types.md) | Records, enums, constants and `mut`, optional values, numbers, contracts and proofs, and what a fn may change |
| [3 Widgets](docs/specs/03-widgets.md) | Declaring and calling widgets, slots, events, views, loops and where variables live |
| [4 Interfaces](docs/specs/04-interfaces.md) | Structural interfaces, the standard ones, literals for your own types, and generics |
| [5 Standard library](docs/specs/05-standard-library.md) | What is built in, and all of `core`: types, text, dates, maths, Markdown, tokens and widgets |
| [6 Apps, packs and implementers](docs/specs/06-apps-packs-implementers.md) | Packs and imports, tokens, talking to the app, levels, failures and limits |
| [7 Examples](docs/specs/07-examples.md) | Whole widgets and a whole document |
| [8 Open questions](docs/specs/08-open-questions.md) | What this version decided, and what was left for later |
| [9 Grammar](docs/specs/09-grammar.md) | The grammar of files, documents and prose |

These pages are the syntax as of its tenth review round: the review of the whole syntax, the state design, and the language decisions of the implementation plan, one commit per page.
