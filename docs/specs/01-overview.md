# Overview

Extended Mark (called MKP, Markdown Markup, up to 0.2) is a statically typed language for drawing widgets in Markdown documents. This page has the rules, the words, the two file types and how a document is read.

> **The language in five lines**
>
> `@name(…)` builds a widget. A `token` is the look, used by name. Everything is constant unless it says `mut`. A fn that returns a value changes nothing. A document is its definitions, a `@@@` line, then Markdown.

| | |
|---|---|
| Keywords | **41** |
| File types | **2** (.xtmdpack and .xtmd) |
| Rules | **19** |

### The rules

1. **Two file types.** .xtmdpack holds definitions only and can't draw. .xtmd is a document: definitions, then a line that holds only `@@@`, then Markdown that Extended Mark renders. Nothing above the line draws, and below it an `xtmd` code fence is ordinary code.
2. **@ starts a view.** `@name(…)` builds a widget. A fn that returns a view is called with @ too, and `@name` stands for a view held in a value. A view written as a statement inside a view is drawn there. Empty parentheses can be left out: `@column { … }`.
3. **The look comes from tokens.** A token type is an enum, and each of its named cases stands for a value written only in a `tokens` block. Everywhere else a token is used by name: `tone = color.OK`, `gap = space.M`. A token type that fits `literal<T>` also accepts a plain value, through a case that carries one: core's `stroke`, for drawing on a canvas, where the named strokes are the convention. The page's colours, spacing and sizes take tokens only. Extended Mark has no attributes, so a `#` at the start of a line is always a Markdown heading.
4. **Constant by default, mut to change.** Locals, a widget's own variables, inputs, parameters and record fields. A document's shared variables are the fields of its `$state` block, which are variables without saying `mut` (rule 17). Everything is passed by reference: a plain parameter or input is read-only, and `mut` on it lets the fn or widget write through it to the caller's value. The caller's variable may have a narrower contract than the input, and every value written back is checked against it. To assign `a.b`, both `a` and `b` have to be mut.
5. **Types follow names, and definitions write them.** `name: type`. Names are small, with `_` between words (`text_size`, `remove_where`), and capitals mean two things that never meet: an enum case after its type and a dot (`stage.DONE`, or a token such as `color.OK`, since a token type is an enum), and a type parameter on its own (`list<T>`, `opt<T>`). So a small name in front of capitals is always a type, and a bare capital is always a type parameter. Every `let` and `mut`, field, input and parameter writes its type. A fn with no return type returns nothing. A lambda written where a fn type is expected may leave its types out and takes them from there.
6. **Every statement ends with a semicolon.** A statement that is itself a block needs none: `if`, `for`, `match`, a declaration with a body, and a widget call with a block. A statement that only ends in a block, such as `let f: fn() = fn() { … };`, still takes one. In code, line breaks mean nothing.
7. **One brace layout.** An opening brace ends its line, and a closing brace starts its own line. In prose this is grammar, because it is how a block's end is found. In code it is the required style: a compiler reports another layout as a warning and never reads it differently. Empty blocks, one-line data, lambdas and case bodies may stay on one line.
8. **Inputs go in the parentheses, slots go in the block.** `name = value` in the parentheses sets an input or an event. The block after the call fills the slots: the children directly when the widget has one slot, or one named block per slot. In code a named block can also set inputs, one `name = value;` per line. Setting anything twice is an error.
9. **Every name is declared or imported, and declared once.** There are two sets of names, types and values, and where a name is written says which set it is looked up in. A declaration can't reuse a name that is already visible in its set. core is imported by every file without saying so.
10. **No exceptions for core.** Whatever core does, a pack can do the same way. The compiler knows only the syntax (literals, operators, holes, prose and `@`) and what is declared `extern`. Everything else is declared in core, in Extended Mark. A type fits an interface when it has what the interface asks for, and that is how a pack's type joins the syntax: literals, holes, comparisons and arithmetic. Writing `implements` is a promise that is checked where it is written.
11. **Widget calls name every argument, and an event takes a fn.** `key = value`. Plain fns take arguments in order. An event is set to a fn that runs when it fires, never to a call.
12. **A match covers every case, and there is no null.** An opt value has to be opened before use.
13. **Two loops, and every loop ends.** `for` reads, and can't change its list or its items. `mut for` walks a copy of its list made when it starts, once per item, and its variable is an `opt` for the real item, opened with `if (mut x: T = t)` to write it. `for` walks a list or a range and `mut for` a `mut` list, so there is no while loop and a document can never hang a page. Rows follow their items, so a widget in a loop keeps its own variables with its item.
14. **One hole, always replaced.** Backslash and braces around an expression, in text, prose and maths. A second backslash escapes it. Code spans, fenced code and indented code are literal. A hole's value is never read as Markdown, or as part of the literal it sits in.
15. **Every widget has a markdown block.** So the Markdown of any view is always complete. An empty one, `markdown { }`, says the widget writes nothing, for parts whose meaning the widget around them writes, such as a canvas's shapes. The compiler warns where such a widget is declared, and compiles it all the same. A widget declared in a document may leave the block out, and Extended Mark builds it from the view. Markdown's own blocks, such as `paragraph` and `heading`, are extern and write themselves out as the block they stand for.
16. **Widgets can't inherit.** Reuse is by calling, slots, interfaces and fns added to types.
17. **Variables live while the page is open.** A document's shared variables are the fields of its one `$state` block, used as `$state.name` by every widget and fn in the document. A `mut` at the top of a file is a compile error that points to `$state`, and a pack has no state of its own. A `mut` in a widget is that widget's own variable, one per use of the widget. Nothing persists across sessions by itself: the app can read `$state`, keep it, and hand it back when the page opens, where it is checked like any write from the app (page 6).
18. **A fn that returns a value changes nothing.** Only a fn with no return type can assign variables, fire an event or call an `extern` fn that has no return type. A view, a markdown block, a `require` and a starting value can only call the first kind, so drawing a page never changes it.
19. **No thrown exceptions.** Trouble that can be expected is an `opt`, and the code has to open it: a record built with `try` from what a reader typed, or the square root of a negative number. A bug when the page runs, such as a division by zero or a record built against its own `require`, is a failure: it is contained to its widget, the event that caused it is undone, and page 6 lists them all.

