# def: 133 messages

## E001 `mkp.check` error at `packages/core/src/check/def.ts:255`

message: "gfx" is not a capability (name@N)

block:
```
# Notes

```mkp
note "A short note."
  requires gfx
  in msg text = "hi"
  text msg
  project md = msg
```

```note
summary: A note.
```
```

builder: Easy. Writing 'requires gfx' without @1 is a natural slip. My first attempt also tripped on a name collision I did not expect: an input called body (then line) is a token name, so 'text body' gave mkp.ambiguous-arg and mkp.shadow. The message does not say what a capability looks like beyond (name@N).

- reader 1 (yes): A capability in `requires` needs a version, written name@N. `gfx` alone is not a valid capability name. | fix:   requires gfx@1 | confusing: 
- reader 2 (yes): A capability needs its version, written name@N. 'gfx' has none, so it is not recognised. | fix: requires gfx@1 | confusing: 
- reader 3 (yes): 'requires' names a capability with a version, and 'gfx' has no @N version. The name needs a version, like gfx@1. | fix:   requires gfx@1 | confusing: 

## E002 `mkp.reserved` error at `packages/core/src/check/def.ts:271`

message: the "error" signal is reserved; every widget sends it from its error boundary (15.1)

block:
```
# Alerts

```mkp
alert "A message that tells the host something went wrong."
  in msg text = "oops"
  signal error {msg: text}
  text msg
  project md = msg
```

```alert
summary: An alert.
```
```

builder: Easy: declaring 'signal error' is a plausible thing to write. The message cites '(15.1)', a spec section number a reader cannot look up.

- reader 1 (yes): The signal name `error` is reserved. Every widget already sends it from its error boundary, so this definition can't declare its own. | fix:   signal failed {msg: text}  (rename the signal; the error boundary already uses `error`) | confusing: The '(15.1)' reference in the message points to a spec section I don't have.
- reader 2 (partly): "error" is a signal name the platform reserves for widgets' error boundaries, so a widget may not declare its own signal with that name. The block declares 'signal error {msg: text}'. | fix: signal problem {msg: text} | confusing: "error boundary (15.1)" refers to a section I cannot see. "Every widget sends it" makes me unsure whether a widget may send it or may not declare it.
- reader 3 (yes): The name 'error' is reserved for the error signal that every widget sends from its error boundary. The alert declares its own signal called error, which clashes with it. | fix: signal alertmsg {msg: text} | confusing: 

## E003 `mkp.extern-view` error at `packages/core/src/check/def.ts:281`

message: an extern has no view, state or values; providers implement it in code

block:
```
--- manifest.mkp ---
pack gauges@1
requires core@1
--- probe.mkp ---
extern probe@1 "A reading from the device."
  in label text = ""
  text label
```

builder: Needed a pack: a document cannot declare an extern at all (mkp.syntax). An extern with a view line is a natural mistake. The message says 'view, state or values' and the position points at the offending line, which is good.

- reader 1 (partly): An `extern` declares a widget whose drawing is done by a host in code. It has no view, state or values of its own, so the body lines `in`/`text` are not allowed. | fix: Remove the `in label text = ""` and `text label` lines, leaving only the `extern probe@1 "A reading from the device."` line, or make `probe` an ordinary `probe@1` widget if it needs a body. | confusing: I don't know what 'providers implement it in code' means for how the extern is used, so I'm not sure whether the body should stay empty or be removed entirely.
- reader 2 (yes): An extern is a widget whose drawing a provider writes in code, so it cannot have a view. The block has 'text label' under it. | fix: Delete the 'text label' line, leaving only the 'extern probe@1' header and the 'in label text = ""' line. | confusing: 
- reader 3 (yes): An extern only declares what a provider will draw in code, so it cannot contain a view (text label). The line 'in label text = ""' is a parameter with a default, which is allowed in an extern, but the 'text label' line is not. | fix: Delete the line 'text label' so the extern keeps only 'extern probe@1 "A reading from the device."' and 'in label text'. | confusing: 

## E004 `mkp.unknown-field` error at `packages/core/src/check/def.ts:292`

message: fields names "subtitle", which is not an input

block:
```
# Card

```mkp
card "A titled card."
  fields title subtitle
  in title text = "Hello"
  text title
  project md = title
```

```card
summary: A card.
```
```

builder: Easy. 'fields' takes space separated names; my first try used a comma, which gave a different syntax error ('"title," is not a valid input name'). The position points at the widget header, not the fields line, which is a little off. No did-you-mean since nothing was close.

- reader 1 (yes): The `fields` line lists `subtitle`, but no input named `subtitle` is declared. Only `title` is an input. | fix: Either remove `subtitle` from the line (`  fields title`), or declare it, e.g. add `  in subtitle text = ""`. | confusing: I don't know what `fields` does, so I can't tell which of the two fixes the author wants.
- reader 2 (yes): fields lists 'subtitle', but the widget has no input of that name. | fix: fields title | confusing: I do not know what 'fields' does, so removing subtitle from it is a guess.
- reader 3 (yes): 'fields' lists 'subtitle', but the widget has no input named subtitle. Only 'title' is an input. | fix:   fields title | confusing: 

## E005 `mkp.limit` error at `packages/core/src/check/def.ts:258`

message: a budget may be at most 20,000,000 operations

block:
```
# Tally

```mkp
tally "A running count."
  budget 50000000
  var n int = 0
  text "\val{n}"
  project md = "Count: " + format(n, 0)
```

```tally
summary: A count.
```
```

builder: Easy once I looked at LIMITS: any budget above 20,000,000 fires it. The message gives the cap, so it is clear. Guide says 'budget 20000000 at most' only in passing.

- reader 1 (yes): The `budget` is the maximum number of operations. 50,000,000 is over the 20,000,000 limit. | fix:   budget 20000000 | confusing: 
- reader 2 (yes): budget sets the operation limit for a document, and the maximum is 20,000,000. The block sets 50000000, which is over it. | fix: budget 20000000 | confusing: "operations" is not explained.
- reader 3 (yes): The budget of 50,000,000 operations is above the maximum of 20,000,000. | fix: budget 20000000 | confusing: 

## E006 `mkp.untyped` error at `packages/core/src/check/def.ts:327`

message: fn twice must type its parameter x

block:
```
# Doubling

```mkp
doubler "Shows a number and its double."
  in n num = 2 "the number"
  fn twice(x): num = x * 2
  text "\val{twice(n)}"
  project md = format(twice(n), 0)
```

```doubler
summary: A number and its double.
```
```

builder: Easy to trigger, the message is clear and gives the fix pattern. Surprise: the broken fn is not registered, so every call to it adds an 'unknown-function: there is no function twice' error, and the widget also gets a misleading 'has no project md' even though one is written, which would send an author to the wrong place. Branch: only a parameter is untyped.

- reader 1 (yes): The parameter `x` has no type. Every `fn` parameter needs a type after the name. | fix:   fn twice(x: num): num = x * 2 | confusing: 
- reader 2 (yes): fn parameters need types. 'fn twice(x)' has none. | fix: fn twice(x: num): num = x * 2 | confusing: 
- reader 3 (yes): The fn 'twice' has an untyped parameter 'x', and every parameter needs a type. The body is fine. | fix: fn twice(x: num): num = x * 2 | confusing: 

## E007 `mkp.untyped` error at `packages/core/src/check/def.ts:327`

message: fn twice must type its result (fn name(x: num): num = …)

block:
```
# Doubling

```mkp
doubler "Shows a number and its double."
  in n num = 2 "the number"
  fn twice(x: num) = x * 2
  text "\val{twice(n)}"
  project md = format(twice(n), 0)
```

```doubler
summary: A number and its double.
```
```

builder: Easy to trigger, the message is clear and gives the fix pattern. Surprise: the broken fn is not registered, so every call to it adds an 'unknown-function: there is no function twice' error, and the widget also gets a misleading 'has no project md' even though one is written, which would send an author to the wrong place. Branch: only the result type is missing.

- reader 1 (yes): A `fn` must give its parameter types and its result type. The block has `x: num` but no `: num` result before `=`. | fix:   fn twice(x: num): num = x * 2 | confusing: 
- reader 2 (yes): fn parameters are typed, and so is the result. 'fn twice(x: num)' has no result type. | fix: fn twice(x: num): num = x * 2 | confusing: 
- reader 3 (yes): The fn 'twice' has no declared result type. Its result must be typed as ': num' after the parameters. | fix: fn twice(x: num): num = x * 2 | confusing: 

## E008 `mkp.untyped` error at `packages/core/src/check/def.ts:327`

message: fn twice must type its parameters x, y and its result (fn name(x: num): num = …)

block:
```
# Doubling

```mkp
doubler "Shows a number and its double."
  in n num = 2 "the number"
  fn twice(x, y) = x * 2
  text "\val{twice(n, n)}"
  project md = format(twice(n, n), 0)
```

```doubler
summary: A number and its double.
```
```

builder: Easy to trigger, the message is clear and gives the fix pattern. Surprise: the broken fn is not registered, so every call to it adds an 'unknown-function: there is no function twice' error, and the widget also gets a misleading 'has no project md' even though one is written, which would send an author to the wrong place. Branch: parameters and result both missing; the plural message reads slightly oddly ('parameters x, y and its result').

- reader 1 (yes): `fn twice` takes two parameters, `x` and `y`, but neither is typed, and the result has no type. | fix:   fn twice(x: num, y: num): num = x * 2 | confusing: The message says 'type its parameters x, y and its result' but the function body uses only x, so I'm not sure y is meant to exist.
- reader 2 (partly): A fn definition needs a type on each parameter and on its result. 'fn twice(x, y) = x * 2' has no types. Also y is never used in the body. | fix: fn twice(x: num, y: num): num = x * 2 | confusing: Why twice takes two parameters when it doubles one number, and why only x is used.
- reader 3 (yes): The fn 'twice' has untyped parameters x and y and no typed result. Each one needs a type. | fix: fn twice(x: num, y: num): num = x * 2 | confusing: 

## E009 `mkp.limit` error at `packages/core/src/check/def.ts:372`

message: 324 elements; a definition may have at most 300

block:
```
# Times table

```mkp
times "A times table, written out."
  column gap=xs
    row gap=s
      text "1" font=mono
      text "2" font=mono
      text "3" font=mono
      text "4" font=mono
      text "5" font=mono
      text "6" font=mono
      text "7" font=mono
      text "8" font=mono
      text "9" font=mono
      text "10" font=mono
      text "11" font=mono
      text "12" font=mono
      text "13" font=mono
      text "14" font=mono
      text "15" font=mono
      text "16" font=mono
    row gap=s
      text "2" font=mono
      text "4" font=mono
      text "6" font=mono
      text "8" font=mono
      text "10" font=mono
      text "12" font=mono
      text "14" font=mono
      text "16" font=mono
      text "18" font=mono
      text "20" font=mono
      text "22" font=mono
      text "24" font=mono
      text "26" font=mono
      text "28" font=mono
      text "30" font=mono
      text "32" font=mono
    row gap=s
      text "3" font=mono
      text "6" font=mono
      text "9" font=mono
      text "12" font=mono
      text "15" font=mono
      text "18" font=mono
      text "21" font=mono
      text "24" font=mono
      text "27" font=mono
      text "30" font=mono
      text "33" font=mono
      text "36" font=mono
      text "39" font=mono
      text "42" font=mono
      text "45" font=mono
      text "48" font=mono
    row gap=s
      text "4" font=mono
      text "8" font=mono
      text "12" font=mono
      text "16" font=mono
      text "20" font=mono
      text "24" font=mono
      text "28" font=mono
      text "32" font=mono
      text "36" font=mono
      text "40" font=mono
      text "44" font=mono
      text "48" font=mono
      text "52" font=mono
      text "56" font=mono
      text "60" font=mono
      text "64" font=mono
    row gap=s
      text "5" font=mono
      text "10" font=mono
      text "15" font=mono
      text "20" font=mono
      text "25" font=mono
      text "30" font=mono
      text "35" font=mono
      text "40" font=mono
      text "45" font=mono
      text "50" font=mono
      text "55" font=mono
      text "60" font=mono
      text "65" font=mono
      text "70" font=mono
      text "75" font=mono
      text "80" font=mono
    row gap=s
      text "6" font=mono
      text "12" font=mono
      text "18" font=mono
      text "24" font=mono
      text "30" font=mono
      text "36" font=mono
      text "42" font=mono
      text "48" font=mono
      text "54" font=mono
      text "60" font=mono
      text "66" font=mono
      text "72" font=mono
      text "78" font=mono
      text "84" font=mono
      text "90" font=mono
      text "96" font=mono
    row gap=s
      text "7" font=mono
      text "14" font=mono
      text "21" font=mono
      text "28" font=mono
      text "35" font=mono
      text "42" font=mono
      text "49" font=mono
      text "56" font=mono
      text "63" font=mono
      text "70" font=mono
      text "77" font=mono
      text "84" font=mono
      text "91" font=mono
      text "98" font=mono
      text "105" font=mono
      text "112" font=mono
    row gap=s
      text "8" font=mono
      text "16" font=mono
      text "24" font=mono
      text "32" font=mono
      text "40" font=mono
      text "48" font=mono
      text "56" font=mono
      text "64" font=mono
      text "72" font=mono
      text "80" font=mono
      text "88" font=mono
      text "96" font=mono
      text "104" font=mono
      text "112" font=mono
      text "120" font=mono
      text "128" font=mono
    row gap=s
      text "9" font=mono
      text "18" font=mono
      text "27" font=mono
      text "36" font=mono
      text "45" font=mono
      text "54" font=mono
      text "63" font=mono
      text "72" font=mono
      text "81" font=mono
      text "90" font=mono
      text "99" font=mono
      text "108" font=mono
      text "117" font=mono
      text "126" font=mono
      text "135" font=mono
      text "144" font=mono
    row gap=s
      text "10" font=mono
      text "20" font=mono
      text "30" font=mono
      text "40" font=mono
      text "50" font=mono
      text "60" font=mono
      text "70" font=mono
      text "80" font=mono
      text "90" font=mono
      text "100" font=mono
      text "110" font=mono
      text "120" font=mono
      text "130" font=mono
      text "140" font=mono
      text "150" font=mono
      text "160" font=mono
    row gap=s
      text "11" font=mono
      text "22" font=mono
      text "33" font=mono
      text "44" font=mono
      text "55" font=mono
      text "66" font=mono
      text "77" font=mono
      text "88" font=mono
      text "99" font=mono
      text "110" font=mono
      text "121" font=mono
      text "132" font=mono
      text "143" font=mono
      text "154" font=mono
      text "165" font=mono
      text "176" font=mono
    row gap=s
      text "12" font=mono
      text "24" font=mono
      text "36" font=mono
      text "48" font=mono
      text "60" font=mono
      text "72" font=mono
      text "84" font=mono
      text "96" font=mono
      text "108" font=mono
      text "120" font=mono
      text "132" font=mono
      text "144" font=mono
      text "156" font=mono
      text "168" font=mono
      text "180" font=mono
      text "192" font=mono
    row gap=s
      text "13" font=mono
      text "26" font=mono
      text "39" font=mono
      text "52" font=mono
      text "65" font=mono
      text "78" font=mono
      text "91" font=mono
      text "104" font=mono
      text "117" font=mono
      text "130" font=mono
      text "143" font=mono
      text "156" font=mono
      text "169" font=mono
      text "182" font=mono
      text "195" font=mono
      text "208" font=mono
    row gap=s
      text "14" font=mono
      text "28" font=mono
      text "42" font=mono
      text "56" font=mono
      text "70" font=mono
      text "84" font=mono
      text "98" font=mono
      text "112" font=mono
      text "126" font=mono
      text "140" font=mono
      text "154" font=mono
      text "168" font=mono
      text "182" font=mono
      text "196" font=mono
      text "210" font=mono
      text "224" font=mono
    row gap=s
      text "15" font=mono
      text "30" font=mono
      text "45" font=mono
      text "60" font=mono
      text "75" font=mono
      text "90" font=mono
      text "105" font=mono
      text "120" font=mono
      text "135" font=mono
      text "150" font=mono
      text "165" font=mono
      text "180" font=mono
      text "195" font=mono
      text "210" font=mono
      text "225" font=mono
      text "240" font=mono
    row gap=s
      text "16" font=mono
      text "32" font=mono
      text "48" font=mono
      text "64" font=mono
      text "80" font=mono
      text "96" font=mono
      text "112" font=mono
      text "128" font=mono
      text "144" font=mono
      text "160" font=mono
      text "176" font=mono
      text "192" font=mono
      text "208" font=mono
      text "224" font=mono
      text "240" font=mono
      text "256" font=mono
    row gap=s
      text "17" font=mono
      text "34" font=mono
      text "51" font=mono
      text "68" font=mono
      text "85" font=mono
      text "102" font=mono
      text "119" font=mono
      text "136" font=mono
      text "153" font=mono
      text "170" font=mono
      text "187" font=mono
      text "204" font=mono
      text "221" font=mono
      text "238" font=mono
      text "255" font=mono
      text "272" font=mono
    row gap=s
      text "18" font=mono
      text "36" font=mono
      text "54" font=mono
      text "72" font=mono
      text "90" font=mono
      text "108" font=mono
      text "126" font=mono
      text "144" font=mono
      text "162" font=mono
      text "180" font=mono
      text "198" font=mono
      text "216" font=mono
      text "234" font=mono
      text "252" font=mono
      text "270" font=mono
      text "288" font=mono
    row gap=s
      text "19" font=mono
      text "38" font=mono
      text "57" font=mono
      text "76" font=mono
      text "95" font=mono
      text "114" font=mono
      text "133" font=mono
      text "152" font=mono
      text "171" font=mono
      text "190" font=mono
      text "209" font=mono
      text "228" font=mono
      text "247" font=mono
      text "266" font=mono
      text "285" font=mono
      text "304" font=mono
  project md = "A times table."
```

```times
summary: A times table.
```
```

builder: Needed a generated 300+ element block (a 19x16 times table, about 330 lines); not small, and unavoidable. An author hits this only with a very big table written out by hand. Message is clear but gives no hint of how to restructure (each loops).

- reader 1 (yes): The definition has 324 elements, and the limit is 300. The table has 19 rows of 16 cells, plus the wrapper elements. | fix: Split the table: move some of the rows into a second widget or a pack part, or drop rows so the total is under 300. | confusing: 
- reader 2 (yes): A definition may have at most 300 elements. The table has 324, so about 24 must go. | fix: Delete the last row (the 'text "19"' to '304' row, 16 elements), giving 308, then one more row, giving 292. Or move the table into a pack. | confusing: I cannot tell whether the 324 count includes the rows and the column, so I counted only the text elements.
- reader 3 (yes): One definition has 324 elements, and the limit is 300. The table is written out by hand as 256 text cells plus rows and columns, so it is too big. | fix: Replace the 16 rows with loops: 'each r in 1..16 key=r' containing 'row gap=s', then 'each c in 1..16 key=c' containing 'text format(r * c, 0) font=mono'. | confusing: 

