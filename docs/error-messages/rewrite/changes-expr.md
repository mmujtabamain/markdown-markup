# Changes: expr slice (check/expr.ts, types.ts, tokens.ts, maths.ts)

Every message site in the four files was rewritten to the STYLE shape (what is wrong, what was
found, how to fix it). Codes and severities are unchanged; no new errors, no errors removed. The
"after" column for dataset rows is the replay output of the rebuilt CLI (E224 from trial
`trials/expr/q1`, which needs two packs).

New helpers inside `check/expr.ts`: `exprText` (an expression back as the author wrote it, so
messages can say `found \`n\` (int)`), `found`, `aType` (a/an), `plural`, `sample` (a short literal
of a type for examples), `USAGE`/`usage` (how each hand-typed builtin is called), `conversionHint`
(number(…), format(…), round(…), [x]), `boolFix`, `astText`, and `ExprChecker.nameOf` (a name in
scope of the right type, so an example says `len(xs)` when `xs` exists). `types.ts` gained
`tokText`, a stack of open constructors (to name `list(…)`, `choice(…)`, the record braces) and
line-end detection; `tokens.ts` gained example lines per token kind; `maths.ts` gained
`findMaths`, `mathsFix` (fixes for the common TeX errors) and `mathsMessage`.

`showType` is unchanged: its output is MKP's own type syntax (list(int), choice(a|b)), which is
what authors write, and it also builds generic-specialisation ids and IR keys, so changing it
would change compiled output.

## Dataset rows