```txt
package import enum record type interface implements widget extern expose fn pack tokens
mut let event invoke view markdown require if else for in match case return only step
void any param slot try with self true false
as token $state
```

A keyword can never be a name, after a dot included. `$state` is one word: `$` is not a prefix, so `$` on its own and `$abc` are neither keywords nor names, and in code each is a compile error whose message names `$state`. No name starts with `$`, so `$state` never meets a variable, an input or a field, and `state` stays free as a name: `$state.state` reads a field called `state`. `uses` and `provides` are words only inside a `pack` block, and `migration` and `execute` only where a migration is written, so all four stay free as ordinary names.

### Names

Two sets of names exist, and the place a name is written decides which set it is looked up in.

| Set | Holds | Looked up when the name is written |
|---|---|---|
| Types | built-in types, records, enums and token types, `type` names, interfaces, widgets, and type parameters (capitals) | after a colon, inside `<…>`, after `implements` or `any`, in front of a record's braces, in front of `.CAPITALS`, and in front of a dot when no value of that name is visible |
| Values | `let` and `mut` variables, parameters, inputs, slots, loop variables, fns, extern blocks | everywhere else |

- **`color.OK`**: capitals after the dot, so `color` is a type and `OK` is one of its cases. A token type is an enum, so this is the same reading as `stage.DONE`. It holds even where a value called `color` is visible.
- **`T`**: a capital on its own is always a type parameter, declared in the `<…>` after a fn, a widget or a record: `fn first<T>(xs: list<T>): opt<T>`. Cases are never written on their own, so the two can't be confused.
- **`page.width`** and **`date.from(entry)`**: a small name after the dot is a field or a fn. The name in front of it is a value when a value of that name is visible, as `page` is, and a type otherwise, as `date` is: `from` is a fn declared on the type, without `self` (page 2). When the value has no such field or fn, the compiler's message names the type too.
- **`$state.low`**: `$state` is a keyword that stands for a value, the document's state, so `low` is one of its fields. It is never a type, so `$state { … }` can't start a record literal.
- **`align: align = align.STRETCH`**: an input named `align`, of the type `align`, starting as the case `STRETCH` of the type `align`. Each `align` has one reading.
- **After `@`**: the name is looked up first among the values that can follow `@` (a slot, a view held in a value, a fn that returns a view), and as a widget second. Other values are skipped, so an input called `label` never hides the widget `label`. A slot, a fn that returns a view and a value that holds a view can't take the name of a visible widget, so the order never matters.
- **No shadowing.** A `let`, `mut`, parameter, input, slot, loop variable or fn can't take a name that is visible in the value set where it is declared. A file's own top-level names are visible in the whole file, before their declaration too, so the order of declarations never changes what is allowed. Fields and fns of a type are reached through a dot, so they are not in the way.
- **Clashing imports.** Two imports that bring the same name into one set are a compile error on the second import. Rename one where it is imported: `import charts.card as chart_card;`.