## E010 `mkp.limit` error at `packages/core/src/check/def.ts:897`

message: 33 children; an element may have at most 32 as written

block:
```
# Seating

```mkp
seats "A list of the people at the table."
  column gap=xs
    text "Guest 1"
    text "Guest 2"
    text "Guest 3"
    text "Guest 4"
    text "Guest 5"
    text "Guest 6"
    text "Guest 7"
    text "Guest 8"
    text "Guest 9"
    text "Guest 10"
    text "Guest 11"
    text "Guest 12"
    text "Guest 13"
    text "Guest 14"
    text "Guest 15"
    text "Guest 16"
    text "Guest 17"
    text "Guest 18"
    text "Guest 19"
    text "Guest 20"
    text "Guest 21"
    text "Guest 22"
    text "Guest 23"
    text "Guest 24"
    text "Guest 25"
    text "Guest 26"
    text "Guest 27"
    text "Guest 28"
    text "Guest 29"
    text "Guest 30"
    text "Guest 31"
    text "Guest 32"
    text "Guest 33"
  project md = "Guests."
```

```seats
summary: Guests.
```
```

builder: Needed 33 sibling lines. Message 'children' vs the element-count limit at line 372 uses different wording ('elements') for a different cap; position points at the 33rd child, helpful. Tells the cap but not the fix (group into rows or use each).

- reader 1 (yes): A single element can hold at most 32 direct children. The column has 33 `text` lines. | fix: Nest part of the list in a second column: keep Guest 1 to Guest 16 directly in the outer `column gap=xs`, and put Guest 17 to Guest 33 inside a nested `column gap=xs`. | confusing: 'as written' suggests the limit may depend on how the line is written, which I can't check.
- reader 2 (yes): A column may hold at most 32 children, and this one has 33. | fix: Delete the 'text "Guest 33"' line, or split the list into two columns. | confusing: 'As written' is unclear; I assumed it counts the direct children only.
- reader 3 (yes): The column has 33 text children, and an element may have at most 32. Each child counts, so one must go or the list must be split. | fix: Remove one 'text' line, or split the guests into two column elements inside a row. | confusing: The message says 'as written', which I took to mean the limit applies to the literal lines, not to a loop.

## E011 `mkp.no-fallback` error at `packages/core/src/check/def.ts:387`

message: hills@1 needs gfx@1 (pixels) and has no fallback: give it an "about" text, shown where gfx@1 is missing

block:
```
--- hills.mkp ---
hills@1
  requires gfx@1
  canvas x=-3..3 y=-3..3 size=m label="heights from above"
    layer
      pixels (hsl(0.6 - 0.3 sin(x), 0.7, 0.5)) res=128
  project md = "Heights over $[-3, 3]^2$."
--- manifest.mkp ---
pack heights@1
requires core@1
```

builder: Needed a pack: in a document the header always has an about string, so the missing-about case cannot arise there (without a quoted line the header is a syntax error). The message is clear and tells what to add. Also yields a fixture complaint (no valid fixture case) unrelated to the target.

- reader 1 (partly): The widget `hills@1` needs `gfx@1` for its pixels, and it has no fallback text. The message says to add an `about` text, which is shown where gfx@1 is missing. | fix:   hills@1 "A heights map; shown as text where graphics are missing."  (the 'about' text goes on the definition line, after the name) | confusing: I don't know the exact syntax of an 'about' text; I guessed it goes on the definition line.
- reader 2 (partly): hills@1 needs gfx@1 for its pixels layer. A host without gfx@1 would show nothing, so the definition must give an 'about' text as the fallback. | fix: Under hills@1, after 'requires gfx@1', add: about "Heights over a square, shown as a chart." | confusing: The 'about' syntax and where it goes are not shown. The '--- file ---' sections and the pack manifest lines are unclear to me.
- reader 3 (partly): The widget hills@1 requires gfx@1 because it uses pixels, and it has no fallback text. A fallback is given with an 'about' text, shown where gfx@1 is missing. | fix: hills@1 "A hilly landscape as a heat map." | confusing: The message says to give an 'about' text but does not show where it goes. The block's file layout also differs from the other items, so I am not sure where the about text belongs.

## E012 `mkp.requires-gfx` error at `packages/core/src/check/def.ts:390`

message: pixels need the gfx@1 capability; add "requires gfx@1" to hills@1

block:
```
# Hills

```mkp
hills "A hilly landscape as a heat map."
  canvas x=-3..3 y=-3..3 size=m label="heights from above"
    layer
      pixels (hsl(0.6 - 0.3 sin(x), 0.7, 0.5)) res=128
  project md = "Heights over $[-3, 3]^2$."
```

```hills
summary: Four hills seen from above.
```
```

builder: Easy: use pixels without requires. Message names the fix exactly. Position is the widget header, not the pixels line.

- reader 1 (yes): The `pixels` element needs the gfx@1 capability, and the widget does not declare it. | fix:   hills "A hilly landscape as a heat map."
  requires gfx@1  (add this line under the widget header) | confusing: I'm not sure whether `requires` goes before or after the `canvas` line; I put it under the header.
- reader 2 (partly): Pixels need the gfx@1 capability, which the widget does not require. The message wants 'requires gfx@1' added to hills@1, but the block's widget is named hills without @1. | fix: hills@1 "A hilly landscape as a heat map."
  requires gfx@1 | confusing: The block names the widget 'hills' with no version, so I am not sure whether @1 is required.
- reader 3 (yes): The widget uses 'pixels', which needs the gfx@1 capability, but 'hills' does not declare it. | fix: Add the line '  requires gfx@1' directly under the 'hills "A hilly landscape as a heat map."' header. | confusing: The message says 'hills@1' but the block's header has no version, and it is not clear where a requires line goes in a widget.

## E013 `mkp.answer-leak` error at `packages/core/src/check/def.ts:420`

message: project md shows an answer (accept) outside if(answers, …), so Markdown built without answers would still give it away

block:
```
# Capitals

```mkp
ask "A question answered in a word."
  in prompt text "what to ask"
  in accept list(text) answer "the words that count as right"
  var entry text = ""
  column gap=s
    text prompt
    field value=entry label="your answer"
  project md = prompt + "\n\nAnswer: " + join(accept, " or ")
```

```ask
prompt: What is the capital of Norway?
accept: [Oslo]
summary: A one-word question about Norway.
```
```

builder: Easy once I knew to mark an input 'answer' (found in example 14, guide mentions it). The message is clear. An author who never heard of the answer keyword would not hit it.

- reader 1 (partly): `project md` prints the accepted answer, and it is not wrapped in `if(answers, ...)`. A Markdown output made without answers would still reveal the answer. | fix: Wrap the answer part in the condition, e.g. `project md = prompt + if(answers, <the Answer text>, '')`. The block never declares `answers`, so I can't tell where it comes from. | confusing: `answers` is used in the message but not declared anywhere in the block, so I don't know if it is a built-in flag.
- reader 2 (partly): The answer is shown in project md outside any if(answers, …), so Markdown built without answers would still reveal it. | fix: project md = prompt + if(answers, "\\n\\nAnswer: " + join(accept, " or "), "") | confusing: I am guessing the if() form from the message. I do not know how answers is used elsewhere.
- reader 3 (partly): The project md line shows 'accept', which is the answer, without wrapping it in if(answers, ...). Markdown output would reveal the answer even when answers are hidden. | fix: project md = prompt + if(answers, "\n\nAnswer: " + join(accept, " or "), "") | confusing: I do not know what 'answers' refers to here. The message mentions if(answers, ...) but no such variable is declared in the block.

## E014 `mkp.unknown-interface` error at `packages/core/src/check/def.ts:432`

message: there is no interface scored@1

block:
```
# Rating

```mkp
stars "Rate out of five by pressing a star."
  implements scored@1
  in of int = 5 "how many stars"
  var got int = 0
  row gap=xs
    each k in 1..of key=k
      press kind=plain label=(format(k, 0) + " of " + format(of, 0))
        icon name=star tone=(if(k <= got, warn, muted))
        @click set got=k
  project md = format(got, 0) + " of " + format(of, 0) + " stars"
```

```stars
summary: A five star rating.
```
```

builder: Easy: implementing an interface no loaded pack declares. Message is plain; no did-you-mean since none exist. The block does not show where the interface should come from (a host pack), which a reader can only guess.

- reader 1 (partly): The widget implements `scored@1`, but no interface of that name exists in this document. | fix: Remove the `implements scored@1` line, or declare the interface in a pack and provide it. | confusing: I don't know what implementing an interface requires, or where interfaces must be defined.
- reader 2 (partly): 'implements scored@1' names an interface that is not defined in this document or any pack I can see. | fix: cannot infer (either define interface scored@1 in a pack the document requires, or delete the 'implements scored@1' line) | confusing: How interfaces are supplied (in a pack or in the document) is not clear to me.
- reader 3 (yes): The stars widget says it implements scored@1, but no interface called scored@1 exists in the given files. | fix: cannot infer | confusing: The interface would have to be defined in a pack. Nothing in this block defines it, so I cannot tell whether it should be created or whether the implements line should be removed.

## E015 `mkp.interface` error at `packages/core/src/check/def.ts:458`

message: stars implements scored@1 but has no signal scored {got: int}

block:
```
--- doc.mkp.md ---
# Rating

```mkp
stars "Rate out of five by pressing a star."
  implements scored@1
  in of int = 5 "how many stars"
  var got int = 0
  row gap=xs
    each k in 1..of key=k
      press kind=plain label=(format(k, 0) + " of " + format(of, 0))
        icon name=star tone=(if(k <= got, warn, muted))
        @click set got=k
  project md = format(got, 0) + " of " + format(of, 0) + " stars"
```

```stars
summary: A five star rating.
```
--- manifest.mkp ---
pack scoreboard@1 "A made-up host that adds up the scores of every widget that offers one."
  requires core@1
  provides scored
--- scored.mkp ---
interface scored@1 "A widget whose score a host can add up."
  in of int
  signal scored {got: int}
  project md
```

builder: Borrowed the example 30 host pack and dropped the signal. The message lists exactly what is missing, with types: good. Several misses are joined with semicolons into one sentence.

- reader 1 (partly): The widget says it implements `scored@1`, but it doesn't have the `signal scored {got: int}` that the interface requires. | fix: Add the signal to the stars widget, e.g. `  signal scored {got: int}` next to the other declarations, and make it fire when `got` changes. | confusing: I don't know how a widget emits a signal on change, so I can't write that part.
- reader 2 (partly): stars says it implements scored@1, but scored needs a 'signal scored {got: int}' line, which stars does not have. The interface's signal must be declared on the widget too. | fix: Add 'signal scored {got: int}' under 'implements scored@1' in stars. Sending the score on click is not something I can infer. | confusing: I do not know how a widget sends a signal, so the rest of the fix is unclear.
- reader 3 (yes): The widget says it implements the interface scored@1, which requires a signal 'scored' with a field 'got' of type int. The widget has no such signal. | fix: Add the line '  signal scored {got: int}' under the 'stars' header, next to 'implements scored@1'. | confusing: The interface name (scored) and the signal name (scored) are the same, so it is unclear which one the message refers to.

## E016 `mkp.shadow` error at `packages/core/src/check/def.ts:485`

message: "width" is the reader's width (narrow, medium or wide), which every definition reads; name this something else

block:
```
# Reader

```mkp
reveal "Shows a line only to a wide reader."
  var width int = 0
  text "\val{width}"
  project md = "Reader"
```

```reveal
summary: A line.
```
```

builder: Easy; 'width' is a natural variable name. Message explains the reason and names the options. Branch: width.

- reader 1 (yes): `width` is a reserved name for the reader's width (narrow, medium or wide). A local variable can't use it. | fix: Rename the variable, e.g. `  var shown int = 0` and `  text "\val{shown}"`. | confusing: 
- reader 2 (yes): width is reserved for the reader's width, so it cannot be a variable name. | fix: var shown int = 0
  text "\\val{shown}" | confusing: 
- reader 3 (yes): 'width' is a name the reader's width already uses, and every definition reads it, so this variable clashes with it. | fix: var wide int = 0 (and change '\\val{width}' to '\\val{wide}') | confusing: 

## E017 `mkp.shadow` error at `packages/core/src/check/def.ts:485`

message: "answers" is the reader's answers switch, which every definition reads; name this something else

block:
```
# Reader

```mkp
reveal "Shows a line, with a marker."
  var answers int = 0
  text "\val{answers}"
  project md = "Reader"
```

```reveal
summary: A line.
```
```

builder: Easy but 'answers' is only known from the guide; message explains it as 'the reader's answers switch'. Branch: answers.

- reader 1 (yes): `answers` is a reserved name for the reader's answers switch, so it can't be a local variable. | fix:   var given int = 0  and  text "\val{given}" | confusing: 
- reader 2 (yes): 'answers' is a reserved name for the reader's answers, so the variable cannot use it. The name must change in the var line and in the text. | fix: var count int = 0
  text "\val{count}" | confusing: 
- reader 3 (yes): 'answers' is the reader's answers switch, and every definition reads it, so this variable clashes with it. | fix: var replies int = 0 (and change '\\val{answers}' to '\\val{replies}') | confusing: 

## E018 `mkp.shadow` error at `packages/core/src/check/def.ts:486`

message: "true" is a value of the language; name this something else

block:
```
# Reader

```mkp
reveal "Shows a line, with a marker."
  var true int = 0
  text "\val{true}"
  project md = "Reader"
```

```reveal
summary: A line.
```
```

builder: Easy: a var called true. The message ('a value of the language') is terse but fine; a more natural trigger is a reserved word like 'none' or 'pi'.

- reader 1 (yes): `true` is a built-in value, so it can't be used as a variable name. | fix:   var isTrue int = 0  and  text "\val{isTrue}" | confusing: 
- reader 2 (yes): true is a language value, so it cannot be a variable name. | fix: var count int = 0
  text "\\val{count}" | confusing: 
- reader 3 (yes): 'true' is a language keyword (a boolean value), so it cannot be used as a variable name. | fix: Rename the variable, for example 'var flag int = 0', and change '\\val{true}' to '\\val{flag}'. | confusing: 

## E019 `mkp.shadow` error at `packages/core/src/check/def.ts:488`

message: "warn" is a colour token; a name declared here can't take it, or "warn" in a style would mean this instead (rename it, e.g. "warn2" or "isWarn")

block:
```
# Reader

```mkp
reveal "Shows a line, with a marker."
  var warn int = 0
  text "\val{warn}"
  project md = "Reader"
```

```reveal
summary: A line.
```
```

builder: Easy: warn/ok/bad/info are tempting names. The message is long but includes a rename suggestion; the explanation (a style would mean this instead) is hard for an author to follow. Position points at the var line.

- reader 1 (yes): `warn` is a colour token, so it can't be used as a variable name here. | fix: Rename the variable, e.g. `  var isWarn int = 0` and `  text "\val{isWarn}"`. | confusing: The message says a style using 'warn' would then mean the variable, which I don't fully follow.
- reader 2 (yes): warn is a colour token, so it cannot be a variable name. | fix: var flag int = 0
  text "\\val{flag}" | confusing: 
- reader 3 (yes): 'warn' is a colour token, so it cannot be a variable name. Renaming it avoids the clash. | fix: var warn2 int = 0 (and change '\\val{warn}' to '\\val{warn2}') | confusing: 

## E020 `mkp.shadow` error at `packages/core/src/check/def.ts:491`

message: "sad" is an option of state's choice; a name can't take it, or comparing state with sad would read this instead

block:
```
# Reader

```mkp
mood "Shows a mood."
  var state choice(happy|sad) = happy
  var sad int = 0
  text "\val{state}"
  project md = "Reader"
```

```mood
summary: A mood.
```
```

builder: Easy but unexpected: an option word of one's own choice (sad) cannot also be a name. Message explains via a comparison. Wording 'state's choice' reads as if state were a type.

- reader 1 (partly): `sad` is one option of the `state` choice type. A variable named `sad` would make the option ambiguous. | fix:   var sad int = 0  →  rename it, e.g. `var isSad int = 0` and `text "\val{state}"` stays. | confusing: The message says comparing state with sad 'would read this instead', which I don't fully follow.
- reader 2 (yes): 'sad' is already an option of state's choice(happy|sad), so a variable named sad clashes with that option. | fix: var unhappy int = 0 | confusing: "Comparing state with sad would read this instead" is unclear to me.
- reader 3 (partly): 'sad' is an option of the choice type for state, so a variable named sad would clash with it when comparing state to sad. | fix: var sadness int = 0 | confusing: The message says a name cannot take 'sad', but I cannot tell whether the variable name or the comparison is the problem.

## E021 `mkp.unknown-type` error at `packages/core/src/check/def.ts:506`

message: there is no type "Measure"

block:
```
# Sizes

```mkp
sizer "Shows a size."
  in count int = 1
  in size Measure = 1
  text "\val{count}"
  project md = "x"
```

```sizer
summary: A size.
```
```

builder: Easy: misspelling or inventing a type name. Message is plain; no did-you-mean here because nothing close.

- reader 1 (yes): `Measure` is not a known type. The known types include int, num, text and bool. | fix:   in size num = 1 | confusing: I'm guessing `num` is the intended type; the message doesn't say what Measure was meant to be.
- reader 2 (yes): Measure is not a type in this document or the base set. | fix: in size num = 1 | confusing: If Measure is meant to be a custom type, the message does not say where to define it.
- reader 3 (yes): 'Measure' is not a known type in MKP. The size is a plain number, so the type is wrong. | fix: in size num = 1 | confusing: 

## E022 `mkp.duplicate` error at `packages/core/src/check/def.ts:529`

message: "count" is already declared in this definition

block:
```
# Sizes

```mkp
sizer "Shows a size."
  in count int = 1 "how many"
  var count int = 2
  text "\val{count}"
  project md = "x"
```

```sizer
summary: A size.
```
```

builder: Easy: an input and a var with the same name. The message does not say where the first declaration is.

- reader 1 (yes): `count` is declared twice in the same definition: once as input and once as var. | fix: Delete `  var count int = 2`, or rename it, e.g. `  var total int = 2` with `  text "\val{total}"`. | confusing: The message doesn't say where the first declaration is.
- reader 2 (yes): count is already an input, so declaring a var of the same name clashes. | fix: var tally int = 2
  text "\\val{tally}" | confusing: 
