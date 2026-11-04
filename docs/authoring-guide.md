# Writing MKP: a guide for agents

MKP (Markdown Markup) is Markdown plus widgets. You write **documents** (`name.mkp.md`) that use
widgets, and **definitions** (`name.mkp`) that make widgets out of a small base set. You never write
HTML, JavaScript or CSS. This guide is the working subset you need, with the mistakes the compiler
will catch you making. The full rules are the spec; `mkp index` and `mkp show` tell you what exists.

## The loop

```sh
mkp index --pack packs/mkp-ui --pack packs/mkp-math …     # one line per widget: keep this in context
mkp show orbit --pack …                                   # full signature + a working example
mkp check --pack ./my-pack --pack …                       # compile everything; every fixture case
mkp build doc.mkp.md --pack … --target md --md gfm,math   # the Markdown a reader without widgets gets
```

Errors look like `roots.mkp:14:9 error mkp.unknown-prop: canvas has no prop "colour" (did you mean
"color"?)` followed by the element path. Fix what the message says; it names the rule.

## Documents

````markdown
---
title: Roots of unity
---
# Roots of unity

:::callout tip
Every root lies on the unit circle.
:::

```roots #fifth
n: 5
summary: The five fifth roots of unity.
```
````

- A widget block is a fenced block whose info string is the widget's name (optionally `name@N` and
  `#id`), with **YAML** inputs and a required `summary:` (one sentence: what the reader sees).
- Text inputs are Markdown strings with `$…$` maths. **Write LaTeX in single quotes** (`'\theta'`);
  in double quotes `\t` becomes a tab and the build rejects it.
- Expressions (inputs typed `expr(z)`) are strings: `f: z^3 - 1`.
- Points are `[x, y]`; records are mappings; record lists are lists of mappings; a record's or
  widget's slot is a Markdown string.
- Containers put Markdown into a widget's first slot: `:::callout warning` … `:::`. Inside,
  `:::fill name` fills another slot, and record kinds nest: `::::tabs` holding `:::tab "Title"` blocks
  (the outer one has more colons).
- Shared state: a ```` ```state ```` block (`t = slider 0..1 step=.01 "turn"`) and `t: {ref: t}` in
  the widget blocks that read it.

## Definitions

```text
roots@1 "The n-th roots of unity on the unit circle."
  in n int 2..12 = 5 "how many roots"
  in labels bool = true
  k = slider 0..(n-1) step=1 play=8s loop=repeat "which root"
  w = exp(2 pi i k/n)
  canvas x=-1.6..1.6 y=-1.6..1.6 size=m label="the roots"
    layer
      circle (0, 0) 1 stroke=muted
      each j in 0..(n-1)
        circle (exp(2 pi i j/n)) 0.04 fill=ink
        label (1.18 exp(2 pi i j/n)) if=labels $\omega^{\val{j}}$
  text "Multiplying by $\omega^{\val{k}}$ turns the plane by $\val{k}/\val{n}$ of a turn."