| id | code | before | after |
|---|---|---|---|
| E184 | `mkp.type-syntax` | expected ")" in the type | expected ")" after `list(int`; found the end of the line. Add ")" to close list(…), e.g. `list(int)` |
| E185 | `mkp.type-syntax` | expected "," in the type | expected "," after `path(text`; found int. path(…) takes two types separated by a comma: the record and the type of the field it names, e.g. `path(text, int)` |
| E186 | `mkp.type-syntax` | expected a number in the range | a range in a type needs a plain number at each end, such as int 1..10; found x. Write a number there |
| E187 | `mkp.type-syntax` | expected a type | expected a type inside list(…); found 3. Write a type such as int, num, text, bool, list(int), dict(text) or a record such as {name: text} |
| E188 | `mkp.type-syntax` | expected a variable name in expr(…) | expr(…) lists the names of the variables the expression uses, e.g. expr(x) or expr(x, y), each with an optional type (expr(t: num)); found 3. Write a name such as x |
| E189 | `mkp.type-syntax` | expected an option in choice(…) | each option of choice(…) must be a word (letters, digits and _, starting with a letter), as in choice(low\|high); found 1. Write a word, e.g. n1 |
| E190 | `mkp.type-syntax` | expected the record name | list(record …) needs a name for its records after "record", e.g. list(record row {a: int}); found 5. Write a name such as row |
| E191 | `mkp.type-syntax` | expected a field name | each field of a record starts with its name, as in {title: text, count: int}; found 3. Write a name such as f3 |
| E192 | `mkp.token-value` | color brand: value must be a hex colour such as "#2563eb" | the colour token brand must be a hex colour, # and 3, 4, 6 or 8 hex digits; found blue. Write it in quotes, e.g. `color brand "#2563eb"` |
| E193 | `mkp.token-syntax` | space tokens are written name=value | a line of space tokens is a list of name=value pairs, as in `space xs=2 s=4`; found "tight", which has no name. Remove "tight", or write it as a pair: `tight=4` |
| E194 | `mkp.maths` | $\sum_{k=1}^{n} \frac{1}{k$: Missing close brace | the maths `\sum_{k=1}^{n} \frac{1}{k` can't be typeset; found this LaTeX error: Missing close brace. Add the missing "}" so every "{" is closed |
| E195 | `mkp.type` | list items must share one type; found int and text | the items of a list must all have one type; item 2, `"two"` (text), differs from the int items before it. Make every item int (e.g. `1`), or every item text |
| E196 | `mkp.type` | expected a record with title | expected a task record with title (text); found `{}`, an empty record. Write its fields, e.g. `{title: "a"}` |
| E197 | `mkp.unknown-field` | swatch has no field "colur" (did you mean "colour"?) | `sweep` is a swatch, which has no field "colur" (did you mean "colour"?); its fields are name, colour. Write `sweep.colour` |
| E198 | `mkp.unknown-field` | list(int) has no fields; "len" can't be read from it | `xs` is list(int), which has no fields, so `.len` can't be read from it. Write `len(xs)` for its length |
| E199 | `mkp.type` | task is read by a path (an input typed path(…)) or with .field; found int | `t` is a task record, so [ ] needs a path (an input of type path(…) that names one of its fields); found `n` (int). Read a field by name, e.g. `t.title`, or declare an input naming one of its fields, `in f path(task, text)`, and write `t[f]` |
| E200 | `mkp.type` | this path reads note, not task | the path `p` names a field of note, but `t` is a task. Declare the path as path(task, text) and give it a task field, or use it on a note value |
| E201 | `mkp.type` | dict keys are text; found int | the keys of the dict `d` are text; found the key `n` (int). Index it with text, e.g. `d["a"]`, or turn the number into text with `d[format(n)]` |
| E202 | `mkp.type` | only lists and dicts can be indexed; found text | only lists and dicts can be indexed with [ ]; found `label` (text). To take part of a text, write `slice(label, 0, 1)` (characters count from 0) |
| E203 | `mkp.type` | "not" needs a boolean; found int | `not` needs a bool (true or false) after it; found `n` (int). Compare it to get true or false, e.g. `not (n > 0)` |
| E204 | `mkp.type` | "and" needs booleans; found int | both sides of `and` must be bools (true or false); the left side is `n` (int). Compare it to get true or false, e.g. `(n > 0) and …` |
| E205 | `mkp.type` | a lambda (x => …) can only be passed where a function is expected | a function written with => can only be passed to a call that takes one (map, filter, sort, fold, …); found `x => x + 1` on its own. Pass it to a call, e.g. `map(xs, x => x + 1)`, or declare a fn: `fn step(x: num): num = …` |
| E206 | `mkp.type` | this function takes 1 parameter(s), not 2 | the function here is given 1 value each time, so it must take 1 parameter; found `(a, b) => a`, which takes 2. Write it as `a => …` |
| E207 | `mkp.unknown-name` | "bound" is not defined here | "bound" is not defined here. Declare it before using it (an input such as `in bound int = 1`, a var, or `const bound: int = 1` at the top), or use a defined name: n, label, on, xs, d, c |
| E208 | `mkp.type` | constant ceiling refers to itself | the constant ceiling uses itself in its own value (directly or through other constants), so it has no value. Give it a value that does not use ceiling, e.g. `const ceiling: int = 1` |
| E209 | `mkp.type` | expected int, found text | expected int here; found `label` (text). To read a number from text, write `number(label)` (and `round(number(label))` for an int) |
| E210 | `mkp.type` | can't compare int with text | `==` compares two values of the same type; found `n` (int) and `label` (text). Compare it with an int value, e.g. `n == 1`, or turn the number into text: `format(n) == label` |
| E211 | `mkp.type` | can't join list(int) and list(text) | `+` joins two lists only when their items have the same type; found `xs` (list(int)) and `["a"]` (list(text)). Make the items match, e.g. `xs + [1]` |
| E212 | `mkp.no-operator` | no operator + for list(int) and text | there is no `+` for list(int) and text; found `xs` (list(int)) and `label` (text). Use values that `+` works on: two numbers, two texts, two lists or two points |
| E213 | `mkp.ambiguous` | blend is ambiguous for (int, int): $doc:blend#0 and $doc:blend#1 fit equally | `blend` called with (int, int) fits more than one definition equally well: blend(num, int) at line 4 and blend(int, num) at line 5. Remove one of them, or change their parameter types so only one fits (int, int) |
| E214 | `mkp.type` | this function takes 1 argument(s) | `g` is a function that takes 1 argument; found 2 in `g(1, 2)`. Write `g(1)` |
| E215 | `mkp.type` | this expression takes 1 variable(s) | `f` is an expression in x (a value of type expr(x)), so a call gives it one value per variable, 1 in all; found 2 in `f(1, 2)`. Write `f(1.5)` |
| E216 | `mkp.type` | int is not a function | `twice(1)` is int, not a function, so it can't be called; found `twice(1)(2)`. Remove the brackets after `twice(1)`, or multiply with `*`: `twice(1) * (2)` |
| E217 | `mkp.type` | "n" is a int, not a function | `n` is an input of type int, not a function, so it can't be called; found `n(1)`. Remove the brackets after `n`, or multiply with `*`: `n * (1)` |
| E218 | `mkp.no-overload` | no twice(…) takes (text); candidates: twice(int) | no definition of twice takes (text); found `twice(label)`: argument 1, `label` (text), is not int. twice is defined as twice(int). Pass arguments of those types, e.g. `twice(1)` |
| E219 | `mkp.ambiguous` | pad is defined more than once with 2 parameter(s); give the parameters types so calls can be dispatched | pad is defined 2 times with 2 parameters and no parameter types, so a call can't tell which one is meant. Give each definition parameter types that differ, e.g. `fn pad(a: int, b: int): int = …`, or rename one of them |
| E220 | `mkp.type` | pad takes 2 argument(s), not 1 | pad takes 2 arguments (a, b); found 1 in `pad(1)`. Pass both: `pad(…, …)` |
| E221 | `mkp.unknown-function` | there is no function "flor" (did you mean "floor"?) | there is no function "flor" (did you mean "floor"?). Write `floor(…)` |
| E222 | `mkp.type` | \val{sw} is swatch, which has no written form; show one of its fields, or give its type a show fn | `\val{sw}` shows a swatch, which has no text form, so it can't be written into the text. Show one of its fields, e.g. `\val{sw.name}`, or declare `fn show(v: swatch): text = …` so \val can write any swatch |
| E223 | `mkp.limit` | the expression is nested too deeply | this expression nests more than 200 levels deep (operators, brackets or calls inside each other), too deep to check. Split it into named steps, e.g. `a = …` then `r = a + …` |
| E224 | `mkp.ambiguous` | "top" is a constant in several packs (scales, levels); qualify it | "top" is a constant in more than one pack (scales and levels), so it is unclear which is meant. Rename the constant in all but one of those packs, or, in a pack, list only one of them under `depends` |
| E225 | `mkp.arity` | len takes 1 argument(s), not 2 | len takes 1 argument; found 2 in `len(xs, xs)`. Call it as `len(xs)` |
| E226 | `mkp.type` | sort needs a list; found int | sort needs a list here; found `n` (int). Pass a list (an input of type list(…), or one written out like [1, 2, 3]): `sort(xs)` or `sort(xs, x => key)` |
| E227 | `mkp.type` | len needs a list, text or dict; found int | len counts the items of a list, the characters of a text or the keys of a dict; found `n` (int). Pass one of those, e.g. `len(xs)` |
| E228 | `mkp.type` | filter needs a function that returns a boolean | filter keeps the items its function says true for, so the function must return a bool; found `twice`, which returns int. Give a test, e.g. `filter(xs, x => x > 1)` |
| E229 | `mkp.type` | fold's function must return the accumulator's type int; it returns text | fold's function gets the running total and an item and must return the new total, of the same type as the start value `0` (int); found `(acc, v) => "a"`, which returns text. Return an int, e.g. `(acc, x) => acc + x` |
| E230 | `mkp.type` | flatten needs a list of lists | flatten needs a list of lists, such as [[1], [2, 3]]; found `xs` (list(int)). Pass a list whose items are lists, or drop flatten if the list is already flat |
| E231 | `mkp.type` | mean needs a list of numbers | mean needs a list of numbers; found `["a", "b"]` (list(text)). Pass numbers, e.g. `mean(xs)` |
| E232 | `mkp.type` | if needs a boolean condition; found int | the condition of if (its first argument) must be a bool (true or false); found `n` (int). Compare it to get true or false, e.g. `if(n > 0, …, …)` |
| E233 | `mkp.type` | if's branches have different types: int and text | the two results of if must have the same type; found `1` (int) when true and `"two"` (text) when false. Change `"two"` to an int (e.g. `1`), or `1` to a text |
| E234 | `mkp.type` | put needs a dict; found list(int) | put needs a dict (text keys to values) as its first argument; found `xs` (list(int)). Pass a dict, e.g. `put(d, "a", 1)` |
| E235 | `mkp.type` | this dict holds int, not text | `d` holds int values, so put can't store `"x"` (text) in it. Pass an int as the value, e.g. `put(d, "a", 1)` |
| E236 | `mkp.type` | get needs a dict; found list(int) | get needs a dict (text keys to values) as its first argument; found `xs` (list(int)). Pass a dict, e.g. `get(d, "a", 0)`; to read an item of a list, write `at(xs, i, default)` |
| E237 | `mkp.type` | the default must be int | get's third argument is the default it returns when the key is missing, so it must be int like the dict's values; found `"none"` (text). Write e.g. `get(d, "a", 1)` |
| E238 | `mkp.type` | keys needs a dict | keys lists the keys of a dict; found `xs` (list(int)). Pass a dict, e.g. `keys(d)`; a list's positions are `range(0, len(xs) - 1)` |
| E239 | `mkp.type` | has needs a dict | has checks whether a dict has a key; found `xs` (list(int)). Pass a dict, e.g. `has(d, "a")`; to test a list, write `indexof(xs, x) >= 0` |
| E240 | `mkp.type` | join needs a list of text | join needs a list of text or numbers to join into one text; found `[[1], [2]]` (list(list(int))). Pass such a list, e.g. `join(["a", "b"], ", ")`, or flatten a list of lists first with `flatten(…)` |
| E241 | `mkp.type` | sum needs a list of numbers | sum needs a list of numbers; found `["a"]` (list(text)). Pass numbers, e.g. `sum(xs)`, or add up a function over a range with `sum(lo, hi, k => …)` |
| E242 | `mkp.type` | sum over text needs + and a from(num) for that type | sum(lo, hi, k => …) adds the function's results for each whole k from lo to hi, so they must be numbers; found `k => label`, which returns text. Return a number from the function, e.g. `sum(1, 3, k => k * 2)` |
| E243 | `mkp.type` | min needs numbers | min of a list needs a list of numbers; found `["a", "b"]` (list(text)). Pass numbers, e.g. `min([1, 2, 3])`, or two numbers: `min(a, b)` |
| E244 | `mkp.type` | max takes two numbers or a list; found text and int | max takes two numbers, or one list of numbers; found `label` (text) and `n` (int). Replace `label` (text) with a number, e.g. `max(1, n)` |
| E245 | `mkp.type` | iterate's step must return the state's type int; it returns text | iterate's step function gets the current value and must return the next one, of the same type as the start value `0` (int); found `v => "x"`, which returns text. Return an int, e.g. `v => v + 1` |

## Sites and branches without a dataset row

| site | code | before | after (example) |
|---|---|---|---|
| types.ts:240 parseTypeString (not called by the compiler) | `mkp.type-syntax` | unexpected text after the type: " x" | the type \`list(int)\` is complete, but more follows it; found "x". Remove "x", or join it into the type (a range is written int 1..6) |
| types.ts expect "(" | `mkp.type-syntax` | expected "(" in the type | expected "(" after \`dict\`; found int. Write the value type in brackets, e.g. \`dict(int)\` (the keys are always text) (and per constructor: list, choice, expr, path) |
| types.ts expect ".." | `mkp.type-syntax` | expected ".." in the type | expected ".." after \`1\`; found 10. Write a range as lo..hi, e.g. \`int 1..10\` |
| types.ts expect ")" in choice | `mkp.type-syntax` | expected ")" in the type | expected ")" after \`choice(low\`; found high. Separate the options with \| and close with ")", e.g. \`choice(low\|high)\` |
| types.ts expect "{" / ":" / "}" | `mkp.type-syntax` | expected "{" / ":" / "}" in the type | expected ":" after \`{a\`; found int. Give the field a type after a colon, e.g. \`a: text\`; expected "}" after \`{a: int\`; found b. Separate the fields with commas and close the record with "}", e.g. \`{a: int, b: text}\` |
| types.ts any failure at a line end inside a bracket | `mkp.type-syntax` | (whatever was expected next, e.g. expected a variable name in expr(…)) | \`expr(x\` is missing its closing ")"; found the end of the line. Add ")" to close expr(…), e.g. \`expr(x)\` |
| tokens.ts dark= | `mkp.token-value` | color brand: dark must be a hex colour such as "#2563eb" | dark= on the colour token brand must be a hex colour, # and 3, 4, 6 or 8 hex digits; found navy. Write it in quotes, e.g. \`dark="#7aa7ff"\` |
| tokens.ts unnamed colour/font/shadow | `mkp.token-syntax` | color tokens are written name=value | a color token line starts with the token's name, as in \`color brand "#2563eb" dark="#7aa7ff"\`; found "#ffffff" with no name before it. Put a name first: \`color brand "#ffffff"\` |
| tokens.ts bare number on a pairs line | `mkp.token-syntax` | radius tokens are written name=value | a line of radius tokens is a list of name=value pairs, as in \`radius card=8 pill=999\`; found 4, which has no name. Remove 4, or write it as a pair: \`card=4\` |
| tokens.ts:66 (unreachable) | `mkp.token-missing` | the required color token "accent" is not defined by any token set | no token set defines the color token "accent", which every set of tokens must have. Add a line for it to a tokens file, e.g. \`color accent "#2563eb"\` |
| maths.ts other TeX errors | `mkp.maths` | $x^1^2$: Double exponent: use braces to clarify | the maths \`x^1^2\` can't be typeset; found this LaTeX error: Double exponent: use braces to clarify. Group with braces, e.g. x^{a^b} or {x^a}^b (also: undefined control sequence, missing argument, extra brace, misplaced &, \\left/\\right, missing ^/_ argument) |
| expr.ts:530 (unreachable) | `mkp.recursive-untyped` | go calls itself; give it a return type (fn go(…): type = …) | go calls itself, so the type of its result can't be worked out from its body. Declare the result type after the parameters, e.g. \`fn go(a: num): num = …\` |
| expr.ts:200 no near name | `mkp.unknown-field` | swatch has no field "zz" | \`sweep\` is a swatch, which has no field "zz"; its fields are name, colour. Read one of them, e.g. \`sweep.name\` |
| expr.ts:204 other types | `mkp.unknown-field` | point has no fields; "z" can't be read from it | \`pt\` is point, which has no fields, so \`.z\` can't be read from it. A point has only \`.x\` and \`.y\`: write \`pt.x\` (lists: read an item or map; dicts: get(…) or d["k"]) |
| expr.ts:213 type parameter | `mkp.type` | T is read by a path (an input typed path(…)) or with .field; found int | \`it\` is a T (a type parameter: the records the widget is given), so [ ] needs a path (…); found \`n\` (int). Declare an input naming one of its fields, e.g. \`in f path(T, text)\`, and write \`it[f]\` |
| expr.ts:441 unary minus | `mkp.no-operator` | no operator - for int and text | \`-\` can't make text negative; found \`-label\`. Negate a number or a point instead |
| expr.ts:441 text vs number compare | `mkp.no-operator` | no operator < for text and int | there is no \`<\` for text and int; found \`label\` (text) and \`1\` (int). Compare like with like: turn the text into a number with \`number(label)\`, or the number into text with \`format(1)\` |
| expr.ts:441 list + item | `mkp.no-operator` | no operator + for list(int) and int | there is no \`+\` for list(int) and int; found \`xs\` (list(int)) and \`n\` (int). To add an item to the list, write \`xs + [n]\` |
| expr.ts:586 name hides a function | `mkp.type` | "max" is a int, not a function | \`max\` is an input of type int, not a function, so it can't be called; found \`max(1, 2)\`. Rename \`max\` so the function max(…) can be called |
| expr.ts:623 builtin with wrong count | `mkp.unknown-function` | there is no function "floor" (did you mean "floor"?) | floor takes 1 argument; found 2 in \`floor(1, 2)\`. Call it as \`floor(1.5)\` |
| expr.ts:710 listOf, text given | `mkp.type` | sort needs a list; found text | sort needs a list here; found \`label\` (text). To get a list of its characters or words, write \`split(label, "")\` or \`split(label, " ")\` (shared by map, filter, find, sort, reverse, fold, group, index, indexof, zip, flatten, first, last, slice, at, mean, join, sum, min, max) |
| expr.ts:702 arity (all builtins) | `mkp.arity` | fold takes 3 argument(s), not 2 | fold takes 3 arguments; found 2 in \`fold(xs, 0)\`. Call it as \`fold(xs, start, (acc, x) => …)\` (sum now says "1 or 3 arguments", which is what it takes; it said 3) |
| expr.ts:1054 prod / pack types | `mkp.type` | prod over text needs * and a from(num) for that type | prod(lo, hi, k => …) multiplies the function's results for each whole k from lo to hi, so they must be numbers; found \`k => label\`, which returns text. Return a number from the function, e.g. \`prod(1, 2, k => k * 2)\` (for a record type: Add \`op +(a: T, b: T): T\` and \`op from(n: num): T\` to the type's pack) |
| expr.ts:1062 min/max of a list | `mkp.type` | min needs numbers | min of a list needs a list of numbers; found \`["a", "b"]\` (list(text)). Pass numbers, e.g. \`min([1, 2, 3])\`, or two numbers: \`min(a, b)\` |

## Position fixes

- **E184 / types.ts fail**: a type-syntax error whose token is on a later line (an unclosed
  bracket joins the next lines on), or at the end of the type, is now reported right after the last
  token of the type, on the line to change (E184: 6:3 -> 5:16), and the message says the bracket
  is missing rather than naming the next line's word. expr(…)'s optional commas are handled too.
- **E194 / maths.ts**: an error in a formula inside a Markdown paragraph (also list items and
  quotes, which become paragraphs) now points at the formula's `$`, on its own line, instead of the
  paragraph start (E194: 3:1 -> 3:15; a formula on the paragraph's second line gets that line).
  Only Markdown paragraph nodes are adjusted, since their text is the source; other text keeps the
  node position. Columns on continuation lines of an indented list item or quote can be off by the
  indent that Markdown strips.
- **E195**: mixed list items point at the first item that differs (12:7 -> 12:11), not the `[`.
- **E226, E227, E230, E231, E241, E243 and every builtin that needs a list** (listOf): point at the
  argument instead of the call (13:7 -> 13:12 for `sort(n)`).
- **E244**: max/min with two arguments point at the argument that is not a number.
- **E203**: `not` points at its operand.
- **E192 / tokens.ts**: a bad colour points at the value (`"blue"`, or the `dark=` argument), not
  the start of the line (2:3 -> 2:15).

## Left alone, and why

- **E209 position and naming**: `coerce` (expected X, found Y) is called from def.ts/doc.ts with
  the line's position and no name of what is being assigned, so it still cannot say `var k`; it now
  shows the value when it is a plain name or literal (`found \`label\` (text)`) and a conversion.
  Naming the target needs the callers (other agents' files) to pass it.
- **Cascades**: the extra `mkp.unknown-name` after a failed `in x <bad type>` (E185-E191) and the
  extra `mkp.unclosed-bracket` (E184) come from def.ts / the lexer.
- **E224 ("qualify it")**: expression names cannot be qualified (no `pack:name` in expressions,
  and a document sees every pack), so the message no longer asks for that; it says to rename, or to
  `depends` on one pack.
- **E228 vs lambda**: a lambda with the wrong result type for filter still goes through coerce
  ("expected bool here; found a int value…"), a behaviour difference, not wording.
- `join(xs, 1)` accepts a non-text separator silently; behaviour, so untouched.
- `showType` output unchanged (see top).
- Tests were not edited. In language/redesign/compile tests the only assertion on my wording I
  found (`"cuont" is not defined here (did you mean "count"?)`) still matches; the 7 failing tests
  I saw are on messages from other files (syntax, host, reserved, style-token, YAML paths).
