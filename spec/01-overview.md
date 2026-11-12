# Overview

MKP (Markdown Markup) is a statically typed language for drawing widgets in Markdown documents. This page has the rules, the words, the two file types and how a document is read.

> **The language in five lines**
>
> `@name(…)` builds a widget. A `token` is the look, used by name. Everything is constant unless it says `mut`. A fn that returns a value changes nothing. A document is its definitions, a `@@@` line, then Markdown.

| | |
|---|---|
| Keywords | **40** |
| File types | **2** (.mkp and .mkp.md) |
| Rules | **19** |

### The rules

1. **Two file types.** .mkp holds definitions only and can't draw. .mkp.md is a document: definitions, then a line that holds only `@@@`, then Markdown that MKP renders. Nothing above the line draws, and below it an `mkp` code fence is ordinary code.
2. **@ starts a view.** `@name(…)` builds a widget. A fn that returns a view is called with @ too, and `@name` stands for a view held in a value. A view written as a statement inside a view is drawn there. Empty parentheses can be left out: `@column { … }`.
3. **The look comes from tokens.** A `token` is a record whose values are written out only in a `tokens` block, and used everywhere else by name: `tone = color.OK`, `gap = space.M`. No widget writes a colour or a pixel size inline. MKP has no attributes, so a `#` at the start of a line is always a Markdown heading.
4. **Constant by default, mut to change.** Locals, global variables, a widget's own variables, inputs, parameters and record fields. Everything is passed by reference: a plain parameter or input is read-only, and `mut` on it lets the fn or widget write through it to the caller's value. The caller's variable may have a narrower contract than the input, and every value written back is checked against it. To assign `a.b`, both `a` and `b` have to be mut.
5. **Types follow names, and definitions write them.** `name: type`. Names are small, with `_` between words (`text_size`, `remove_where`), and capitals mean three things that never meet: an enum case or a token after its type and a dot (`color.OK`), and a type parameter on its own (`list<T>`, `opt<T>`). So a small name in front of capitals is always a type, and a bare capital is always a type parameter. Every `let` and `mut`, field, input and parameter writes its type. A fn with no return type returns nothing. A lambda written where a fn type is expected may leave its types out and takes them from there.
6. **Every statement ends with a semicolon.** A statement that is itself a block needs none: `if`, `for`, `match`, a declaration with a body, and a widget call with a block. A statement that only ends in a block, such as `let f: fn() = fn() { … };`, still takes one. In code, line breaks mean nothing.
7. **One brace layout.** An opening brace ends its line, and a closing brace starts its own line. In prose this is grammar, because it is how a block's end is found. In code it is the required style: a compiler reports another layout as a warning and never reads it differently. Empty blocks, one-line data, lambdas and case bodies may stay on one line.
8. **Inputs go in the parentheses, slots go in the block.** `name = value` in the parentheses sets an input or an event. The block after the call fills the slots: the children directly when the widget has one slot, or one named block per slot. In code a named block can also set inputs, one `name = value;` per line. Setting anything twice is an error.
9. **Every name is declared or imported, and declared once.** There are two sets of names, types and values, and where a name is written says which set it is looked up in. A declaration can't reuse a name that is already visible in its set. core is imported by every file without saying so.
10. **A small built-in layer, a library for the rest.** Built in is what the syntax itself makes: eight types and six interfaces. Everything else is declared in core, written in MKP. A type fits an interface when it has what the interface asks for, and that is how a pack's type joins the syntax: literals, holes, comparisons and arithmetic. Writing `implements` is a promise that is checked where it is written.
11. **Widget calls name every argument, and an event takes a fn.** `key = value`. Plain fns take arguments in order. An event is set to a fn that runs when it fires, never to a call.
12. **A match covers every case, and there is no null.** An opt value has to be opened before use.
13. **Two loops, and every loop ends.** `for` reads. `mut for` can change each item and the list, which it reads again for every iteration. Both walk a list or a range, so there is no while loop and a document can never hang a page. Rows follow positions, so a row's values live in its item or with the caller.
14. **One hole, always replaced.** Backslash and braces around an expression, in text, prose and maths. A second backslash escapes it. Code spans and fenced code are literal. Text that a hole puts into Markdown is never read as Markdown.
15. **Every widget has a markdown block.** So the Markdown of any view is always complete. A widget declared in a document may leave it out, and MKP builds it from the view. Markdown's own blocks, such as `paragraph` and `heading`, are extern and write themselves out as the block they stand for.
16. **Widgets can't inherit.** Reuse is by calling, slots, interfaces and fns added to types.
17. **Variables live while the file is open.** A `mut` at the top of a file is a global variable, one per file. A `mut` in a widget is that widget's own variable, one per use of the widget. Nothing persists across sessions. Keeping something goes through an extern block.
18. **A fn that returns a value changes nothing.** Only a fn with no return type can assign variables, fire an event or call the app. A view, a markdown block, a `require` and a starting value can only call the first kind, so drawing a page never changes it.
19. **No exceptions.** Trouble that can be expected is an `opt`, and the code has to open it. A bug at run time, such as a division by zero, is a failure: it is contained to its widget and listed on page 6.