- reader 3 (yes): 'count' is declared twice in the same definition: once as an input and once as a variable. | fix: Delete the line 'var count int = 2' or rename one of them. | confusing: 

## E023 `mkp.check` error at `packages/core/src/check/def.ts:576`

message: play takes a duration such as 8s, or 500ms/step

block:
```
# Dial

```mkp
dial "Something the reader sets."
  var n int = 0
  t = slider 0..1 play=fast "turn"
  text "\val{n}"
  project md = "Dial: " + format(n, 0)
```

```dial
summary: A dial.
```
```

builder: Easy. Generic code mkp.check, which gives no machine-readable category; the message names the accepted forms. 'play=fast' is a natural slip.

- reader 1 (yes): `play` needs a time value such as 8s or 500ms per step. `fast` is not a time. | fix:   t = slider 0..1 play=500ms "turn" | confusing: 
- reader 2 (yes): play needs a duration such as 8s or a pace such as 500ms/step. 'fast' is neither. | fix: t = slider 0..1 play=500ms/step "turn" | confusing: 
- reader 3 (yes): 'play' takes a duration such as 8s or 500ms/step, and 'fast' is not a duration. | fix: t = slider 0..1 play=8s "turn" | confusing: 

## E024 `mkp.check` error at `packages/core/src/check/def.ts:583`

message: loop is once, repeat or bounce

block:
```
# Dial

```mkp
dial "Something the reader sets."
  var n int = 0
  t = slider 0..1 play=8s loop=forever "turn"
  text "\val{n}"
  project md = "Dial: " + format(n, 0)
```

```dial
summary: A dial.
```
```

builder: Easy. Generic mkp.check code again; message lists the three words.

- reader 1 (yes): `loop=` takes one of three words: once, repeat or bounce. `forever` is not one of them. | fix:   t = slider 0..1 play=8s loop=repeat "turn" | confusing: 
- reader 2 (partly): loop takes one of once, repeat or bounce. 'forever' is not one of them. | fix: t = slider 0..1 play=8s loop=repeat "turn" | confusing: I guessed 'repeat' because it is the closest of the three to 'forever'.
- reader 3 (yes): 'loop' only accepts once, repeat or bounce, and 'forever' is not one of them. | fix: t = slider 0..1 play=8s loop=repeat "turn" | confusing: 

## E025 `mkp.check` error at `packages/core/src/check/def.ts:589`

message: a slider needs its range: slider a..b

block:
```
# Dial

```mkp
dial "Something the reader sets."
  var n int = 0
  t = slider "turn"
  text "\val{n}"
  project md = "Dial: " + format(n, 0)
```

```dial
summary: A dial.
```
```

builder: Easy; points at the slider line start. Generic mkp.check code.

- reader 1 (yes): A slider needs its range written as a..b, for example 0..10. | fix:   t = slider 0..10 "turn" | confusing: The slider `t` is not connected to `n`, but the message does not ask about that.
- reader 2 (yes): A slider needs its range, such as 0..1. | fix: t = slider 0..1 "turn" | confusing: 
- reader 3 (yes): A slider needs its range, such as 0..1, and the slider line has none. | fix: t = slider 0..1 "turn" | confusing: 

## E026 `mkp.check` error at `packages/core/src/check/def.ts:613`

message: steps needs a count: steps n

block:
```
# Dial

```mkp
dial "Something the reader sets."
  var n int = 0
  k = steps "item"
  text "\val{n}"
  project md = "Dial: " + format(n, 0)
```

```dial
summary: A dial.
```
```

builder: Easy. Note the guide's own example writes 'steps (len(items))' so the count is an expression. Generic code.

- reader 1 (partly): `steps` needs a count of steps after the keyword. | fix:   k = steps 3 "item" | confusing: I don't know if the count is the number of steps or a range; the message just says 'steps n'.
- reader 2 (yes): steps needs a count (how many steps) before its label. The block gives only the label. | fix: k = steps 3 "item" | confusing: I cannot tell whether the 'n' in the message is a number or the name of an input.
- reader 3 (yes): 'steps' needs a count, such as 'steps 4', and the line gives none. | fix: k = steps 4 "item" | confusing: 

## E027 `mkp.check` error at `packages/core/src/check/def.ts:620`

message: none is true or false, written

block:
```
# Dial

```mkp
dial "Something the reader steps through."
  var on bool = false
  k = steps 4 none=on "item"
  text "\val{k}"
  project md = "Dial: " + format(k, 0)
```

```dial
summary: A dial.
```
```

builder: Hard to guess: needed to read the source to learn that none= and track= must be literal true/false, not a variable. My first try (none=maybe) gave an unrelated unknown-name error. Message 'none is true or false, written' is cryptic; 'written' is unexplained.

- reader 1 (partly): `none=` is given a boolean variable, but `none` is a literal that takes true or false written out. The variable name is not allowed there. | fix:   k = steps 4 none=false "item" | confusing: The message says 'none is true or false, written', which I read as 'write the value, not a name', but I don't know what `none=` controls.
- reader 2 (partly): none is written as a literal true or false, and the block passes the variable on. | fix: k = steps 4 none=true "item" | confusing: I do not know what none= does, so I cannot be sure the fix keeps its meaning.
- reader 3 (partly): The value given to 'none=' is the name of a variable (on), but it has to be a literal true or false. I am not sure what 'none=' controls. | fix: k = steps 4 none=false "item" | confusing: The message says 'none is true or false, written', which I could not turn into a clear rule. I do not know what 'none' does, so the fix may be wrong.

## E028 `mkp.check` error at `packages/core/src/check/def.ts:630`

message: a clock runs on its own; play and pause it with actions

block:
```
# Dial

```mkp
dial "Something the reader sets."
  var n int = 0
  t = clock play=5s "time"
  text "\val{n}"
  project md = "Dial: " + format(n, 0)
```

```dial
summary: A dial.
```
```

builder: Easy once you think of giving a clock play=. Message tells what to do instead.

- reader 1 (yes): A clock starts itself. `play=5s` is not allowed, and the reader must start or pause it through actions. | fix:   t = clock "time"  (remove play=5s); start it from an action, but I cannot infer the action syntax from this block. | confusing: 
- reader 2 (yes): A clock runs by itself, so it cannot take play=. | fix: t = clock "time" | confusing: The message says to use actions to play or pause it, but I do not know the action syntax for a clock.
- reader 3 (yes): A clock runs by itself, so it does not take play=. It is controlled with actions such as play and pause. | fix: t = clock "time" | confusing: 

## E029 `mkp.check` error at `packages/core/src/check/def.ts:635`

message: drag needs its ranges: drag x=a..b y=c..d

block:
```
# Dial

```mkp
dial "Something the reader sets."
  var n int = 0
  p = drag x=0..1 "spot"
  text "\val{n}"
  project md = "Dial: " + format(n, 0)
```

```dial
summary: A dial.
```
```

builder: Easy; supplying only x makes y missing, and the message restates the whole form but does not say which axis is missing.

- reader 1 (yes): `drag` needs a range for each axis: x=a..b and y=c..d. This line gives only x. | fix:   p = drag x=0..1 y=0..1 "spot" | confusing: 
- reader 2 (yes): drag needs both an x range and a y range. The block gives only x. | fix: p = drag x=0..1 y=0..1 "spot" | confusing: 
- reader 3 (yes): 'drag' needs both of its ranges, x and y, and the line gives only x. | fix: p = drag x=0..1 y=0..1 "spot" | confusing: 

## E030 `mkp.check` error at `packages/core/src/check/def.ts:642`

message: unexpected value for toggle

block:
```
# Dial

```mkp
dial "Something the reader sets."
  var n int = 0
  t = toggle 3 "on"
  text "\val{n}"
  project md = "Dial: " + format(n, 0)
```

```dial
summary: A dial.
```
```

builder: Easy but message 'unexpected value for toggle' is vague: it does not show the value. Position is the value, which helps.

- reader 1 (yes): A toggle takes no value after it. The `3` is unexpected. | fix:   t = toggle "on" | confusing: 
- reader 2 (partly): toggle takes no number before its label. The 3 is an unexpected value. | fix: t = toggle "on" | confusing: I do not know what toggle means, so I cannot tell whether it should be bound to n.
- reader 3 (partly): The toggle is given a value (3) that it does not accept. A toggle is on or off, so a number does not fit. | fix: t = toggle "on" | confusing: I do not know whether toggle accepts a true or false initial value, so I removed the 3 without knowing what it should be.

## E031 `mkp.unknown-prop` error at `packages/core/src/check/def.ts:643`

message: slider has no setting "snap"

block:
```
# Dial

```mkp
dial "Something the reader sets."
  var n int = 0
  t = slider 0..1 snap=2 "turn"
  text "\val{n}"
  project md = "Dial: " + format(n, 0)
```

```dial
summary: A dial.
```
```

builder: Easy. Unlike its neighbours this one has a distinct code. Offers no did-you-mean (the others might be 'step').

- reader 1 (yes): `slider` has no `snap=` setting. The setting name for steps in this language is `step=`, as in `slider 1..5 step=1`. | fix:   t = slider 0..1 step=0.5 "turn"  (or remove snap=2 if no snapping is needed) | confusing: 
- reader 2 (yes): slider has no snap setting. | fix: t = slider 0..1 "turn" | confusing: 
- reader 3 (yes): 'snap' is not a setting that a slider accepts. | fix: t = slider 0..1 "turn" | confusing: I do not know what 'snap' was meant to do, so I removed it and the intended behaviour may be lost.

## E032 `mkp.check` error at `packages/core/src/check/def.ts:644`

message: a drag control cannot play

block:
```
# Dial

```mkp
dial "Something the reader sets."
  var n int = 0
  p = drag x=0..1 y=0..1 play=4s "spot"
  text "\val{n}"
  project md = "Dial: " + format(n, 0)
```

```dial
summary: A dial.
```
```

builder: Easy. Position is the drag line, not play=.

- reader 1 (yes): A drag control can't have `play=`, because it is moved by the reader, not by time. | fix:   p = drag x=0..1 y=0..1 "spot"  (remove play=4s) | confusing: 
- reader 2 (yes): A drag control cannot have play=. The block gives play=4s. | fix: p = drag x=0..1 y=0..1 "spot" | confusing: 
- reader 3 (yes): A drag control cannot have a play setting. | fix: p = drag x=0..1 y=0..1 "spot" | confusing: 

## E033 `mkp.unknown-event` error at `packages/core/src/check/def.ts:659`

message: a state line raises change and end, not "click"

block:
```
# Dial

```mkp
dial "Something the reader sets."
  var n int = 0
  t = slider 0..1 "turn"
    @click set n=1
  text "\val{n}"
  project md = "Dial: " + format(n, 0)
```

```dial
summary: A dial.
```
```

builder: Easy once I found that events are indented under the state line (parser says so). Natural slip: @click on a slider.

- reader 1 (yes): A slider does not raise `click`. It raises change and end events instead. | fix:     @change set n=1  (or @end set n=1, if n should be set when the slider reaches an end) | confusing: 
- reader 2 (partly): A state line such as slider raises change and end events, and @click is not one of them. | fix: t = slider 0..1 "turn"
    @change set n=1 | confusing: The event name @change is a guess from the message.
- reader 3 (yes): A slider is a state line, and it raises the events 'change' and 'end', not 'click'. | fix:     @change set n=1 | confusing: 

## E034 `mkp.check` error at `packages/core/src/check/def.ts:660`

message: only a slider or steps reaches an end

block:
```
# Dial

```mkp
dial "Something the reader sets."
  var n int = 0
  t = toggle "on"
    @end set n=1
  text "\val{n}"
  project md = "Dial: " + format(n, 0)
```

```dial
summary: A dial.
```
```

builder: Easy; a toggle with @end. Message is clear; mkp.check generic.

- reader 1 (partly): `@end` is only valid on a slider or steps control. This block uses a `toggle`, which can't reach an end. | fix:   t = slider 0..1 "on"  and keep the `@end set n=1` line. | confusing: I don't know what `@end` means or what 'reaches an end' is in this language.
- reader 2 (partly): Only a slider or steps control has an end event. A toggle does not, so @end is invalid there. | fix: t = slider 0..1 "on"
    @end set n=1 | confusing: I do not know whether a toggle can be replaced by a slider in this design.
- reader 3 (yes): '@end' is only valid on a slider or steps, so a toggle cannot reach an end. | fix: Use '@change' on the toggle, or change the line to a slider or steps. | confusing: 

## E035 `mkp.check` error at `packages/core/src/check/def.ts:714`

message: expected a range a..b, found 5

block:
```
# Page

```mkp
part gauge "A gauge."
  in span range = 0..1 "its extent"
  text "gauge"

page "A page."
  gauge span=5
  project md = "A page."
```

```page
summary: A page.
```
```

builder: Needed a part of my own with a range input: no base prop other than canvas x/y takes a range. Generic mkp.check code; message says what is expected and what was found.

- reader 1 (yes): The `span` input has type range, so it needs a range a..b. The call passes the single number 5. | fix:   gauge span=0..5 | confusing: 
- reader 2 (partly): gauge's span input is a range a..b, but the call passes the single number 5. | fix: gauge span=2..4 | confusing: I did not know that 'a..b' is a type of value, so the input's type was not obvious.
- reader 3 (yes): 'span' takes a range such as 0..1, and the call gives 5, which is a plain number. | fix: gauge span=0..5 | confusing: 

## E036 `mkp.check` error at `packages/core/src/check/def.ts:720`

message: expected a duration such as 6s or 500ms, found 5

block:
```
# Page

```mkp
part pause "A pause."
  in wait duration = 2s "how long"
  text "pause"

page "A page."
  pause wait=5
  project md = "A page."
```

```page
summary: A page.
```
```

builder: Needed my own part with a duration input; a bare 5 is a natural mistake for seconds. Generic code. Message does not hint that 5s is the way to write it beyond the example '6s'.

- reader 1 (yes): The `wait` input is a duration, so a bare number 5 is not valid. A duration needs a unit such as 5s. | fix:   pause wait=5s | confusing: 
- reader 2 (yes): wait is a duration, such as 6s or 500ms. The call passes 5, which has no unit. | fix: pause wait=5s | confusing: 
- reader 3 (yes): A duration needs a unit, and the value 5 has none. The message expects something like 5s or 500ms. | fix: pause wait=5s | confusing: 

## E037 `mkp.check` error at `packages/core/src/check/def.ts:723`

message: a ref input has no default; the caller passes its state

block:
```
# Page

```mkp
part cell "A cell."
  in count ref int = 0 "the count"
  text "\val{count}"

page "A page."
  cell
  project md = "A page."
```

```page
summary: A page.
```
```

builder: Natural slip: give a ref a default. The message is clear. A second error appears in the widget body (count is not defined) because the input is dropped.

- reader 1 (yes): A `ref` input takes its value from the caller, so it must not have a default. The block gives `= 0`. | fix:   in count ref int "the count" | confusing: 'the caller passes its state' means the page must pass a variable, which the block shows through `cell count=total` in the other example.
- reader 2 (partly): A ref input takes no default. Its value comes from the caller's state. | fix: in count ref int "the count"
  (and on the page: var total int = 0, then cell count=total) | confusing: The message does not say whether the default should be removed or the caller should pass a value.
- reader 3 (yes): A ref input has no default value. The caller must pass the state in, so the '= 0' is not allowed. | fix:   in count ref int "the count" | confusing: 

## E038 `mkp.check` error at `packages/core/src/check/def.ts:724`

message: a ref takes the name of the caller's state, found 3

block:
```
# Page

```mkp
part cell "A cell."
  in count ref int "the count"
  text "\val{count}"

page "A page."
  cell count=3
  project md = "A page."
```

```page
summary: A page.
```
```

builder: Needed a part with a ref input and a caller passing a literal. Message clear.

- reader 1 (yes): A `ref` input takes the name of a state variable in the caller, not a number. | fix:   var total int = 3  (in the page), then  cell count=total | confusing: 
- reader 2 (partly): A ref input must be given a state variable from the caller's definition, not a literal. The page has no state, and 3 is a literal. | fix:   var c int = 3
  cell count=c | confusing: "Caller's state" is not explained, and I did not know what a ref is.
- reader 3 (yes): A ref takes the name of the caller's state, and '3' is a literal number. | fix: var total int = 3 (in page), then cell count=total | confusing: 

## E039 `mkp.not-state` error at `packages/core/src/check/def.ts:726`

message: "total" is not state, a var or a ref here; a ref input needs settable state

block:
```
# Page

```mkp
part cell "A cell."
  in count ref int "the count"
  text "\val{count}"

page "A page."
  cell count=total
  project md = "A page."
```

```page
summary: A page.
```
```

builder: Easy: passing an undeclared name to a ref input. The message lists 'state, a var or a ref' but says nothing of undeclared names, and no did-you-mean.

- reader 1 (yes): `total` is not a state, var or ref in the page, so a ref input can't be bound to it. | fix:   var total int = 0  (in the page), then  cell count=total | confusing: 
- reader 2 (partly): A ref input must be given a state variable that exists and can be set. 'total' is not declared anywhere in the page. | fix: page "A page."
  var total int = 0
  cell count=total | confusing: I cannot tell whether 'total' was meant to be declared in the page or elsewhere.
- reader 3 (yes): 'total' is not a state variable in this page, so it cannot be passed as a ref. A ref input needs a variable that can be set. | fix: Add '  var total int = 0' under the 'page "A page."' header, above 'cell count=total'. | confusing: The message says a ref input 'needs settable state' but does not say where the state should be declared.

## E040 `mkp.check` error at `packages/core/src/check/def.ts:728`

message: this ref is text, but total is int

block:
```
# Page

```mkp
part cell "A cell."
  in count ref text "the count"
  text "\val{count}"

page "A page."
  var total int = 0
  cell count=total
  project md = "A page."
```

```page
summary: A page.
```
```

builder: Easy once a ref input exists; message names both types. Generic code.

- reader 1 (yes): The `ref` input is declared as text, but the page passes `total`, which is an int. | fix:   in count ref int "the count" | confusing: 
- reader 2 (yes): The ref is declared text, but total is an int. | fix: in count ref int "the count" | confusing: 
- reader 3 (yes): The ref 'count' is declared as text, but the page passes 'total', which is an int. | fix:   in count ref int "the count" | confusing: 

## E041 `mkp.unknown-token` error at `packages/core/src/check/def.ts:737`

message: "acent" is not a color token (did you mean "accent"?); tone takes a color token: none, surface, ink, muted, line, accent, info, ok, warn, bad, c1, c2, c3, c4, c5, c6

block:
```
# Page

```mkp


page "A page."
  text "hello" tone=acent
  project md = "A page."
```

```page
summary: A page.
```
```

builder: Easy. Misspelling a colour gives a did-you-mean. Message lists all 16 tokens inline which makes it long.

