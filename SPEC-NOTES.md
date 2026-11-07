# SPEC-NOTES: where the implementation reads or extends spec v0.2

The spec is a draft. Where it was ambiguous, contradicted itself or didn't work in practice, the
implementation took the simplest reading and logged it here, with the section and the wording we
propose. Nothing below changes the shape of the language without saying so.

Status of each note: **Reading** (an interpretation of existing text), **Extension** (something the
spec doesn't have that the implementation needed), **Deviation** (differs from the text), **Gap**
(not done, or done partly).

## 5. Documents

1. **Code fences that are not widgets.** *Reading.* A fenced block is a widget block only when its
   info string names a widget visible to the build. Otherwise it stays a Markdown code block. A fence
   that looks like a widget block (it has an `#id`, an `@N`, or a `summary:` line) but names no widget
   is an error.
   *Proposed (5):* "A fenced block whose info string names a widget the build can see is a widget
   block; any other fence is code."
2. **The YAML maths guard catches tabs.** *Reading.* `"\theta"` in double quotes becomes a tab, so tab
   is one of the control characters the guard rejects. Newlines are allowed.
3. **Attributes.** *Extension.* `{#id key=value}` applies to a widget block or container. On a
   Markdown block, only `#id`, and `role=` on headings (for profiles, 16), apply; anything else is a
   warning.
4. **`summary:`** is required on widget blocks, not on containers (their Markdown is the content).

## 6. The language

5. **Token-kind types.** *Extension (6.5).* Style inputs need a type, and 6.5 has none for tokens.
   `color`, `font`, `space`, `size`, `radius`, `shadow` and `motion` are types meaning "a token name of
   that kind".
   - The word `none` is a value of every token type and means "not set".
   - `size` also takes `fill` (8: `size=s|m|l|fill`).
   - *Proposed (6.5) row:* `color`, `space`, … — a token name of that kind, or `none`.
6. **A `range` type.** *Extension (6.5).* Canvas `x=-1..1` and drag `x=…` need a type for range
   values. *Proposed row:* `range` — `in x range = -1..1`.
7. **Typed expression inputs.** *Extension (6.5).* `expr(vars)` gives the callee no types, so the
   callee can't be checked on its own. The forms are:
   - `expr(z: complex): complex` types the variables and the result;
   - untyped `expr(x)` means `expr(x: num): num`;
   - the caller's expression is checked with those types.
8. **Defaults for record fields.** *Extension (6.5).* Shapes need optional fields, so
   `{c: point, r: num, fill: color = none}` is allowed in record types and record lists. A record
   field without a default is required.
9. **Slot and record-list inputs are optional**; they default to empty. *Reading.*
10. **Integer sliders.** *Reading (6.6).* A slider is `int` when its `step=` is a whole number and its
    low end is an `int`. Otherwise it is `num`. That is what lets `stepper at=k` (a `ref int`) take
    `k = slider 0..(n-1) step=1`.
11. **Built-ins added to 6.7.** *Extension:*
    - `asin`, `acos`, `atan` and `pow`;
    - `log(x)` is base 10, `log(x, b)` is base b, and `ln` is natural;
    - `first(xs)` and `last(xs)` with one argument give one item;
    - `find(xs, f, default)`;
    - `sum(xs)` on a list, as in the table;
    - `dist(a, b)` for points;
    - `rgb(r, g, b)` and `hsl(h, s, l)` (h in turns) give the core type `rgb = {r, g, b}` that `pixels` returns.
12. **`+` with text and numbers.** *Reading.* `"k = " + k` joins text with a number formatted to four
    significant figures, like `\val{}`.
13. **Points.** *Extension.* `point + point`, `point - point`, `num * point` and `point / num` are
    core. `p.x` and `p.y` read a point.
14. **`parse(text, vars)`** returns a function of the variables: `parse("1/2", [])()` is `0.5`, and an
    unreadable answer gives `nan`. `equivalent(a, b, vars)` compares the two at 16 deterministic
    points in −3..3, within 1e-6 relative. *Reading (6.7).*
15. **A number before `(`** is a product, not a call: `2(x+1)` is `2 (x+1)`. *Reading (6.7, row 1).*
16. **Names shadow choice options.** *Reading (6.5, 6.14).* Choice options are constants in
    expressions, but a name declared in scope wins. This tripped up a quiz with
    `var result choice(none|right|wrong)` next to a derived value `right`.
    *Proposed (6.5):* "An option word is used only when no name in scope has that spelling."
17. **Several actions per event.** *Reading (6.13).* An event line holds several actions, each starting
    with an action name (`@click set a=1 emit moved`). They can also go on indented lines under it.
    `set a=1 b=2` is two assignments, run in order.
18. **No conditional actions.** *Gap (6.13).* An action can't be guarded, so a part that emits
    `correct` or `wrong` shows two presses with complementary `if=`. A guard would read better.
    *Proposed:* `set …`, `emit …` and the rest take `if=(expr)`.
19. **Layout props of children** (`grow`, `basis=`, `span=`) are meta on any element, like `id=` and
    `if=`. *Reading (8).* In the arg rules (6.8), the meta keys (`id`, `if`, `basis`, `span`) and the
    flags `hidden` and `grow` are taken first, unless the widget declares an input with that name.
20. **Prop lines** are stored as props in the IR; the printer writes them as `key=value`.
21. **`fill` and the first slot.** `fill first-slot-name` is an error, since its lines need no `fill`.
22. **Grammar (6.20).** `else`, `case` and `fill` are node heads. Manifest lines may be indented under
    `pack`/`profile`, or follow at column 0. A `"""` long text may end a statement line.
23. **Canonical expression source.** The IR's `expr` is the written expression with whitespace
    normalised and outer parentheses removed. The printer adds parentheses wherever 6.2's bare rule
    needs them.

## 7. Tokens

24. **Font tokens.** A font token is `font name "family" size= weight= line=`. Colours are validated
    as `#rgb[a]` or `#rrggbb[aa]`. Later token sets override earlier ones by name, so a brand pack
    given to the build (18.5's `acme`) restyles everything: that is how the playground shows
    `acme@1`.

## 8. The base set

25. **The base set is written in MKP.** *Reading.* `core@1` is a `.mkp` file of externs
    (`packages/core/src/base.ts`). The Markdown group are base widgets too:
    - `paragraph`, `heading`, `quote` (with `alert=note|tip|important|warning|caution`, which is how
      callouts become `> [!TIP]` in gfm), `code`, `math`, `divider`, `table` and `footnote`;
    - `list`, with `item` records holding a slot.
26. **Canvas shapes.** A `canvas` has `layer` records, and a layer has one record list per shape kind
    (`rects`, `lines`, `circles`, …). Shapes are drawn in the order written, across kinds. *Extension
    (8):*
    - `canvas` takes `z` (3D range), `view` (camera azimuth and elevation) and `dims`;
    - `curve` is `curve f t=a..b n=…` with `f: expr(t): point`;
    - `label` anchors (`n`, `ne`, …);
    - `line arrow`.
27. **`mesh`** is `z = f(x, y)` over the canvas's x and y ranges. Both renderers draw it as shaded
    polygons projected through the camera, in SVG (web) or react-native-svg, so 3D works without a GPU.
    `pixels` is the GPU feature: WebGL on the web, Skia on React Native.
28. **The control bar** is made of base widgets (flex, press, range, text). Control buttons have ids
    `name.play`, `name.prev`, `name.next` and `name.<option>`, which fixtures' `press` steps use.

## 9. Derived packs

29. **The verbatim examples live in packs.** `tabs` (18.4) is in `mkp-ui`, and `tree` (18.2) and
    `graph` (18.3) are in `mkp-diagrams`, byte for byte as the spec writes them. `roots` (18.1),
    `acme` (7) and the 18.5 document are in `examples/spec18`.

## 10. Packs

30. **Folder packs** warn about files that aren't pack files and leave them out. README, LICENSE and
    CHANGELOG are skipped quietly. `.mkpack` zips are strict: any other file type is an error. Packs
    may hold example documents (`.mkp.md`) only as folders.
31. **The central directory is checked before inflating.** Paths, symlinks (unix mode bits) and
    declared sizes are checked first, so a zip bomb or a zip-slip entry never reaches inflation.
32. **The pack name `core`** is reserved for the base set.

## 11. Fixtures

33. **State for `ref` inputs.** *Extension.* A part with a `ref` input can't get state from a fixture's
    props alone, so `{"state": 2}` as a prop gives the case a document state var bound with `{ref}`.
34. **Host inputs.** `hosts` in a case sets them (15.2: "settable in fixtures").
35. **Reserved expectations.** `expect.values` and `expect.visible` are reserved; the conformance
    suite generates and compares them.

## 12. The build and the CLI

36. **Two extra commands.** `mkp check` (packs, fixtures, and "every definition has a valid case")
    and `mkp pack <folder>` (a deterministic `.mkpack`) were added to 12's list.
37. **The lock.** `mkp build` writes `mkp.lock` (pack digests, and each definition's IR digest).
    - A later build resolves names without `@N` to the locked version.
    - A locked definition whose digest changed is an error (`mkp.version-changed`): "a behaviour change
      is @N+1".
38. **The single executable** is a Node SEA build (`pnpm --filter @mkp/cli sea`), about 130 MB
    because it carries Node. `dist/mkp.cjs` is the same CLI as one file for any Node 20+.

## 13. The IR

39. **What "IR-identical" ignores.** *Reading.* It compares IR without `pos` (the source map), file
    paths and digests. With those included, a canonical reprint can never be identical, because
    blank lines move every position.
    *Proposed (13):* "Round trip: … must come out identical, apart from source positions."
40. **Text and maths with holes are expressions.** *Deviation.* Text or maths with `\val{}` holes is
    an expression whose tree is a template (`{t: 'tmpl', v: "…\val{0}…", holes: [...]}`). Static
    text is `{"text"}` (with its inline maths pre-rendered in `maths`), and static maths is
    `{"tex", "svg", "speech"}`. This keeps one evaluator path for every live value.
41. **Internal node kinds.** Records are nodes with `node: "$record"`, `record` and `input`.
    Built-ins are `each`, `switch`, `slot`, `controls` and `arrow`. The expanded IR adds `inst` on a
    use: `{def, inputs, view}`.
42. **What the expander does.** It inlines definitions, substitutes literal inputs, decides input-only
    `if=` and `switch`, and unrolls `each` over input-only lists. That is how a recursive tree
    becomes plain base widgets. Uses of a definition below depth 12, or that depend on reader state,
    stay as uses.

## 14. Markdown output

43. **Plain mode.** Without the `math` toggle, inline maths is written as a code span of its TeX, and
    display maths as a ```` ```tex ```` block. That is lossless and readable to people and LLMs.
    Without `gfm`, tables are written as text lines (`a · b · c`).
44. **Snapshot policy.** The writer runs the runtime in a snapshot mode:
    - a `switch` on reader state becomes a numbered list of every case;
    - a slot chosen by state (tabs) shows every pane under its title;
    - content behind a false `if=` that depends on state, and `hidden` content, go in `<details>`
      with `html`, or after the widget's visible content, labelled, without it;
    - controls are listed with their initial value and range.
45. **`:::details` in projections.** *Extension (6.16).* A `project md` may contain
    `:::details "Title"` … `:::`, which becomes `<details>` with `html` and a titled block without it.
46. **Images.** With `images`, every canvas is written as a standalone SVG file next to the Markdown
    (the CLI writes them). `pixels` embed their CPU-rendered PNG fallback; `mesh` is drawn as a
    wireframe.

## 15. The runtime

47. **The control bar.** The runtime builds a widget's bar after its content. Instances are keyed by
    path, so state survives re-renders and resets when an element returns (6.12).
48. **Limits.**
    - Signals: 30 a second per runtime, payloads at most 16 KB.
    - Host inputs: at most 64 KB.
    - Rendered nodes are counted per document: 5,000 per widget instance.
    - `each` over more than 10,000 items (the list limit) is a runtime error. It was 200 until GAPS 112.
49. **Speech is computed lazily at runtime.** The Speech Rule Engine takes about 26 ms per formula on
    Node and about 134 ms on Hermes, too slow for every frame of a playing slider. Static formulas
    carry their speech from the build.
50. **Speech differs between engines.** *Gap.* For matrices and cases, Hermes gives "open paren 2 lines
    Line 1: …" where Node gives "the 2 by 2 matrix Row 1: …". Pre-rendered speech comes from the
    build, so readers get Node's wording.
51. **The engine on Hermes.** The core runs on Hermes v0.13.0 as an ES5 bundle (SWC, not loose
    mode), as React Native's Babel preset does: Hermes 0.13 has no classes, async functions or block
    scoping. The CLI run adds a prelude for `console`, `TextEncoder` and `TextDecoder`, which React
    Native supplies.
52. **The maths engine.**
    - It is MathJax 3.2.2 (`mathjax-full`) with the lite adaptor and SVG output (`fontCache: none`),
      plus SRE 4.1.5 with English, bundled into one file at install.
    - SRE's system layer is replaced by a shim that imports `@xmldom/xmldom` and `wicked-good-xpath`
      and reads the bundled locales.
    - `\href` links are removed from maths SVG.
    - TeX packages: base, ams, newcommand, boldsymbol, cancel and mathtools.

## 16. Profiles

53. **Roles and rules.** Section roles are assigned with `{role=name}` on a heading. Rule paths are
    `front.<field>`, `blocks.<widget>` (how many widget blocks) and `roles.<role>` (how many sections).
    `count` takes `a..b` or a number. Front-matter fields not declared by the profile are errors.

## 18. Worked examples

54. **18.3 has no edge routing.** The layered graph places nodes by rank and barycentre, with no dummy
    nodes or routing, so an edge that skips a layer is drawn straight and may cross the nodes in
    between (the `src → md` edge of the `pipeline` fixture does). That is the algorithm as written.
    *Proposed (18.3 note):* "Long edges are straight; route them with dummy nodes if crossings matter."
55. **18.4 tabs carry no ids.** The verbatim `tabs` has no ids on its presses, so fixtures can't press a
    tab by id. The tests press it through the renderer instead.

## Found while writing the packs

56. **Computed style props.** *Extension (7).* A style prop takes a token name or an expression that
    gives one (`stroke=(s.tone)`, a choice whose options are token names). Token words are values
    wherever a token is expected. The name is checked against the build's tokens when it renders;
    an unknown one falls back to the pack default (7: never a render error).
57. **A range's ends.** `x[0]` and `x[1]` read the ends of a `range` value.
58. **`var` defaults may read inputs** (`var shown bool = open`), like derived values.
59. **A `ref num` binds `int` state.** Values written back are rounded, so `range` can scrub a
    `steps` or integer slider.
60. **Record lists can't take a computed list.** *Gap (6.8).* A record-list input is filled only by
    record lines (and `each`/`switch` among them), not by an expression such as
    `items=(map(…))`. Writing `each x in list` with a record line inside does the same job.
    *Proposed:* "A record-list input also takes an expression giving a list of records of its type."
61. **`play=` takes a literal duration**, so a speed control needs one hidden clock per speed.
    *Proposed:* `play=(expr)` with a duration-typed expression, or `speed=` on play.
62. **Arrow labels** sit at the middle of the shaft, in a box of fixed width, so nearby labels can
    overlap (the ER example's two arrows into one entity). Placing labels to avoid each other is a
    renderer improvement, not language. *Superseded by 99:* flow and er lay their labels out as
    content, so no renderer heuristic is needed.
63. **`curve` has no breaks.** Non-finite samples are dropped, so the curve joins across a pole
    (`1/x`). *Proposed (8):* a curve breaks its path at non-finite samples and where it leaves the
    canvas's y range.
64. **A tooltip's anchor is a button**, because `overlay` makes its first slot pressable. A tooltip on
    plain text would need an anchor that takes focus without being a button. *Proposed (8):* `overlay`
    `mode=tooltip` anchors on focusable text.
65. **`press` has no `expanded` state** for disclosure-style buttons. *Proposed (8):* `press
    expanded=(bool)`, read out as `aria-expanded`.
66. **No text functions beyond `+`, `format` and `join`.** *Gap (6.7).* There is no `slice`, `split`,
    `replace` or `len` on text, so a trace can't re-indent code, and a projection can't escape Mermaid
    labels. *Proposed (6.7 Text row):* `split(t, sep)`, `replace(t, a, b)`, `slice(t, a, b)`, `len(t)`.
67. **`id=(name)` is a computed id.** *Reading (6.8).* Brackets make an id computed even around a
    single name, so items written in an `each` get the value as their id, not the word.
68. **Expression variables are named by the type.** A truth table over any variables needs
    `expr(p: bool, q: bool, …)` with fixed names. *Proposed:* `expr(*: bool): bool` taking the names
    from a list input.
69. **A bracketed expression is not called.** *Reading (6.7).* `(a+b)(a+b)` is a product, like
    `2(x+1)`. Only a name, field, index or call result is called by a following `(`.
70. **Records before props.** *Reading (6.8).* When a record kind has the same name as a field of the
    record list that holds it (`layer` has a `pixels` list of `pixels` records), the record wins.
    A prop line can't set a record list anyway.
71. **How `pixels` compiles.** *Reading (8.1, 17).*
    - Declared fns, local fns and `expr(…)` inputs are inlined, and shared subexpressions become
      temporaries (`float t3 = …;`), so the shader grows linearly.
    - Values from outside the expression are uniforms: numbers, booleans read back as `(u > 0.5)`,
      and two-number records as `vec2`.
    - Recursion and text are build errors. The term cap is 2,000 and the source cap 64 KB.
72. **The canvas clips its shapes** to its box. Labels and placed elements are HTML and may overhang.
73. **The Hermes run is batched.** It runs in batches of 16 cases per process, because Hermes has a
    1 GB heap.
74. **Nested record lists are always lists.** *Reading (6.8).* A record's nested record list reads as
    an empty list when no records are written.
75. **A fixture may loosen the tolerance.** *Extension (11).* `expect.tolerance` sets a fixture's
    relative tolerance (at most 1e-3). Long iterations of `sqrt` and `atan2` amplify the last-bit
    differences between engines: the 120-step force layout differs by about 1e-9 between V8 and
    Hermes. The difference grows through the layout's 120 steps to about 1e-4 in final positions, so the
    force-graph fixtures say 1e-3, a hundredth of a pixel on a 320 px canvas; everything else keeps 11's 1e-9.

## Found while writing a provider

Notes from building a host's provider on `@mkp/react` (a design system's tokens and stylesheet over
the base set, documents laid out in the host's own page). Each is product-neutral.

76. **Built-in node names are reserved.** *Gap, fixed (6.8, 6.23).* A use is an IR node named after
    its definition, and a document `state` block compiles to the built-in `controls` node; so a widget
    named `controls` (or `each`, `switch`, `case`, `else`, `slot`, `fill`, `arrow`) compiled cleanly and
    then drew nothing. These names are now `mkp.reserved`, like base widget names.
77. **Quoted paragraphs lose their `> ` markers.** *Gap, fixed (5, 14).* Inline text is sliced from
    the source, so a paragraph running over several lines inside a quote (every GitHub alert with a
    body: `> [!NOTE]` then `> text`) kept `> ` at the start of its continuation lines. Continuation
    lines now drop container markers, as Markdown does.
78. **Footnote references resolve anywhere in the document.** *Gap, fixed (5).* A paragraph's inline
    text is parsed on its own, and Markdown only recognises `[^label]` beside its definition, so no
    reference ever became a footnote run. Each reference is now parsed against a stand-in definition.
79. **A host can lay blocks out itself.** *Extension (15).* `MkpProvider` gives the runtime, its clock
    and the token stylesheet with no element of its own, and `useMkpView()` the document's top-level
    nodes (keyed `doc/<body index>`). A host renders each with `Node` in its own `.mkp-root`, into its
    own sections or columns. `MkpDocument` is the provider plus one root that stacks them.
80. **Hooks for a provider's stylesheet.** *Extension (15).* The web renderer gives every node
    `data-mkp="<base widget>"` and every press `data-kind`; a range carries `--mkp-range-fill` (how far
    along the value is, for a painted track); a box's `stroke` reads `--mkp-stroke-<name>` before the
    colour token, so a design system can draw outlines lighter than text in the same colour name.
    Tokens stay the contract; these only let a stylesheet reach what tokens cannot say.
81. **A row of tabs is a tablist.** *Gap, fixed (8, accessibility).* `press kind=tab` was `role=tab`
    with no `tablist` around it; a row (flex) whose children include tabs is now `role=tablist`.
82. **mkp-ui's toggle draws its own track.** *Gap, fixed (9).* The switch's "on" track had no fill and
    showed only because the neutral renderer fills a selected press with `accent`; a provider that
    styles pressed toggles differently got a white knob on white. The track is now `fill=accent`.
83. **Profile rule errors point at the start of the file.** *Gap (16, open).* A failed `rule` reports
    1:1, not the front-matter line of the field it checks. The YAML positions exist; the profile
    checker does not use them yet.
84. **Parts can't be used in documents.** *Reading (6.4).* So a document can't show `tabs`, `slider`,
    `select`, `toggle`, `stepper`, `playback`, `value` or `button` directly; a host that wants to judge
    them wraps them in a widget of its own (with the state their `ref` inputs bind to).
85. **An overlay says which kind it is.** *Extension (15).* The web renderer gives an overlay's
    trigger span `data-mkp="overlay"` and `data-mode` (tooltip, popover, dialog), so a stylesheet can
    draw a tooltip's trigger as a term (dotted underline) and a popover's as a button.
86. **Series colours avoid the alert tones first.** *Reading (9, mkp-charts).* A chart's second
    series was `warn`, which read as a warning beside the first. Series now run accent, info, warn,
    ok in `chart`, `axes` and their legends. `bad` is left to mean an error.
87. **No fixed-height sizing.** *Gap (8, open).* A canvas has only an aspect, so a thin bar's height
    follows its width. mkp-ui's progress bar at 28:1 was a slab at a reading width and a sliver on a
    phone. It is 48:1 now. We propose a canvas `height` in a size token (or min/max heights), so a
    bar can be 6px at any width.
88. **No shrink-to-content box.** *Gap (8, open).* A stack is as wide as its parent, so text under a
    fixed-width canvas spans the block, not the canvas. A chart's x-axis label with `align=center`
    sat centred on the page, not under the plot; it is left-aligned now. We propose `fit` on a
    stack (as wide as its widest child).
89. **Actions sit in a row.** *Reading (9, mkp-learn).* `quiz.numeric`'s Hint and Show the solution
    were direct children of the question's stack, so they drew as full-width rows, unlike every
    other question's buttons. They are in one `flex` now.
90. **A row only stacks when its children have a basis.** *Reading (6, 8).* `grow` is `flex: 1 1 0`,
    so a wrapping row of grown children never wraps, and a grid's `minmax(0, 1fr)` columns clip
    instead. mkp-data's join (two tables side by side) and mkp-cs's trace (code beside its
    variables) clipped on a phone. Both now use `grow basis=m`, so they stack below twice the size
    token and stay side by side on wider screens. A trace's code line is `wrap=false`, so its number
    stays beside its code. The authoring guide should say this. A check could warn about `grow`
    without `basis` in a wrapping row.
91. **No width-dependent conditions.** *Gap (6, open).* A widget can't know its row has wrapped: there
    are no breakpoints or container queries. So when the join's tables stack on a phone, its match
    arrow (left row → right row) runs down through the other left rows. A `wide` condition (true when
    the widget's root is at least a size token wide), re-evaluated on resize, would let a widget pick
    another route or layout.
92. **A label that must not break says so.** *Reading (9, mkp-learn).* annotated-source's "line 3:"
    label shrank in its no-wrap row and broke at its space on a phone. It is `wrap=false` now.
93. **The base stylesheet should not rely on browser defaults.** *Gap (15, open).* Under a common CSS
    reset (Tailwind's preflight): inline maths SVGs became blocks (`svg { display: block }`), lists
    lost their markers (`list-style: none`), and a footnote's `sup` marker floated above its text
    (`position: relative; top: -0.5em`). A host's stylesheet put each back. The base stylesheet
    should set what its layout relies on. It should also sit in a cascade layer (`@layer mkp`):
    it is injected after the host's CSS, so at equal specificity it wins, and a host now has to
    out-specify every rule (`.host.mkp-root …`).
94. **The CLI's lock defaults to the current directory.** *Gap (12, open).* `mkp build` reads and
    writes `./mkp.lock`, so a build run from another folder read a stale lock left there, and left a
    stray one behind. We propose the nearest `mkp.lock` above the document, or beside it when none.
95. **Unpublished definitions still need a version bump.** *Gap (12, open).* Every change to a
    definition fails the next locked build with `mkp.version-changed`, even when nothing outside the
    repo has used that version. A host's build had to delete the lock to start it afresh. We propose
    `mkp build --relock` (a fresh lock, saying so), or a pack-level `unpublished` flag.
96. **Footnotes show their label.** *Gap (5, open).* `[^engine]` draws "engine" as the reference and
    as the note's marker. Markdown renderers number footnotes in order of first reference. The
    label is the author's name for the note, so the web renderer could number them the same way.
97. **Back-edges in flowcharts.** *Extension (6.10, 9).* The retry loop in `flow`'s login example,
    a link to an earlier row, was drawn as one curve straight up through every box between its ends.
    `arrow` could only join two outlines with a line or one bend, and the compute layer can't know
    where flex rows put their boxes, so no expression could steer it. *Decided:* `arrow` takes
    `via=(ids)`, waypoints that are ordinary elements. `flow` gives a back link a lane (an empty,
    row-stretched element laid out with the boxes) in every row it crosses, and the arrow runs up
    those lanes beside the boxes. Rows now come from the longest path along the links that don't
    loop back, where a link to the same or an earlier row is a loop only if its target leads round
    to its source. So a link along a row (Lock → End) now runs down. *Why:* the routing stays in
    MKP's compute layer, `arrow` stays generic, and measured lanes hold at any width in both
    renderers.
98. **Edges that skip layers in `graph`.** *Reading (9).* With longest-path layering, source →
    Markdown spans three layers and was drawn straight through parse, check and IR. *Decided:* one
    lane per crossed layer, ordered with the nodes by barycentre sweeps. Each sweep orders every row
    against the one above, top to bottom, then against the one below, bottom to top, for four rounds.
    This lives in `route.mkp`, which `flow` and `er` share. *Why:* a lane is Sugiyama's dummy node, and
    the flex row reserves its place. Every run of a path then goes to the next row, so it can't cross
    a box; `core/test/arrow.test.ts` checks this on the fixtures.
99. **Edge labels are laid out.** *Reading (9), supersedes 62.* Labels sat at each arrow's middle, so
    two relationships into one entity (er shop's contains / appears in) overlapped, and short links put
    labels on boxes (flow's yes/no). *Decided:* labels are laid out, not drawn. A labelled link puts
    its label beside its lane in a row of its own, between the two layers it leaves, and other links
    crossing that row get a lane there too. *Why:* the layout then guarantees no label overlaps a
    label or a box, without a renderer heuristic, at the cost of some height per labelled gap. Since
    labels are now content, `flow` and `er` gained `project md`, which writes each connection in text.
100. **Back-moves in `protocol` (mkp-cs).** *Reading (9).* TIME_WAIT → CLOSED ran straight up
    through the column of states. *Decided:* a move back more than one layer gets a lane at the side
    of each layer between, with the longest outermost and a spacer opposite to keep the states
    centred, and draws via those lanes. This is protocol's own few lines, not `route.mkp`: mkp-cs
    depends only on core, a pack can share an MKP function only through a dependency or core@1, and
    changing core@1's source changes its digest in every lock and golden.
101. **The expanded IR substitutes an arrow's label.** *Gap, fixed (13).* `expand` substituted
    inputs and `each` variables in `from`, `to` and `via`, but not `label`. So in `ir-expanded`, a
    label inside an unrolled `each` still read the variable the unrolling removed. It is substituted
    like the others now, with a test.
102. **No animation (a deviation from 6.11).** *Deviation, at Mujtaba's request.* A renderer drew
    keyed changes with enter, move and leave animation, and it made the page jump on each click: a
    leaving child stayed in the layout for 200ms beside its replacement, so a row of controls grew
    and shrank. All of it is gone from both renderers: `Kids` is a plain keyed list, the `motion`
    token kind and its two names are gone from core@1 (a pack that sets one is refused), and shapes no
    longer transition. `each key=` stays, because identity still decides whose state survives a
    change. A provider's own components may animate themselves. `play` stays: a reader starts it,
    and it is content moving, not the interface. Reduced motion still makes it move in jumps. Web
    arrows lost the frame loop that followed moves, so they are measured in the scope's layout effect
    and drawn before the first paint (gap 50).
103. **A provider defines every base widget.** *Reading (8, 15), corrected by Mujtaba.* The web renderer
    used to be the only thing that drew the base set, with a stylesheet on top. Spec 8 says the base
    set is what every provider implements. So `MkpDocument` and `MkpProvider` take `components`, a
    function for each of `BASE_WIDGETS`, and `MkpComponents` requires all of them, so leaving one out
    fails the build. Derived widgets are not routed: they are described in terms of the base set,
    and reach a provider's components through it. The renderer keeps what isn't a widget: scopes,
    arrows, the control bar, the error boundary and the clock. Its neutral versions draw the base set
    only when no provider is given (conformance, and any page that wants no design system), and its
    stylesheet splits in two so `NEUTRAL_CSS` loads only then. `canvas` and `math` definitions
    call the shared `Canvas` and `MathSpan`: spec 6.15 asks for one maths engine everywhere, and a
    canvas is a drawing engine, not a design choice.
104. **`@mkp/shadcn`.** *Extension (15).* The definition of the whole base set in terms of shadcn-style
    components, which a provider passes in as a kit, typed with every one required. The host's
    `ui` package and the playground differ in their components, not in how a base widget maps to
    them, so the mapping is written once. Everything is controlled: the runtime owns the state, and
    a component's change comes back as the base widget's own event. A row of `press kind=tab` is
    `Tabs`, and a row of `press kind=option` is a `ToggleGroup`, because shadcn draws those as one
    component where MKP has a row of presses. core and the renderer don't depend on it.
105. **Base set additions.** *Extension (8), needed to route.* `press kind=switch|check|radio`,
    `overlay mode=menu` and `meter`. The packs were hand-drawing all of these (a track of boxes, ☑ in
    text, a canvas bar), so there was nothing for a provider to give its `Switch`, `Checkbox` or
    `Progress` to. `toggle`, `quiz.choice`, `select` and `progress` use them now. `meter` also ends
    the 48:1 canvas that made a bar's height follow its width. `quiz.choice` passes `tone` on a checked
    answer, so a provider can mark the row right or wrong. Adding to core@1 changes its digest in
    every lock. Nothing outside this repo is locked to it but the host's fixture lesson, which is
    relocked.
106. **`trace` is the host's two-pane design.** *Extension (8), and a change to a pack's look.* Mujtaba
    asked for it over the design I had drawn. It is a frame with a header and the bar inside, code on
    the left, and on the right the note in a reserved box and a table of the variables whose rows
    never come or go, so nothing moves as it plays. Panes wrap into a column under two `m` widths.
    What it needed from the base set:
    - `code line=N`: a numbered listing with line N marked. A listing is a thing hosts already have,
      so it is the provider's to draw, and the host's is its `CodeListing`. Drawing one from
      `stack` and `text` was what made the chips in GAPS 65.
    - `text literal=true`: the value as it is, not read as inline Markdown. A variable called `*p` or
      a value of `2*3*4` must not turn into emphasis.
    - `text lines=N`: height kept for N lines, for the note's box.
    - `tint=` on `stack`, `flex` and `grid`: a wash of a colour, for a state. A provider can name its
      own with `--mkp-tint-<name>`, as with `--mkp-stroke-<name>`; otherwise it is the colour at 12%
      over the surface.
    - A `steps` control with `play=` puts Play between ‹ and ›, and the count after them.
    `run` gains `watch`, the variables to point out, and `trace` gains `title`.

107. **Diagram lines.** *Extension (6.10).* Layered diagrams drew slanted lines between lanes, and a
    link from a node to itself drew nothing. Mujtaba, of the host's graphs: "the lines are always
    straight, the node can reference itself, and lines combine when required", then "just reduce
    overlaps unless absolutely necessary". *Decided:* `arrow route=down|right`, level and upright runs
    only, and `arrowPaths` lays out a scope's arrows together, so they can combine: one source, one
    trunk; one target, one arrival; other lines keep to their own tracks. An arrow from an element to
    itself is a loop. A line back up enters a box by the side when its lane stands clear of it, which
    keeps it off the lines coming down. `graph`, `flow`, `er`, `protocol`, `tree` and `optree` use it;
    `force` keeps direct lines, because its nodes sit where the physics puts them, and `join`'s are row
    to row. `route.mkp` leaves room beside a node for its loop and balances a row's lanes, so a lane
    no longer pushes the row's boxes off centre. `graph` drops the links that close a cycle from its
    rows, as `flow` does. The host's NodeGraph (ELK) has the first two and not the third; its
    LinkedCards has all three.

108. **A widget's shell.** *Extension (8).* GAPS 74. *Decided:* four base widgets, so a provider draws
    a widget's shell with its own components:
    - `frame kind title [height] [status] [tone]`, slots `body` (the stage), `actions`, `bar`, `about`
      and `details`. The provider gives it a header (kind as a caption, title, its actions, About and
      Details buttons for drawers, full screen), a stage of one height that the reader may resize
      (`height` a size token; none fits the content), and a bar. A widget whose view is one frame has
      its controls in the frame's bar, not under it, and the frame's `status` goes in the bar after a
      steps control's buttons (else first).
    - `pane title [note]`, slots `body` and `footer`: a titled column whose body scrolls on its own;
      panes side by side are divided by a rule.
    - `zoom [max]`: zoom and pan behind a lock. It starts locked; locked, a try to zoom or pan points
      at the lock instead; unlocked, the wheel zooms, a drag pans, and + / − / reset show.
    - `icon name [tone] [size] [label]`, from a fixed set of 64 names (`core/src/icons.ts`, each with a
      text symbol for a renderer without an icon set).
    With them: `dim` and `blur` on stack, flex and grid (faded back; blurred until revealed), `caps` on
    text, and `emphasis low|normal|high` on press. The steps control is now ‹ ▶ ›, the status, a track
    from 7 steps, `n/N` and start over; back, next and start over are low, Play high. The neutral
    renderers draw all four; `@mkp/shadcn` takes a kit's `Frame`, `Pane` and `Zoom` when it has them
    and otherwise draws MKP's own with the kit's buttons, and its icons are lucide's.

109. **Line looks, code marks, plain presses.** *Extension (6.10, 8).* the host's diagrams draw lines in
    tones, dashed or dotted, with a crow's foot, a bar or a hollow triangle at their ends, faded when
    something else is chosen and drawn strong when they are. Its listings tint added and removed lines
    and mark a part of a line, with a note at its end. And its nodes and cards are pressed as
    themselves, not as buttons. *Decided:* `arrow … tone= line=solid|dashed|dotted head= tail=
    dim= bold=`, with `head` and `tail` one of arrow, hollow, one, many or none (`arrowPaths` draws the
    marks; a provider may colour lines with `--mkp-arrow-<tone>`); `code marks=([{line, tone, note,
    from, to}])`; and `press kind=plain`, whose content is what is pressed.

110. **Lost messages, dashed boxes, a status of more than one line.** *Extension (6.10, 8).* Found by the
    Views-parity widgets (GAPS 75–118). *Decided:* an arrow end may be `cross`: the shaft stops a
    head's length short and a cross sits there, drawn in the `bad` tone (a message that never arrives).
    `stack`, `flex` and `grid` take `line=solid|dashed|dotted` for their border (a drop area, an outside
    system). A frame's `statuslines` (1 to 3) keeps room for that many lines of status, which then wraps.
    The icon set gains `sliders`. A press takes `mark`, an answer row's letter shown in its tick or dot
    until it is chosen, and an overlay `emphasis`, how much its anchor stands out. In `@mkp/shadcn` a press whose one child is an `icon` is an icon
    button, a plain press keeps its content's alignment, and a frame's bar lets its parts shrink, so a
    long status gives up width before the count and start over are pushed out.

111. **A zoom fits what it holds.** *Extension (8).* A diagram wider than its frame was cut at both sides
    at rest, on a phone or in a narrow column; the host's views are seen whole. *Decided:* `zoom fit`
    (default true): at rest, what is wider than the view is shrunk to fit it, never enlarged, leaving
    the lock its own room; the reader zooms in from there. Arrows measure in their scope's own units,
    so a scale above them (a zoom, a fit) no longer throws them off their ends.

112. **A frame's status reads at body size.** *Correction (6.8).* The status was set small, a size under
    the rest of the bar and under the Views it replaces, where it is the line that says what is going
    on. *Decided:* the status line is body text; the bar's counts and values stay small.

113. **A profile's block attributes, and a CLI a host can drive.** *Extension (12, 16).* the host moves
    its lessons to MKP, and a lesson cites a lecture's slides block by block; the host also compiles on
    its server. *Decided:* a profile may declare `attr name type ["about"]` (no default; `id` and `role`
    are taken). A document writes it on any block, `{cite="lecture-2 3 s3-1"}`; the value is kept as
    written in the block's `meta.attrs`, a choice is checked against its options, and a widget's own
    input of the same name takes precedence. Without the profile the attribute is ignored with
    `mkp.attrs`, as before. `mkp build -` reads one document from stdin, named by `--name`; `--target`
    takes a list (`ir,md`, with `--out`); `--diagnostics json` writes each diagnostic to stderr as one
    line of JSON (`severity`, `code`, `message`, `file`, `line`, `col`, `path`).

## The redesign (doc #1129)

MKP ships the language and the base set only; a host brings its library as a pack. These notes
are the language changes that came with it. GAPS numbers are in `GAPS.md`.

114. **No packs ship with MKP.** *Deviation.* The seven packs are gone. MKP's tests, conformance and
     playground use `examples/` and the test-only `conformance/packs/base`.
115. **The base set is 25 externs.** *Deviation (8).* `stack` (vertical) is now `column`, `flex` is
     `row`, `grid` takes `cols` as tracks (`[auto, 1fr, 6ch]`, `Nfr`, `Nch`, `fit`, a size token; a
     number n is n equal shares), and `stack` means layers. Every container takes `width`,
     `minwidth`, `scroll`, `edge`, `weight` and `out click`; a child takes `self=` and `keep=`. The
     canvas draws circles, paths, labels, images, places, handles and, with gfx@1, pixels and meshes;
     rectangles, lines and curves are paths. New tokens: `line` and `c1`–`c6`.
116. **A document's own definitions.** *Extension (5, 6.25).* An `mkp` fence holds definitions; so
     does `name.mkp` beside `name.mkp.md`. They are checked on an overlay of the program, never
     reach another document, need no `@N`, and a widget among them needs a `project md` unless it
     holds content in a slot. A name a pack or core already gives is `mkp.shadow`. They are capped
     at 800 lines (`mkp.doc-size`).
117. **Interfaces.** *Extension (6.24).* `interface name@N` in a pack lists inputs, host inputs,
     signals, outs and `project md`; `implements name@N` in a definition is checked against it
     (`mkp.interface`). A document block carries `meta.implements` and `meta.within` (the
     interfaces of what it holds, at any depth), and a bundle's `interface.implements`.
118. **Type parameters and typed paths.** *Extension (6.26).* `walk of S` takes `in steps list(S)`;
     `path(S, int)` names a field of S holding an int, applied as `step[path]`; `""` is no path. In
     a document S is told from the YAML (every item the same fields and types); in a definition from
     the argument's type. Only data tells a parameter: a path or an expression in S reads it.
119. **Answers.** *Extension (6.27).* `in x type answer` marks an answer. `answers` is false when
     Markdown is built with `--no-answers`; `project md` may read an answer (or a value computed
     from one) only inside `if(answers, …)` (`mkp.answer-leak`).
120. **Static types, nothing silent.** *Deviation (6.5).* Every fn types its parameters and result
     (`mkp.untyped`): there is no `any` and no generic fn. A declared name may not take a colour
     token, an option of its own definition's choices, or a global (`width`, `answers`): other token
     kinds stay free, since a token wins where its kind is expected. A pack sees another's names only
     through `depends`. A `\val` of a value with no written form, an unknown built-in, a continuation
     line outside brackets and a written-out colour are errors. A record literal is typed by where it
     goes and filled from its named type's defaults; a record kind of an input is a type inside its
     definition.
121. **Width.** *Extension (6.6).* `width` is `narrow`, `medium` or `wide`, set by the provider
     (`Runtime.setWidth`); everything that reads it redraws.
122. **Events and controls.** *Extension (6.11, 6.12).* `if=(…)` on an event line guards that line,
     and several lines for one event run in order. `clock` counts seconds while it runs. `steps n
     none=true` starts at no step (-1); `track=true` shows a track; `play=500ms/step` is a pace per
     step. `@enter`/`@leave` on press, `@click` on a container's background, `@pick` on code.
123. **Text and lists.** *Extension (6.7).* `lower upper trim replace split contains startswith
     endswith number`, and `slice`, `indexof`, `len` on text; `at` never wraps a negative index;
     `last(xs)` is the last item; a `"` always ends a string, in maths too; `\$` is a dollar sign.
124. **Positions.** *Extension (6.19).* Errors in a block's YAML point at the key or list item, and
     profile rules at the front-matter field. `mkp check --format json` prints them a line each.
125. **Profiles.** *Extension (16).* `rule depth headings n` and `rule first body heading` check the
     body's shape.
126. **The CLI.** *Extension (12).* `mkp check <docs>`, `mkp show --source --as`, `--no-answers`,
     `--relock`, a lock beside the document (only when packs are used; core's own definitions are
     versioned with MKP), and `unpublished` in a manifest. Fixture play steps `{"open": id}` and
     `{"set": {"part/name": v}}`; a slot may hold a document fragment; a pack's fixtures see its
     private parts.
127. **Conformance.** `pnpm conformance` compiles every case from source and compares the bundle
     before replaying it; `--generate <filter>` rewrites only matching cases.
128. **Typing as it reads.** *Clarification (6.5).* A list joined to a list of ints takes the other's
     element type (`[0] + nums` is nums); a bare word in one `if` branch takes the other branch's
     type; the one function of a name and arity types its arguments by its parameters; where a choice
     is expected its option word wins over any other name.
129. **Indented lines.** *Clarification (5).* Only an element, a state line and a command take
     indented lines; under any other (a value, a projection, an input) one is `mkp.continuation`.
130. **Width is the host's.** *Clarification (6.6).* `width` is data, not state: a snapshot (the
     Markdown) draws the branch for its width only.
131. **Small additions.** `iconname` has `none`, which draws nothing; `grid cols=` takes a list of
     track words worked out by an expression; a YAML record fills a default written as an expression
     (a point); a path input is checked in the types of the definition it belongs to.
132. **A wrong or missing value says what it may be.** *Clarification (6.19).* An error about a
     value names the input and what it takes: a token kind's names (`pad takes a space token: none,
     xs, s, m, l, xl; found 2`), a choice's options with the nearest one (`align takes one of start,
     center, end, stretch, baseline; found centre (did you mean "center"?)`), a number's range, and a
     required input left out (`image needs alt: text`).
133. **A zoom's height.** *Extension (zoom@1).* A zoom is as tall as what it holds, never shorter than
     `minheight` (none, the default: room for its own tools) and never taller than `maxheight` (`l`
     by default; none: unbounded). What is taller is clipped, to pan once unlocked.
134. **A zoom shows its lock only when it is needed.** *Extension (zoom@1).* A zoom whose content fits
     whole (not shrunk, not clipped) has nothing to zoom or pan, so it shows no lock, keeps no strip
     free for one, and takes no gesture. The lock shows when what it holds was shrunk to fit its
     width, runs past its sides (`fit=false`), is taller than `maxheight` and clipped, or is a drawing
     or a picture (a canvas or an image, always worth a closer look); once unlocked or moved it stays.
135. **An error message says what is wrong, what was found, and the fix.** *Extension (6.19).* Every
     diagnostic names the thing it is about (the input, prop, block or file), quotes what was
     written (`found …`), says what is allowed, and ends with an instruction and an example in the
     author's own terms (`Write align=center`, `Quote the value: title: "Hello: world"`). It points
     at the line to change. Library text (YAML, zip) is said in plain words. Codes and severities
     are unchanged. The style is `docs/error-style.md`.
136. **A slot is filled only by a container.** *Departure (6.16).* A widget's content (a `slot`
     input, or the content of a record with a slot) is written between `:::name` … `:::` lines, with
     `:::fill other` and `:::record "…"` inside, and never as a YAML value: `slot: |` and `body: "…"`
     are refused with `mkp.slot-in-yaml`, whose fix names the container. The YAML block holds a
     widget's data and the containers its content, so content nests with plain ```` ``` ```` fences
     and still reads as Markdown on a renderer without MKP. A fixture's JSON may still give a slot as
     text; `caseDocument` writes such a case as a container (its other inputs on the `:::` line), so
     `mkp show` prints the form a document uses. This replaces GAPS 88's fragment-in-YAML.
137. **A document as a standalone page.** *Extension (12).* `mkp build --target html` writes
     `name.html`: one offline page holding the bundle, `@mkp/page`'s script (`@mkp/react`'s neutral
     renderer, the runtime and the maths engine) and the pictures beside the document as `data:`
     URLs. It shows only the document, follows the system's theme (`#theme=` overrides it), and
     carries the document's Markdown, drawn as HTML, for readers with scripts off.
     `--target html-md` writes `name.md.html`: that Markdown alone, with no script. The Markdown is
     drawn by `markdownToHtml` (moved to `@mkp/page` from the playground, which uses it with
     DOMPurify); without a sanitiser, raw HTML in it shows as text.
138. **Releases.** *Extension (15).* `VERSION` at the root holds MKP's version (whole numbers and
     dots, no `v`); every merge request into `main` raises it and adds `notes/<version>.md` (front
     matter `version`, `date`, `summary` of at most 140 characters; then `## New`, `## Changed`,
     `## Fixed`), which `scripts/check-notes.mjs` checks in CI. Each push to `main` whose `VERSION`
     has no release yet publishes `v<version>`: `mkp-web-<version>.zip` (`mkp.js`, `mkp.d.ts`,
     `mkp-runtime.js`, `mkp-runtime.d.ts`, `mkp-shared.js`, `maths-engine.js`, `mkp-react.js`,
     `mkp-react.d.ts`, `mkp-dom.js`, `mkp-dom.d.ts`, `README.txt`, in one folder),
     `mkp-cli.mjs` and `SHA256SUMS`, built by `scripts/dist.mjs`; its notes are the note, then how to
     use each asset (`scripts/release-body.mjs`). The web files of the last 50 releases are also on
     the Pages site at `/v/<version>/`, the newest at `/latest/`. Every file says its version
     (a `/*! mkp <version> <commit> */` banner, `VERSION` from `mkp.js`, `mkp --version`). The npm
     packages are gone; the workspace packages stay private.
139. **Fences: Markdown first.** *Departure (5).* A fence whose label's first word means something
     to Markdown is Markdown's: a code language (`yaml`, `sh`, `ts`, `markdown`…, any case), plain
     text (`text`, `txt`, `plaintext`) or display maths (`math`, `latex`). Its body is code, never a
     widget's inputs, so a guide can show YAML or MKP in a fence. Only a label Markdown has no
     meaning for names a widget block; the base widget `text` is therefore written as a container
     or a widget of its own. In code, `$` is not maths; an HTML comment draws nothing.
140. **Pointing inside a widget.** *Extension (8, 6.12).* A canvas `circle` or `path` takes `@enter`,
     `@leave` and `@click`, and the four containers take `@enter` and `@leave`; nothing else that
     is drawn as data does. The events carry no payload (no position, no pointer buttons): the shape
     is known by the scope its lines run in. Containers report the pointer only, since they take no
     focus. A shape with `@click` must have a `label` (a new optional field of both records, empty
     by default), is focusable, pressed with Enter or Space, reports focus and blur as enter and
     leave as a press does, and makes its canvas a `group` rather than an `img`.
141. **The runtime half on its own.** *Extension (15).* `packages/core/src/renderer.ts` is what
     drawing a compiled bundle needs; the core's index re-exports it. The release builds the two in
     one esbuild pass with code splitting (`mkp.js`, `mkp-runtime.js`, and `mkp-shared.js` between
     them), and the renderers import `mkp-runtime.js`. `mkp-runtime.d.ts` re-exports `mkp.d.ts`'s
     declarations, since a class with private fields declared twice is two types.
142. **A first paint, taken over.** *Extension (12).* `mkp build --target fragment` writes
     `firstPaint(bundle)` (`@mkp/page`): the neutral renderer's HTML for the bundle, drawn with the
     web's capabilities and the build's maths engine. `mount(…, { hydrate: true })` hydrates it
     with React; a mismatch is redrawn and warned about. The runtime's width starts as it does in
     the browser, so a width-dependent branch may change once the page is measured.
143. **Arrow ends and runs.** *Reading (6.10), changed.* An arrow's ends touch the outlines they
     join (the core's `arrowPaths` and `arrowPath` default to a gap of 0). Routed tracks in a gap
     keep `RUN_IN` (the head and 6 px) clear of the side heads arrive at and `RUN_OUT` (6 px) of the
     side tails leave; a gap too narrow for both puts the track `RUN_IN` from the heads' side, or on
     the tails' edge. `corner=m|s|none` is the turns' radius: 12, 6 or 0 px.
144. **`theme`.** *Extension (6.3).* A value every definition reads, as `width`: `light` or
     `dark`, set by the renderer (`Runtime.setTheme`, `RuntimeOptions.theme`); the web's `auto`
     follows `prefers-color-scheme`, React Native's `useColorScheme`. A snapshot (Markdown) is
     `light`. The name is reserved, like `width` (`mkp.shadow`).
145. **Layout props.** *Extension (8).* Containers take `padx` and `pady` (each in `pad`'s place on
     its sides); a canvas layer takes `clip`, two corners in data units; `zoom` takes `minscale`
     (0.6; 0 for none), the least it shrinks to fit, past which the middle shows and the zoom clips.
     In a grid or stack, `self=` sets both axes (CSS `align-self` and `justify-self`).
146. **Checks relaxed.** *Reading (11).* `each`, `switch` and `case` are not levels of nesting;
     `slot name if=(…)` is allowed.
147. **A frame's stage is an arrow host.** *Reading (6.10).* Always, not only when full screen or of
     a fixed height, so lines `layer=behind` between what it holds draw over its surface.
148. **Version stamps.** *Extension (13, 15).* A bundle and a lock carry `mkp` (the release, from
     `RELEASE` in core, held to `VERSION` by a test) beside `ir`; a document carries `mkp:` and `ir:`
     in its front matter; a `.mkp` file carries `# mkp <release> ir <n>` as its first line. That
     line is not a comment of what follows, and a pack's digest hashes its `.mkp` files without it.
     Unstamped means 0.2.1. `mkp fmt` writes the stamp.
149. **Migrations.** *Extension (15).* `packages/core/src/migrate`: one step per release
     (`from`, `to`, `renames`, `removes`, behaviour `changes` each keepable with a pin or not, and
     an IR function), chained by release; the last step ends at `RELEASE` (a test). `mkp migrate`
     compiles a source with the core of its stamped release (the release's `mkp.js`: `--core`,
     `MKP_CACHE`, or downloaded and checked against `SHA256SUMS`), runs the steps on its IR (and on
     the printer's items for its own definitions: `documentItems()`), prints it with this
     release's printer, stamps it, and compiles it again before writing. `migrateBundle` does the
     IR part for stored bundles; `mount({ migrate })` uses it. Every example is migrated from
     0.2.1 in the tests, by both routes (IR, and source then compile), which must agree.
150. **A pack's own versions.** *Extension (5.4, 6.17).* `deprecated "…"` on a definition
     (`mkp.deprecated` at every use, the definition's own uses aside) and a top-level
     `migrate a@N -> a@M` block in a pack (`rename`, `drop … "why"`, `keep … = value "why"`),
     checked against both definitions, proven on the old version's fixtures by `mkp check`, and
     applied by `mkp migrate` to documents. A pack's migrate block is MKP, not code: no pack's
     code ever runs.

151. **A pack's moves across widgets, into record lists.** *Extension (150).* `migrate a@N -> b@M`
     may name another widget, in the same pack or (`pack:b@M`) in one the pack depends on. `rename`
     and `drop` take `input.field` for a field of each item of a record list (the new side names
     the list the old one became), and `map path: x -> y, …` changes a choice's or a text's literal
     values. Checked like inputs: every old field goes somewhere, every field the new record needs is
     given or defaulted (filled in stored bundles), and every value of an old choice lands in the
     new one. A breaking change to a pack's widget is a new version with a migrate block.

152. **A host's icons.** *Renderer (8, 6.6).* Each renderer takes the host's icons, for one name or
     all: `@mkp/react` and `@mkp/react-native` any component (given name, size, tone, colour and
     label; `className` on the web, `px` on React Native), `mount()` and `firstPaint()` an SVG
     string or a function that draws into the box. The core stays target-neutral, and documents
     still name icons only from the fixed set. The box keeps `data-name`, `data-size`, its colour
     and its label (now with `data-tone` and `data-host`); MKP's text symbol is left out. The
     host's markup is its own and goes in as given.
