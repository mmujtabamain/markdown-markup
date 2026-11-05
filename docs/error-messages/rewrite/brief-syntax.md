# syntax: 75 messages

## E296 `mkp.tab` error at `packages/core/src/syntax/lexer.ts:48`

message: tabs are not allowed in indentation; indent with two spaces

block:
```
# Tally

```mkp
tally "A running count."
  var n int = 0
	project md = "Count"
```

```

builder: Easy. The tab is invisible in the block, the message is the only clue.

- reader 1 (yes): A tab is used for indentation, and the language requires spaces. | fix: Replace the tab before `project md` with two spaces. | confusing: 
- reader 2 (yes): A tab character is used to indent the project line. Indent with two spaces. | fix:   project md = "Count" | confusing: 
- reader 3 (yes): The line 'project md' is indented with a tab, and tabs are not allowed in indentation. | fix:   project md = "Count" | confusing: 

## E297 `mkp.unclosed-text` error at `packages/core/src/syntax/lexer.ts:79`

message: a """ long text is never closed; end it with a line holding """

block:
```
# Tally

```mkp
tally "A running count."
  var n int = 0
  text """
    Steps taken so far
```

```

builder: Easy.

- reader 1 (yes): A triple-quoted text is started with `"""` and never closed. It must end with a line holding `"""`. | fix:     text """
    Steps taken so far
    """ | confusing: 
- reader 2 (yes): A long text that begins with """ must end with a line holding """ too. | fix: Add a line holding """ after the text line. | confusing: 
- reader 3 (yes): The long text opened with """ is never closed, so it runs on past its end. | fix: Add a line holding """ after 'Steps taken so far'. | confusing: 

## E298 `mkp.unclosed-bracket` error at `packages/core/src/syntax/lexer.ts:94`

message: a bracket is never closed

block:
```
# Tally

```mkp
tally "A running count."
  var n int = 0
  project md = "Count " + (format(n, 0)
```

```

builder: Easy; the error points at the start of the line, not at the bracket.

- reader 1 (yes): A bracket is opened in `(format(n, 0)` and never closed. | fix:   project md = "Count " + (format(n, 0)) | confusing: 
- reader 2 (yes): A bracket is opened and never closed. | fix: project md = "Count " + (format(n, 0)) | confusing: 
- reader 3 (yes): The bracket opened in 'format(n, 0)' is never closed, and the expression ends without it. | fix: project md = "Count " + (format(n, 0)) | confusing: 

## E299 `mkp.indent` error at `packages/core/src/syntax/lexer.ts:113`

message: this line is indented 6 spaces; children are indented two spaces below their parent (4)

block:
```
# Tally

```mkp
tally "A running count."
  var n int = 0
  row
      text "\val{n}"
  project md = "Count"
```

```

builder: Easy.

- reader 1 (yes): The `text` line is indented six spaces, but children go two spaces below their parent, which is four. | fix:     text "\val{n}" | confusing: 
- reader 2 (yes): The line is indented 6 spaces, but its child must be indented 4 (two more than the row). | fix:     text "\val{n}" | confusing: 
- reader 3 (yes): The text line is indented 6 spaces, but a child of row must be indented 4 spaces. | fix:     text "\\val{n}" | confusing: 

## E300 `mkp.indent` error at `packages/core/src/syntax/lexer.ts:115`

message: indentation must be a multiple of two spaces

block:
```
# Tally

```mkp
tally "A running count."
  var n int = 0
  row
    text "a"
     text "b"
  project md = "Count"
```

```

builder: Odd indentation only reaches this branch when it is less than the expected indent; 3 spaces under a 2-space line gives the other message.

- reader 1 (yes): Indentation must be a multiple of two spaces, and this line has three. | fix:     text "b" | confusing: 
- reader 2 (yes): Indentation must be a multiple of two spaces. The text "b" line has 5. | fix:     text "b" | confusing: 
- reader 3 (yes): The line 'text "b"' has 5 spaces of indentation, and indentation must be a multiple of two. | fix:     text "b" | confusing: 

## E301 `mkp.syntax` error at `packages/core/src/syntax/expr.ts:39`

message: unexpected ")" after the expression

block:
```
# Tally

```mkp
tally "A running count."
  var n int = 0
  double = n * 2 )
  project md = "Count"
```

```

builder: Easy.

- reader 1 (yes): There is a stray `)` at the end of `n * 2 )`, with no matching open bracket. | fix:   double = n * 2 | confusing: 
- reader 2 (yes): There is an extra ')' after the expression. | fix: double = n * 2 | confusing: 
- reader 3 (yes): A closing bracket ')' appears after the expression, with no matching opening bracket. | fix: double = n * 2 | confusing: 

## E302 `mkp.syntax` error at `packages/core/src/syntax/expr.ts:61`

message: expected ":" but found "1"

block:
```
# Tally

```mkp
tally "A running count."
  var n int = 0
  total = {a 1}
  project md = "Count"
```

```

builder: Easy.

- reader 1 (yes): A record literal needs `key: value`, and `a 1` has no colon. | fix:   total = {a: 1} | confusing: 
- reader 2 (yes): A record field needs a colon between its name and its value. | fix: total = {a: 1} | confusing: 
- reader 3 (yes): The braces start a record, which needs a colon between a field name and its value. 'a 1' has none. | fix: total = {a: 1} | confusing: 

## E303 `mkp.syntax` error at `packages/core/src/syntax/expr.ts:131`

message: comparisons do not chain; join them with "and"

block:
```
# Tally

```mkp
tally "A running count."
  var n int = 0
  ok = 1 < n < 5
  project md = "Count"
```

```

builder: Easy.

- reader 1 (yes): Comparisons can't be chained like `1 < n < 5`. Join them with `and`. | fix:   ok = (1 < n) and (n < 5) | confusing: 
- reader 2 (yes): Comparisons cannot be chained, so 1 < n < 5 is invalid. | fix: ok = 1 < n and n < 5 | confusing: 
- reader 3 (yes): Comparisons cannot be chained like '1 < n < 5', and the message says to join them with 'and'. | fix: ok = 1 < n and n < 5 | confusing: 

## E304 `mkp.syntax` error at `packages/core/src/syntax/expr.ts:222`

message: expected a field name after "."

block:
```
# Tally

```mkp
tally "A running count."
  var p point = (1, 2)
  x = p.(1)
  project md = "Count"
```

```

builder: Easy.

