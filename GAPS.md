# Gaps found while building the Study Pad provider

A running log, kept as each gap turned up (Mujtaba asked for every one, verbatim and summarised, at
the finish line). It moved here from Study Pad with MKP, so new gaps go here. **MKP** entries concern
MKP itself (language, runtime, renderer, CLI, packs) and are product-neutral. Those that changed MKP
also have a note in `SPEC-NOTES.md` (cited as SN n). **Provider** entries concern Study Pad's provider
(`ui/src/derived/mkp` in study-pad) or how a host's CSS meets MKP's. Older entries keep the paths they
were written with: `mkp/` is this repo's root as it was inside study-pad.
Status: *fixed* (and where), *worked around* (in the provider, MKP unchanged), *open*, *reading* (a
rule of the spec, not a defect), *in progress*.

1. **MKP: built-in node names weren't reserved.** A demo widget named `controls` compiled cleanly and
   drew nothing, because a document's `state` block compiles to the built-in `controls` node, and a
   use is an IR node named after its definition. The same goes for `each`, `switch`, `case`, `else`,
   `slot`, `fill` and `arrow`. *Fixed:* core gives `mkp.reserved`, with a test (SN 76). The demo
   widget is now `interface-parts`.
2. **Provider/MKP: inline maths broke onto its own line under a CSS reset.** Tailwind's preflight sets
   `svg { display: block }`, and MKP's base stylesheet leaves the maths SVG's display to the browser
   default. *Worked around:* the skin sets the SVGs inline. *Open in MKP:* the base stylesheet should
   set the display of every element whose layout it relies on.
3. **Provider/MKP: lists lost their markers and spacing under the same reset.** Preflight clears
   `list-style`, and MKP's base stylesheet relies on the browser's list styles. *Worked around:* the
   skin draws the markers and the spacing (and `li p { margin: 0 }`). *Open in MKP:* same as 2.
4. **MKP: box outlines could only be the colour of the text.** `stroke=muted` drew outlines in the
   muted text colour, much darker than ui's borders, and tokens can't give one colour name two
   values. *Fixed:* a box's stroke reads `--mkp-stroke-<name>` first (SN 80). The skin maps `muted` to
   `--border`.
5. **MKP: the base stylesheet beats the host's at equal specificity.** It is injected after the host's
   CSS, so every skin rule lost until it was prefixed `.sp-mkp.mkp-root`. *Worked around:* the
   prefix. *Open in MKP:* put the base stylesheet in a cascade layer (`@layer mkp`), so any unlayered
   host rule wins without specificity tricks.
6. **MKP: alert and quote bodies kept their `> ` markers.** Inline text is sliced from the source, so
   a paragraph running over several lines inside a quote kept `> ` at the start of its continuation
   lines. *Fixed* in core's Markdown, with a test (SN 77).
7. **MKP: footnote references never resolved.** Each paragraph is parsed on its own, and Markdown only
   recognises `[^x]` beside its definition. *Fixed:* every reference is parsed against a stand-in
   definition, with a test (SN 78).
8. **MKP: a host couldn't lay out a document's blocks itself.** `MkpDocument` drew every block in one
   root, so headings couldn't become the lesson renderer's sections. *Fixed:* `MkpProvider` plus
   `useMkpView()`, with a test (SN 79). Looking a block up by its position in the view list is wrong
   (a state block draws nothing), so a host looks it up by its `doc/<index>` key.
9. **MKP: a provider's stylesheet had nothing to select on.** There was no mark of which base widget a
   node is, no press kind, and no value for a slider's filled track. *Fixed:* `data-mkp`, `data-kind`
   and `--mkp-range-fill` (SN 80), with tests.
10. **MKP: a row of tabs had no tablist.** `press kind=tab` was `role=tab` with no `role=tablist`
    around it. *Fixed* in the web renderer, with a test (SN 81).
11. **MKP: mkp-ui's switch showed "on" only through the press fill.** When a provider styled pressed
    toggles differently, the switch drew a white knob on white. *Fixed:* the track is `fill=accent`
    (SN 82).
12. **MKP: a profile rule's error points at 1:1.** A failed `rule` (a pattern on `scope`, a required
    `summary`) reports the start of the file, not the front-matter line it checks. *Open* (SN 83).
13. **MKP: parts can't be used in documents.** So `tabs`, `slider`, `select`, `toggle`, `stepper`,
    `playback`, `value` and `button` can't be shown or judged directly. *Reading* (SN 84). The demo
    pack wraps them in `interface-parts`.