- reader 1 (yes): `acent` is not a colour token; the closest valid one is `accent`. | fix:   text "hello" tone=accent | confusing: 
- reader 2 (yes): 'acent' is a typo for the colour token 'accent'. | fix: text "hello" tone=accent | confusing: 
- reader 3 (yes): 'acent' is a typo of 'accent', which is a colour token. | fix: text "hello" tone=accent | confusing: 

## E042 `mkp.style-token` error at `packages/core/src/check/def.ts:739`

message: tone takes a color token: none, surface, ink, muted, line, accent, info, ok, warn, bad, c1, c2, c3, c4, c5, c6; found 1..2

block:
```
# Page

```mkp


page "A page."
  text "hello" tone=1..2
  project md = "A page."
```

```page
summary: A page.
```
```

builder: Odd to write; a range on a style prop. The message is the same template as the 'by name' one, with 'found 1..2'.

- reader 1 (yes): `tone` takes a colour token, and `1..2` is a range. | fix:   text "hello" tone=accent | confusing: 
- reader 2 (yes): tone needs a colour token. 1..2 is a range. | fix: text "hello" tone=accent | confusing: 
- reader 3 (yes): 'tone' takes a color name, not a range. '1..2' is not a color. | fix: text "hello" tone=accent | confusing: 

## E043 `mkp.style-token` error at `packages/core/src/check/def.ts:741`

message: tone takes a color token: none, surface, ink, muted, line, accent, info, ok, warn, bad, c1, c2, c3, c4, c5, c6, by name; found "#ff0000"

block:
```
# Page

```mkp


page "A page."
  text "hello" tone="#ff0000"
  project md = "A page."
```

```page
summary: A page.
```
```

builder: Easy and the intended case. Message has an awkward comma before 'by name', and lists all tokens.

- reader 1 (yes): `tone` takes a colour token name, not a hex value. | fix:   text "hello" tone=bad  (I am guessing that 'bad' is the red token; the token meanings are not given.) | confusing: 'by name' in the message is unclear, so I don't know whether named colours exist beyond the token list.
- reader 2 (partly): tone needs a colour token by name, and a hex value is not one. | fix: text "hello" tone=bad | confusing: I picked bad as the nearest token to red, so the intended colour may differ.
- reader 3 (yes): tone takes a named colour token, not a hex value. | fix: text "hello" tone=bad | confusing: The message says 'by name', which I read as 'by token name', but I am not sure what the hex value should map to.

## E044 `mkp.style-token` error at `packages/core/src/check/def.ts:746`

message: tone takes a color token: none, surface, ink, muted, line, accent, info, ok, warn, bad, c1, c2, c3, c4, c5, c6; found (3 + 1) (int)

block:
```
# Page

```mkp


page "A page."
  text "hello" tone=(3 + 1)
  project md = "A page."
```

```page
summary: A page.
```
```

builder: Hard to reach in a natural way: an expression that evaluates to a number. Message ends '(int)', fine.

- reader 1 (yes): `tone` takes a colour token name. An int expression `(3 + 1)` is not a token. | fix:   text "hello" tone=c4 | confusing: I picked c4 arbitrarily; the right token depends on what colour is meant.
- reader 2 (yes): tone needs a colour token name. The block gives an expression that produces an int. | fix: text "hello" tone=accent | confusing: 
- reader 3 (yes): tone takes a colour token name, and '(3 + 1)' is an int expression. | fix: text "hello" tone=accent | confusing: 

## E045 `mkp.check` error at `packages/core/src/check/def.ts:750`

message: expected a field name, found 1..2

block:
```
# Page

```mkp
part picklist of T "Records shown by one field."
  in items list(T) "the records"
  in title path(T, text) "the field shown"
  text "list"

page "A page."
  picklist items=[{city: "Oslo"}] title=1..2
  project md = "A page."
```

```page
summary: A page.
```
```

builder: Needed a generic part with a path input (example 24). A range for a field name is an unnatural slip; message fine.

- reader 1 (yes): `title` expects the name of a field in the record, and `1..2` is a range. | fix:   picklist items=[{city: "Oslo"}] title=city | confusing: 
- reader 2 (partly): title takes a field name, such as city. The block gives the range 1..2. | fix: picklist items=[{city: "Oslo"}] title=city | confusing: The message says 'expected a field name', but it does not say why the title needs a field name at this point.
- reader 3 (yes): 'title' needs the name of a field of the item records, not a range. | fix: picklist items=[{city: "Oslo"}] title=city | confusing: 

## E046 `mkp.type` error at `packages/core/src/check/def.ts:756`

message: expected path({city: text}, text), found int

block:
```
# Page

```mkp
part picklist of T "Records shown by one field."
  in items list(T) "the records"
  in title path(T, text) "the field shown"
  text "list"

page "A page."
  picklist items=[{city: "Oslo"}] title=(1 + 2)
  project md = "A page."
```

```page
summary: A page.
```
```

builder: Need a generic part (example 24). Message shows the instantiated path type with the record shape, helpful but heavy.

- reader 1 (yes): `title` must be a path into a record (such as `city`), but it was given an int expression `(1 + 2)`. | fix:   picklist items=[{city: "Oslo"}] title=city | confusing: The form `path({city: text}, text)` is hard to read, so I'm not sure what a valid path looks like in general.
- reader 2 (partly): title needs a path to a field (here city, text). The block gives a number. | fix: picklist items=[{city: "Oslo"}] title=city | confusing: The message says 'path({city: text}, text)', which I read as the field path.
- reader 3 (yes): 'title' must be a path to a text field, and '(1 + 2)' is an int expression. | fix: picklist items=[{city: "Oslo"}] title=city | confusing: 

## E047 `mkp.type` error at `packages/core/src/check/def.ts:760`

message: T is known only where the definition is used

block:
```
# Page

```mkp
part holder of T "Holds one thing."
  in item T = 3 "the thing"
  text "holder"

page "A page."
  holder item=4
  project md = "A page."
```

```page
summary: A page.
```
```

builder: Hard to find: a default for an input typed by a type parameter. The message 'T is known only where the definition is used' is understandable, but points at the input line and does not say that a default is the problem.

- reader 1 (partly): The type `T` is only known where the definition is used, so the default `= 3` for `item` conflicts with the caller's `item=4` type. | fix: Remove the default: `  in item T "the thing"`, and let the caller pass the value. | confusing: The message doesn't say which type T became, and why the default doesn't fit.
- reader 2 (partly): T is fixed only where holder is used. The default '= 3' is given inside the definition, where T is not yet known, so it cannot be checked. | fix: in item T "the thing" (remove the '= 3' default; the call holder item=4 stays) | confusing: "Known only where the definition is used" is not clear to me, so I am guessing why the default fails.
- reader 3 (partly): The type parameter T is only known where the definition is used, and the default value 3 for item does not match the caller's value 4 in this case. | fix: cannot infer | confusing: The message does not say which value is wrong. It might be that the default should be removed, or that T should be fixed to a type.

## E048 `mkp.check` error at `packages/core/src/check/def.ts:763`

message: expected an expression in x

block:
```
# Page

```mkp
part plot "A plot of a rule."
  in rule expr(x): num "the rule"
  text "plot"

page "A page."
  plot rule=1..2
  project md = "A page."
```

```page
summary: A page.
```
```

builder: Needed an expr(x): num input. The message 'expected an expression in x' is vague: it does not show what was found.

- reader 1 (partly): `expr(x)` needs an expression in x, such as `x + 1`, but the call gives the range `1..2`. | fix:   plot rule=x + 1 | confusing: The message says 'expected an expression in x' but I'm not sure whether the expression must use the variable x.
- reader 2 (partly): rule takes an expression in x. The block gives the range 1..2. | fix: plot rule=x + 1 | confusing: I am not sure what x refers to in this call, so the expression is a guess.
- reader 3 (yes): 'rule' needs an expression in terms of x, not a range. | fix: plot rule=(x > 1) | confusing: 

## E049 `mkp.check` error at `packages/core/src/check/def.ts:772`

message: a slot is filled by indented lines (or a container), not by an argument

block:
```
# Page

```mkp
part panel "A panel with room."
  in content slot = "empty" "what goes in"
  slot content

page "A page."
  panel
  project md = "A page."
```

```page
summary: A page.
```
```

builder: Surprising: you cannot pass a slot as an argument (content=3 gives mkp.unknown-prop 'panel has no prop "content" (did you mean "content"?)', a self-referential suggestion that is plainly wrong). This message only appears when the slot has a default. The default is what I had to write to reach it; the message talks about arguments, not defaults.

- reader 1 (yes): A slot is filled by indented lines when the widget is used, not by a default argument. The definition gives `slot` a default of "empty". | fix:   in content slot "what goes in" | confusing: 
- reader 2 (partly): A slot is filled by indented lines under the widget, not by an argument. The 'slot content' default is not how it is given. | fix: in content slot "what goes in"
  ...and on the page: panel, then indented text "hello" lines | confusing: I do not know the exact layout of a slot with default content.
- reader 3 (yes): A slot cannot be filled by an argument. Its content is written as indented lines under the widget. | fix: panel
    text "hello" | confusing: 

## E050 `mkp.check` error at `packages/core/src/check/def.ts:774`

message: dot records are written as indented "dot …" lines

block:
```
# Page

```mkp
part marks "Marked points."
  in dots list(record dot {at: num, name: text}) "the points"
  text "marks"

page "A page."
  marks dots=3
  project md = "A page."
```

```page
summary: A page.
```
```

builder: Needed a records-type input. The message is clear and tells the form.

- reader 1 (yes): A list of records is given as indented `dot ...` lines, not as a single value. `dots=3` is a plain number. | fix:   marks
    dot at=3 name="A" | confusing: I'm not sure of the exact `dot` line syntax beyond the message's hint.
- reader 2 (partly): A list of dot records is written as indented 'dot …' lines under the widget. 'dots=3' is not that form. | fix: marks
    dot at=3 name="c" | confusing: The exact fields of a dot line are guessed from the message, not shown.
- reader 3 (yes): A list of dot records must be written as indented 'dot ...' lines, and 'dots=3' is a plain number. | fix: cannot infer | confusing: The message says dot records are indented lines, but I do not know the exact syntax for each dot line, so I cannot write the replacement.

## E051 `mkp.check` error at `packages/core/src/check/def.ts:776`

message: expected text, found 1..2

block:
```
# Page

```mkp
part tag "A tag."
  in name text = "x" "the words"
  text name

page "A page."
  tag name=1..2
  project md = "A page."
```

```page
summary: A page.
```
```

builder: Easy but contrived: a range for text. Message 'expected text, found 1..2' is plain.

- reader 1 (yes): `name` is a text input, but the call passes a range `1..2`. | fix:   tag name="one two" | confusing: 
- reader 2 (yes): name takes text. The block gives the range 1..2. | fix: tag name="hi" | confusing: 
- reader 3 (yes): 'name' needs a text value, and '1..2' is a range. | fix: tag name="hi" | confusing: 

## E052 `mkp.check` error at `packages/core/src/check/def.ts:784`

message: expected maths $…$, found 1..2

block:
```
# Page

```mkp
part formula "A formula."
  in eq latex = $x$ "the maths"
  text "formula"

page "A page."
  formula eq=1..2
  project md = "A page."
```

```page
summary: A page.
```
```

builder: Easy once there is a latex input. Message gives the form.

- reader 1 (yes): A latex input needs maths in $...$. The call passes a range `1..2`. | fix:   formula eq=$x$ | confusing: 
- reader 2 (yes): formula's eq is latex, so it needs $…$. The block gives a range. | fix: formula eq=$x^2$ | confusing: 
- reader 3 (yes): A 'latex' input needs maths in $...$, and the value 1..2 is a range. | fix: formula eq=$x^2$ | confusing: 

## E053 `mkp.check` error at `packages/core/src/check/def.ts:787`

message: expected maths ($…$ or a latex value), found int

block:
```
# Page

```mkp
part formula "A formula."
  in eq latex = $x$ "the maths"
  text "formula"

page "A page."
  formula eq=(3)
  project md = "A page."
```

```page
summary: A page.
```
```

builder: Easy; message states the type found (int).

- reader 1 (yes): A `latex` input needs maths in $...$, but the call passes the int (3). | fix:   formula eq=$3$ | confusing: 
- reader 2 (yes): eq is a maths input, so its value must be latex written in $…$. The block gives the int 3. | fix: formula eq=$x^2$ | confusing: "A latex value" is not explained.
- reader 3 (yes): The formula input needs maths in $...$ or a latex value, and '(3)' is an int. | fix: formula eq=$3$ | confusing: 

## E054 `mkp.enum` error at `packages/core/src/check/def.ts:792`

message: align takes one of start, center, end, stretch, baseline; found 1..2

block:
```
# Page

```mkp


page "A page."
  column align=1..2
    text "hi"
  project md = "A page."
```

```page
summary: A page.
```
```

builder: Easy: base props are choices. Message lists the options but the contrived range argument is an unlikely thing to write.

- reader 1 (yes): `align` takes a fixed word, and `1..2` is a range. | fix:   column align=center | confusing: 
- reader 2 (yes): align takes a fixed word. The block gives the range 1..2. | fix: column align=center | confusing: 
- reader 3 (yes): 'align' takes one of a fixed set of words, and '1..2' is not one of them. | fix: column align=start | confusing: 

## E055 `mkp.enum` error at `packages/core/src/check/def.ts:795`

message: align takes one of start, center, end, stretch, baseline; found cetner (did you mean "center"?)

block:
```
# Page

```mkp


page "A page."
  column align=cetner
    text "hi"
  project md = "A page."
```

```page
summary: A page.
```
```

builder: Easiest: misspelt option, with a did-you-mean.

- reader 1 (yes): `align` takes one fixed word, and `cetner` is a typo. | fix:   column align=center | confusing: 
- reader 2 (yes): 'cetner' is a typo for center. | fix: column align=center | confusing: 
- reader 3 (yes): 'cetner' is a typo for 'center', which is one of the allowed align values. | fix: column align=center | confusing: 

## E056 `mkp.enum` error at `packages/core/src/check/def.ts:797`

message: align takes one of start, center, end, stretch, baseline; found (3)

block:
```
# Page

```mkp


page "A page."
  column align=(3)
    text "hi"
  project md = "A page."
```

```page
summary: A page.
```
```

builder: Hard to produce naturally: a non-id expression of the wrong type. Found is shown as (3).

- reader 1 (yes): `align` takes a fixed word such as center, not a bracketed expression. | fix:   column align=center | confusing: 
- reader 2 (yes): align takes a fixed word (start, center, end, stretch or baseline). The block gives (3), which is an int. | fix: column align=center | confusing: 
- reader 3 (yes): align takes one of a fixed set of words, and '(3)' is a number in brackets. | fix: column align=start | confusing: 

## E057 `mkp.check` error at `packages/core/src/check/def.ts:801`

message: expected int, found 1..2

block:
```
# Page

```mkp
part counter2 "A count."
  in count int = 1 "how many"
  text "count"

page "A page."
  counter2 count=1..2
  project md = "A page."
```

```page
summary: A page.
```
```

builder: Contrived; a range where int is expected. 'expected int, found 1..2'.

- reader 1 (yes): `count` is an int input, and the call passes a range `1..2`. | fix:   counter2 count=2 | confusing: 
- reader 2 (yes): count is an int. The block gives the range 1..2. | fix: counter2 count=2 | confusing: 
- reader 3 (yes): 'count' needs an int, and '1..2' is a range. | fix: counter2 count=1 | confusing: 

## E058 `mkp.check` error at `packages/core/src/check/def.ts:815`

message: cols takes a number of equal columns or tracks such as [auto, 1fr, 6ch]

block:
```
# Page

```mkp


page "A page."
  grid cols=1..2
    text "a"
  project md = "A page."
```

```page
summary: A page.
```
```

builder: Contrived: cols=1..2. A natural trigger is hard because a number, a list or an expression is accepted. Generic code.

- reader 1 (yes): `cols` takes a whole number of equal columns or a list of tracks. A range `1..2` is not valid. | fix:   grid cols=2 | confusing: I don't know what a 'track' is, so I can't judge the list form.
- reader 2 (yes): cols takes a number or a list of tracks. The block gives a range. | fix: grid cols=2 | confusing: 
- reader 3 (yes): 'cols' takes a number of columns or a list of tracks, and '1..2' is neither. | fix: grid cols=[auto, 1fr] | confusing: 

## E059 `mkp.input-type` error at `packages/core/src/check/def.ts:819`

message: "wide" is not a column track: auto, fit, Nfr (a share), Nch (characters) or a size token (s, m, l)

block:
```
# Page

```mkp


page "A page."
  grid cols=[auto, wide]
    text "a"
  project md = "A page."
```

```page
summary: A page.
```
```

builder: Easy: a column track word that does not exist. The message lists the valid forms. Code is mkp.input-type, which elsewhere is for YAML data, here it is a prop in the view.

- reader 1 (yes): `wide` is not a valid track. Valid tracks are auto, fit, Nfr, Nch or a size token s, m, l. | fix:   grid cols=[auto, 1fr] | confusing: 
- reader 2 (yes): 'wide' is not a column size. Valid sizes are auto, fit, Nfr, Nch, or s, m, l. | fix: grid cols=[auto, 1fr] | confusing: 
- reader 3 (yes): 'wide' is not a valid track. Tracks are auto, fit, Nfr, Nch or a size token (s, m, l). | fix: grid cols=[auto, 1fr] | confusing: 

## E060 `mkp.input-type` error at `packages/core/src/check/def.ts:820`

message: a grid needs at least one column

block:
```
# Page

```mkp


page "A page."
  grid cols=[]
    text "a"
  project md = "A page."
```

```page
summary: A page.
```
```

builder: Easy: cols=[]. Same code oddity as the previous.

- reader 1 (yes): `cols=[]` is an empty list, and a grid needs at least one column. | fix:   grid cols=[auto] | confusing: 
- reader 2 (yes): A grid needs at least one column, and cols=[] is empty. | fix: grid cols=[1fr] | confusing: 
- reader 3 (partly): The grid has an empty list of columns, and a grid needs at least one. | fix: cannot infer (the exact syntax for a column in cols is not shown here; at least one column entry is needed, for example cols=[1]) | confusing: I do not know what a column entry looks like in cols=[], so I cannot write a correct fix.

## E061 `mkp.input-type` error at `packages/core/src/check/def.ts:827`

message: cols takes a whole number or tracks such as [auto, 1fr]; found bool

block:
```
# Page

```mkp


page "A page."
  grid cols=(true)
    text "a"
  project md = "A page."
```

```page
summary: A page.
```
```