### Files

- **.xtmdpack** (definitions): `package`, then imports, then declarations: `enum`, `record`, `token`, `type`, `interface`, `fn`, `widget`, `extern`, `tokens`, `pack` and top-level `let`s. A view statement outside a widget is a compile error, and so is a `mut` at the top of the file, which points to `$state` (rule 17).
- **.xtmd** (documents): definitions, a `@@@` line, and the document. The definitions are what a .xtmdpack file holds, without `package` and `pack`, and two things only a document has: one `$state` block, and `expose` blocks. In a .xtmdpack file, each of those is a compile error. The document is Markdown, with widget calls and control lines in it.

A document is one scope. Everything declared above the `@@@` line can be used anywhere below it.

#### Definitions and document

Above the line is code, below it is Markdown. A layout of rows, buttons and loops is a widget above the line, and the document calls it.

````markdown
import kit;

$state {
    tries: int = 0;
}

record service {
    name: text;
    up: bool;
}

let services: list<service> = [
    service { name = "api", up = true },
    service { name = "worker", up = false },
];

widget board() {
    view {
        @column(gap = space.M) {
            for (s in services) {
                @row(justify = justify.BETWEEN) {
                    @label(value = s.name);
                    @icon(name = s.up ? glyph.CHECK : glyph.CROSS, tone = s.up ? color.OK : color.BAD);
                }
            }
            match (page.width) {
                case width.NARROW {
                    @label(value = "On a phone");
                }
                case width.MEDIUM, width.WIDE {
                    @label(value = "On a screen");
                }
            }
            @press(label = "Retry", click = fn() { $state.tries = $state.tries + 1; }) {
                @icon(name = glyph.RESET);
            }
        }
    }
}
@@@
# Release week

Three fixes shipped.

@board;

It has been retried \{$state.tries} times.

@card(title = "Deploys", tone = color.INFO) {
    We shipped **42** times, up from 37.
}

@if ($state.tries > 2) {
    Something is wrong with the worker.
} else {
    The worker is fine.
}

\@ops is the team that gets the alert.
````

- **The `@@@` line**: The first line that holds only `@@@` ends the definitions. It can never be valid code, because an `@` needs a name after it, so the definitions never need escaping. To show `@@@` as text in the document, write `\@@@`. A second unescaped `@@@` line is a compile error.
- **No `@@@` line**: The whole file is the document, with only core imported.
- **Below the line**: Everything is Markdown. A fenced code block marked `xtmd` is shown as code, like any other.
- **A widget declared in a document may leave out `markdown`**: Extended Mark builds it from the view, with the starting values. A branch that depends on a variable, a `$state` field or the widget's own, gets a warning naming the line, and writing a `markdown` block replaces the built one. In a .xtmdpack file the block is required.
- **`$state`**: One block, anywhere above the line, and a second one is a compile error. Its fields are written like a record's, each with its type and a starting value, and its `require` blocks link them (page 2).
- **Front matter**: YAML front matter, if a document has it, stays at the very top, above the definitions, and is passed to the app untouched.
- **Where they overlap**: A call with no block, such as `@stats(items = rows);`, and a call whose block holds only other calls are written in the document. A widget above the line is for what Markdown can't say: loops over data, `match`, buttons and variables.

### Prose

Prose is view code in another notation. The Markdown Extended Mark extends is CommonMark, with GitHub's tables, task lists, strikethrough, footnotes and bare links. Each Markdown block is drawn by the extern widget of the same kind: a paragraph by `paragraph`, a heading by `heading`, a list by `bullets` and its `item`s, and so on for `quote`, `code`, `math`, `divider`, `table` and `footnote`. Every implementer draws these natively, which is what makes Extended Mark a superset of Markdown.