14. **MKP: the CLI's lock defaults to `./mkp.lock` in the current directory.** A build run from
    another folder read a stale lock left there, and a run in `mkp/` left a stray `mkp/mkp.lock`.
    *Worked around:* `build:mkp` always passes `--lock lessons/mkp.lock`. *Open:* default to a lock
    beside the document (or the nearest one above it). `mkp check` reads the same `./mkp.lock`, so
    every edited pack also reports `mkp.pack-changed` there.
15. **MKP: a changed definition needs an @N bump even before anything is published.** Every pack fix
    in this work failed the lessons' build with `mkp.version-changed`. *Worked around:*
    `build:mkp -- --relock` starts the lock afresh. *Open:* a way to mark a pack unpublished (or a
    `--relock` in the CLI itself).
16. **MKP: a provider couldn't tell a tooltip from a popover.** Both were the same overlay span.
    *Fixed:* `data-mkp="overlay"` and `data-mode`. The skin draws a tooltip's trigger as a term with a
    dotted underline.
17. **MKP (mkp-charts): the second series was `warn`.** It read as an alert next to the first.
    *Fixed in the pack:* series run accent, info, warn, ok (`chart`, `axes`, and the legend).
18. **MKP: no fixed-height sizing.** A canvas only has an aspect, so a bar's height follows its width:
    mkp-ui's progress bar at 28:1 was a slab at lesson width and a sliver on a phone. *Worked around:*
    48:1. *Open:* a canvas height in a size token (or a min/max height).
19. **MKP: no shrink-to-content sizing.** A chart's canvas has a fixed width, but the text under it
    spans the whole block, so the x-axis label with `align=center` sat centred across the page, not
    under the plot. *Worked around:* the label is left-aligned. *Open:* a stack that is as wide as its
    widest child.
20. **MKP (mkp-learn): `quiz.numeric`'s Hint and Show the solution were full-width rows.** They were
    direct children of the question's stack. *Fixed in the pack:* they sit in one row (`flex`). The
    skin's answer-row look now applies only to option and toggle presses.
21. **MKP (mkp-diagrams, mkp-cs): edges through nodes, labels on labels.** A flow's back-edge (a
    retry loop) is drawn straight through the boxes between, and so are a layered graph's edges that
    span several layers. ER and flow edge labels overlap. mkp-cs's protocol state machine sends its
    back-edges up through the states. *Fixed* (#7909, by a subagent, in the packs' compute layer with
    no provider layout engine):
    - A back link or a link that skips a layer gets a "lane" in every row it crosses: an empty
      element stretched to the row's height. The arrow runs through the lanes with `arrow via=`
      (37). The lanes are ordered with the boxes by barycentre sweeps.
    - flow's rows are now the longest path along the links that don't loop back.
    - Labels are laid out beside their lane in a row of their own, so they can't overlap.
    - The shared code is `mkp-diagrams/route.mkp`. protocol has its own few lines, because of 39.
    - The tests check on 8 fixtures that every edge steps one row at a time.

    *Still open:* see 52–54.
22. **MKP: `arrow` has no label placement.** mkp-cs's protocol lists its transitions as text under the
    diagram, because a label can't be put along an edge. *Fixed for flow and er* (21): their labels are
    content, laid out beside the lanes. Protocol keeps its list under the diagram, which also reads
    as a transition table.
23. **MKP (mkp-math): an orbit label can sit on its own point.** In the 18.5 roots widget at n = 5,
    `ω³` overlaps its dot (bottom left). The other labels clear theirs. *Open.*
24. **MKP (mkp-learn): a theorem's ∎ sits alone in a wide band.** Below the proof, the end-of-proof
    mark has a line to itself and a large empty space under it. *Open*, minor.
25. **Provider: the inline select's chosen option was a solid black button.** That isn't ui's
    convention. Mujtaba spotted it. *Fixed:* a row of options is ui's joined outline ToggleGroup with
    the chosen one in `--accent`. Options stacked one per line keep the Question-row look (chosen =
    foreground border).
26. **Provider: in dark, the button fill reached answer rows and joined groups.** ui gives dark
    buttons `bg-input/30`. The skin's rule for that had the same specificity as the row rules and
    came later, so option rows and ToggleGroup items were filled. *Fixed:* answer rows sit on the
    background, as ui's Question rows do, and group items are transparent.
27. **Provider: the lesson dropped its web sources.** `lessonOf` passed `webSources: []` whatever the
    front matter said. *Fixed:* they're carried over, with empty optional fields left out as the
    lesson schema has them. There's a test.