builder: Contrived. cols=(true) is not something an author writes; cols=(n / 2) with n int/num would be more natural.

- reader 1 (yes): `cols` takes a whole number or a list of tracks, not a boolean. | fix:   grid cols=2 | confusing: 
- reader 2 (yes): cols takes a whole number or a list. The block gives true. | fix: grid cols=2 | confusing: 
- reader 3 (yes): 'cols' cannot be a bool. It needs a whole number or a list of tracks. | fix: grid cols=[auto, 1fr] | confusing: 

## E062 `mkp.input-range` error at `packages/core/src/check/def.ts:829`

message: a grid needs at least one column

block:
```
# Page

```mkp


page "A page."
  grid cols=0
    text "a"
  project md = "A page."
```

```page
summary: A page.
```
```

builder: Easy: cols=0. Two different codes (input-type at 820, input-range here) for the same 'at least one column' message.

- reader 1 (yes): A grid needs at least one column; 0 is not enough. | fix:   grid cols=1 | confusing: 
- reader 2 (partly): cols=0 gives a grid with no columns, and a grid needs at least one. | fix: grid cols=[1fr] | confusing: I cannot tell whether cols=N is a count or a list of tracks. I assumed a list, as in the previous error.
- reader 3 (yes): A grid needs at least one column, and cols=0 gives none. | fix: grid cols=1 | confusing: 

## E063 `mkp.unknown-field` error at `packages/core/src/check/def.ts:844`

message: "cty" isn't a field of the items (they have city) (did you mean "city"?)

block:
```
# Page

```mkp
part picklist of T "Records shown by one field."
  in items list(T) "the records"
  in title path(T, text) "the field shown"
  text "list"

page "A page."
  picklist items=[{city: "Oslo"}] title=cty
  project md = "A page."
```

```page
summary: A page.
```
```

builder: Needed a generic picklist part with a path input. Message has double parentheses '(they have city) (did you mean "city"?)'.

- reader 1 (yes): `cty` is not a field of the items. The items have `city`. | fix:   picklist items=[{city: "Oslo"}] title=city | confusing: 
- reader 2 (yes): cty is a typo for city, the field the items have. | fix: picklist items=[{city: "Oslo"}] title=city | confusing: 
- reader 3 (yes): 'cty' is not a field of the items, and the message suggests 'city'. | fix: picklist items=[{city: "Oslo"}] title=city | confusing: 

## E064 `mkp.type` error at `packages/core/src/check/def.ts:845`

message: "city" holds int, but this path needs text (quote the values in the YAML to make them text)

block:
```
# Page

```mkp
part picklist of T "Records shown by one field."
  in items list(T) "the records"
  in title path(T, text) "the field shown"
  text "list"

page "A page."
  picklist items=[{city: 3}] title=city
  project md = "A page."
```

```page
summary: A page.
```
```

builder: Easy once a generic part exists: YAML-style number where text is needed. The message includes a helpful quote-the-values tip.

- reader 1 (partly): The `city` field holds an int (3), but the path `city` needs text. | fix:   picklist items=[{city: "Oslo"}] title=city | confusing: The message says to quote the values in the YAML, but the value here is in an mkp line, not YAML, so I'm not sure what it means.
- reader 2 (yes): city is int in the data, but the title path needs text. Quoting the value in the list makes it text. | fix: picklist items=[{city: "3"}] title=city | confusing: 
- reader 3 (yes): The 'city' values are ints (3), but the title path needs text, so the data is wrong. | fix: picklist items=[{city: "3"}] title=city | confusing: 

## E065 `mkp.type` error at `packages/core/src/check/def.ts:866`

message: picklist can't tell what T is here: give the inputs that hold it

block:
```
# Page

```mkp
part picklist of T "Records shown by one field."
  in items list(T) "the records"
  in title path(T, text) "the field shown"
  text "list"

page "A page."
  picklist title=city
  project md = "A page."
```

```page
summary: A page.
```
```

builder: Easy: omit the input that binds T. Message is understandable but 'give the inputs that hold it' does not name which.

- reader 1 (partly): The picklist can't work out `T`, because the call passes `title=city` but no `items`. | fix:   picklist items=[{city: "Oslo"}] title=city | confusing: The message doesn't say which input must supply T; I'm guessing it's `items`.
- reader 2 (partly): T can be known only from an input that holds records (here items). The call sets title=city but gives nothing for items, so T is unknown. | fix: picklist items=<a list of records> title=city | confusing: "The inputs that hold it" is not clear, and the exact form of the records is not shown.
- reader 3 (partly): The picklist's type T cannot be worked out, because the items input is not given a value here. | fix: cannot infer | confusing: The message says to give the inputs that hold T, but the items input is not supplied in this block, and I do not know what to give it.

## E066 `mkp.duplicate-id` error at `packages/core/src/check/def.ts:680`

message: the id "one" is used twice in this definition

block:
```
# Page

```mkp


page "A page."
  column
    text "a" id=one
    text "b" id=one
  project md = "A page."
```

```page
summary: A page.
```
```

builder: Easy: two id=one. The message points at the second, but does not say where the first is.

- reader 1 (yes): The same id `one` is used on two elements in the same definition. Ids must be unique. | fix:     text "b" id=two | confusing: 
- reader 2 (yes): The id 'one' is used by two elements in the same definition. | fix: text "b" id=two | confusing: 
- reader 3 (yes): The id 'one' appears on two elements in the same definition, and ids must be unique. | fix:     text "b" id=two | confusing: 

## E067 `mkp.input-range` error at `packages/core/src/check/def.ts:880`

message: lines takes a whole number from 0 to 24; found 30

block:
```
# Page

```mkp


page "A page."
  text "a" lines=30
  project md = "A page."
```

```page
summary: A page.
```
```

builder: Easy; limit 24 is visible in the message.

- reader 1 (yes): `lines` takes a whole number from 0 to 24. The value 30 is out of range. | fix:   text "a" lines=24 | confusing: 
- reader 2 (yes): lines takes a whole number from 0 to 24. The block gives 30. | fix: text "a" lines=24 | confusing: 
- reader 3 (yes): 'lines' must be a whole number from 0 to 24, and 30 is out of range. | fix: text "a" lines=24 | confusing: 

## E068 `mkp.type` error at `packages/core/src/check/def.ts:842`

message: a path reads records; text is not one

block:
```
# Cities

```mkp
picklist of T "Records shown by one field."
  in items list(T) "the records"
  in title path(T, text) "the field shown"
  text (items[0][title])
  project md = "A list."
```

```picklist
items: [Oslo, Lima, Quito]
title: city
summary: Three cities.
```
```

builder: Only reachable from the YAML block (the view-line route checks the record type first). Message 'text is not one' is confusing: it talks about the items' type, and the position is the end of the document (line 13 col 1) rather than the title: line.

- reader 1 (yes): `items[0][title]` reads a field from a record, but the items here are plain text strings. | fix:   items: [{city: Oslo}, {city: Lima}, {city: Quito}] | confusing: 
- reader 2 (partly): A path reads fields from records. Here 'items[0][title]' is used as text, but the value it reads is a path, not a text value. | fix: cannot infer | confusing: "A path reads records; text is not one" is unclear, and I cannot tell how to get the value out of a record.
- reader 3 (yes): A path reads a field of a record, and 'items[0][title]' is text, not a record, so the text line cannot read it. | fix: text (items[0][title]) | confusing: The block has 'text (items[0][title])' as written, so the error is not clear. The message suggests a path is needed, but the line already uses one.

## E069 `mkp.type` error at `packages/core/src/check/def.ts:863`

message: T is int in one place and text in another

block:
```
# Page

```mkp
part pair of T "Two of a kind."
  in first T "the first"
  in second T "the second"
  text "pair"

page "A page."
  pair first=1 second="x"
  project md = "A page."
```

```page
summary: A page.
```
```

builder: Needed a generic part with two inputs of the same T. Message is clear. Position is the second value.

- reader 1 (yes): `T` is bound to int by `first=1` and to text by `second="x"`, so the two values don't agree on one type. | fix:   pair first=1 second=2  (or use two text values: first="x" second="y") | confusing: 
- reader 2 (yes): T is fixed by the first input as int, but the second input gives text. | fix: pair first=1 second=2 | confusing: 
- reader 3 (yes): T is inferred as int from 'first=1' but as text from 'second="x"'. Both values must be the same type. | fix: pair first=1 second=2 | confusing: 

## E070 `mkp.limit` error at `packages/core/src/check/def.ts:911`

message: nested 13 levels deep; at most 12 under one definition

block:
```
# Nested notes

```mkp
outline "Notes nested inside notes."
  column pad=xs
    column pad=xs
      column pad=xs
        column pad=xs
          column pad=xs
            column pad=xs
              column pad=xs
                column pad=xs
                  column pad=xs
                    column pad=xs
                      column pad=xs
                        column pad=xs
                          column pad=xs
                            column pad=xs
                              text "innermost"
  project md = "Nested notes."
```

```outline
summary: Notes inside notes.
```
```

builder: Easy once I knew the cap is 12; I had to count indentation levels to hit it. The message says 13 levels although the author wrote 14 nested columns, so the count is not obviously the author's own. The position points at the offending line, which helps.

- reader 1 (yes): Containers may nest at most 12 levels deep. The block has 13 nested `column` lines. | fix: Delete one of the thirteen nested `column pad=xs` lines so 12 remain. | confusing: 
- reader 2 (partly): Widgets nest 13 deep, and the limit is 12. Removing one nested column level brings it to the limit. | fix: Remove one 'column pad=xs' line and dedent the lines under it by two spaces. | confusing: I cannot tell which level is safe to remove, so the exact text is not given.
- reader 3 (yes): The column nesting is 13 deep, and the limit is 12. Each nested column adds one level. | fix: Remove one of the nested column lines, for example the innermost one. | confusing: 

## E071 `mkp.check` error at `packages/core/src/check/def.ts:929`

message: slot places one slot value: slot body or slot pages[i].slot

block:
```
# Layout

```mkp
panel "A panel with a body."
  in body slot
  column pad=m
    slot
  project md = "A panel."
```

```panel
summary: A panel.
```
```

builder: Needed to know slots are declared with 'in body slot'. A bare 'slot' with no argument gives a message with two examples; the code is the generic mkp.check, which says nothing about the kind of mistake.

- reader 1 (partly): `slot` must name which slot it places, such as `slot body`. A bare `slot` gives no name. | fix:     slot body | confusing: The message mentions 'slot pages[i].slot', which I don't have context for.
- reader 2 (yes): A bare 'slot' has no name. It must say which slot value it places, such as body. | fix: slot body | confusing: 
- reader 3 (yes): slot needs a slot value, such as 'slot body', and the line gives none. | fix: slot body | confusing: 

## E072 `mkp.check` error at `packages/core/src/check/def.ts:931`

message: slot needs a slot value; found text

block:
```
# Layout

```mkp
panel "A panel with a body."
  in body slot
  in note text = ""
  column pad=m
    slot note
  project md = "A panel."
```

```panel
summary: A panel.
```
```

builder: Easy: passing a text input to slot. Message says 'found text' but not which input; the cure (declare it 'in x slot') is not stated.

- reader 1 (yes): `slot note` needs a slot, but `note` is a text input. | fix:     text note  (or make `note` a slot with `in note slot` and fill it) | confusing: 
- reader 2 (yes): slot needs a slot value. note is text, not a slot. | fix: slot body | confusing: 
- reader 3 (yes): 'slot note' needs a slot, but 'note' is declared as text. | fix: Change '  in note text = ""' to '  in note slot'. | confusing: 

## E073 `mkp.unknown-control` error at `packages/core/src/check/def.ts:937`

message: "missing" is not a control of quiz

block:
```
# Quiz

```mkp
quiz "A quiz with a slider."
  level = slider 1..5 step=1 = 2 "level"
  column
    controls missing
    text "x"
  project md = "A quiz."
```

```quiz
summary: A quiz.
```
```

builder: Easy. The message does not list the controls that do exist, unlike other unknown-* messages that offer a did-you-mean.

- reader 1 (yes): `controls` refers to a control by name. The only control declared is `level`, so `missing` does not exist. | fix:     controls level | confusing: 
- reader 2 (yes): controls takes a state name, and missing is not one of quiz's states. | fix: controls level | confusing: 
- reader 3 (yes): 'missing' is not a control of the quiz widget, so controls can only name controls the widget has. | fix: Change 'controls missing' to a control that quiz declares, such as 'controls level' if level is meant. | confusing: I do not know which controls quiz has. 'level' is the only named control in the block, so that is my guess.

## E074 `mkp.check` error at `packages/core/src/check/def.ts:936`

message: controls takes state names

block:
```
# Quiz

```mkp
quiz "A quiz with a slider."
  level = slider 1..5 step=1 = 2 "level"
  column
    controls "level"
    text "x"
  project md = "A quiz."
```

```quiz
summary: A quiz.
```
```

builder: Easy: a quoted string instead of a bare name. A parenthesised (level) was silently accepted as a name. Generic mkp.check code.

- reader 1 (yes): `controls` takes state names as bare words, not quoted strings. | fix:     controls level | confusing: 
- reader 2 (yes): controls takes state names as bare words. The block quotes the name. | fix: controls level | confusing: The rule for quotes versus bare words is not stated.
- reader 3 (yes): controls takes state names, not a string in quotes. | fix: controls level | confusing: 

## E075 `mkp.check` error at `packages/core/src/check/def.ts:943`

message: fill belongs directly under a widget, to fill one of its slots

block:
```
# Menu

```mkp
sizes "A menu of sizes."
  in names list(text)
  overlay mode=menu label="size"
    text "pick"
    each n in names key=n
      fill body
        text n
  project md = "Sizes."
```

```sizes
names: [small, large]
summary: Sizes.
```
```

builder: I had to guess how a fill could end up not directly under a widget: putting it inside an each (e.g. to fill once per item) trips it. The message does not say that each/switch/column are in between, and the author's intent (a fill per item) has no supported form.

- reader 1 (yes): `fill` must sit directly under a widget to fill its slot, not inside an `each` loop. | fix: Move `fill body` out of the loop, so it is directly under the overlay, and give the loop's text to the slot. | confusing: The message doesn't say which slot the overlay has, so I can't write the exact slot name.
- reader 2 (partly): fill must sit directly under the widget whose slot it fills. In the block, fill is nested inside each. | fix: cannot infer (move 'fill body' out of the each, directly under the overlay) | confusing: I cannot tell how an overlay's items should be laid out once fill is moved.
- reader 3 (partly): 'fill body' sits inside 'each', not directly under the overlay widget. A fill must be a direct child of the widget whose slot it fills. | fix: overlay mode=menu label="size"
    text "pick"
    fill body
      each n in names key=n
        text n | confusing: I am not sure whether 'each' is allowed inside a fill, so the fix may still be wrong.

## E076 `mkp.check` error at `packages/core/src/check/def.ts:947`

message: case belongs under switch

block:
```
# Verdict

```mkp
verdict "A verdict on a score."
  in score int = 3
  column
    case 3
      text "three"
  project md = "Verdict."
```

```verdict
summary: A verdict.
```
```

builder: Easy: a case line outside switch. Message is clear; same text for else.

- reader 1 (yes): `case` must sit under a `switch`, which holds the value to test. | fix:   switch on=score
    case 3
      text "three" | confusing: 
- reader 2 (yes): case must be inside a switch. | fix: switch on=score
      case 3
        text "three" | confusing: 
- reader 3 (yes): 'case' is only allowed directly under a 'switch', and here it sits under a column. | fix: Wrap the case in 'switch on=score', so 'case 3' sits under it. | confusing: 

## E077 `mkp.check` error at `packages/core/src/check/def.ts:966`

message: a prop line sets one value: title <value>

block:
```
# Entries

```mkp
part entry "One entry."
  in title text
  in note text = ""
  text title

entries "Two entries."
  column
    entry
      title "One" "Two"
  project md = "Entries."
```

```entries
summary: Two entries.
```
```

builder: Easy once I knew a bare input name under a widget use is a 'prop line'; the idea is not named anywhere in the message beyond 'prop line'. A second missing-input error is also reported for title because the line failed, which is noise.

- reader 1 (yes): A prop line sets one value, but this gives two values to `title`. | fix:       title "One" | confusing: 
- reader 2 (partly): A prop line like 'title' takes one value. The block gives two values, "One" and "Two". | fix: title "One" | confusing: I cannot tell whether a second entry is needed for the second value.
- reader 3 (yes): A prop line sets one value, and 'title "One" "Two"' gives two. | fix: title "One" | confusing: 

## E078 `mkp.check` error at `packages/core/src/check/def.ts:967`

message: the prop line "title" cannot have indented lines

block:
```
# Entries

```mkp
part entry "One entry."
  in title text
  in note text = ""
  text title

entries "Two entries."
  column
    entry
      title "One"
        text "more"
  project md = "Entries."
```

```entries
summary: Two entries.
```
```

builder: Easy; same extra missing-input noise as the neighbouring prop-line error since the failed line leaves the input unset.

- reader 1 (yes): A prop line like `title "One"` takes a single value, and it can't have indented lines under it. | fix:       title "One"  (move the text "more" to its own element under entry, not under title) | confusing: 
- reader 2 (yes): A prop line such as title takes one value and cannot have indented lines beneath it. The 'text "more"' line is indented under it. | fix: Delete the 'text "more"' line. | confusing: 
- reader 3 (yes): 'title "One"' is a prop line, and prop lines cannot have indented children such as 'text "more"'. | fix: Remove the indented 'text "more"' line so that 'title "One"' stands alone. | confusing: 

## E079 `mkp.missing-input` error at `packages/core/src/check/def.ts:994`

message: the mark record needs at (int)

block:
```
# Marks

```mkp
ruler "Marks along a line."
  in marks list(record mark {at: int, tone: color = accent})
  column
    each m in marks key=m.at
      text "mark \val{m.at}" tone=(m.tone)
  project md = "Marks."

shelf "A shelf with a ruler."
  ruler
    mark tone=ok
  project md = "Shelf."
```

```shelf
summary: A shelf.
```
```

builder: Easy: omit a required record field. Message uses 'the mark record needs at (int)', good. Writing a record under a widget use is only discoverable from the base widgets (list/item).

- reader 1 (yes): The `mark` record type requires an `at` value, which is missing from the `mark tone=ok` call. | fix:     mark at=1 tone=ok | confusing: 
- reader 2 (yes): A mark record needs its at field. | fix: mark at=2 tone=ok | confusing: 
- reader 3 (yes): The 'mark' record needs an 'at' field, and the use gives only 'tone'. | fix:     mark at=1 tone=ok | confusing: 

## E080 `mkp.check` error at `packages/core/src/check/def.ts:1001`

message: a mark record has no events