```

- One statement per line, children indented **two spaces**. Long expressions may break inside open
  brackets.
- `name@N "about"` is a widget (documents use it); `part name@N` is only for other definitions;
  `extern` is implemented by providers.
- Members: `in` (inputs), `name = control …` (reader state: `slider a..b`, `toggle`, `choice(a|b)`,
  `steps n`, `drag x=a..b y=c..d`), `var` (internal state), `name = expression` (derived, in order:
  a value sees only what is declared above it), `fn`, `out`/`emit` (events to the caller), `signal`/
  `send` (to the host), `host` (host data), `command` (host calls), `project md|mermaid = expr`.
- Strings are always quoted. Maths is `$…$`. `\val{expr}` shows a live value in text or maths.
- Every widget with state gets a **bar** of its controls automatically; `controls a b` places some
  elsewhere.

### Arguments: how a line fills props

`circle (p w) 0.05 if=spin fill=accent` — the rules, in order:

1. `key=value` sets that prop. Meta: `id=name`, `id=(expr)`, `if=(expr)`, `hidden`, `grow`,
   `basis=size`, `span=n`.
2. A bare word naming a **boolean** prop sets it (`curve`, `wrap`, `dash`).
3. A bare word that is an **option** of exactly one choice prop sets it (`callout tip`).
4. A bare word naming a **token** fills the style prop of that kind (`text "x" muted`).
5. Anything else fills the **positional fields** in order (`fields` of the definition, or a
   record's field order).

**Spaces end an argument.** `circle p w 0.05` is three arguments; write `circle (p w) 0.05`.

### Children: prop lines, records, slots

Under a widget, a line is read as:

1. a **prop line** if its head is an input: `question "What is $\omega^n$?"`;
2. a **record** if its head is one of the widget's record kinds: `tab "Roots"`, `wrong -1 "why"`,
   `layer`, `circle …`; a record's indented lines are its slot;
3. otherwise an **element** in the widget's first slot. `fill name` fills another slot.

### Expressions

Precedence, tightest first: calls and `a.b`, `d[k]`; `^` (right-assoc, `x^-1` works); unary `-`;
**juxtaposition** (`2 pi i k`, binds tighter than `*` `/`: `1/2x` is `1/(2x)`); `* /`; `+ -`;
comparisons; `not`; `and`; `or`; lambdas `x => …`. There is no `|x|`: use `abs(x)`.

Built-ins: maths (`exp ln log sqrt sin cos tan atan2 abs floor ceil round sign mod fact min max`),
`sum(a, b, k => …)`, `if(c, a, b)` (lazy), lists (`len map filter sort fold group index find indexof
range zip flatten first last slice at sum min max mean`), dicts (`put get keys has`), `format(x, d)`,
`join(xs, sep)`, `iterate(init, n, step)` and `scan(…)`, `rand(seed, k)`, `parse(text, vars)` and
`equivalent(a, b, vars)` for answer checking.

- `xs[i]` and `d[k]` out of range are **runtime errors**; use `at(xs, i, default)` and
  `get(d, k, default)`.
- `1/0` is `inf`, `sqrt(-1)` is `nan`; `\val{}` shows `∞` and `—`.
- Every evaluation has a budget (1,000,000 operations; `budget 20000000` at most). A force layout of
  n nodes costs about 5·n² per step.

### Types with operators (mkp-math)

`complex` is a pack type: `1 + 0.5i`, `exp(2 pi i k/n)`, `p w + 0.15` all work, because `+ - * / ^`
are declared for it and a number is promoted (`op from`). Where a point is expected (canvas shapes),
a complex value converts (`op point`). Give your own types the same treatment.

### Events and actions

```text
press
  text "Check"
  @click set tries=(tries + 1) result=pass send answered correct=true value=got emit correct
```

Actions: `set a=expr`, `play x`, `pause x`, `reset [x…]`, `reveal id`, `hide id`, `open id`,
`close id`, `emit name f=expr`, `send name f=expr`. There are no conditional actions: show two
presses with complementary `if=` when the outcome depends on state.

### Layout and style

Base widgets: `stack` (column), `flex` (row, wraps), `grid cols=n`, `text`, `image`, `press`
(`kind=button|tab|option|toggle|switch|check|radio`), `range`, `meter`, `field`, `overlay`
(`mode=popover|tooltip|dialog|menu`), `canvas` (with `layer`s of `rect line circle path curve label image place handle`),
and the Markdown ones (`paragraph heading list quote code math divider table`).

Style props take **token names only**: colours `surface ink muted accent info ok warn bad`, spaces
`xs s m l xl` (pad, gap), sizes `s m l fill`, radius `card`, shadow `raised`, fonts `body heading
mono`. No pixel values anywhere: sizes come from tokens and canvas ranges.

### A widget's shell: frame, pane, zoom, icon

A widget draws in a `frame`: what kind of thing it is and its title on top, its stage, and its
controls in the frame's bar, which the runtime puts there for you. `status=` is one line in the bar
saying what is happening now. `fill actions` puts the widget's own switches right of the title, and
`fill about` and `fill details` are drawers (assumptions; everything at once).

```text
frame kind="Trace" title=title status=(now.note)
  flex align=stretch
    pane title="Code" grow basis=m
      code src line=(now.line)
    pane title="Variables" grow basis=m
      …
      fill footer
        text "output"
