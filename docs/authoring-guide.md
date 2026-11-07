# Writing MKP: a guide for agents

MKP (Markdown Markup) is Markdown plus widgets. A document (`name.mkp.md`) is Markdown, with
widget blocks where the reader should do or see more than text. MKP itself ships only the
**base set**: the Markdown blocks, four containers, a few controls, the host's shells and a
canvas. Everything else is **composed** from them, the way JSX composes components: in the
document itself (an ```` ```mkp ```` fence), in a file beside it, or in a pack a host loads.
You never write HTML, JavaScript or CSS.

This guide is the working subset, with the mistakes the compiler catches. The examples in
`examples/` are the reference: read them in order, and copy from them.

## The loop

`mkp` below is the CLI: `node mkp-cli.mjs` from a release (one file), or `mkp` where a host installed it.

```sh
mkp check lesson.mkp.md --pack … --format json   # every error: code, file, line, column, a fix
mkp build lesson.mkp.md --pack … --target md     # the Markdown a reader without MKP gets
mkp build lesson.mkp.md --pack … --target html --out shots   # one page that draws it: open it, or screenshot it
mkp index --pack …                               # the widgets a host's packs give, one a line
mkp show walk --pack …                           # one widget's inputs and an example
mkp show walk --pack … --source --as my-walk     # its source, renamed, to copy and edit
```

Repeat `mkp check` until it is clean. Errors name their rule and say how to fix it:

```txt
lesson.mkp.md:17:5 error mkp.input-type: xs[1] is a number; found "four"
```

## Decide in this order

1. **Plain Markdown**, when the reader only reads.
2. **A widget the host gives** (`mkp index`), filled in with YAML.
3. **A copy of one** (`mkp show <w> --source --as <new>`), edited, when it shows nearly everything.
4. **Your own**, composed from the base set, when nothing is close.

## A document

Markdown first. Headings, lists, task lists, tables, quotes, alerts (`> [!TIP]`), code, maths
(`$…$`, `$$…$$`), footnotes and images are the base set's own blocks and come out as themselves.
A widget block is a fence named after the widget, with YAML inputs and a `summary:` (one sentence:
what the reader sees).

- **Quote text in YAML** when it could read as something else: `on: no` is the text "no" in
  YAML 1.2, not false. LaTeX goes in single quotes (`'\theta'`): in double quotes `\t` is a tab.
- **Shared state**: a ```` ```state ```` block (`t = slider 0..1 "turn"`) and `t: {ref: t}` in each
  block that reads it (example 07).
- **A container** fills a widget's slots: what goes inside a widget (Markdown, widget blocks, other
  containers) is written between `:::name` and `:::`, never in YAML. Its other inputs go on the `:::`
  line (`:::card title="Note" tone=info`). The content goes to its first slot, `:::fill name` … `:::` fills
  another, and a list of records with content is one `:::record "field"` … `:::` each. A slot given in
  YAML is refused (`mkp.slot-in-yaml`). The YAML block holds a widget's data, the containers its
  content:

  ````markdown
  :::tabs
  :::tab "Idea"
  Split, sort each half, merge.
  :::
  :::tab "Try it"
  ```question
  prompt: How many passes for 8 items?
  kind: number
  value: 3
  summary: Passes for eight items.
  ```
  :::
  :::
  ````

## Your own widget

<!-- example 04-hello -->
````markdown
# Hello

```mkp
greeting "A line of welcome with a name in it."
  in name text = "world" "who to greet"
  text "Hello, **\val{name}**!"
  project md = "Hello, **" + name + "**!"
```

```greeting
name: reader
summary: A greeting for the reader.
```
````

- A fence with `mkp` holds definitions; it draws nothing. They belong to the document: any block
  may use them, before or after the fence. No `@N`: the document is the version.
- **Every widget you define has a `project md`**: the Markdown a reader without MKP reads instead
  (a widget that holds content in a slot writes that content, and needs none).