block:
```
# Marks

```mkp
ruler "Marks along a line."
  in marks list(record mark {at: int, tone: color = accent})
  column
    each m in marks key=m.at
      text "mark \val{m.at}" tone=(m.tone)
  project md = "Marks."

shelf "A shelf with a ruler."
  ruler
    mark at=2
      @click set n=1
  project md = "Shelf."
```

```shelf
summary: A shelf.
```
```

builder: Easy once a record under a widget use is known. The record's path in the message is the widget use, and the position points at the event line; wording good.

- reader 1 (yes): A `mark` record is data, not a widget, so it has no events such as @click. | fix:     mark at=2  (remove the @click line) | confusing: 
- reader 2 (partly): A mark record holds only data, so it cannot have an event such as @click. The block also uses n, which is not declared. | fix: mark at=2 (remove the @click line) | confusing: "A mark record has no events" — I do not know the difference between a record and a widget.
- reader 3 (yes): A mark record is data, not a widget, so it has no events. | fix: mark at=2 | confusing: The '@click set n=1' event is removed, but 'n' is not defined in this block, so the event may have been meant for another element.

## E081 `mkp.duplicate-prop` error at `packages/core/src/check/def.ts:1063`

message: title is set twice

block:
```
# Entries

```mkp
part entry "One entry."
  in title text
  text title

entries "An entry."
  column
    entry title="One"
      title "Two"
  project md = "Entries."
```

```entries
summary: An entry.
```
```

builder: Needed a prop line (bare input name as a child) plus key=value on the same use. Reported at the widget use, not the second setting, so the author must find which of the two is the duplicate.

- reader 1 (yes): `title` is set in the entry call and again on a prop line under it. | fix:     entry
      title "Two"  (remove title="One") | confusing: 
- reader 2 (yes): title is set twice in the same entry, once in the call and once as a prop line. | fix: Delete the 'title "Two"' line. | confusing: 
- reader 3 (yes): 'title' is set in two places: as 'title="One"' on the entry line and again as 'title "Two"'. | fix: Delete the line 'title "Two"'. | confusing: 

## E082 `mkp.unknown-prop` error at `packages/core/src/check/def.ts:1071`

message: entry has no input, record or slot named "text"

block:
```
# Entries

```mkp
part entry "One entry."
  in title text
  text title

entries "An entry."
  column
    entry title="One"
      text "more"
  project md = "Entries."
```

```entries
summary: An entry.
```
```

builder: Triggered by putting a child element under a widget with no slot. The error says 'unknown-prop' and talks about an input named "text", which is misleading: the author meant to add content, not set a prop. Suggests no fix, e.g. add 'in body slot'.

- reader 1 (partly): The `entry` part has no input, record field or slot called `text`, but the call gives it a child line `text "more"`. | fix: Remove the child `text "more"` line, or add `  in body slot` and `  slot body` to the entry definition and fill it. | confusing: The child line is treated as an argument named `text`, which is not what I expected from the indentation.
- reader 2 (yes): entry has no text input, so text "more" cannot be placed under it. | fix: Delete the 'text "more"' line. | confusing: 
- reader 3 (yes): The entry has no input named 'text' for its child line, so the 'text "more"' line has nowhere to go. | fix: Delete the line 'text "more"'. | confusing: 

## E083 `mkp.check` error at `packages/core/src/check/def.ts:1077`

message: fill takes a slot name

block:
```
# Panels

```mkp
part panel "A panel with a side note."
  in body slot
  in aside slot
  row
    column
      slot body
    column
      slot aside

page "A page."
  panel
    text "main"
    fill 3
      text "side"
  project md = "Page."
```

```page
summary: A page.
```
```

builder: Easy: a number after fill. Generic mkp.check code.

- reader 1 (yes): `fill` takes a slot name, such as `aside`, not a number. | fix:     fill aside | confusing: 
- reader 2 (yes): fill must name a slot, such as aside. The block gives 3, which is a number. | fix: fill aside | confusing: 
- reader 3 (yes): fill takes a slot name such as body or aside, not a number. | fix: fill aside | confusing: 

## E084 `mkp.unknown-slot` error at `packages/core/src/check/def.ts:1078`

message: panel has no slot "sidebar"

block:
```
# Panels

```mkp
part panel "A panel with a side note."
  in body slot
  in aside slot
  row
    column
      slot body
    column
      slot aside

page "A page."
  panel
    text "main"
    fill sidebar
      text "side"
  project md = "Page."
```

```page
summary: A page.
```
```

builder: Easy. didYouMean did not suggest anything for 'sidebar' vs body/aside (reasonably). Message good.

- reader 1 (yes): The panel has slots `body` and `aside` only, so `sidebar` is not a slot. | fix:     fill aside | confusing: 
- reader 2 (yes): panel has no slot named sidebar. Its slots are body and aside. | fix: fill aside | confusing: 
- reader 3 (yes): The panel has no slot named 'sidebar'. Its only slots are 'body' and 'aside'. | fix:     fill aside | confusing: 

## E085 `mkp.check` error at `packages/core/src/check/def.ts:1079`

message: body is the first slot; its lines need no fill

block:
```
# Panels

```mkp
part panel "A panel with a side note."
  in body slot
  in aside slot
  row
    column
      slot body
    column
      slot aside

page "A page."
  panel
    fill body
      text "main"
    fill aside
      text "side"
  project md = "Page."
```

```page
summary: A page.
```
```

builder: Natural slip, since overlay and frame use 'fill body'. Message is clear. Generic mkp.check code although a dedicated one would help.

- reader 1 (yes): The first slot (`body`) takes its lines directly, so the `fill body` wrapper is not needed. `aside` is a later slot and still needs `fill`. | fix:     panel
      text "main"
      fill aside
        text "side" | confusing: 
- reader 2 (yes): body is the first slot, so its lines need no fill wrapper. | fix: panel
    text "main"
    fill aside
      text "side" | confusing: 
- reader 3 (yes): 'body' is the first slot, so its content is written directly, with no 'fill' line. | fix:     text "main" | confusing: 

## E086 `mkp.missing-input` error at `packages/core/src/check/def.ts:1085`

message: panel needs title: text

block:
```
# Panels

```mkp
part panel "A panel with a title."
  in title text
  in body slot
  column
    text title weight=bold
    slot body

page "A page."
  panel
    text "main"
  project md = "Page."
```

```page
summary: A page.
```
```

builder: Easy. Position is the widget use; message says what type is expected. Good.

- reader 1 (yes): The part requires a `title` text input, and the page does not give one. | fix:   panel title="Notes" | confusing: 
- reader 2 (partly): panel requires a title: input, and the page's panel call does not pass one. | fix: panel title="Main" | confusing: The message does not say which value to pass; I chose a title from the text.
- reader 3 (yes): The panel needs a title of type text, and the block does not supply one. | fix: panel title="Notes" | confusing: 

## E087 `mkp.unknown-event` error at `packages/core/src/check/def.ts:1092`

message: panel raises no "opened" event; it raises closed

block:
```
# Panels

```mkp
part panel "A panel with a title."
  in title text = "Untitled"
  out closed
  in body slot
  column
    text title weight=bold
    slot body

page "A page."
  panel
    @opened emit closed
    text "main"
  project md = "Page."
```

```page
summary: A page.
```
```

builder: I first had no 'out' declared and hit the other branch only with outs; this is the branch listing what it raises. The event name '@opened' is natural to guess. Note the 'out closed' in the definition is only reachable by name.

- reader 1 (yes): The panel raises `closed`, not `opened`. The handler needs `@closed` or the event must be named correctly. | fix:     @closed emit closed | confusing: The message says 'it raises closed', so I am assuming the `@opened` line should listen for the event that is raised.
- reader 2 (partly): panel raises a closed event but no opened event, so @opened has nothing to listen to. | fix: @closed emit closed | confusing: I do not know what a bare 'emit closed' does, so the fix may not be what was meant.
- reader 3 (yes): The panel raises 'closed', not 'opened', so the handler '@opened' can never fire. | fix:     @closed emit closed | confusing: Emitting 'closed' on 'closed' looks circular, so the intent may be different.

## E088 `mkp.unknown-event` error at `packages/core/src/check/def.ts:1092`

message: panel raises no "opened" event

block:
```
# Panels

```mkp
part panel "A panel with a title."
  in title text = "Untitled"
  in body slot
  column
    text title weight=bold
    slot body

page "A page."
  panel
    @opened set x=1
    text "main"
  project md = "Page."
```

```page
summary: A page.
```
```

builder: This branch (the widget has no out at all) prints a shorter message without the list. Same ease as the other branch.

- reader 1 (yes): The `panel` widget does not raise an `opened` event, so an `@opened` handler has nothing to listen to. | fix: Remove the `@opened set x=1` line from the page. | confusing: 
- reader 2 (yes): panel raises no opened event, so @opened has nothing to handle. | fix: Delete the '@opened set x=1' line. | confusing: 
- reader 3 (yes): The panel raises no 'opened' event, so '@opened' cannot be used. | fix: Remove the line '@opened set x=1' or use an event the panel declares, such as 'closed'. | confusing: 

## E089 `mkp.unknown-widget` error at `packages/core/src/check/def.ts:1121`

message: there is no widget or part "counter"

block:
```
# Tally

```mkp
tally "A tally."
  column
    counter
  project md = "Tally."
```

```tally
summary: A tally.
```
```

builder: Easy. No did-you-mean appeared for 'counter' since the document defines nothing similar; the list of available widgets is not offered.

- reader 1 (yes): There is no widget or part called `counter` in scope. | fix: Use an existing widget name, or define `counter` first; the block does not show one. | confusing: 
- reader 2 (yes): There is no widget named counter in this document, so the name must be changed or the widget defined. | fix: cannot infer (use an existing widget such as text, or define counter) | confusing: 
- reader 3 (yes): There is no widget or part called counter in the given files. | fix: cannot infer | confusing: I do not know which widget should be used in place of counter.

## E090 `mkp.extra-arg` error at `packages/core/src/check/def.ts:1203`

message: unexpected value "One" for entry (it takes no positional values)

block:
```
# Entries

```mkp
part entry "One entry."
  in title text
  in note text = ""
  text title

entries "Entries."
  column
    entry "One" "Two" note="Three"
  project md = "Entries."
```

```entries
summary: Entries.
```
```

builder: Easy to hit with a part that declares no 'fields' line. The hint '(it takes no positional values)' is useful, but it does not say how to fix it (use key=value).

- reader 1 (yes): `entry` takes no positional values, and the call gives two bare strings. | fix:     entry title="One" note="Three" | confusing: 
- reader 2 (yes): entry takes no positional values, so "One" and "Two" are unexpected. Values must be named. | fix: entry title="One" note="Three" | confusing: 
- reader 3 (yes): The entry takes no positional values, so "One" and "Two" are not allowed as bare values. They have to be named properties. | fix: entry title="One" note="Three" | confusing: 

## E091 `mkp.unknown-prop` error at `packages/core/src/check/def.ts:1155`

message: entry has no prop "tone"

block:
```
# Entries

```mkp
part entry "One entry."
  in title text
  in note text = ""
  text title

entries "Entries."
  column
    entry title="One" tone=muted
  project md = "Entries."
```

```entries
summary: Entries.
```
```

builder: Easy: key=value with a name the widget lacks. Message differs from the sibling unknown-prop for children ('has no input, record or slot named'), same code. No suggestion given here because nothing is close.

- reader 1 (yes): The `entry` part has no `tone` prop, so `tone=muted` is an unknown argument. | fix:   entry title="One"  (remove tone=muted), or add `  in tone color = none` to the part. | confusing: 
- reader 2 (yes): entry has no tone prop. | fix: entry title="One" | confusing: 
- reader 3 (yes): The entry has no 'tone' property. Only title and note are declared. | fix: entry title="One" | confusing: 

## E092 `mkp.duplicate-prop` error at `packages/core/src/check/def.ts:1144`

message: caps is set twice

block:
```
# Notes

```mkp
notes "Notes."
  column
    text "One" caps caps
  project md = "Notes."
```

```notes
summary: Notes.
```
```

builder: Needed to repeat a flag word. Very artificial for an author; real triggers are e.g. 'wrap wrap=false'. Message points at the second occurrence, fine.

- reader 1 (yes): `caps` is given twice on the same line. | fix:     text "One" caps | confusing: 
- reader 2 (yes): caps is given twice on the same text line. | fix: text "One" caps | confusing: 
- reader 3 (yes): caps is set twice on the same text line. | fix: text "One" caps | confusing: 

## E093 `mkp.ambiguous-arg` error at `packages/core/src/check/def.ts:1171`

message: "small" is an option of size and weight; write size=small

block:
```
# Tags

```mkp
part tag "A tag."
  in label text
  in size choice(small|large) = small
  in weight choice(small|bold) = bold
  text label

tags "Tags."
  row
    tag label="new" small
  project md = "Tags."
```

```tags
summary: Tags.
```
```

builder: Needed two choice inputs sharing an option word, which is a plausible clash (small in size and weight). Message names both props and the fix. Good.

- reader 1 (yes): `small` is an option of `size`, so it must be written as `size=small`. | fix:     tag label="new" size=small | confusing: 
- reader 2 (yes): small is an option of size, so it must be given as size=small, not as a bare word. | fix: tag label="new" size=small | confusing: 
- reader 3 (yes): 'small' is an option of size and of weight, so it must be written as a key=value pair, not as a bare word. | fix: tag label="new" size=small | confusing: 

## E094 `mkp.ambiguous-arg` error at `packages/core/src/check/def.ts:1178`

message: "ok" is a token for back and edge; write back=ok

block:
```
# Tags

```mkp
part tag "A tag."
  in label text
  in back color = none
  in edge color = none
  row stroke=edge tint=back
    text label

tags "Tags."
  row
    tag label="new" ok
  project md = "Tags."
```

```tags
summary: Tags.
```
```

builder: Two color inputs on one part; any bare colour word then clashes. Message good, but the author may not realise bare token words fill style props at all.

- reader 1 (yes): A bare `ok` is a colour value, but it is not a named prop. It must be given to a named prop like `back=` or `edge=`. | fix:     tag label="new" back=ok | confusing: 
- reader 2 (yes): ok is a colour token for the back or edge, and the option must be named. | fix: tag label="new" back=ok | confusing: 
- reader 3 (yes): 'ok' is a colour token, and it is passed bare where the tag expects 'back=ok'. | fix: tag label="new" back=ok | confusing: The message says 'back and edge', but the block does not say which one, so I picked back.

## E095 `mkp.ambiguous-arg` error at `packages/core/src/check/def.ts:1181`

message: "hidden" is ambiguous here; use key=value

block:
```
# Panels

```mkp
part panel "A panel."
  in label text
  in state choice(hidden|shown) = shown
  text label

panels "Panels."
  column
    panel label="Notes" hidden
  project md = "Panels."
```

```panels
summary: Panels.
```
```

builder: Hard to guess: needs an option named like a meta flag (hidden). Message is vague compared to its siblings: it does not say what the word collides with (the hidden flag vs the state option).

- reader 1 (partly): `hidden` on its own is ambiguous, because it is also a state option. The prop must be written as key=value. | fix:     panel label="Notes" state=hidden | confusing: I don't know whether a bare option word is allowed in other places.
- reader 2 (yes): A bare word 'hidden' is ambiguous, so the option must be written as state=hidden. | fix: panel label="Notes" state=hidden | confusing: 
- reader 3 (partly): 'hidden' is ambiguous because it is both an option of the state choice and a bare word, so it must be written as key=value. | fix: panel label="Notes" state=hidden | confusing: The message only says 'use key=value', so I am not sure of the exact key name. 'state' is taken from the declared input name.

## E096 `mkp.ambiguous-arg` error at `packages/core/src/check/def.ts:1188`

message: "small" matches more than one rule (a size option, a name in scope); write key=value

block:
```
# Tags

```mkp
part tag "A tag."
  in label text
  in size choice(small|large) = small
  text label

tags "Tags."
  in small bool = false
  row
    tag label="new" small
  project md = "Tags."
```

```tags
summary: Tags.
```
```

builder: Needed a bare option word that is also a name in scope (an input named like the option). The message lists the rules ('a size option, a name in scope') which helps; the second input being a bool named small was my construction.

- reader 1 (yes): `small` could be read as the size option or as the bool named `small` in scope, so the call is ambiguous. | fix:     tag label="new" size=small | confusing: 
- reader 2 (yes): The bare word small matches both the size option and a bool named small. Writing key=value removes the ambiguity. | fix: tag label="new" size=small | confusing: 
- reader 3 (yes): 'small' could mean the size option or the variable 'small' in scope, so the bare word is ambiguous. Writing key=value removes the ambiguity. | fix: tag label="new" size=small | confusing: 

## E097 `mkp.check` error at `packages/core/src/check/def.ts:1217`

message: id takes a name or (an expression)

block:
```
# Tally

```mkp
tally "A tally."
  in n int = 2
  column
    text "n" id=1..3
    text "m" if=1..3
  project md = "Tally."
```

```tally
summary: A tally.
```
```

builder: Hard to reach naturally: id=1..3 (a range) is the only non-expression value I found. The message does not say what was wrong with the range; an author is far more likely to write id=3 (a number), which is accepted without complaint.

- reader 1 (yes): `id=` takes a name or an expression in brackets, not a range. | fix:     text "n" id=tn | confusing: The `if=1..3` on the next line is also a range, so it will probably fail the same way; the message doesn't mention it.
- reader 2 (partly): id takes a name or an expression in brackets, and 1..3 is neither. if= also takes a boolean, not a range. | fix: text "n" id=n
    text "m" if=(n > 1) | confusing: The id fix uses n as the name, which I guessed.
- reader 3 (partly): The 'id' takes a name or an expression, and '1..3' is neither. | fix: text "n" id=first | confusing: The 'if=1..3' on the next line has the same kind of problem, which the message does not mention.

## E098 `mkp.check` error at `packages/core/src/check/def.ts:1221`

message: if takes a boolean expression

block:
```
# Tally

```mkp
tally "A tally."
  in n int = 2
  column
    text "n" id=1..3
    text "m" if=1..3
  project md = "Tally."
```

```tally
summary: A tally.
```
```

builder: Same trick as the id one: a range as the value of if=. Unnatural; the typical mistake (if=n>1 without parentheses) probably gives a different error.

- reader 1 (yes): `if=` takes a boolean expression, but the range 1..3 is not one. | fix:     text "m" if=(n > 1) | confusing: 
- reader 2 (yes): if= needs a boolean expression. The block gives the range 1..3. | fix: text "m" if=(n > 1) | confusing: The id=1..3 line is not reported, so I cannot tell whether id takes a range.
- reader 3 (yes): 'if' takes a boolean expression, and '1..3' is a range. | fix: text "m" if=(n > 1) | confusing: The id=1..3 on the first text line has the same problem, which the message does not mention.

