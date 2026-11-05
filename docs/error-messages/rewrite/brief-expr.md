# expr: 62 messages

## E184 `mkp.type-syntax` error at `packages/core/src/types.ts:65`

message: expected ")" in the type

block:
```
# Notes

```mkp
gauge "A reading."
  in x list(int
  text "\val{x}"
  project md = "reading"
```

```gauge
summary: A small widget.
```

```

builder: The shared fail helper; every type-syntax message goes through it. Easy to trigger by leaving a bracket open, but the message points at the NEXT line (6:3) because the bracket swallowed the line end, and an extra mkp.unclosed-bracket is printed. Message does not say which bracket.

- reader 1 (yes): The type `list(int` is missing its closing bracket. | fix:   in x list(int) | confusing: 
- reader 2 (yes): The type list(int is missing its closing ')'. | fix: in x list(int) | confusing: 
- reader 3 (yes): The type list(int has no closing bracket. | fix: in x list(int) | confusing: 

## E185 `mkp.type-syntax` error at `packages/core/src/types.ts:73`

message: expected "," in the type

block:
```
# Notes

```mkp
gauge "A reading."
  in x path(text int)
  text "\val{x}"
  project md = "reading"
```

```gauge
summary: A small widget.
```

```

builder: Easy. Wrote path(text int) forgetting the comma. The message says what is missing but not which type constructor it is inside; the column points at the second type, which helps.

- reader 1 (partly): The type `path(text int)` is missing a comma between its two types. | fix:   in x path(text, int) | confusing: I'm not sure of the path type's argument order.
- reader 2 (yes): path takes two arguments separated by a comma. The block has no comma. | fix: in x path(text, int) | confusing: 
- reader 3 (yes): path takes a comma between its two types, and the block gives a space. | fix: in x path(text, int) | confusing: 

## E186 `mkp.type-syntax` error at `packages/core/src/types.ts:82`

message: expected a number in the range

block:
```
# Notes

```mkp
gauge "A reading."
  in x int 1..x
  text "\val{x}"
  project md = "reading"
```

```gauge
summary: A small widget.
```

```

builder: Easy. Tried a range bound that is an input name. A secondary unknown-name for x appears because the failed input never got declared, which is noise.

- reader 1 (yes): The range upper bound `x` is a name, not a number. A range needs literal numbers. | fix:   in x int 1..10 | confusing: 
- reader 2 (yes): A range must have numbers at both ends, and x is not a number. | fix: in x int 1..5 | confusing: 
- reader 3 (yes): A range needs numbers at both ends, and 'x' is a name, not a number. | fix: in x int 1..5 = 3 | confusing: 

## E187 `mkp.type-syntax` error at `packages/core/src/types.ts:92`

message: expected a type

block:
```
# Notes

```mkp
gauge "A reading."
  in x list(3)
  text "\val{x}"
  project md = "reading"
```

```gauge
summary: A small widget.
```

```

builder: Easy, but a number inside list() is not a natural author mistake; message is terse and does not say what a type looks like.

- reader 1 (yes): `list(3)` is not a type. The number 3 cannot be a list element type. | fix:   in x list(int) | confusing: 
- reader 2 (yes): list needs a type, and 3 is a number. | fix: in x list(int) | confusing: 
- reader 3 (yes): list(3) gives the number 3 where a type is needed. | fix: in x list(int) | confusing: 

## E188 `mkp.type-syntax` error at `packages/core/src/types.ts:117`

message: expected a variable name in expr(…)

block:
```
# Notes

```mkp
gauge "A reading."
  in x expr(3)
  text "\val{x}"
  project md = "reading"
```

```gauge
summary: A small widget.
```

```

builder: Easy. expr(3) is an unnatural slip; message is clear. Cascading unknown-name for x.

- reader 1 (partly): `expr(...)` needs the name of a variable inside it, but `3` is a number. | fix:   in x expr(n) | confusing: I don't know what expr is for, so the fix is a guess at its intent.
- reader 2 (yes): expr takes a variable name, not a number. | fix: in x expr(x) | confusing: 
- reader 3 (yes): expr(...) must name a variable inside the brackets, and '3' is a number. | fix: cannot infer | confusing: I do not know which variable name the expr should use, so I cannot write the fix.

## E189 `mkp.type-syntax` error at `packages/core/src/types.ts:139`

message: expected an option in choice(…)

block:
```
# Notes

```mkp
gauge "A reading."
  in x choice(a|1)
  text "\val{x}"
  project md = "reading"
```

```gauge
summary: A small widget.
```

```

builder: Easy. A numeric option (a|1) is rejected as not an identifier; the message does not say options must be words.

- reader 1 (yes): Each option in `choice(...)` must be a name, and `1` is a number. | fix:   in x choice(a|b) | confusing: 
- reader 2 (yes): Options in choice(…) must be names, and 1 is a number. | fix: in x choice(a|b) | confusing: 
- reader 3 (partly): The option list of 'choice' expects names, but '1' is not a valid option. | fix: in x choice(a|b) | confusing: I do not know exactly what 'option' means here, so I am guessing that options must be words.

## E190 `mkp.type-syntax` error at `packages/core/src/types.ts:154`

message: expected the record name

block:
```
# Notes

```mkp
gauge "A reading."
  in x list(record 5 {a: int})
  text "\val{x}"
  project md = "reading"
```

```gauge
summary: A small widget.
```

```

builder: Easy but contrived: the record keyword followed by a number.

- reader 1 (yes): `record` must be followed by a name, and `5` is not a name. | fix:   in x list(record row {a: int}) | confusing: 
- reader 2 (yes): A record type needs a name after the word record. The block gives 5. | fix: in x list(record row {a: int}) | confusing: 
- reader 3 (yes): A record needs a name, and '5' is a number. | fix: in x list(record row {a: int}) | confusing: The record name is required, but the message does not say what kind of name is allowed.

## E191 `mkp.type-syntax` error at `packages/core/src/types.ts:199`

message: expected a field name

block:
```
# Notes

```mkp
gauge "A reading."
  in x list(record row {3: int})
  text "\val{x}"
  project md = "reading"
```

```gauge
summary: A small widget.
```

```

builder: Easy; the field name was a number. Cascading unknown-name again.

- reader 1 (yes): A record field needs a name, and `3` is not a name. | fix:   in x list(record row {a: int}) | confusing: 
- reader 2 (yes): A record field must have a name. The block gives the number 3. | fix: in x list(record row {n: int}) | confusing: 
- reader 3 (yes): A record field needs a name, and '3' is a number. | fix: in x list(record row {a: int}) | confusing: I chose the name 'a' for the field. The author may have meant another name.

## E192 `mkp.token-value` error at `packages/core/src/tokens.ts:35`

message: color brand: value must be a hex colour such as "#2563eb"

block:
```
--- look.mkp ---
tokens look@1 "Newsletter colours."
  color brand "blue"
--- manifest.mkp ---
pack brand@1 "Colours for a school newsletter."
  requires core@1
  provides look
  unpublished

```

builder: Easy once I knew the token file syntax (found it in a test, not the guide: the authoring guide never shows a tokens file). I wrote a colour name as a value, which is a natural mistake; the message is good and gives an example.

- reader 1 (yes): A colour token's value must be a hex colour, such as "#2563eb", not a word. | fix:   color brand "#2563eb" | confusing: 
- reader 2 (yes): A colour value must be a hex code, such as #2563eb, and "blue" is not one. | fix: color brand "#2563eb" | confusing: 
- reader 3 (yes): A 'color' token must be a hex value such as #2563eb, not a color name. | fix: color brand "#2563eb" | confusing: 

## E193 `mkp.token-syntax` error at `packages/core/src/tokens.ts:42`

message: space tokens are written name=value

block:
```
--- look.mkp ---
tokens look@1 "Newsletter colours."
  space xs=2 s=4 "tight"
--- manifest.mkp ---
pack brand@1 "Colours for a school newsletter."
  requires core@1
  provides look
  unpublished

```

builder: Needed to read source to learn that a line of keyed values is the form and a stray bare word is the error. The message says "name=value" but the offending bare argument is a quoted string I had put in as a label, and it is not named in the message.

- reader 1 (partly): Each space token must be written name=value. The line has `"tight"`, a bare string, which doesn't fit that form. | fix:   space xs=2 s=4  (remove "tight"; check each token is name=value) | confusing: The message doesn't say which item is wrong, so I'm guessing from the line.
- reader 2 (partly): Space tokens are written name=value. The line has a quoted word after the values. | fix: space xs=2 s=4 | confusing: I do not know whether the quoted "tight" is a description or a token, so I removed it.
- reader 3 (yes): A space token is written with a name and a value, joined by '=', such as xs=2. | fix:   space xs=2 s=4 | confusing: I removed the word 'tight', so the description may be lost.

## E194 `mkp.maths` error at `packages/core/src/maths.ts:162`

message: $\sum_{k=1}^{n} \frac{1}{k$: Missing close brace

block:
```
# Sums

The series is $\sum_{k=1}^{n} \frac{1}{k$ and it grows slowly.

```

builder: Easy. The message echoes the whole formula with the KaTeX error text, but the position is only the start of the paragraph (3:1), not the formula, so in a long paragraph you have to hunt. Wrapping the formula in dollars inside the message is slightly confusing next to the dollars of the source.

- reader 1 (yes): The maths has an open brace `{` after `1/k` that is never closed. | fix: The series is $\sum_{k=1}^{n} \frac{1}{k}$ and it grows slowly. | confusing: 
- reader 2 (yes): The LaTeX has an unclosed brace: \frac{1}{k is missing its closing }. | fix: The series is $\sum_{k=1}^{n} \frac{1}{k}$ and it grows slowly. | confusing: 
- reader 3 (yes): The LaTeX has an opening brace in 'frac{1}{k' that is never closed, so the maths is broken. | fix: The series is $\sum_{k=1}^{n} \frac{1}{k}$ and it grows slowly. | confusing: 

## E195 `mkp.type` error at `packages/core/src/check/expr.ts:150`

message: list items must share one type; found int and text

block:
```
# Notes

```mkp
gauge "A reading."
  in n int = 2
  in label text = "a"
  in on bool = true
  in xs list(int) = [1, 2, 3]
  in d dict(int) = {}
  in c choice(low|high) = low

  r = [1, "two"]
  text "\val{n}"
  project md = "Reading: " + format(n, 0)
```

```gauge
summary: A small widget.
```

```

builder: Easy: a list literal mixing a number and a word. Message names the types but points at the whole list (col of the bracket), not the offending item, and the item position is not given.

- reader 1 (yes): A list needs every item to have one type, and `[1, "two"]` mixes int and text. | fix:   r = [1, 2] | confusing: 
- reader 2 (yes): All items in a list must have one type. [1, "two"] mixes int and text. | fix: r = [1, 2] | confusing: 
- reader 3 (yes): A list needs all its items to be the same type, but [1, "two"] mixes int and text. | fix: r = [1, 2] | confusing: 

## E196 `mkp.type` error at `packages/core/src/check/expr.ts:160`

message: expected a record with title

block:
```
# Notes

```mkp
type task = {title: text}
fn lead(t: task): text = t.title
gauge "A reading."
  in n int = 2
  in label text = "a"
  in on bool = true
  in xs list(int) = [1, 2, 3]
  in d dict(int) = {}
  in c choice(low|high) = low

  r = lead({})
  text "\val{n}"
  project md = "Reading: " + format(n, 0)
```

```gauge
summary: A small widget.
```

```

builder: Needed a record type with a function taking it, then passing {}. The message lists field names but not their types, and is reported as mkp.type with no hint that {} means an empty dict elsewhere.

- reader 1 (yes): `lead` takes a `task` record with a title. `{}` is an empty dict, so it has no title. | fix:   r = lead({title: "Hi"}) | confusing: 
- reader 2 (yes): lead needs a task record with a title, and {} has none. | fix: r = lead({title: "Hi"}) | confusing: 
- reader 3 (yes): 'lead' expects a task record with a title, and '{}' has no title. | fix: r = lead({title: "Read"}) | confusing: 

## E197 `mkp.unknown-field` error at `packages/core/src/check/expr.ts:200`

message: swatch has no field "colur" (did you mean "colour"?)

block:
```
# Notes

```mkp
type swatch = {name: text, colour: color}
const sweep: swatch = {name: "sky", colour: info}
gauge "A reading."
  in n int = 2
  in label text = "a"
  in on bool = true
  in xs list(int) = [1, 2, 3]
  in d dict(int) = {}
  in c choice(low|high) = low

  r = sweep.colur
  text "\val{n}"
  project md = "Reading: " + format(n, 0)
```

```gauge
summary: A small widget.
```

```

builder: Easy; needs a type and a const. The did-you-mean suggestion makes it excellent. Without a close name no suggestion and no list of the real fields is given.

- reader 1 (yes): The swatch type has no field `colur`. The field is `colour`. | fix:   r = sweep.colour | confusing: 
- reader 2 (yes): swatch has no field colur. The field is colour, and this is a typo. | fix: r = sweep.colour | confusing: 
- reader 3 (yes): The swatch record has no field called colur. Its fields are name and colour. | fix: r = sweep.colour | confusing: 

## E198 `mkp.unknown-field` error at `packages/core/src/check/expr.ts:204`

message: list(int) has no fields; "len" can't be read from it

block:
```
# Notes

```mkp
gauge "A reading."
  in n int = 2
  in label text = "a"
  in on bool = true
  in xs list(int) = [1, 2, 3]
  in d dict(int) = {}
  in c choice(low|high) = low

  r = xs.len
  text "\val{n}"
  project md = "Reading: " + format(n, 0)
```

```gauge
summary: A small widget.
```

```

builder: Easy: xs.len, a habit from other languages. The message is reasonable but does not point to len(xs) as the fix.

- reader 1 (yes): A list has no fields, so `.len` can't be used. The length is read with `len(...)`. | fix:   r = len(xs) | confusing: 
- reader 2 (yes): list(int) has no fields, so .len cannot be read from it. | fix: r = len(xs) | confusing: 
- reader 3 (yes): 'len' is a function, not a field of a list, so 'xs.len' is not valid. | fix: r = len(xs) | confusing: 

## E199 `mkp.type` error at `packages/core/src/check/expr.ts:213`

message: task is read by a path (an input typed path(…)) or with .field; found int

block:
```
# Notes

```mkp
type task = {title: text}
gauge "A reading."
  in n int = 2
  in label text = "a"
  in on bool = true
  in xs list(int) = [1, 2, 3]
  in d dict(int) = {}
  in c choice(low|high) = low
  in t task
  r = t[n]
  text "\val{n}"
  project md = "Reading: " + format(n, 0)
```

```gauge
t: {title: Hello}
summary: A small widget.
```

```

builder: Needed a record-typed input and an index with a non-path. The wording "(an input typed path(…))" is dense; a reader unfamiliar with paths cannot tell what to do. Reported as mkp.type.

- reader 1 (yes): `t` is a record, so its fields are read with `.field` or a path. Indexing with an int `n` is not allowed. | fix:   r = t.title | confusing: 
- reader 2 (yes): t is a task, so it is read with .field or a path. t[n] uses an int. | fix: r = t.title | confusing: 
- reader 3 (yes): A task record is read by name, such as t.title, or by a path. 't[n]' indexes it with an int, which is not allowed. | fix: r = t.title | confusing: 

## E200 `mkp.type` error at `packages/core/src/check/expr.ts:214`

message: this path reads note, not task

block:
```
# Notes

```mkp
type task = {title: text}
type note = {body: text}
gauge "A reading."
  in n int = 2
  in label text = "a"
  in on bool = true
  in xs list(int) = [1, 2, 3]
  in d dict(int) = {}
  in c choice(low|high) = low
  in t task
  in p path(note, text)
  r = t[p]
  text "\val{n}"
  project md = "Reading: " + format(n, 0)
```

```gauge
t: {title: Hello}
p: body
summary: A small widget.
```

```

builder: Needed two record types and a path whose record is the other type. Message is short and clear but does not name the path variable.

- reader 1 (yes): The path `p` reads a `note` record, but it is used on a `task` value. | fix: Use a path that reads task, or change `in p path(note, text)` to `path(task, text)` with a task field. | confusing: 
- reader 2 (partly): p is a path over note records, but t is a task. A path used on t must read task fields. | fix: Change the input to 'in p path(task, text)' and set 'p: title' in the YAML. | confusing: I cannot tell whether note or task is the intended record.
- reader 3 (yes): The path p reads a note record, but it is used to index a task record, so the types do not match. | fix: cannot infer | confusing: The path p is set to 'body', which is a field of note, not task. I cannot tell whether the task type or the path was meant to change.

## E201 `mkp.type` error at `packages/core/src/check/expr.ts:223`

message: dict keys are text; found int

block:
```
# Notes

```mkp
gauge "A reading."
  in n int = 2
  in label text = "a"
  in on bool = true
  in xs list(int) = [1, 2, 3]
  in d dict(int) = {}
  in c choice(low|high) = low

  r = d[n]
  text "\val{n}"
  project md = "Reading: " + format(n, 0)
```

```gauge
summary: A small widget.
```

```

builder: Easy: d[n] with an int key. Clear message.

- reader 1 (yes): Dict keys are text, but `n` is an int. | fix:   r = d[label] | confusing: 
- reader 2 (yes): A dict's keys are text, and n is an int. | fix: r = d[label] | confusing: 
- reader 3 (yes): A dict's keys are text, but 'n' is an int. | fix: r = d[label] | confusing: 

## E202 `mkp.type` error at `packages/core/src/check/expr.ts:228`

message: only lists and dicts can be indexed; found text

block:
```
# Notes

```mkp
gauge "A reading."
  in n int = 2
  in label text = "a"
  in on bool = true
  in xs list(int) = [1, 2, 3]
  in d dict(int) = {}
  in c choice(low|high) = low

  r = label[0]
  text "\val{n}"
  project md = "Reading: " + format(n, 0)
```

```gauge
summary: A small widget.
```

```

builder: Easy: indexing a text value. Surprising that text cannot be indexed while slice/len work on text; message does not point to slice().

- reader 1 (yes): Only lists and dicts can be indexed. `label` is text. | fix:   r = xs[0] | confusing: 
- reader 2 (yes): Only lists and dicts can be indexed. label is text. | fix: r = xs[0] | confusing: 
- reader 3 (yes): Only lists and dicts can be indexed. 'label' is text. | fix: r = xs[0] | confusing: 

## E203 `mkp.type` error at `packages/core/src/check/expr.ts:243`

message: "not" needs a boolean; found int

block:
```
# Notes

```mkp
gauge "A reading."
  in n int = 2
  in label text = "a"
  in on bool = true
  in xs list(int) = [1, 2, 3]
  in d dict(int) = {}
  in c choice(low|high) = low

  r = not n
  text "\val{n}"
  project md = "Reading: " + format(n, 0)
```

```gauge
summary: A small widget.
```

```

builder: Easy. Clear.

- reader 1 (yes): `not` takes a boolean, and `n` is an int. | fix:   r = not on | confusing: 
- reader 2 (yes): not needs a boolean. n is an int. | fix: r = not on | confusing: 
- reader 3 (yes): not needs a boolean, and 'n' is an int. | fix: r = not on | confusing: 

## E204 `mkp.type` error at `packages/core/src/check/expr.ts:250`

message: "and" needs booleans; found int

block:
```
# Notes

```mkp
gauge "A reading."
  in n int = 2
  in label text = "a"
  in on bool = true
  in xs list(int) = [1, 2, 3]
  in d dict(int) = {}
  in c choice(low|high) = low

  r = n and on
  text "\val{n}"
  project md = "Reading: " + format(n, 0)
```

```gauge
summary: A small widget.
```

```

builder: Easy. The operator is named, the wrong operand is located, but the message says "found int" without saying which side.

- reader 1 (yes): `and` needs booleans on both sides, and `n` is an int. | fix:   r = (n > 1) and on | confusing: 
- reader 2 (yes): and joins two booleans, and n is an int. | fix: r = (n > 1) and on | confusing: 
- reader 3 (yes): 'and' needs two booleans, but 'n' is an int. | fix: r = on and (n > 1) | confusing: 

## E205 `mkp.type` error at `packages/core/src/check/expr.ts:267`

message: a lambda (x => …) can only be passed where a function is expected

block:
```
# Notes

```mkp
gauge "A reading."
  in n int = 2
  in label text = "a"
  in on bool = true
  in xs list(int) = [1, 2, 3]
  in d dict(int) = {}
  in c choice(low|high) = low

  r = x => x + 1
  text "\val{n}"
  project md = "Reading: " + format(n, 0)
```

```gauge
summary: A small widget.
```

```

builder: Easy: a lambda assigned to a derived value. Clear, though it does not say which built-ins want one.

- reader 1 (yes): A lambda `x => ...` can only be given to a function parameter, not stored in a plain variable `r`. | fix:   fn inc(x: int): int = x + 1
  r = inc(n) | confusing: 
- reader 2 (yes): A lambda can only be passed to a function, not stored in a value. | fix: r = map(xs, x => x + 1) | confusing: 
- reader 3 (yes): A lambda (x => ...) is only allowed as an argument to a function that takes one. It cannot be assigned like this. | fix: Pass it directly to a function, for example r = map(xs, x => x + 1). | confusing: 

## E206 `mkp.type` error at `packages/core/src/check/expr.ts:270`

message: this function takes 1 parameter(s), not 2

block:
```
# Notes

```mkp
gauge "A reading."
  in n int = 2
  in label text = "a"
  in on bool = true
  in xs list(int) = [1, 2, 3]
  in d dict(int) = {}
  in c choice(low|high) = low

  r = map(xs, (a, b) => a)
  text "\val{n}"
  project md = "Reading: " + format(n, 0)
```

```gauge
summary: A small widget.
```

```

builder: Easy: a two-parameter lambda given to map. The "(s)" plural hedge reads awkwardly.

- reader 1 (yes): `map` passes one value to its function, but the lambda takes two parameters. | fix:   r = map(xs, a => a) | confusing: 
- reader 2 (yes): map's function takes one parameter. The block gives two, (a, b). | fix: r = map(xs, a => a) | confusing: 
- reader 3 (yes): map takes a function with one parameter, and the lambda has two. | fix: r = map(xs, a => a) | confusing: 

## E207 `mkp.unknown-name` error at `packages/core/src/check/expr.ts:326`

message: "bound" is not defined here

block:
```
# Notes

```mkp

gauge "A reading."
  in n int = 2
  in label text = "a"
  in on bool = true
  in xs list(int) = [1, 2, 3]
  in d dict(int) = {}
  in c choice(low|high) = low

  r = bound + 1
  text "\val{n}"
  project md = "Reading: " + format(n, 0)
```

```gauge
summary: A small widget.
```

```

builder: Trivial. No suggestion appears when nothing is close.

- reader 1 (yes): `bound` is not declared or in scope in this definition. | fix:   r = n + 1  (or declare `bound` as an input or var) | confusing: 
- reader 2 (partly): bound is used, but no input, var or const of that name exists. | fix: Add 'in bound int = 1' to the widget, or remove bound and write r = n + 1. | confusing: I cannot tell whether bound was meant to be an input or a value from another file.
- reader 3 (yes): 'bound' is not defined anywhere in this widget. | fix: r = n + 1 | confusing: 

## E208 `mkp.type` error at `packages/core/src/check/expr.ts:334`

message: constant ceiling refers to itself

block:
```
# Notes

```mkp
const ceiling: int = ceiling + 1
gauge "A reading."
  in n int = 2
  in label text = "a"
  in on bool = true
  in xs list(int) = [1, 2, 3]
  in d dict(int) = {}
  in c choice(low|high) = low

  r = ceiling
  text "\val{n}"
  project md = "Reading: " + format(n, 0)
```

```gauge
summary: A small widget.
```

```

builder: Easy with a self-referencing const. The code is the generic mkp.type and the position is the const declaration, good.

- reader 1 (yes): `const ceiling` is defined in terms of itself, so it has no value. | fix: const ceiling: int = 10 | confusing: 
- reader 2 (yes): The constant ceiling uses itself in its own definition. | fix: const ceiling: int = 10 | confusing: 
- reader 3 (yes): 'ceiling' is defined in terms of itself, so there is no starting value. | fix: const ceiling: int = 10 | confusing: 

## E209 `mkp.type` error at `packages/core/src/check/expr.ts:369`

message: expected int, found text

block:
```
# Notes

```mkp

gauge "A reading."
  in n int = 2
  in label text = "a"
  in on bool = true
  in xs list(int) = [1, 2, 3]
  in d dict(int) = {}
  in c choice(low|high) = low
  var k int = label
  r = n
  text "\val{n}"
  project md = "Reading: " + format(n, 0)
```

```gauge
summary: A small widget.
```

```

builder: Easy: a var with a text default for an int. Very generic message, no name of what was being assigned; position is the start of the var line.

- reader 1 (yes): `var k int` is given `label`, which is text. | fix:   var k int = n | confusing: 
- reader 2 (yes): var k is declared int, but its value label is text. | fix: var k text = label | confusing: 
- reader 3 (yes): The var k is typed int but is given the text value label. | fix: var k text = label | confusing: Only the var k line is changed. The var k is not used anywhere else in the block, so the change may not matter.

## E210 `mkp.type` error at `packages/core/src/check/expr.ts:421`

message: can't compare int with text

block:
```
# Notes

```mkp

gauge "A reading."
  in n int = 2
  in label text = "a"
  in on bool = true
  in xs list(int) = [1, 2, 3]
  in d dict(int) = {}
  in c choice(low|high) = low

  r = n == label
  text "\val{n}"
  project md = "Reading: " + format(n, 0)
```

```gauge
summary: A small widget.
```

```

builder: Easy: int == text. Clear.

- reader 1 (yes): An int cannot be compared with text. The two sides need the same type. | fix:   r = n == 2 | confusing: 
- reader 2 (yes): == needs both sides to be the same type, and n is int while label is text. | fix: r = label == "a" | confusing: 
- reader 3 (yes): '==' cannot compare an int with a text value. | fix: r = n == 2 | confusing: 

## E211 `mkp.type` error at `packages/core/src/check/expr.ts:433`

message: can't join list(int) and list(text)

block:
```
# Notes

```mkp

gauge "A reading."
  in n int = 2
  in label text = "a"
  in on bool = true
  in xs list(int) = [1, 2, 3]
  in d dict(int) = {}
  in c choice(low|high) = low

  r = xs + ["a"]
  text "\val{n}"
  project md = "Reading: " + format(n, 0)
```

```gauge
summary: A small widget.
```

```

builder: Easy: adding a list of text to a list of numbers. Surprising that the text-with-number + concatenates but lists do not.

- reader 1 (yes): `+` joins two lists only if their element types match. `xs` is list(int) and `["a"]` is list(text). | fix:   r = xs + [4] | confusing: 
- reader 2 (yes): + cannot join list(int) and list(text). | fix: r = xs + [4] | confusing: 
- reader 3 (yes): list(int) and list(text) cannot be joined with +, because their item types differ. | fix: r = xs + [4] | confusing: 

## E212 `mkp.no-operator` error at `packages/core/src/check/expr.ts:441`

message: no operator + for list(int) and text

block:
```
# Notes

```mkp

gauge "A reading."
  in n int = 2
  in label text = "a"
  in on bool = true
  in xs list(int) = [1, 2, 3]
  in d dict(int) = {}
  in c choice(low|high) = low

  r = xs + label
  text "\val{n}"
  project md = "Reading: " + format(n, 0)
```

```gauge
summary: A small widget.
```

```

builder: Easy. Branch where a list is added to text. The same line also prints "no operator - for text and int" for subtraction; one line recorded here.

- reader 1 (yes): `+` can't join a list of ints with text. The two sides must have the same type. | fix:   r = xs + [4]  (or join the text with other text) | confusing: 
- reader 2 (yes): + cannot join a list and text. xs is list(int) and label is text. | fix: cannot infer (decide what r should be) | confusing: 
- reader 3 (yes): There is no + operator for a list of int and text together. | fix: r = xs + [4] | confusing: The fix assumes the author wanted to add an int to the list. The message does not say what the result should be.

## E213 `mkp.ambiguous` error at `packages/core/src/check/expr.ts:478`

message: blend is ambiguous for (int, int): $doc:blend#0 and $doc:blend#1 fit equally

block:
```
# Notes

```mkp
fn blend(a: num, b: int): int = b
fn blend(a: int, b: num): int = 1
gauge "A reading."
  in n int = 2
  in label text = "a"
  in on bool = true
  in xs list(int) = [1, 2, 3]
  in d dict(int) = {}
  in c choice(low|high) = low

  r = blend(1, 2)
  text "\val{n}"
  project md = "Reading: " + format(n, 0)
```

```gauge
summary: A small widget.
```

```

builder: Needed two fns of one name. The message prints internal ids ($doc:blend#0), which an author never wrote. Hard to see which declarations clash. Also the gap: an any-typed pair gave no-overload instead, so ambiguity only arises with overlapping num/int params.

- reader 1 (partly): Two definitions of `blend` both match (int, int) equally, so the call is ambiguous. | fix: Give the parameters distinct types, or remove one of the two `blend` definitions. | confusing: The message says 'fit equally'; I can't see how to tell the two apart without changing the types.
- reader 2 (yes): Two fn blend definitions both fit (int, int) equally, so the call cannot choose one. | fix: Keep one blend and delete the other, or make one take (num, num). | confusing: I do not know the meaning of the '#0' and '#1' in the message.
- reader 3 (yes): Two definitions of 'blend' accept the same argument types (int, int), so the compiler cannot choose between them. | fix: Delete the line 'fn blend(a: int, b: num): int = 1' so only one overload is left. | confusing: 

## E214 `mkp.type` error at `packages/core/src/check/expr.ts:567`

message: this function takes 1 argument(s)

block:
```
# Notes

```mkp
fn twice(a: int): int = a * 2
gauge "A reading."
  in n int = 2
  in label text = "a"
  in on bool = true
  in xs list(int) = [1, 2, 3]
  in d dict(int) = {}
  in c choice(low|high) = low
  g = twice
  r = g(1, 2)
  text "\val{n}"
  project md = "Reading: " + format(n, 0)
```

```gauge
summary: A small widget.
```

```

builder: Needed a derived value holding a fn then calling with the wrong count. Message does not name the function, only the count.

- reader 1 (yes): `g` is `twice`, which takes one argument, but the call gives two. | fix:   r = g(1) | confusing: 
- reader 2 (yes): g is twice, which takes one argument. | fix: r = g(1) | confusing: 
- reader 3 (yes): 'g' is twice, which takes one argument, and the call passes two. | fix: r = g(1) | confusing: 

## E215 `mkp.type` error at `packages/core/src/check/expr.ts:572`

message: this expression takes 1 variable(s)

block:
```
# Notes

```mkp

gauge "A reading."
  in n int = 2
  in label text = "a"
  in on bool = true
  in xs list(int) = [1, 2, 3]
  in d dict(int) = {}
  in c choice(low|high) = low
  in f expr(x)
  r = f(1, 2)
  text "\val{n}"
  project md = "Reading: " + format(n, 0)
```

```gauge
f: x + 1
summary: A small widget.
```

```

builder: Easy with an expr(x) input. Needed a value for it in the block. The text calls it "variable(s)".

- reader 1 (partly): `f` is an expression with one variable, `x`, but it is called with two arguments. | fix:   r = f(1) | confusing: The message says 'takes 1 variable(s)' but doesn't say which variable the expression uses.
- reader 2 (yes): The expression f takes one variable, x. The call passes two arguments. | fix: r = f(1) | confusing: 
- reader 3 (yes): The expression f takes one variable, but it is called with two arguments. | fix: r = f(1) | confusing: 

## E216 `mkp.type` error at `packages/core/src/check/expr.ts:577`

message: int is not a function

block:
```
# Notes

```mkp
fn twice(a: int): int = a * 2
gauge "A reading."
  in n int = 2
  in label text = "a"
  in on bool = true
  in xs list(int) = [1, 2, 3]
  in d dict(int) = {}
  in c choice(low|high) = low

  r = twice(1)(2)
  text "\val{n}"
  project md = "Reading: " + format(n, 0)
```

```gauge
summary: A small widget.
```

```

builder: Chaining twice(1)(2). Message correct, but the call-in-the-middle form is unnatural.

- reader 1 (yes): `twice(1)` returns an int, and an int can't be called with `(2)`. | fix:   r = twice(1) * 2 | confusing: 
- reader 2 (yes): twice(1) gives an int, and an int cannot be called again with (2). | fix: r = twice(1) | confusing: 
- reader 3 (yes): 'twice(1)' gives an int, and you cannot call an int as a function with '(2)' afterward. | fix: r = twice(1) | confusing: 

## E217 `mkp.type` error at `packages/core/src/check/expr.ts:586`

message: "n" is a int, not a function

block:
```
# Notes

```mkp

gauge "A reading."
  in n int = 2
  in label text = "a"
  in on bool = true
  in xs list(int) = [1, 2, 3]
  in d dict(int) = {}
  in c choice(low|high) = low

  r = n(1)
  text "\val{n}"
  project md = "Reading: " + format(n, 0)
```

```gauge
summary: A small widget.
```

```

builder: Easy: n(1). Grammar slip "is a int" in the message.

- reader 1 (yes): `n` is an int, so `n(1)` tries to call a number as a function. | fix:   r = n * 2 | confusing: 
- reader 2 (yes): n is an int, so it cannot be called like a function. | fix: r = n | confusing: 
- reader 3 (yes): 'n' is an int, and only a function can be called with arguments. | fix: r = twice(n) | confusing: The fix assumes 'twice' is the function meant. Nothing in the block defines it, so the fix may not match the intent.

## E218 `mkp.no-overload` error at `packages/core/src/check/expr.ts:614`

message: no twice(…) takes (text); candidates: twice(int)

block:
```
# Notes

```mkp
fn twice(a: int): int = a * 2
gauge "A reading."
  in n int = 2
  in label text = "a"
  in on bool = true
  in xs list(int) = [1, 2, 3]
  in d dict(int) = {}
  in c choice(low|high) = low

  r = twice(label)
  text "\val{n}"
  project md = "Reading: " + format(n, 0)
```

```gauge
summary: A small widget.
```

```

builder: Easy: calling a typed fn with the wrong type. Message is very helpful, listing candidates.

- reader 1 (yes): `twice` takes an int, and `label` is text. No overload accepts text. | fix:   r = twice(n) | confusing: 
- reader 2 (yes): twice takes an int, but label is text. | fix: r = twice(n) | confusing: "no twice(…) takes (text)" reads oddly.
- reader 3 (yes): twice takes an int, and label is text. | fix: r = twice(n) | confusing: 

## E219 `mkp.ambiguous` error at `packages/core/src/check/expr.ts:621`

message: pad is defined more than once with 2 parameter(s); give the parameters types so calls can be dispatched

block:
```
# Notes

```mkp
fn pad(a, b) = a + b
fn pad(c, d) = c * d
gauge "A reading."
  in n int = 2
  in label text = "a"
  in on bool = true
  in xs list(int) = [1, 2, 3]
  in d dict(int) = {}
  in c choice(low|high) = low

  r = pad(1, 2)
  text "\val{n}"
  project md = "Reading: " + format(n, 0)
```

```gauge
summary: A small widget.
```

```

builder: Reachable only with untyped fns, which are themselves refused with mkp.untyped; so the author gets two errors, one of which tells them to type the fns.

- reader 1 (yes): `pad` is defined twice with two untyped parameters, so the call can't choose which one to use. | fix: fn pad(a: int, b: int): int = a + b  (give parameters types so the two definitions differ) | confusing: 
- reader 2 (partly): Two fn pad definitions have the same parameter count and no types, so a call cannot choose between them. | fix: Give the parameters types, for example fn pad(a: int, b: int): int = a + b, and delete the second definition. | confusing: I cannot tell what the second pad is for, so deleting it may remove needed behaviour.
- reader 3 (yes): Two 'pad' definitions have untyped parameters, so the compiler cannot tell them apart when called. | fix: fn pad(a: int, b: int): int = a + b
fn pad(c: num, d: num): num = c * d | confusing: 

## E220 `mkp.type` error at `packages/core/src/check/expr.ts:622`

message: pad takes 2 argument(s), not 1

block:
```
# Notes

```mkp
fn pad(a, b) = a + b
gauge "A reading."
  in n int = 2
  in label text = "a"
  in on bool = true
  in xs list(int) = [1, 2, 3]
  in d dict(int) = {}
  in c choice(low|high) = low

  r = pad(1)
  text "\val{n}"
  project md = "Reading: " + format(n, 0)
```

```gauge
summary: A small widget.
```

```

builder: Reachable only with an untyped fn (which also raises mkp.untyped). Message is clear.

- reader 1 (yes): `pad` takes two arguments, and the call gives one. | fix:   r = pad(1, 2) | confusing: 
- reader 2 (yes): pad needs two arguments, and the call gives one. | fix: r = pad(1, 2) | confusing: 
- reader 3 (yes): pad takes two arguments, and the call passes only one. | fix: r = pad(1, 2) | confusing: 

## E221 `mkp.unknown-function` error at `packages/core/src/check/expr.ts:623`

message: there is no function "flor" (did you mean "floor"?)

block:
```
# Notes

```mkp

gauge "A reading."
  in n int = 2
  in label text = "a"
  in on bool = true
  in xs list(int) = [1, 2, 3]
  in d dict(int) = {}
  in c choice(low|high) = low

  r = flor(2.5)
  text "\val{n}"
  project md = "Reading: " + format(n, 0)
```

```gauge
summary: A small widget.
```

```

builder: Trivial; the did-you-mean is good.

- reader 1 (yes): `flor` is a typo for `floor`. | fix:   r = floor(2.5) | confusing: 
- reader 2 (yes): flor is a misspelling of floor. | fix: r = floor(2.5) | confusing: 
- reader 3 (yes): 'flor' is a typo of 'floor', which is an existing function. | fix: r = floor(2.5) | confusing: 

## E222 `mkp.type` error at `packages/core/src/check/expr.ts:651`

message: \val{sw} is swatch, which has no written form; show one of its fields, or give its type a show fn

block:
```
# Notes

```mkp
type swatch = {name: text}
const sw: swatch = {name: "sky"}
gauge "A reading."
  in n int = 2
  in label text = "a"
  in on bool = true
  in xs list(int) = [1, 2, 3]
  in d dict(int) = {}
  in c choice(low|high) = low
  s = sw
  text "\\val{sw}"
  r = n
  text "\val{n}"
  project md = "Reading: " + format(n, 0)
```

```gauge
summary: A small widget.
```

```

builder: Easy: showing a record in a text. The message tells how to fix it.

- reader 1 (yes): `sw` is a swatch record, and a record can't be written directly. Show one of its fields instead. | fix:   text "\val{sw.name}" | confusing: The message says 'give its type a show fn', but I don't know that syntax.
- reader 2 (yes): A swatch cannot be written as text. Show one of its fields, such as name. | fix: text "\\val{sw.name}" | confusing: 
- reader 3 (partly): 'sw' is a record with no written form, so '\val{sw}' cannot be shown. A field must be shown instead. | fix: text "\\val{sw.name}" | confusing: The block writes '\\val' with two backslashes, and the message names '\val' with one, so I am not sure whether the double backslash is also a problem.

## E223 `mkp.limit` error at `packages/core/src/check/expr.ts:121`

message: the expression is nested too deeply

block:
```
# Notes

```mkp

gauge "A reading."
  in n int = 2
  in label text = "a"
  in on bool = true
  in xs list(int) = [1, 2, 3]
  in d dict(int) = {}
  in c choice(low|high) = low

  r = ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------n
  text "\val{n}"
  project md = "Reading: " + format(n, 0)
```

```gauge
summary: A small widget.
```

```

builder: Only reachable with an absurd expression (hand-written code never nests 200 deep); I used a run of 201 minus signs. The message is clear but does not give the limit. The position (col 207) points near the end of the run.

- reader 1 (yes): The expression has a long chain of unary minus signs before `n`. Nesting is too deep. | fix:   r = n | confusing: The message says 'nested', but the line is a run of dashes, so I had to guess that is the problem.
- reader 2 (yes): The expression is too deep. The dashes are not a valid operator. | fix: r = n | confusing: 
- reader 3 (yes): The expression has a very long run of dashes, which nests too deeply. | fix: r = n | confusing: The dashes look like a typo, so I simplified it to n. Any intended negation is lost.

## E224 `mkp.ambiguous` error at `packages/core/src/check/expr.ts:316`

message: "top" is a constant in several packs (scales, levels); qualify it

block:
```
# Notes

```mkp

gauge "A reading."
  in n int = 2
  in label text = "a"
  in on bool = true
  in xs list(int) = [1, 2, 3]
  in d dict(int) = {}
  in c choice(low|high) = low

  r = top + 1
  text "\val{n}"
  project md = "Reading: " + format(n, 0)
```

```gauge
summary: A small widget.
```
--- manifest.mkp ---
pack scales@1 "Grade scales."
  requires core@1
  provides top
  unpublished
--- marks.mkp ---
const top: int = 10
--- manifest.mkp ---
pack levels@1 "Skill levels."
  requires core@1
  provides top
  unpublished
--- ranks.mkp ---
const top: int = 5

```

builder: Needed two packs both providing a const of one name plus a document using it; the document sees both without any depends line. Message lists the packs and says "qualify it" but not how (pack:name). Hard to meet by accident.

- reader 1 (yes): `top` is defined as a constant in two packs, so the bare name is ambiguous. It must be qualified. | fix:   r = scales:top + 1  (or levels:top, depending on which pack is meant) | confusing: The qualified form pack:name was only given in another message, so I'm applying it by analogy.
- reader 2 (partly): top is defined in both scales and levels, so the name must be qualified with the pack that owns it, and the document must require that pack. | fix: r = scales.top + 1 | confusing: The qualified-name syntax (scales.top) is a guess. The document also does not require either pack.
- reader 3 (yes): top is a constant in two packs, scales and levels, so it must be qualified. | fix: r = scales:top + 1 | confusing: The message does not say which pack should be used. I chose scales, but levels would also be valid.

## E225 `mkp.arity` error at `packages/core/src/check/expr.ts:702`

message: len takes 1 argument(s), not 2

block:
```
# Notes

```mkp

gauge "A reading."
  in n int = 2
  in label text = "a"
  in on bool = true
  in xs list(int) = [1, 2, 3]
  in d dict(int) = {}
  in c choice(low|high) = low

  r = len(xs, xs)
  text "\val{n}"
  project md = "Reading: " + format(n, 0)
```

```gauge
summary: A small widget.
```

```

builder: Easy. One of the few messages with its own code. "argument(s)" hedge again.

- reader 1 (yes): `len` takes one argument, and the call gives two. | fix:   r = len(xs) | confusing: 
- reader 2 (yes): len takes one list, and the block passes two. | fix: r = len(xs) | confusing: 
- reader 3 (yes): 'len' takes one argument, and this call passes two. | fix: r = len(xs) | confusing: 

## E226 `mkp.type` error at `packages/core/src/check/expr.ts:710`

message: sort needs a list; found int

block:
```
# Notes

```mkp

gauge "A reading."
  in n int = 2
  in label text = "a"
  in on bool = true
  in xs list(int) = [1, 2, 3]
  in d dict(int) = {}
  in c choice(low|high) = low

  r = sort(n)
  text "\val{n}"
  project md = "Reading: " + format(n, 0)
```

```gauge
summary: A small widget.
```

```

builder: Easy: sort(n). Clear, but the position is the call, not the argument.

- reader 1 (yes): `sort` needs a list, and `n` is an int. | fix:   r = sort(xs) | confusing: 
- reader 2 (yes): sort takes a list, and n is an int. | fix: r = sort(xs) | confusing: 
- reader 3 (yes): sort needs a list, and 'n' is an int. | fix: r = sort(xs) | confusing: 

## E227 `mkp.type` error at `packages/core/src/check/expr.ts:730`

message: len needs a list, text or dict; found int

block:
```
# Notes

```mkp

gauge "A reading."
  in n int = 2
  in label text = "a"
  in on bool = true
  in xs list(int) = [1, 2, 3]
  in d dict(int) = {}
  in c choice(low|high) = low

  r = len(n)
  text "\val{n}"
  project md = "Reading: " + format(n, 0)
```

```gauge
summary: A small widget.
```

```

builder: Easy. Clear.

- reader 1 (yes): `len` takes a list, text or dict, and `n` is an int. | fix:   r = len(xs) | confusing: 
- reader 2 (yes): len needs a list, text or dict. n is an int. | fix: r = len(xs) | confusing: 
- reader 3 (yes): len needs a list, text or dict, and 'n' is an int. | fix: r = len(xs) | confusing: 

## E228 `mkp.type` error at `packages/core/src/check/expr.ts:747`

message: filter needs a function that returns a boolean

block:
```
# Notes

```mkp
fn twice(a: int): int = a * 2
gauge "A reading."
  in n int = 2
  in label text = "a"
  in on bool = true
  in xs list(int) = [1, 2, 3]
  in d dict(int) = {}
  in c choice(low|high) = low

  r = filter(xs, twice)
  text "\val{n}"
  project md = "Reading: " + format(n, 0)
```

```gauge
summary: A small widget.
```

```

builder: Surprisingly hard: writing a lambda with a wrong result gives "expected bool, found int" from elsewhere (lambda coercion). This site fires only when a named fn is passed. So the same mistake gives two different messages depending on lambda or named fn.

- reader 1 (yes): `filter` needs a function that returns a boolean, and `twice` returns an int. | fix:   r = filter(xs, a => a > 1) | confusing: 
- reader 2 (yes): filter needs a function that returns a boolean, and twice returns an int. | fix: fn positive(a: int): bool = a > 0
  r = filter(xs, positive) | confusing: 
- reader 3 (yes): 'filter' needs a function that returns a boolean, but 'twice' returns an int. | fix: fn is_big(a: int): bool = a > 1
r = filter(xs, is_big) | confusing: 

## E229 `mkp.type` error at `packages/core/src/check/expr.ts:780`

message: fold's function must return the accumulator's type int; it returns text

block:
```
# Notes

```mkp

gauge "A reading."
  in n int = 2
  in label text = "a"
  in on bool = true
  in xs list(int) = [1, 2, 3]
  in d dict(int) = {}
  in c choice(low|high) = low

  r = fold(xs, 0, (acc, v) => "a")
  text "\val{n}"
  project md = "Reading: " + format(n, 0)
```

```gauge
summary: A small widget.
```

```

builder: Easy and the message is explicit about the accumulator.

- reader 1 (yes): The fold function must return the accumulator's type, which is int. The lambda returns the text "a". | fix:   r = fold(xs, 0, (acc, v) => acc + v) | confusing: 
- reader 2 (yes): fold's function must return the accumulator's type, int. It returns text. | fix: r = fold(xs, 0, (acc, v) => acc + v) | confusing: 
- reader 3 (yes): The fold function must return an int, the same as the accumulator, but it returns text. | fix: r = fold(xs, 0, (acc, v) => acc + v) | confusing: 

## E230 `mkp.type` error at `packages/core/src/check/expr.ts:825`

message: flatten needs a list of lists

block:
```
# Notes

```mkp

gauge "A reading."
  in n int = 2
  in label text = "a"
  in on bool = true
  in xs list(int) = [1, 2, 3]
  in d dict(int) = {}
  in c choice(low|high) = low

  r = flatten(xs)
  text "\val{n}"
  project md = "Reading: " + format(n, 0)
```

```gauge
summary: A small widget.
```

```

builder: Easy. Terse, does not say what was found.

- reader 1 (yes): `flatten` takes a list whose items are themselves lists, but `xs` is a flat list of ints. | fix:   r = xs  (or use flatten on a list of lists) | confusing: 
- reader 2 (partly): flatten needs a list of lists. xs is list(int), so it is a list of numbers, not lists. | fix: in xs list(list(int)) = [[1], [2, 3]] | confusing: I am guessing the intended type of xs from the message.
- reader 3 (yes): flatten needs a list of lists, and xs is a flat list of int. | fix: r = xs | confusing: The fix removes the flatten call, since there is nothing to flatten. The author may have meant a different list.

## E231 `mkp.type` error at `packages/core/src/check/expr.ts:871`

message: mean needs a list of numbers

block:
```
# Notes

```mkp

gauge "A reading."
  in n int = 2
  in label text = "a"
  in on bool = true
  in xs list(int) = [1, 2, 3]
  in d dict(int) = {}
  in c choice(low|high) = low

  r = mean(["a", "b"])
  text "\val{n}"
  project md = "Reading: " + format(n, 0)
```

```gauge
summary: A small widget.
```

```

builder: Easy. Does not say what was found.

- reader 1 (yes): `mean` needs a list of numbers, and the list here holds text. | fix:   r = mean(xs) | confusing: 
- reader 2 (yes): mean takes a list of numbers, and the block gives a list of text. | fix: r = mean(xs) | confusing: 
- reader 3 (yes): 'mean' needs a list of numbers, but it was given a list of text. | fix: r = mean(xs) | confusing: 

## E232 `mkp.type` error at `packages/core/src/check/expr.ts:883`

message: if needs a boolean condition; found int

block:
```
# Notes

```mkp

gauge "A reading."
  in n int = 2
  in label text = "a"
  in on bool = true
  in xs list(int) = [1, 2, 3]
  in d dict(int) = {}
  in c choice(low|high) = low

  r = if(n, 1, 2)
  text "\val{n}"
  project md = "Reading: " + format(n, 0)
```

```gauge
summary: A small widget.
```

```

builder: Easy. Clear.

- reader 1 (yes): `if` needs a boolean condition, but `n` is an int. | fix:   r = if(n > 1, 1, 2) | confusing: 
- reader 2 (yes): if needs a boolean condition, and n is an int. | fix: r = if(on, 1, 2) | confusing: 
- reader 3 (yes): 'if' needs a boolean condition, and 'n' is an int. | fix: r = if(n > 1, 1, 2) | confusing: 

## E233 `mkp.type` error at `packages/core/src/check/expr.ts:908`

message: if's branches have different types: int and text

block:
```
# Notes

```mkp

gauge "A reading."
  in n int = 2
  in label text = "a"
  in on bool = true
  in xs list(int) = [1, 2, 3]
  in d dict(int) = {}
  in c choice(low|high) = low

  r = if(on, 1, "two")
  text "\val{n}"
  project md = "Reading: " + format(n, 0)
```

```gauge
summary: A small widget.
```

```

builder: Easy. Clear; shows both types.

- reader 1 (yes): Both branches of `if` must have the same type. One branch is int and the other is text. | fix:   r = if(on, 1, 2) | confusing: 
- reader 2 (yes): The two branches of if must have the same type. 1 is int and "two" is text. | fix: r = if(on, 1, 2) | confusing: 
- reader 3 (yes): The two branches of if return different types, int and text. | fix: r = if(on, 1, 2) | confusing: 

## E234 `mkp.type` error at `packages/core/src/check/expr.ts:916`

message: put needs a dict; found list(int)

block:
```
# Notes

```mkp

gauge "A reading."
  in n int = 2
  in label text = "a"
  in on bool = true
  in xs list(int) = [1, 2, 3]
  in d dict(int) = {}
  in c choice(low|high) = low

  r = put(xs, "a", 1)
  text "\val{n}"
  project md = "Reading: " + format(n, 0)
```

```gauge
summary: A small widget.
```

```

builder: Easy.

- reader 1 (yes): `put` takes a dict, and `xs` is a list of ints. | fix:   r = put(d, "a", 1) | confusing: 
- reader 2 (yes): put needs a dict, and xs is a list. | fix: r = put(d, "a", 1) | confusing: 
- reader 3 (yes): 'put' adds a key to a dict, but 'xs' is a list. | fix: r = put(d, "a", 1) | confusing: 

## E235 `mkp.type` error at `packages/core/src/check/expr.ts:921`

message: this dict holds int, not text

block:
```
# Notes

```mkp

gauge "A reading."
  in n int = 2
  in label text = "a"
  in on bool = true
  in xs list(int) = [1, 2, 3]
  in d dict(int) = {}
  in c choice(low|high) = low

  r = put(d, "a", "x")
  text "\val{n}"
  project md = "Reading: " + format(n, 0)
```

```gauge
summary: A small widget.
```

```

builder: Easy; the message is clear about expected type but it is the third argument, not named.

- reader 1 (yes): `d` is dict(int), so `put` must store an int. The block stores the text "x". | fix:   r = put(d, "a", 1) | confusing: 
- reader 2 (yes): d holds int values, and "x" is text. | fix: r = put(d, "a", 1) | confusing: 
- reader 3 (yes): The dict d holds int values, and 'x' is text. | fix: r = put(d, "a", 1) | confusing: 

## E236 `mkp.type` error at `packages/core/src/check/expr.ts:928`

message: get needs a dict; found list(int)

block:
```
# Notes

```mkp

gauge "A reading."
  in n int = 2
  in label text = "a"
  in on bool = true
  in xs list(int) = [1, 2, 3]
  in d dict(int) = {}
  in c choice(low|high) = low

  r = get(xs, "a", 0)
  text "\val{n}"
  project md = "Reading: " + format(n, 0)
```

```gauge
summary: A small widget.
```

```

builder: Easy.

- reader 1 (yes): `get` needs a dict, and `xs` is a list. | fix:   r = get(d, "a", 0) | confusing: 
- reader 2 (yes): get needs a dict. xs is a list. | fix: r = get(d, "a", 0) | confusing: 
- reader 3 (yes): get needs a dict, and xs is a list. | fix: r = get(d, "a", 0) | confusing: 

## E237 `mkp.type` error at `packages/core/src/check/expr.ts:931`

message: the default must be int

block:
```
# Notes

```mkp

gauge "A reading."
  in n int = 2
  in label text = "a"
  in on bool = true
  in xs list(int) = [1, 2, 3]
  in d dict(int) = {}
  in c choice(low|high) = low

  r = get(d, "a", "none")
  text "\val{n}"
  project md = "Reading: " + format(n, 0)
```

```gauge
summary: A small widget.
```

```

builder: Easy. The word "default" for the third argument is a bit surprising.

- reader 1 (yes): The default for `get` must be an int, and the call gives the text "none". | fix:   r = get(d, "a", 0) | confusing: 
- reader 2 (yes): get's default must be an int, and "none" is text. | fix: r = get(d, "a", 0) | confusing: 
- reader 3 (yes): The default for 'get' must match the dict's value type, which is int here, and the block gives text. | fix: r = get(d, "a", 0) | confusing: 

## E238 `mkp.type` error at `packages/core/src/check/expr.ts:937`

message: keys needs a dict

block:
```
# Notes

```mkp

gauge "A reading."
  in n int = 2
  in label text = "a"
  in on bool = true
  in xs list(int) = [1, 2, 3]
  in d dict(int) = {}
  in c choice(low|high) = low

  r = keys(xs)
  text "\val{n}"
  project md = "Reading: " + format(n, 0)
```

```gauge
summary: A small widget.
```

```

builder: Easy; no found-type given here, unlike put/get.

- reader 1 (yes): `keys` takes a dict, and `xs` is a list. | fix:   r = keys(d) | confusing: 
- reader 2 (yes): keys takes a dict, and xs is a list. | fix: r = keys(d) | confusing: 
- reader 3 (yes): keys needs a dict, and 'xs' is a list. | fix: r = keys(d) | confusing: 

## E239 `mkp.type` error at `packages/core/src/check/expr.ts:943`

message: has needs a dict

block:
```
# Notes

```mkp

gauge "A reading."
  in n int = 2
  in label text = "a"
  in on bool = true
  in xs list(int) = [1, 2, 3]
  in d dict(int) = {}
  in c choice(low|high) = low

  r = has(xs, "a")
  text "\val{n}"
  project md = "Reading: " + format(n, 0)
```

```gauge
summary: A small widget.
```

```

builder: Easy; inconsistent with put/get, which show what was found.

- reader 1 (yes): `has` checks a key in a dict, and `xs` is a list. | fix:   r = has(d, "a") | confusing: 
- reader 2 (yes): has needs a dict. xs is a list. | fix: r = has(d, "a") | confusing: 
- reader 3 (yes): has needs a dict, and xs is a list. | fix: r = has(d, "a") | confusing: 

## E240 `mkp.type` error at `packages/core/src/check/expr.ts:958`

message: join needs a list of text

block:
```
# Notes

```mkp

gauge "A reading."
  in n int = 2
  in label text = "a"
  in on bool = true
  in xs list(int) = [1, 2, 3]
  in d dict(int) = {}
  in c choice(low|high) = low

  r = join([[1], [2]], ",")
  text "\val{n}"
  project md = "Reading: " + format(n, 0)
```

```gauge
summary: A small widget.
```

```

builder: Easy with a list of lists; a list of numbers is accepted silently, so the message is narrower than the check.

- reader 1 (yes): `join` takes a list of text, and the list here holds lists of ints. | fix:   r = join(["1", "2"], ",") | confusing: 
- reader 2 (yes): join needs a list of text, and [[1], [2]] is a list of lists of int. | fix: r = join(["1", "2"], ",") | confusing: 
- reader 3 (yes): 'join' needs a list of text, but the list given contains lists of int. | fix: r = join(["a", "b"], ",") | confusing: 

## E241 `mkp.type` error at `packages/core/src/check/expr.ts:1042`

message: sum needs a list of numbers

block:
```
# Notes

```mkp

gauge "A reading."
  in n int = 2
  in label text = "a"
  in on bool = true
  in xs list(int) = [1, 2, 3]
  in d dict(int) = {}
  in c choice(low|high) = low

  r = sum(["a"])
  text "\val{n}"
  project md = "Reading: " + format(n, 0)
```

```gauge
summary: A small widget.
```

```

builder: Easy.

- reader 1 (yes): `sum` needs a list of numbers, and `["a"]` is a list of text. | fix:   r = sum(xs) | confusing: 
- reader 2 (yes): sum takes a list of numbers, and the block gives text. | fix: r = sum(xs) | confusing: 
- reader 3 (yes): sum needs a list of numbers, and the list here holds text. | fix: r = sum(xs) | confusing: 

## E242 `mkp.type` error at `packages/core/src/check/expr.ts:1054`

message: sum over text needs + and a from(num) for that type

block:
```
# Notes

```mkp

gauge "A reading."
  in n int = 2
  in label text = "a"
  in on bool = true
  in xs list(int) = [1, 2, 3]
  in d dict(int) = {}
  in c choice(low|high) = low

  r = sum(1, 3, k => label)
  text "\val{n}"
  project md = "Reading: " + format(n, 0)
```

```gauge
summary: A small widget.
```

```

builder: Needed to know that sum has a three-argument form (sum(lo, hi, fn)). The message mentions a from(num) that most authors have never met.

- reader 1 (partly): `sum` over text needs an addition and a conversion from num for that type. Here `sum` gets the arguments in the wrong form and returns text. | fix:   r = sum(xs)  (sums a list of ints) | confusing: The message's rule about 'from(num)' is not something I know how to supply.
- reader 2 (partly): sum over text needs + for text and a conversion from num. The block sums label, which is text. | fix: r = sum(1, 3, k => n) | confusing: I am not sure what sum(1, 3, …) means, so I guessed it sums over a range of numbers.
- reader 3 (partly): sum over text needs + and a from(num) for that type, and the call passes three values in a form the message does not describe. | fix: cannot infer | confusing: The message does not say what the arguments of sum should be, so I cannot write a correct call.

## E243 `mkp.type` error at `packages/core/src/check/expr.ts:1062`

message: min needs numbers

block:
```
# Notes

```mkp

gauge "A reading."
  in n int = 2
  in label text = "a"
  in on bool = true
  in xs list(int) = [1, 2, 3]
  in d dict(int) = {}
  in c choice(low|high) = low

  r = min(["a", "b"])
  text "\val{n}"
  project md = "Reading: " + format(n, 0)
```

```gauge
summary: A small widget.
```

```

builder: Easy; no found-type.

- reader 1 (yes): `min` needs numbers, and the list here holds text. | fix:   r = min(xs) | confusing: 
- reader 2 (yes): min needs numbers, and the block gives text. | fix: r = min(xs) | confusing: 
- reader 3 (yes): 'min' needs numbers, but it was given text. | fix: r = min(xs) | confusing: 

## E244 `mkp.type` error at `packages/core/src/check/expr.ts:1070`

message: max takes two numbers or a list; found text and int

block:
```
# Notes

```mkp

gauge "A reading."
  in n int = 2
  in label text = "a"
  in on bool = true
  in xs list(int) = [1, 2, 3]
  in d dict(int) = {}
  in c choice(low|high) = low

  r = max(label, n)
  text "\val{n}"
  project md = "Reading: " + format(n, 0)
```

```gauge
summary: A small widget.
```

```

builder: Easy; good message.

- reader 1 (yes): `max` takes two numbers or one list. The block gives text and an int. | fix:   r = max(n, 3) | confusing: 
- reader 2 (yes): max takes two numbers or a list. label is text. | fix: r = max(n, 3) | confusing: 
- reader 3 (yes): max takes two numbers or a list, but the call gives text and an int. | fix: r = max(xs) | confusing: 

## E245 `mkp.type` error at `packages/core/src/check/expr.ts:1081`

message: iterate's step must return the state's type int; it returns text

block:
```
# Notes

```mkp

gauge "A reading."
  in n int = 2
  in label text = "a"
  in on bool = true
  in xs list(int) = [1, 2, 3]
  in d dict(int) = {}
  in c choice(low|high) = low

  r = iterate(0, 3, v => "x")
  text "\val{n}"
  project md = "Reading: " + format(n, 0)
```

```gauge
summary: A small widget.
```

```

builder: Easy; clear.

- reader 1 (yes): The step function of `iterate` must return the state's type, int, but it returns text. | fix:   r = iterate(0, 3, v => v + 1) | confusing: 
- reader 2 (yes): iterate's step must return an int, the state's type. The block returns the text "x". | fix: r = iterate(0, 3, v => v + 1) | confusing: 
- reader 3 (yes): iterate's step function must return an int, the same as the state, but it returns text. | fix: r = iterate(0, 3, v => v + 1) | confusing: 

# Not triggered from a document or pack (still improve the wording)

- `packages/core/src/types.ts:240` `mkp.type-syntax`: unexpected text after the type: "<rest>" (parseTypeString is exported but never called from the compiler; the document path reports a different mkp.syntax 'unexpected "6" after the type' instead.)
- `packages/core/src/tokens.ts:66` `mkp.token-missing`: the required <kind> token "<name>" is not defined by any token set (The core token set (base.ts) always defines every required token, and a pack's token set only adds to it, so no document or pack can remove one.)
- `packages/core/src/check/expr.ts:530` `mkp.recursive-untyped`: <fn> calls itself; give it a return type (fn <fn>(…): type = …) (Only reached when specialising an untyped (generic) fn that calls itself. Every untyped fn is refused first with mkp.untyped (program.ts / def.ts abort the widget check for local fns), and for top-level untyped fns the recursive call uses a fresh checker whose in-progress table is empty, so the guard never fires and no diagnostic besides mkp.untyped appears.)
