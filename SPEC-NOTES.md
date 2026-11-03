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
    - `each` over more than 200 items is a runtime error.
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