## E099 `mkp.check` error at `packages/core/src/check/def.ts:1223`

message: if needs a boolean; found int

block:
```
# Tally

```mkp
tally "A tally."
  in n int = 2
  column
    text "n" if=(n + 1)
  project md = "Tally."
```

```tally
summary: A tally.
```
```

builder: Easy: if=(n + 1). Message names the found type. Generic mkp.check code rather than mkp.input-type, unlike other type mismatches.

- reader 1 (yes): `if=` needs a boolean, and `n + 1` is an int. | fix:     text "n" if=(n > 1) | confusing: 
- reader 2 (yes): if takes a boolean. n + 1 is an int. | fix: text "n" if=(n > 1) | confusing: 
- reader 3 (yes): 'if' needs a boolean, and (n + 1) is an int. | fix: text "n" if=(n > 1) | confusing: 

## E100 `mkp.check` error at `packages/core/src/check/def.ts:1253`

message: expected "each x in list [key=expr]" or "each x in a..b"

block:
```
# List

```mkp
tally "A tally."
  in names list(text)
  column
    each names
      text "n"
  project md = "Tally."
```

```tally
names: [a]
summary: A tally.
```
```

builder: Easy: leave out the loop variable and 'in'. Message gives both valid forms. Good.

- reader 1 (yes): A list loop needs the form `each x in list`, with the variable name before `in`. The block gives `each names` with no variable. | fix:     each name in names
      text name | confusing: 
- reader 2 (yes): each needs the form 'each x in list key=…'. The block gives 'each names' with no loop variable. | fix: each n in names key=n | confusing: 
- reader 3 (yes): An each loop must name its variable and its source, such as 'each x in names'. The line gives only 'names'. | fix: each n in names key=n | confusing: 

## E101 `mkp.check` error at `packages/core/src/check/def.ts:1268`

message: each needs a list or a range; found text

block:
```
# List

```mkp
tally "A tally."
  in names text = "abc"
  column
    each n in names key=n
      text n
  project md = "Tally."
```

```tally
summary: A tally.
```
```

builder: Easy: each over a text input. Message names the found type. Good.

- reader 1 (yes): `each` needs a list or a range, but `names` is a text value. | fix:   in names list(text) = ["abc"] | confusing: 
- reader 2 (yes): each loops over a list or a range, but names is text. | fix: in names list(text) = ["a", "b", "c"] | confusing: 
- reader 3 (yes): each needs a list or a range, and 'names' is text. | fix: each n in names key=n | confusing: The names input is text, so I can't tell whether the author meant to make it a list, or to iterate its characters.

## E102 `mkp.enum` error at `packages/core/src/check/def.ts:1236`

message: self takes start, center, end or stretch

block:
```
# Tally

```mkp
tally "A tally."
  in n int = 2
  row
    text "n" self=(if(n > 1, start, end))
  project md = "Tally."
```

```tally
summary: A tally.
```
```

builder: Needed a computed self=(...) value; a literal like self=middle is rejected earlier by the generic enum check with a different message ('it takes one of start, center, end, stretch; found middle'). So there are two enum messages for the same mistake depending on whether the value is literal. The message here does not say what was found.

- reader 1 (yes): `self=` takes start, center, end or stretch. `if(...)` returns one of these, but the list of allowed values includes `end` and not all work here. | fix:     text "n" self=start  (if n > 1 is needed, use a fixed value) | confusing: The message says 'start, center, end or stretch', and the block gives start and end, which are both listed. I'm not sure why this is rejected.
- reader 2 (partly): self takes a fixed word, one of start, center, end or stretch. The block gives an if expression. | fix: text "n" self=end | confusing: I cannot tell whether a conditional is allowed for self at all, so the fix drops the condition.
- reader 3 (partly): 'self' takes a fixed word, but the value here is an 'if' expression, not one of the words. | fix: text "n" self=start | confusing: The message lists 'end' as valid, and 'end' is in the expression, so I do not see why the expression fails. I am not sure the fix is the only cause.

## E103 `mkp.check` error at `packages/core/src/check/def.ts:1280`

message: each takes only key=expr after its list

block:
```
# Tally

```mkp
tally "A tally."
  in n int = 2
  column
    each k in 0..(n) key=k extra=1
      text "n"
  project md = "Tally."
```

```tally
summary: A tally.
```
```

builder: Easy. Message says what is allowed but not what the offending word was.

- reader 1 (yes): After the list, `each` accepts only `key=expr`. The `extra=1` is not allowed. | fix:     each k in 0..(n) key=k | confusing: 
- reader 2 (yes): each takes only key=expression after its list, and extra=1 is not allowed. | fix: each k in 0..(n) key=k | confusing: 
- reader 3 (yes): After the list, 'each' takes only 'key=expr'. The 'extra=1' is not allowed. | fix: each k in 0..(n) key=k | confusing: 

## E104 `mkp.each-unkeyed` warning at `packages/core/src/check/def.ts:1282`

message: each over a list without key= uses the index as identity, so items lose their state when the list changes; add key=… with a unique value of n

block:
```
# Tally

```mkp
tally "A tally."
  in names list(text) = ["a", "b"]
  column
    each n in names
      text n
  project md = "Tally."
```

```tally
summary: A tally.
```
```

builder: Trivial: forget key=. It is a warning, and the only one that every plain each over a list triggers, so authors will meet it constantly. Message is long but actionable (it names the variable to build the key from).

- reader 1 (yes): A list loop without `key=` uses the position as identity, so items keep the wrong state when the list changes. | fix:     each n in names key=n | confusing: 
- reader 2 (yes): each over a list needs key= so each item keeps its identity when the list changes. | fix: each n in names key=n | confusing: 
- reader 3 (yes): An each over a list without key= uses the index as identity, so items lose their state when the list changes. | fix: each n in names key=n | confusing: 

## E105 `mkp.check` error at `packages/core/src/check/def.ts:1283`

message: each has no events

block:
```
# Tally

```mkp
tally "A tally."
  in names list(text) = ["a", "b"]
  column
    each n in names key=n
      text n
      @click set x=1
  project md = "Tally."
```

```tally
summary: A tally.
```
```

builder: Easy. Note the unknown name x in the event was not reported; the event error came first.

- reader 1 (yes): An `each` loop can't take an event line. Events belong on the elements inside it. | fix:       text n
      @click set x=1  (move the @click under the text element, not the loop) | confusing: 
- reader 2 (yes): each has no events. The @click line is under it, and x is not defined anyway. | fix: Delete the '@click set x=1' line. | confusing: 
- reader 3 (yes): The '@click' line is at the same level as 'each', not under the element it handles, so 'each' gets an event it cannot have. | fix:     each n in names key=n
      text n
        @click set x=1 | confusing: 

## E106 `mkp.check` error at `packages/core/src/check/def.ts:1292`

message: a prop line cannot be repeated or chosen; use if(…) in its value

block:
```
# Rulers

```mkp
ruler "Marks along a line."
  in title text = ""
  in marks list(record mark {at: int})
  column
    text title
    each m in marks key=m.at
      text "mark \val{m.at}"
  project md = "Marks."

shelf "A shelf."
  in ids list(int) = [1, 2]
  ruler
    each k in ids key=k
      title "Marks"
      mark at=k
  project md = "Shelf."
```

```shelf
summary: A shelf.
```
```