28. **Provider (playground): `npm run shot -- --width 390` drew fixtures at their frame width.**
    FixtureView fixed a fixture's frame at `frame.width` (900 here). The case's `<section>` and the
    page's `<main>` are grids, whose auto tracks grew to that min-content, so every "phone" shot was
    900px. *Fixed* in `playground/FixtureView.tsx`: frames are `max-width: 100%`, and the case is a
    `min-w-0` flex column. `--width` now works for every fixture.
29. **MKP (mkp-data, mkp-cs): side-by-side columns never stacked on a phone.** `grow` is `flex: 1 1 0`,
    a basis of 0, so a row of grown stacks never wraps. Grid columns are `minmax(0, 1fr)`, so they
    clip instead: the join's depts table cut "Engineering" off, and the trace squeezed its code until
    each line number wrapped onto its own line. *Fixed in the packs:* `grow basis=m` on the join's
    tables and the trace's code, and `wrap=false` on a code line. *Open:* the authoring guide should
    say that a row only stacks when its children have a `basis` (or a lint could flag `grow` with no
    `basis` in a wrapping row).
30. **MKP: no width-dependent conditions.** On a phone the join's tables stack, so its match arrow
    (left row → right row) now runs down through the other left rows. MKP can't know the row has
    wrapped (it has no container queries or breakpoints), so a widget can't pick another route or
    layout. *Open.*
31. **MKP (mkp-learn): annotated-source broke its "line 3:" label in two on a phone.** The label was a
    plain text item in a no-wrap row, so it shrank and wrapped at its space. *Fixed in the pack:* the
    label is `wrap=false`.
32. **MKP (mkp-charts): a plotted point can cover a tick label.** In `axes`, the point at (0, 1)
    covers the y-axis label "1" (at every width). *Open*, minor.
33. **Provider/MKP: a footnote's marker floated above its text.** Tailwind's preflight gives every
    `sup` `position: relative; top: -0.5em`, and the footnote's marker is a `sup`. So the marker sat
    a line above the note, and baseline alignment can't undo the offset. *Worked around:* the skin
    resets it. *Open in MKP:* same as 2 and 3. The base stylesheet relies on browser defaults that
    a CSS reset changes.
34. **MKP: footnotes show their label, not a number.** `[^engine]` draws "engine" as the reference
    and as the note's marker, where GitHub numbers footnotes in order. *Open*, minor. A label is
    an author's name for the note, so the renderer could number them by first reference.
35. **MKP: a profile checks front matter and roles, not the body's shape.** Study Pad Markdown also
    requires: content only after a `#` heading, headings at most three deep with no level
    skipped, and one-line list items. It also checks citations against the lesson's sources (and,
    with the library, that a pinned source and page exist). None of that can be a profile `rule`.
    *Worked around:* `lessonOf` puts anything before the first heading into an opening section,
    clamps the depth at 3 and hangs a skipped level on the nearest open parent. The rest stays the
    host's validation. *Open:* structure rules in profiles (heading depth, content before the first
    heading), and a cross-field check (an id in one field must appear in another).
36. **Provider: duplicate DOM ids.** A widget block's wrapper took the block's anchor as its id, and
    MKP's renderer already gives the widget's scope that same id. So every anchored widget's id
    appeared twice, which broke `#anchor` links and anything that looks an id up. *Fixed:* the
    wrapper takes the id only when MKP's node doesn't carry the anchor. The whole-lesson test
    checks that ids are unique and that every block's anchor resolves.

