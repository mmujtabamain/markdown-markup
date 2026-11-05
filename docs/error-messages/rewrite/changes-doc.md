# Changes: packages/core/src/check/doc.ts

Every error and warning raised in `check/doc.ts` now reads: what is wrong and where, what was
found, and the fix (with an example). Codes and severities are unchanged. Behaviour is unchanged
except for words and positions (core tests on HEAD + this file: 851 pass, 1 fails on wording only:
`redesign.test.ts` "a wrong value in a YAML list item is reported at that item" expects
`xs[1] is a whole number`; it now reads `xs[1] takes a whole number; found "two". …`, at the same position).

## Dataset rows (replayed with `replay.py --build check/doc.ts`)

| id | code | before | after |
|---|---|---|---|
| E134 | `mkp.doc-state` | a state block holds state lines only (name = control …) | a state block holds only var lines and state lines, name = control (slider, toggle, choice, steps, drag or clock), e.g. n = slider 0..10 "how many"; found a widget line, text "hello". Move it out of the state block, or Remove it |
| E135 | `mkp.duplicate-anchor` | #setup is already the anchor of the block on line 1; give this one another | #setup is already the anchor of the block on line 1, and an anchor names one block only; found {#setup} again here. Rename this one, e.g. {#setup-2} |
| E136 | `mkp.front-matter` | front matter must be a YAML mapping | the front matter must be a YAML mapping of key: value lines; found a list. Write each entry as key: value, e.g. title: Notes |
| E137 | `mkp.front-matter` | front matter is not valid YAML: Missing closing "quote at line 2, column 12: | the front matter has a value that opens with " but never closes it; found title: "Notes. Add the closing " at the end of the value, e.g. title: "Notes" |
| E138 | `mkp.front-matter` | front matter is not valid YAML: front matter holds a control character (\t); a backslash in "double quotes" is an escape, so write LaTeX in 'single quotes' (e.g. '\theta') | the front matter has a tab (\t) in teaches, where a backslash was meant: in "double quotes" \t is an escape, so the backslash is lost. Write LaTeX in 'single quotes' instead: teaches: 'angle \theta in a triangle' |
| E139 | `mkp.markdown` | link reference definitions are not supported; write links inline | link reference definitions are not supported; write links inline |
| E140 | `mkp.attrs` | attribute tone on a Markdown block is ignored; only #id, role= (on headings) and the profile's block attributes apply | the attribute tone=warn on a Markdown block is ignored; a Markdown block takes only an anchor {#id}, role= on a heading. Remove it, or move it to a widget block that has a tone input |
| E141 | `mkp.markdown` | raw HTML is shown as text; MKP content has no HTML (use a widget) | raw HTML is shown as text; MKP content has no HTML (use a widget) |
| E142 | `mkp.unknown-widget` | there is no widget "pannel" (did you mean "panel"?) | the fence names a widget "pannel", but no widget of that name is defined in this document or its packs. Did you mean "panel"? Write ```panel |
| E143 | `mkp.yaml` | the panel block is not valid YAML: Nested mappings are not allowed in compact mappings at line 1, column 8: | the panel block has a value with ": " (a colon and a space) in it, which YAML reads as a second key; found title: Hello: world. Quote the value: title: "Hello: world" |
| E144 | `mkp.yaml` | the panel block must be a YAML mapping of its inputs | the panel block must be a YAML mapping of its inputs, one name: value line each; found a list. Write each input on its own line, e.g. title: Some text |
| E145 | `mkp.missing-summary` | the panel block needs a summary: line (what it shows, for readers without the widget and for Markdown output) | the panel block needs a summary: line, one sentence of what it shows, for readers without the widget and for Markdown output; found no summary: line. Add one, e.g. summary: A short sentence on what it shows. |
| E146 | `mkp.unknown-prop` | panel has no input "colour" | panel has no input "colour"; found colour: ok, and its inputs are title, size, lit, tone, mode, body. Rename the key to one of them, or Remove the line |
| E147 | `mkp.input-type` | body is a slot: give it a Markdown string | body is a slot, which takes Markdown written as one piece of text; found a list. Write it as text, e.g. body: "Some words.", or as body: \| with the Markdown indented on the lines below |
| E148 | `mkp.input-type` | size is a whole number; found "big" | size takes a whole number from 1 to 5; found "big". Replace it, e.g. with size: 1 |
| E149 | `mkp.input-range` | size is 9, outside 1..5 | size must be from 1 to 5; found 9. Write a number in that range, e.g. size: 5 |
| E150 | `mkp.input-type` | lit is true or false; "yes" is text in YAML 1.2: write true | lit takes true or false; found yes, which YAML 1.2 reads as text, not as yes or no. Write lit: true |
| E151 | `mkp.enum` | mode is one of plain, bold; found "italic" | mode takes one of plain, bold; found "italic". Write one of them, e.g. mode: plain |
| E152 | `mkp.unknown-token` | "green" is not a color token; tone takes a color token: none, surface, ink, muted, line, accent, info, ok, warn, bad, c1, c2, c3, c4, c5, c6 | tone takes a color token: none, surface, ink, muted, line, accent, info, ok, warn, bad, c1, c2, c3, c4, c5, c6; found "green", which is not a color token name. Write one of those names, e.g. tone: accent |
| E153 | `mkp.not-state` | "volume" is not declared in a state block of this document | level refers to the state "volume", but no state block of this document declares it. Declare it in a ```state block, e.g. volume = slider 0..10 "volume" |
| E154 | `mkp.input-type` | level is num, but volume is bool | level takes state that is a number, but the state volume is true or false. Refer to state that is a number, or declare volume with another control, e.g. volume = slider 0..10 "volume" |
| E155 | `mkp.input-type` | panes is a list of pane records: give a YAML list of objects | panes is a list of pane records, each written as its fields (title, count, tone, slot); found the text "first". Write it as a YAML list, e.g. panes: [{title: Some text, count: 1}] |
| E156 | `mkp.input-type` | each pane is an object of its fields | panes[0] must be one pane record, written as its fields (title, count, tone, slot); found the text "first". Write it as - {title: Some text, count: 1} |
| E157 | `mkp.input-type` | the pane slot is a Markdown string | slot in panes[0] is the pane's Markdown content, written as one piece of text; found a list. Write it as text, e.g. slot: "Some words." |
| E158 | `mkp.unknown-field` | pane has no field "colour" | panes[0] has no field "colour"; a pane's fields are title, count, tone, slot. Rename it to one of them, or Remove it |
| E159 | `mkp.input-type` | links is a list of link records | links in notes[0] is a list of link records, each written as its fields (label, to); found the text "https://example.org". Write it as a YAML list, e.g. links: [{label: Some text, to: Some text}] |
| E160 | `mkp.missing-input` | pane needs count (int) | panes[0] (a pane) is missing count, which takes a whole number; found only title. Add it, e.g. count: 1 |
| E161 | `mkp.input-type` | scores[1] is a whole number; found "two" | scores[1] takes a whole number from 1 to 5; found "two". Replace it, e.g. with 1 |
| E162 | `mkp.input-range` | scores[1] is 7, outside 1..5 | scores[1] must be from 1 to 5; found 7. Write a number in that range, e.g. 5 |
| E163 | `mkp.unknown-token` | "green" is not a color token; marks[1] takes a color token: none, surface, ink, muted, line, accent, info, ok, warn, bad, c1, c2, c3, c4, c5, c6 | marks[1] takes a color token: none, surface, ink, muted, line, accent, info, ok, warn, bad, c1, c2, c3, c4, c5, c6; found "green", which is not a color token name. Write one of those names, e.g. accent |
| E164 | `mkp.unknown-field` | spot has no field "z" (did you mean "x"?) | spot has no field "z"; its fields are x, y. Did you mean "y"? Rename it |
| E165 | `mkp.missing-field` | spot needs x (num) | spot is missing the field x, which takes a number; found only y. Add it, e.g. spot: {x: 1, y: 2} |
| E166 | `mkp.shadow` | "document" is reserved for the document itself; name the definition something else | the name "document" is reserved for the document itself, so this definition can't use it. Rename it, e.g. my_document, and use the new name in its blocks too |
| E167 | `mkp.shadow` | row is already a base widget or type; give this one its own name (mkp show --source --as copies one renamed) | row is already a base widget, so this widget needs a name of its own. Rename it, e.g. my_row; to change the existing one, copy it under a new name with mkp show row --source --as my_row |
| E168 | `mkp.no-project` | badge has no project md: a document's widget says in Markdown what it shows, for readers without it | badge has no project md line, which every widget defined in a document needs: it is the Markdown readers without MKP see in its place. Add one at the end of the definition, e.g. project md = label |
| E169 | `mkp.yaml-control-char` | the panel block holds a control character (\t); a backslash in "double quotes" is an escape, so write LaTeX in 'single quotes' (e.g. '\theta') | the panel block has a tab (\t) in title, where a backslash was meant: in "double quotes" \t is an escape, so the backslash is lost. Write LaTeX in 'single quotes' instead: title: 'angle \theta' |
| E170 | `mkp.part-in-document` | tile is a part; parts are used inside definitions, not in documents | tile is a part, which only other definitions can use, so it can't be a block in a document. Use it inside a widget in an mkp fence, or drop "part" from its definition (and give it a project md) to use it here |
| E171 | `mkp.input-type` | items[1] is {city: text, fact: text}, but the items before it are {city: text, fact: int}: every item has the same fields of the same types | items[1] is not like the items before it: its fact is text, but in the items before it fact is a whole number. Write fact as a whole number here too, or as text in every item |
| E172 | `mkp.input-type` | picklist can't tell what T is: give the inputs that hold it | picklist can't tell what T is (T stands for the kind of items it holds, read from the data), since no input that holds T is given; found only title. Add items (list(T)), e.g. items: [{city: Lisbon}] |
| E173 | `mkp.doc-item` | a document defines widgets, parts, types and fns; a macro belongs in a pack | a document's mkp fence may define widgets, parts, types, fns and consts, but not a maths macro; found macro R. Move it into a pack, or Remove it from the fence |
| E174 | `mkp.shadow` | iconname is already a base widget or type; give this one its own name | iconname is already a base type, so this type needs a name of its own. Rename it, e.g. my_iconname |
| E175 | `mkp.doc-item` | a document defines widgets, parts, types and fns; tokens belongs in a pack | a document's mkp fence may define widgets, parts, types, fns and consts, but not a tokens set; found tokens look. Move it into a pack, or Remove it from the fence |
| E176 | `mkp.input-type` | items is empty, so its items' type can't be told; give at least one | items is an empty list, so picklist can't tell what kind of items it holds; found []. Give at least one item, e.g. items: [{city: Lisbon}] |
| E177 | `mkp.unknown-slot` | gallery has no slot "sidebar" | gallery has no slot "sidebar"; its slots are lead, aside (the Markdown written straight inside :::gallery goes to lead). Write :::fill aside |
| E178 | `mkp.missing-input` | the pane record needs count | the :::pane "First" record is missing count, which takes a whole number; its fields, in order, are title, count, tone. Add it on the ::: line, by position or by name, e.g. :::pane "First" count=1 |
| E179 | `mkp.unknown-prop` | gallery has no input "colour" | gallery has no input "colour"; found {colour=ok} under the block, and its inputs are panes, lead, aside, scores, marks, spot, notes. Rename the attribute to one of them, or Remove it |
| E180 | `mkp.no-slot` | badge has no slot to hold the container's Markdown | badge has no slot, so the Markdown inside :::badge … ::: has nowhere to go; found "Extra words.". Remove the Markdown between the ::: lines, or write the widget as a ```badge block instead |
| E181 | `mkp.missing-field` | at.y's default (twice(2)) reads something YAML data can't: give it in the data | at.y is left out, and its default twice(2) is a calculation that YAML data can't work out. Write y yourself in at, e.g. {…, y: 4}, or make the default a plain value in the type |
| E182 | `mkp.doc-size` | the document's own definitions are 813 lines; at most 800 — a definition used this much belongs in a pack | the document's own definitions (its mkp fences, blank lines not counted) are 813 lines, over the limit of 800. Move the larger definitions into a pack and use them from there, or shorten them |
| E183 | `mkp.input-type` | T is {city: text} in one place and {year: int} in another | more and items must hold the same kind of items, since picklist uses one type T for both (T stands for the kind of items it holds, read from the data); found {year: int} in more but {city: text} in items. Give the items of both the same fields with the same kinds of value |