builder: Hard: needs a widget use with a record child and a prop line together inside an each. The reported position is line 0, column 0 (the prop line's position is lost), so the author cannot find it. The wording 'repeated or chosen' is cryptic.

- reader 1 (partly): A prop line such as `title "Marks"` is placed inside the `each` loop, so it is repeated and can't be chosen per item. Props belong on the widget line, or are chosen with `if(...)` in the value. | fix: Move the title out of the loop: `  ruler title="Marks"` above `each k in ids key=k`, and keep only `mark at=k` inside the loop. | confusing: The message mentions both 'repeated' and 'chosen', and I'm not sure which applies here.
- reader 2 (partly): A prop line such as title cannot be repeated for each item. Choosing it per item needs if() in its value. | fix: Remove the 'title "Marks"' line, and give title on the ruler instead. | confusing: I cannot tell how to set a ruler's title from inside the each loop.
- reader 3 (partly): A prop line such as 'title "Marks"' cannot be repeated or chosen per item. The value must use if(...) instead. | fix: Set the title once, for example 'title="Marks"' on the ruler, or write it as a prop with if(...) in its value. | confusing: I do not know what 'chosen' means here, so my fix may not match what the author wanted.

## E107 `mkp.check` error at `packages/core/src/check/def.ts:1299`

message: expected "switch on=expr"

block:
```
# Tally

```mkp
tally "A tally."
  in n int = 2
  column
    switch n
      case 1
        text "one"
  project md = "Tally."
```

```tally
summary: A tally.
```
```

builder: Easy: write 'switch n' instead of 'switch on=n'. The message shows the right form. Good.

- reader 1 (yes): `switch` needs the `on=` keyword before its value. | fix:     switch on=n | confusing: 
- reader 2 (yes): switch takes on=expression, not a bare expression. | fix: switch on=n | confusing: 
- reader 3 (yes): switch needs 'on=' before its value, and 'n' is given bare. | fix: switch on=n | confusing: 

## E108 `mkp.check` error at `packages/core/src/check/def.ts:1306`

message: case takes one value

block:
```
# Tally

```mkp
tally "A tally."
  in n int = 2
  column
    switch on=n
      case 1 2
        text "one"
  project md = "Tally."
```

```tally
summary: A tally.
```
```

builder: Easy: two values on a case. Message does not hint that separate case lines are the way to list several.

- reader 1 (yes): `case` takes one value, and `case 1 2` gives two. | fix:       case 1 | confusing: 
- reader 2 (yes): case takes one value. '1 2' gives it two. | fix: case 1 | confusing: 
- reader 3 (yes): 'case' takes a single value, but 'case 1 2' gives two. | fix: case 1
        text "one"
      case 2 | confusing: 

## E109 `mkp.case-unreachable` warning at `packages/core/src/check/def.ts:1309`

message: this case repeats an earlier one and can never be chosen

block:
```
# Tally

```mkp
tally "A tally."
  in n int = 2
  column
    switch on=n
      case 3
        text "three"
      case 3
        text "again"
  project md = "Tally."
```

```tally
summary: A tally.
```
```

builder: Easy: repeat a case. Warning only; position is the repeated case, message good. Does not say which earlier line.

- reader 1 (yes): The second `case 3` can never be reached, because the first `case 3` already matches. | fix:       case 4
        text "again" | confusing: 
- reader 2 (yes): The second case 3 can never match, because the first one already did. | fix: case 4 | confusing: 
- reader 3 (yes): The second 'case 3' repeats the first, so it can never be picked. | fix: Change the second case to a different value, such as 'case 4'. | confusing: 

## E110 `mkp.check` error at `packages/core/src/check/def.ts:1318`

message: switch has one else

block:
```
# Tally

```mkp
tally "A tally."
  in n int = 2
  column
    switch on=n
      else
        text "other"
      else
        text "more"
  project md = "Tally."
```

```tally
summary: A tally.
```
```

builder: Easy. Generic code.

- reader 1 (yes): A `switch` can have only one `else`. | fix: Delete the second `else` and its text, or merge the two into one branch. | confusing: 
- reader 2 (yes): A switch may have only one else branch. The block has two. | fix: Delete the second 'else' and its 'text "more"' line. | confusing: 
- reader 3 (yes): A switch can have only one else branch, and this one has two. | fix: else
        text "other" | confusing: I removed the second else and its text 'more'. The author may have wanted that text as a separate case.

## E111 `mkp.check` error at `packages/core/src/check/def.ts:1323`

message: under switch, only case and else; found "text"

block:
```
# Tally

```mkp
tally "A tally."
  in n int = 2
  column
    switch on=n
      case 1
        text "one"
      text "stray"
  project md = "Tally."
```

```tally
summary: A tally.
```
```

builder: Easy: a stray line under switch. Message names the head found.

- reader 1 (yes): Under a `switch`, only `case` and `else` may appear. The `text "stray"` line is not allowed. | fix: Delete the `text "stray"` line, or put it under an `else`. | confusing: 
- reader 2 (yes): Under switch, only case and else lines are allowed. The 'text "stray"' line is in the wrong place. | fix: Move 'text "stray"' under the case 1 line, or delete it. | confusing: 
- reader 3 (yes): Inside a switch only 'case' and 'else' lines are allowed. The 'text "stray"' line is not in either. | fix: Move 'text "stray"' under an 'else' line, for example: 'else' then indented 'text "stray"'. | confusing: 

## E112 `mkp.unknown-prop` error at `packages/core/src/check/def.ts:1346`

message: arrow takes from=id to=id, an optional "label", via=(ids), route=down|right, curve, tone=, line=, head=, tail=, dim=, bold=, layer= and opacity=

block:
```
# Flow

```mkp
flow "Two boxes and a line."
  row gap=l
    column id=a pad=s stroke=line
      text "first"
    column id=b pad=s stroke=line
      text "second"
    arrow from=a to=b colour=ok
  project md = "Two boxes."
```

```flow
summary: Two boxes.
```
```

builder: Easy: misspell a prop (colour). The message lists every legal arrow prop but does not say which one I got wrong; it reads as a generic usage line, and did-you-mean is absent although tone= is close in meaning.

- reader 1 (yes): `arrow` does not take `colour=`. The colour prop is `tone=`. | fix:     arrow from=a to=b tone=ok | confusing: 
- reader 2 (yes): arrow has no colour= setting. Its colour is set with tone=. | fix: arrow from=a to=b tone=ok | confusing: 
- reader 3 (yes): 'colour=' is not a valid option of arrow. The list shows 'tone=' for colours. | fix: arrow from=a to=b tone=ok | confusing: 

## E113 `mkp.check` error at `packages/core/src/check/def.ts:1348`

message: arrow needs from=id and to=id

block:
```
# Flow

```mkp
flow "Two boxes and a line."
  row gap=l
    column id=a pad=s stroke=line
      text "first"
    column id=b pad=s stroke=line
      text "second"
    arrow from=a
  project md = "Two boxes."
```

```flow
summary: Two boxes.
```
```

builder: Easy: leave out to=. Message does not say which of the two is missing.

- reader 1 (yes): `arrow` needs both ends: from=id and to=id. | fix:     arrow from=a to=b | confusing: 
- reader 2 (yes): arrow must name both ends with from= and to=. The block gives only from=a. | fix: arrow from=a to=b | confusing: 
- reader 3 (yes): arrow needs both from= and to=, and the line gives only from. | fix: arrow from=a to=b | confusing: 

## E114 `mkp.check` error at `packages/core/src/check/def.ts:1354`

message: an id is a name or (an expression)

block:
```
# Flow

```mkp
flow "Two boxes and a line."
  row gap=l
    column id=a pad=s stroke=line
      text "first"
    column id=b pad=s stroke=line
      text "second"
    arrow from=1..2 to=b
  project md = "Two boxes."
```

```flow
summary: Two boxes.
```
```

builder: Unnatural: only a range value reaches it. Same wording as the id=1..3 case, but here for from=/to=.

- reader 1 (yes): `from=` takes an id name or an expression in brackets, and `1..2` is a range. | fix:     arrow from=a to=b | confusing: 
- reader 2 (yes): An id is a name or an expression in brackets, and 1..2 is neither. | fix: arrow from=a to=b | confusing: 
- reader 3 (yes): The value of 'from' must be a name or an expression, and '1..2' is neither. | fix:     arrow from=a to=b | confusing: The message mentions 'an id', but the bad value is in 'from=', so the message is about a different argument than the one named.

## E115 `mkp.unknown-out` error at `packages/core/src/check/def.ts:1433`

message: counter declares no out "finished"

block:
```
# Counter

```mkp
counter "A counter."
  var n int = 0
  var done bool = false
  column
    press
      text "go"
      @click set n=(n + 1)
      @click emit finished
  project md = "Counter."
```

```counter
summary: A counter.
```
```

builder: Easy. The message does not list the outs that exist, and does not hint at the 'out name {payload}' declaration.

- reader 1 (yes): `emit finished` names an event `out` that the counter never declares. Only `answered` is declared. | fix:       @click emit answered correct=(n > 0)  (or declare `out finished` in the definition, but I can't infer its exact syntax) | confusing: 
- reader 2 (yes): emit names an out event, and the counter declares no out called finished. | fix: Delete the '@click emit finished' line, or declare 'out finished' first. | confusing: 
- reader 3 (yes): The counter declares no 'out' called 'finished', so it cannot emit it. | fix: Declare it with 'out finished' in the counter, or emit an out that exists. | confusing: 

## E116 `mkp.check` error at `packages/core/src/check/def.ts:1395`

message: set takes name=expr …

block:
```
# Counter

```mkp
counter "A counter."
  var n int = 0
  var done bool = false
  column
    press
      text "go"
      @click set n
  project md = "Counter."
```

```counter
summary: A counter.
```
```

builder: Easy: set n instead of set n=value. Appears also for bare 'set'. Message uses a literal ellipsis.

- reader 1 (yes): `set` needs name=expr, not a bare name. | fix:       @click set n=(n + 1) | confusing: 
- reader 2 (yes): set needs name=expression. The block gives 'set n' with no value. | fix: @click set n=n + 1 | confusing: 
- reader 3 (yes): set takes name=expr pairs, and 'n' is given with no value. | fix: @click set n=(n + 1) | confusing: 

## E117 `mkp.check` error at `packages/core/src/check/def.ts:1392`

message: reset takes names here

block:
```
# Counter

```mkp
counter "A counter."
  var n int = 0
  level = slider 1..5 step=1 = 2 "level"
  out answered {correct: bool}
  signal seen {page: int}
  column
    press
      text "go"
      @click reset 1
    column id=extra hidden
      text "more"
    overlay mode=popover label="help" id=help
      text "?"
      fill body
        text "Help."

  project md = "Counter."
```

```counter
summary: A counter.
```
```

builder: Easy: reset with a number. Message does not name the offending argument.

- reader 1 (partly): `reset` takes names, which are state or control names, but `1` is a number. | fix:       @click reset n | confusing: The message says 'reset takes names here', but I don't know which names are valid for reset.
- reader 2 (partly): reset takes a name here, and the block gives the number 1. | fix: @click reset level | confusing: I am assuming 'level' is the slider name, as in the other errors.
- reader 3 (yes): 'reset' takes the name of a state variable, and '1' is a number. | fix:       @click reset n | confusing: 

## E118 `mkp.extra-arg` error at `packages/core/src/check/def.ts:1401`

message: play takes exactly one slider or steps name

block:
```
# Counter

```mkp
counter "A counter."
  var n int = 0
  level = slider 1..5 step=1 = 2 "level"
  out answered {correct: bool}
  signal seen {page: int}
  column
    press
      text "go"
      @click play level n
    column id=extra hidden
      text "more"
    overlay mode=popover label="help" id=help
      text "?"
      fill body
        text "Help."

  project md = "Counter."
```

```counter
summary: A counter.
```
```

builder: Easy. Uses mkp.extra-arg, a code otherwise about positional props.

- reader 1 (yes): `play` takes exactly one name, a slider or steps control. The block gives two names, `level n`. | fix:       @click play level | confusing: 
- reader 2 (yes): play takes exactly one slider or steps name. The block gives two names. | fix: @click play level | confusing: 
- reader 3 (yes): play takes exactly one slider or steps name, and the line gives two (level and n). | fix: @click play level | confusing: 

## E119 `mkp.not-playable` error at `packages/core/src/check/def.ts:1404`

message: "n" is not a slider, steps or clock of this definition

block:
```
# Counter

```mkp
counter "A counter."
  var n int = 0
  level = slider 1..5 step=1 = 2 "level"
  out answered {correct: bool}
  signal seen {page: int}
  column
    press
      text "go"
      @click play n
    column id=extra hidden
      text "more"
    overlay mode=popover label="help" id=help
      text "?"
      fill body
        text "Help."

  project md = "Counter."
```

```counter
summary: A counter.
```
```

builder: Easy: play on a var. Message lists what can be played; good.

- reader 1 (yes): `play` must name a slider, steps or clock. `n` is a plain var. | fix:       @click play level | confusing: 
- reader 2 (partly): play must name a slider, steps or clock. In the block it names n, which is a var. | fix: @click play level | confusing: I assumed 'level' is the slider, because it is the only slider in the definition.
- reader 3 (yes): play takes the name of a slider, steps or clock, and 'n' is a plain var. | fix: cannot infer | confusing: The counter has a slider named level. I do not know whether play was meant for level, and I cannot confirm that.

## E120 `mkp.not-state` error at `packages/core/src/check/def.ts:1409`

message: "total" is not state here

block:
```
# Counter

```mkp
counter "A counter."
  var n int = 0
  level = slider 1..5 step=1 = 2 "level"
  out answered {correct: bool}
  signal seen {page: int}
  column
    press
      text "go"
      @click reset total
    column id=extra hidden
      text "more"
    overlay mode=popover label="help" id=help
      text "?"
      fill body
        text "Help."

  project md = "Counter."
```

```counter
summary: A counter.
```
```

builder: Easy. 'state' is ambiguous for authors (vars, controls, ref inputs?). Compare the setOne message at line 1453 which explains: state, a var or a ref input.

- reader 1 (yes): `total` is not a state name in this counter, so it can't be reset. | fix:       @click reset n | confusing: 
- reader 2 (partly): reset needs a state name, and 'total' is not declared in the counter. | fix: @click reset level | confusing: Same uncertainty as E117: I am guessing 'level' is the right name.
- reader 3 (yes): 'total' is not a state variable in this widget, so it cannot be reset. | fix:       @click reset n | confusing: 

## E121 `mkp.check` error at `packages/core/src/check/def.ts:1417`

message: hide takes one id

block:
```
# Counter

```mkp
counter "A counter."
  var n int = 0
  level = slider 1..5 step=1 = 2 "level"
  out answered {correct: bool}
  signal seen {page: int}
  column
    press
      text "go"
      @click reveal extra hide
    column id=extra hidden
      text "more"
    overlay mode=popover label="help" id=help
      text "?"
      fill body
        text "Help."

  project md = "Counter."
```

```counter
summary: A counter.
```
```

builder: Surprise: 'reveal extra hide' on one line is read as two actions, so the message complains that the second action 'hide' has no id, not that I wrote one word too many. I was trying to give two ids.

- reader 1 (partly): `reveal` / `hide` takes exactly one id, and the line gives `extra hide` as if `hide` were a second id. | fix:       @click reveal extra   (if you meant to hide something, use `@click hide <id>` with one id) | confusing: I don't know whether `hide` is an action of its own, so I'm not sure what the author meant.
- reader 2 (yes): hide takes one id, and reveal does not take a second word. | fix: @click reveal extra
      @click hide help | confusing: I am not sure that 'hide help' is the right target.
- reader 3 (yes): hide takes one id, and the line gives 'extra' and 'hide' as two parts. | fix: @click reveal extra | confusing: The line has both reveal and hide, and the message only mentions hide, so I am not sure which one is meant.

## E122 `mkp.unknown-id` error at `packages/core/src/check/def.ts:1421`

message: there is no element with id=footer in counter

block:
```
# Counter

```mkp
counter "A counter."
  var n int = 0
  level = slider 1..5 step=1 = 2 "level"
  out answered {correct: bool}
  signal seen {page: int}
  column
    press
      text "go"
      @click reveal footer
    column id=extra hidden
      text "more"
    overlay mode=popover label="help" id=help
      text "?"
      fill body
        text "Help."

  project md = "Counter."
```

```counter
summary: A counter.
```
```

builder: Easy. The message names the definition but not that only static ids declared in this widget are seen.

- reader 1 (yes): No element in the counter has the id `footer`. | fix: Use an existing id such as `extra` or `help`, or add an element with id=footer. | confusing: 
- reader 2 (yes): reveal must name an element id that exists. There is no id=footer, but there is id=extra. | fix: @click reveal extra | confusing: 
- reader 3 (yes): There is no element with id footer in this counter. reveal can only refer to an id that exists. | fix: cannot infer | confusing: The counter has ids extra and help, but I do not know which was meant, so I cannot choose a replacement.

## E123 `mkp.not-overlay` error at `packages/core/src/check/def.ts:1422`

message: extra is not an overlay

block:
```
# Counter

```mkp
counter "A counter."
  var n int = 0
  level = slider 1..5 step=1 = 2 "level"
  out answered {correct: bool}
  signal seen {page: int}
  column
    press
      text "go"
      @click open extra
    column id=extra hidden
      text "more"
    overlay mode=popover label="help" id=help
      text "?"
      fill body
        text "Help."

  project md = "Counter."
```

```counter
summary: A counter.
```
```

builder: Easy: open a plain column.

- reader 1 (yes): `open` can only be used on an overlay, and `extra` is a plain column. | fix:       @click reveal extra  (or make `extra` an overlay, if it should open) | confusing: 
- reader 2 (yes): open must name an overlay. 'extra' is a column, not an overlay. | fix: @click open help | confusing: 
- reader 3 (yes): 'open' needs an overlay, and 'extra' is a plain column, not an overlay. | fix:       @click open help | confusing: 

## E124 `mkp.reveal-visible` warning at `packages/core/src/check/def.ts:1423`

message: help is not hidden, so reveal does nothing until it is hidden

block:
```
# Counter

```mkp
counter "A counter."
  var n int = 0
  level = slider 1..5 step=1 = 2 "level"
  out answered {correct: bool}
  signal seen {page: int}
  column
    press
      text "go"
      @click reveal help
    column id=extra hidden
      text "more"
    overlay mode=popover label="help" id=help
      text "?"
      fill body
        text "Help."

  project md = "Counter."
```

```counter
summary: A counter.
```
```

builder: Easy: reveal an element that has no hidden flag. A warning; the id it names is correct.

- reader 1 (yes): `reveal help` is used on an overlay that is not hidden, so there is nothing to reveal. | fix:     overlay mode=popover label="help" id=help hidden | confusing: 
- reader 2 (partly): reveal does nothing unless the target is hidden, and the help overlay is not hidden. | fix: overlay mode=popover label="help" id=help hidden=true | confusing: I do not know the form in which a widget starts hidden. hidden=true is a guess.
- reader 3 (yes): The overlay 'help' is not hidden to begin with, so 'reveal help' has no effect. | fix: Add 'hidden' to the overlay line, for example 'overlay mode=popover label="help" id=help hidden'. | confusing: 

## E125 `mkp.check` error at `packages/core/src/check/def.ts:1431`

message: emit takes a name

block:
```
# Counter

```mkp
counter "A counter."
  var n int = 0
  out answered {correct: bool, tries: int}
  signal seen {page: int}
  column
    press
      text "go"
      @click emit
  project md = "Counter."
```

```counter
summary: A counter.
```
```

builder: Easy: bare emit. Message does not mention declared outs.

- reader 1 (yes): `emit` needs the name of the event to send. | fix:       @click emit answered correct=true | confusing: 
- reader 2 (yes): emit must name an out event, such as answered, and give its fields. | fix: @click emit answered correct=true tries=1 | confusing: 
- reader 3 (yes): emit takes a name, and the line gives none. | fix: @click emit answered correct=true tries=1 | confusing: The example values are chosen by me, since the block does not give them.

## E126 `mkp.unknown-signal` error at `packages/core/src/check/def.ts:1434`

message: counter declares no signal "viewed"

block:
```
# Counter

```mkp
counter "A counter."
  var n int = 0
  out answered {correct: bool, tries: int}
  signal seen {page: int}
  column
    press
      text "go"
      @click send viewed page=1
  project md = "Counter."
```

```counter
summary: A counter.
```
```

builder: Easy. No did-you-mean for viewed/seen, and 'signal' vs 'out' distinction (send vs emit) has to be known.

- reader 1 (yes): The counter has no signal named `viewed`. The declared signal is `seen`. | fix:       @click send seen page=1 | confusing: 
- reader 2 (yes): counter declares no signal called viewed. Its signal is seen. | fix: @click send seen page=1 | confusing: 
- reader 3 (yes): The counter declares a signal named 'seen', not 'viewed', so it cannot send 'viewed'. | fix:       @click send seen page=1 | confusing: 

## E127 `mkp.check` error at `packages/core/src/check/def.ts:1438`

message: emit takes field=expr

block:
```
# Counter

```mkp
counter "A counter."
  var n int = 0
  out answered {correct: bool, tries: int}
  signal seen {page: int}
  column
    press
      text "go"
      @click emit answered correct
  project md = "Counter."
```

```counter
summary: A counter.
```
```

builder: Natural slip (writing the payload field bare). Message is brief; position is the offending word. Good.

- reader 1 (yes): `emit` takes named fields as `field=expr`. `correct` is given with no value. | fix:       @click emit answered correct=(n > 0)  (the `tries` field is declared but not given; I don't know if all fields are required) | confusing: Whether every declared field must be given is not stated.
- reader 2 (yes): emit's fields need a value, in the form field=expr. 'correct' has none. | fix: @click emit answered correct=true tries=1 | confusing: 
- reader 3 (yes): emit takes field=expr pairs, and 'correct' has no value after it. | fix: @click emit answered correct=true tries=1 | confusing: 

## E128 `mkp.unknown-field` error at `packages/core/src/check/def.ts:1440`

message: answered has no field "score"

block:
```
# Counter

```mkp
counter "A counter."
  var n int = 0
  out answered {correct: bool, tries: int}
  signal seen {page: int}
  column
    press
      text "go"
      @click emit answered correct=true tries=1 score=3
  project md = "Counter."
```

```counter
summary: A counter.
```
```

builder: Easy. Lists no valid fields and has no did-you-mean (answered has correct, tries).

- reader 1 (yes): `answered` declares only `correct` and `tries`, so `score` is not a field. | fix:       @click emit answered correct=true tries=1 | confusing: 
- reader 2 (yes): The out event answered has no field score. Its fields are correct and tries. | fix: @click emit answered correct=true tries=1 | confusing: 
- reader 3 (yes): The answered out has no field called score, but the emit passes one. | fix: @click emit answered correct=true tries=1 | confusing: 

## E129 `mkp.missing-field` error at `packages/core/src/check/def.ts:1444`

message: emit answered needs tries

block:
```
# Counter

```mkp
counter "A counter."
  var n int = 0
  out answered {correct: bool, tries: int}
  signal seen {page: int}
  column
    press
      text "go"
      @click emit answered correct=true
  project md = "Counter."
```

```counter
summary: A counter.
```
```

builder: Easy. Position is the action start. Good.

- reader 1 (yes): `emit answered` must give every field, and `tries` is missing. | fix:       @click emit answered correct=true tries=1 | confusing: 
- reader 2 (yes): emit answered needs a value for tries, as the out line declares it. | fix: @click emit answered correct=true tries=1 | confusing: 
- reader 3 (yes): 'answered' has a field 'tries' that the emit does not give, and every declared field must be supplied. | fix:       @click emit answered correct=true tries=1 | confusing: 

## E130 `mkp.not-state` error at `packages/core/src/check/def.ts:1453`

message: "total" is not state, a var or a ref input of counter

block:
```
# Counter

```mkp
counter "A counter."
  var n int = 0
  out answered {correct: bool, tries: int}
  signal seen {page: int}
  column
    press
      text "go"
      @click set total=3
  project md = "Counter."
```

```counter
summary: A counter.
```
```

builder: Easy. Compare with 'is not state here' for reset: same code, two different wordings.

- reader 1 (yes): `set` can change only state, vars or ref inputs. `total` is none of these; the counter has `n`. | fix:       @click set n=3 | confusing: 
- reader 2 (yes): total is not declared in the counter, so it cannot be set. | fix: @click set n=3 | confusing: 
- reader 3 (yes): 'total' is not declared in the counter, so it cannot be set. | fix: @click set n=3 | confusing: 

## E131 `mkp.check` error at `packages/core/src/check/def.ts:1454`

message: set takes an expression

block:
```
# Counter

```mkp
counter "A counter."
  var n int = 0
  out answered {correct: bool, tries: int}
  signal seen {page: int}
  column
    press
      text "go"
      @click set n=1..3
  project md = "Counter."
```

```counter
summary: A counter.
```
```

builder: Only unusual values (a range) reach it; ordinary typos give expression errors. Generic code.

- reader 1 (yes): `set` takes a single value, not a range such as 1..3. | fix:       @click set n=3 | confusing: 
- reader 2 (yes): set takes one expression. 1..3 is a range, not a value. | fix: @click set n=3 | confusing: 
- reader 3 (yes): set takes an expression, and '1..3' is a range. | fix: @click set n=2 | confusing: I chose 2 as a value inside the range 1..3. The author may have meant something else.

## E132 `mkp.ambiguous` error at `packages/core/src/check/def.ts:1126`

message: "chip" is provided by several packs (chips, pills); write pack:chip

block:
```
# Shop

```mkp
shelf "A shelf with a label."
  chip "new"
  project md = "new"
```

```shelf
summary: A shelf.
```

--- pack/chip.mkp ---
chip@1 "A word on a pill."
  fields word
  in word text
  row pad=xs radius=pill fill=muted
    text word size=small
  project md = word

--- pack/manifest.mkp ---
pack chips@1 "Chips."
  requires core@1
  provides chip

--- pack2/chip.mkp ---
chip@1 "A word in a square."
  fields word
  in word text
  row pad=xs stroke=line
    text word size=small
  project md = word

--- pack2/manifest.mkp ---
pack pills@1 "Pills."
  requires core@1
  provides chip
```

builder: Needs two packs providing one name, plus the document; I had to build three files and pass two --pack flags. The message tells the fix (write pack:chip). Packs sharing a name are not rejected at load, only at use.

- reader 1 (yes): Two packs (chips and pills) both provide `chip`, so the bare name is ambiguous. It must be written as pack:chip. | fix:   chips:chip "new"  (or pills:chip, depending on which pack you want) | confusing: The qualified form was only given in the message, so I'm applying it by analogy.
- reader 2 (partly): chip exists in two packs, so the name must say which pack it comes from, using pack:chip. | fix: chips:chip "new" | confusing: I could not tell which of the two packs is the right one, so I picked chips.
- reader 3 (yes): 'chip' is provided by two packs, so the name must say which pack to use, in the form pack:chip. | fix:   chips:chip "new" | confusing: The message suggests 'pack:chip' but does not say which of the two packs (chips or pills) is meant, so I picked chips.

## E133 `mkp.check` error at `packages/core/src/check/def.ts:1271`

message: each needs a list or a range

block:
```
# Ticks

```mkp
ticker "A ticker."
  column
    each t in 2s key=t
      text "tick"
  project md = "Ticker."
```

```ticker
summary: A ticker.
```
```

builder: Only a duration (each t in 2s) reaches this branch; unnatural. Compared with the neighbouring message 'found text' this one does not say what was found.

- reader 1 (yes): `each` loops over a list or a numeric range. `2s` is a duration, which is not a range. | fix:     each t in 0..2 key=t | confusing: `2s` looks like a time, so I'm not sure whether seconds are a loop type; the message doesn't say.
- reader 2 (yes): each needs a list or a range. 2s is a duration. | fix: each t in 0..2 key=t | confusing: 
- reader 3 (yes): each needs a list or a range, and '2s' is a duration. | fix: each t in 1..2 key=t | confusing: 

# Not triggered from a document or pack (still improve the wording)

- `packages/core/src/check/def.ts:491` `mkp.shadow`: "<name>" is an option of a choice here; a name can't take it, or comparing it with <name> would read this instead (owner is always set to the member name for in/var/host/state, so the empty-owner wording is unreachable)
- `packages/core/src/check/def.ts:879` `mkp.input-type`: expected a whole number, found <v> (A fractional literal never reaches here: the coerce step before it fails first with mkp.type 'expected int, found num'.)
- `packages/core/src/check/def.ts:243` `mkp.check`: <message passed by caller> (Helper that builds the MkpError for fail(); not a diagnostic of its own. Every fail() call site is recorded separately.)
- `packages/core/src/check/def.ts:1312` `mkp.case-unreachable`: case ${v.lit} can't happen (${showType(subj.type)}) (A literal case outside the subject's integer range is rejected earlier by this.value() as mkp.input-range ('it takes a whole number from 1 to 3; found 7'), so this warning is unreachable for ranged ints; slider/steps subjects have no integer range and do not warn.)
- `packages/core/src/check/def.ts:1402` `mkp.check`: ${a.name} takes a slider or steps name (Dead code: the preceding check (args.length !== 1 -> mkp.extra-arg 'takes exactly one slider or steps name') already rejects zero arguments, so a.args[0] is always defined here.)
- `packages/core/src/check/def.ts:1448` `mkp.check`: unknown action ${a.name} (Unreachable from source: the parser rejects an unknown action name first with mkp.unknown-action ('"launch" is not an action; actions are set, play, ...').)
- `packages/core/src/check/def.ts:1130` `mkp.unknown-version`: there is no ${name}@${want}; versions: ${versions} (Unreachable from source: a use such as 'chip@2' is rejected by the syntax pass first (mkp.syntax: '"chip@2" is not a valid element name'), because element names may not contain @. resolveDef's version branch has no caller that passes a version.)
