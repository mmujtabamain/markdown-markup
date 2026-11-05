# def.ts message changes

Every error and warning raised in `packages/core/src/check/def.ts` was rewritten to the shape in STYLE.md (what is wrong, what was found, how to fix it). Codes and severities are unchanged. "after" is what the private CLI built from the edited source prints for the dataset block (`replay.py --build def.ts`); E132 was checked with trial `defB/74`.

| id | code | before | after |
|---|---|---|---|
| E001 | mkp.check | "gfx" is not a capability (name@N) | requires names a capability with its version, written name@N; found "gfx". Write requires gfx@1 |
| E002 | mkp.reserved | the "error" signal is reserved; every widget sends it from its error boundary (15.1) | the signal name "error" is reserved: every widget already sends an error signal to the host when it fails; found signal error. Rename it, e.g. signal problem {msg: text} |
| E003 | mkp.extern-view | an extern has no view, state or values; providers implement it in code | an extern is drawn by its provider's own code, so it declares only inputs, outs, signals and requires, with no view, controls or values; found the view line "text". Remove this line, or drop "extern" to write probe as a widget in MKP |
| E004 | mkp.unknown-field | fields names "subtitle", which is not an input | fields lists "subtitle", which is not an input of card; fields names the inputs that values written without a name fill, in order. Declare it (in subtitle text = "") or remove it from fields |
| E005 | mkp.limit | a budget may be at most 20,000,000 operations | budget may be at most 20,000,000 operations (the work one evaluation may do); found 50,000,000. Write budget 20000000 or less, or make the widget do less work |
| E006 | mkp.untyped | fn twice must type its parameter x | fn twice has no type on its parameter x; every fn says what it takes and what it gives. Write the types after colons, e.g. fn twice(x: num): num = … (num is an example: use the real types) |
| E007 | mkp.untyped | fn twice must type its result (fn name(x: num): num = …) | fn twice has no result type; every fn says what it takes and what it gives. Write the types after colons, e.g. fn twice(x: num): num = … (num is an example: use the real types) |
| E008 | mkp.untyped | fn twice must type its parameters x, y and its result (fn name(x: num): num = …) | fn twice has no type on its parameters x, y or on its result; every fn says what it takes and what it gives. Write the types after colons, e.g. fn twice(x: num, y: num): num = … (num is an example: use the real types) |
| E009 | mkp.limit | 324 elements; a definition may have at most 300 | times has 324 elements, more than the 300 one definition may have. Repeat a line with each (each r in 1..16 key=r) instead of writing every copy out, or move part of the view into a part of its own |
| E010 | mkp.limit | 33 children; an element may have at most 32 as written | "column" has 33 lines directly under it, more than the 32 one element may hold (this is number 33). Group them into nested rows or columns, or write one line and repeat it with each |
| E011 | mkp.no-fallback | hills@1 needs gfx@1 (pixels) and has no fallback: give it an "about" text, shown where gfx@1 is missing | hills@1 draws with gfx@1 (pixels) but has no about text, which readers without gfx@1 see in its place. Add one in quotes after the name: hills@1 "A map of heights." |
| E012 | mkp.requires-gfx | pixels need the gfx@1 capability; add "requires gfx@1" to hills@1 | pixels (line 7) draws with the gfx@1 capability, but hills doesn't declare it. Add the line requires gfx@1 under the hills line |
| E013 | mkp.answer-leak | project md shows an answer (accept) outside if(answers, …), so Markdown built without answers would still give it away | project md shows accept, which holds the answer (an input marked answer), outside if(answers, …), so Markdown built without answers would still give it away. Wrap that part in if(answers, …, ""), e.g. project md = prompt + if(answers, "Answer: " + …, "") |
| E014 | mkp.unknown-interface | there is no interface scored@1 | implements names scored@1, but no loaded pack declares an interface by that name; interfaces come from a host's pack. Check the name and version, load the pack that declares it, or remove implements scored@1 |
| E015 | mkp.interface | stars implements scored@1 but has no signal scored {got: int} | stars implements scored@1 but has no signal scored {got: int}, which the interface asks for. Add signal scored {got: int}, and send it from an event (@click send scored …); or remove implements scored@1 |
| E016 | mkp.shadow | "width" is the reader's width (narrow, medium or wide), which every definition reads; name this something else | "width" is already the reader's width (narrow, medium or wide), which every definition can read, so it can't be declared here too. Rename it, e.g. "boxWidth" |
| E017 | mkp.shadow | "answers" is the reader's answers switch, which every definition reads; name this something else | "answers" is already the answers switch (true when the Markdown includes the answers), which every definition can read, so it can't be declared here too. Rename it, e.g. "given" |
| E018 | mkp.shadow | "true" is a value of the language; name this something else | "true" is a built-in value (as are none, false, pi, tau, inf, nan), so it can't be a name here. Rename it, e.g. "trueValue" |
| E019 | mkp.shadow | "warn" is a colour token; a name declared here can't take it, or "warn" in a style would mean this instead (rename it, e.g. "warn2" or "isWarn") | "warn" is a colour token, so it can't be a name here: tone=warn or if(…, warn, …) could then mean either the colour or this. Rename it, e.g. "isWarn" or "warn2" |
| E020 | mkp.shadow | "sad" is an option of state's choice; a name can't take it, or comparing state with sad would read this instead | "sad" is one of the options state can take, so it can't also be a name: state == sad could then mean either. Rename it, e.g. "isSad" |
| E021 | mkp.unknown-type | there is no type "Measure" | there is no type "Measure". Use a built-in type (num, int, text, bool, list(text), …) or declare it at the top level: type Measure = {…} |
| E022 | mkp.duplicate | "count" is already declared in this definition | "count" is declared twice in sizer: first as an input on line 5, again here. Rename one of them, e.g. "count2", or remove this line |
| E023 | mkp.check | play takes a duration such as 8s, or 500ms/step | play takes a duration, how long t takes to play through; found play=fast. Write e.g. play=8s, or play=500ms/step for a pace per step |
| E024 | mkp.check | loop is once, repeat or bounce | loop takes once, repeat or bounce; found loop=forever. Write e.g. loop=repeat to start again from the beginning, or loop=bounce to play back and forth |
| E025 | mkp.check | a slider needs its range: slider a..b | a slider needs its range first, written lo..hi; found no range. Write e.g. t = slider 0..10 "turn" |
| E026 | mkp.check | steps needs a count: steps n | steps needs its number of steps first; found none. Write e.g. k = steps 4 "item", or steps (len(items)) for one step per item |
| E027 | mkp.check | none is true or false, written | none on steps must be written as true or false, since it is fixed when the widget is built; found none=on. Write none=true (start at no step) or none=false |
| E028 | mkp.check | a clock runs on its own; play and pause it with actions | a clock counts seconds on its own, so it takes no play=; found play=5s. Remove play=…, and start or stop it from an event with play t or pause t |
| E029 | mkp.check | drag needs its ranges: drag x=a..b y=c..d | drag needs a range for y, written y=lo..hi; found no y=. Write e.g. p = drag x=0..1 y=0..1 |
| E030 | mkp.check | unexpected value for toggle | toggle takes no value here; found 3. Write it bare (t = toggle "label"), with = true before the label to start it on |
| E031 | mkp.unknown-prop | slider has no setting "snap" | slider has no setting "snap"; found snap=2. It takes step=, play=, loop=; remove snap=… or use one of those |
| E032 | mkp.check | a drag control cannot play | a drag control is moved by the reader, so it can't play; found play=4s. Remove play=… from p |
| E033 | mkp.unknown-event | a state line raises change and end, not "click" | a slider raises only @change and @end; found @click. Write @change … to act when t changes, or @end … when it reaches its end |
| E034 | mkp.check | only a slider or steps reaches an end | only a slider or steps reaches an end, so a toggle has no @end; found @end under t. Use @change instead, or make t a slider or steps |
| E035 | mkp.check | expected a range a..b, found 5 | span takes a range, written lo..hi; found 5. Write e.g. span=0..5 |
| E036 | mkp.check | expected a duration such as 6s or 500ms, found 5 | wait takes a duration, written with its unit; found 5. Write e.g. wait=5s (or 500ms) |
| E037 | mkp.check | a ref input has no default; the caller passes its state | count is a ref input, so it can't have a default: each widget that uses this one passes its own var or control, which the ref then changes; found = 0. Remove = 0 |
| E038 | mkp.check | a ref takes the name of the caller's state, found 3 | count is a ref, so it takes the name of a var or control of the widget using it, which it can then change; found 3. Declare one there and pass its name, e.g. var total int = …, then count=total |
| E039 | mkp.not-state | "total" is not state, a var or a ref here; a ref input needs settable state | count is a ref and needs a var, control or ref input it can change, but "total" is not declared here. Declare it (var total int = …) or pass one that exists |
| E040 | mkp.check | this ref is text, but total is int | count is a ref to text, but total is int; a ref and what it changes have the same type. Pass a text var or control, or make the input ref int |
| E041 | mkp.unknown-token | "acent" is not a color token (did you mean "accent"?); tone takes a color token: none, surface, ink, muted, line, accent, info, ok, warn, bad, c1, c2, c3, c4, c5, c6 | "acent" is not a color token (did you mean "accent"?); tone takes a color token: none, surface, ink, muted, line, accent, info, ok, warn, bad, c1, c2, c3, c4, c5, c6. Write tone=accent |
| E042 | mkp.style-token | tone takes a color token: none, surface, ink, muted, line, accent, info, ok, warn, bad, c1, c2, c3, c4, c5, c6; found 1..2 | tone takes a color token: none, surface, ink, muted, line, accent, info, ok, warn, bad, c1, c2, c3, c4, c5, c6; found 1..2, a range. Write a token name, e.g. tone=accent |
| E043 | mkp.style-token | tone takes a color token: none, surface, ink, muted, line, accent, info, ok, warn, bad, c1, c2, c3, c4, c5, c6, by name; found "#ff0000" | tone takes a color token by name, never a written-out colour, so themes and dark mode can change it; found "#ff0000". Write one of none, surface, ink, muted, line, accent, info, ok, warn, bad, c1, c2, c3, c4, c5, c6, e.g. tone=accent |
| E044 | mkp.style-token | tone takes a color token: none, surface, ink, muted, line, accent, info, ok, warn, bad, c1, c2, c3, c4, c5, c6; found (3 + 1) (int) | tone takes a color token: none, surface, ink, muted, line, accent, info, ok, warn, bad, c1, c2, c3, c4, c5, c6; found (3 + 1), which gives int. Write a token name, or an expression that gives one, e.g. tone=(if(done, ok, muted)) |
| E045 | mkp.check | expected a field name, found 1..2 | title takes the name of a field of the items (city); found 1..2, a range. Write e.g. title=city |
| E046 | mkp.type | expected path({city: text}, text), found int | title takes the name of a field of the items holding text (city); found (1 + 2), which gives int. Write a field name, e.g. title=city |
| E047 | mkp.type | T is known only where the definition is used | item has type T, a type parameter that each use of holder fixes, so a default can't be checked here; found = 3. Remove the default and pass item where holder is used |
| E048 | mkp.check | expected an expression in x | rule takes an expression in x, worked out again for each x; found 1..2, a range. Write one in brackets, e.g. rule=(x + 1) |
| E049 | mkp.check | a slot is filled by indented lines (or a container), not by an argument | content is a slot, filled by the lines indented under each use of the widget, so it can't have a default; found = "empty". Remove the default: in content slot |
| E050 | mkp.check | dot records are written as indented "dot …" lines | dots is a list of dot records, written as indented "dot …" lines under the widget, not as a value; found dots=3. Write one line per record instead, e.g. dot at=… name=… |
| E051 | mkp.check | expected text, found 1..2 | name takes text; found 1..2, a range. Write it in quotes, e.g. name="…" |
| E052 | mkp.check | expected maths $…$, found 1..2 | eq takes maths written in $…$; found 1..2, a range. Write e.g. eq=$x^2$ |
| E053 | mkp.check | expected maths ($…$ or a latex value), found int | eq takes maths ($…$, or an expression that gives latex); found (3), which gives int. Write it in $…$, with \val{…} for a live value, e.g. eq=$\val{n}$ |
| E054 | mkp.enum | align takes one of start, center, end, stretch, baseline; found 1..2 | align takes one of start, center, end, stretch, baseline; found 1..2, a range. Write one of those words, e.g. align=start |
| E055 | mkp.enum | align takes one of start, center, end, stretch, baseline; found cetner (did you mean "center"?) | align takes one of start, center, end, stretch, baseline; found cetner (did you mean "center"?). Write align=center |
| E056 | mkp.enum | align takes one of start, center, end, stretch, baseline; found (3) | align takes one of start, center, end, stretch, baseline; found (3), which gives int. Write one of those words, e.g. align=start |
| E057 | mkp.check | expected int, found 1..2 | count takes a whole number (int); found 1..2, a range. Write one value, e.g. count=1 |
| E058 | mkp.check | cols takes a number of equal columns or tracks such as [auto, 1fr, 6ch] | cols takes a number of equal columns (cols=3) or a list of column tracks (cols=[auto, 1fr, 6ch]); found 1..2. Write one of those |
| E059 | mkp.input-type | "wide" is not a column track: auto, fit, Nfr (a share), Nch (characters) or a size token (s, m, l) | "wide" is not a column track; a track is auto (as wide as its content), fit, Nfr (a share of the free space, e.g. 1fr), Nch (N characters wide, e.g. 6ch) or a size token (xs, s, m, l, xl); found cols=[auto, wide]. Write e.g. cols=[auto, 1fr] |
| E060 | mkp.input-type | a grid needs at least one column | a grid needs at least one column; found cols=[]. Write e.g. cols=[1fr] or cols=1 |
| E061 | mkp.input-type | cols takes a whole number or tracks such as [auto, 1fr]; found bool | cols takes a whole number of equal columns or a list of tracks such as [auto, 1fr]; found (true), which gives bool. Write e.g. cols=2 |
| E062 | mkp.input-range | a grid needs at least one column | a grid needs at least one column; found cols=0. Write cols=1 or more |
| E063 | mkp.unknown-field | "cty" isn't a field of the items (they have city) (did you mean "city"?) | "cty" isn't a field of the items (did you mean "city"?); their fields are city. Write title=city, or add cty to the items |
| E064 | mkp.type | "city" holds int, but this path needs text (quote the values in the YAML to make them text) | title needs a field holding text, but "city" holds int. Quote its values to make them text (city: "3") |
| E065 | mkp.type | picklist can't tell what T is here: give the inputs that hold it | picklist can't tell what type T is here: T is read from the value of an input that uses it, and none is given. Pass items (list(T)), e.g. items=[{city: "Oslo"}] for a list of records |
| E066 | mkp.duplicate-id | the id "one" is used twice in this definition | the id "one" is used twice in page (first on line 8); every id in a definition names one element. Rename this one, e.g. id=one2 |
| E067 | mkp.input-range | lines takes a whole number from 0 to 24; found 30 | lines takes a whole number from 0 to 24; found 30. Write a value in that range, e.g. lines=24 |
| E068 | mkp.type | a path reads records; text is not one | "city" names a field, but the items it reads are text, not records with fields. Write the items as records with that field, e.g. {city: …} |
| E069 | mkp.type | T is int in one place and text in another | T stands for one type in every input that uses it, but it is int in one place and text in another (first gives int, second="x" gives text). Give values of one type, e.g. all numbers or all text |
| E070 | mkp.limit | nested 13 levels deep; at most 12 under one definition | "column" here is nested 13 levels deep, past the 12 levels one definition may nest. Use fewer containers inside containers, or move the inner part into a part of its own |
| E071 | mkp.check | slot places one slot value: slot body or slot pages[i].slot | slot places one slot input of panel where it stands; found slot with no name. Write slot and the slot's name, e.g. slot body |
| E072 | mkp.check | slot needs a slot value; found text | slot places a slot input, but note is text; found slot note. Show text with text note, or declare note as a slot (in note slot) and fill it with lines indented under the widget |
| E073 | mkp.unknown-control | "missing" is not a control of quiz | "missing" is not a control of quiz; its controls are level. Write e.g. controls level |
| E074 | mkp.check | controls takes state names | controls takes the bare names of quiz's controls; found "level". Write e.g. controls level |
| E075 | mkp.check | fill belongs directly under a widget, to fill one of its slots | fill must sit directly under the widget whose slot it fills; found it under "each". Move the fill line up so it is directly under the widget line, and put the each or other lines inside the fill |
| E076 | mkp.check | case belongs under switch | case must sit directly under a switch on=… line; found it under "column". Put a switch above it, e.g. switch on=n, and indent case 3 under it |
| E077 | mkp.check | a prop line sets one value: title <value> | the prop line "title" sets one value, written title <value>; found title "One" "Two". Write one value, e.g. title "One" |
| E078 | mkp.check | the prop line "title" cannot have indented lines | the prop line "title" sets a value and can't have lines indented under it; found "text" under it. Move that line out from under title |
| E079 | mkp.missing-input | the mark record needs at (int) | the mark record needs at, a whole number (int); found mark with no at. Add it, e.g. mark at=1 |
| E080 | mkp.check | a mark record has no events | a mark record is data for ruler, so it can't take events; found @click. Remove the @click line |
| E081 | mkp.duplicate-prop | title is set twice | title is set twice on entry: on the entry line, and again by the prop line here. Remove one of them |
| E082 | mkp.unknown-prop | entry has no input, record or slot named "text" | entry has no slot, so lines can't be indented under it, and "text" is not one of its inputs or records; found "text" under entry. Remove the line or move it out from under entry, or give entry a slot (in body slot) to hold it |
| E083 | mkp.check | fill takes a slot name | fill takes the name of the panel slot it fills; found fill 3. Write e.g. fill aside |
| E084 | mkp.unknown-slot | panel has no slot "sidebar" | panel has no slot "sidebar"; its slots are body, aside. Write e.g. fill aside |
| E085 | mkp.check | body is the first slot; its lines need no fill | body is the first slot of panel, so its lines go straight under panel, with no fill; found fill body. Remove the fill body line and indent its lines two spaces less |
| E086 | mkp.missing-input | panel needs title: text | panel needs title: text. Add it, e.g. panel title="…" |
| E087 | mkp.unknown-event | panel raises no "opened" event; it raises closed | panel raises no "opened" event; it raises closed. Write @closed …, or remove the @opened line |
| E088 | mkp.unknown-event | panel raises no "opened" event | panel raises no events, so @opened can never run. Remove the @opened line, or put it on an element that raises opened |
| E089 | mkp.unknown-widget | there is no widget or part "counter" | there is no widget or part "counter". Check the spelling, define counter first (counter "what it shows"), or, if a pack provides it, make that pack available (depends in a pack's manifest) |
| E090 | mkp.extra-arg | unexpected value "One" for entry (it takes no positional values) | entry takes no values without a name, only key=value; found "One". Name it, e.g. title="One" |
| E091 | mkp.unknown-prop | entry has no prop "tone" | entry has no prop "tone"; found tone=muted. Its props are title, note; remove tone=… or use one of those |
| E092 | mkp.duplicate-prop | caps is set twice | caps is set twice on text, and this is the second time. Remove one of them |
| E093 | mkp.ambiguous-arg | "small" is an option of size and weight; write size=small | "small" is an option of both size and weight, so the bare word could set either. Write it with its prop: size=small or weight=small |
| E094 | mkp.ambiguous-arg | "ok" is a token for back and edge; write back=ok | "ok" is a token that fits both back and edge, so the bare word could set either. Write it with its prop: back=ok or edge=ok |
| E095 | mkp.ambiguous-arg | "hidden" is ambiguous here; use key=value | "hidden" could be the hidden flag (the element starts hidden) or an option of state, so the bare word is ambiguous. Write state=hidden to set state |
| E096 | mkp.ambiguous-arg | "small" matches more than one rule (a size option, a name in scope); write key=value | "small" could be an option of size or the value of small declared here, so the bare word is ambiguous. Write it with its key: size=small |
| E097 | mkp.check | id takes a name or (an expression) | id takes a name (id=box) or an expression in brackets (id=("box" + k)); found id=1..3. Write e.g. id=box |
| E098 | mkp.check | if takes a boolean expression | if= takes a true-or-false expression in brackets; found if=1..3. Write e.g. if=(n > 1) |
| E099 | mkp.check | if needs a boolean; found int | if= needs true or false; found (n + 1), which gives int. Write a comparison, e.g. if=(n > 1) |
| E100 | mkp.check | expected "each x in list [key=expr]" or "each x in a..b" | each is written each x in list key=… or each x in lo..hi, naming the loop variable before in; found each names. Write e.g. each name in names key=name |
| E101 | mkp.check | each needs a list or a range; found text | each needs a list or a range to go through; found names, which is text. Loop over a list (each x in items key=x) or a range (each k in 0..(n - 1)) |
| E102 | mkp.enum | self takes start, center, end or stretch | self is fixed when the widget is built, so it takes one of start, center, end or stretch written as a word, not worked out; found self=(if(n > 1, start, end)). Write one word, e.g. self=start, or use two elements, each with its own if=(…) |
| E103 | mkp.check | each takes only key=expr after its list | each takes only key=… after its list; found extra=1. Remove it, or write key=(…) with a value unique to each item |
| E104 | mkp.each-unkeyed | each over a list without key= uses the index as identity, so items lose their state when the list changes; add key=… with a unique value of n | each over names has no key=, so it tells items apart by position and they lose their state when the list changes. Add key= with a value unique to each n, e.g. each n in names key=n |
| E105 | mkp.check | each has no events | each can't take events; found @click under each. Move the @click line under the element inside the each that should react |
| E106 | mkp.check | a prop line cannot be repeated or chosen; use if(…) in its value | the prop line "title" sits under each, which would set it once per item, but a prop is set once. Move it out from under the each, onto the widget, and choose its value there with if(…), e.g. title=(if(…, a, b)) |
| E107 | mkp.check | expected "switch on=expr" | switch is written switch on=<value>, with nothing else on the line; found switch n. Write e.g. switch on=n |
| E108 | mkp.check | case takes one value | case takes one value; found case 1 2. Write one case line per value, e.g. case 1, then case 2 on its own line |
| E109 | mkp.case-unreachable | this case repeats an earlier one and can never be chosen | case 3 repeats the case on line 8, so it can never be chosen. Change its value or remove it |
| E110 | mkp.check | switch has one else | switch may have one else, and this is a second (the first is on line 8). Merge the two, or remove this one |
| E111 | mkp.check | under switch, only case and else; found "text" | under switch, only case and else lines may go; found "text". Put it under a case or else, or move it out from under the switch |
| E112 | mkp.unknown-prop | arrow takes from=id to=id, an optional "label", via=(ids), route=down\|right, curve, tone=, line=, head=, tail=, dim=, bold=, layer= and opacity= | arrow has no prop "colour"; found colour=ok. It takes from=id to=id, an optional "label", via=(ids), route=down\|right, curve, tone=, line=, head=, tail=, dim=, bold=, layer= and opacity=. Write tone=ok |
| E113 | mkp.check | arrow needs from=id and to=id | arrow needs from= and to=, the ids of the two elements it joins; found no to=. Add to=<id>, e.g. arrow from=a to=b |
| E114 | mkp.check | an id is a name or (an expression) | from= takes an element's id: a name (from=box) or an expression in brackets (from=("box" + k)); found from=1..2. Write e.g. from=box |
| E115 | mkp.unknown-out | counter declares no out "finished" | counter declares no out "finished". Declare it under the counter line (out finished) |
| E116 | mkp.check | set takes name=expr … | set takes name=value pairs; found set n. Write e.g. set n=(n + 1) |
| E117 | mkp.check | reset takes names here | reset takes bare names here; found 1. Write e.g. reset n |
| E118 | mkp.extra-arg | play takes exactly one slider or steps name | play takes exactly one slider, steps or clock name; found play level n. Write e.g. play level |
| E119 | mkp.not-playable | "n" is not a slider, steps or clock of this definition | "n" is a var, not a slider, steps or clock of counter, so it can't play; its playable controls are level. Write e.g. play level |
| E120 | mkp.not-state | "total" is not state here | reset puts a control, var or ref input back to its start, and "total" is none of these in counter. Write e.g. reset n |
| E121 | mkp.check | hide takes one id | hide needs the id of the element to hide; found hide with nothing after it. Write hide <id>, e.g. hide extra (each action takes its own id: reveal a hide b) |
| E122 | mkp.unknown-id | there is no element with id=footer in counter | there is no element with id=footer in counter; its ids are extra, help. Add id=footer to the element to reveal, or name one that exists |
| E123 | mkp.not-overlay | extra is not an overlay | extra is not an overlay, so open can't open it; found open extra. Use reveal extra for a plain element (with hidden on it, so it starts hidden), or make extra an overlay |
| E124 | mkp.reveal-visible | help is not hidden, so reveal does nothing until it is hidden | help is not hidden, so reveal help does nothing. Add hidden to the element with id=help (line 15) so it starts hidden, or remove reveal help |
| E125 | mkp.check | emit takes a name | emit takes the name of an out (an event for the widget using this one) of counter; found emit with nothing after it. Write e.g. emit answered |
| E126 | mkp.unknown-signal | counter declares no signal "viewed" | counter declares no signal "viewed"; its signals are seen. Declare it under the counter line (signal viewed {field: type}) or send one that exists |
| E127 | mkp.check | emit takes field=expr | emit answered takes its fields as field=value; found correct. Write e.g. correct=true |
| E128 | mkp.unknown-field | answered has no field "score" | answered has no field "score"; its fields are correct, tries. Remove score=… or use one of those |
| E129 | mkp.missing-field | emit answered needs tries | emit answered must give every field of answered, and tries, a whole number (int), is missing. Add tries=…, e.g. emit answered correct=true tries=1 |
| E130 | mkp.not-state | "total" is not state, a var or a ref input of counter | set changes a var, control or ref input, and "total" is not declared in counter. Declare it (var total int = 0) or set one that exists: n |
| E131 | mkp.check | set takes an expression | set n= takes one value or expression; found n=1..3, a range. Write e.g. set n=1 |
| E132 | mkp.ambiguous | "chip" is provided by several packs (chips, pills); write pack:chip | "chip" is provided by several packs (chips, pills), so the bare name could mean either. Write it with its pack's name in front: chips:chip or pills:chip |
| E133 | mkp.check | each needs a list or a range | each needs a list or a range to go through; found 2s, a duration. Loop over a list (each x in items key=x) or a range (each k in 0..(n - 1)) |
| - | mkp.input-type (via doc.ts) | items is empty, so its items' type can't be told; give at least one | items is an empty list, so the type of its items can't be worked out. Give at least one item, e.g. - name: First |
| - | mkp.input-type (via doc.ts) | items[1] is int, but the items before it are text: every item has the same fields of the same types | items[1] is int, but the items before it are text; every item must have the same fields, of the same types. Give it the same fields as the others |
| - | mkp.input-type (via doc.ts) | items.city has no value | items.city has no value. Write one after its colon, or remove items.city |
| - | mkp.input-type (via doc.ts, unify) | T is int in one place and text in another | T stands for one type in every input that uses it, but it is int in one place and text in another. Give values of one type, e.g. all numbers or all text |
| - (unreachable, def.ts:491) | mkp.shadow | "x" is an option of a choice here; a name can't take it, or comparing it with x would read this instead | "x" is one of the options a choice here can take, so it can't also be a name: the choice == x could then mean either. Rename it, e.g. "isX" |
| - (unreachable, def.ts:879) | mkp.input-type | expected a whole number, found 2.5 | count takes a whole number; found 2.5. Write e.g. count=3 |
| - (unreachable, def.ts:1312) | mkp.case-unreachable | case 7 can't happen (int 1..3) | case 7 can't happen: the switch's value n is a whole number from 1 to 3. Change the case to a value in that range, or remove it |
| - (dead, def.ts:1402) | mkp.check | play takes a slider or steps name | play takes the name of a slider, steps or clock; found none. Write e.g. play level |
| - (unreachable, def.ts:1448) | mkp.check | unknown action launch | "launch" is not an action; the actions are set, play, pause, reset, reveal, hide, open, close, emit and send |
| - (unreachable, def.ts:1130) | mkp.unknown-version | there is no chip@2; versions: 1 | there is no chip@2; the versions of chip are 1. Write chip@1, or chip for the locked one |
| - (fillArgs, slot given as key=) | mkp.unknown-prop | panel has no prop "content" (did you mean "content"?) | content is a slot of panel, filled by the lines indented under it, not by content=…; found content=3. Remove it and write the content on its own lines under panel |
| - (controls naming a drag) | mkp.unknown-control | "p" is not a control of quiz | "p" is a drag control, moved on the canvas, so controls can't place it in the bar. Remove p from controls |
| - (type parameter, not a default) | mkp.type | T is known only where the definition is used | item has type T, a type parameter that each use of holder fixes, so 3 can't be checked against it here. Pass the value where holder is used instead |
| - (slot given a value, not a default) | mkp.check | a slot is filled by indented lines (or a container), not by an argument | content is a slot, filled by the lines indented under the widget, not by a value; found content=3. Remove it and write the content on its own lines under the widget |
| - (other controls with a stray value) | mkp.check | unexpected value for slider | slider takes no more values here; found 3. Remove it (a slider takes one range), or give it by name, e.g. step=3 (also steps, choice, clock, drag, each with its own fix) |
| - (send without a name) | mkp.check | send takes a name | send takes the name of a signal (a message to the host) of counter; found send with nothing after it. Write e.g. send seen |
| - (reveal/hide given two ids) | mkp.check | reveal takes one id | reveal takes one id; found reveal a b. Write one action per id, e.g. reveal a reveal b |

## Position fixes

- **E106** (a prop line under `each`/`case`/`else`): reported at line 0, column 0. A prop line's node now keeps its position (only for messages: it is folded into its widget's props and never reaches the IR), so the error points at the prop line. The message also says which container it is under.
- **E004** (`fields` names a missing input): pointed at the widget header; now at the `fields` line.
- **E081** (a prop set on the widget line and again by a prop line): pointed at the widget use; now at the second setting, the prop line.
- **E028** (clock with `play=`), **E032** (drag with `play=`): pointed at the start of the control line; now at the `play=` argument.
- **E029** (drag with a bad range), **E025** (slider with a value that is not a range): now at the offending argument when there is one (the line, as before, when it is missing).
- **E078** (a prop line with indented lines): now at the first indented line, not the prop line.
- `if=` on an event line that is not an expression: now at the `if=` value, not the start of the event.
- Several definition-level errors (E004, E009, E011, E012) now carry the definition path like the rest.

