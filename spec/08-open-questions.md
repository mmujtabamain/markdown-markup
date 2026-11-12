# Open questions

Page 8 of 9. What this version decided, what is still open, and where the ideas came from.

### Decided in this version

The second to ninth rounds of review changed these. Each row names the rule that now holds.

- **A divider instead of mkp fences** (done, @@@): A document is its definitions, a `@@@` line, then Markdown. Nothing above the line draws, and an `mkp` fence below it is ordinary code.
- **A literal @** (done, escape): A line that starts with `@` and a small letter is always MKP. `\@` is always a literal @, and `\@@@` shows the divider as text.
- **One number type** (done, number): Exact base-10 (decimal128, 34 digits). Whole numbers are a `step 1` contract. No conversions between number types, and `7 / 2` is `3.5`.
- **Interfaces fit structurally** (done, any): `any chart` is the type for any kind of chart. A type fits an interface when it has what the interface asks for, the six standard ones included, and `implements` is an optional, checked promise. Only fns in the type's own pack or the interface's count, so the list method is `xs.some(…)`.
- **opt stays** (done, opt): A shorter `t?` was considered and turned down.
- **Exact lengths** (done, [3]): `[3]` is exactly 3. Nothing is ever padded.
- **Reaching into a list** (done, opt): `xs[i]` and `xs.at(i)` both give an `opt`, so indexing needs no proof.
- **Every let and mut writes its type** (done, let x: number): Definitions write their types. A lambda written where a fn type is expected may leave them out: `fn(p) { return p.nick; }`.
- **No return type means none** (done, fn()): `: void` may still be written.
- **Passing values** (done, mut): Everything is passed by reference, a plain parameter is read-only, and `mut` writes through. No `ref` keyword. Memory is the implementer's.
- **Loops** (done, mut for): `for` reads and `mut for` can change items and its list, which it reads again for every iteration.
- **No while loop** (done, removed): There is no while loop and no counter form, so every loop walks a list or a range and ends. Why: what a styling language needs is covered by walks and list fns (`remove_where`, `filter`, `map`, `move`, and positions from `for (k, x in xs)`), and with only walks a document can never hang a page, whoever wrote it.
- **No by, no keys** (done, position): Rows go by position, and a widget with variables of its own can't be drawn in a loop over a list that isn't a constant.
- **Global variables** (done, mut): A `mut` at the top of a file is a global variable; a widget's own variables are one per use. The word state is gone, and the level `core.state` is now `core.live`.
- **expose** (done, file level): Only at the top of a file, acting on its global variables.
- **#secret** (done, removed): With `reveal` and `page.secrets`. A widget's markdown block already decides what its Markdown shows.
- **#id** (done, kept): Removing it was considered and turned down.
- **latex is a core record** (done, literal): It fits `literal<text>`, like `email`, so `@math(tex = "x^2")` is checked where it is written and a reader's text becomes maths only through `try`. One built-in type fewer, and `$…$` is maths in prose only.
- **Type parameters are capitals** (done, T): `list<T>`, `opt<T>`, `<T: chart>`. A bare capital is always a type parameter; capitals after a dot are cases and tokens.
- **Tokens stay** (done, #token): Names by default, no value written inline, and custom design as a named token in a pack's `tokens` block. `color` gets `C1` to `C6` for charts, and no core widget takes pixels: `fit` takes `size` tokens.
- **Versions as name@n** (done, kit@1): `pack kit@1 { uses core@1, charts@2; provides …; }`. One `uses` line in place of `version`, `requires` and `depends`; implementers write `implements core.draw@1`. A document writes no versions.
- **Extern widgets** (done, 21): Markdown's own blocks (`paragraph`, `heading`, `bullets`, `item`, `quote`, `code`, `math`, `table`, `footnote`, `divider`), so every implementer draws Markdown natively, and what MKP can't express: `flex`, `grid`, `cell`, `sizing`, `label`, `image`, `icon`, `press`, `field`, `slider`, `overlay`. `row`, `column`, `stack`, `meter`, `frame`, `pane` and the six sizing wrappers are written in MKP.
- **Text has no ranges** (done, text[…]): Text has a length and `only`. Ranges are for numbers, durations and dates.
- **No attributes** (done, token): `token color { … }` declares a token type, fixtures are a declaration, and a widget held in a variable replaces `#id`. A `#` at the start of a line is always a heading.
- **Pointing at a widget** (done, variable): Hold the widget in a `let`, place it once, and point an `arrow` at it. For data, keep a list of widgets and find one with `find`.
- **Sharing checks every write** (done, mut): A variable with a narrower contract than a `mut` input can be given to it; every value written back is checked, and a failure undoes the event.
- **import … as** (done, as): `import charts.card as chart_card;` renames on import.
- **md for Markdown in code** (done, md): A core record like `latex`: a literal becomes Markdown that a hole doesn't escape; a reader's text never does.
- **Dates and moments in MKP** (done, core): `date` and `moment` are core records written in MKP, as is `map`. A moment always carries its offset; `page.now` is the app's clock. Extern is only for what MKP can never do on its own.
- **The canvas** (done, core.gfx): `canvas` with its own x and y ranges, layers of `circle`, `path`, `place` (any widget at a point) and `handle`, plus `arrow` between widgets. A click on empty space carries its position. Motion is dropped.
- **No fixtures for now** (done, dropped): No compiler runs them yet, and the core library's tests belong in the conformance suite. The design is kept under Later.
- **Time zones** (done, offsets): Authors write offsets. `local()` is supplied by the implementer from the platform's zone rules, so a moment shows in the reader's own time on its date.
- **Maths on number** (done, x.sin()): Built-in maths fns on `number`, with `pi` and `e` in core.
- **TeX is checked twice** (done, require): core checks how TeX is written, the same for every provider; `can_draw_tex` lets a provider refuse what it can't draw, with a default that accepts everything.
- **Extern fns may return a value, and have a default** (done, extern): A value fn changes nothing and may be called while drawing; an action goes to the app. A body on an extern fn is its default.
- **Inline Markdown arrives parsed** (done, rich_text): Segments, each a part with its marks. No implementer parses Markdown, and a hole can never become formatting.
- **The Markdown MKP extends** (done, CommonMark): CommonMark with GitHub's tables, task lists, strikethrough, footnotes and bare links. Raw HTML is text. Markdown out keeps the meaning in one spelling.
- **Names** (done, _): Small letters, digits and `_`, with `_` between words. A `-` is always minus.
- **MKP 0.3.x** (done, breaking): This syntax is MKP 0.3.x. It replaces 0.2.x entirely: no 0.2.x source compiles, and there is no migration.
- **Deprecated** (done, //@deprecated): A doc comment, not an attribute: every use of the declaration warns with its text.
- **Limits match today's renderer** (done, 64): 1,000,000 steps, 10,000 items, and calls 64 deep.
- **Confirmed as they were** (done, kept): Bounds written `T: chart`, front matter at the top, the rows-by-position error, global variables in .mkp files, exact numbers (with a decimal library for JavaScript), and `try`.

The first round's seven decisions stand: `mut` rather than `state`, `expose` as the name, the logic symbols `&& || !`, strict narrowing into a range, a warning for a document widget's built Markdown that depends on a variable, `label` and `bullets` for the widgets that clashed with types, and checked `//@about` and `//@param` comments.

### Later

Nothing is open: every question raised in review has an answer in this doc. These were left for later on purpose, and none of them changes what is here.

- **Fixtures** (skipped): A test declaration: `fixture name { … }` with its own variables, `assert` lines, one view and the `markdown` it must produce. Kept for when a compiler can run it.
- **3D, pixels and meshes** (skipped): A level of its own, core.gfx3, with its own page, the day a widget needs it.
- **Named time zones in the language** (skipped): Left out on purpose: every implementer would need the same zone database, and some times happen twice or never.
- **Motion** (skipped): Clocks, animation and scrolling into view. Dropped for now.

### Where the ideas came from

- **Rust:** exhaustive `match`, enums that carry data, no null, `if let`, bounds on generics, explicit trait implementation. Not ownership or borrowing.
- **C3:** `fn` as the first word, contract messages, fns added from outside a type, index and value in one loop.
- **C# and SQL:** an exact base-10 number for amounts people read.
- **Swift and Kotlin:** a lambda's types taken from where it is used.
- **Astro:** code above a divider and the page below it.
- **SwiftUI and Elm:** one source of truth, with change kept in known places. Elm for views that can't change anything.
- **Java:** the overall look, semicolons, records, and the `\{x}` hole from its withdrawn string templates.
