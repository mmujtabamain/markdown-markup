# Open questions

Page 8 of 9. What this version decided, what the tenth round settled, what was left for later, and where the ideas came from.

### Decided in this version

The second to tenth rounds of review changed these. Each row names the rule that now holds, and a row that a later round changed says which round.

- **A divider instead of 0.2's `mkp` fences** (done, @@@): A document is its definitions, a `@@@` line, then Markdown. Nothing above the line draws, and an `xtmd` fence below it is ordinary code.
- **A literal @** (done, escape): A line that starts with `@` and a small letter is always Extended Mark. `\@` is always a literal @, and `\@@@` shows the divider as text.
- **One number type** (done, number): Exact base-10 (decimal128, 34 digits). Whole numbers are a `step 1` contract, written `int` since round 10: core declares `type int = number step 1`, and a contract written after it adds to its own. No conversions between number types, and `7 / 2` is `3.5`.
- **Interfaces fit structurally** (done, any): `any chart` is the type for any kind of chart. A type fits an interface when it has what the interface asks for, the six standard ones included, and `implements` is an optional, checked promise. Only fns in the type's own pack or the interface's count, so the list method is `xs.some(…)`. Round 10: the six are declared in core, as ordinary interfaces.
- **opt stays** (done, opt): A shorter `t?` was considered and turned down. A plain value is accepted where an `opt` is wanted. Round 10: an `opt` may hold an `opt`; a plain value is wrapped as many times as needed, and a bare `opt.NONE` is the outer level.
- **Exact lengths** (done, [3]): `[3]` is exactly 3. Nothing is ever padded.
- **Reaching into a list** (done, opt): `xs[i]` and `xs.at(i)` both give an `opt`, so indexing needs no proof.
- **Every let and mut writes its type** (done, let x: number): Definitions write their types. A lambda written where a fn type is expected may leave them out: `fn(p) { return p.nick; }`.
- **No return type means none** (done, fn()): `: void` may still be written.
- **Passing values** (done, mut): Everything is passed by reference, a plain parameter is read-only, and `mut` writes through. No `ref` keyword. Memory is the implementer's.
- **Loops** (done, mut for): `for` reads, makes no copy and can't change its list. `mut for` walks a copy of its list made when it starts, once per item, and its variable is an `opt` of the real item, written through `if (mut x: T = t)`. Round 10: before, `mut for` read its list again for every iteration.
- **No while loop** (done, removed): There is no while loop and no counter form, so every loop walks a list or a range and ends. Why: what a styling language needs is covered by walks and list fns (`remove_where`, `filter`, `map`, `move`, and positions from `for (k, x in xs)`), and with only walks a document can never hang a page, whoever wrote it.
- **No by, no keys** (done, items): Rows follow their items: the runtime knows which item of a list is which, so a widget in a loop keeps its own variables with its item, and an item in a list built anew, by `filter` or `sorted` for example, gets a new row. Round 10: before, rows went by position, and a widget with variables of its own couldn't be drawn in a loop over a list that isn't a constant.
- **Shared values in `$state`** (done, one block): A document's one `$state` block, above its `@@@` line, holds what its widgets share, read as `$state.name`, and every change checks the contracts and `require` blocks that read it. The app can get and set it but never watches it. Packs have no state, and a widget's own variables are one per use. The level `core.state` is now `core.live`. Round 10: before, a `mut` at the top of a file was a global variable.
- **expose** (done, documents): Only at the top of a document, acting on its `$state`. It declares no name of its own: it answers the `extern` channel of that name, and only the app calls its fns. Round 10: before, it was at the top of any file, acting on its global variables.
- **#secret** (done, removed): With `reveal` and `page.secrets`. A widget's markdown block already decides what its Markdown shows.
- **#id** (done, replaced): Removing it was turned down at first. Round 6 replaced it with a widget held in a variable, when attributes went (see No attributes).
- **latex is a core record** (done, literal): It fits `literal<template>`, so `@math(tex = "x^2")` is checked where it is written, a hole is escaped for TeX, and a reader's text becomes maths only through `latex.from`, which gives an `opt`. One built-in type fewer, and `$…$` is maths in prose only. Round 10: before, it fitted `literal<text>`, and holes in maths were undefined.
- **Type parameters are capitals** (done, T): `list<T>`, `opt<T>`, `<T: chart>`. A bare capital is always a type parameter; capitals after a dot are cases and tokens.
- **Tokens stay** (done, token): Names by default, no value written inline, and custom design as a named token in a pack's `tokens` block. `color` gets `C1` to `C6` for charts, and the page's sizes take `size` tokens, never pixels. Round 6: declared with `token` in place of `#token`. Round 10: a token type is an enum (see Tokens are enums), and core's `stroke` also takes a plain number on a canvas.
- **Versions as name@n** (done, kit@1): `pack kit@1 { uses core@1, charts@2; provides …; }`. One `uses` line in place of `version`, `requires` and `depends`; implementers write `implements core.draw@1`. A document writes no versions.
- **Extern widgets** (done, 23): Markdown's own blocks (`paragraph`, `heading`, `bullets`, `item`, `quote`, `code`, `math`, `table`, `footnote`, `divider`), so every implementer draws Markdown natively, and what Extended Mark can't express: `flex`, `grid`, `cell`, `sizing`, `plane`, `spot`, `label`, `image`, `icon`, `press`, `field`, `slider`, `overlay`. `row`, `column`, `stack`, `meter`, `frame`, `pane`, `blocks` and the six sizing wrappers are written in Extended Mark. Round 10: `plane` and `spot` joined the 21, and any pack may declare extern widgets of its own, which it supplies; one nobody supplies shows its Markdown.
- **Text has no ranges** (done, text[…]): Text has a length and `only`. Ranges are for numbers, durations and dates.
- **No attributes** (done, token): `token` declares a token type, and a widget held in a variable replaces `#id`. A `#` at the start of a line is always a heading. Round 7 dropped fixtures, which were to be a declaration, and round 10 wrote a token type as `token color: color_value { … }`.
- **Pointing at a widget** (done, variable): Hold the widget in a `let`, place it once, and give it to any widget's input that takes a view, such as `acme`'s `jump` (page 6). For data, keep a list of widgets and find one with `find`. Round 10: the compiler knows nothing about what a widget does with a view, and `arrow` left core.
- **Sharing checks every write** (done, mut): A variable with a narrower contract than a `mut` input can be given to it; every value written back is checked, and a failure undoes the event.
- **import … as** (done, as): `import charts.card as chart_card;` renames on import. Round 10: it also renames a fn a pack adds to a type (`import b.slug as b_slug;`), and `provides` may list `let` constants.
- **md for Markdown in code** (done, md): A core record that holds Markdown blocks, parsed by core's own Extended Mark code and placed with `@blocks`. A hole in it stays plain text, and a reader's text becomes `md` only through `md.from`, called by name. Round 10: before, a hole put its source in as Markdown, and only a literal became `md`.
- **Dates and moments in Extended Mark** (done, core): `date` and `moment` are core records written in Extended Mark, as is `map`. A moment always carries its offset; `page.now` is the app's clock. Extern is only for what Extended Mark can never do on its own. Round 10: their fields mirror their text, with field contracts for the simple checks and a `require` only for rules across fields.
- **The canvas** (done, core.gfx): `canvas` with its own x and y ranges, and layers of `circle`, `path`, `place` (any widget at a point), `handle` and `shade`. A click on empty space carries its position. Motion is dropped. Round 10: `shade` joined, and `arrow` and `zoom` left core.
- **No fixtures for now** (done, dropped): No compiler runs them yet, and the core library's tests belong in the target checks. The design is kept under Later.
- **Time zones** (done, offsets): Authors write offsets. `local()` is supplied by the implementer from the platform's zone rules, so a moment shows in the reader's own time on its date.
- **Maths on number** (done, x.sin()): Maths fns on `number`, declared in core as `extern fn`, with `pi` and `euler` in core. `sqrt`, `ln`, `asin`, `acos` and `pow` give an `opt`, and a result too large is a failure. Round 10: before, they were built in, `euler` was `e`, and those five were failures outside their domain.
- **TeX is checked twice** (done, require): core checks how TeX is written, the same for every target; `can_draw_tex` lets a target refuse what it can't draw, with a default that accepts everything.
- **Extern fns may return a value, and have a default** (done, extern): A value fn changes nothing and may be called while drawing; an action goes to the app. A body on an extern fn is its default. Round 10: a shader for `shade` is a value fn of this kind.
- **Inline Markdown arrives parsed** (done, rich_text): Segments, each a part with its marks. No implementer parses Markdown, and a hole can never become formatting. Round 10: core's own Extended Mark code parses it, as any pack could.
- **The Markdown Extended Mark extends** (done, CommonMark): CommonMark with GitHub's tables, task lists, strikethrough, footnotes and bare links. Raw HTML is text. Markdown out keeps the meaning in one spelling. Round 10: page 1 lists that spelling for each block and mark, and a line that holds only `$$` opens and closes a maths block.
- **Names** (done, _): Small letters, digits and `_`, with `_` between words. A `-` is always minus. Round 10: no name starts with `$`, and `$state` is a keyword.
- **Extended Mark 0.3.x** (done, breaking): This syntax is Extended Mark 0.3.x. It replaces 0.2.x entirely: no 0.2.x source compiles, and there is no migration.
- **Deprecated** (done, //@deprecated): A doc comment, not an attribute: every use of the declaration warns with its text.
- **Limits match today's renderer** (done, 64): 1,000,000 steps, 10,000 items, and calls 64 deep.
- **Confirmed as they were** (done, kept): Bounds written `T: chart`, front matter at the top, the rows-by-position error, global variables in .xtmdpack files, exact numbers (with a decimal library for JavaScript), and `try`. Round 10 replaced two of them: rows follow their items, and `$state` replaces global variables.
- **No exceptions for core** (done, core): Round 10. Whatever core does, a pack can do the same way. The compiler knows only the syntax (literals, operators, holes, prose and `@`) and what is declared `extern`; the native fns are declared in core as `extern fn`.
- **Building records** (done, try): Round 10. A record with `require` blocks can be built anywhere: a broken rule is a compile error for a constant and a failure when the page runs. `try` in front gives an `opt` instead, and checks the fields' contracts too. `from` returns an `opt` and is an ordinary fn anyone can call.
- **Literals with holes** (done, template): Round 10. `template` keeps a literal's pieces and holes apart, and a type that takes holes fits `literal<template>`; anywhere else a hole in a literal is a compile error. A literal with an `opt` hole is an `opt`. A literal's `from` runs only at compile time, and one that would have to read a hole is a compile error that says to build the record.
- **Fns on a type** (done, rich_text.plain): Round 10. A fn declared on a type without `self` is called on the type, and any pack can declare one. In `name.f()`, `name` is a value if one is visible, and a type otherwise.
- **A range keeps its sign** (done, -840..840): Round 10. A minus before a range's number is the bound's sign, and a whole range can't be negated: core has `range.negate`, `shift`, `scale`, `widen`, `overlap` and `span`.
- **Tokens are enums** (done, enum): Round 10. `token color: color_value { INK, … }`: cases, `==` and `match` follow the enum rules, and a `tokens` block gives each case its value. A case is accepted where its value's type is wanted, and a record value's fields pass through it. Packs may add cases, so `match` on a token needs `case else`. `stroke` takes a plain number through its case `PX`.
- **The plane** (done, core.draw): Round 10. `plane` and `spot` place any widget anywhere in a 2D space, in the page's own lengths. Each spot writes its box, and the plane the region it draws. The reader pans and zooms with `core.live`, and canvas layers go under the spots with `core.gfx`.
- **Pixels through shaders** (done, shade): Round 10. `shade`, in `core.gfx`, fills an area with the colour an extern fn works out for each pixel, run by the target. `pixel` holds that colour, which is its own, like an image's.
- **arrow and zoom leave core** (done, removed): Round 10. The compiler knows nothing about arrows, and there is no diagram pack: lines between widgets are paths on a plane's background, as page 7's diagram of tables draws them, and panning and zooming are the plane's.
- **Who supplies externs** (done, extern): Round 10. Core's externs come from the target, a pack's from the pack, for each target it supports, and a document's channels from the app, which hears through them what happened. Implementing Extended Mark means passing the target checks.
- **An empty markdown block** (done, markdown { }): Round 10. `markdown { }` says a widget writes nothing, as the canvas shapes do, and the compiler warns where such a widget is declared.
- **No calls in quotes or list items** (done, @quote): Round 10. A call, a control line or a `}` can't start inside a Markdown quote or list item: use `@quote`, `@bullets` and `@item`. A `markdown` block is parsed exactly like prose.
- **Levels count what a call uses** (done, core.live): Round 10. An event declared but never set needs nothing, so a card draws on `core.draw`. `core.live` is for a call that keeps variables, shares one or sets a handler that can change something, and for changing `$state`.
- **Evaluation order** (done, left to right): Round 10. Expressions are worked out left to right, and arguments in the order written; `&&`, `||` and `?:` skip the side they don't need.

The first round's seven decisions stand: `mut` rather than `state` for variables (round 10's `$state` names the document's shared block, and its fields are still variables), `expose` as the name, the logic symbols `&& || !`, strict narrowing into a range, a warning for a document widget's built Markdown that depends on a variable, `label` and `bullets` for the widgets that clashed with types, and checked `//@about` and `//@param` comments.

### Round 10

The tenth round reviewed the whole syntax and settled every finding, then folded in the state design and the decisions of the implementation plan that change the language. The rows above marked Round 10 hold the rules it made, and the Changes page lists them by page.

- **The whole syntax reviewed** (done, S-1 to S-40): Forty findings: six blockers, twenty-five major and nine minor. Twenty-five took the fix proposed with them and fifteen were reworked in review; the plan's decisions then replaced three of them (S-9, S-15 and S-32).
- **Decisions reworked in review** (done, R-1 to R-24): No exceptions for core, building records, literals with holes, `int`, ranges, nested `opt`, `mut for` walking a copy and rows that follow their items, among others. R-11 and R-17 were superseded within the round, by R-21 and R-22.
- **The state design** (done, ST-1 to ST-9): One `$state` block per document in place of global variables, its rules checked on every change, no state in packs, and `expose` kept, in documents only. Then: the app never watches `$state`, a target without `core.live` keeps its starting values, and a saved state comes back through the same checks as a write from the app.
- **Tokens are enums** (done, enum): A token type became an enum whose cases stand for values given in a `tokens` block, in place of a record whose tokens compared by value. `stroke` takes plain numbers on a canvas through its case `PX`.
- **The plane and shade** (done, core.draw, core.gfx): `plane` and `spot` place any widget anywhere in a 2D space, and `shade` brings in pixels from a shader. Page 7's diagram of tables moved onto the plane.
- **arrow and zoom removed** (done, removed): Both left core. A `diagram` pack for `arrow` was decided early in the round and then dropped: lines are paths on a plane, and panning and zooming are the plane's.
- **Literals with holes** (done, template): `template` for the types whose literals take holes, an `opt` hole making the literal an `opt`, and a compile error for a literal whose `from` would have to read a hole.

### Later

Nothing is open: every question raised in review has an answer in this doc. These were left for later on purpose, and none of them changes what is here.

- **Fixtures** (skipped): A test declaration: `fixture name { … }` with its own variables, `assert` lines, one view and the `markdown` it must produce. Kept for when a compiler can run it.
- **3D and meshes** (skipped): A level of its own, core.gfx3, with its own page, the day a widget needs it. Round 10: flat pixels came in through `shade`.
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
