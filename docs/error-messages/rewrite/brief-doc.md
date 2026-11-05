# doc: 50 messages

## E134 `mkp.doc-state` error at `packages/core/src/check/doc.ts:183`

message: a state block holds state lines only (name = control …)

block:
```
# Counter

```state
n = slider 0..10 = 3 "how many"
text "hello"
```

```

builder: Easy. The error lands on the first non-state line, but "state lines only (name = control ...)" does not say what the valid controls are (slider, toggle, choice, ...).

- reader 1 (yes): A `state` block can hold only lines of the form `name = control ...`. The `text` line is not one. | fix: Delete the `text "hello"` line from the state block and place it in the widget body. | confusing: 
- reader 2 (yes): A state block holds only state lines. The text "hello" line does not belong in it. | fix: Delete the text "hello" line, leaving: n = slider 0..10 = 3 "how many" | confusing: 
- reader 3 (yes): A state block holds only state lines in the form name = control. The text line does not belong there. | fix: Delete the line 'text "hello"'. | confusing: 

## E135 `mkp.duplicate-anchor` error at `packages/core/src/check/doc.ts:211`

message: #setup is already the anchor of the block on line 1; give this one another

block:
```
# Setup
{#setup}

Install it.

# Setup again
{#setup}

Install it twice.

```