- **Inline Markdown is parsed by core**, in Extended Mark, when the page is compiled. Bold, italics, strikethrough, links, code spans, inline maths, pictures and footnote marks become `rich_text`: a list of segments, each a `part` with its `marks` (page 5). Each paragraph reaches `paragraph` with its text and its holes kept apart, so a hole's value is always a segment of its own, plain text or a view, and can never turn into formatting. No implementer parses Markdown.
- **Markdown out** keeps the meaning in one spelling for each block and mark, listed below. The source isn't kept byte for byte.
- **Raw HTML** is shown as text, never run. An HTML comment is raw HTML too, so it shows, with a warning that says to write `@//`, prose's own comment.

Extended Mark reads six things in prose and leaves the rest to Markdown.

| What | Written | The rule |
|---|---|---|
| A call | `@card(title = "Deploys") {` | `@name`, then its arguments in parentheses if it has any (they may run over several lines), then ` {` when a block follows or `;` when none does. |
| A control line | `@if ($state.tries > 2) {` | `@if`, `@for`, `@mut for` and `@match`, with `} else {`, `} else if (…) {` and `case … {` lines inside. |
| A named slot | `@slot actions {` | Only directly inside a call's block, for a widget with several slots. |
| A hole | `\{$state.tries}` | Anywhere in a line, except in a code span or a fenced or indented code block. |
| Maths | `$x^2$`, or a `$$` line | Inline maths sits between two `$` on one line, paired as Escapes below says. A line that holds only `$$` opens a maths block, drawn by `math`, and the next such line closes it. |
| A comment | `@// for whoever edits the file` | `@//` to the end of its line. Nothing draws it and Markdown out leaves it out. It ends no paragraph: the lines around it read as if it weren't there. |

- **A line that starts with `@` and a small letter is always Extended Mark**: a call, a control line or a named slot. If the name is none of those, it is a compile error that says to write `\@`, so a typing mistake is never shown as text.
- **A line that starts with `@//` is a comment**, and `\@//` shows one as text. It is prose's only comment: `//` on its own is text, as in any Markdown.
- **`\@` is a literal @** anywhere in prose outside code. Plain Markdown shows `\@` as @ too, so the file reads the same without Extended Mark. An `@` that does not start a line is text, so email addresses and mentions in a sentence need nothing.
- **Indentation**: A block's lines are read with their common indent taken off, as a `markdown` block's are: the least indent of the block's own lines, leaving out blank lines, the lines inside a fence or a maths block, and the lines of a block nested in it, which have their own. So a block may be indented at any depth, and `xtmd fmt` indents each one four spaces past its opening line. Then, as at the top of the prose, a call, a control line or a comment may be indented by up to three spaces, and four or more make a Markdown code block, which is literal. A line that holds only `}`, or starts `} else`, may sit at any indent.
- **Quotes and list items**: A call, a control line, a comment or a closing `}` can't start inside a Markdown quote or list item. It is a compile error that says to put the call in `@quote`, or in `@bullets` and `@item`, instead. Inside a quote or a list item, an `@` at the start is written `\@`: `> \@ops is the team on call this week.`
- **Where a block ends**: At the next line that holds only `}`, whatever its indent, counting the blocks opened in between. A fenced code block inside it is skipped whole. To show a line that holds only a brace, write `\}`.
- **What a block holds**: A call's block is prose, and it fills the widget's only slot. A widget with several slots gets one `@slot name {` block per slot. Inputs go in the parentheses only.
- **Within a sentence**: A call is always a block of its own. To put a view inside a sentence, put it in a hole: `Status: \{@icon(name = glyph.CHECK)} done`.
- **Loops in prose**: `@for (x in xs) {` and `@mut for (t in todos) {` repeat their lines once per item. In `@mut for`, `t` is an `opt` for the real item (page 2), and `@if (mut x: todo = t) {` opens it to hand the item to a `mut` input. The control lines add nothing themselves. List items that follow one another make one list, across iterations too, and any other block ends it. A list that ends up with no items writes nothing. Neither loop can change anything while the page is drawn.
- **`$state` in prose** is written where code is: in a call's arguments, a control line or a hole, as in `\{$state.tries}`. In a sentence, `$` starts maths as always, so a bare `$state.tries` is shown as text, with a warning that says to put it in a hole.

````markdown
@box(title = "Build") {
    @// the build's own buttons go first
    @slot actions {
        @press(label = "Retry", click = retry);
    }
    @slot body {
        It passed in **4 minutes**.
    }
}
````