- A name a pack or core already gives is refused (`mkp.shadow`): copy one with `--as`.
- Moved out of the document, the same definitions go in `name.mkp` beside it (example 27).

<!-- example 05-counter -->
````markdown
# A counter

```mkp
counter "A number the reader steps up or down."
  in start int = 0 "where it begins"
  var n int = start
  row gap=m align=center
    press label="one less"
      icon name=minus
      @click set n=(n - 1)
    text "\val{n}" font=mono size=large weight=bold
    press label="one more"
      icon name=plus
      @click set n=(n + 1)
  project md = "Count: " + format(n, 0)
```

```counter
start: 3
summary: A counter that starts at 3.
```
````

## Definitions

One statement per line, children indented **two spaces**. A long expression may break inside an
open bracket; anywhere else a deeper line is a child (`mkp.continuation`).

- `name "about"` is a widget; `part name "about"` is only for other definitions; `name of T "about"`
  takes a type parameter. In a pack the name has a version: `walk@1`.
- Members, in order:
  - `in name type [answer] [= default] ["about"]`: inputs. `answer` marks one that holds the answer
    (below).
  - `var name type = value`: the widget's own state.
  - `name = control …`: reader state with its control in the widget's bar: `slider a..b [step=]`,
    `toggle`, `choice(a|b)`, `steps n [none=true] [track=true]`, `drag x=a..b y=c..d`, `clock`.
    `play=8s` plays it through in that time, `play=500ms/step` a step at a time; `loop=repeat|bounce`.
  - `name = expression`: derived values; each sees only what is declared above it.
  - `fn name(x: type, …): type = expression`: every fn types its parameters and its result.
  - `out name {payload}` / `emit`: events to the caller; `signal name {payload}` / `send`: to the host.
  - `host name type = default`: data the host sets; `implements name@N`: an interface (below).
  - `project md = expression`, `project mermaid = expression`.
- Strings are quoted, maths is `$…$`, and `\val{expr}` shows a live value inside either. **A `"`
  always ends a string**, in maths too: build maths with holes (`"$e^{\val{k}i}$"`), never by
  joining pieces of `$…$`. `\$` is a dollar sign.
- Style props take **token names only**: colours `surface ink muted line accent info ok warn bad`
  and the categorical `c1`–`c6`; spaces `xs s m l xl`; sizes `s m l fill`; fonts `body heading
  mono`; radius `card pill`; shadow `raised`. A written-out colour is refused (`mkp.style-token`).
- **A name may not hide a colour token** (`ok = …` is `mkp.shadow`: `if(ok, ok, bad)` couldn't mean
  both), an option of the definition's own choices, or `width` and `answers`.

### Arguments: how a line fills props

`circle (p w) 0.05 if=spin fill=accent` — in order:

1. `key=value` sets that prop. Meta on any element: `id=name` (`id=(expr)` for a computed one),
   `if=(expr)`, `hidden`, `grow`, `basis=size`, `span=n`, `self=start|center|end|stretch`, `keep=(expr)`.
2. A bare word naming a **boolean** prop sets it (`wrap`, `dash`, `halo`).
3. A bare word that is an **option** of exactly one choice prop sets it (`press kind=tab` or `tab`).
4. A bare word naming a **token** fills the style prop of that kind (`text "x" muted`).
5. Anything else fills the **positional fields** in order.

**Spaces end an argument**: write `circle (p w) 0.05`, not `circle p w 0.05`.

### Expressions

Precedence, tightest first: calls, `a.b`, `xs[i]`, `row[path]`; `^`; unary `-`; **juxtaposition**
(`2 pi k`, tighter than `*` and `/`: `1/2x` is `1/(2x)`); `* /`; `+ -`; comparisons; `not`; `and`;
`or`; lambdas `x => …`.

