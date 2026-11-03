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

Base widgets: `stack` (column), `flex` (row, wraps), `grid cols=n`, `text`, `image`, `press`, `range`,
`field`, `overlay`, `canvas` (with `layer`s of `rect line circle path curve label image place handle`),
and the Markdown ones (`paragraph heading list quote code math divider table`).

Style props take **token names only**: colours `surface ink muted accent info ok warn bad`, spaces
`xs s m l xl` (pad, gap), sizes `s m l fill`, radius `card`, shadow `raised`, fonts `body heading
mono`. No pixel values anywhere: sizes come from tokens and canvas ranges.

### Relations: arrow

`arrow from=a to=b ["label"] [curve]` joins two elements by their outlines; ids can be computed:
`arrow from=(node.id) to=(k.id)`. Arrows find ids in their own instance and in instances nested in
it, which is how a recursive tree joins parent to child.

### Repetition and conditions

- `each x in list key=x.id` — always give `key=` for lists, so items keep identity and glide.
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