#### Escapes

Each place has its own escapes.

| Where | Escapes |
|---|---|
| Prose text, and a `markdown` block | `\{…}` is a hole, and `\\{` shows `\{`. `\@` shows an at sign, `\}` a closing brace and `\$` a dollar sign. Any other backslash is CommonMark's. |
| Maths | `\{…}` is a hole, and `\\{` gives TeX `\{`. Any other backslash reaches TeX as written, so `\\`, `\$` and `\_` are TeX's. |
| Code spans, fenced code and indented code | None. Every character is shown as written, and there are no holes. |
| A text literal in code | `\"`, `\\`, `\n`, `\t`, `\u{…}` and the hole (Text and holes, below). |

- **Pairing `$`**: An opening `$` is followed by a character that is not a space. It pairs with the next `$` on its line, skipping `\$`, and that one closes the maths when it follows a character that is not a space and is not followed by a digit. If it can't close, the opening `$` is text. So `It costs $5 and $6` is text, and in `It costs $5 and $6 dollars, $x$ in total` only `x` is maths.
- **Maths never spans lines.** A formula on lines of its own goes between two `$$` lines, and an inline `$` never pairs across one.
- **A hole in maths** is read whole before the closing `$` is looked for, so in `$x^\{$state.n}$` the `$` of `$state` never closes the maths.

#### Markdown out

Every implementer writes each block and mark with one spelling. A character in a value that Markdown would read, such as a `*` or a `$`, is written with a backslash in front.

```txt
bold            **x**
italics         *x*
strikethrough   ~~x~~
code span       `x`
link            [x](url)
picture         ![alt](src)
footnote        [^1] in the text, and [^1]: at the end of the page
hard break      a backslash at the end of the line
heading         # x, ## x and so on, one # per level
bullet          - x
numbered        1. x
task            - [x] and - [ ]
quote           > x
divider         ---
code block      a fence of three backticks, with the language after it
maths           $x$ in a line; a block between two lines that hold only $$
table           | a | b |, then a |---| row; :---: centres a column and ---: puts it at the end
```

### Text and holes

`\{expr}` puts a value in text. It is always replaced: in a text literal, in prose, in a `markdown` block and in maths. The value has to fit `shown`, be a view, or be an `opt` of one.

- **A value that fits shown** is put in as plain characters. In prose and in a `markdown` block they are escaped, so a `*` in the value shows as a star and can never become formatting, a link or a widget.
- **A view** is drawn where the hole sits. In a `markdown` block its Markdown goes there. A `text` can't hold a view, so a view in a hole of a `text` literal is a compile error.
- **An `opt`** makes the literal an `opt`: with `change: opt<text>`, `"was \{s.change}"` is an `opt<text>`, and `opt.NONE` when `s.change` is. A literal with no `opt` hole is a plain value. A paragraph takes a `rich_text`, not an `opt`, so in prose and in a `markdown` block a paragraph with an `opt` hole is a compile error that names the hole. Give a fallback in the hole, `\{s.change.or("none")}`, or open it first with `@if (let c: text = s.change) {`.
- **`\\{x}`** shows the characters `\{x}`. In maths it hands `\{` to TeX as its literal brace, so set notation is `$\\{ x \}$`.
- **A literal of another type** keeps its text and its holes apart, as a `template` (page 4), and its type's `from` makes the value when the page is compiled. A hole is never read as part of the literal, so only types that place their holes take them: `text`, `rich_text`, `md` and `latex`. A literal whose `from` would have to read a hole, such as `"\{year}-01-01"` for a `date`, is a compile error that names the hole and says to build the record instead (page 2).
- **An `md` value** holds Markdown blocks, parsed by core when the value is made: `let note: md = "**42** deploys, by \{who}";` keeps `who` plain text, and `@blocks(value = note);` places the blocks (page 5). What a reader typed becomes Markdown only when the code asks for it by name, with `md.from(template.of(entry))`.
- **A text literal** is written between double quotes on one line. Its escapes are `\"`, `\\`, `\n`, `\t`, `\u{…}` with a Unicode number in hex, and the hole. Texts are joined with holes: `"\{first} \{last}"`. There is no `+` on text.

A `markdown` block needs no quotes. It is prose, with its common indent removed, and it is read exactly as prose below the `@@@` line is: it makes the same Markdown blocks, a hole's value is never read as Markdown, and it ends like any prose block.