builder: Anchors are written as a {#id} line under the block, which I had to find in a test. The message is good: it names the line of the first block. The position points at the second block.

- reader 1 (yes): The anchor `#setup` is already used on the first heading, and anchors must be unique. | fix: # Setup again
{#setup-again} | confusing: 
- reader 2 (yes): #setup is already the anchor of the first heading, so the second heading needs a different one. | fix: # Setup again
{#setup-again} | confusing: 
- reader 3 (yes): The anchor '#setup' is already used by the first heading, and each anchor must be unique. | fix: # Setup again
{#setup-again} | confusing: 

## E136 `mkp.front-matter` error at `packages/core/src/check/doc.ts:250`

message: front matter must be a YAML mapping

block:
```
---
- intro
- basics
---
# Notes

Text.

```

builder: Easy. The message says what is required but not what was found; a list is the natural mistake.

- reader 1 (yes): The front matter must be a YAML mapping of key: value pairs. This one is a YAML list. | fix: ---
topics: [intro, basics]
--- | confusing: 
- reader 2 (yes): Front matter must be a mapping of keys to values, not a list. | fix: title: Notes
teaches: [intro, basics] | confusing: 
- reader 3 (yes): Front matter must be a YAML mapping of key: value pairs, and this is a list. | fix: ---
teaches: intro
--- | confusing: I changed the content to a mapping without knowing the right keys. The original list may have meant something else.

## E137 `mkp.front-matter` error at `packages/core/src/check/doc.ts:256`

message: front matter is not valid YAML: Missing closing "quote at line 2, column 12:

block:
```
---
title: "Notes
teaches: [a
---
# Notes

Text.

```

builder: The YAML library message is cut at its first line, so it ends with a dangling colon ("at line 2, column 12:") and the part that shows the offending text is lost. The reported line is the first line of the front matter, not the broken one.

- reader 1 (yes): The front matter YAML is broken: the quoted string at line 2 is never closed, and the list `[a` is also not closed. | fix: ---
title: "Notes"
teaches: [a]
--- | confusing: 
- reader 2 (yes): The front matter is not valid YAML: the title has an unclosed quote and the teaches list is not closed. | fix: title: "Notes"
teaches: [a] | confusing: 
- reader 3 (partly): The front matter YAML is broken: the title is missing its closing quote, and the teaches line opens a list that is never closed. | fix: ---
title: "Notes"
teaches: [a]
--- | confusing: The message gives a line and column for the missing quote, but the list bracket also needs closing, and I cannot tell what the second teaches item should be.

## E138 `mkp.front-matter` error at `packages/core/src/check/doc.ts:269`

message: front matter is not valid YAML: front matter holds a control character (\t); a backslash in "double quotes" is an escape, so write LaTeX in 'single quotes' (e.g. '\theta')

block:
```
---
teaches: "angle \theta in a triangle"
---
# Notes

Text.

```

builder: Surprise: in front matter the control-character error is caught by the front-matter handler, so the code is mkp.front-matter and the text stutters: "front matter is not valid YAML: front matter holds a control character". The code mkp.yaml-control-char only appears for widget blocks (see the other 269 line). The fix hint is good, though.

- reader 1 (yes): The YAML `teaches: "angle \theta..."` has a backslash inside double quotes, which YAML reads as an escape. | fix: teaches: 'angle \theta in a triangle' | confusing: The message is the same as E169, so I used the same fix.
- reader 2 (yes): In double-quoted YAML, \t is read as a tab, and the front matter fails. Single quotes keep the backslash. | fix: teaches: 'angle \\theta in a triangle' | confusing: The message says a control character (\t) is held, which I did not expect from a backslash.
- reader 3 (yes): In a double-quoted YAML string, '\t' is read as a tab escape, which breaks the YAML. The text should be in single quotes so the backslash is kept. | fix: teaches: 'angle \theta in a triangle' | confusing: 

## E139 `mkp.markdown` warning at `packages/core/src/check/doc.ts:284`

message: link reference definitions are not supported; write links inline

block:
```
# Notes

See [the guide][guide] for more.

[guide]: https://example.com/guide

```

builder: The warning is placed on the definition line, not on the link that uses it. The reference link then silently renders as plain text, so the reader of the message must work out the connection.

- reader 1 (yes): Reference-style links such as `[guide]: url` are not supported. Links must be written in place. | fix: See [the guide](https://example.com/guide) for more.  (delete the `[guide]: ...` line) | confusing: 
- reader 2 (yes): Reference-style links are not supported. The link must be written inline. | fix: See [the guide](https://example.com/guide) for more. | confusing: 
- reader 3 (yes): Reference-style link definitions like '[guide]: url' are not supported in MKP. | fix: See [the guide](https://example.com/guide) for more. | confusing: 

## E140 `mkp.attrs` warning at `packages/core/src/check/doc.ts:679`

message: attribute tone on a Markdown block is ignored; only #id, role= (on headings) and the profile's block attributes apply

block:
```
# Notes

A paragraph of text.
{tone=warn}

```

builder: Attributes sit on their own line under the block, which is not obvious. The message says the attribute is ignored but refers to "the profile's block attributes", which is jargon for an author with no profile. Only a warning.

- reader 1 (partly): A `{tone=warn}` attribute is placed after a paragraph, but Markdown blocks ignore it. Only #id, role= on headings and profile attributes are used. | fix: Remove the `{tone=warn}` line, or move the attribute to a heading as `role=`. | confusing: I don't know what 'the profile's block attributes' are.
- reader 2 (yes): tone is not allowed on a Markdown paragraph, so this attribute is ignored. | fix: Delete the {tone=warn} line. | confusing: I do not know which block attributes are allowed on Markdown blocks.
- reader 3 (yes): A tone attribute on a Markdown block is ignored. Only #id, role= on headings and the profile's block attributes apply. | fix: A paragraph of text. | confusing: 

## E141 `mkp.markdown` warning at `packages/core/src/check/doc.ts:284`

message: raw HTML is shown as text; MKP content has no HTML (use a widget)

block:
```
# Notes

<div>See the guide.</div>

```

builder: Only a block-level HTML element triggers it; inline <b> in a paragraph gave nothing at all, which I found surprising. Warning only, message is clear.

- reader 1 (yes): Raw HTML is shown as text and not rendered, so the `<div>` tags have no effect in MKP. | fix: See the guide.  (or use a widget, if formatting is needed) | confusing: 
- reader 2 (yes): Raw HTML is shown as text, and MKP content has no HTML. | fix: See the guide. | confusing: 
- reader 3 (yes): Raw HTML like <div> is not allowed in MKP content. | fix: See the guide. | confusing: 

## E142 `mkp.unknown-widget` error at `packages/core/src/check/doc.ts:338`

message: there is no widget "pannel" (did you mean "panel"?)

block:
```
# Notes

```pannel
title: Hello
summary: A greeting.
```

```mkp
panel "A titled box holding some content."
  in title text "the heading"
  in size int 1..5 = 3 "how big it is"
  in lit bool = false "whether it is marked"
  in tone color = none "a wash behind it"
  in mode choice(plain|bold) = plain "how the title looks"
  in body slot
  column
    text title weight=(if(lit, bold, normal))
    slot body
  project md = title
```


```

builder: Only a fence that has a summary: line is taken as a widget attempt; without it a misspelt name would silently become a code block. The did-you-mean works well.

- reader 1 (yes): The fence name is taken as the widget name, and `pannel` is a typo for `panel`. | fix: Change the fence from ```pannel to ```panel. | confusing: 
- reader 2 (yes): 'pannel' is a typo for panel. | fix: ```panel | confusing: 
- reader 3 (yes): 'pannel' is a typo of 'panel', and there is no widget with that name. | fix: Change the fence from '```pannel' to '```panel'. | confusing: 

## E143 `mkp.yaml` error at `packages/core/src/check/doc.ts:348`

message: the panel block is not valid YAML: Nested mappings are not allowed in compact mappings at line 1, column 8:

block:
```
```mkp
panel "A titled box holding some content."
  in title text "the heading"
  in size int 1..5 = 3 "how big it is"
  in lit bool = false "whether it is marked"
  in tone color = none "a wash behind it"
  in mode choice(plain|bold) = plain "how the title looks"
  in body slot
  column
    text title weight=(if(lit, bold, normal))
    slot body
  project md = title
```

```panel
title: Hello: world
summary: A greeting.
```

```

builder: Plain colon inside an unquoted YAML value. The YAML library text is cut at its first line and ends with a colon; "line 1, column 8" is relative to the block, not the file, while the diagnostic position is the first line of the block.

- reader 1 (partly): The YAML `title: Hello: world` contains a second colon, which YAML reads as a nested mapping. | fix: title: "Hello: world" | confusing: The message mentions 'compact mappings' and column 8, which I connect to the second colon only by guessing.
- reader 2 (yes): The YAML value 'Hello: world' contains a second colon, so YAML reads it as a nested mapping. The value must be quoted. | fix: title: "Hello: world" | confusing: "Nested mappings are not allowed in compact mappings" is hard to follow for a plain text value.
- reader 3 (partly): The YAML summary has a colon inside a plain value, so it reads as a nested mapping. The value must be quoted. | fix: title: "Hello: world" | confusing: The message says nested mappings are not allowed in compact mappings, which is not the same as a colon in a value. I am not sure it is the only error.

## E144 `mkp.yaml` error at `packages/core/src/check/doc.ts:352`

message: the panel block must be a YAML mapping of its inputs

block:
```
```mkp
panel "A titled box holding some content."
  in title text "the heading"
  in size int 1..5 = 3 "how big it is"
  in lit bool = false "whether it is marked"
  in tone color = none "a wash behind it"
  in mode choice(plain|bold) = plain "how the title looks"
  in body slot
  column
    text title weight=(if(lit, bold, normal))
    slot body
  project md = title
```

```panel
- Hello
- world
```

```

builder: Clear. It names the block and says what is expected.

- reader 1 (yes): The panel's data must be a mapping of input names to values, not a list. | fix: title: Hello
body: [Hello, world] | confusing: 
- reader 2 (yes): The panel block must be a YAML mapping of input names to values, but the block is a list. | fix: title: Hello world | confusing: 
- reader 3 (yes): The panel's data is a list (starts with '-'), but it must be a YAML mapping of its input names to values. | fix: title: Hello
body: world | confusing: 

## E145 `mkp.missing-summary` error at `packages/core/src/check/doc.ts:359`

message: the panel block needs a summary: line (what it shows, for readers without the widget and for Markdown output)

block:
```
```mkp
panel "A titled box holding some content."
  in title text "the heading"
  in size int 1..5 = 3 "how big it is"
  in lit bool = false "whether it is marked"
  in tone color = none "a wash behind it"
  in mode choice(plain|bold) = plain "how the title looks"
  in body slot
  column
    text title weight=(if(lit, bold, normal))
    slot body
  project md = title
```

```panel
title: Hello
```

```

builder: Easy and clear. It points at the opening fence.

- reader 1 (yes): A panel block must have a `summary:` line describing what it shows. | fix: Add the line `summary: A titled box.` to the ```panel block. | confusing: 
- reader 2 (yes): A panel block needs a summary line, which readers without the widget see. | fix: title: Hello
summary: A titled box. | confusing: 
- reader 3 (yes): The panel block needs a 'summary:' line saying what it shows. | fix: summary: A box holding a title. | confusing: 

## E146 `mkp.unknown-prop` error at `packages/core/src/check/doc.ts:428`

message: panel has no input "colour"

block:
```
```mkp
panel "A titled box holding some content."
  in title text "the heading"
  in size int 1..5 = 3 "how big it is"
  in lit bool = false "whether it is marked"
  in tone color = none "a wash behind it"
  in mode choice(plain|bold) = plain "how the title looks"
  in body slot
  column
    text title weight=(if(lit, bold, normal))
    slot body
  project md = title
```

```panel
title: Hello
colour: ok
summary: A box.
```

```

builder: I wrote the English spelling of a name (colour for tone); there is no suggestion because the names are far apart. The position is the line of the key, which helps.

- reader 1 (yes): The panel has no `colour` input. The one for colour is `tone`. | fix: tone: ok | confusing: 
- reader 2 (yes): The panel has no input named colour. Its colour input is named tone. | fix: tone: ok | confusing: 
- reader 3 (yes): The panel has no input named colour. Its inputs are title, size, lit, tone, mode and body. | fix: tone: ok | confusing: 

## E147 `mkp.input-type` error at `packages/core/src/check/doc.ts:432`

message: body is a slot: give it a Markdown string

block:
```
```mkp
panel "A titled box holding some content."
  in title text "the heading"
  in size int 1..5 = 3 "how big it is"
  in lit bool = false "whether it is marked"
  in tone color = none "a wash behind it"
  in mode choice(plain|bold) = plain "how the title looks"
  in body slot
  column
    text title weight=(if(lit, bold, normal))
    slot body
  project md = title
```

```panel
title: Hello
body:
  - first
  - second
summary: A box.
```

```

builder: A slot given a YAML list. Clear, and the position is the key.

- reader 1 (partly): `body` is a slot, so it needs a Markdown string, not a YAML list. | fix: body: "first\n\nsecond" | confusing: The message says 'give it a Markdown string' but I'm not sure how to write one in YAML; I used a plain string.
- reader 2 (yes): body is a slot, so it takes one Markdown string, not a list. | fix: body: "- first\n- second" | confusing: 
- reader 3 (yes): 'body' is a slot, so its value must be a Markdown string, not a YAML list. | fix: body: |
  - first
  - second | confusing: 

## E148 `mkp.input-type` error at `packages/core/src/check/doc.ts:483`

message: size is a whole number; found "big"

block:
```
```mkp
panel "A titled box holding some content."
  in title text "the heading"
  in size int 1..5 = 3 "how big it is"
  in lit bool = false "whether it is marked"
  in tone color = none "a wash behind it"
  in mode choice(plain|bold) = plain "how the title looks"
  in body slot
  column
    text title weight=(if(lit, bold, normal))
    slot body
  project md = title
```

```panel
title: Hello
size: big
summary: A box.
```

```

builder: Clear. The found value is quoted in JSON form, which reads naturally.

- reader 1 (yes): `size` is a whole number, but the block gives the word `big`. | fix: size: 3 | confusing: 
- reader 2 (yes): size is a whole number from 1 to 5. The block gives the word big. | fix: size: 3 | confusing: 
- reader 3 (yes): The size must be a whole number, and 'big' is text. | fix: size: 4 | confusing: 

## E149 `mkp.input-range` error at `packages/core/src/check/doc.ts:490`

message: size is 9, outside 1..5

block:
```
```mkp
panel "A titled box holding some content."
  in title text "the heading"
  in size int 1..5 = 3 "how big it is"
  in lit bool = false "whether it is marked"
  in tone color = none "a wash behind it"
  in mode choice(plain|bold) = plain "how the title looks"
  in body slot
  column
    text title weight=(if(lit, bold, normal))
    slot body
  project md = title
```

```panel
title: Hello
size: 9
summary: A box.
```

```

builder: Clear. The range is shown as 1..5.

- reader 1 (yes): `size` must be from 1 to 5, and 9 is outside that range. | fix: size: 5 | confusing: 
- reader 2 (yes): size must be between 1 and 5. The block gives 9. | fix: size: 3 | confusing: 
- reader 3 (yes): size is 9, outside the range 1..5. | fix: size: 5 | confusing: 

## E150 `mkp.input-type` error at `packages/core/src/check/doc.ts:494`

message: lit is true or false; "yes" is text in YAML 1.2: write true

block:
```
```mkp
panel "A titled box holding some content."
  in title text "the heading"
  in size int 1..5 = 3 "how big it is"
  in lit bool = false "whether it is marked"
  in tone color = none "a wash behind it"
  in mode choice(plain|bold) = plain "how the title looks"
  in body slot
  column
    text title weight=(if(lit, bold, normal))
    slot body
  project md = title
```

```panel
title: Hello
lit: yes
summary: A box.
```

```

builder: A good message: explains YAML 1.2 and gives the exact fix.

- reader 1 (yes): In YAML 1.2, `yes` is text, not a bool. A bool must be written true or false. | fix: lit: true | confusing: 
- reader 2 (yes): lit is a bool. In YAML 1.2, yes is text, so the value must be true or false. | fix: lit: true | confusing: 
- reader 3 (yes): 'yes' is read as text in YAML 1.2, not as a boolean, and 'lit' needs a boolean. | fix: lit: true | confusing: 

## E151 `mkp.enum` error at `packages/core/src/check/doc.ts:506`

message: mode is one of plain, bold; found "italic"

block:
```
```mkp
panel "A titled box holding some content."
  in title text "the heading"
  in size int 1..5 = 3 "how big it is"
  in lit bool = false "whether it is marked"
  in tone color = none "a wash behind it"
  in mode choice(plain|bold) = plain "how the title looks"
  in body slot
  column
    text title weight=(if(lit, bold, normal))
    slot body
  project md = title
```

```panel
title: Hello
mode: italic
summary: A box.
```

```

builder: Clear. Lists the options.

- reader 1 (yes): `mode` only accepts `plain` or `bold`. The block gives `italic`. | fix: mode: bold | confusing: 
- reader 2 (yes): mode is plain or bold, and italic is neither. | fix: mode: plain | confusing: 
- reader 3 (yes): mode must be plain or bold, and 'italic' is not one of them. | fix: mode: bold | confusing: 

## E152 `mkp.unknown-token` error at `packages/core/src/check/doc.ts:524`

message: "green" is not a color token; tone takes a color token: none, surface, ink, muted, line, accent, info, ok, warn, bad, c1, c2, c3, c4, c5, c6

block:
```
```mkp
panel "A titled box holding some content."
  in title text "the heading"
  in size int 1..5 = 3 "how big it is"
  in lit bool = false "whether it is marked"
  in tone color = none "a wash behind it"
  in mode choice(plain|bold) = plain "how the title looks"
  in body slot
  column
    text title weight=(if(lit, bold, normal))
    slot body
  project md = title
```

```panel
title: Hello
tone: green
summary: A box.
```

```

builder: Long because it lists all sixteen colour tokens, but it is complete and tells the author what the input takes.

- reader 1 (yes): `green` is not a colour token. | fix: tone: info | confusing: 
- reader 2 (yes): 'green' is not a colour token. The allowed names are the list in the message, such as ok. | fix: tone: ok | confusing: 
- reader 3 (yes): 'green' is not a colour token. tone takes one of the named tokens. | fix: tone: ok | confusing: 

## E153 `mkp.not-state` error at `packages/core/src/check/doc.ts:529`

message: "volume" is not declared in a state block of this document

block:
```
# Notes

```mkp
gauge "A bar showing a level."
  in level ref num "the level"
  meter value=level max=10
  project md = "level " + format(level, 0)
```

```gauge
level: {ref: volume}
summary: A level bar.
```

```

builder: No state block exists, so the message is right, but it does not say how to declare one or list the state names that do exist.

- reader 1 (yes): `volume` is not declared in a state block in this document, so the ref can't find it. | fix: Add a state block declaring `volume = slider 0..10 "volume"`, or point the ref at an existing state. | confusing: 
- reader 2 (partly): ref points to a state named volume, but no state block in this document declares it. | fix: Add 'volume = slider 0..10 = 5 "volume"' to a state block, or point the ref at a state that exists. | confusing: I do not know whether volume should be declared in this document or in another file.
- reader 3 (partly): The 'level' ref points at 'volume', which is not declared in any state block of this document. | fix: cannot infer (I do not know the exact state-block syntax; the document needs a declaration for 'volume', or the ref needs to point at a name that is declared) | confusing: I do not know how a state block is written in this format, so I cannot write the declaration.

## E154 `mkp.input-type` error at `packages/core/src/check/doc.ts:530`

message: level is num, but volume is bool

block:
```
# Notes

```state
volume = toggle "sound on"
```

```mkp
gauge "A bar showing a level."
  in level ref num "the level"
  meter value=level max=10
  project md = "level " + format(level, 0)
```

```gauge
level: {ref: volume}
summary: A level bar.
```

```

builder: Needed a bool state (toggle) for a num ref, since sliders are numbers. Message is clear. Wording "level is num" uses type names while other messages use words like "a number".

- reader 1 (partly): The `level` ref needs a number, but it is bound to `volume`, which is a bool toggle. | fix: Change the state to a number, e.g. `volume = slider 0..10 "volume"`, and keep `level: {ref: volume}`. | confusing: I'm not sure whether a `toggle` value can be used anywhere a number is expected, so the fix is a guess.
- reader 2 (partly): level is a num, but the state volume is a bool (a toggle). | fix: volume = slider 0..10 = 5 "sound level" | confusing: I changed the state's control, which may not be what the author wanted.
- reader 3 (yes): The 'level' input is a num, but the state it refers to, 'volume', is a bool (a toggle). | fix: Make 'volume' a num state, for example a slider, or change 'in level ref num' to 'in level ref bool'. | confusing: 

## E155 `mkp.input-type` error at `packages/core/src/check/doc.ts:441`

message: panes is a list of pane records: give a YAML list of objects

block:
```
# Gallery

```mkp
gallery "Panes listed one after another, with scores."
  in panes list(record pane {title: text, count: int, tone: color = accent} slot)
  in lead slot
  in aside slot
  in scores list(int 1..5) = []
  in marks list(color) = []
  in spot {x: num, y: num = 0} = {x: 0}
  in notes list(record note {text: text, links: list(record link {label: text, to: text})})
  column
    slot lead
    each k in 0..(len(scores) - 1) key=k
      text "\val{scores[k]}"
  project md = "gallery"
```

```gallery
panes: first
summary: A gallery.
```

```

builder: Clear.

- reader 1 (yes): `panes` is a list of pane records, so it must be a YAML list of objects, not a word. | fix: panes:
  - {title: First, count: 1} | confusing: 
- reader 2 (yes): panes is a list of pane records, each written as a YAML object. The block gives the text 'first'. | fix: panes: [{title: First, count: 1}] | confusing: 
- reader 3 (yes): panes is a list of pane records, and it is given as a single text value 'first' instead of a YAML list of objects. | fix: panes:
  - {title: first, count: 1} | confusing: 

## E156 `mkp.input-type` error at `packages/core/src/check/doc.ts:449`

message: each pane is an object of its fields

block:
```
# Gallery

```mkp
gallery "Panes listed one after another, with scores."
  in panes list(record pane {title: text, count: int, tone: color = accent} slot)
  in lead slot
  in aside slot
  in scores list(int 1..5) = []
  in marks list(color) = []
  in spot {x: num, y: num = 0} = {x: 0}
  in notes list(record note {text: text, links: list(record link {label: text, to: text})})
  column
    slot lead
    each k in 0..(len(scores) - 1) key=k
      text "\val{scores[k]}"
  project md = "gallery"
```

```gallery
panes:
  - first
  - second
summary: A gallery.
```

```

builder: The position is the list entry, but the message does not say which pane or what was found.

- reader 1 (yes): Each pane must be an object with its fields, such as title and count, not a bare word. | fix: panes:
  - {title: First, count: 1}
  - {title: Second, count: 2} | confusing: 
- reader 2 (yes): Each pane must be an object of its fields, not a text string. | fix: panes:
  - {title: First, count: 1} | confusing: 
- reader 3 (yes): Each pane in 'panes' must be an object with the fields title, count and tone, not a plain string. | fix: panes:
  - {title: first, count: 1}
  - {title: second, count: 2} | confusing: 

## E157 `mkp.input-type` error at `packages/core/src/check/doc.ts:455`

message: the pane slot is a Markdown string

block:
```
# Gallery

```mkp
gallery "Panes listed one after another, with scores."
  in panes list(record pane {title: text, count: int, tone: color = accent} slot)
  in lead slot
  in aside slot
  in scores list(int 1..5) = []
  in marks list(color) = []
  in spot {x: num, y: num = 0} = {x: 0}
  in notes list(record note {text: text, links: list(record link {label: text, to: text})})
  column
    slot lead
    each k in 0..(len(scores) - 1) key=k
      text "\val{scores[k]}"
  project md = "gallery"
```

```gallery
panes:
  - {title: One, count: 1, slot: [a, b]}
summary: A gallery.
```

```

builder: Clear, although "slot" as a key inside a record is a hidden convention an author cannot guess.

- reader 1 (yes): A pane's `slot` is a Markdown string, but the block gives a YAML list `[a, b]`. | fix:   - {title: One, count: 1, slot: "a b"} | confusing: 
- reader 2 (partly): A pane's slot value is a Markdown string, not a list. | fix: - {title: One, count: 1, slot: "a and b"} | confusing: I do not know the exact Markdown form the slot expects.
- reader 3 (yes): The 'slot' field of a pane must be a Markdown string, and the block gives a list. | fix:   - {title: One, count: 1, slot: "Some words."} | confusing: 

## E158 `mkp.unknown-field` error at `packages/core/src/check/doc.ts:460`

message: pane has no field "colour"

block:
```
# Gallery

```mkp
gallery "Panes listed one after another, with scores."
  in panes list(record pane {title: text, count: int, tone: color = accent} slot)
  in lead slot
  in aside slot
  in scores list(int 1..5) = []
  in marks list(color) = []
  in spot {x: num, y: num = 0} = {x: 0}
  in notes list(record note {text: text, links: list(record link {label: text, to: text})})
  column
    slot lead
    each k in 0..(len(scores) - 1) key=k
      text "\val{scores[k]}"
  project md = "gallery"
```

```gallery
panes:
  - {title: One, count: 1, colour: ok}
summary: A gallery.
```

```

builder: Spelling variant again; the position is the exact column of the key, which is good. No suggestion shown.

- reader 1 (yes): A pane has no `colour` field. Its colour field is `tone`. | fix:   - {title: One, count: 1, tone: ok} | confusing: 
- reader 2 (yes): A pane has no field named colour. Its colour field is tone. | fix: panes:
  - {title: One, count: 1, tone: ok} | confusing: 
- reader 3 (yes): The pane record has no field called colour. Its fields are title, count and tone. | fix:   - {title: One, count: 1, tone: ok} | confusing: 

## E159 `mkp.input-type` error at `packages/core/src/check/doc.ts:463`

message: links is a list of link records

block:
```
# Gallery

```mkp
gallery "Panes listed one after another, with scores."
  in panes list(record pane {title: text, count: int, tone: color = accent} slot)
  in lead slot
  in aside slot
  in scores list(int 1..5) = []
  in marks list(color) = []
  in spot {x: num, y: num = 0} = {x: 0}
  in notes list(record note {text: text, links: list(record link {label: text, to: text})})
  column
    slot lead
    each k in 0..(len(scores) - 1) key=k
      text "\val{scores[k]}"
  project md = "gallery"
```

```gallery
notes:
  - text: Intro
    links: https://example.org
summary: A gallery.
```

```

builder: Clear.

- reader 1 (yes): `links` is a list of link records, and the data gives a single text value. | fix:     links:
      - {label: Example, to: "https://example.org"} | confusing: 
- reader 2 (yes): links is a list of link records, each with label and to. The block gives a plain URL. | fix: notes:
  - text: Intro
    links:
      - {label: Example, to: "https://example.org"} | confusing: 
- reader 3 (yes): 'links' must be a list of link records (label and to), not a single URL string. | fix: notes:
  - text: Intro
    links:
      - {label: Site, to: https://example.org} | confusing: 

## E160 `mkp.missing-input` error at `packages/core/src/check/doc.ts:472`

message: pane needs count (int)

block:
```
# Gallery

```mkp
gallery "Panes listed one after another, with scores."
  in panes list(record pane {title: text, count: int, tone: color = accent} slot)
  in lead slot
  in aside slot
  in scores list(int 1..5) = []
  in marks list(color) = []
  in spot {x: num, y: num = 0} = {x: 0}
  in notes list(record note {text: text, links: list(record link {label: text, to: text})})
  column
    slot lead
    each k in 0..(len(scores) - 1) key=k
      text "\val{scores[k]}"
  project md = "gallery"
```

```gallery
panes:
  - {title: One}
summary: A gallery.
```

```

builder: Clear, but gives the list entry position only; it does not say which pane.

- reader 1 (yes): Each pane needs a `count` value, which must be an int. | fix:   - {title: One, count: 1} | confusing: 
- reader 2 (yes): A pane needs its count field. | fix: panes:
  - {title: One, count: 1} | confusing: 
- reader 3 (yes): A pane record needs a 'count' field of type int, and the block gives only 'title'. | fix:   - {title: One, count: 1} | confusing: 

## E161 `mkp.input-type` error at `packages/core/src/check/doc.ts:555`

message: scores[1] is a whole number; found "two"

block:
```
# Gallery

```mkp
gallery "Panes listed one after another, with scores."
  in panes list(record pane {title: text, count: int, tone: color = accent} slot)
  in lead slot
  in aside slot
  in scores list(int 1..5) = []
  in marks list(color) = []
  in spot {x: num, y: num = 0} = {x: 0}
  in notes list(record note {text: text, links: list(record link {label: text, to: text})})
  column
    slot lead
    each k in 0..(len(scores) - 1) key=k
      text "\val{scores[k]}"
  project md = "gallery"
```

```gallery
panes: []
scores: [1, two, 3]
summary: A gallery.
```

```

builder: Same wording as a scalar input mismatch, but the path scores[1] says where. Good.

- reader 1 (yes): `scores` is a list of whole numbers, and `two` is not one. | fix: scores: [1, 2, 3] | confusing: 
- reader 2 (yes): scores takes whole numbers from 1 to 5. The block gives 'two', which is text. | fix: scores: [1, 2, 3] | confusing: 
- reader 3 (yes): scores[1] must be a whole number, and 'two' is text. | fix: scores: [1, 2, 3] | confusing: 

## E162 `mkp.input-range` error at `packages/core/src/check/doc.ts:561`

message: scores[1] is 7, outside 1..5

block:
```
# Gallery

```mkp
gallery "Panes listed one after another, with scores."
  in panes list(record pane {title: text, count: int, tone: color = accent} slot)
  in lead slot
  in aside slot
  in scores list(int 1..5) = []
  in marks list(color) = []
  in spot {x: num, y: num = 0} = {x: 0}
  in notes list(record note {text: text, links: list(record link {label: text, to: text})})
  column
    slot lead
    each k in 0..(len(scores) - 1) key=k
      text "\val{scores[k]}"
  project md = "gallery"
```

```gallery
panes: []
scores: [1, 7]
summary: A gallery.
```

```

builder: Good: path and range.

- reader 1 (yes): `scores` values must be from 1 to 5, and 7 is out of range. | fix: scores: [1, 5] | confusing: 
- reader 2 (yes): Each scores item must be between 1 and 5. The block gives 7. | fix: scores: [1, 5] | confusing: 
- reader 3 (yes): The scores must be from 1 to 5, and the value 7 is outside that range. | fix: scores: [1, 5] | confusing: 

## E163 `mkp.unknown-token` error at `packages/core/src/check/doc.ts:573`

message: "green" is not a color token; marks[1] takes a color token: none, surface, ink, muted, line, accent, info, ok, warn, bad, c1, c2, c3, c4, c5, c6

block:
```
# Gallery

```mkp
gallery "Panes listed one after another, with scores."
  in panes list(record pane {title: text, count: int, tone: color = accent} slot)
  in lead slot
  in aside slot
  in scores list(int 1..5) = []
  in marks list(color) = []
  in spot {x: num, y: num = 0} = {x: 0}
  in notes list(record note {text: text, links: list(record link {label: text, to: text})})
  column
    slot lead
    each k in 0..(len(scores) - 1) key=k
      text "\val{scores[k]}"
  project md = "gallery"
```

```gallery
panes: []
marks: [ok, green]
summary: A gallery.
```

```

builder: The long token list again; path shown as marks[1].

- reader 1 (yes): `green` is not a colour token. The valid tokens are listed in the message. | fix: marks: [ok, info] | confusing: 
- reader 2 (yes): green is not a colour token, and marks takes colour tokens. | fix: marks: [ok, info] | confusing: 
- reader 3 (yes): 'green' is not a colour token. The marks list accepts only the named tokens. | fix: marks: [ok, warn] | confusing: 

## E164 `mkp.unknown-field` error at `packages/core/src/check/doc.ts:588`

message: spot has no field "z" (did you mean "x"?)

block:
```
# Gallery

```mkp
gallery "Panes listed one after another, with scores."
  in panes list(record pane {title: text, count: int, tone: color = accent} slot)
  in lead slot
  in aside slot
  in scores list(int 1..5) = []
  in marks list(color) = []
  in spot {x: num, y: num = 0} = {x: 0}
  in notes list(record note {text: text, links: list(record link {label: text, to: text})})
  column
    slot lead
    each k in 0..(len(scores) - 1) key=k
      text "\val{scores[k]}"
  project md = "gallery"
```

```gallery
panes: []
spot: {x: 1, z: 2}
summary: A gallery.
```

```

builder: The did-you-mean suggests x for z (any single letter would match), which is mildly misleading. The position is column 1 of the key line, not the key.

- reader 1 (yes): `spot` has fields x and y. The data gives `z`, which doesn't exist. | fix: spot: {x: 1, y: 2} | confusing: 
- reader 2 (yes): spot has the fields x and y. The block gives z, which is probably a typo for y. | fix: spot: {x: 1, y: 2} | confusing: 
- reader 3 (yes): The spot record has no field z. It has x and y. | fix: spot: {x: 1, y: 2} | confusing: The message suggests 'x', which is already present, so I replaced z with y as the other valid field.

## E165 `mkp.missing-field` error at `packages/core/src/check/doc.ts:597`

message: spot needs x (num)

block:
```
# Gallery

```mkp
gallery "Panes listed one after another, with scores."
  in panes list(record pane {title: text, count: int, tone: color = accent} slot)
  in lead slot
  in aside slot
  in scores list(int 1..5) = []
  in marks list(color) = []
  in spot {x: num, y: num = 0} = {x: 0}
  in notes list(record note {text: text, links: list(record link {label: text, to: text})})
  column
    slot lead
    each k in 0..(len(scores) - 1) key=k
      text "\val{scores[k]}"
  project md = "gallery"
```

```gallery
panes: []
spot: {y: 2}
summary: A gallery.
```

```

builder: The position is the key line, not the field; clear message.

- reader 1 (yes): The `spot` record needs its `x` field, and only `y` is given. | fix: spot: {x: 1, y: 2} | confusing: 
- reader 2 (yes): spot is a record with x required and y optional. The block gives only y. | fix: spot: {x: 0, y: 2} | confusing: 
- reader 3 (yes): 'spot' is a record that needs an 'x' value, and the block gives only 'y'. | fix: spot: {x: 0, y: 2} | confusing: 

## E166 `mkp.shadow` error at `packages/core/src/check/doc.ts:109`

message: "document" is reserved for the document itself; name the definition something else

block:
```
# Notes

```mkp
document "A summary of the page."
  in label text "what it says"
  text label
  project md = label
```

```

builder: Easy once I knew "document" was reserved; the reason is clear.

- reader 1 (yes): `document` is a reserved name, and the definition has to be renamed. | fix: Rename `document "A summary of the page."` to something like `page_summary "A summary of the page."`. | confusing: 
- reader 2 (yes): document is reserved for the document itself, so the widget needs another name. | fix: synopsis "A summary of the page." | confusing: 
- reader 3 (yes): 'document' is a reserved word for the document itself, so a widget cannot be named that. | fix: summaryNote "A summary of the page." | confusing: I changed the name to 'summaryNote' as a guess, and the fence name may also need changing.

## E167 `mkp.shadow` error at `packages/core/src/check/doc.ts:114`

message: row is already a base widget or type; give this one its own name (mkp show --source --as copies one renamed)

block:
```
# Notes

```mkp
row "A row of labels."
  in label text "what it says"
  text label
  project md = label
```

```

builder: Clear; the (mkp show --source --as ...) hint is a command the author may not have at hand, but it is helpful.

- reader 1 (yes): `row` is already a built-in widget name, so this definition needs another name. | fix: Rename it, e.g. `labelrow "A row of labels."`, or copy the built-in with `mkp show --source --as`. | confusing: 
- reader 2 (yes): row is a built-in widget name, so a definition cannot reuse it. The definition needs its own name. | fix: labels "A row of labels." (rename the definition) | confusing: I do not know the 'mkp show --source --as' command, so I did not use it.
- reader 3 (yes): row is a base widget name, so this definition cannot use it. It needs its own name. | fix: labelrow "A row of labels." | confusing: 

## E168 `mkp.no-project` error at `packages/core/src/check/doc.ts:146`

message: badge has no project md: a document's widget says in Markdown what it shows, for readers without it

block:
```
# Notes

```mkp
badge "A short label."
  in label text "what it says"
  text label
```

```badge
label: New
summary: A badge.
```

```

builder: The check only fires for widgets with no slot and no project md. The message is clear.

- reader 1 (yes): A document's widget must say, in Markdown, what it shows, using `project md`. | fix:   project md = label | confusing: 
- reader 2 (yes): The badge has no project md line, which tells readers without the widget what it shows. | fix: project md = label | confusing: 
- reader 3 (yes): The badge has no 'project md' line, which every document's widget needs to say what it shows as Markdown. | fix:   project md = label | confusing: 

## E169 `mkp.yaml-control-char` error at `packages/core/src/check/doc.ts:269`

message: the panel block holds a control character (\t); a backslash in "double quotes" is an escape, so write LaTeX in 'single quotes' (e.g. '\theta')

block:
```
```mkp
panel "A titled box holding some content."
  in title text "the heading"
  in size int 1..5 = 3 "how big it is"
  in lit bool = false "whether it is marked"
  in tone color = none "a wash behind it"
  in mode choice(plain|bold) = plain "how the title looks"
  in body slot
  column
    text title weight=(if(lit, bold, normal))
    slot body
  project md = title
```

```panel
title: "angle \theta"
summary: A box.
```

```

builder: Real mkp.yaml-control-char: the double-quoted "\theta" is the classic LaTeX mistake. The message is excellent.

- reader 1 (yes): In a double-quoted YAML string, `\t` is read as a tab. The backslash in `angle \theta` must be kept, so use single quotes. | fix: title: 'angle \theta' | confusing: The message talks about an mkp string and a YAML value together, so I'm not sure which quotes count. The fix is for the YAML value.
- reader 2 (yes): In double-quoted YAML, \t is read as a tab. Single quotes keep the backslash. | fix: title: 'angle \\theta' | confusing: The message says a control character, which I did not expect from a backslash.
- reader 3 (yes): '\t' inside double quotes is a tab escape, which breaks the YAML. Use single quotes so the backslash stays. | fix: title: 'angle \theta' | confusing: 

## E170 `mkp.part-in-document` error at `packages/core/src/check/doc.ts:327`

message: tile is a part; parts are used inside definitions, not in documents

block:
```
# Notes

```mkp
part tile "A labelled tile."
  fields label
  in label text
  text label
```

```tile
label: One
summary: A tile.
```

```

builder: Easy. The message is clear.

- reader 1 (yes): `part` definitions are used inside other definitions, and a document can't use `tile` directly. | fix: Put the part in a pack, or use it from a widget definition in this document. | confusing: 
- reader 2 (partly): tile is a part, and parts are used inside other definitions, not as a document's widget. The block declares it as a document item. | fix: tile "A labelled tile."
  in label text
  text label
  project md = label | confusing: I do not know what a definition is versus a part, and the 'fields label' line may also be invalid.
- reader 3 (yes): A part is used inside other definitions, not directly in a document, so 'tile' cannot be defined here. | fix: cannot infer | confusing: I do not know whether the part should move into a pack, or whether the document should use it some other way.

## E171 `mkp.input-type` error at `packages/core/src/check/doc.ts:397`

message: items[1] is {city: text, fact: text}, but the items before it are {city: text, fact: int}: every item has the same fields of the same types

block:
```
# Gallery

```mkp
picklist of T "Records the reader steps through."
  in items list(T) "the records"
  in title path(T, text) "the field shown in bold"
  column
    each k in 0..(len(items) - 1) key=k
      text (items[k][title])
  project md = "list"
```

```picklist
items:
  - {city: Lisbon, fact: 3}
  - {city: Oslo, fact: Skis}
title: city
summary: Two cities.
```

```

builder: Mixed field types across items. The message mentions "fields of the same types" but not which field differs; the reader has to compare the records.

- reader 1 (yes): The two items have different field types: `fact` is int in one and text in the other. | fix:   - {city: Oslo, fact: 3} | confusing: 
- reader 2 (yes): Every item in the list must have the same fields and types. The second item has fact as text, but the first has it as int. | fix:   - {city: Oslo, fact: 4} | confusing: 
- reader 3 (yes): The two items have the same fields, but the 'fact' value is an int in the first and text in the second, so the types differ. | fix:   - {city: Oslo, fact: 4} | confusing: 

## E172 `mkp.input-type` error at `packages/core/src/check/doc.ts:403`

message: picklist can't tell what T is: give the inputs that hold it

block:
```
# Gallery

```mkp
picklist of T "Records the reader steps through."
  in items list(T) "the records"
  in title path(T, text) "the field shown in bold"
  column
    each k in 0..(len(items) - 1) key=k
      text (items[k][title])
  project md = "list"
```

```picklist
title: city
summary: No cities.
```

```

builder: No data to infer T from. The message does not say which input to give; "the inputs that hold it" is vague.

- reader 1 (partly): The `picklist` cannot work out the type T from its inputs. The fixture gives `title` but no `items`, so nothing holds the record type. | fix: Add an items list to the fixture, e.g. `items: [{city: Oslo}]`. | confusing: The message says 'give the inputs that hold it', and I'm not sure whether that means the fixture or the definition.
- reader 2 (partly): T is known only from an input that holds records (items). The YAML gives title but no items. | fix: items: [{city: Oslo}] | confusing: The message does not say which input to give; I chose items, the list of records.
- reader 3 (partly): The picklist's T type cannot be worked out, because nothing gives it a value in this block. | fix: cannot infer (the inputs that hold T need to be given, but the block does not show which data to give) | confusing: The message says 'give the inputs that hold it', but I do not know what the items input should contain.

## E173 `mkp.doc-item` error at `packages/core/src/check/doc.ts:101`

message: a document defines widgets, parts, types and fns; a macro belongs in a pack

block:
```
# Notes

```mkp
macro R = $\mathbb{R}$

badge "A short label."
  in label text "what it says"
  text label
  project md = label
```

```

builder: Message grammar is uneven across the three branches: "a macro belongs in a pack". An interface cannot reach this site from a document (the parser refuses it first with mkp.syntax); macro was the easiest to trigger.

- reader 1 (yes): A document can't hold a `macro`; macros belong in a pack. | fix: Delete the macro line from the document and move it into a pack. | confusing: 
- reader 2 (yes): A macro cannot be declared in a document. Macros belong in a pack. | fix: Remove the 'macro R = …' line. | confusing: 
- reader 3 (yes): A macro is defined in a pack, not in a document. | fix: cannot infer | confusing: The macro needs to move into a pack file, which the block does not show.

## E174 `mkp.shadow` error at `packages/core/src/check/doc.ts:114`

message: iconname is already a base widget or type; give this one its own name

block:
```
# Notes

```mkp
type iconname = {label: text}

badge "A short label."
  in label text "what it says"
  text label
  project md = label
```

```

builder: Branch for a type: the message is the same as for a widget minus the show hint. I needed to find a core type name: text and color are primitives, not types; iconname worked. An author naming a type text would get no error here at all.

- reader 1 (yes): `iconname` is already a built-in type, so this type needs another name. | fix: type badgelabel = {label: text} | confusing: 
- reader 2 (yes): iconname is a base type, so the document cannot define a type with that name. | fix: type badgetext = {label: text} | confusing: 
- reader 3 (yes): 'iconname' is already the name of a base widget or type, so it cannot be used again. | fix: type notelabel = {label: text} | confusing: 

## E175 `mkp.doc-item` error at `packages/core/src/check/doc.ts:101`

message: a document defines widgets, parts, types and fns; tokens belongs in a pack

block:
```
# Notes

```mkp
tokens look@1 "Newsletter colours."
  color brand "#aa3300"

badge "A short label."
  in label text "what it says"
  text label
  project md = label
```

```

builder: Branch for tokens: grammar breaks ("tokens belongs in a pack") unlike "a macro belongs".

- reader 1 (yes): A document can define widgets, parts, types and fns. Tokens must go in a pack. | fix: Delete the `tokens look@1` block from this document and move it into a pack. | confusing: 
- reader 2 (yes): A document cannot define tokens. They belong in a pack. | fix: Move the tokens look@1 block into a pack file. | confusing: 
- reader 3 (yes): A document can define widgets, parts, types and fns only. Tokens belong in a pack. | fix: Move the 'tokens look@1' block into a pack file. | confusing: 

## E176 `mkp.input-type` error at `packages/core/src/check/doc.ts:397`

message: items is empty, so its items' type can't be told; give at least one

block:
```
# Gallery

```mkp
picklist of T "Records the reader steps through."
  in items list(T) "the records"
  column
    each k in 0..(len(items) - 1) key=k
      text "item"
  project md = "list"
```

```picklist
items: []
summary: No records.
```

```

builder: Second message of this site: an empty list. Message is clear.

- reader 1 (partly): The picklist's type T depends on items, but `items` is empty, so there is no item to read the type from. | fix: Give at least one item, e.g. `items: [{city: Oslo}]`. | confusing: 
- reader 2 (partly): items is empty, so the record type T cannot be found from it. At least one record is needed. | fix: cannot infer (the record fields are not shown) | confusing: I do not know the shape of a record here, so I cannot write one.
- reader 3 (no): The items list is empty, so the type of its items cannot be worked out. | fix: cannot infer | confusing: The message says to give at least one item, but I do not know what the items should contain.

## E177 `mkp.unknown-slot` error at `packages/core/src/check/doc.ts:620`

message: gallery has no slot "sidebar"

block:
```
# Gallery

```mkp
gallery "Panes listed one after another, with scores."
  in panes list(record pane {title: text, count: int, tone: color = accent} slot)
  in lead slot
  in aside slot
  in scores list(int 1..5) = []
  in marks list(color) = []
  in spot {x: num, y: num = 0} = {x: 0}
  in notes list(record note {text: text, links: list(record link {label: text, to: text})})
  column
    slot lead
    each k in 0..(len(scores) - 1) key=k
      text "\val{scores[k]}"
  project md = "gallery"
```

:::gallery
:::fill sidebar
Some words.
:::
:::

```

builder: Needed a widget with a first slot and another slot. The position is the :::fill line. No suggestion offered (sidebar vs aside).

- reader 1 (yes): The gallery has no slot called `sidebar`. The slots are `lead` and `aside`. | fix: :::fill aside | confusing: The `:::fill` syntax is inferred from the other `:::` examples, and I can't confirm it.
- reader 2 (yes): gallery has no slot named sidebar. Its slot is aside. | fix: :::fill aside | confusing: 
- reader 3 (yes): The gallery has no slot named 'sidebar'. Its slots are 'lead' and 'aside'. | fix: :::fill aside | confusing: 

## E178 `mkp.missing-input` error at `packages/core/src/check/doc.ts:633`

message: the pane record needs count

block:
```
# Gallery

```mkp
gallery "Panes listed one after another, with scores."
  in panes list(record pane {title: text, count: int, tone: color = accent} slot)
  in lead slot
  in aside slot
  in scores list(int 1..5) = []
  in marks list(color) = []
  in spot {x: num, y: num = 0} = {x: 0}
  in notes list(record note {text: text, links: list(record link {label: text, to: text})})
  column
    slot lead
    each k in 0..(len(scores) - 1) key=k
      text "\val{scores[k]}"
  project md = "gallery"
```

:::gallery
:::pane "First"
Some words.
:::
:::

```

builder: Container records take positional args; error does not say which positional values were expected or the record title.

- reader 1 (partly): The `pane` record needs a `count` value, but the `:::pane` block gives only a title and text. | fix: Add count to the pane, e.g. `:::pane "First" count=1`, but I cannot infer the exact `:::` syntax. | confusing: The `:::` container syntax is not explained, so I can't be sure how props go on that line.
- reader 2 (partly): A pane needs its count field, and the container gives none. | fix: :::pane "First" count=1 | confusing: I do not know the container's exact form, so count=1 is a guess.
- reader 3 (yes): The pane record needs a 'count' field, and the block gives only a title. | fix: :::pane "First" count=1 | confusing: 

## E179 `mkp.unknown-prop` error at `packages/core/src/check/doc.ts:683`

message: gallery has no input "colour"

block:
```
# Gallery

```mkp
gallery "Panes listed one after another, with scores."
  in panes list(record pane {title: text, count: int, tone: color = accent} slot)
  in lead slot
  in aside slot
  in scores list(int 1..5) = []
  in marks list(color) = []
  in spot {x: num, y: num = 0} = {x: 0}
  in notes list(record note {text: text, links: list(record link {label: text, to: text})})
  column
    slot lead
    each k in 0..(len(scores) - 1) key=k
      text "\val{scores[k]}"
  project md = "gallery"
```

```gallery
panes: []
summary: A gallery.
```
{colour=ok}

```

builder: Attributes line under a widget block. Compared to the YAML route (mkp.unknown-prop with a did-you-mean) the attribute route offers no suggestion.

- reader 1 (yes): The gallery has no `colour` input. The fence has a stray `{colour=ok}` line after the fence body, which is not valid there. | fix: Delete the `{colour=ok}` line from the gallery fence. | confusing: The message names the gallery input, but the stray line is outside the YAML, so I'm not sure which is the real error.
- reader 2 (yes): The stray {colour=ok} line after the YAML is read as an input named colour, and gallery has no such input. | fix: Delete the {colour=ok} line. | confusing: I did not expect a line after the YAML block to be read as input.
- reader 3 (partly): The gallery has no input called colour. There is a stray line '{colour=ok}' after the fence, which the message does not mention. | fix: Delete the line '{colour=ok}'. | confusing: The message says the gallery has no colour input, but the colour appears in the attribute line after the block, not in the gallery's data.

## E180 `mkp.no-slot` error at `packages/core/src/check/doc.ts:646`

message: badge has no slot to hold the container's Markdown

block:
```
# Notes

```mkp
badge "A short label."
  in label text "what it says"
  text label
  project md = label
```

:::badge label="New"
Extra words.
:::

```

builder: Writing label=New first gave an unrelated "New is not defined here" because container args are expressions; text values need quotes. Then the no-slot error is clear.

- reader 1 (partly): The badge has no slot to hold the Markdown inside the container, so the extra words can't be placed. | fix: Add a slot to the badge (e.g. `in body slot` and `slot body`), or remove the container. | confusing: I'm not sure how the container's Markdown is passed to a widget.
- reader 2 (partly): The container's Markdown has nowhere to go, because badge has no slot for it. | fix: cannot infer (remove the :::badge container, or give badge a slot to hold it) | confusing: I do not know how a container's body is meant to reach a widget.
- reader 3 (yes): The badge has no slot to hold the Markdown body given in the container, so the 'Extra words.' text has nowhere to go. | fix: Remove the 'Extra words.' line, or add 'in body slot' to the badge and a 'slot body' line in its layout. | confusing: 

## E181 `mkp.missing-field` error at `packages/core/src/check/doc.ts:23`

message: at.y's default (twice(2)) reads something YAML data can't: give it in the data

block:
```
# Notes

```mkp
fn twice(a: num): num = a 2

type spot = {x: num, y: num = twice(2)}

plot "A marked point."
  in at spot
  text "point"
  project md = "point"
```

```plot
at: {x: 2}
summary: A point.
```

```

builder: Hard: default values that are expressions are almost always constants. I needed a user fn call. The message is sound, but the failure comes from fields the author did not set, and the position is the block, not the default.

- reader 1 (yes): The default for `at.y` is `twice(2)`, a function call, which YAML data can't express. The value must be given in the data. | fix: at: {x: 2, y: 4} | confusing: 
- reader 2 (partly): A type's default is computed from twice(2), which YAML data cannot express. Also 'a 2' is not multiplication. | fix: fn twice(a: num): num = a * 2

type spot = {x: num, y: num} | confusing: I cannot tell whether the default was meant to be removed or kept in the data.
- reader 3 (partly): The default for 'y' in the spot type calls twice(2), which YAML data cannot compute. The value must be given in the data. | fix: at: {x: 2, y: 4} | confusing: The line 'a 2' in the twice fn looks like a typo for 'a * 2'.

## E182 `mkp.doc-size` error at `packages/core/src/check/doc.ts:96`

message: the document's own definitions are 813 lines; at most 800 — a definition used this much belongs in a pack

block:
```
# Price list

```mkp
pricelist "A long list of priced items."
  column
    text "Row 1: item 1"
    text "Row 2: item 2"
    text "Row 3: item 3"
    text "Row 4: item 4"
    text "Row 5: item 5"
    text "Row 6: item 6"
    text "Row 7: item 7"
    text "Row 8: item 8"
    text "Row 9: item 9"
    text "Row 10: item 10"
    text "Row 11: item 11"
    text "Row 12: item 12"
    text "Row 13: item 13"
    text "Row 14: item 14"
    text "Row 15: item 15"
    text "Row 16: item 16"
    text "Row 17: item 17"
    text "Row 18: item 18"
    text "Row 19: item 19"
    text "Row 20: item 20"
    text "Row 21: item 21"
    text "Row 22: item 22"
    text "Row 23: item 23"
    text "Row 24: item 24"
    text "Row 25: item 25"
    text "Row 26: item 26"
    text "Row 27: item 27"
    text "Row 28: item 28"
    text "Row 29: item 29"
    text "Row 30: item 30"
    text "Row 31: item 31"
    text "Row 32: item 32"
    text "Row 33: item 33"
    text "Row 34: item 34"
    text "Row 35: item 35"
    text "Row 36: item 36"
    text "Row 37: item 37"
    text "Row 38: item 38"
    text "Row 39: item 39"
    text "Row 40: item 40"
    text "Row 41: item 41"
    text "Row 42: item 42"
    text "Row 43: item 43"
    text "Row 44: item 44"
    text "Row 45: item 45"
    text "Row 46: item 46"
    text "Row 47: item 47"
    text "Row 48: item 48"
    text "Row 49: item 49"
    text "Row 50: item 50"
    text "Row 51: item 51"
    text "Row 52: item 52"
    text "Row 53: item 53"
    text "Row 54: item 54"
    text "Row 55: item 55"
    text "Row 56: item 56"
    text "Row 57: item 57"
    text "Row 58: item 58"
    text "Row 59: item 59"
    text "Row 60: item 60"
    text "Row 61: item 61"
    text "Row 62: item 62"
    text "Row 63: item 63"
    text "Row 64: item 64"
    text "Row 65: item 65"
    text "Row 66: item 66"
    text "Row 67: item 67"
    text "Row 68: item 68"
    text "Row 69: item 69"
    text "Row 70: item 70"
    text "Row 71: item 71"
    text "Row 72: item 72"
    text "Row 73: item 73"
    text "Row 74: item 74"
    text "Row 75: item 75"
    text "Row 76: item 76"
    text "Row 77: item 77"
    text "Row 78: item 78"
    text "Row 79: item 79"
    text "Row 80: item 80"
    text "Row 81: item 81"
    text "Row 82: item 82"
    text "Row 83: item 83"
    text "Row 84: item 84"
    text "Row 85: item 85"
    text "Row 86: item 86"
    text "Row 87: item 87"
    text "Row 88: item 88"
    text "Row 89: item 89"
    text "Row 90: item 90"
    text "Row 91: item 91"
    text "Row 92: item 92"
    text "Row 93: item 93"
    text "Row 94: item 94"
    text "Row 95: item 95"
    text "Row 96: item 96"
    text "Row 97: item 97"
    text "Row 98: item 98"
    text "Row 99: item 99"
    text "Row 100: item 100"
    text "Row 101: item 101"
    text "Row 102: item 102"
    text "Row 103: item 103"
    text "Row 104: item 104"
    text "Row 105: item 105"
    text "Row 106: item 106"
    text "Row 107: item 107"
    text "Row 108: item 108"
    text "Row 109: item 109"
    text "Row 110: item 110"
    text "Row 111: item 111"
    text "Row 112: item 112"
    text "Row 113: item 113"
    text "Row 114: item 114"
    text "Row 115: item 115"
    text "Row 116: item 116"
    text "Row 117: item 117"
    text "Row 118: item 118"
    text "Row 119: item 119"
    text "Row 120: item 120"
    text "Row 121: item 121"
    text "Row 122: item 122"
    text "Row 123: item 123"
    text "Row 124: item 124"
    text "Row 125: item 125"
    text "Row 126: item 126"
    text "Row 127: item 127"
    text "Row 128: item 128"
    text "Row 129: item 129"
    text "Row 130: item 130"
    text "Row 131: item 131"
    text "Row 132: item 132"
    text "Row 133: item 133"
    text "Row 134: item 134"
    text "Row 135: item 135"
    text "Row 136: item 136"
    text "Row 137: item 137"
    text "Row 138: item 138"
    text "Row 139: item 139"
    text "Row 140: item 140"
    text "Row 141: item 141"
    text "Row 142: item 142"
    text "Row 143: item 143"
    text "Row 144: item 144"
    text "Row 145: item 145"
    text "Row 146: item 146"
    text "Row 147: item 147"
    text "Row 148: item 148"
    text "Row 149: item 149"
    text "Row 150: item 150"
    text "Row 151: item 151"
    text "Row 152: item 152"
    text "Row 153: item 153"
    text "Row 154: item 154"
    text "Row 155: item 155"
    text "Row 156: item 156"
    text "Row 157: item 157"
    text "Row 158: item 158"
    text "Row 159: item 159"
    text "Row 160: item 160"
    text "Row 161: item 161"
    text "Row 162: item 162"
    text "Row 163: item 163"
    text "Row 164: item 164"
    text "Row 165: item 165"
    text "Row 166: item 166"
    text "Row 167: item 167"
    text "Row 168: item 168"
    text "Row 169: item 169"
    text "Row 170: item 170"
    text "Row 171: item 171"
    text "Row 172: item 172"
    text "Row 173: item 173"
    text "Row 174: item 174"
    text "Row 175: item 175"
    text "Row 176: item 176"
    text "Row 177: item 177"
    text "Row 178: item 178"
    text "Row 179: item 179"
    text "Row 180: item 180"
    text "Row 181: item 181"
    text "Row 182: item 182"
    text "Row 183: item 183"
    text "Row 184: item 184"
    text "Row 185: item 185"
    text "Row 186: item 186"
    text "Row 187: item 187"
    text "Row 188: item 188"
    text "Row 189: item 189"
    text "Row 190: item 190"
    text "Row 191: item 191"
    text "Row 192: item 192"
    text "Row 193: item 193"
    text "Row 194: item 194"
    text "Row 195: item 195"
    text "Row 196: item 196"
    text "Row 197: item 197"
    text "Row 198: item 198"
    text "Row 199: item 199"
    text "Row 200: item 200"
    text "Row 201: item 201"
    text "Row 202: item 202"
    text "Row 203: item 203"
    text "Row 204: item 204"
    text "Row 205: item 205"
    text "Row 206: item 206"
    text "Row 207: item 207"
    text "Row 208: item 208"
    text "Row 209: item 209"
    text "Row 210: item 210"
    text "Row 211: item 211"
    text "Row 212: item 212"
    text "Row 213: item 213"
    text "Row 214: item 214"
    text "Row 215: item 215"
    text "Row 216: item 216"
    text "Row 217: item 217"
    text "Row 218: item 218"
    text "Row 219: item 219"
    text "Row 220: item 220"
    text "Row 221: item 221"
    text "Row 222: item 222"
    text "Row 223: item 223"
    text "Row 224: item 224"
    text "Row 225: item 225"
    text "Row 226: item 226"
    text "Row 227: item 227"
    text "Row 228: item 228"
    text "Row 229: item 229"
    text "Row 230: item 230"
    text "Row 231: item 231"
    text "Row 232: item 232"
    text "Row 233: item 233"
    text "Row 234: item 234"
    text "Row 235: item 235"
    text "Row 236: item 236"
    text "Row 237: item 237"
    text "Row 238: item 238"
    text "Row 239: item 239"
    text "Row 240: item 240"
    text "Row 241: item 241"
    text "Row 242: item 242"
    text "Row 243: item 243"
    text "Row 244: item 244"
    text "Row 245: item 245"
    text "Row 246: item 246"
    text "Row 247: item 247"
    text "Row 248: item 248"
    text "Row 249: item 249"
    text "Row 250: item 250"
    text "Row 251: item 251"
    text "Row 252: item 252"
    text "Row 253: item 253"
    text "Row 254: item 254"
    text "Row 255: item 255"
    text "Row 256: item 256"
    text "Row 257: item 257"
    text "Row 258: item 258"
    text "Row 259: item 259"
    text "Row 260: item 260"
    text "Row 261: item 261"
    text "Row 262: item 262"
    text "Row 263: item 263"
    text "Row 264: item 264"
    text "Row 265: item 265"
    text "Row 266: item 266"
    text "Row 267: item 267"
    text "Row 268: item 268"
    text "Row 269: item 269"
    text "Row 270: item 270"
    text "Row 271: item 271"
    text "Row 272: item 272"
    text "Row 273: item 273"
    text "Row 274: item 274"
    text "Row 275: item 275"
    text "Row 276: item 276"
    text "Row 277: item 277"
    text "Row 278: item 278"
    text "Row 279: item 279"
    text "Row 280: item 280"
    text "Row 281: item 281"
    text "Row 282: item 282"
    text "Row 283: item 283"
    text "Row 284: item 284"
    text "Row 285: item 285"
    text "Row 286: item 286"
    text "Row 287: item 287"
    text "Row 288: item 288"
    text "Row 289: item 289"
    text "Row 290: item 290"
    text "Row 291: item 291"
    text "Row 292: item 292"
    text "Row 293: item 293"
    text "Row 294: item 294"
    text "Row 295: item 295"
    text "Row 296: item 296"
    text "Row 297: item 297"
    text "Row 298: item 298"
    text "Row 299: item 299"
    text "Row 300: item 300"
    text "Row 301: item 301"
    text "Row 302: item 302"
    text "Row 303: item 303"
    text "Row 304: item 304"
    text "Row 305: item 305"
    text "Row 306: item 306"
    text "Row 307: item 307"
    text "Row 308: item 308"
    text "Row 309: item 309"
    text "Row 310: item 310"
    text "Row 311: item 311"
    text "Row 312: item 312"
    text "Row 313: item 313"
    text "Row 314: item 314"
    text "Row 315: item 315"
    text "Row 316: item 316"
    text "Row 317: item 317"
    text "Row 318: item 318"
    text "Row 319: item 319"
    text "Row 320: item 320"
    text "Row 321: item 321"
    text "Row 322: item 322"
    text "Row 323: item 323"
    text "Row 324: item 324"
    text "Row 325: item 325"
    text "Row 326: item 326"
    text "Row 327: item 327"
    text "Row 328: item 328"
    text "Row 329: item 329"
    text "Row 330: item 330"
    text "Row 331: item 331"
    text "Row 332: item 332"
    text "Row 333: item 333"
    text "Row 334: item 334"
    text "Row 335: item 335"
    text "Row 336: item 336"
    text "Row 337: item 337"
    text "Row 338: item 338"
    text "Row 339: item 339"
    text "Row 340: item 340"
    text "Row 341: item 341"
    text "Row 342: item 342"
    text "Row 343: item 343"
    text "Row 344: item 344"
    text "Row 345: item 345"
    text "Row 346: item 346"
    text "Row 347: item 347"
    text "Row 348: item 348"
    text "Row 349: item 349"
    text "Row 350: item 350"
    text "Row 351: item 351"
    text "Row 352: item 352"
    text "Row 353: item 353"
    text "Row 354: item 354"
    text "Row 355: item 355"
    text "Row 356: item 356"
    text "Row 357: item 357"
    text "Row 358: item 358"
    text "Row 359: item 359"
    text "Row 360: item 360"
    text "Row 361: item 361"
    text "Row 362: item 362"
    text "Row 363: item 363"
    text "Row 364: item 364"
    text "Row 365: item 365"
    text "Row 366: item 366"
    text "Row 367: item 367"
    text "Row 368: item 368"
    text "Row 369: item 369"
    text "Row 370: item 370"
    text "Row 371: item 371"
    text "Row 372: item 372"
    text "Row 373: item 373"
    text "Row 374: item 374"
    text "Row 375: item 375"
    text "Row 376: item 376"
    text "Row 377: item 377"
    text "Row 378: item 378"
    text "Row 379: item 379"
    text "Row 380: item 380"
    text "Row 381: item 381"
    text "Row 382: item 382"
    text "Row 383: item 383"
    text "Row 384: item 384"
    text "Row 385: item 385"
    text "Row 386: item 386"
    text "Row 387: item 387"
    text "Row 388: item 388"
    text "Row 389: item 389"
    text "Row 390: item 390"
    text "Row 391: item 391"
    text "Row 392: item 392"
    text "Row 393: item 393"
    text "Row 394: item 394"
    text "Row 395: item 395"
    text "Row 396: item 396"
    text "Row 397: item 397"
    text "Row 398: item 398"
    text "Row 399: item 399"
    text "Row 400: item 400"
    text "Row 401: item 401"
    text "Row 402: item 402"
    text "Row 403: item 403"
    text "Row 404: item 404"
    text "Row 405: item 405"
    text "Row 406: item 406"
    text "Row 407: item 407"
    text "Row 408: item 408"
    text "Row 409: item 409"
    text "Row 410: item 410"
    text "Row 411: item 411"
    text "Row 412: item 412"
    text "Row 413: item 413"
    text "Row 414: item 414"
    text "Row 415: item 415"
    text "Row 416: item 416"
    text "Row 417: item 417"
    text "Row 418: item 418"
    text "Row 419: item 419"
    text "Row 420: item 420"
    text "Row 421: item 421"
    text "Row 422: item 422"
    text "Row 423: item 423"
    text "Row 424: item 424"
    text "Row 425: item 425"
    text "Row 426: item 426"
    text "Row 427: item 427"
    text "Row 428: item 428"
    text "Row 429: item 429"
    text "Row 430: item 430"
    text "Row 431: item 431"
    text "Row 432: item 432"
    text "Row 433: item 433"
    text "Row 434: item 434"
    text "Row 435: item 435"
    text "Row 436: item 436"
    text "Row 437: item 437"
    text "Row 438: item 438"
    text "Row 439: item 439"
    text "Row 440: item 440"
    text "Row 441: item 441"
    text "Row 442: item 442"
    text "Row 443: item 443"
    text "Row 444: item 444"
    text "Row 445: item 445"
    text "Row 446: item 446"
    text "Row 447: item 447"
    text "Row 448: item 448"
    text "Row 449: item 449"
    text "Row 450: item 450"
    text "Row 451: item 451"
    text "Row 452: item 452"
    text "Row 453: item 453"
    text "Row 454: item 454"
    text "Row 455: item 455"
    text "Row 456: item 456"
    text "Row 457: item 457"
    text "Row 458: item 458"
    text "Row 459: item 459"
    text "Row 460: item 460"
    text "Row 461: item 461"
    text "Row 462: item 462"
    text "Row 463: item 463"
    text "Row 464: item 464"
    text "Row 465: item 465"
    text "Row 466: item 466"
    text "Row 467: item 467"
    text "Row 468: item 468"
    text "Row 469: item 469"
    text "Row 470: item 470"
    text "Row 471: item 471"
    text "Row 472: item 472"
    text "Row 473: item 473"
    text "Row 474: item 474"
    text "Row 475: item 475"
    text "Row 476: item 476"
    text "Row 477: item 477"
    text "Row 478: item 478"
    text "Row 479: item 479"
    text "Row 480: item 480"
    text "Row 481: item 481"
    text "Row 482: item 482"
    text "Row 483: item 483"
    text "Row 484: item 484"
    text "Row 485: item 485"
    text "Row 486: item 486"
    text "Row 487: item 487"
    text "Row 488: item 488"
    text "Row 489: item 489"
    text "Row 490: item 490"
    text "Row 491: item 491"
    text "Row 492: item 492"
    text "Row 493: item 493"
    text "Row 494: item 494"
    text "Row 495: item 495"
    text "Row 496: item 496"
    text "Row 497: item 497"
    text "Row 498: item 498"
    text "Row 499: item 499"
    text "Row 500: item 500"
    text "Row 501: item 501"
    text "Row 502: item 502"
    text "Row 503: item 503"
    text "Row 504: item 504"
    text "Row 505: item 505"
    text "Row 506: item 506"
    text "Row 507: item 507"
    text "Row 508: item 508"
    text "Row 509: item 509"
    text "Row 510: item 510"
    text "Row 511: item 511"
    text "Row 512: item 512"
    text "Row 513: item 513"
    text "Row 514: item 514"
    text "Row 515: item 515"
    text "Row 516: item 516"
    text "Row 517: item 517"
    text "Row 518: item 518"
    text "Row 519: item 519"
    text "Row 520: item 520"
    text "Row 521: item 521"
    text "Row 522: item 522"
    text "Row 523: item 523"
    text "Row 524: item 524"
    text "Row 525: item 525"
    text "Row 526: item 526"
    text "Row 527: item 527"
    text "Row 528: item 528"
    text "Row 529: item 529"
    text "Row 530: item 530"
    text "Row 531: item 531"
    text "Row 532: item 532"
    text "Row 533: item 533"
    text "Row 534: item 534"
    text "Row 535: item 535"
    text "Row 536: item 536"
    text "Row 537: item 537"
    text "Row 538: item 538"
    text "Row 539: item 539"
    text "Row 540: item 540"
    text "Row 541: item 541"
    text "Row 542: item 542"
    text "Row 543: item 543"
    text "Row 544: item 544"
    text "Row 545: item 545"
    text "Row 546: item 546"
    text "Row 547: item 547"
    text "Row 548: item 548"
    text "Row 549: item 549"
    text "Row 550: item 550"
    text "Row 551: item 551"
    text "Row 552: item 552"
    text "Row 553: item 553"
    text "Row 554: item 554"
    text "Row 555: item 555"
    text "Row 556: item 556"
    text "Row 557: item 557"
    text "Row 558: item 558"
    text "Row 559: item 559"
    text "Row 560: item 560"
    text "Row 561: item 561"
    text "Row 562: item 562"
    text "Row 563: item 563"
    text "Row 564: item 564"
    text "Row 565: item 565"
    text "Row 566: item 566"
    text "Row 567: item 567"
    text "Row 568: item 568"
    text "Row 569: item 569"
    text "Row 570: item 570"
    text "Row 571: item 571"
    text "Row 572: item 572"
    text "Row 573: item 573"
    text "Row 574: item 574"
    text "Row 575: item 575"
    text "Row 576: item 576"
    text "Row 577: item 577"
    text "Row 578: item 578"
    text "Row 579: item 579"
    text "Row 580: item 580"
    text "Row 581: item 581"
    text "Row 582: item 582"
    text "Row 583: item 583"
    text "Row 584: item 584"
    text "Row 585: item 585"
    text "Row 586: item 586"
    text "Row 587: item 587"
    text "Row 588: item 588"
    text "Row 589: item 589"
    text "Row 590: item 590"
    text "Row 591: item 591"
    text "Row 592: item 592"
    text "Row 593: item 593"
    text "Row 594: item 594"
    text "Row 595: item 595"
    text "Row 596: item 596"
    text "Row 597: item 597"
    text "Row 598: item 598"
    text "Row 599: item 599"
    text "Row 600: item 600"
    text "Row 601: item 601"
    text "Row 602: item 602"
    text "Row 603: item 603"
    text "Row 604: item 604"
    text "Row 605: item 605"
    text "Row 606: item 606"
    text "Row 607: item 607"
    text "Row 608: item 608"
    text "Row 609: item 609"
    text "Row 610: item 610"
    text "Row 611: item 611"
    text "Row 612: item 612"
    text "Row 613: item 613"
    text "Row 614: item 614"
    text "Row 615: item 615"
    text "Row 616: item 616"
    text "Row 617: item 617"
    text "Row 618: item 618"
    text "Row 619: item 619"
    text "Row 620: item 620"
    text "Row 621: item 621"
    text "Row 622: item 622"
    text "Row 623: item 623"
    text "Row 624: item 624"
    text "Row 625: item 625"
    text "Row 626: item 626"
    text "Row 627: item 627"
    text "Row 628: item 628"
    text "Row 629: item 629"
    text "Row 630: item 630"
    text "Row 631: item 631"
    text "Row 632: item 632"
    text "Row 633: item 633"
    text "Row 634: item 634"
    text "Row 635: item 635"
    text "Row 636: item 636"
    text "Row 637: item 637"
    text "Row 638: item 638"
    text "Row 639: item 639"
    text "Row 640: item 640"
    text "Row 641: item 641"
    text "Row 642: item 642"
    text "Row 643: item 643"
    text "Row 644: item 644"
    text "Row 645: item 645"
    text "Row 646: item 646"
    text "Row 647: item 647"
    text "Row 648: item 648"
    text "Row 649: item 649"
    text "Row 650: item 650"
    text "Row 651: item 651"
    text "Row 652: item 652"
    text "Row 653: item 653"
    text "Row 654: item 654"
    text "Row 655: item 655"
    text "Row 656: item 656"
    text "Row 657: item 657"
    text "Row 658: item 658"
    text "Row 659: item 659"
    text "Row 660: item 660"
    text "Row 661: item 661"
    text "Row 662: item 662"
    text "Row 663: item 663"
    text "Row 664: item 664"
    text "Row 665: item 665"
    text "Row 666: item 666"
    text "Row 667: item 667"
    text "Row 668: item 668"
    text "Row 669: item 669"
    text "Row 670: item 670"
    text "Row 671: item 671"
    text "Row 672: item 672"
    text "Row 673: item 673"
    text "Row 674: item 674"
    text "Row 675: item 675"
    text "Row 676: item 676"
    text "Row 677: item 677"
    text "Row 678: item 678"
    text "Row 679: item 679"
    text "Row 680: item 680"
    text "Row 681: item 681"
    text "Row 682: item 682"
    text "Row 683: item 683"
    text "Row 684: item 684"
    text "Row 685: item 685"
    text "Row 686: item 686"
    text "Row 687: item 687"
    text "Row 688: item 688"
    text "Row 689: item 689"
    text "Row 690: item 690"
    text "Row 691: item 691"
    text "Row 692: item 692"
    text "Row 693: item 693"
    text "Row 694: item 694"
    text "Row 695: item 695"
    text "Row 696: item 696"
    text "Row 697: item 697"
    text "Row 698: item 698"
    text "Row 699: item 699"
    text "Row 700: item 700"
    text "Row 701: item 701"
    text "Row 702: item 702"
    text "Row 703: item 703"
    text "Row 704: item 704"
    text "Row 705: item 705"
    text "Row 706: item 706"
    text "Row 707: item 707"
    text "Row 708: item 708"
    text "Row 709: item 709"
    text "Row 710: item 710"
    text "Row 711: item 711"
    text "Row 712: item 712"
    text "Row 713: item 713"
    text "Row 714: item 714"
    text "Row 715: item 715"
    text "Row 716: item 716"
    text "Row 717: item 717"
    text "Row 718: item 718"
    text "Row 719: item 719"
    text "Row 720: item 720"
    text "Row 721: item 721"
    text "Row 722: item 722"
    text "Row 723: item 723"
    text "Row 724: item 724"
    text "Row 725: item 725"
    text "Row 726: item 726"
    text "Row 727: item 727"
    text "Row 728: item 728"
    text "Row 729: item 729"
    text "Row 730: item 730"
    text "Row 731: item 731"
    text "Row 732: item 732"
    text "Row 733: item 733"
    text "Row 734: item 734"
    text "Row 735: item 735"
    text "Row 736: item 736"
    text "Row 737: item 737"
    text "Row 738: item 738"
    text "Row 739: item 739"
    text "Row 740: item 740"
    text "Row 741: item 741"
    text "Row 742: item 742"
    text "Row 743: item 743"
    text "Row 744: item 744"
    text "Row 745: item 745"
    text "Row 746: item 746"
    text "Row 747: item 747"
    text "Row 748: item 748"
    text "Row 749: item 749"
    text "Row 750: item 750"
    text "Row 751: item 751"
    text "Row 752: item 752"
    text "Row 753: item 753"
    text "Row 754: item 754"
    text "Row 755: item 755"
    text "Row 756: item 756"
    text "Row 757: item 757"
    text "Row 758: item 758"
    text "Row 759: item 759"
    text "Row 760: item 760"
    text "Row 761: item 761"
    text "Row 762: item 762"
    text "Row 763: item 763"
    text "Row 764: item 764"
    text "Row 765: item 765"
    text "Row 766: item 766"
    text "Row 767: item 767"
    text "Row 768: item 768"
    text "Row 769: item 769"
    text "Row 770: item 770"
    text "Row 771: item 771"
    text "Row 772: item 772"
    text "Row 773: item 773"
    text "Row 774: item 774"
    text "Row 775: item 775"
    text "Row 776: item 776"
    text "Row 777: item 777"
    text "Row 778: item 778"
    text "Row 779: item 779"
    text "Row 780: item 780"
    text "Row 781: item 781"
    text "Row 782: item 782"
    text "Row 783: item 783"
    text "Row 784: item 784"
    text "Row 785: item 785"
    text "Row 786: item 786"
    text "Row 787: item 787"
    text "Row 788: item 788"
    text "Row 789: item 789"
    text "Row 790: item 790"
    text "Row 791: item 791"
    text "Row 792: item 792"
    text "Row 793: item 793"
    text "Row 794: item 794"
    text "Row 795: item 795"
    text "Row 796: item 796"
    text "Row 797: item 797"
    text "Row 798: item 798"
    text "Row 799: item 799"
    text "Row 800: item 800"
    text "Row 801: item 801"
    text "Row 802: item 802"
    text "Row 803: item 803"
    text "Row 804: item 804"
    text "Row 805: item 805"
    text "Row 806: item 806"
    text "Row 807: item 807"
    text "Row 808: item 808"
    text "Row 809: item 809"
    text "Row 810: item 810"
  project md = "A long price list."
```

```pricelist
summary: A long list of priced items.
```

```

builder: Needs 800+ lines of definitions; I generated them. The message is clear and suggests a pack.

- reader 1 (yes): The document's definition is 813 lines, and the limit is 800. The long list must move into a pack. | fix: Move the pricelist definition into a pack, or reduce its rows to fewer than 800 lines. | confusing: 
- reader 2 (yes): The document's own definition is 813 lines, over the 800 limit. A definition this large belongs in a pack. | fix: cannot infer (cut the repeated text rows so the definition is at most 800 lines, or move pricelist into a pack) | confusing: I cannot tell which lines the count includes.
- reader 3 (yes): The document's own definitions are 813 lines, and the limit is 800. A list this big belongs in a pack. | fix: Move the pricelist widget and its rows into a pack file. | confusing: The message says the definitions are 813 lines, and the block's repeated rows make the count hard to check by hand.

## E183 `mkp.input-type` error at `packages/core/src/check/doc.ts:400`

message: T is {city: text} in one place and {year: int} in another

block:
```
# Gallery

```mkp
picklist of T "Records the reader steps through."
  in items list(T) "the records"
  in more list(T) "more records"
  column
    each k in 0..(len(items) - 1) key=k
      text "item"
  project md = "list"
```

```picklist
items:
  - {city: Lisbon}
more:
  - {year: 1755}
summary: Two lists.
```

```

builder: Needed two inputs both of type list(T) with different record shapes. Message uses T, a jargon letter the author never wrote in the document; the two shapes are shown, which helps.

- reader 1 (yes): T is `{city: text}` in `items`, but `{year: int}` in `more`, so the two lists disagree on the record's fields. | fix: Give both lists the same fields, e.g. `- {city: Lisbon}` and `- {city: "1755"}`, or use two separate parts. | confusing: 
- reader 2 (yes): items and more are both lists of T, so their records must have the same fields. Their fields differ. | fix: more:
  - {city: Porto} | confusing: 
- reader 3 (yes): The two lists both use T, but 'items' has records of shape {city: text} and 'more' has {year: int}, which differ. | fix: more:
  - {city: Porto} | confusing: 