- reader 1 (partly): After `.`, a field name is needed. `p.(1)` gives a number in brackets instead. | fix:   x = p.x  (assuming the point type has a field x; I can't see its definition) | confusing: I don't know how tuple fields are accessed in this language.
- reader 2 (yes): After '.', a field name is needed, and (1) is not one. | fix: x = p.x | confusing: 
- reader 3 (yes): After '.', a field name is needed, and '(1)' is not one. | fix: x = p.x | confusing: 

## E305 `mkp.syntax` error at `packages/core/src/syntax/expr.ts:254`

message: "and" cannot start a value here

block:
```
# Tally

```mkp
tally "A running count."
  var n int = 0
  x = 1 + and
  project md = "Count"
```

```

builder: Easy. The wording is odd for a keyword used as a value.

- reader 1 (yes): `and` is a keyword, and it can't start a value here. There is no right-hand operand. | fix:   x = 1 + n | confusing: I'm not sure whether `and` is meant as a logical operator; the message doesn't say.
- reader 2 (yes): 'and' is a keyword, so it cannot be a value. | fix: x = 1 + 2 | confusing: 
- reader 3 (yes): 'and' is an operator between two values, and it has nothing before it here. | fix: x = 1 + n | confusing: I replaced 'and' with n, since the author probably meant to add a variable. The fix is a guess.

## E306 `mkp.syntax` error at `packages/core/src/syntax/expr.ts:277`

message: expected a field name in the record

block:
```
# Tally

```mkp
tally "A running count."
  var n int = 0
  x = {1: n}
  project md = "Count"
```

```

builder: Easy; numeric field names are rejected with a message that does not say quoted names are allowed.

- reader 1 (yes): A record needs field names, and `1` is a number. | fix:   x = {a: n} | confusing: 
- reader 2 (yes): A record field needs a name, and 1 is a number. | fix: x = {value: n} | confusing: 
- reader 3 (yes): A record field needs a name, and '1' is a number. | fix: x = {a: n} | confusing: 

## E307 `mkp.syntax` error at `packages/core/src/syntax/expr.ts:288`

message: there is no |x|; write abs(x)

block:
```
# Tally

```mkp
tally "A running count."
  var n int = 0
  x = |n|
  project md = "Count"
```

```

builder: Easy; the message even names the fix, which is helpful.

- reader 1 (yes): `|n|` is not absolute-value syntax. The function `abs` is used instead. | fix:   x = abs(n) | confusing: 
- reader 2 (yes): Absolute value is written abs(x), not with bars. | fix: x = abs(n) | confusing: 
- reader 3 (yes): MKP has no |x| absolute-value bars. The function abs(x) is used instead. | fix: x = abs(n) | confusing: 

## E308 `mkp.syntax` error at `packages/core/src/syntax/expr.ts:289`

message: unexpected "*"

block:
```
# Tally

```mkp
tally "A running count."
  var n int = 0
  x = * 3
  project md = "Count"
```

```

builder: Easy. Plain message, but it does not say a value is expected there.

- reader 1 (yes): `*` has no left operand, so it can't start an expression. | fix:   x = 2 * 3 | confusing: 
- reader 2 (yes): A value cannot begin with *. | fix: x = 3 | confusing: 
- reader 3 (yes): '*' cannot start an expression, and it has no value before it. | fix: x = n * 3 | confusing: I replaced the bare '*' with 'n *', since n is the only variable in scope. The author may have meant something else.

## E309 `mkp.syntax` error at `packages/core/src/syntax/expr.ts:291`

message: the expression ends too early

block:
```
# Tally

```mkp
tally "A running count."
  var n int = 0
  x = n +
  project md = "Count"
```

```

builder: Easy. The message does not say what was expected next, and the column points at the last token.

- reader 1 (yes): The expression ends with `+` and has no right-hand side. | fix:   x = n + 1 | confusing: 
- reader 2 (yes): The expression ends with +, with nothing after it. | fix: x = n + 1 | confusing: 
- reader 3 (yes): The expression 'n +' has no right-hand side, so it ends too early. | fix: x = n + 1 | confusing: 

## E310 `mkp.front-matter` error at `packages/core/src/syntax/doc.ts:41`

message: the front matter is never closed with ---

block:
```
---
teaches: "counting"

# Tally

A short note.

```

builder: Easy; error points to line 1, not to where a closing line should be.

- reader 1 (yes): The front matter opens with `---` but has no closing `---` line. | fix: Add a `---` line after `teaches: "counting"`. | confusing: 
- reader 2 (yes): The front matter has no closing '---' line. | fix: Add a line with --- after 'teaches: "counting"'. | confusing: 
- reader 3 (yes): The front matter starts with --- but has no closing --- line. | fix: Add a line with --- after 'teaches: "counting"'. | confusing: 

## E311 `mkp.container` error at `packages/core/src/syntax/doc.ts:108`

message: the container :::row is never closed with :::

block:
```
# Notes

:::row
Some words here.

```

builder: Easy.

- reader 1 (yes): The `:::row` container opens but is never closed with `:::`. | fix: :::row
Some words here.
::: | confusing: 
- reader 2 (yes): The :::row container is opened but never closed with :::. | fix: Add a line with ::: after the paragraph. | confusing: 
- reader 3 (yes): The :::row container is never closed. It needs a closing ::: line. | fix: Add a line with ::: after 'Some words here.' | confusing: 

## E312 `mkp.attrs-orphan` warning at `packages/core/src/syntax/doc.ts:124`

message: attributes must follow a block

block:
```
{#intro}

# Notes

Some words here.

```

builder: Easy; it is a warning, and the block sits at the very start of the document.

- reader 1 (yes): An attribute line must follow the block it belongs to. This one stands alone at the top. | fix: # Intro
{#intro} | confusing: 
- reader 2 (yes): An attribute such as {#intro} must follow the block it belongs to, but it comes before the heading. | fix: # Notes
{#intro}

Some words here. | confusing: 
- reader 3 (yes): An attribute such as {#intro} must come right after a block (here, the heading), but it is placed before the heading. | fix: # Notes
{#intro} | confusing: 

## E313 `mkp.syntax` error at `packages/core/src/syntax/mkp.ts:228`

message: expected name@N, found "distance"

block:
```
--- manifest.mkp ---
pack units@1 "Distances in kilometres."
  requires core@1
  provides distance

--- distance.mkp ---
part distance "A distance in kilometres."
  in km num "the distance"
  project md = format(km, 1)

```

builder: Easy, but a pack file needs the manifest around it.

- reader 1 (yes): A part needs its name and version, written name@N. The block gives `distance` without `@1`. | fix: part distance@1 "A distance in kilometres." | confusing: 
- reader 2 (yes): A part name needs a version, as name@N. | fix: part distance@1 "A distance in kilometres." | confusing: 
- reader 3 (yes): The part name is 'distance' with no version. A name needs the form name@N, such as distance@1. | fix: part distance@1 "A distance in kilometres." | confusing: 

## E314 `mkp.syntax` error at `packages/core/src/syntax/mkp.ts:229`

message: "dist/ance" is not a valid name (letters, digits, ".", "-" and "_")

block:
```
--- manifest.mkp ---
pack units@1 "Distances in kilometres."
  requires core@1
  provides distance

--- distance.mkp ---
part dist/ance@1 "A distance in kilometres."
  in km num "the distance"

```

builder: The name check message is clear.

- reader 1 (yes): A name may use only letters, digits, '.', '-' and '_'. The slash in dist/ance is not allowed. | fix: part distance@1 "A distance in kilometres." | confusing: 
- reader 2 (yes): dist/ance contains a slash. A name may use only letters, digits, '.', '-' and '_'. | fix: part distance@1 "A distance in kilometres." | confusing: 
- reader 3 (yes): The name dist/ance has a slash, which is not allowed in a name. | fix: part dist-ance@1 "A distance in kilometres." | confusing: I changed the slash to a hyphen. The message says letters, digits, '.', '-' and '_' are valid, so this is one option.

## E315 `mkp.syntax` error at `packages/core/src/syntax/mkp.ts:235`

message: expected a quoted description, found kilometres

block:
```
--- manifest.mkp ---
pack units@1 "Distances in kilometres."
  requires core@1
  provides distance

--- distance.mkp ---
part distance@1 kilometres
  in km num "the distance"

```

builder: Message says found <text> without quotes around it.

- reader 1 (yes): The part's description must be in quotes, and `kilometres` is bare text. | fix: part distance@1 "kilometres" | confusing: 
- reader 2 (yes): The part description must be quoted, and kilometres is not quoted. | fix: part distance@1 "A distance in kilometres." | confusing: 
- reader 3 (yes): The description must be in quotes, and 'kilometres' is not quoted. | fix: part distance@1 "Distances in kilometres." | confusing: 

## E316 `mkp.syntax` error at `packages/core/src/syntax/mkp.ts:244`

message: expected name@N

block:
```
--- manifest.mkp ---
pack units@1 "Distances in kilometres."
  requires core@1
  provides distance

--- distance.mkp ---
part
  in km num "the distance"

```

builder: A bare 'part' line.

- reader 1 (yes): The `part` line needs a name@N before the inputs. | fix: part distance@1 "A distance in kilometres." | confusing: 
- reader 2 (yes): A part needs a name@N after the keyword. | fix: part distance@1 "A distance in kilometres." | confusing: 
- reader 3 (yes): The part line has no name, and a name@N is required. | fix: part distance@1 "A distance in kilometres." | confusing: The fix invents the name 'distance'. The block has no name, so this is a guess.

## E317 `mkp.syntax` error at `packages/core/src/syntax/mkp.ts:244`

message: expected a name

block:
```
# Tally

```mkp
part
  in km num
```

```

builder: Inline variant says 'expected a name' while the pack variant says 'expected name@N'.

- reader 1 (yes): `part` needs a name after the keyword. | fix: part distance@1 "A distance in kilometres." | confusing: 
- reader 2 (partly): part needs a name after the keyword, and none is given. | fix: part gauge "A gauge." | confusing: I am guessing the name, since the message does not say what the name must be.
- reader 3 (yes): A part line needs a name after the keyword, and here it has none. | fix: part km@1 "A distance." | confusing: The name km is a guess taken from the input. The author may have meant another name.

## E318 `mkp.syntax` error at `packages/core/src/syntax/mkp.ts:249`

message: "tally/count" is not a valid name (letters, digits, ".", "-" and "_")

block:
```
# Tally

```mkp
part tally/count "A running count."
  var n int = 0
```

```

builder: Easy. The message names the offending text and the rule.

- reader 1 (yes): A name can't contain a slash, and `tally/count` has one. | fix: part tally-count "A running count." | confusing: 
- reader 2 (yes): A name cannot contain a slash. Letters, digits, '.', '-' and '_' are allowed. | fix: part tally-count "A running count." | confusing: 
- reader 3 (yes): A name can only use letters, digits, '.', '-' and '_', and the slash in 'tally/count' is not allowed. | fix: part tally-count "A running count." | confusing: 

## E319 `mkp.syntax` error at `packages/core/src/syntax/mkp.ts:260`

message: "item" is not a type parameter: one capitalised word, such as S or Item

block:
```
# Tally

```mkp
tally of item "A running count."
  var n int = 0
  project md = "Count"
```

```

builder: Easy. The message names the offending text and the rule.

- reader 1 (yes): A type parameter must be a single capitalised word, like S or Item, not a lowercase word. | fix: tally of Item "A running count." | confusing: 
- reader 2 (yes): A type parameter is one capitalised word, and 'item' is lowercase. | fix: tally of Item "A running count." | confusing: 
- reader 3 (yes): The type parameter must be one capitalised word, like T or Item, and 'item' is lowercase. | fix: tally of Item "A running count." | confusing: 

## E320 `mkp.syntax` error at `packages/core/src/syntax/mkp.ts:265`

message: of names the type parameters: name of S

block:
```
# Tally

```mkp
tally of "A running count."
  var n int = 0
  project md = "Count"
```

```

builder: Easy. The message names the offending text and the rule.

- reader 1 (yes): `tally of` needs a type parameter name after `of`. The text is in the wrong place. | fix: tally of S "A running count." | confusing: 
- reader 2 (yes): 'of' is used to name type parameters. The tally has none, so 'of' should be removed. | fix: tally "A running count." | confusing: 
- reader 3 (yes): The type parameter list needs names, and 'of' is followed by a description, not a name. | fix: tally of T "A running count." | confusing: The name T is my guess. The author may have meant another name.

## E321 `mkp.syntax` error at `packages/core/src/syntax/mkp.ts:268`

message: unexpected ""per click"" after the description

block:
```
# Tally

```mkp
tally "A running count." "per click"
  var n int = 0
  project md = "Count"
```

```

builder: Easy to trigger; the message states the rule directly.

- reader 1 (yes): The description takes just one quoted string, and `"per click"` is an extra one. | fix: tally "A running count, per click." | confusing: 
- reader 2 (yes): Nothing may follow the description on the tally line, and "per click" is extra. | fix: tally "A running count." | confusing: 
- reader 3 (yes): Text after the description is not allowed, and '"per click"' is extra. | fix: tally "A running count." | confusing: 

## E322 `mkp.syntax` error at `packages/core/src/syntax/mkp.ts:274`

message: expected interface name@N

block:
```
--- manifest.mkp ---
pack units@1 "Distances in kilometres."
  requires core@1
  provides distance

--- distance.mkp ---
interface
  in n int

```

builder: Needs a pack file. The line is just a keyword with nothing after it; the message is short but accurate.

- reader 1 (yes): An interface needs a name@N and a description after the keyword. | fix: interface scored@1 "Something with a score." | confusing: 
- reader 2 (yes): An interface needs a name@N and a description after the keyword. | fix: interface scored@1 "Something with a score." | confusing: 
- reader 3 (yes): An interface line needs a name@N before its inputs. | fix: interface scored@1 | confusing: 

## E323 `mkp.syntax` error at `packages/core/src/syntax/mkp.ts:285`

message: an interface lists in, host, signal and out lines, and "project md"

block:
```
--- manifest.mkp ---
pack scoring@1 "A score."
  provides scored

--- scored.mkp ---
interface scored@1 "Something with a score."
  in best int
  var tries int = 0

```

builder: Easy to trigger; the message states the rule directly.

- reader 1 (yes): An interface can have only `in`, host, `signal` and `out` lines, plus `project md`. A `var` line is not allowed. | fix: Delete `var tries int = 0` from the interface. | confusing: 
- reader 2 (partly): An interface may contain only in, host, signal and out lines, plus project md. The var line is not allowed. | fix: Delete 'var tries int = 0' and add a 'project md' line. | confusing: The 'host' line is named in the message, but I do not know its syntax.
- reader 3 (yes): An interface lists in, host, signal and out lines, and project md. The line 'var tries int = 0' is not one of these. | fix: Delete the line 'var tries int = 0'. | confusing: The message lists 'host' and 'project md' as allowed, but the block does not use them. I am not sure whether 'project md' is required.

## E324 `mkp.syntax` error at `packages/core/src/syntax/mkp.ts:308`

message: a document cannot declare an extern; externs are what a provider draws

block:
```
# Tally

```mkp
extern gauge "A dial."
  in level num
```

```

builder: Easy to trigger; the message states the rule directly.

- reader 1 (yes): An extern can't be declared in a document. Externs are declared by the provider. | fix: Delete the extern line from the document, and use a normal widget here. | confusing: 
- reader 2 (yes): A document cannot declare an extern, which is what a provider draws. Externs belong in a pack. | fix: Move the extern gauge block into a pack file. | confusing: 
- reader 3 (yes): A document cannot declare an extern. Externs belong in a pack, which is where providers implement them. | fix: Move the extern into a pack's file, not this document. | confusing: 

## E325 `mkp.syntax` error at `packages/core/src/syntax/mkp.ts:313`

message: interfaces belong to a host, in its pack; a document cannot declare one

block:
```
# Tally

```mkp
interface scored@1 "Something with a score."
  in best int
```

```

builder: Easy to trigger; the message states the rule directly.

- reader 1 (yes): An interface can be declared only inside a pack, not in a document. | fix: Move the interface into a pack's .mkp file, and remove it from the document. | confusing: 
- reader 2 (yes): Interfaces belong to a host, in its pack, not in a document. | fix: Move the interface scored@1 block into a pack. | confusing: 
- reader 3 (yes): An interface belongs to a host pack, not to a document. | fix: Move the interface block into a pack file. | confusing: 

## E326 `mkp.syntax` error at `packages/core/src/syntax/mkp.ts:334`

message: expected "type name = {field: type, …}"

block:
```
# Tally

```mkp
type Score
tally "A running count."
  var n int = 0
  project md = "Count"
```

```

builder: Easy to trigger; the message states the rule directly.

- reader 1 (yes): A `type` needs the form `type name = {field: type, ...}`, and this line has no equals sign or fields. | fix: type Score = {value: int} | confusing: 
- reader 2 (yes): A type declaration needs = and braces with fields, such as {value: int}. | fix: type Score = {value: int} | confusing: 
- reader 3 (yes): A type definition needs a braced body with a name and fields, and 'type Score' has none. | fix: type Score = {value: int} | confusing: The field name and type are my guess, since the block does not give them.

## E327 `mkp.syntax` error at `packages/core/src/syntax/mkp.ts:336`

message: "2d" is not a valid type name

block:
```
# Tally

```mkp
type 2d = {x: num, y: num}
tally "A running count."
  var n int = 0
  project md = "Count"
```

```

builder: Easy. The message names the offending text and the rule.

- reader 1 (yes): A type name can't start with a digit, so `2d` is invalid. | fix: type dims = {x: num, y: num} | confusing: 
- reader 2 (yes): A type name cannot start with a digit. | fix: type point2d = {x: num, y: num} | confusing: 
- reader 3 (yes): A type name cannot start with a digit, and '2d' starts with one. | fix: type point2d = {x: num, y: num} | confusing: 

## E328 `mkp.syntax` error at `packages/core/src/syntax/mkp.ts:344`

message: an op is one of + - * / ^ == < from point

block:
```
# Tally

```mkp
op ~(a, b) = a + b
tally "A running count."
  var n int = 0
  project md = "Count"
```

```

builder: Easy to trigger; the message states the rule directly.

- reader 1 (partly): An op must be one of the listed operator symbols. The block uses `~`, which is not on the list. | fix: op +(a, b) = a + b  (or another listed symbol) | confusing: I don't know what the operator list after 'from point' means.
- reader 2 (yes): ~ is not an operator that can be defined. The allowed ones are + - * / ^ == < from. | fix: op +(a: num, b: num): num = a + b | confusing: I do not know what the operator from the message refers to.
- reader 3 (yes): '~' is not an operator that can be defined. Only + - * / ^ == < and from can be. | fix: op +(a: num, b: num): num = a + b | confusing: The message lists 'from point' as options that I could not match to this line. I am not sure what 'from' does here.

## E329 `mkp.syntax` error at `packages/core/src/syntax/mkp.ts:349`

message: expected "const name[: type] = expression"

block:
```
# Tally

```mkp
const limit
tally "A running count."
  var n int = 0
  project md = "Count"
```

```

builder: Easy to trigger; the message states the rule directly.

- reader 1 (yes): A `const` needs `= expression` after the name. | fix: const limit = 10 | confusing: 
- reader 2 (yes): A const needs a type and a value. | fix: const limit: int = 10 | confusing: 
- reader 3 (yes): A const needs an '=' followed by an expression, and 'const limit' has neither. | fix: const limit = 3 | confusing: The value 3 is my guess.

## E330 `mkp.syntax` error at `packages/core/src/syntax/mkp.ts:353`

message: "2x" is not a valid name

block:
```
# Tally

```mkp
const 2x = 3
tally "A running count."
  var n int = 0
  project md = "Count"
```

```

builder: Easy. The message names the offending text and the rule.

- reader 1 (yes): A constant name can't start with a digit, so `2x` is invalid. | fix: const twox = 3 | confusing: 
- reader 2 (yes): A const name cannot start with a digit. | fix: const two_x = 3 | confusing: 
- reader 3 (yes): A name cannot start with a digit, and '2x' does. | fix: const two_x = 3 | confusing: 

## E331 `mkp.syntax` error at `packages/core/src/syntax/mkp.ts:360`

message: expected "macro name = $…$"

block:
```
# Tally

```mkp
macro R
tally "A running count."
  var n int = 0
  project md = "Count"
```

```

builder: Easy to trigger; the message states the rule directly.

- reader 1 (yes): A macro needs a name, an equals sign, and a maths value in $...$. | fix: macro R = $\mathbb{R}$ | confusing: 
- reader 2 (yes): A macro needs a name, =, and a $…$ value. | fix: macro R = $\\mathbb{R}$ | confusing: A macro cannot go in a document (see E173), so it must move to a pack.
- reader 3 (yes): A macro needs an equals sign and a $...$ value after its name. | fix: macro R = $x$ | confusing: 

## E332 `mkp.unknown-statement` error at `packages/core/src/syntax/mkp.ts:371`

message: a top-level line starts a definition (name@N, part, extern), tokens, type, fn, op, const, macro or pack; found "include"

block:
```
# Tally

```mkp
include shapes
tally "A running count."
  var n int = 0
  project md = "Count"
```

```

builder: Easy; the message lists what a top-level line may start with, which is long but useful.

- reader 1 (yes): `include` is not a top-level keyword. The top-level lines are definitions, tokens, type, fn, op, const, macro and pack. | fix: Delete the `include shapes` line. | confusing: The message mentions 'extern', which I don't know.
- reader 2 (yes): include is not allowed at the top level of a document. | fix: Delete the 'include shapes' line. | confusing: 
- reader 3 (yes): A top-level line must start a definition, a token set, a type, a fn, an op, a const, a macro or a pack. 'include' is not one of these. | fix: Delete the line 'include shapes'. | confusing: The message says what is allowed but not whether include can be used another way, so I may have removed something needed.

## E333 `mkp.syntax` error at `packages/core/src/syntax/mkp.ts:477`

message: expected an expression

block:
```
# Tally

```mkp
const limit =
tally "A running count."
  var n int = 0
  project md = "Count"
```

```

builder: Easy to trigger; the message states the rule directly.

- reader 1 (yes): `const limit =` has no value after the equals sign. | fix: const limit = 3 | confusing: 
- reader 2 (yes): A const needs an expression after =, and none is given. | fix: const limit = 10 | confusing: 
- reader 3 (yes): The const line has an '=' with no value after it. | fix: const limit = 3 | confusing: 

## E334 `mkp.syntax` error at `packages/core/src/syntax/mkp.ts:486`

message: "2x" is not a valid function name

block:
```
# Tally

```mkp
fn 2x(a) = a * 2
tally "A running count."
  var n int = 0
  project md = "Count"
```

```

builder: Easy. The message names the offending text and the rule.

- reader 1 (yes): A function name cannot start with a digit, so `2x` is not valid. | fix: fn twice_x(a) = a * 2 | confusing: 
- reader 2 (yes): A function name cannot start with a digit. | fix: fn double2(a) = a * 2 | confusing: 
- reader 3 (yes): A function name cannot start with a digit. | fix: fn two_x(a) = a * 2 | confusing: 

## E335 `mkp.syntax` error at `packages/core/src/syntax/mkp.ts:500`

message: the parameter list is never closed

block:
```
# Tally

```mkp
tally "A running count."
  var n int = 0
  project md = "Count"
fn area(w, h = w * h
```

```

builder: Easy to trigger; the message states the rule directly.

- reader 1 (yes): The parameter list `fn area(w, h = w * h` is missing its closing bracket. | fix: fn area(w, h) = w * h | confusing: 
- reader 2 (yes): The fn parameter list has an open '(' but no ')'. | fix: fn area(w: num, h: num): num = w * h | confusing: 
- reader 3 (yes): The parameter list of fn area opens with '(' but is never closed, because it has no ')'. | fix: fn area(w, h) = w * h | confusing: The line in the block uses 'h = w * h', so I rewrote it as a definition. The author may have meant something else.

## E336 `mkp.syntax` error at `packages/core/src/syntax/mkp.ts:519`

message: "2w" is not a valid parameter name

block:
```
# Tally

```mkp
fn area(2w, h) = w * h
tally "A running count."
  var n int = 0
  project md = "Count"
```

```

builder: Easy. The message names the offending text and the rule.

- reader 1 (yes): A parameter name can't start with a digit, so `2w` is invalid. | fix: fn area(w2, h) = w2 * h | confusing: The body uses `w`, so the fix renames the parameter; the function body must then use the same name.
- reader 2 (yes): A parameter name cannot start with a digit. | fix: fn area(w, h) = w * h | confusing: 
- reader 3 (yes): A parameter name cannot start with a digit, and '2w' does. | fix: fn area(w, h) = w * h | confusing: 

## E337 `mkp.syntax` error at `packages/core/src/syntax/mkp.ts:524`

message: expected "= expression" after the parameters

block:
```
# Tally

```mkp
fn area(w, h)
tally "A running count."
  var n int = 0
  project md = "Count"
```

```

builder: Easy to trigger; the message states the rule directly.

- reader 1 (yes): A function definition needs `= expression` after the parameter list. | fix: fn area(w, h) = w * h | confusing: 
- reader 2 (yes): A fn needs = and an expression after its parameters. | fix: fn area(w, h) = w * h | confusing: 
- reader 3 (yes): After the parameters, the function needs '= expression'. | fix: fn area(w, h) = w * h | confusing: 

## E338 `mkp.syntax` error at `packages/core/src/syntax/mkp.ts:528`

message: expected ": type" or "=" after the parameters

block:
```
# Tally

```mkp
fn area(w, h) num = w * h
tally "A running count."
  var n int = 0
  project md = "Count"
```

```

builder: Easy to trigger; the message states the rule directly.

- reader 1 (yes): After the parameter list, a function needs either `: type` or `=`. The line gives a bare `num`. | fix: fn area(w, h): num = w * h | confusing: 
- reader 2 (yes): A fn's result type must follow the parameters after a colon, before the =. | fix: fn area(w, h): num = w * h | confusing: 
- reader 3 (yes): After the parameters, a function needs ': type' or '=', and 'num' here is neither. | fix: fn area(w, h): num = w * h | confusing: 

## E339 `mkp.syntax` error at `packages/core/src/syntax/mkp.ts:553`

message: unexpected "extra" after the type

block:
```
# Tally

```mkp
tally "A running count."
  in start int extra = 3
  project md = "Count"
```

```

builder: Easy to trigger; the message states the rule directly.

- reader 1 (yes): The type `int` is followed by the stray word `extra`, before the `=`. | fix:   in start int = 3 | confusing: 
- reader 2 (yes): After the type, the input line allows only a default. 'extra' is not allowed. | fix: in start int = 3 | confusing: 
- reader 3 (yes): The word 'extra' comes after the type and is not part of the syntax. | fix: in start int = 3 | confusing: 

## E340 `mkp.syntax` error at `packages/core/src/syntax/mkp.ts:557`

message: expected a value after "="

block:
```
# Tally

```mkp
tally "A running count."
  in start int =
  project md = "Count"
```

```

builder: Easy to trigger; the message states the rule directly.

- reader 1 (yes): The `=` for the default value has nothing after it. | fix:   in start int = 0 | confusing: 
- reader 2 (yes): An in line's '=' needs a value after it. | fix: in start int = 3 | confusing: 
- reader 3 (yes): The '=' has no value after it. | fix: in start int = 1 | confusing: 

## E341 `mkp.syntax` error at `packages/core/src/syntax/mkp.ts:565`

message: unexpected ""again""

block:
```
# Tally

```mkp
tally "A running count."
  in start int = 3 "where it begins" "again"
  project md = "Count"
```

```

builder: Easy to trigger; the message states the rule directly.

- reader 1 (yes): A stray string `"again"` follows the input line. | fix:   in start int = 3 "where it begins" | confusing: 
- reader 2 (yes): The text "again" follows the input line and is not allowed there. | fix: in start int = 3 "where it begins" | confusing: 
- reader 3 (yes): The line has an extra quoted string '"again"' after the description, which is not allowed. | fix: in start int = 3 "where it begins" | confusing: 

## E342 `mkp.continuation` error at `packages/core/src/syntax/mkp.ts:598`

message: a value takes no indented lines: to go on with its expression, break the line inside an open bracket (…)

block:
```
# Tally

```mkp
tally "A running count."
  var n int = 0
  double = n * 2
    + 1
  project md = "Count"
```

```

builder: Natural mistake when wrapping a long expression. The message suggests breaking inside brackets.

- reader 1 (yes): A value can't have indented lines. The `+ 1` on the next line must be joined to the expression above it. | fix:   double = (n * 2
    + 1) | confusing: I'm not sure whether the message's advice to break inside brackets means the second line must be indented.
- reader 2 (yes): A value cannot have indented lines under it. To continue an expression, break it inside brackets. | fix: double = (n * 2 + 1) | confusing: 
- reader 3 (yes): A value cannot have indented lines, so the '+ 1' on the next line is not allowed. To continue the expression, the line must break inside an open bracket. | fix: double = (n * 2
    + 1) | confusing: 

## E343 `mkp.syntax` error at `packages/core/src/syntax/mkp.ts:616`

message: expected a capability such as gfx@1

block:
```
# Tally

```mkp
tally "A running count."
  requires
  project md = "Count"
```

```

builder: Easy to trigger; the message states the rule directly.

- reader 1 (yes): `requires` must be followed by a capability with a version, such as gfx@1. | fix:   requires gfx@1 | confusing: 
- reader 2 (yes): requires needs a capability, such as gfx@1. | fix: requires gfx@1 | confusing: 
- reader 3 (yes): 'requires' is followed by nothing, and a capability with a version such as gfx@1 is needed. | fix: requires gfx@1 | confusing: 

## E344 `mkp.syntax` error at `packages/core/src/syntax/mkp.ts:619`

message: expected a positive whole number of operations

block:
```
# Tally

```mkp
tally "A running count."
  budget lots
  project md = "Count"
```

```

builder: Easy to trigger; the message states the rule directly.

- reader 1 (yes): `budget` takes a positive whole number of operations, and `lots` is not a number. | fix:   budget 1000000 | confusing: 
- reader 2 (yes): budget needs a positive whole number. The block gives the word lots. | fix: budget 1000 | confusing: 
- reader 3 (yes): budget takes a positive whole number of operations, and 'lots' is text. | fix: budget 1000 | confusing: The value 1000 is my guess.

## E345 `mkp.syntax` error at `packages/core/src/syntax/mkp.ts:624`

message: implements names an interface: implements scored@1

block:
```
# Tally

```mkp
tally "A running count."
  implements
  project md = "Count"
```

```

builder: Easy to trigger; the message states the rule directly.

- reader 1 (yes): `implements` needs an interface name with its version, such as scored@1. | fix:   implements scored@1 | confusing: 
- reader 2 (yes): implements needs the name of an interface, such as scored@1. | fix: implements scored@1 | confusing: 
- reader 3 (yes): 'implements' needs the name of an interface, such as scored@1, and it has none. | fix: implements scored@1 | confusing: 

## E346 `mkp.syntax` error at `packages/core/src/syntax/mkp.ts:625`

message: "scored" is not an interface name@N

block:
```
# Tally

```mkp
tally "A running count."
  implements scored
  project md = "Count"
```

```

builder: Easy to trigger; the message states the rule directly.

- reader 1 (yes): `implements` must name the interface with its version, name@N. | fix:   implements scored@1 | confusing: 
- reader 2 (yes): implements needs an interface name with a version, as name@N. | fix: implements scored@1 | confusing: 
- reader 3 (yes): The interface name needs a version, such as scored@1. | fix: implements scored@1 | confusing: 

## E347 `mkp.syntax` error at `packages/core/src/syntax/mkp.ts:630`

message: "2x" is not a valid input name

block:
```
# Tally

```mkp
tally "A running count."
  fields 2x
  project md = "Count"
```

```

builder: Easy. The message names the offending text and the rule.

- reader 1 (yes): An input name cannot start with a digit, and `2x` starts with one. | fix:   fields x2 | confusing: 
- reader 2 (yes): An input name cannot start with a digit. | fix: fields x2 | confusing: I am not sure what the fields line means, so the fix may not be right.
- reader 3 (yes): '2x' starts with a digit, so it is not a valid input name. | fix: fields two_x | confusing: The name two_x is my guess, and the fields line may need an input to match it.

## E348 `mkp.syntax` error at `packages/core/src/syntax/mkp.ts:637`

message: expected "in name type …"

block:
```
# Tally

```mkp
tally "A running count."
  in
  project md = "Count"
```

```

builder: Easy to trigger; the message states the rule directly.

- reader 1 (yes): `in` needs a name and a type after it. | fix:   in n int = 0 | confusing: 
- reader 2 (yes): An in line needs a name and a type after the keyword. | fix: in n int = 0 | confusing: 
- reader 3 (yes): An 'in' line needs a name and a type, and here both are missing. | fix: in n int = 0 | confusing: 

## E349 `mkp.syntax` error at `packages/core/src/syntax/mkp.ts:640`

message: only an input (in) can be an answer

block:
```
# Tally

```mkp
tally "A running count."
  var n int = 0 answer
  project md = "Count"
```

```

builder: Easy to trigger; the message states the rule directly.

- reader 1 (yes): Only an input (`in`) can be marked as an answer. This line is a `var`. | fix:   in n int = 0 answer | confusing: 
- reader 2 (yes): answer is only for inputs, and n is a var. | fix: in n int = 0 answer | confusing: 
- reader 3 (yes): 'answer' can only be used on an input line. This is a var line. | fix: in n int = 0 answer | confusing: The message says 'only an input (in) can be an answer', so I moved the word to an 'in' line, but I am not sure this is what the author meant.

## E350 `mkp.missing-default` error at `packages/core/src/syntax/mkp.ts:641`

message: a var always has a default: "var n type = value"

block:
```
# Tally

```mkp
tally "A running count."
  var n int
  project md = "Count"
```

```

builder: Easy; the message shows the corrected form.

- reader 1 (yes): A `var` must have a default value after `=`. | fix:   var n int = 0 | confusing: 
- reader 2 (yes): A var must have a default value. | fix: var n int = 0 | confusing: 
- reader 3 (yes): A var always needs a default value, and this one has none. | fix: var n int = 0 | confusing: 

## E351 `mkp.syntax` error at `packages/core/src/syntax/mkp.ts:648`

message: expected "out name …"

block:
```
# Tally

```mkp
tally "A running count."
  out
  project md = "Count"
```

```

builder: Easy to trigger; the message states the rule directly.

- reader 1 (yes): `out` needs a name after it. | fix:   out answered {correct: bool} | confusing: 
- reader 2 (yes): An out line needs a name, and the block has none. | fix: out answered {correct: bool} | confusing: 
- reader 3 (yes): An 'out' line needs a name after the keyword, and here it has none. | fix: out done | confusing: 

## E352 `mkp.syntax` error at `packages/core/src/syntax/mkp.ts:652`

message: a signal declares its payload: signal name {field: type, …}

block:
```
# Tally

```mkp
tally "A running count."
  signal changed
  project md = "Count"
```

```

builder: Easy to trigger; the message states the rule directly.

- reader 1 (yes): A signal must list the fields of its payload in braces, with types. | fix:   signal changed {value: int}  (I chose the field name and type; the right ones depend on what the signal carries.) | confusing: 
- reader 2 (yes): A signal must name the fields it carries. | fix: signal changed {value: int} | confusing: 
- reader 3 (yes): A signal needs its payload fields given in braces, such as {field: type}. | fix: signal changed {n: int} | confusing: The field name and type are invented; the block does not say what the signal should carry.

## E353 `mkp.syntax` error at `packages/core/src/syntax/mkp.ts:670`

message: expected "project md = expression" or "project mermaid = expression"

block:
```
# Tally

```mkp
tally "A running count."
  var n int = 0
  project html = "Count"
```

```

builder: Easy to trigger; the message states the rule directly.

- reader 1 (yes): `project` may be md or mermaid. `html` is not allowed. | fix:   project md = "Count" | confusing: 
- reader 2 (yes): Only the md and mermaid projections are allowed here. html is not. | fix: project md = "Count" | confusing: 
- reader 3 (yes): The project line must be md or mermaid, and 'html' is neither. | fix: project md = "Count" | confusing: 

## E354 `mkp.event-placement` error at `packages/core/src/syntax/mkp.ts:687`

message: an event belongs under the element or state line it handles; indent it below that line

block:
```
# Tally

```mkp
tally "A running count."
  var n int = 0
  @click set n=(n + 1)
  project md = "Count"
```

```

builder: Easy; message says where the line should go.

- reader 1 (yes): An event line must sit under the element or state line it handles. This one is at the top level. | fix:   var n int = 0
  press label="more"
    @click set n=(n + 1) | confusing: 
- reader 2 (yes): An event must be indented under the element or state line it handles. The @click line is at the same level as var. | fix: press label="more"
    @click set n=(n + 1) | confusing: 
- reader 3 (yes): An event must be indented under the element or state line it handles. Here it sits at the same level as 'var n', so it has no target. | fix: Put the event under a widget, for example 'press label="more"' with '@click set n=(n + 1)' indented below it. | confusing: 

## E355 `mkp.syntax` error at `packages/core/src/syntax/mkp.ts:700`

message: expected choice(a|b|…)

block:
```
# Tally

```mkp
tally "A running count."
  mode = choice(a|(b))
  project md = "Count"
```

```

builder: Easy to trigger; the message states the rule directly.

- reader 1 (yes): `choice(...)` takes plain alternatives separated by |, without brackets around them. | fix:   mode = choice(a|b) | confusing: 
- reader 2 (yes): A choice needs option names separated by |, and (b) is not a name. | fix: mode = choice(a|b) | confusing: 
- reader 3 (yes): The choice(...) option list must be written with bars and plain names, not brackets around 'b'. | fix: mode = choice(a|b) | confusing: 

## E356 `mkp.syntax` error at `packages/core/src/syntax/mkp.ts:702`

message: "2hard" is not a valid option name

block:
```
# Tally

```mkp
tally "A running count."
  mode = choice(easy|2hard)
  project md = "Count"
```

```

builder: Easy. The message names the offending text and the rule.

- reader 1 (yes): An option name cannot start with a digit, so `2hard` is invalid. | fix:   mode = choice(easy|hard) | confusing: 
- reader 2 (yes): An option name cannot start with a digit. | fix: mode = choice(easy|hard) | confusing: 
- reader 3 (yes): '2hard' starts with a digit, so it is not a valid option name. | fix: mode = choice(easy|hard) | confusing: 

## E357 `mkp.event-placement` error at `packages/core/src/syntax/mkp.ts:724`

message: only events (@name action …) may be indented under a state line

block:
```
# Tally

```mkp
tally "A running count."
  speed = slider 0..10
    text "fast"
  project md = "Count"
```

```

builder: Easy; message says where the line should go.

- reader 1 (yes): Under a state line only events may appear, and the `text` line is not one. | fix:   speed = slider 0..10
    @change set n=1 | confusing: 
- reader 2 (yes): Under a state line only events may be indented, and the text line is not one. | fix: Delete the 'text "fast"' line. | confusing: 
- reader 3 (yes): Only events (lines starting with @) may be indented under a state line. 'text "fast"' is not allowed there. | fix: Delete the indented 'text "fast"' line. | confusing: 

## E358 `mkp.continuation` error at `packages/core/src/syntax/mkp.ts:737`

message: this line goes on with the one above, which works only inside an open bracket: put size=… on the line above, or break the line inside its (…)

block:
```
# Tally

```mkp
tally "A running count."
  var n int = 0
  text "\val{n}"
    size=large
  project md = "Count"
```

```

builder: Natural mistake when splitting a long element line. The message explains it well.

- reader 1 (yes): A line that continues the one above works only inside an open bracket. Here `size=large` is on its own line. | fix:   text "\val{n}" size=large | confusing: 
- reader 2 (yes): size=large is on its own line, but it can only continue a line inside brackets or on the line above. | fix: text "\\val{n}" size=large | confusing: 
- reader 3 (yes): 'size=large' is on its own line, indented under text, and it only works inside a bracket or on the same line. | fix:   text "\\val{n}" size=large | confusing: 

## E359 `mkp.syntax` error at `packages/core/src/syntax/mkp.ts:738`

message: ""Count"" is not a valid element name

block:
```
# Tally

```mkp
tally "A running count."
  var n int = 0
  row
    "Count"
  project md = "Count"
```

```

builder: Easy. The message names the offending text and the rule.

- reader 1 (yes): A quoted string is not an element. Text needs the `text` element. | fix:     text "Count" | confusing: 
- reader 2 (yes): A bare string inside a row is not a widget. It needs to be wrapped in a widget such as text. | fix: text "Count" | confusing: 
- reader 3 (yes): A quoted string on its own line is not an element name, so it cannot be used as one. | fix: text "Count" | confusing: I changed the line to a text element, which is my guess at what was meant.

## E360 `mkp.syntax` error at `packages/core/src/syntax/mkp.ts:756`

message: expected "@event action …"

block:
```
# Tally

```mkp
tally "A running count."
  var n int = 0
  press label="more"
    @ set n=(n + 1)
  project md = "Count"
```

```

builder: Easy; message says where the line should go.

- reader 1 (yes): An event needs its name after `@`, such as `@click`. | fix:     @click set n=(n + 1) | confusing: 
- reader 2 (yes): An event line starts with @ and then the event name, such as click. | fix: @click set n=(n + 1) | confusing: 
- reader 3 (yes): An event line must name the event, such as @click, and '@ set' has no event name. | fix:     @click set n=(n + 1) | confusing: 

## E361 `mkp.syntax` error at `packages/core/src/syntax/mkp.ts:762`

message: an event line has one if=

block:
```
# Tally

```mkp
tally "A running count."
  var n int = 0
  press label="more"
    @click if=(n < 9) set n=(n + 1) if=(n > 0)
  project md = "Count"
```

```

builder: Easy; message says where the line should go.

- reader 1 (yes): An event line may have only one `if=`. This line has two. | fix:     @click if=(n < 9) set n=(n + 1)  (I dropped the second condition; combine both into one if= if you still need it.) | confusing: 
- reader 2 (yes): An event line can have only one if=. The second one is extra. | fix: @click if=(n < 9) set n=(n + 1) | confusing: 
- reader 3 (yes): An event line can have only one if=. The line has two. | fix: @click if=(n < 9) set n=(n + 1) | confusing: I removed the second if=(n > 0) without knowing whether it was meant as a separate condition.

## E362 `mkp.syntax` error at `packages/core/src/syntax/mkp.ts:774`

message: the event "@click" has no actions

block:
```
# Tally

```mkp
tally "A running count."
  var n int = 0
  press label="more"
    @click
  project md = "Count"
```

```

builder: Easy; message says where the line should go.

- reader 1 (yes): An event line must contain at least one action after `@click`. | fix:     @click set n=(n + 1) | confusing: 
- reader 2 (yes): @click has no action. It must do at least one, such as set. | fix: @click set n=n + 1 | confusing: 
- reader 3 (yes): The @click event has no actions after it, so it does nothing. | fix: @click set n=(n + 1) | confusing: I chose the set action with n + 1 because n is declared in this block. The author may have meant another action.

## E363 `mkp.unknown-action` error at `packages/core/src/syntax/mkp.ts:790`

message: "bump" is not an action; actions are set, play, pause, reset, reveal, hide, open, close, emit, send

block:
```
# Tally

```mkp
tally "A running count."
  var n int = 0
  press label="more"
    @click bump n=(n + 1)
  project md = "Count"
```

```

builder: Easy to trigger; the message states the rule directly.

- reader 1 (yes): `bump` is not an action. The valid actions include set, play and emit. | fix:     @click set n=(n + 1) | confusing: 
- reader 2 (yes): bump is not an action. Valid actions include set. | fix: @click set n=(n + 1) | confusing: 
- reader 3 (yes): 'bump' is not an action. The allowed actions are set, play, pause, reset, reveal, hide, open, close, emit and send. | fix:     @click set n=(n + 1) | confusing: 

## E364 `mkp.syntax` error at `packages/core/src/syntax/mkp.ts:800`

message: expected a value after "n="

block:
```
# Tally

```mkp
tally "A running count."
  var n int = 0
  press label="more"
    @click set n=
  project md = "Count"
```

```

builder: Easy to trigger; the message states the rule directly.

- reader 1 (yes): `set n=` has no value after the equals sign. | fix:     @click set n=(n + 1) | confusing: 
- reader 2 (yes): set n= needs a value after the '='. | fix: @click set n=(n + 1) | confusing: 
- reader 3 (yes): 'n=' has no value after it, so the set action is incomplete. | fix: @click set n=(n + 1) | confusing: 

## E365 `mkp.syntax` error at `packages/core/src/syntax/mkp.ts:394`

message: unpublished takes nothing after it

block:
```
pack units@1 "Distances in kilometres."
  requires core@1
  unpublished yes

```

builder: Manifest lines are only parsed in manifest.mkp; the same line in another file gives a different, unhelpful message.

- reader 1 (yes): `unpublished` is a plain flag with no value after it. The word `yes` is extra. | fix:   unpublished | confusing: 
- reader 2 (yes): unpublished is a bare flag and takes nothing after it. | fix: unpublished | confusing: 
- reader 3 (yes): unpublished is a flag and takes nothing after it, but 'yes' follows. | fix:   unpublished | confusing: 

## E366 `mkp.syntax` error at `packages/core/src/syntax/mkp.ts:399`

message: expected "front name type [= value] ["about"]"

block:
```
pack units@1 "Distances in kilometres."
  requires core@1
  front

```

builder: Needs a pack manifest. The message quotes the expected shape, which helps.

- reader 1 (yes): `front` needs a name and a type after it. | fix:   front title text | confusing: 
- reader 2 (yes): A front line needs a name and a type, and the block gives only the keyword. | fix: front title text | confusing: 
- reader 3 (yes): A front line needs a name and a type, and here it has neither. | fix: front title text | confusing: 

## E367 `mkp.syntax` error at `packages/core/src/syntax/mkp.ts:406`

message: expected "attr name type ["about"]" (role and id are taken)

block:
```
pack units@1 "Distances in kilometres."
  requires core@1
  attr role text "who it is for"

```

builder: role and id are reserved; message says so only in a parenthesis.

- reader 1 (yes): The name `role` is reserved, so the attribute needs another name. | fix:   attr audience text "who it is for" | confusing: The message says 'role and id are taken' but doesn't say what they are for.
- reader 2 (yes): role is a reserved attribute name, so the attr needs another name. | fix: attr audience text "who it is for" | confusing: 
- reader 3 (yes): The name 'role' is reserved, so it cannot be an attr name. An attr line needs a name, a type and an optional description. | fix: attr audience text "who it is for" | confusing: The message says role and id are taken, but I do not know the full list of reserved names, so the new name may also clash.

## E368 `mkp.syntax` error at `packages/core/src/syntax/mkp.ts:408`

message: a block attribute has no default: a block without it has none

block:
```
pack units@1 "Distances in kilometres."
  requires core@1
  attr level int = 1 "how hard"

```

builder: Needs a pack manifest. The message quotes the expected shape, which helps.

- reader 1 (partly): A block attribute has no default value. A block that leaves it out gets none, so the default `= 1` is not allowed here. | fix:   attr level int "how hard" | confusing: I'm not sure what 'a block without it has none' means for how the value is used.
- reader 2 (partly): A block attribute cannot have a default. attr level int = 1 gives it one, which is not allowed. | fix: attr level int "how hard" | confusing: "A block without it has none" is unclear to me.
- reader 3 (yes): A block attribute has no default value, so a block without it has none. The line gives 'int = 1', which is a default. | fix: attr level int "how hard" | confusing: The message says a block without the attribute has no default, so the = 1 is removed. I am not sure whether the author wanted this.

## E369 `mkp.syntax` error at `packages/core/src/syntax/mkp.ts:415`

message: expected "rule name path [args] ["message"]"

block:
```
pack units@1 "Distances in kilometres."
  requires core@1
  rule unique

```

builder: Needs a pack manifest. The message quotes the expected shape, which helps.

- reader 1 (yes): `rule` needs a name and a path after it. `unique` is only the name. | fix:   rule required front.title | confusing: I'm not sure what 'unique' was meant to do, so I used `required` as a valid rule name.
- reader 2 (partly): A rule line needs a rule name, then a path, then optional arguments and a message. The block gives 'unique' and no path. | fix: rule required front.title "a title is required" | confusing: unique is not one of the rule names I saw in earlier errors, so I substituted required.
- reader 3 (partly): A rule line needs a name, a path and optional arguments, and 'unique' has no path after it. | fix: rule unique front.title "titles are unique" | confusing: I do not know what the path after 'unique' should be, so I guessed front.title.

## E370 `mkp.syntax` error at `packages/core/src/syntax/mkp.ts:423`

message: a manifest line is requires, depends, provides, front, attr, roles, rule or unpublished; found "export"

block:
```
pack units@1 "Distances in kilometres."
  requires core@1
  export distance

```

builder: Manifest lines only parse in manifest.mkp, so the trial needs a pack.

- reader 1 (yes): A manifest line must be one of the listed keywords. `export` is not one of them. | fix:   provides distance | confusing: 
- reader 2 (yes): export is not a manifest line. The valid ones include provides. | fix: provides distance | confusing: I do not know what export was meant to do, so provides is a guess.
- reader 3 (yes): 'export' is not a manifest line. The allowed lines are requires, depends, provides, front, attr, roles, rule and unpublished. | fix: provides distance | confusing: The fix guesses that 'export' was meant as 'provides'. The meaning may differ.

# Not triggered from a document or pack (still improve the wording)

- `packages/core/src/syntax/expr.ts:53` `mkp.syntax`: <msg> (Shared helper (fail) used by every expression syntax error; each caller is its own line here.)
- `packages/core/src/syntax/mkp.ts:182` `mkp.syntax`: <msg> (Shared helper (LineCtx.fail) used by every definition-syntax error; each caller is its own line here.)