```txt
package import enum record type interface implements widget extern expose fn pack tokens
mut let event invoke view markdown require if else for in match case return only step
void any param slot try with self true false
as token
```

A keyword can never be a name, after a dot included. `uses` and `provides` are words only inside a `pack` block, so they stay free as ordinary names.

### Names

Two sets of names exist, and the place a name is written decides which set it is looked up in.

| Set | Holds | Looked up when the name is written |
|---|---|---|
| Types | built-in types, records, enums, `type` names, interfaces, widgets, and type parameters (capitals) | after a colon, inside `<…>`, after `implements` or `any`, in front of a record's braces, and in front of `.CAPITALS` |
| Values | `let` and `mut` variables, parameters, inputs, slots, loop variables, fns, extern blocks | everywhere else |

- **`color.OK`**: capitals after the dot, so `color` is a type and `OK` is one of its enum cases or tokens. This holds even where a value called `color` is visible.
- **`T`**: a capital on its own is always a type parameter, declared in the `<…>` after a fn, a widget or a record: `fn first<T>(xs: list<T>): opt<T>`. Enum cases and tokens are never written on their own, so the two can't be confused.
- **`page.width`**: small after the dot, so `page` is a value and `width` is one of its fields or fns.
- **`align: align = align.STRETCH`**: an input named `align`, of the type `align`, starting as the case `STRETCH` of the type `align`. Each `align` has one reading.
- **After `@`**: the name is looked up as a value first (a slot, a view held in a value, a fn) and as a widget second. A slot, a fn that returns a view and a value that holds a view can't take the name of a visible widget, so the order never matters.
- **No shadowing.** A `let`, `mut`, parameter, input, slot, loop variable or fn can't take a name that is visible in the value set where it is declared. Fields and fns of a type are reached through a dot, so they are not in the way.
- **Clashing imports.** Two imports that bring the same name into one set are a compile error on the second import. Rename one where it is imported: `import charts.card as chart_card;`.

### Files

- **.mkp** (definitions): `package`, then imports, then declarations: `enum`, `record`, `token`, `type`, `interface`, `fn`, `widget`, `extern`, `expose`, `tokens`, `pack`, constant `let` and global `mut` variables. A view statement outside a widget is a compile error.
- **.mkp.md** (documents): definitions, a `@@@` line, and the document. The definitions are what a .mkp file holds, without `package` and `pack`. The document is Markdown, with widget calls and control lines in it.

A document is one scope. Everything declared above the `@@@` line can be used anywhere below it.

#### Definitions and document

Above the line is code, below it is Markdown. A layout of rows, buttons and loops is a widget above the line, and the document calls it.

````markdown
import kit;

mut tries: number = 0;

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
            @press(label = "Retry", click = fn() { tries = tries + 1; }) {
                @icon(name = glyph.RESET);
            }
        }
    }
}
@@@
# Release week

Three fixes shipped.

@board;

It has been retried \{tries} times.

@card(title = "Deploys", tone = color.INFO) {
We shipped **42** times, up from 37.
}

@if (tries > 2) {
Something is wrong with the worker.
} else {
The worker is fine.
}

\@ops is the team that gets the alert.
````

- **The `@@@` line**: The first line that holds only `@@@` ends the definitions. It can never be valid code, because an `@` needs a name after it, so the definitions never need escaping. To show `@@@` as text in the document, write `\@@@`. A second unescaped `@@@` line is a compile error.
- **No `@@@` line**: The whole file is the document, with only core imported.
- **Below the line**: Everything is Markdown. A fenced code block marked `mkp` is shown as code, like any other.
- **A widget declared in a document may leave out `markdown`**: MKP builds it from the view, with the starting values. A branch that depends on a `mut` variable gets a warning naming the line, and writing a `markdown` block replaces the built one. In a .mkp file the block is required.
- **Front matter**: YAML front matter, if a document has it, stays at the very top, above the definitions, and is passed to the app untouched.
- **Where they overlap**: A call with no block, such as `@stats(items = rows);`, and a call whose block holds only other calls are written in the document. A widget above the line is for what Markdown can't say: loops over data, `match`, buttons and variables.