Built-ins: maths (`exp ln log sqrt sin cos tan atan2 abs floor ceil round sign mod min max …`);
lists (`len map filter sort reverse fold group index find indexof range zip flatten first last
slice at sum mean`); dicts (`put get keys has`); text (`lower upper trim replace split contains
startswith endswith number format join`, and `slice`/`indexof`/`len` on text); `if(c, a, b)`;
`iterate`, `scan`, `rand(seed, k)`, `equivalent(a, b, vars)` for checking an answer.

- `xs[i]` out of range is a runtime error; `at(xs, i, default)` gives the default for any index out
  of range (never wrapping `-1`); `last(xs)` is the last item.
- Every evaluation has a budget of 1,000,000 operations (`budget 20000000` at most); lists hold at
  most 10,000 items; calls nest at most 64 deep.

### Events and actions

```txt
press
  text "Check"
  @click set tries=(tries + 1) send answered correct=right
  @click emit solved if=(right)
```

Actions: `set a=expr`, `play x`, `pause x`, `reset x…`, `reveal id`, `hide id`, `open id`,
`close id`, `emit name f=expr`, `send name f=expr`. `if=(…)` on an event line runs that line only
while it holds; several lines for one event run in order.

**Everything runs left to right, and each step sees the one before it.** The actions on a line, the
names in one `set`, and the lines for one event all run in the order written, each seeing the
values the earlier ones changed. So `@click set on=(not on) send changed checked=on` sends the
**new** value, and `set a=(a + 1) b=(a)` leaves `b` equal to the new `a`. To send the old value,
send it first: `@click send changed was=on set on=(not on)`.

Events:

- `@click` on a press, on a container's background (pointer only), and on a canvas `circle` or
  `path`.
- `@enter`/`@leave` on a press (the pointer, or focus), on a container (the pointer only: a
  container takes no focus), and on a canvas `circle` or `path` (the pointer; also focus for one
  that takes `@click`).
- `@change` and `@submit` on fields, `@pick` on a pressable `code`, and a part's own `out` events.

A shape's events carry nothing: no position, no button. Which shape it was is the scope its lines
run in, so `each` gives each its own. A shape that takes `@click` is a control, so it needs a
`label=` to be named by (`mkp.missing-input`); the canvas is then a group of controls, not an
image. Pointing at a slice of a chart:

```txt
var on int = -1
canvas -1..1 -1..1 size=s label="spending"
  layer
    each k in 0..(len(items) - 1) key=k
      path wedge(k) closed=true fill=(if(on == k, accent, hue(k))) label=items[k].label
        @enter set on=k
        @leave set on=-1
        @click send picked index=k
text "\val{items[on].label}: \val{format(items[on].value, 0)}" if=(on >= 0)
```

Hover is for the pointer only: say on the page what hovering shows (a legend, a total) for readers
on a phone or a keyboard.

**A field's `value` is a `var`** (or a control) of the widget that has the field: the field changes
it as the reader types (`mkp.check` otherwise). For a text answer per step, keep one `draft` for the
step on screen and a list for all of them, and move between them when the step changes:

```txt
in questions list(text)
var at int = 0
var draft text = ""
var saved list(text) = map(questions, q => "")
column gap=m
  field value=draft label=(questions[at])
  row gap=s
    press label="back" disabled=(at == 0)
      text "Back"
      @click set saved=(map(range(0, len(saved) - 1), i => if(i == at, draft, saved[i])))
      @click set at=(at - 1)
      @click set draft=(saved[at])
    press label="next" disabled=(at == len(questions) - 1)
      text "Next"
      @click set saved=(map(range(0, len(saved) - 1), i => if(i == at, draft, saved[i])))
      @click set at=(at + 1)
      @click set draft=(saved[at])
```

The three lines run in order (above), so `draft` is read from the step just reached.

## Layout

<!-- example 08-containers -->
````markdown
# Four containers