## Sites with no dataset row

| code | before | after (shape) |
|---|---|---|
| `mkp.yaml` / `mkp.front-matter` (YAML library errors) | `the X block is not valid YAML: <library first line>` | rephrased per library code by `yamlProblem()`, e.g. duplicate key: `the panel block gives title twice, and each key may appear once; found a second title: here. Remove one of them, or rename it`; bad escape: `… has \s inside "double quotes", where a backslash starts an escape and \s is not one. Write LaTeX in 'single quotes': summary: 'angle \sqrt{2}'`; tab indent, reserved first char (`@`, backtick: "Quote it"), unclosed `[`/`{`, unequal indentation, a line that is not `key: value`, text after a value, missing comma, `#` without a space, unset `*alias`. Unknown codes: `… is not valid YAML here: <library text>; found <line>. Check the quoting on this line …` |
| `mkp.input-type` (bad value, all types in `yamlValue`/`yamlData`) | `<what> is <want>; found <json>` | `<what> takes <want>; found <value>. Replace it, e.g. with <what>: <example>`; a quoted number adds `(a number in quotes is text: remove the quotes)` |
| `mkp.input-type` (ref not `{ref: …}`) | `level is {ref: name} of a state line in a state block; found 3` | `level takes a reference to number state, written {ref: name} with the name of a line in a state block; found 3. Replace it, e.g. with level: {ref: volume}` |
| `mkp.input-type` (type YAML can't give) | `x is a T (which YAML can't give); found …` | `x takes T, which a value written in YAML can't be; found …. Pass x from a widget definition instead, or give it a type YAML can write (text, a number, a list, a record)` |
| `mkp.input-type` (bindYaml, empty entry) | `items[1] has no value` (def.ts text) | `items[1] has no value; found an empty entry. Write a value after it, or Remove it` (at the item) |
| `mkp.input-type` (bindYaml, items with different fields) | `items[1] is {…}, but the items before it are {…}: every item has the same fields of the same types` | `items[1] is not like the items before it: it has the fields city, fact, where the items before it have city; every item of items needs the same fields. Remove fact, or give the others the same fields` |
| `mkp.missing-summary` (summary present but empty / not text) | as E145 | `… found an empty summary` / `found summary: 3, which is not a sentence`, at the summary line |
| `mkp.missing-input` (container) | `panel needs title: text` | `the :::panel container is missing title, which takes text. Add it to the ::: line, e.g. :::panel title="Some text"`; a records input: `… Add pane records inside it, e.g. a :::pane "Some text" line, its Markdown, and a closing :::` |
| `mkp.missing-input` (YAML block) | `panel needs title: text` | `the panel block is missing title, which takes text. Add a line title: Some text` |
| `mkp.unknown-slot` (widget with no slots) | `x has no slot "y"` | `x has no slots, so :::fill y has nothing to fill. Remove the :::fill container, or use a widget that holds Markdown` |
| `mkp.not-state` (other state declared) | as E153 | adds `; the state declared here is volume. Did you mean {ref: volume}? Or declare it …` |
| `mkp.enum` (near option) | as E151 | `… found "bodl". Did you mean bold? Write mode: bold` |
| `mkp.unknown-prop` (near input, YAML or attribute) | `panel has no input "titel" (did you mean "title"?)` | `panel has no input "titel"; found titel: x. Did you mean "title"? Rename the key, or Remove the line` |
| `mkp.unknown-field` (rec value with a near unused field) | `spot has no field "z" (did you mean "x"?)` | suggestion now leaves out fields already given (z next to x suggests y) |
| `mkp.shadow` (pack name) | `x is already provided by p; give this one its own name …` | `x is already a widget of the pack p, so this widget needs a name of its own. Rename it, e.g. my_x; to change the existing one, copy it under a new name with mkp show x --source --as my_x` |
| `mkp.doc-item` (manifest, interface) | `… a manifest / an interface belongs in a pack` | same shape as E173/E175 |