*Entries 37–55 are from the diagrams subagent (#7909). 55 was checked and fixed afterwards.*

37. **MKP: `arrow` had no waypoints.** It could only join two outlines with a line or one bend, and
    the compute layer can't know where flex rows put the boxes, so no expression could steer an edge
    round them. *Fixed:* `arrow via=(ids)` runs the path through other elements in order: a tall one
    top to bottom, a wide one side to side, an empty one through its centre. Corners are rounded. It
    covers the checker, runtime and both renderers, with docs (runtime spec, authoring guide) and tests
    (`core/test/arrow.test.ts`, `react/test/arrows.test.tsx`).
38. **MKP (mkp-diagrams): flow and er wrote no edges in plain Markdown.** Their Markdown fallback had
    the boxes but not the connections. Once labels were content, it would have gained stray
    "yes / no" lines. *Fixed:* a `project md` on each writes every connection as text.
39. **MKP: packs can share an MKP function only through a dependency or core@1.** Changing core@1's
    source changes its digest in every lock and golden. *Worked around:* mkp-cs's protocol has its
    own copy of the lane logic rather than depend on mkp-diagrams. *Open.*
40. **MKP: every bundle carries every loaded pack's named types.** A `type` declared in mkp-diagrams
    changed all 147 conformance goldens. *Worked around:* `route.mkp` declares no named type.
    *Open.*
41. **MKP: no per-child alignment in flex or stack, and no `justify` on stack.** Centring a box in a
    stretched cell needs a wrapper `flex`. *Worked around. Open.*
42. **MKP: a derived value can shadow an option value with a baffling error.** A value named `down`
    shadowed `dir`'s option `down`: "expected one of down, right, found down". *Worked around:* it was
    renamed. *Open:* the message should say what was found (a variable) or refuse the shadowing.
43. **MKP: a local fn with typed params but no return type is `any`,** which `each` then refuses.
    *Worked around:* the return type is given. *Open:* infer it, or ask for it.
44. **MKP: an inline record kind (`record move`) can't be a type in a fn signature.** *Worked
    around. Open.*
45. **Environment (DevBench): the gatekeeper refuses shell text containing a dot followed by `key`**
    (it reads it as a secret file), which MKP code like `c.key` hits. *Worked around:* the field is
    named `id`, and such code is edited with the editor tools.
46. **Provider: `build:mkp` built the CLI only when it was missing.** After a core change the lessons
    were built with a stale CLI. *Fixed:* it rebuilds when any core or CLI source is newer than
    `dist/mkp.cjs`.
47. **MKP: a provided name is visible to every pack, depended on or not** (`program.ts:131`
    `visible()`). An undeclared dependency compiles whenever the other pack happens to be loaded.
    *Open.*
48. **MKP: `pnpm conformance` only replays the stored bundles.** It passed 147/147 with three
    definitions changed. CI catches stale goldens (it regenerates and diffs), but a local run
    doesn't. *Open:* check mode should recompile and compare.
49. **MKP: `pnpm conformance --generate` rewrites every case.** There's no per-pack option. *Open.*
50. **MKP: web arrows appear one frame late.** The first measure pass runs before the scope's ref is
    attached, so tests have to wait a frame. *Fixed:* the scope runs the measure in its own layout
    effect, so arrows are there at first paint (SN 102).
51. **MKP: web arrow labels have no background** (the native ones do). So a label can't sit across
    its line; in network-deps, "exprs" and "scales" sit on their own line. *Open.*
52. **MKP: a back link between adjacent rows is a tight bend.** The `curve` bend is 0.25 of the
    distance, so SYN_SENT → CLOSED (and the turnstile, and unlabelled flow loops) bend sharply beside
    the forward arrow. They cross nothing. *Open.*
53. **MKP: layered routing assumes rows don't wrap.** Rows are centred flex rows with no x positions,
    so lanes shift with box widths and long edges bow. A row wider than the screen wraps and breaks
    the routing (see 30). *Open.*
54. **MKP: a self-link drew nothing** in flow, graph and er, and its label wasn't shown. *Fixed:* it is
    a loop on the node, with room left beside it in the row and its label there (SN 107).
55. **MKP: an arrow's label wasn't expanded.** `expand.ts` substituted inputs and `each` variables in
    `from`, `to` and `via`, but not `label`. So in `--target ir-expanded`, a label inside an unrolled
    `each` still read the variable the unrolling removed, so the expanded IR drew the wrong label. The
    subagent flagged it as unverified. I checked it: a test fails without the fix. *Fixed:* `label`
    is substituted too, with a test in `core/test/arrow.test.ts`.
56. **MKP: keyed animation made the page jump.** Found by Mujtaba: "the ui jumps arond etc on each
    click". A leaving child stayed in the layout for 200ms beside its replacement, so a question
    briefly held two Check buttons and rows grew and shrank. Fading content in and out doesn't suit a
    page that lays itself out from state. *Fixed:* every animation is gone from both renderers, and
    the `motion` tokens from core@1 (SN 102). `play` stays.
57. **MKP: there is no icon widget.** The packs write symbols as text (`text "▶"`, `"‹"`, `"↑"`), so
    a provider can only recognise them by their glyph to draw its own icons. *Worked around:*
    `@mkp/shadcn` maps the eight glyphs the packs use to lucide icons. An `icon` base widget with a
    fixed set of names would say what is meant. *Fixed:* `icon@1` (SN 108), drawn by the provider's
    own icon set (lucide in `@mkp/shadcn`).
58. **Provider: MKP drew its own controls.** Found by Mujtaba: "that package has defined buttons,
    tabs, checkboxes etc, i though mkp was suppoesd to route it there, not makes its own". The first
    provider was a stylesheet copying the ui package's look over MKP's own elements. *Fixed:* a
    provider defines every base widget (SN 103), and the stylesheet goes.
59. **MKP: packs hand-drew controls a design system has.** A switch was a track of boxes, a tick was ☑
    in text, a progress bar a canvas, and a select's arrow a "▾". None could reach a real component.
    *Fixed:* `press kind=switch|check|radio`, `overlay mode=menu` and `meter` (SN 105).
60. **MKP: `card`, `chip` and `badge` are not a host's Card and Chip.** They are derived, so they are
    drawn from `stack`, `flex` and tokens, and match only as closely as the tokens let them.
    Mujtaba agreed to keep them derived, with any visible difference logged here. *Open: reading.*
61. **MKP: `disclosure` is a Button with a text arrow,** not a host's Collapsible, for the same
    reason. *Open: reading.*
62. **MKP: a host's outline colour is still a CSS variable.** `--mkp-stroke-muted` is set in each
    provider's stylesheet, because a token can't give one colour name two values (gap 4). *Open.*
63. **MKP: an RN scope with arrows left a frame pending when it unmounted.** Its children unregister
    after the scope's own cleanup, and each asked for another measure. Jest then failed the run with
    every test passed, because the frame fired after teardown, and only on a clean checkout: a later
    test used to hide it. *Fixed:* a scope that has gone asks for no frame, with a test.
64. **MKP (web renderer): an arrow's label was struck through by its own arrow.** In a `force` network,
    `scales` and `exprs` sat on the line with nothing behind them. React Native already put the
    surface colour behind them. *Fixed:* the web does too, with a test.
65. **MKP (mkp-cs): `trace` draws each line of code as inline code.** `text` reads its string as inline
    Markdown, so a line of code can't be shown literally, and `trace` wraps each line in backticks.
    A host that gives inline code a background (Study Pad does, and it is right in prose) then shows
    a listing of separate chips of different widths. A literal mode on `text`, or a code block with
    one marked line, would fix it. *Fixed:* Mujtaba asked for Study Pad's own trace design, so `trace`
    is that now, and both of those went in: `code line=` is a listing with a marked line, and
    `text literal=true` shows a string as it is. A provider gives the listing to its own component.
66. **MKP: a canvas label can sit on the axis.** `orbit`'s $f(z)$ starts on the real axis, which runs
    through it, because a label has no background and no way to avoid a line. Like 23. *Open*, minor.
67. **MKP: `none` can't be written in an expression.** `fill=none` is fine, but `if(x, warn, none)` is
    `mkp.unknown-name`, and worse, the node is dropped from the definition, so a fixture case whose
    own compile is clean draws nothing there (only the pack build reports it). `trace` uses
    `surface` for "no wash". `quiz.choice` hit the same thing with `ink`. *Open.*
68. **MKP: `trace` can't jump to a line.** Study Pad's listing lets a reader press or drag to a line.
    `code` has no event for it, so the listing is read-only here. *Open.*
69. **MKP: the bar's own status is fixed.** `steps` says "step 3 / 8", where Study Pad's says "Step 3 of 8
    · line 3" with a reset button on the right, and its Play is the primary button. *Fixed:* the steps
    control is ‹ ▶ ›, the frame's status, a track from 7 steps, `3/8` and start over, with Play the
    high-emphasis button (SN 108).
70. **MKP: a header can't uppercase.** Study Pad's `TRACE · PYTHON` is CSS uppercase. MKP has no
    `upper()` or text case, so the language keeps the case it was written in. *Fixed:* `text caps=true`,
    and a frame's kind and a pane's title are captions (SN 108).
71. **MKP (mkp-diagrams): `graph` turned upside down on a cycle.** Its rows counted every link, so a link
    closing a cycle pushed the first node to the bottom. *Fixed:* such links no longer count for rows.
72. **MKP: a lane moved its row off centre.** A lane beside a box took half its width and gap from the
    box's place, so a straight chain with one long edge beside it bent at each row. *Fixed:* a row
    balances its lanes with empty cells (`route.mkp`).
73. **MKP: lanes in different rows don't line up.** Rows are centred on their own, so a long edge's lane
    moves from row to row and the line steps sideways between them (53 says the same of the bow).
    *Open:* it wants one grid for all the rows.
74. **MKP: widgets had no shell.** Mujtaba, of the Views tab: "everything in the view tab for study pad
    is miles ahead of your design, mkp is supposed to replaced that", "the locking beheviour and other
    stuff included", and "in terms of design as well, the study pad one design is better". Each MKP
    widget drew its own outlined box with a bar of loose buttons under it; Study Pad's views share one
    frame (kind and title, full screen, About and Details drawers, a resizable stage, a tinted bar),
    one playback bar, titled panes that scroll on their own, and a view lock over anything that zooms.
    None of it could be said in the base set. *Fixed:* `frame`, `pane`, `zoom` and `icon` base widgets
    (SN 108), which Study Pad's provider draws with WidgetFrame, Pane and ZoomPane. The widgets are
    moved onto them one by one (board #7954).

### Views parity: questions and predict (mkp-learn)

75. **MKP: a frame's status is one line, and the only part of the bar announced.** A verdict with its
    reason needs up to three lines, as Study Pad gives it; `status=` is cut off with an ellipsis.
    *Worked around:* each quiz draws its own wrapping line in `fill bar`, which loses `role=status`.
    *Fixed in the base:* `frame statuslines=1..3` (SN 110); the quizzes keep their own line, with its icon.
76. **MKP: an overlay's anchor is always an outline button.** The header's hint and book buttons are
    outline; Study Pad's are ghost. *Open.*
77. **MKP: an answer row has no letter.** Study Pad's rows show A, B, C in the mark until picked;
    `press kind=radio|check` has no place for one, and a letter in the content gives two marks. *Open.*
78. **MKP: no dashed outline.** Study Pad's drop area and gate box are dashed; `stroke=` is solid only.
    *Worked around:* a solid outline. *Fixed:* `line=dashed|dotted` on stack, flex and grid (SN 110).
79. **MKP: a box can't sit over another.** Study Pad's predict card floats over the blurred chart, and a
    set is as tall as its tallest question. *Worked around:* the card sits beside the content; the set
    takes each question's own height, so stepping can resize it.
80. **MKP: no multi-line field.** *Worked around:* write mode uses a one-line field.
81. **MKP: Enter in a field can't check the answer.** There are no conditional actions, and which event
    fires (correct or wrong) depends on the answer, so only the Check press pair can emit it. *Open.*
82. **MKP: no text functions.** A comma decimal mark can't be read, a word can't be compared ignoring
    case, and a typed expression can't be typeset as it is read back. `slice` and `indexof` on text are
    dropped silently, with only an "undefined name" error where they are used. *Worked around:* the
    help text, cloze `also`, and a "can it be read" line.
83. **MKP: a derived value can shadow a token or an option name, silently.** A derived `bad` made
    `if(x, ok, bad)` a type error. A derived `start` made `text … align=start` fail with "expected one of
    start, center, end, found start", and the text was dropped from the view. *Open.*
84. **MKP (@mkp/shadcn): a press whose only content is an `icon` is a text-sized button.** Only the eight
    text glyphs became icon buttons, so the order list's ↑ ↓ − squeezed the step text. *Fixed* (SN 110).
85. **MKP: no drag to reorder.** *Worked around:* ↑ and ↓ presses.
86. **MKP: a field can't be marked right or wrong.** *Worked around:* the verdict in the bar, and a tick
    or cross beside each blank.
87. **MKP: a play step can't set a nested part's state.** A fixture's `set entries` checks the cloze, but
    the fields show empty. *Open*, minor.
88. **MKP: a fixture's slot can hold Markdown only.** A widget block there shows as code, and a code
    fence breaks the round-trip test. *Worked around:* LaTeX `\rule` bars for the chart, and inline code
    for the requests.
89. **MKP (@mkp/shadcn): a plain press centres its text.** `press kind=plain` is a `<button>`, so its
    content inherited centred text. *Fixed:* `.mkp-plain` keeps its content's alignment (SN 110).

### Views parity: sequences and code (mkp-diagrams, mkp-cs)

90. **MKP arrows: no cross mark for a lost message.** Study Pad ends a lost message in a red ×. Arrow ends
    were only arrow, hollow, one, many or none, and a "×" text either makes its row taller or sits above
    the line. *Fixed:* `head=cross`, drawn in the bad tone (SN 110); sequence and exchange use it.
91. **MKP frame bar: a long status pushes the count and start over out of the bar.** The steps group is
    `flex: 1 1 0` with no `min-width: 0`, so its nowrap status keeps its full width and the track, n/N
    and ↺ are cut off at the frame's edge. *Fixed* (SN 110).
92. **MKP arrows: a frame in full screen leaves its arrows behind.** The arrows' SVG belongs to the scope,
    outside the fixed frame, so a full-screen sequence shows no lines. Every widget with arrows in a
    frame. *Open.*
93. **MKP arrows: measured on resize, not on scroll.** A widget with arrows can't use `height=` with a
    scrolling stage, so sequence fits its content and can't keep the current row in view. *Open.*
94. **MKP canvas labels: `anchor=center` draws as ne.** `anchorOffset` tests `includes('e')` and
    `includes('n')`, and "center" contains both, so every centred canvas label sat up and to the right.
    *Fixed* in both renderers.
95. **MKP code marks: one mark per line.** Both providers draw only a line's first mark, so a line can't
    have a tone and a toned part. *Worked around:* the line's mark goes first, and the part's mark after.
96. **MKP code: a listing's lines can't be pressed.** Study Pad moves the current line on a press or a
    pointer drag; `code` has no events (68 says the same of trace). *Open.*
97. **MKP playground CodeBlock: marks without a current line draw a bordered box with margins.** In
    `apps/playground/src/components/ui/code-block.tsx`. *Open.*
98. **MKP layout: no fixed column width.** *Worked around:* times are padded with no-break spaces in the
    mono font.
99. **MKP grid: twelve columns at most.** *Worked around:* six participants at most; tree levels wider
    than 8 are drawn in groups of 8.
100. **MKP arrows: drawn over the content.** *Worked around:* lifelines are `dim=true`.
101. **MKP expressions: a colour token in a record literal needs a typed `fn`**, and `flatten` refuses
     lists of record-kind lists. *Worked around.*
102. **RN test: closed drawers were checked.** The render test expected an element for every node,
     including a frame's About and Details slots, which are only drawn while open. *Fixed in the test:*
     keys under `.about/` and `.details/` are skipped. (The plots agent found the same.)

### Views parity: plots (mkp-math, mkp-charts)

103. **MKP: a string literal can't hold a lone `$`.** `"$" + name + "$"` pairs the dollars across
     literals into one maths span. *Worked around:* `"$\val{…}$"` templates. *Open.*
104. **MKP: a plot can't fill a fixed-height stage.** A canvas's height comes from its width and aspect,
     so plots are short on phones (same root as 18). *Open.*
105. **MKP: an expression input's variable names are fixed by its type.** plane's parameters are θ, v, g
     in the bar but `a`–`d` in formulas. *Worked around:* positional parameters, documented. *Open.*
106. **MKP: canvas labels have no size and no halo.** Tick maths is about 15 px against 13, and lines
     cross the numbers. *Open.*
107. **MKP: canvas labels aren't kept inside the canvas or clear of each other.** *Worked around:*
     positions clamped in data units. *Open.*
108. **MKP: canvas shapes have no opacity of their own.** *Worked around:* the heat map is 12 stacked
     band layers. *Open.*
109. **MKP: a canvas has no pixel unit.** Rings, offsets and margins are sized for a column about 720 px
     wide. *Open.*
110. **MKP: a widget's own names shadow a label's anchor options.** *Worked around:* renamed (`n` to
     `count`, `s` to `turn`, `w` to `fz`). (83 is the same trap.)
111. **MKP: `at(xs, -1, d)` returns the last item, not `d`.** This broke the heat-map runs. *Worked
     around.* *Open:* document it, or return the default.
112. **MKP: an `each` takes at most 200 items.** *Worked around:* split per row or column.
113. **MKP: `line … arrow` draws an 8 px head at any length.** *Worked around:* line plus path head.
114. **MKP (web renderer): a 3D canvas ignores a changed `view`.** surface's turn slider moves the value
     but not the drawing; this was there before. *Open.*
115. **MKP: a fixture play step can't open an overlay.** *Open*, minor.
116. **MKP: no sliders icon.** *Fixed:* `icon name=sliders` (SN 110).
117. **MKP: a pack-level `fn` can't name a colour token.** *Worked around:* one tone function per widget.
118. **MKP: tick density can't follow the width.** *Open.*

### Views parity: graphs (mkp-diagrams, mkp-cs protocol)

119. **MKP zoom: no fit to the box.** A graph wider than its frame was cut at both sides at rest: a
     left-to-right pipeline at 390px, or any of the three ports in the playground's 650px frame. Study
     Pad fits it, and turns top-down under 560px. *Fixed:* `zoom fit` (SN 111). *Open:* turning
     top-down on a narrow screen; the fitted drawing is small on a phone.
120. **MKP layout: a centred row that overflows loses its start.** A cut pipeline lost Push as well as
     Live. *Fixed* by 119 at rest; *Open* for a centred row outside a zoom.
121. **MKP box: no dashed outline.** Study Pad draws groups, io nodes and label nodes dashed. *Fixed:*
     `line=dashed` (SN 110); groups, io and label nodes use it.
122. **MKP arrow: no quieter tone than muted.** *Worked around:* a quiet line is dashed and `dim`, and
     its label chip stays readable.
123. **MKP steps: no "nothing chosen".** *Worked around:* `steps (n) = -1`. It shows 0/N, doesn't wrap,
     and ↺ goes to the first node, not to none. Pressing the chosen node again clears it.
124. **MKP steps: a track from 7 steps.** Stepping through 7 or more nodes draws a track Study Pad
     doesn't have, and a long status then pushed the count off a narrow bar. *Fixed* for the bar (91);
     the track stays.
125. **MKP press: no click on empty space.** A stack or zoom has no click, and a press around the
     drawing would nest buttons. *Worked around:* pressing the chosen node again lets it go.
126. **MKP arrow: lines inside a zoom must belong to a nested instance.** A widget's own arrows are drawn
     in an overlay outside the zoom's transform and clip, so they would not follow it. *Worked around:*
     each drawing is a part used inside the `zoom`. *Open.*
127. **MKP icon: a computed name must be a choice.** `icon name=(x)` refuses a text value. *Worked
     around:* `glyph@1` switches over the 64 names; an unknown name shows a square. *Open.*
128. **MKP fmt: `icon name=info` reprints as the bare word `info`**, which is also a colour token, so the
     round-trip test failed. *Worked around:* `name=(if(name == "info", info, help))`. *Open.*
129. **MKP arrow: an empty label still draws its background box** over the middle of the line. *Worked
     around:* separate arrows with and without a label. *Open.*
130. **MKP routing: lanes in different rows can't share an x**, so a line back over several layers jogs
     at every row (TCP's expire; 73 is the same). *Open.*
131. **MKP routing: a line back arriving by its box's side crossed the box below it.** *Worked around:*
     left to right, a line back's cells go first in each column, with its label under the lane.
132. **MKP types: a named record type's defaults don't fill record literals.** Adding fields with
     defaults to `tnode` broke `examples/arrow-proof/growing.mkp`. *Worked around:* new type `hnode`;
     `tnode` is unchanged.
133. **RN renderer: drawers aren't mounted while closed**, so the RN fixture test couldn't find `fill
     details` content. *Fixed in the test* (102); protocol still has no details drawer.
134. **MKP packs: protocol needs routing but mkp-cs depends on core only.** *Worked around:* a copied
     `route.mkp` in mkp-cs. *Open.*

### Views parity: linked cards and row links (mkp-diagrams cards, er; mkp-data rowlinks, join)

135. **MKP renderer: lines inside a `zoom` are drawn at the zoom squared.** Measured with the transform,
     then drawn under it again; any re-render after zooming moved them, a pick included. *Fixed:*
     arrows measure in their scope's own units (SN 111).
136. **MKP syntax: a continuation line outside brackets is dropped silently.** `xs = [1, 2]` with an
     indented `+ [3]` checks clean and gives `[1, 2]`. *Worked around:* parentheses. *Open*; it should
     be an error.
137. **MKP names: an input hides the option of the same name.** With an input called `right`,
     `route=right` is refused ("expected one of down, right, found right"). *Worked around:* the part's
     inputs are `lrel`/`rrel`. (83 and 110 are the same trap.)
138. **MKP expressions: a choice option or token can't be a value in a record.** `{head: many}` gives
     "many is not defined here". *Worked around:* functions with a declared return type. (101 is the
     same.)
139. **MKP box: no dashed outline.** *Fixed:* `line=dashed` (SN 110); an external card is dashed.
140. **MKP arrow: no dot end and no optional (o) end.** *Worked around:* plain ends; ER cardinalities go
     in the status, the Markdown and the Mermaid output. *Open.*
141. **MKP arrow: a label sits halfway along its path as plain text.** It can cover another line (one
     label was dropped for that reason) and can't be a pill. *Worked around:* wider gaps where labels
     cross. *Open.*
142. **MKP layout: no minimum width.** Row links squeeze at 390px, where Study Pad's panes scroll
     sideways. *Open.*
143. **MKP arrows: lines don't follow a scrolling pane.** *Worked around:* no frame `height` for row
     links and join. (93 is the same.)
144. **@mkp/shadcn: a plain press centres its text.** *Fixed* (89).
145. **MKP pane: a pane inside a `stack` comes out zero tall.** *Worked around:* the pane sits in its own
     `flex align=stretch`. *Open.*
146. **MKP press: no hover.** *Open*, minor.
147. **MKP zoom: a drawing's own width widened the column it sat in**, so a fitted zoom never shrank and
     its lock sat off to the right. *Fixed:* the fit is `contain: inline-size`.