Messages that now point back to the earlier line involved: E022 (first declaration), E066 (first use of the id), E109 (the earlier case), E110 (the first else), E012 (the line of each gfx@1 use), E124 (the element that is not hidden).

## Shared helpers and wider effects

- `takes()` (also used by `check/doc.ts`) keeps its signature. It now also words unbounded `int` ("a whole number (int)"), `num` ("a number"), `range` and `duration`, where it used to print the bare type name. So doc.ts messages that use it change too, e.g. `xs[1] takes a whole number (int); found "two"`.
- `value()` called with no name (some doc.ts call sites) now says "this value takes …" instead of "it takes …".
- `staticValue()` and `pathTo()` take an optional last `name` argument (doc.ts calls are unchanged), so defaults and paths can name their input.
- The exported `unify()` keeps its signature and return type. Its text changed, and `instantiateUse` now names the two inputs that disagree (E069).
- The `yamlType()` texts, which doc.ts wraps as `mkp.input-type`, were rewritten too.

## Left alone, and why

- **E012** still points at the definition header: the fix is a new `requires gfx@1` line under it. The message now gives the line of the gfx use.
- **E068** points at the end of the document. That position comes from doc.ts's YAML lookup (`this.at(...)`), outside this file. Only the wording changed.
- **E041–E044** still list every token name of the kind. The list is what the author picks from, so it stays.
- **E097/E098**: `id=3` (a number) is still accepted without complaint. Changing that would change behaviour, so it was not touched.
- Tests were not edited. With only def.ts changed, three tests in `packages/core/test/redesign.test.ts` fail on wording: "a wrong or missing value says what the input takes", "a path to a field the items lack…" and "a path to a number where text is needed…". "a wrong value in a YAML list item…" also changes through `takes()`. The other failures in the core suite come from other files.