### Prose

Prose is view code in another notation. The Markdown MKP extends is CommonMark, with GitHub's tables, task lists, strikethrough, footnotes and bare links. Each Markdown block is drawn by the extern widget of the same kind: a paragraph by `paragraph`, a heading by `heading`, a list by `bullets` and its `item`s, and so on for `quote`, `code`, `math`, `divider`, `table` and `footnote`. Every implementer draws these natively, which is what makes MKP a superset of Markdown.

- **Inline Markdown is parsed by the compiler.** Bold, italics, strikethrough, links, code spans, inline maths, pictures and footnote marks become `rich_text`: a list of segments, each a `part` with its `marks` (page 5). No implementer parses Markdown, and a hole's value is always a plain `TEXT` segment, so it can never turn into formatting.
- **Markdown out** keeps the meaning in one spelling: `**` for bold, `*` for italics, `-` for a bullet. The source isn't kept byte for byte.
- **Raw HTML** is shown as text, never run.

MKP reads five things in prose and leaves the rest to Markdown.

| What | Written | The rule |
|---|---|---|
| A call | `@card(title = "Deploys") {` | `@name`, then its arguments in parentheses if it has any (they may run over several lines), then ` {` when a block follows or `;` when none does. |
| A control line | `@if (tries > 2) {` | `@if`, `@for`, `@mut for` and `@match`, with `} else {`, `} else if (…) {` and `case … {` lines inside. |
| A named slot | `@slot actions {` | Only directly inside a call's block, for a widget with several slots. |
| A hole | `\{tries}` | Anywhere in a line, except in a code span or a fenced code block. |
| Maths | `$x^2$` | The opening `$` is followed by a character that is not a space, and the closing `$` follows one and is not followed by a digit. So `It costs $5 and $6` is text. `\$` is always a dollar sign. |

- **A line that starts with `@` and a small letter is always MKP**: a call, a control line or a named slot. If the name is none of those, it is a compile error that says to write `\@`, so a typing mistake is never shown as text.
- **`\@` is always a literal @**, anywhere in prose. Plain Markdown shows `\@` as @ too, so the file reads the same without MKP. An `@` that does not start a line is text, so email addresses and mentions in a sentence need nothing.
- **Indentation**: A call or a control line may be indented by up to three spaces. Four or more make it a Markdown code block, which is literal.
- **Where a block ends**: At the next line that holds only `}`, counting the blocks opened in between. A fenced code block inside it is skipped whole. To show a line that holds only a brace, write `\}`.
- **What a block holds**: A call's block is prose, and it fills the widget's only slot. A widget with several slots gets one `@slot name {` block per slot. Inputs go in the parentheses only.
- **Within a sentence**: A call is always a block of its own. To put a view inside a sentence, put it in a hole: `Status: \{@icon(name = glyph.CHECK)} done`.
- **Loops in prose**: `@for (x in xs) {` and `@mut for (t in todos) {` repeat their lines once per item. The control lines add nothing themselves, so list items written in a loop make one list. Neither can change anything while the page is drawn.

````markdown
@box(title = "Build") {
@slot actions {
@press(label = "Retry", click = retry);
}
@slot body {
It passed in **4 minutes**.
}
}
````

### Text and holes

`\{expr}` puts a value in text. It is always replaced: in a text literal, in prose, in a `markdown` block and in maths. The value has to fit `shown`, or be a view.

- **A value that fits shown** is put in as plain characters. In prose and in a `markdown` block they are escaped, so a `*` in the value shows as a star and can never become formatting, a link or a widget.
- **A view** is drawn where the hole sits. In a `markdown` block its Markdown goes there. A view can't go in a hole inside a text literal.
- **`\\{x}`** shows the characters `\{x}`. In maths it hands `\{` to TeX as its literal brace, so set notation is `$\\{ x \}$`.
- **An `md` value** is put in as Markdown, not escaped: `let note: md = "**42** deploys";` and `\{note}` shows the number in bold. Only a literal written in code becomes `md` (page 5), so nothing a reader types ever turns into markup.
- **A text literal** is written between double quotes on one line. Its escapes are `\"`, `\\`, `\n`, `\t`, `\u{…}` with a Unicode number in hex, and the hole. Texts are joined with holes: `"\{first} \{last}"`. There is no `+` on text.

A `markdown` block needs no quotes. It is prose, with its common indent removed, and it ends like any prose block.