## Position fixes

- YAML library errors (front matter and widget blocks, E137, E143): were at the first YAML line,
  column 1; now at the line and column of the problem in the file. A missing closing quote points at
  the opening quote (E137: 2:1 → 2:8); an unclosed `[`/`{` at the bracket; an unset alias at `*name`;
  others at the library's own position, moved into file lines (E143: 16:1 → 16:8).
- Control characters (E138, E169): were at the first line of the front matter / block; now at the
  key that holds the value (same line in both dataset rows, since it is the first key there).
- E164 unknown field in a record value: was the input's line, column 1; now the field itself
  (21:1 → 21:14).
- E157 a record's `slot` not text: was the list item; now the `slot` key (21:5 → 21:28).
- E171 an item unlike the ones before it: was the input's key line; now the item at fault (14:1 → 16:5).
- E144 block not a mapping: was the fence line; now the first YAML line (15:1 → 16:1).
- Empty `summary:` (not a dataset row): now at the summary line rather than the fence.

## Left alone, and why

- E139, E141 (`mkp.markdown` warnings): the text and line come from `markdown.ts`
  (`markdownToNodes`); doc.ts only relays them. E139's position (the definition line, not the link
  that uses it) needs fixing there.
- E181 position: still the value in the block. The default lives in the type definition, whose
  position is not available in doc.ts.
- E135 position: the block, not its `{#id}` line; the attribute line is not kept on the IR node.
- Token lists and ranges in messages still come from `DefChecker.takes()` (def.ts); if that wording
  changes, these messages follow it.
- `bindYaml` keeps def.ts's `yamlType`/`unify` text as a fallback only when doc.ts's own diagnosis
  finds nothing (it found the problem in every replayed row).
- E183 names the later input first (`more and items`), since that is where the error is reported.