```mkp
part box "A labelled tile."
  fields label
  in label text
  in tone color = none "a wash of this colour behind it"
  column pad=m tint=tone stroke=line radius=card width=fit
    text label

containers "The same three boxes in each of MKP's four containers."
  grid cols=[auto, 1fr] gap=l align=baseline
    text "column" font=mono
    column gap=s
      box "one"
      box "two"
      box "three"
    text "row" font=mono
    row gap=s align=end
      box "one"
      box "two, the wider one"
      box "three"
    text "grid" font=mono
    grid cols=[auto, auto] gap=s width=fit
      box "one"
      box "two"
      box "three, across both" span=2
    text "stack" font=mono
    stack
      column pad=l tint=muted radius=card align=end justify=end
        text "one, at the back" tone=muted
        text "two and three over it" tone=muted size=small
      box "two" self=start tone=info
      box "three" self=end tone=ok
  project md = "The same three boxes, in a column, a row, a grid and a stack."
```

```containers
summary: The four containers side by side.
```
````

- `column` stacks, `row` wraps (or scrolls with `wrap=false scroll=x`), `grid cols=[auto, 1fr, 6ch]`
  takes tracks (or `cols=3`, or a list of track words worked out: `cols=(map(range(1, n), k => "auto"))`),
  `stack` layers its children, last on top. In a `grid` cell or a `stack`, `self=` places a child on
  both axes (`self=start` is its top-left corner); in a `row` or `column`, across only.
- `pad=` all round; `padx=` (left and right) and `pady=` (top and bottom) in its place on those sides:
  `row padx=m pady=s` for a list row.
- On a phone: `width` is `narrow`, `medium` or `wide`; a grown child in a wrapping row needs a
  `basis` (example 09). `minwidth=` with `scroll=x` scrolls what can't shrink.
- Borders: `stroke=`, `line=dashed`, `edge=top|bottom|left|right|x|y`, `weight=thin|normal|thick`.
- The host's shell: `frame` (kind, title, `status`, `fill actions`, `fill about`, `fill details`),
  `pane` side by side, `zoom` behind its lock (example 18), as tall as its content between `minheight` (by
  default, room for its lock) and `maxheight` (by default `l`). The lock shows only when there is something
  to zoom or pan: content shrunk to fit, clipped, or a drawing or picture. It shrinks what is wide down to
  `minscale` (0.6 by default, 0 for no limit); past that it shows the middle, clipped, to pan once unlocked.
  A widget's controls go in its frame's bar.
- `slot body if=(open)` places a slot only while the condition holds.
- **Nesting:** one definition nests at most 12 containers deep; `each`, `switch` and `case` don't count.

## Canvas and arrows

A `canvas x=a..b y=c..d` draws `layer`s of `circle`, `path` (lines, polygons, curves as point lists;
`head=arrow`), `label` (`halo`, `size`, `dx`/`dy`: a nudge in pixels, `dy` **up** as the canvas's
y runs up, so `dy=-8` is lower), `image`, `place` (elements at a point) and
`handle` (a `drag` state the reader moves) — example 19. `gfx@1` adds `pixels` and `mesh`, with the
widget's Markdown shown where it is missing (example 21). A `layer clip=[(x0, y0), (x1, y1)]` cuts its
shapes off outside that rectangle, in data units: a plot's curves stop at its axes' margins.

`theme` is `light` or `dark`, as the reader sees the page, read like `width`. Colour tokens follow
the theme on their own; read `theme` only for what can't use them, such as a `pixels` ramp:
`if(theme == dark, …, …)`. Markdown is drawn `light`.

`arrow from=a to=b ["label"]` joins two elements by id, inside the instance or the instances
nested in it; ends `head=`/`tail=` (`arrow hollow one many dot ring cross none`), `line=`,
`layer=behind`, `opacity=`, `via=(ids)`, `route=down|right` (example 20), `corner=m|s|none` (how
round its turns are: 12 px, 6 px, square). An arrow's ends touch the outlines it joins, and a routed
line keeps a straight run before its head (the head and 6 px) and after its tail.

## Types

