# MKP error messages

370 distinct messages triggered from 360 sites; 23 sites not triggered from a document or pack (listed last).

| id | code | severity | message | site |
|---|---|---|---|---|
| E001 | `mkp.check` | error | "gfx" is not a capability (name@N) | `packages/core/src/check/def.ts:255` |
| E002 | `mkp.reserved` | error | the "error" signal is reserved; every widget sends it from its error boundary (15.1) | `packages/core/src/check/def.ts:271` |
| E003 | `mkp.extern-view` | error | an extern has no view, state or values; providers implement it in code | `packages/core/src/check/def.ts:281` |
| E004 | `mkp.unknown-field` | error | fields names "subtitle", which is not an input | `packages/core/src/check/def.ts:292` |
| E005 | `mkp.limit` | error | a budget may be at most 20,000,000 operations | `packages/core/src/check/def.ts:258` |
| E006 | `mkp.untyped` | error | fn twice must type its parameter x | `packages/core/src/check/def.ts:327` |
| E007 | `mkp.untyped` | error | fn twice must type its result (fn name(x: num): num = …) | `packages/core/src/check/def.ts:327` |
| E008 | `mkp.untyped` | error | fn twice must type its parameters x, y and its result (fn name(x: num): num = …) | `packages/core/src/check/def.ts:327` |
| E009 | `mkp.limit` | error | 324 elements; a definition may have at most 300 | `packages/core/src/check/def.ts:372` |
| E010 | `mkp.limit` | error | 33 children; an element may have at most 32 as written | `packages/core/src/check/def.ts:897` |
| E011 | `mkp.no-fallback` | error | hills@1 needs gfx@1 (pixels) and has no fallback: give it an "about" text, shown where gfx@1 is missing | `packages/core/src/check/def.ts:387` |
| E012 | `mkp.requires-gfx` | error | pixels need the gfx@1 capability; add "requires gfx@1" to hills@1 | `packages/core/src/check/def.ts:390` |
| E013 | `mkp.answer-leak` | error | project md shows an answer (accept) outside if(answers, …), so Markdown built without answers would still give it away | `packages/core/src/check/def.ts:420` |
| E014 | `mkp.unknown-interface` | error | there is no interface scored@1 | `packages/core/src/check/def.ts:432` |
| E015 | `mkp.interface` | error | stars implements scored@1 but has no signal scored {got: int} | `packages/core/src/check/def.ts:458` |
| E016 | `mkp.shadow` | error | "width" is the reader's width (narrow, medium or wide), which every definition reads; name this something else | `packages/core/src/check/def.ts:485` |
| E017 | `mkp.shadow` | error | "answers" is the reader's answers switch, which every definition reads; name this something else | `packages/core/src/check/def.ts:485` |
| E018 | `mkp.shadow` | error | "true" is a value of the language; name this something else | `packages/core/src/check/def.ts:486` |
| E019 | `mkp.shadow` | error | "warn" is a colour token; a name declared here can't take it, or "warn" in a style would mean this instead (rename it, e.g. "warn2" or "isWarn") | `packages/core/src/check/def.ts:488` |
| E020 | `mkp.shadow` | error | "sad" is an option of state's choice; a name can't take it, or comparing state with sad would read this instead | `packages/core/src/check/def.ts:491` |
| E021 | `mkp.unknown-type` | error | there is no type "Measure" | `packages/core/src/check/def.ts:506` |
| E022 | `mkp.duplicate` | error | "count" is already declared in this definition | `packages/core/src/check/def.ts:529` |
| E023 | `mkp.check` | error | play takes a duration such as 8s, or 500ms/step | `packages/core/src/check/def.ts:576` |
| E024 | `mkp.check` | error | loop is once, repeat or bounce | `packages/core/src/check/def.ts:583` |
| E025 | `mkp.check` | error | a slider needs its range: slider a..b | `packages/core/src/check/def.ts:589` |
| E026 | `mkp.check` | error | steps needs a count: steps n | `packages/core/src/check/def.ts:613` |
| E027 | `mkp.check` | error | none is true or false, written | `packages/core/src/check/def.ts:620` |
| E028 | `mkp.check` | error | a clock runs on its own; play and pause it with actions | `packages/core/src/check/def.ts:630` |
| E029 | `mkp.check` | error | drag needs its ranges: drag x=a..b y=c..d | `packages/core/src/check/def.ts:635` |
| E030 | `mkp.check` | error | unexpected value for toggle | `packages/core/src/check/def.ts:642` |
| E031 | `mkp.unknown-prop` | error | slider has no setting "snap" | `packages/core/src/check/def.ts:643` |
| E032 | `mkp.check` | error | a drag control cannot play | `packages/core/src/check/def.ts:644` |
| E033 | `mkp.unknown-event` | error | a state line raises change and end, not "click" | `packages/core/src/check/def.ts:659` |
| E034 | `mkp.check` | error | only a slider or steps reaches an end | `packages/core/src/check/def.ts:660` |
| E035 | `mkp.check` | error | expected a range a..b, found 5 | `packages/core/src/check/def.ts:714` |
| E036 | `mkp.check` | error | expected a duration such as 6s or 500ms, found 5 | `packages/core/src/check/def.ts:720` |
| E037 | `mkp.check` | error | a ref input has no default; the caller passes its state | `packages/core/src/check/def.ts:723` |
| E038 | `mkp.check` | error | a ref takes the name of the caller's state, found 3 | `packages/core/src/check/def.ts:724` |
| E039 | `mkp.not-state` | error | "total" is not state, a var or a ref here; a ref input needs settable state | `packages/core/src/check/def.ts:726` |
| E040 | `mkp.check` | error | this ref is text, but total is int | `packages/core/src/check/def.ts:728` |
| E041 | `mkp.unknown-token` | error | "acent" is not a color token (did you mean "accent"?); tone takes a color token: none, surface, ink, muted, line, accent, info, ok, warn, bad, c1, c2, c3, c4, c5, c6 | `packages/core/src/check/def.ts:737` |
| E042 | `mkp.style-token` | error | tone takes a color token: none, surface, ink, muted, line, accent, info, ok, warn, bad, c1, c2, c3, c4, c5, c6; found 1..2 | `packages/core/src/check/def.ts:739` |
| E043 | `mkp.style-token` | error | tone takes a color token: none, surface, ink, muted, line, accent, info, ok, warn, bad, c1, c2, c3, c4, c5, c6, by name; found "#ff0000" | `packages/core/src/check/def.ts:741` |
| E044 | `mkp.style-token` | error | tone takes a color token: none, surface, ink, muted, line, accent, info, ok, warn, bad, c1, c2, c3, c4, c5, c6; found (3 + 1) (int) | `packages/core/src/check/def.ts:746` |
| E045 | `mkp.check` | error | expected a field name, found 1..2 | `packages/core/src/check/def.ts:750` |
| E046 | `mkp.type` | error | expected path({city: text}, text), found int | `packages/core/src/check/def.ts:756` |
| E047 | `mkp.type` | error | T is known only where the definition is used | `packages/core/src/check/def.ts:760` |
| E048 | `mkp.check` | error | expected an expression in x | `packages/core/src/check/def.ts:763` |
| E049 | `mkp.check` | error | a slot is filled by indented lines (or a container), not by an argument | `packages/core/src/check/def.ts:772` |
| E050 | `mkp.check` | error | dot records are written as indented "dot …" lines | `packages/core/src/check/def.ts:774` |
| E051 | `mkp.check` | error | expected text, found 1..2 | `packages/core/src/check/def.ts:776` |
| E052 | `mkp.check` | error | expected maths $…$, found 1..2 | `packages/core/src/check/def.ts:784` |
| E053 | `mkp.check` | error | expected maths ($…$ or a latex value), found int | `packages/core/src/check/def.ts:787` |
| E054 | `mkp.enum` | error | align takes one of start, center, end, stretch, baseline; found 1..2 | `packages/core/src/check/def.ts:792` |
| E055 | `mkp.enum` | error | align takes one of start, center, end, stretch, baseline; found cetner (did you mean "center"?) | `packages/core/src/check/def.ts:795` |
| E056 | `mkp.enum` | error | align takes one of start, center, end, stretch, baseline; found (3) | `packages/core/src/check/def.ts:797` |
| E057 | `mkp.check` | error | expected int, found 1..2 | `packages/core/src/check/def.ts:801` |
| E058 | `mkp.check` | error | cols takes a number of equal columns or tracks such as [auto, 1fr, 6ch] | `packages/core/src/check/def.ts:815` |
| E059 | `mkp.input-type` | error | "wide" is not a column track: auto, fit, Nfr (a share), Nch (characters) or a size token (s, m, l) | `packages/core/src/check/def.ts:819` |
| E060 | `mkp.input-type` | error | a grid needs at least one column | `packages/core/src/check/def.ts:820` |
| E061 | `mkp.input-type` | error | cols takes a whole number or tracks such as [auto, 1fr]; found bool | `packages/core/src/check/def.ts:827` |
| E062 | `mkp.input-range` | error | a grid needs at least one column | `packages/core/src/check/def.ts:829` |
| E063 | `mkp.unknown-field` | error | "cty" isn't a field of the items (they have city) (did you mean "city"?) | `packages/core/src/check/def.ts:844` |
| E064 | `mkp.type` | error | "city" holds int, but this path needs text (quote the values in the YAML to make them text) | `packages/core/src/check/def.ts:845` |
| E065 | `mkp.type` | error | picklist can't tell what T is here: give the inputs that hold it | `packages/core/src/check/def.ts:866` |
| E066 | `mkp.duplicate-id` | error | the id "one" is used twice in this definition | `packages/core/src/check/def.ts:680` |
| E067 | `mkp.input-range` | error | lines takes a whole number from 0 to 24; found 30 | `packages/core/src/check/def.ts:880` |
| E068 | `mkp.type` | error | a path reads records; text is not one | `packages/core/src/check/def.ts:842` |
| E069 | `mkp.type` | error | T is int in one place and text in another | `packages/core/src/check/def.ts:863` |
| E070 | `mkp.limit` | error | nested 13 levels deep; at most 12 under one definition | `packages/core/src/check/def.ts:911` |
| E071 | `mkp.check` | error | slot places one slot value: slot body or slot pages[i].slot | `packages/core/src/check/def.ts:929` |
| E072 | `mkp.check` | error | slot needs a slot value; found text | `packages/core/src/check/def.ts:931` |
| E073 | `mkp.unknown-control` | error | "missing" is not a control of quiz | `packages/core/src/check/def.ts:937` |
| E074 | `mkp.check` | error | controls takes state names | `packages/core/src/check/def.ts:936` |
| E075 | `mkp.check` | error | fill belongs directly under a widget, to fill one of its slots | `packages/core/src/check/def.ts:943` |
| E076 | `mkp.check` | error | case belongs under switch | `packages/core/src/check/def.ts:947` |
| E077 | `mkp.check` | error | a prop line sets one value: title <value> | `packages/core/src/check/def.ts:966` |
| E078 | `mkp.check` | error | the prop line "title" cannot have indented lines | `packages/core/src/check/def.ts:967` |
| E079 | `mkp.missing-input` | error | the mark record needs at (int) | `packages/core/src/check/def.ts:994` |
| E080 | `mkp.check` | error | a mark record has no events | `packages/core/src/check/def.ts:1001` |
| E081 | `mkp.duplicate-prop` | error | title is set twice | `packages/core/src/check/def.ts:1063` |
| E082 | `mkp.unknown-prop` | error | entry has no input, record or slot named "text" | `packages/core/src/check/def.ts:1071` |
| E083 | `mkp.check` | error | fill takes a slot name | `packages/core/src/check/def.ts:1077` |
| E084 | `mkp.unknown-slot` | error | panel has no slot "sidebar" | `packages/core/src/check/def.ts:1078` |
| E085 | `mkp.check` | error | body is the first slot; its lines need no fill | `packages/core/src/check/def.ts:1079` |
| E086 | `mkp.missing-input` | error | panel needs title: text | `packages/core/src/check/def.ts:1085` |
| E087 | `mkp.unknown-event` | error | panel raises no "opened" event; it raises closed | `packages/core/src/check/def.ts:1092` |
| E088 | `mkp.unknown-event` | error | panel raises no "opened" event | `packages/core/src/check/def.ts:1092` |
| E089 | `mkp.unknown-widget` | error | there is no widget or part "counter" | `packages/core/src/check/def.ts:1121` |
| E090 | `mkp.extra-arg` | error | unexpected value "One" for entry (it takes no positional values) | `packages/core/src/check/def.ts:1203` |
| E091 | `mkp.unknown-prop` | error | entry has no prop "tone" | `packages/core/src/check/def.ts:1155` |
| E092 | `mkp.duplicate-prop` | error | caps is set twice | `packages/core/src/check/def.ts:1144` |
| E093 | `mkp.ambiguous-arg` | error | "small" is an option of size and weight; write size=small | `packages/core/src/check/def.ts:1171` |
| E094 | `mkp.ambiguous-arg` | error | "ok" is a token for back and edge; write back=ok | `packages/core/src/check/def.ts:1178` |
| E095 | `mkp.ambiguous-arg` | error | "hidden" is ambiguous here; use key=value | `packages/core/src/check/def.ts:1181` |
| E096 | `mkp.ambiguous-arg` | error | "small" matches more than one rule (a size option, a name in scope); write key=value | `packages/core/src/check/def.ts:1188` |
| E097 | `mkp.check` | error | id takes a name or (an expression) | `packages/core/src/check/def.ts:1217` |
| E098 | `mkp.check` | error | if takes a boolean expression | `packages/core/src/check/def.ts:1221` |
| E099 | `mkp.check` | error | if needs a boolean; found int | `packages/core/src/check/def.ts:1223` |
| E100 | `mkp.check` | error | expected "each x in list [key=expr]" or "each x in a..b" | `packages/core/src/check/def.ts:1253` |
| E101 | `mkp.check` | error | each needs a list or a range; found text | `packages/core/src/check/def.ts:1268` |
| E102 | `mkp.enum` | error | self takes start, center, end or stretch | `packages/core/src/check/def.ts:1236` |
| E103 | `mkp.check` | error | each takes only key=expr after its list | `packages/core/src/check/def.ts:1280` |
| E104 | `mkp.each-unkeyed` | warning | each over a list without key= uses the index as identity, so items lose their state when the list changes; add key=… with a unique value of n | `packages/core/src/check/def.ts:1282` |
| E105 | `mkp.check` | error | each has no events | `packages/core/src/check/def.ts:1283` |
| E106 | `mkp.check` | error | a prop line cannot be repeated or chosen; use if(…) in its value | `packages/core/src/check/def.ts:1292` |
| E107 | `mkp.check` | error | expected "switch on=expr" | `packages/core/src/check/def.ts:1299` |
| E108 | `mkp.check` | error | case takes one value | `packages/core/src/check/def.ts:1306` |
| E109 | `mkp.case-unreachable` | warning | this case repeats an earlier one and can never be chosen | `packages/core/src/check/def.ts:1309` |
| E110 | `mkp.check` | error | switch has one else | `packages/core/src/check/def.ts:1318` |
| E111 | `mkp.check` | error | under switch, only case and else; found "text" | `packages/core/src/check/def.ts:1323` |
| E112 | `mkp.unknown-prop` | error | arrow takes from=id to=id, an optional "label", via=(ids), route=down\|right, curve, tone=, line=, head=, tail=, dim=, bold=, layer= and opacity= | `packages/core/src/check/def.ts:1346` |
| E113 | `mkp.check` | error | arrow needs from=id and to=id | `packages/core/src/check/def.ts:1348` |
| E114 | `mkp.check` | error | an id is a name or (an expression) | `packages/core/src/check/def.ts:1354` |
| E115 | `mkp.unknown-out` | error | counter declares no out "finished" | `packages/core/src/check/def.ts:1433` |
| E116 | `mkp.check` | error | set takes name=expr … | `packages/core/src/check/def.ts:1395` |
| E117 | `mkp.check` | error | reset takes names here | `packages/core/src/check/def.ts:1392` |
| E118 | `mkp.extra-arg` | error | play takes exactly one slider or steps name | `packages/core/src/check/def.ts:1401` |
| E119 | `mkp.not-playable` | error | "n" is not a slider, steps or clock of this definition | `packages/core/src/check/def.ts:1404` |
| E120 | `mkp.not-state` | error | "total" is not state here | `packages/core/src/check/def.ts:1409` |
| E121 | `mkp.check` | error | hide takes one id | `packages/core/src/check/def.ts:1417` |
| E122 | `mkp.unknown-id` | error | there is no element with id=footer in counter | `packages/core/src/check/def.ts:1421` |
| E123 | `mkp.not-overlay` | error | extra is not an overlay | `packages/core/src/check/def.ts:1422` |
| E124 | `mkp.reveal-visible` | warning | help is not hidden, so reveal does nothing until it is hidden | `packages/core/src/check/def.ts:1423` |
| E125 | `mkp.check` | error | emit takes a name | `packages/core/src/check/def.ts:1431` |
| E126 | `mkp.unknown-signal` | error | counter declares no signal "viewed" | `packages/core/src/check/def.ts:1434` |
| E127 | `mkp.check` | error | emit takes field=expr | `packages/core/src/check/def.ts:1438` |
| E128 | `mkp.unknown-field` | error | answered has no field "score" | `packages/core/src/check/def.ts:1440` |
| E129 | `mkp.missing-field` | error | emit answered needs tries | `packages/core/src/check/def.ts:1444` |
| E130 | `mkp.not-state` | error | "total" is not state, a var or a ref input of counter | `packages/core/src/check/def.ts:1453` |
| E131 | `mkp.check` | error | set takes an expression | `packages/core/src/check/def.ts:1454` |
| E132 | `mkp.ambiguous` | error | "chip" is provided by several packs (chips, pills); write pack:chip | `packages/core/src/check/def.ts:1126` |
| E133 | `mkp.check` | error | each needs a list or a range | `packages/core/src/check/def.ts:1271` |
| E134 | `mkp.doc-state` | error | a state block holds state lines only (name = control …) | `packages/core/src/check/doc.ts:183` |
| E135 | `mkp.duplicate-anchor` | error | #setup is already the anchor of the block on line 1; give this one another | `packages/core/src/check/doc.ts:211` |
| E136 | `mkp.front-matter` | error | front matter must be a YAML mapping | `packages/core/src/check/doc.ts:250` |
| E137 | `mkp.front-matter` | error | front matter is not valid YAML: Missing closing "quote at line 2, column 12: | `packages/core/src/check/doc.ts:256` |
| E138 | `mkp.front-matter` | error | front matter is not valid YAML: front matter holds a control character (\t); a backslash in "double quotes" is an escape, so write LaTeX in 'single quotes' (e.g. '\theta') | `packages/core/src/check/doc.ts:269` |
| E139 | `mkp.markdown` | warning | link reference definitions are not supported; write links inline | `packages/core/src/check/doc.ts:284` |
| E140 | `mkp.attrs` | warning | attribute tone on a Markdown block is ignored; only #id, role= (on headings) and the profile's block attributes apply | `packages/core/src/check/doc.ts:679` |
| E141 | `mkp.markdown` | warning | raw HTML is shown as text; MKP content has no HTML (use a widget) | `packages/core/src/check/doc.ts:284` |
| E142 | `mkp.unknown-widget` | error | there is no widget "pannel" (did you mean "panel"?) | `packages/core/src/check/doc.ts:338` |
| E143 | `mkp.yaml` | error | the panel block is not valid YAML: Nested mappings are not allowed in compact mappings at line 1, column 8: | `packages/core/src/check/doc.ts:348` |
| E144 | `mkp.yaml` | error | the panel block must be a YAML mapping of its inputs | `packages/core/src/check/doc.ts:352` |
| E145 | `mkp.missing-summary` | error | the panel block needs a summary: line (what it shows, for readers without the widget and for Markdown output) | `packages/core/src/check/doc.ts:359` |
| E146 | `mkp.unknown-prop` | error | panel has no input "colour" | `packages/core/src/check/doc.ts:428` |
| E147 | `mkp.input-type` | error | body is a slot: give it a Markdown string | `packages/core/src/check/doc.ts:432` |
| E148 | `mkp.input-type` | error | size is a whole number; found "big" | `packages/core/src/check/doc.ts:483` |
| E149 | `mkp.input-range` | error | size is 9, outside 1..5 | `packages/core/src/check/doc.ts:490` |
| E150 | `mkp.input-type` | error | lit is true or false; "yes" is text in YAML 1.2: write true | `packages/core/src/check/doc.ts:494` |
| E151 | `mkp.enum` | error | mode is one of plain, bold; found "italic" | `packages/core/src/check/doc.ts:506` |
| E152 | `mkp.unknown-token` | error | "green" is not a color token; tone takes a color token: none, surface, ink, muted, line, accent, info, ok, warn, bad, c1, c2, c3, c4, c5, c6 | `packages/core/src/check/doc.ts:524` |
| E153 | `mkp.not-state` | error | "volume" is not declared in a state block of this document | `packages/core/src/check/doc.ts:529` |
| E154 | `mkp.input-type` | error | level is num, but volume is bool | `packages/core/src/check/doc.ts:530` |
| E155 | `mkp.input-type` | error | panes is a list of pane records: give a YAML list of objects | `packages/core/src/check/doc.ts:441` |
| E156 | `mkp.input-type` | error | each pane is an object of its fields | `packages/core/src/check/doc.ts:449` |
| E157 | `mkp.input-type` | error | the pane slot is a Markdown string | `packages/core/src/check/doc.ts:455` |
| E158 | `mkp.unknown-field` | error | pane has no field "colour" | `packages/core/src/check/doc.ts:460` |
| E159 | `mkp.input-type` | error | links is a list of link records | `packages/core/src/check/doc.ts:463` |
| E160 | `mkp.missing-input` | error | pane needs count (int) | `packages/core/src/check/doc.ts:472` |
| E161 | `mkp.input-type` | error | scores[1] is a whole number; found "two" | `packages/core/src/check/doc.ts:555` |
| E162 | `mkp.input-range` | error | scores[1] is 7, outside 1..5 | `packages/core/src/check/doc.ts:561` |
| E163 | `mkp.unknown-token` | error | "green" is not a color token; marks[1] takes a color token: none, surface, ink, muted, line, accent, info, ok, warn, bad, c1, c2, c3, c4, c5, c6 | `packages/core/src/check/doc.ts:573` |
| E164 | `mkp.unknown-field` | error | spot has no field "z" (did you mean "x"?) | `packages/core/src/check/doc.ts:588` |
| E165 | `mkp.missing-field` | error | spot needs x (num) | `packages/core/src/check/doc.ts:597` |
| E166 | `mkp.shadow` | error | "document" is reserved for the document itself; name the definition something else | `packages/core/src/check/doc.ts:109` |
| E167 | `mkp.shadow` | error | row is already a base widget or type; give this one its own name (mkp show --source --as copies one renamed) | `packages/core/src/check/doc.ts:114` |
| E168 | `mkp.no-project` | error | badge has no project md: a document's widget says in Markdown what it shows, for readers without it | `packages/core/src/check/doc.ts:146` |
| E169 | `mkp.yaml-control-char` | error | the panel block holds a control character (\t); a backslash in "double quotes" is an escape, so write LaTeX in 'single quotes' (e.g. '\theta') | `packages/core/src/check/doc.ts:269` |
| E170 | `mkp.part-in-document` | error | tile is a part; parts are used inside definitions, not in documents | `packages/core/src/check/doc.ts:327` |
| E171 | `mkp.input-type` | error | items[1] is {city: text, fact: text}, but the items before it are {city: text, fact: int}: every item has the same fields of the same types | `packages/core/src/check/doc.ts:397` |
| E172 | `mkp.input-type` | error | picklist can't tell what T is: give the inputs that hold it | `packages/core/src/check/doc.ts:403` |
| E173 | `mkp.doc-item` | error | a document defines widgets, parts, types and fns; a macro belongs in a pack | `packages/core/src/check/doc.ts:101` |
| E174 | `mkp.shadow` | error | iconname is already a base widget or type; give this one its own name | `packages/core/src/check/doc.ts:114` |
| E175 | `mkp.doc-item` | error | a document defines widgets, parts, types and fns; tokens belongs in a pack | `packages/core/src/check/doc.ts:101` |
| E176 | `mkp.input-type` | error | items is empty, so its items' type can't be told; give at least one | `packages/core/src/check/doc.ts:397` |
| E177 | `mkp.unknown-slot` | error | gallery has no slot "sidebar" | `packages/core/src/check/doc.ts:620` |
| E178 | `mkp.missing-input` | error | the pane record needs count | `packages/core/src/check/doc.ts:633` |
| E179 | `mkp.unknown-prop` | error | gallery has no input "colour" | `packages/core/src/check/doc.ts:683` |
| E180 | `mkp.no-slot` | error | badge has no slot to hold the container's Markdown | `packages/core/src/check/doc.ts:646` |
| E181 | `mkp.missing-field` | error | at.y's default (twice(2)) reads something YAML data can't: give it in the data | `packages/core/src/check/doc.ts:23` |
| E182 | `mkp.doc-size` | error | the document's own definitions are 813 lines; at most 800 — a definition used this much belongs in a pack | `packages/core/src/check/doc.ts:96` |
| E183 | `mkp.input-type` | error | T is {city: text} in one place and {year: int} in another | `packages/core/src/check/doc.ts:400` |
| E184 | `mkp.type-syntax` | error | expected ")" in the type | `packages/core/src/types.ts:65` |
| E185 | `mkp.type-syntax` | error | expected "," in the type | `packages/core/src/types.ts:73` |
| E186 | `mkp.type-syntax` | error | expected a number in the range | `packages/core/src/types.ts:82` |
| E187 | `mkp.type-syntax` | error | expected a type | `packages/core/src/types.ts:92` |
| E188 | `mkp.type-syntax` | error | expected a variable name in expr(…) | `packages/core/src/types.ts:117` |
| E189 | `mkp.type-syntax` | error | expected an option in choice(…) | `packages/core/src/types.ts:139` |
| E190 | `mkp.type-syntax` | error | expected the record name | `packages/core/src/types.ts:154` |
| E191 | `mkp.type-syntax` | error | expected a field name | `packages/core/src/types.ts:199` |
| E192 | `mkp.token-value` | error | color brand: value must be a hex colour such as "#2563eb" | `packages/core/src/tokens.ts:35` |
| E193 | `mkp.token-syntax` | error | space tokens are written name=value | `packages/core/src/tokens.ts:42` |
| E194 | `mkp.maths` | error | $\sum_{k=1}^{n} \frac{1}{k$: Missing close brace | `packages/core/src/maths.ts:162` |
| E195 | `mkp.type` | error | list items must share one type; found int and text | `packages/core/src/check/expr.ts:150` |
| E196 | `mkp.type` | error | expected a record with title | `packages/core/src/check/expr.ts:160` |
| E197 | `mkp.unknown-field` | error | swatch has no field "colur" (did you mean "colour"?) | `packages/core/src/check/expr.ts:200` |
| E198 | `mkp.unknown-field` | error | list(int) has no fields; "len" can't be read from it | `packages/core/src/check/expr.ts:204` |
| E199 | `mkp.type` | error | task is read by a path (an input typed path(…)) or with .field; found int | `packages/core/src/check/expr.ts:213` |
| E200 | `mkp.type` | error | this path reads note, not task | `packages/core/src/check/expr.ts:214` |
| E201 | `mkp.type` | error | dict keys are text; found int | `packages/core/src/check/expr.ts:223` |
| E202 | `mkp.type` | error | only lists and dicts can be indexed; found text | `packages/core/src/check/expr.ts:228` |
| E203 | `mkp.type` | error | "not" needs a boolean; found int | `packages/core/src/check/expr.ts:243` |
| E204 | `mkp.type` | error | "and" needs booleans; found int | `packages/core/src/check/expr.ts:250` |
| E205 | `mkp.type` | error | a lambda (x => …) can only be passed where a function is expected | `packages/core/src/check/expr.ts:267` |
| E206 | `mkp.type` | error | this function takes 1 parameter(s), not 2 | `packages/core/src/check/expr.ts:270` |
| E207 | `mkp.unknown-name` | error | "bound" is not defined here | `packages/core/src/check/expr.ts:326` |
| E208 | `mkp.type` | error | constant ceiling refers to itself | `packages/core/src/check/expr.ts:334` |
| E209 | `mkp.type` | error | expected int, found text | `packages/core/src/check/expr.ts:369` |
| E210 | `mkp.type` | error | can't compare int with text | `packages/core/src/check/expr.ts:421` |
| E211 | `mkp.type` | error | can't join list(int) and list(text) | `packages/core/src/check/expr.ts:433` |
| E212 | `mkp.no-operator` | error | no operator + for list(int) and text | `packages/core/src/check/expr.ts:441` |
| E213 | `mkp.ambiguous` | error | blend is ambiguous for (int, int): $doc:blend#0 and $doc:blend#1 fit equally | `packages/core/src/check/expr.ts:478` |
| E214 | `mkp.type` | error | this function takes 1 argument(s) | `packages/core/src/check/expr.ts:567` |
| E215 | `mkp.type` | error | this expression takes 1 variable(s) | `packages/core/src/check/expr.ts:572` |
| E216 | `mkp.type` | error | int is not a function | `packages/core/src/check/expr.ts:577` |
| E217 | `mkp.type` | error | "n" is a int, not a function | `packages/core/src/check/expr.ts:586` |
| E218 | `mkp.no-overload` | error | no twice(…) takes (text); candidates: twice(int) | `packages/core/src/check/expr.ts:614` |
| E219 | `mkp.ambiguous` | error | pad is defined more than once with 2 parameter(s); give the parameters types so calls can be dispatched | `packages/core/src/check/expr.ts:621` |
| E220 | `mkp.type` | error | pad takes 2 argument(s), not 1 | `packages/core/src/check/expr.ts:622` |
| E221 | `mkp.unknown-function` | error | there is no function "flor" (did you mean "floor"?) | `packages/core/src/check/expr.ts:623` |
| E222 | `mkp.type` | error | \val{sw} is swatch, which has no written form; show one of its fields, or give its type a show fn | `packages/core/src/check/expr.ts:651` |
| E223 | `mkp.limit` | error | the expression is nested too deeply | `packages/core/src/check/expr.ts:121` |
| E224 | `mkp.ambiguous` | error | "top" is a constant in several packs (scales, levels); qualify it | `packages/core/src/check/expr.ts:316` |
| E225 | `mkp.arity` | error | len takes 1 argument(s), not 2 | `packages/core/src/check/expr.ts:702` |
| E226 | `mkp.type` | error | sort needs a list; found int | `packages/core/src/check/expr.ts:710` |
| E227 | `mkp.type` | error | len needs a list, text or dict; found int | `packages/core/src/check/expr.ts:730` |
| E228 | `mkp.type` | error | filter needs a function that returns a boolean | `packages/core/src/check/expr.ts:747` |
| E229 | `mkp.type` | error | fold's function must return the accumulator's type int; it returns text | `packages/core/src/check/expr.ts:780` |
| E230 | `mkp.type` | error | flatten needs a list of lists | `packages/core/src/check/expr.ts:825` |
| E231 | `mkp.type` | error | mean needs a list of numbers | `packages/core/src/check/expr.ts:871` |
| E232 | `mkp.type` | error | if needs a boolean condition; found int | `packages/core/src/check/expr.ts:883` |
| E233 | `mkp.type` | error | if's branches have different types: int and text | `packages/core/src/check/expr.ts:908` |
| E234 | `mkp.type` | error | put needs a dict; found list(int) | `packages/core/src/check/expr.ts:916` |
| E235 | `mkp.type` | error | this dict holds int, not text | `packages/core/src/check/expr.ts:921` |
| E236 | `mkp.type` | error | get needs a dict; found list(int) | `packages/core/src/check/expr.ts:928` |
| E237 | `mkp.type` | error | the default must be int | `packages/core/src/check/expr.ts:931` |
| E238 | `mkp.type` | error | keys needs a dict | `packages/core/src/check/expr.ts:937` |
| E239 | `mkp.type` | error | has needs a dict | `packages/core/src/check/expr.ts:943` |
| E240 | `mkp.type` | error | join needs a list of text | `packages/core/src/check/expr.ts:958` |
| E241 | `mkp.type` | error | sum needs a list of numbers | `packages/core/src/check/expr.ts:1042` |
| E242 | `mkp.type` | error | sum over text needs + and a from(num) for that type | `packages/core/src/check/expr.ts:1054` |
| E243 | `mkp.type` | error | min needs numbers | `packages/core/src/check/expr.ts:1062` |
| E244 | `mkp.type` | error | max takes two numbers or a list; found text and int | `packages/core/src/check/expr.ts:1070` |
| E245 | `mkp.type` | error | iterate's step must return the state's type int; it returns text | `packages/core/src/check/expr.ts:1081` |
| E246 | `mkp.profile` | error | there is no profile "lesson" among the packs given | `packages/core/src/profile.ts:47` |
| E247 | `mkp.front-type` | error | front matter level must be int | `packages/core/src/profile.ts:61` |
| E248 | `mkp.front-unknown` | error | the lesson profile has no front-matter field "author" | `packages/core/src/profile.ts:63` |
| E249 | `mkp.role` | error | "warmup" is not a section role of lesson (intro, example) | `packages/core/src/profile.ts:71` |
| E250 | `mkp.attr-type` | error | weight must be choice(core\|extra) | `packages/core/src/profile.ts:78` |
| E251 | `mkp.rule.depth` | error | sections go two deep at most | `packages/core/src/profile.ts:99` |
| E252 | `mkp.rule.first` | error | a lesson starts with a heading | `packages/core/src/profile.ts:105` |
| E253 | `mkp.rule.required` | error | cite at least one source | `packages/core/src/profile.ts:109` |
| E254 | `mkp.rule.one-of` | error | scope is topic or chapter | `packages/core/src/profile.ts:113` |
| E255 | `mkp.rule.pattern` | error | course ids are kebab-case | `packages/core/src/profile.ts:124` |
| E256 | `mkp.rule.max-length` | error | keep titles short | `packages/core/src/profile.ts:130` |
| E257 | `mkp.rule.count` | error | one to three examples | `packages/core/src/profile.ts:139` |
| E258 | `mkp.rule.count` | error | exactly two examples | `packages/core/src/profile.ts:140` |
| E259 | `mkp.rule.required` | error | required front.sources | `packages/core/src/profile.ts:94` |
| E260 | `mkp.profile` | error | rule pattern front.course: "[a-z" is not a valid pattern | `packages/core/src/profile.ts:122` |
| E261 | `mkp.profile` | error | unknown rule "length"; rules are required, one-of, pattern, max-length, count, depth and first | `packages/core/src/profile.ts:144` |
| E262 | `mkp.pack-duplicate` | error | pack notes@1 is given twice | `packages/core/src/check/program.ts:96` |
| E263 | `mkp.duplicate-definition` | error | note@1 is defined twice in pack notes | `packages/core/src/check/program.ts:108` |
| E264 | `mkp.op-untyped` | error | op + must type every parameter; dispatch uses them (6.22) | `packages/core/src/check/program.ts:126` |
| E265 | `mkp.untyped` | error | fn double must type every parameter and its result: fn double(x: num): num = … | `packages/core/src/check/program.ts:128` |
| E266 | `mkp.pack-reserved` | error | the pack name "core" is reserved for the base set | `packages/core/src/build.ts:223` |
| E267 | `mkp.pack-depends` | error | notes depends on chips@1, which this build was not given (pass it with --pack) | `packages/core/src/build.ts:241` |
| E268 | `mkp.duplicate-type` | error | type size is declared twice in pack notes | `packages/core/src/check/program.ts:114` |
| E269 | `mkp.duplicate-definition` | error | interface scored@1 is declared twice in pack notes | `packages/core/src/check/program.ts:148` |
| E270 | `mkp.pack-depends` | error | notes depends on chips@2; this build has chips@1 | `packages/core/src/build.ts:242` |
| E271 | `mkp.capability` | error | notes requires audio@1, which is not a known capability (core@1, gfx@1) | `packages/core/src/build.ts:244` |
| E272 | `mkp.pack-provides` | error | notes provides "callout", but no definition, type, fn or constant has that name | `packages/core/src/build.ts:247` |
| E273 | `mkp.reserved` | error | column is a base widget name and is reserved | `packages/core/src/build.ts:261` |
| E274 | `mkp.reserved` | error | slot is a built-in node name (each, switch, case, else, slot, fill, controls, arrow) and is reserved | `packages/core/src/build.ts:263` |
| E275 | `mkp.capability-fallback` | warning | note requires audio@1; providers without it show its fallback | `packages/core/src/build.ts:278` |
| E276 | `mkp.limit` | error | level1 nests definitions 13 deep; at most 12 | `packages/core/src/build.ts:380` |
| E277 | `mkp.name-clash` | warning | note is provided by notes and remarks; uses must be qualified as pack:note | `packages/core/src/build.ts:260` |
| E278 | `mkp.version-changed` | error | notes:note@1 changed since it was locked; a behaviour change is a new version (@N+1), or build with --relock while the pack is unpublished | `packages/core/src/build.ts:399` |
| E279 | `mkp.pack-changed` | warning | notes@1 changed since the lock was written; a published version must not change | `packages/core/src/build.ts:392` |
| E280 | `mkp.pack-size` | error | pack.mkpack is 28.5 MB; a pack may be at most 25 MB | `packages/core/src/pack.ts:38` |
| E281 | `mkp.pack-zip` | error | pack.mkpack is not a zip file | `packages/core/src/pack.ts:50` |
| E282 | `mkp.pack-zip` | error | pack.mkpack has a damaged central directory | `packages/core/src/pack.ts:60` |
| E283 | `mkp.pack-path` | error | pack.mkpack: "../note.mkp" is an absolute path or uses ".."; packs hold relative paths only | `packages/core/src/pack.ts:73` |
| E284 | `mkp.pack-symlink` | error | pack.mkpack: "note-link.mkp" is a symlink; packs may not hold links | `packages/core/src/pack.ts:78` |
| E285 | `mkp.pack-size` | error | pack.mkpack: "banner.png" is 11.0 MB; files may be at most 10 MB | `packages/core/src/pack.ts:83` |
| E286 | `mkp.pack-manifest` | error | case308/pack has no manifest.mkp | `packages/core/src/pack.ts:149` |
| E287 | `mkp.pack-manifest` | error | manifest.mkp must start with "pack name@N" (or "profile name@N") | `packages/core/src/pack.ts:155` |
| E288 | `mkp.pack-requires` | warning | notes: the manifest should say "requires core@1" | `packages/core/src/pack.ts:174` |
| E289 | `mkp.pack-size` | error | banner.png is over 10 MB | `packages/core/src/pack.ts:184` |
| E290 | `mkp.fixture-json` | error | note.fixture.json is not valid JSON: Expected double-quoted property name in JSON at position 63 (line 1 column 64) | `packages/core/src/pack.ts:195` |
| E291 | `mkp.pack-svg` | error | logo.svg is not a safe SVG (DOCTYPE, entities or no <svg> root) | `packages/core/src/pack.ts:205` |
| E292 | `mkp.pack-file-type` | error | notes.txt: packs hold .mkp, .fixture.json and png, jpg, webp, svg or woff2 assets only | `packages/core/src/pack.ts:211` |
| E293 | `mkp.pack-file-type` | warning | notes.txt is not part of a pack and is left out | `packages/core/src/pack.ts:213` |
| E294 | `mkp.pack-size` | error | case317/pack holds 27.0 MB; a pack may be at most 25 MB | `packages/core/src/pack.ts:216` |
| E295 | `mkp.pack-size` | error | pack.mkpack unpacks to 27.0 MB; a pack may be at most 25 MB | `packages/core/src/pack.ts:91` |
| E296 | `mkp.tab` | error | tabs are not allowed in indentation; indent with two spaces | `packages/core/src/syntax/lexer.ts:48` |
| E297 | `mkp.unclosed-text` | error | a """ long text is never closed; end it with a line holding """ | `packages/core/src/syntax/lexer.ts:79` |
| E298 | `mkp.unclosed-bracket` | error | a bracket is never closed | `packages/core/src/syntax/lexer.ts:94` |
| E299 | `mkp.indent` | error | this line is indented 6 spaces; children are indented two spaces below their parent (4) | `packages/core/src/syntax/lexer.ts:113` |
| E300 | `mkp.indent` | error | indentation must be a multiple of two spaces | `packages/core/src/syntax/lexer.ts:115` |
| E301 | `mkp.syntax` | error | unexpected ")" after the expression | `packages/core/src/syntax/expr.ts:39` |
| E302 | `mkp.syntax` | error | expected ":" but found "1" | `packages/core/src/syntax/expr.ts:61` |
| E303 | `mkp.syntax` | error | comparisons do not chain; join them with "and" | `packages/core/src/syntax/expr.ts:131` |
| E304 | `mkp.syntax` | error | expected a field name after "." | `packages/core/src/syntax/expr.ts:222` |
| E305 | `mkp.syntax` | error | "and" cannot start a value here | `packages/core/src/syntax/expr.ts:254` |
| E306 | `mkp.syntax` | error | expected a field name in the record | `packages/core/src/syntax/expr.ts:277` |
| E307 | `mkp.syntax` | error | there is no \|x\|; write abs(x) | `packages/core/src/syntax/expr.ts:288` |
| E308 | `mkp.syntax` | error | unexpected "*" | `packages/core/src/syntax/expr.ts:289` |
| E309 | `mkp.syntax` | error | the expression ends too early | `packages/core/src/syntax/expr.ts:291` |
| E310 | `mkp.front-matter` | error | the front matter is never closed with --- | `packages/core/src/syntax/doc.ts:41` |
| E311 | `mkp.container` | error | the container :::row is never closed with ::: | `packages/core/src/syntax/doc.ts:108` |
| E312 | `mkp.attrs-orphan` | warning | attributes must follow a block | `packages/core/src/syntax/doc.ts:124` |
| E313 | `mkp.syntax` | error | expected name@N, found "distance" | `packages/core/src/syntax/mkp.ts:228` |
| E314 | `mkp.syntax` | error | "dist/ance" is not a valid name (letters, digits, ".", "-" and "_") | `packages/core/src/syntax/mkp.ts:229` |
| E315 | `mkp.syntax` | error | expected a quoted description, found kilometres | `packages/core/src/syntax/mkp.ts:235` |
| E316 | `mkp.syntax` | error | expected name@N | `packages/core/src/syntax/mkp.ts:244` |
| E317 | `mkp.syntax` | error | expected a name | `packages/core/src/syntax/mkp.ts:244` |
| E318 | `mkp.syntax` | error | "tally/count" is not a valid name (letters, digits, ".", "-" and "_") | `packages/core/src/syntax/mkp.ts:249` |
| E319 | `mkp.syntax` | error | "item" is not a type parameter: one capitalised word, such as S or Item | `packages/core/src/syntax/mkp.ts:260` |
| E320 | `mkp.syntax` | error | of names the type parameters: name of S | `packages/core/src/syntax/mkp.ts:265` |
| E321 | `mkp.syntax` | error | unexpected ""per click"" after the description | `packages/core/src/syntax/mkp.ts:268` |
| E322 | `mkp.syntax` | error | expected interface name@N | `packages/core/src/syntax/mkp.ts:274` |
| E323 | `mkp.syntax` | error | an interface lists in, host, signal and out lines, and "project md" | `packages/core/src/syntax/mkp.ts:285` |
| E324 | `mkp.syntax` | error | a document cannot declare an extern; externs are what a provider draws | `packages/core/src/syntax/mkp.ts:308` |
| E325 | `mkp.syntax` | error | interfaces belong to a host, in its pack; a document cannot declare one | `packages/core/src/syntax/mkp.ts:313` |
| E326 | `mkp.syntax` | error | expected "type name = {field: type, …}" | `packages/core/src/syntax/mkp.ts:334` |
| E327 | `mkp.syntax` | error | "2d" is not a valid type name | `packages/core/src/syntax/mkp.ts:336` |
| E328 | `mkp.syntax` | error | an op is one of + - * / ^ == < from point | `packages/core/src/syntax/mkp.ts:344` |
| E329 | `mkp.syntax` | error | expected "const name[: type] = expression" | `packages/core/src/syntax/mkp.ts:349` |
| E330 | `mkp.syntax` | error | "2x" is not a valid name | `packages/core/src/syntax/mkp.ts:353` |
| E331 | `mkp.syntax` | error | expected "macro name = $…$" | `packages/core/src/syntax/mkp.ts:360` |
| E332 | `mkp.unknown-statement` | error | a top-level line starts a definition (name@N, part, extern), tokens, type, fn, op, const, macro or pack; found "include" | `packages/core/src/syntax/mkp.ts:371` |
| E333 | `mkp.syntax` | error | expected an expression | `packages/core/src/syntax/mkp.ts:477` |
| E334 | `mkp.syntax` | error | "2x" is not a valid function name | `packages/core/src/syntax/mkp.ts:486` |
| E335 | `mkp.syntax` | error | the parameter list is never closed | `packages/core/src/syntax/mkp.ts:500` |
| E336 | `mkp.syntax` | error | "2w" is not a valid parameter name | `packages/core/src/syntax/mkp.ts:519` |
| E337 | `mkp.syntax` | error | expected "= expression" after the parameters | `packages/core/src/syntax/mkp.ts:524` |
| E338 | `mkp.syntax` | error | expected ": type" or "=" after the parameters | `packages/core/src/syntax/mkp.ts:528` |
| E339 | `mkp.syntax` | error | unexpected "extra" after the type | `packages/core/src/syntax/mkp.ts:553` |
| E340 | `mkp.syntax` | error | expected a value after "=" | `packages/core/src/syntax/mkp.ts:557` |
| E341 | `mkp.syntax` | error | unexpected ""again"" | `packages/core/src/syntax/mkp.ts:565` |
| E342 | `mkp.continuation` | error | a value takes no indented lines: to go on with its expression, break the line inside an open bracket (…) | `packages/core/src/syntax/mkp.ts:598` |
| E343 | `mkp.syntax` | error | expected a capability such as gfx@1 | `packages/core/src/syntax/mkp.ts:616` |
| E344 | `mkp.syntax` | error | expected a positive whole number of operations | `packages/core/src/syntax/mkp.ts:619` |
| E345 | `mkp.syntax` | error | implements names an interface: implements scored@1 | `packages/core/src/syntax/mkp.ts:624` |
| E346 | `mkp.syntax` | error | "scored" is not an interface name@N | `packages/core/src/syntax/mkp.ts:625` |
| E347 | `mkp.syntax` | error | "2x" is not a valid input name | `packages/core/src/syntax/mkp.ts:630` |
| E348 | `mkp.syntax` | error | expected "in name type …" | `packages/core/src/syntax/mkp.ts:637` |
| E349 | `mkp.syntax` | error | only an input (in) can be an answer | `packages/core/src/syntax/mkp.ts:640` |
| E350 | `mkp.missing-default` | error | a var always has a default: "var n type = value" | `packages/core/src/syntax/mkp.ts:641` |
| E351 | `mkp.syntax` | error | expected "out name …" | `packages/core/src/syntax/mkp.ts:648` |
| E352 | `mkp.syntax` | error | a signal declares its payload: signal name {field: type, …} | `packages/core/src/syntax/mkp.ts:652` |
| E353 | `mkp.syntax` | error | expected "project md = expression" or "project mermaid = expression" | `packages/core/src/syntax/mkp.ts:670` |
| E354 | `mkp.event-placement` | error | an event belongs under the element or state line it handles; indent it below that line | `packages/core/src/syntax/mkp.ts:687` |
| E355 | `mkp.syntax` | error | expected choice(a\|b\|…) | `packages/core/src/syntax/mkp.ts:700` |
| E356 | `mkp.syntax` | error | "2hard" is not a valid option name | `packages/core/src/syntax/mkp.ts:702` |
| E357 | `mkp.event-placement` | error | only events (@name action …) may be indented under a state line | `packages/core/src/syntax/mkp.ts:724` |
| E358 | `mkp.continuation` | error | this line goes on with the one above, which works only inside an open bracket: put size=… on the line above, or break the line inside its (…) | `packages/core/src/syntax/mkp.ts:737` |
| E359 | `mkp.syntax` | error | ""Count"" is not a valid element name | `packages/core/src/syntax/mkp.ts:738` |
| E360 | `mkp.syntax` | error | expected "@event action …" | `packages/core/src/syntax/mkp.ts:756` |
| E361 | `mkp.syntax` | error | an event line has one if= | `packages/core/src/syntax/mkp.ts:762` |
| E362 | `mkp.syntax` | error | the event "@click" has no actions | `packages/core/src/syntax/mkp.ts:774` |
| E363 | `mkp.unknown-action` | error | "bump" is not an action; actions are set, play, pause, reset, reveal, hide, open, close, emit, send | `packages/core/src/syntax/mkp.ts:790` |
| E364 | `mkp.syntax` | error | expected a value after "n=" | `packages/core/src/syntax/mkp.ts:800` |
| E365 | `mkp.syntax` | error | unpublished takes nothing after it | `packages/core/src/syntax/mkp.ts:394` |
| E366 | `mkp.syntax` | error | expected "front name type [= value] ["about"]" | `packages/core/src/syntax/mkp.ts:399` |
| E367 | `mkp.syntax` | error | expected "attr name type ["about"]" (role and id are taken) | `packages/core/src/syntax/mkp.ts:406` |
| E368 | `mkp.syntax` | error | a block attribute has no default: a block without it has none | `packages/core/src/syntax/mkp.ts:408` |
| E369 | `mkp.syntax` | error | expected "rule name path [args] ["message"]" | `packages/core/src/syntax/mkp.ts:415` |
| E370 | `mkp.syntax` | error | a manifest line is requires, depends, provides, front, attr, roles, rule or unpublished; found "export" | `packages/core/src/syntax/mkp.ts:423` |

## Not triggered

| site | code | why |
|---|---|---|
| `packages/core/src/check/def.ts:491` | `mkp.shadow` | owner is always set to the member name for in/var/host/state, so the empty-owner wording is unreachable |
| `packages/core/src/check/def.ts:879` | `mkp.input-type` | A fractional literal never reaches here: the coerce step before it fails first with mkp.type 'expected int, found num'. |
| `packages/core/src/check/def.ts:243` | `mkp.check` | Helper that builds the MkpError for fail(); not a diagnostic of its own. Every fail() call site is recorded separately. |
| `packages/core/src/check/def.ts:1312` | `mkp.case-unreachable` | A literal case outside the subject's integer range is rejected earlier by this.value() as mkp.input-range ('it takes a whole number from 1 to 3; found 7'), so this warning is unreachable for ranged ints; slider/steps subjects have no integer range and do not warn. |
| `packages/core/src/check/def.ts:1402` | `mkp.check` | Dead code: the preceding check (args.length !== 1 -> mkp.extra-arg 'takes exactly one slider or steps name') already rejects zero arguments, so a.args[0] is always defined here. |
| `packages/core/src/check/def.ts:1448` | `mkp.check` | Unreachable from source: the parser rejects an unknown action name first with mkp.unknown-action ('"launch" is not an action; actions are set, play, ...'). |
| `packages/core/src/check/def.ts:1130` | `mkp.unknown-version` | Unreachable from source: a use such as 'chip@2' is rejected by the syntax pass first (mkp.syntax: '"chip@2" is not a valid element name'), because element names may not contain @. resolveDef's version branch has no caller that passes a version. |
| `packages/core/src/types.ts:240` | `mkp.type-syntax` | parseTypeString is exported but never called from the compiler; the document path reports a different mkp.syntax 'unexpected "6" after the type' instead. |
| `packages/core/src/tokens.ts:66` | `mkp.token-missing` | The core token set (base.ts) always defines every required token, and a pack's token set only adds to it, so no document or pack can remove one. |
| `packages/core/src/check/expr.ts:530` | `mkp.recursive-untyped` | Only reached when specialising an untyped (generic) fn that calls itself. Every untyped fn is refused first with mkp.untyped (program.ts / def.ts abort the widget check for local fns), and for top-level untyped fns the recursive call uses a fresh checker whose in-progress table is empty, so the guard never fires and no diagnostic besides mkp.untyped appears. |
| `packages/core/src/pack.ts:180` | `mkp.pack-path` | Unreachable from the CLI: the folder reader converts backslashes to slashes and skips dot-names before the compiler sees the path, and a zip is checked earlier by the stricter zip reader (pack.ts:73). Only a host that passes a file map straight to compile() could hit it. |
| `packages/core/src/fixtures.ts:65` | `mkp.fixture-shape` | The error is added to the compiler diagnostics after "mkp check" has already printed them, so a fixture file of the wrong shape (e.g. cases as a list) prints nothing but "has no valid fixture case". Not visible from check.sh output. |
| `packages/core/src/runtime/runtime.ts:444` | `mkp.not-state` | Runtime-only: raised while the page is running (Runtime), and no mkp command that check.sh can reach (check compiles documents and fixture cases but never starts a Runtime or plays steps) prints it. A ref input (name={ref}) naming something that is not a state cell in the caller; the compiler is expected to catch this earlier, so this is a late guard. |
| `packages/core/src/runtime/runtime.ts:449` | `mkp.missing-input` | Runtime-only: raised while the page is running (Runtime), and no mkp command that check.sh can reach (check compiles documents and fixture cases but never starts a Runtime or plays steps) prints it. An input with no default left unset, evaluated on demand; compile-time input checks (mkp.input-missing style) fire first in documents. |
| `packages/core/src/runtime/runtime.ts:478` | `mkp.host-input` | Runtime-only: raised while the page is running (Runtime), and no mkp command that check.sh can reach (check compiles documents and fixture cases but never starts a Runtime or plays steps) prints it. A host supplies a value of the wrong type for a host input via runtime options (hosts map); not something a document or pack can set. |
| `packages/core/src/runtime/runtime.ts:771` | `mkp.recursion` | Runtime-only: raised while the page is running (Runtime), and no mkp command that check.sh can reach (check compiles documents and fixture cases but never starts a Runtime or plays steps) prints it. A recursive widget rendering beyond 12 levels while running; check does not render. Compile-time depth limit (mkp.limit, build.ts:380) covers non-recursive chains only. |
| `packages/core/src/runtime/runtime.ts:840` | `mkp.arrow-missing` | Runtime-only: raised while the page is running (Runtime), and no mkp command that check.sh can reach (check compiles documents and fixture cases but never starts a Runtime or plays steps) prints it. An arrow between element ids resolved at render time; ids are values (can be computed), so the compiler does not check them. |
| `packages/core/src/runtime/runtime.ts:865` | `mkp.arrow-missing` | Runtime-only: raised while the page is running (Runtime), and no mkp command that check.sh can reach (check compiles documents and fixture cases but never starts a Runtime or plays steps) prints it. Same runtime resolution, for a via waypoint. |
| `packages/core/src/runtime/runtime.ts:1554` | `mkp.action-target` | Runtime-only: raised while the page is running (Runtime), and no mkp command that check.sh can reach (check compiles documents and fixture cases but never starts a Runtime or plays steps) prints it. A reveal or hide action whose computed id matches no element when pressed. |
| `packages/core/src/runtime/runtime.ts:1589` | `mkp.signal-rate` | Runtime-only: raised while the page is running (Runtime), and no mkp command that check.sh can reach (check compiles documents and fixture cases but never starts a Runtime or plays steps) prints it. More than 30 send actions per second; needs a running page and fast repeated input. |
| `packages/core/src/runtime/runtime.ts:1593` | `mkp.signal-size` | Runtime-only: raised while the page is running (Runtime), and no mkp command that check.sh can reach (check compiles documents and fixture cases but never starts a Runtime or plays steps) prints it. A send action whose payload serialises beyond 16 KB at runtime. |
| `packages/core/src/syntax/expr.ts:53` | `mkp.syntax` | Shared helper (fail) used by every expression syntax error; each caller is its own line here. |
| `packages/core/src/syntax/mkp.ts:182` | `mkp.syntax` | Shared helper (LineCtx.fail) used by every definition-syntax error; each caller is its own line here. |