```

`pane` is a titled column whose body scrolls on its own; `zoom` puts what it holds behind a view
lock; `icon name=…` is a symbol from the provider's own set. `dim` and `blur` fade a box back or blur
it until it is revealed, `caps` makes a caption, and `emphasis` on a press says how much it stands out.

### Relations: arrow

`arrow from=a to=b ["label"] [curve] [via=(ids)] [route=down|right]` joins two elements by their
outlines; ids can be computed: `arrow from=(node.id) to=(k.id)`. Arrows find ids in their own
instance and in instances nested in it, which is how a recursive tree joins parent to child. An
arrow from an element to itself is a loop on its side.

`route=down` (rows) or `route=right` (columns) draws only level and upright runs, the way a
diagram's lines are usually drawn. Arrows that leave one element leave on one trunk and arrows that
reach one arrive as one line; other arrows keep off each other's runs.

`via=(ids)` routes an arrow through other elements, in order, so it goes round what is between its
ends instead of straight through it. The path runs along each via element's longer side (top to
bottom through a tall one, side to side through a wide one) and through the centre of an empty
one, with rounded corners. The usual via element is a **lane**: an empty `stack id=…` placed in
the layout like one more box, which an `align=stretch` row stretches to the row's height, so the
arrow passes the row between its boxes (each box sits in a `flex align=center` there, so it keeps
its own height). A layered diagram gives an edge a lane in every row it crosses
(`mkp-diagrams/route.mkp` does this, labels included):

```text
flex gap=l justify=center align=stretch
  each c in row key=c.id
    flex align=center wrap=false if=(c.kind == "node")
      stack id=(c.id) pad=s stroke=ink radius=card
        text c.label
    stack id=(c.id) if=(c.kind == "lane")
arrow from=(e.from) to=(e.to) via=(e.lanes)
```

Put a label that must not overlap anything in the layout too (beside a lane in a row of its own)
rather than on the arrow: an arrow's own label sits halfway along the path, wherever that is.

### Repetition and conditions

- `each x in list key=x.id` — always give `key=` for lists, so items keep their identity and state.
- `if=(expr)` shows an element while true (it fades; its state resets when it returns).
- `switch on=expr` / `case v` / `else`.
- `hidden` + `reveal id` keeps state while hidden.

## Fixtures (`name.fixture.json`)

```json
{ "widget": "roots@1", "cases": {
  "fifth": { "props": {"n": 5}, "summary": "The five fifth roots.", "play": [{"press": "k.play"}, {"wait": 8000}] },
  "too-many": { "props": {"n": 20}, "expect": {"errors": ["mkp.input-range"]} } } }
```

Every definition needs at least one valid case. `props` are exactly a document block's YAML;
`{"state": v}` gives a part's `ref` input state of its own. Play steps: `press` (an element id, or a
control's button: `k.play`, `tour.next`), `set`, `command`, `wait`.

## Markdown output

Every widget writes Markdown: its summary, then its content as text (state at its initial value,
steps as numbered lists, hidden content in `<details>`). When a widget says more as a table or a
diagram, give it `project md = …` (Markdown text; `:::details "Answer"` … `:::` becomes `<details>`)
or `project mermaid = …`.

## Checklist before you hand in

- [ ] `mkp check` is clean (no errors; warnings read and fixed or justified).
- [ ] Every definition has a valid fixture case with a real summary.
- [ ] Presses that hold only symbols have `label="…"`; canvases have `label="…"`.
- [ ] No colours, sizes or fonts other than token names; nothing product-specific.
- [ ] The Markdown output (`--target md`) reads well without the widget.
