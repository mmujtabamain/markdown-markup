# Syntax messages: what changed

Files: `packages/core/src/syntax/{lexer,expr,doc,mkp}.ts`. Codes and severities are unchanged. "after" is what the
rebuilt CLI prints for the dataset block (via `build/replay.py`, or the builder's trial for E365 to E370, whose
blocks only trigger inside a pack's manifest.mkp).

## Messages in the dataset

| id | code | before | after |
|---|---|---|---|
| E296 | `mkp.tab` | tabs are not allowed in indentation; indent with two spaces | this line is indented with a tab, but MKP indents with spaces only; found a tab at column 1. Replace the tab with spaces, two for each level of nesting |
| E297 | `mkp.unclosed-text` | a """ long text is never closed; end it with a line holding """ | the long text opened with """ on this line is never closed; found the end of the block before a closing """. Add a line holding only """ where the text ends |
| E298 | `mkp.unclosed-bracket` | a bracket is never closed | the `(` here is never closed, so every line after it was read as part of this one; found no matching `)` before the end of the block. Add `)` where the bracketed part ends |
| E299 | `mkp.indent` | this line is indented 6 spaces; children are indented two spaces below their parent (4) | this line is indented 6 spaces, but a line goes at most two spaces deeper than the line it sits under (`row`, at 2); found 6. Indent it 4 spaces to put it under `row`, or 2 to line it up with it |
| E300 | `mkp.indent` | indentation must be a multiple of two spaces | indentation must be a multiple of two spaces; found 5 spaces on this line. Indent it 4 spaces, or 6 to put it under `text "a"` |
| E301 | `mkp.syntax` | unexpected ")" after the expression | the expression has a `)` with no `(` to match it; found `)` after `n * 2`. Remove the `)`, or add the `(` it closes |
| E302 | `mkp.syntax` | expected ":" but found "1" | the record field `a` needs `:` between its name and its value; found `1`. Write `{a: 1}` |
| E303 | `mkp.syntax` | comparisons do not chain; join them with "and" | comparisons can't be chained; found a second `<` after `1 < n`. Write two comparisons joined with `and`: `1 < n and n < 5` |
| E304 | `mkp.syntax` | expected a field name after "." | `.` after `p` must be followed by a field name; found `(`. Write the field's name, e.g. `p.x` (a point's parts are `.x` and `.y`), or use `p[i]` for an item of a list |
| E305 | `mkp.syntax` | "and" cannot start a value here | a value is needed after `1 +`; found `and`, which only joins two conditions (`a and b`). Put a value here, such as a number or a name, or remove the `and` |
| E306 | `mkp.syntax` | expected a field name in the record | a record field's name must be a word or a quoted text; found `1`. Write e.g. `{a: …}`, or quote it: `{"1": …}` |
| E307 | `mkp.syntax` | there is no \|x\|; write abs(x) | MKP has no `\|x\|` for absolute value; found `\|`. Write `abs(x)` instead, e.g. `abs(n - 3)` |
| E308 | `mkp.syntax` | unexpected "*" | a value is needed at the start of the expression, such as a number, a name, a quoted text or a bracket; found `*`. `*` goes between two values: write one before it, e.g. `2 * 3` |
| E309 | `mkp.syntax` | the expression ends too early | the expression `n +` stops before its last value; found the end of the expression after `+`. Finish it, e.g. `n + 1`, or remove the trailing `+` |
| E310 | `mkp.front-matter` | the front matter is never closed with --- | the front matter that opens with `---` on line 1 is never closed; found no line holding only `---` (or `...`) after it. Add a `---` line where the front matter ends, before the first heading or text |
| E311 | `mkp.container` | the container :::row is never closed with ::: | the container `:::row` opened here is never closed; found the end of the document first. Add a line holding only `:::` (3 colons, as many as it opens with) where the container ends |
| E312 | `mkp.attrs-orphan` | attributes must follow a block | the attribute line `{#intro}` has no block above it to attach to (attributes apply to the block just before them); found it at the start of the document. Move it to the line right after its heading or block, e.g. `# Notes` then `{#intro}` |
| E313 | `mkp.syntax` | expected name@N, found "distance" | the part name needs its version, written name@N (a pack's definitions are versioned); found `distance`. Write `part distance@1` |
| E314 | `mkp.syntax` | "dist/ance" is not a valid name (letters, digits, ".", "-" and "_") | `dist/ance` is not a valid part name: a name starts with a letter or `_` and uses only letters, digits, `.`, `-` and `_`; found `/` in it. Rename it, e.g. `part dist-ance@1` |
| E315 | `mkp.syntax` | expected a quoted description, found kilometres | a description must be quoted text; found `kilometres` where it goes. Put it in double quotes, e.g. `"kilometres"`, or remove it |
| E316 | `mkp.syntax` | expected name@N | `part` needs a name with its version after it (name@N), then its description in quotes; found nothing. Write e.g. `part distance@1 "A distance."` |
| E317 | `mkp.syntax` | expected a name | `part` needs a name after it (letters, digits, `.`, `-` and `_`), then its description in quotes; found nothing. Write e.g. `part gauge "A dial."` |
| E318 | `mkp.syntax` | "tally/count" is not a valid name (letters, digits, ".", "-" and "_") | `tally/count` is not a valid part name: a name starts with a letter or `_` and uses only letters, digits, `.`, `-` and `_`; found `/` in it. Rename it, e.g. `part tally-count` |
| E319 | `mkp.syntax` | "item" is not a type parameter: one capitalised word, such as S or Item | type parameters after `of` are single words starting with a capital letter (each stands for a type, told from what the widget is given); found `item`. Write e.g. `tally of Item "…"` |
| E320 | `mkp.syntax` | of names the type parameters: name of S | `of` after `tally` must be followed by type parameter names (capitalised words, each standing for a type, like `T`); found the description instead. Write e.g. `tally of T "…"`, or remove `of` |
| E321 | `mkp.syntax` | unexpected ""per click"" after the description | `tally` takes one description; found a second text, `"per click"`, after it. Join the two into one quoted text, or remove `"per click"` |
| E322 | `mkp.syntax` | expected interface name@N | `interface` needs a name with its version after it (name@N), then its description in quotes; found nothing. Write e.g. `interface scored@1 "Something with a score."` |
| E323 | `mkp.syntax` | an interface lists in, host, signal and out lines, and "project md" | an interface may list only `in`, `host` (data the host sets), `signal` and `out` lines, and `project md`; found a `var` line (`var tries int = 0`). Remove that line: a widget that implements the interface may still have it |
| E324 | `mkp.syntax` | a document cannot declare an extern; externs are what a provider draws | a document can't declare `extern gauge`: an extern is a widget drawn by the app's own code, so only a pack declares one; found `extern` here. Remove `extern` to write the widget in MKP (`gauge "…"` with its lines below), or move it to a pack |
| E325 | `mkp.syntax` | interfaces belong to a host, in its pack; a document cannot declare one | a document can't declare `interface scored@1`: an interface says what a host app relies on, so it is declared in the host's pack; found `interface` here. Move it into a .mkp file of that pack, or remove it and give the widget its `in` lines directly |
| E326 | `mkp.syntax` | expected "type name = {field: type, …}" | `type Score` needs `=` and the type it names; found no `=`. Write e.g. `type Score = {value: num}` (a record of fields and their types) |
| E327 | `mkp.syntax` | "2d" is not a valid type name | `2d` is not a valid type name: a name starts with a letter or `_` and uses only letters, digits and `_`; found `2` at its start. Rename it, e.g. `type d2 = …` |
| E328 | `mkp.syntax` | an op is one of + - * / ^ == < from point | `~` is not an operator you can define; found `op ~(a, b)`. Define one of `+ - * / ^ == <`, `from` (turns another type into this one: `op from(n: num): vec2 = …`) or `point` (makes a point of it: `op point(v: vec2): point = …`) |
| E329 | `mkp.syntax` | expected "const name[: type] = expression" | `const limit` needs `=` and its value; found no `=`. Write e.g. `const limit = 10` (a type may come before `=`: `const limit: int = 10`) |
| E330 | `mkp.syntax` | "2x" is not a valid name | `2x` is not a valid constant name: a name starts with a letter or `_` and uses only letters, digits and `_`; found `2` at its start. Rename it, e.g. `const x2 = …` |
| E331 | `mkp.syntax` | expected "macro name = $…$" | `macro R` needs `=` and the maths it stands for (a macro names a piece of maths, written `\R` inside $…$); found no `=`. Write e.g. `macro R = $\mathbb{R}$` |
| E332 | `mkp.unknown-statement` | a top-level line starts a definition (name@N, part, extern), tokens, type, fn, op, const, macro or pack; found "include" | a top-level line starts a definition; found `include`. Start it with a widget name and its description (`tally "A running count."`) or one of `part`, `tokens`, `type`, `fn`, `op`, `const` or `macro`, or remove the line |
| E333 | `mkp.syntax` | expected an expression | `const limit =` has nothing after it, where a value is needed; found the end of the line. Write the expression after it, e.g. `const limit = 0` |
| E334 | `mkp.syntax` | "2x" is not a valid function name | `2x` is not a valid function name: a name starts with a letter or `_` and uses only letters, digits and `_`; found `2` at its start. Rename it, e.g. `fn x2(…)` |
| E335 | `mkp.syntax` | the parameter list is never closed | the parameter list of `fn area` opened with `(` is never closed; found no `)`. Add `)` after the last parameter, e.g. `fn area(w: num, h: num): num = …` |
| E336 | `mkp.syntax` | "2w" is not a valid parameter name | `2w` is not a valid parameter name: a name starts with a letter or `_` and uses only letters, digits and `_`; found `2` at its start. Rename it, e.g. `w2` |
| E337 | `mkp.syntax` | expected "= expression" after the parameters | `fn area(w, h)` needs `=` and the expression it gives; found nothing after the parameters. Write the result type and body, e.g. `fn area(w, h): num = …` |
| E338 | `mkp.syntax` | expected ": type" or "=" after the parameters | the result type of `fn area` comes after `:`, between the parameters and `=`; found `num` with no `:`. Write `fn area(w, h): num = …` |
| E339 | `mkp.syntax` | unexpected "extra" after the type | after the type in `in start int` only `answer` (marks the input holding the answer), `= default` or a "description" may follow; found `extra`. Remove it, or quote it and put it last if it is the description: `in start int = 3 "extra"` |
| E340 | `mkp.syntax` | expected a value after "=" | `in start int =` has nothing after `=`; found the end of the line. Write the default value after it, e.g. `in start int = 0`, or remove `=` |
| E341 | `mkp.syntax` | unexpected ""again"" | `in start int` takes one description; found a second text, `"again"`, after `"where it begins"`. Remove `"again"`, or join the two into one quoted text |
| E342 | `mkp.continuation` | a value takes no indented lines: to go on with its expression, break the line inside an open bracket (…) | the line `double = n * 2` can't have lines indented under it; found `+ 1` below it. Join the two lines, or bracket the expression so it may break inside: `double = (n * 2` then `+ 1)` on the next line |
| E343 | `mkp.syntax` | expected a capability such as gfx@1 | `requires` must name a capability (a feature the widget needs from the app) with its version; found nothing after it. Write e.g. `requires gfx@1`, or remove the line |
| E344 | `mkp.syntax` | expected a positive whole number of operations | `budget` takes a positive whole number: the operations one evaluation may use (1,000,000 without it, 20,000,000 at most); found `lots`. Write e.g. `budget 2000000`, with no commas |
| E345 | `mkp.syntax` | implements names an interface: implements scored@1 | `implements` must name an interface (what a host app relies on in this widget) with its version; found nothing after it. Write e.g. `implements scored@1` |
| E346 | `mkp.syntax` | "scored" is not an interface name@N | `implements` names each interface with its version, as name@N; found `scored`. Write `implements scored@1` |
| E347 | `mkp.syntax` | "2x" is not a valid input name | `2x` is not a valid input name: a name starts with a letter or `_` and uses only letters, digits and `_`; found `2` at its start. Rename it, e.g. `fields x2` (`fields` lists the inputs that bare values after the widget's name fill, in order) |
| E348 | `mkp.syntax` | expected "in name type …" | `in` needs a name and a type after it; found nothing. Write e.g. `in n int` |
| E349 | `mkp.syntax` | only an input (in) can be an answer | `answer` marks the input that holds the answer, so only an `in` line takes it; found it on the line `var n`. Remove `answer`, or make it an input: `in n int answer` |
| E350 | `mkp.missing-default` | a var always has a default: "var n type = value" | `var n int` needs a starting value: a var always has one; found no `=`. Write `var n int = 0` |
| E351 | `mkp.syntax` | expected "out name …" | `out` needs a name after it; found nothing. Write e.g. `out answered {correct: bool}` |
| E352 | `mkp.syntax` | a signal declares its payload: signal name {field: type, …} | `signal changed` needs its payload, the record of fields it sends to the host; found none. Add it in braces after the name, e.g. `signal changed {value: num}` |
| E353 | `mkp.syntax` | expected "project md = expression" or "project mermaid = expression" | `project` makes the widget's Markdown (`md`) or a Mermaid diagram (`mermaid`); found `project html`. Write `project md = "Count"` or `project mermaid = …` |
| E354 | `mkp.event-placement` | an event belongs under the element or state line it handles; indent it below that line | the event `@click` has no element to handle it: an event goes under the element or state line it reacts to; found it among the widget's own lines. Indent it two spaces under that line, e.g. under `press label="more"` |
| E355 | `mkp.syntax` | expected choice(a\|b\|…) | `choice(…)` lists its options as plain words separated by `\|`; found `choice(a\|(b))`. Write e.g. `mode = choice(a\|b)` |
| E356 | `mkp.syntax` | "2hard" is not a valid option name | `2hard` is not a valid option name: a name starts with a letter or `_` and uses only letters, digits and `_`; found `2` at its start. Rename it, e.g. `choice(easy\|hard2)` |
| E357 | `mkp.event-placement` | only events (@name action …) may be indented under a state line | the state line `speed = slider 0..10` can have only events (`@name action …`) indented under it; found `text "fast"`. Unindent it to line up with `speed = …`, or, to label the control, put the text at the end of the state line: `speed = slider 0..10 "fast"` |
| E358 | `mkp.continuation` | this line goes on with the one above, which works only inside an open bracket: put size=… on the line above, or break the line inside its (…) | `size=large` is on a line of its own, indented under `text "\val{n}"`, but a line goes on to the next only inside an open bracket; found `size=large` as a line by itself. Put it at the end of the line above: `text "\val{n}" size=large` |
| E359 | `mkp.syntax` | ""Count"" is not a valid element name | a line inside a widget starts with an element's name (like `text`, `row` or `press`); found `"Count"`. To show text, write `text "Count"` |
| E360 | `mkp.syntax` | expected "@event action …" | an event line is `@` and the event's name, then its actions; found `@` with no name after it. Write e.g. `@click set n=(n + 1)` (events include @click, @change, @enter, @leave, @submit) |
| E361 | `mkp.syntax` | an event line has one if= | an event line takes one `if=` condition; found a second, `if=(n > 0)`, after `if=(n < 9)`. Join them with `and` in one: `if=(n < 9 and n > 0)`, or put the actions on two event lines |
| E362 | `mkp.syntax` | the event "@click" has no actions | the event `@click` has no actions, so it would do nothing; found nothing after it. Add an action, such as `set name=(value)`, `reveal id` or `emit name`, e.g. `@click set n=(n + 1)`, or remove the line |
| E363 | `mkp.unknown-action` | "bump" is not an action; actions are set, play, pause, reset, reveal, hide, open, close, emit, send | `bump` is not an action; found it where an event's first action goes. Use one of set, play, pause, reset, reveal, hide, open, close, emit, send, e.g. `set n=(n + 1)` |
| E364 | `mkp.syntax` | expected a value after "n=" | `n=` has no value after it; found the end of the line. Write the value right after `=`, with no space, e.g. `n=3`, or `n=(…)` around an expression |
| E365 | `mkp.syntax` | unpublished takes nothing after it | `unpublished` is a bare flag (the pack may still change without a new version) and takes nothing after it; found `yes`. Write just `unpublished`, or remove the line once the pack is published |
| E366 | `mkp.syntax` | expected "front name type [= value] ["about"]" | `front` declares a front-matter field, as `front name type [= default] ["about"]`; found nothing after it. Write e.g. `front title text "the lesson's title"` |
| E367 | `mkp.syntax` | expected "attr name type ["about"]" (role and id are taken) | `role` can't be declared as a block attribute: `id` and `role` are built in (`{#name}` names a block, `{role=…}` gives a section its role); found `attr role`. Pick another name, e.g. `attr audience text` |
| E368 | `mkp.syntax` | a block attribute has no default: a block without it has none | the block attribute `level` can't have a default: a block that doesn't write `{level=…}` simply has no value for it; found `= 1`. Remove it: `attr level int "how hard"` |
| E369 | `mkp.syntax` | expected "rule name path [args] ["message"]" | `rule` needs a rule name and a path (`rule name path [args] ["message"]`); found only `unique`. Rules: required, one-of, pattern, max-length, count, depth, first; paths: front.<field>, blocks.<widget>, roles.<role>. E.g. `rule required front.title` |
| E370 | `mkp.syntax` | a manifest line is requires, depends, provides, front, attr, roles, rule or unpublished; found "export" | `export` is not a manifest line; a line under `pack name@N` is requires, depends (another pack), provides (names documents may use), front, attr, roles, rule or unpublished. Did you mean `provides`? e.g. `provides distance` makes `distance` usable from documents |

## Sites the dataset doesn't reach (checked with ad-hoc blocks)

Branches that were already there but whose block isn't in the dataset, and cases that used to fall into a
generic message and now get their own wording (same code, same severity, same refusal).

| code | before | after |
|---|---|---|
| `mkp.unclosed-bracket` | (same site as E298) | the message now names the bracket (`(`, `[` or `{`) and its partner |
| `mkp.indent` | this line is indented N spaces; children are indented two spaces below their parent (0)  (first line of a block indented) | this line is indented 2 spaces, but it is not under any line, so it must start at the margin; found 2 spaces. Remove the indentation, or indent the line above it less |
| `mkp.syntax` | expected "X" but found "Y" (every closing bracket, shared `expect`) | one message per place: list items / call arguments (`the arguments of max(…) must be separated by `,` and end with `)`; found `=` after argument 1. …`), index `[…]`, bracket `(…)`, point `(x, y)` (incl. a third part), record `}` and `:` |
| `mkp.syntax` | unexpected "X" after the expression (other tokens) | split by what follows: `=` (write `==`), `,` (bracket the items), a text after a text (join with `+`), anything else (put an operator between) |
| `mkp.syntax` | unexpected "X" (`)` `,` `=` `..` `=>` `.` and operators where a value goes) | `a value is needed after `max(1,`, such as a number, a name, a quoted text or a bracket; found `)`. Remove the comma before `)`` (fix chosen per token) |
| `mkp.syntax` | the expression ends too early (empty expression) | the expression is empty; found nothing where a value should be. Write a value, such as a number, a name or a quoted text |
| `mkp.syntax` | "not" cannot start a value here | a value is needed after `1 +`; found `not`, which can't sit inside arithmetic without brackets. Bracket it, e.g. `(not done)` |
| `mkp.syntax` | expected a field name in the record (trailing comma) | a record can't end with a comma; found `,` before `}`. Remove the last comma, e.g. `{a: 1, b: 2}` |
| `mkp.syntax` | expected name@N (`tokens`, `pack`, `profile` with no name) | `tokens` needs a name with its version after it (name@N); found nothing. Write e.g. `tokens brand@1 "Our colours."` (pack/profile alike) |
| `mkp.syntax` | expected name@N, found "\"x\"" (description where the name goes) | the part name is missing: found the description `"x"` where the name goes. Add a name with its version before it, e.g. `part distance@1 "x"` |
| `mkp.syntax` | "a:b" is not a valid name (prefixed name in a document) | a document's own definition takes a plain name, without a `prefix:`; found `a:b`. Write it without the prefix, e.g. `b` |
| `mkp.syntax` | unexpected "in" after the description | `tally` takes nothing after its description; found `in`. Remove it, or move it to a line of its own below, indented two spaces |
| `mkp.syntax` | an op is one of … (`op +` without brackets) | `op +` needs its parameters in brackets right after the symbol; found `op +`. Write e.g. `op +(a: vec2, b: vec2): vec2 = …` |
| `mkp.syntax` | expected "macro name = $…$" (no name / name not letters / value not maths) | one message each, e.g. the value of `macro S` must be maths in dollars; found `x`. Write it as `macro S = $x$` |
| `mkp.syntax` | "area = 3" is not a valid function name (`fn area = 3`, no brackets) | `fn area` needs its parameters in brackets after the name; found no `(`. Write e.g. `fn area(x: num): num = …` (or `fn area(): num = …` with none) |
| `mkp.syntax` | "w num" is not a valid parameter name | the parameter `w num` of `fn area` needs `:` between its name and its type; found a space. Write `w: num` |
| `mkp.syntax` | unexpected "answer" (answer after the description) | `answer` must come before the description; found it after `"about"`. Write `in n int = 0 answer "about"` |
| `mkp.syntax` | expected a value after "=" (state line `k = slider 0..2 =`) | the starting value after `=` is missing in `speed = slider 0..10 =`; found the end of the line. Write it after `=`, with a space, e.g. `speed = slider 0..10 = 1` |
| `mkp.syntax` | expected "in name type …" (invalid name) | `2x` is not a valid input name: … Rename it, e.g. `in x2 …` (same for host, var, out, signal, command) |
| `mkp.missing-default` | a host always has a default: "host h type = value" | `host h int` needs a starting value: a host input always has one, used until the host sets it; found no `=`. Write `host h int = 0` |
| `mkp.syntax` | expected "project md = expression" … (`project md "x"`) | `project md` needs `=` before its expression; found `"x"` after it. Write `project md = "x"` |
| `mkp.syntax` | "" is not a valid option name (`choice(a\|\|b)`) | an option of `choice(…)` is empty; found `choice(a\|\|b)`. Remove the extra `\|` |
| `mkp.unknown-action` | "n=1" is not an action; … | `n=1` has no action before it; found a value to set with no `set`. Write `set n=1` (actions are …); typos get "did you mean `set`?" |
| `mkp.syntax` | expected "@event action …" (`@1click`) | an event line is `@` and the event's name, then its actions; found `@1click`. Write e.g. `@click set n=1` (events include …) |
| `mkp.syntax` | expected "front name type …" / "attr name type …" / "rule …" (each case) | split into: nothing after the keyword, an invalid name, a reserved name (`id`, `role`), with an example line for each |
| `mkp.syntax` | a manifest line is …; found "part"/"x@1" (a definition in manifest.mkp) | a manifest holds only the pack's own lines; found the definition `part` in it. Move the definition into another .mkp file of the pack, and list its name with `provides` |
| `mkp.syntax` | a manifest line is …; found "depend" | … Did you mean `depends`? (nearest manifest word, or a map: export/expose/public → provides, import/include/use → depends, needs → requires) |
| `mkp.unknown-statement` | a top-level line starts …; found "unpublished" (manifest word outside manifest.mkp) | `unpublished` is a line of a pack's manifest; found `unpublished` outside it. Move it into manifest.mkp, indented two spaces under the `pack name@N` line |
| `mkp.unknown-statement` | … found "in" (member at the top level) | `in` lines belong inside a definition; found `in` at the top level. Indent it two spaces under the widget's own line (e.g. `tally "A running count."`) |
| `mkp.unknown-statement` | … found "x" (`x = 3` at the top level) | `x = …` belongs inside a definition; found `x` at the top level. Indent it two spaces under the widget's own line, or write `const x = …` for a constant |
| `mkp.unknown-statement` | … found "@click" (event at the top level) | the event `@click` must sit under the element it handles; found `@click` at the top level. Indent it under that element, inside a widget |
| `mkp.unknown-statement` | … found "tally" (widget in a pack without @N) | a widget in a pack needs its version after its name; found `tally` with none. Write `tally@1 "A running count."` |
| `mkp.unknown-statement` | … found "tally" (`tally` alone, or `tally A running count`) | a widget's line needs its description in quotes after the name; found `tally` alone. Write e.g. `tally "What it shows."` / the description after `tally` must be in double quotes; found `A`. Write `tally "A running count"` |

## Position fixes

- **E298 `mkp.unclosed-bracket`**: pointed at column 1 of the line; now at the innermost bracket left open (s03: 6:3 → 6:27; m500: 7:1 → 7:8). The lexer keeps a stack of open brackets to find it.
- **E309 (expression ends early)**: pointed just past the end; now at the last token written (the dangling `+`). A `(` left open at the end of an expression now points at that `(`, not past the end.
- **E361 (two `if=`)**: pointed at the first `if=`; now at the second, the one to remove or merge.
- **E346 `implements scored`**, **E347 `fields 2x`**: pointed at the start of the line; now at the offending name.
- **E349 `answer` on a var**: start of line → the word `answer`.
- **E350/E641 `mkp.missing-default`**: start of line → end of the line, where `= value` goes.
- **E356 option name**: start of `choice(…)` → the offending option inside it.
- **E319 type parameter**: start of the chunk → the parameter itself (matters for `of A, b`).
- **E316/E317/E322/E343/E345/E348/E351** and the tokens/pack/profile "needs a name" cases: column 1 → just after the keyword, where the missing part goes.
- **E326/E329** (`type`/`const` without `=`): column 1 → end of the line. **E327/E330** type/const name: fixed column (5/6) → where the name really starts.
- **E333** (nothing after `=`): one past the end → the `=`.
- **E365/E366/E367/E369**: column 3 (line start) → the word that is wrong or the place something is missing. **E368** → the `=`.
- **E353 `project html`**: line start → `html`. **E362 `@click` with no actions**: line start → just after `@click`.
- E338 points at the result type itself instead of the space before it.

## Left alone, and why

- **E310 front matter**: still at line 1. The fix is to add a line, and where it belongs is a guess (YAML may hold blank lines and `#` comments), so the message points at the `---` that is unclosed and says where the closing line goes.
- **Cascades after an unclosed bracket.** The lexer joins every later line into the bracketed one, so a second `mkp.syntax` message usually follows E298 (e.g. "the bracket `(` … is not closed; found `=`"). Stopping that would change what is parsed, not just the wording.
- **`mkp.indent` column** stays 1: it is the right line and the indentation is what changes.
- **Attributes after a `state` or `mkp` fence are dropped without a message** (doc.ts). Adding a warning would be new behaviour, so I did not.
- `parseType` errors (types.ts) and checker messages are other files.
- `nodeLine` gained an optional `parent` argument (only used for the E358 example); its callers elsewhere are unaffected.

## Tests

One existing assertion breaks on my wording: `packages/core/test/language.test.ts` "catch unknown names with a suggestion" expects `/write abs\(x\)/`; the message is now ``MKP has no `|x|` for absolute value; found `|`. Write `abs(x)` instead, e.g. `abs(n - 3)` ``. The other 8 failing tests in the suite are other areas' messages.