Named records with defaults (`type task = {title: text, tone: color = muted}`) fill what a literal
leaves out; a literal is typed by where it goes, so `{tone: ok}` reads `ok` as a colour; `none`
is a value of every token kind; `iconname` is the icons' type (`none` draws nothing); types may be recursive (example 23).
A record kind of an input (`list(record mark {…})`) is a type its definition's fns can take.

<!-- example 24-type-parameters -->
````markdown
# A list of anything

```mkp
picklist of T "Records the reader steps through, showing two of their fields."
  in items list(T) "the records"
  in title path(T, text) "the field shown in bold"
  in note path(T, text) "the field shown under it"
  at = steps (len(items)) "item"
  column gap=s
    each k in 0..(len(items) - 1) key=k
      column pad=m gap=xs radius=card stroke=(if(k == at, accent, line))
        text (items[k][title]) weight=bold
        text (items[k][note]) tone=muted
  project md = join(map(items, it => "- **" + it[title] + "**: " + it[note]), "\n")
```

```picklist
items:
  - {city: Lisbon, fact: Built on seven hills.}
  - {city: Oslo, fact: Has a ski jump inside the city.}
  - {city: Quito, fact: Sits almost on the equator.}
title: city
note: fact
summary: Three cities, one at a time.
```

The same widget takes records of another shape:

```picklist
items:
  - {word: brioche, meaning: a rich bread with eggs and butter}
  - {word: focaccia, meaning: a flat bread with olive oil}
title: word
note: meaning
summary: Two breads and what they are.
```
````

`T` is told from the YAML: every item has the same fields of the same types, and a path names a
field that exists, with the type it needs; each is checked at its own YAML line. An optional path
defaults to `""` (test `path != ""` before reading it).

## What a host relies on

A host declares **interfaces** in its pack; a widget that `implements` one must have its inputs,
host inputs, signals and `project md`, with the same types (`mkp.interface` names what is
missing). A host finds blocks by interface, never by a widget's name, inside other widgets too
(`meta.implements`, `meta.within`) — example 30.

**Answers**: an input marked `answer` holds one. `project md` may show it only inside
`if(answers, …)`, so Markdown built with `--no-answers` gives nothing away (`mkp.answer-leak`) —
examples 14 and 31.

## Packs and copies

A pack is a folder: `manifest.mkp` (`pack name@N`, `requires core@1`, `depends other@N`,
`provides …`, `unpublished` while it may still change), `.mkp` files, and a
`name.fixture.json` with valid cases for every definition (example 29). A pack sees another's names
only through `depends`. To change a pack's widget, copy it (example 28): nothing links the copy to
it, and the `# from …` line is only for review.

## What the compiler refuses, on purpose

The examples in `examples/limits` each fail, with these codes:

| Code | What it means |
|---|---|
| `mkp.input-type` | a value of the wrong type, at its exact key or list item; YAML's `no` is text |
| `mkp.unknown-prop` | a misspelt prop, with what was meant |
| `mkp.shadow` | a name that hides a colour, an option, a global, or a pack's or core's widget |
| `mkp.untyped` | a fn without its types |
| `mkp.missing-summary` | a block without its summary |
| `mkp.no-project` | a document's widget without its Markdown |
| `mkp.budget`, `mkp.list-size`, `mkp.depth` | too much work, too long a list, too deep |
| `mkp.continuation` | a line that goes on with the one above outside brackets |
| `mkp.unknown-function` | a built-in that doesn't exist |
| `mkp.style-token` | a written-out colour |
| `mkp.unknown-widget` | a pack's name used without `depends` |
| `mkp.interface` | an interface not met |
| `mkp.slot-in-yaml` | a slot's content written in YAML: write the widget as `:::name` … `:::` |

## Checklist before you hand in

- [ ] `mkp check --format json` is clean.
- [ ] Every block has a real `summary:`; every widget of your own has a `project md`.
- [ ] Presses that hold only an icon have a `label=`; canvases have a `label=`.
- [ ] Token names only; nothing specific to one host in a definition meant for any.
- [ ] The Markdown (`--target md`, and `--no-answers`) reads well without the widgets.
