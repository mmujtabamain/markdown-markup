---
description: A document is Markdown with widget blocks. How to place widgets, share state between them, fill their content, and check it all.
---
# Writing documents

A document is a Markdown file named `name.mkp.md`. Write Markdown first, and reach for a widget
only where the reader should do something: change a value, step through, answer.

Decide in this order:

1. **Plain Markdown**, when the reader only reads.
2. **A widget a pack gives**, filled in with YAML.
3. **A copy of one**, edited, when one does nearly everything you need.
4. **Your own**, composed from the base set, when nothing comes close.

## Markdown

Headings, paragraphs, lists and task lists, tables, quotes and alerts (`> [!TIP]`), code, maths,
footnotes and images all work as they do on GitHub. Each is a block of the base set, so it comes
out as itself in every output.

Maths is TeX between dollars: `$e^{i\pi} + 1 = 0$` gives $e^{i\pi} + 1 = 0$, and a display formula
goes between `$$` lines:

$$
\sum_{k=1}^{n} k = \frac{n(n+1)}{2}
$$

A fence labelled with a language (`sh`, `ts`, `yaml`, `markdown`, `text`…) is always code, and a
`math` fence is always a formula, whatever is inside.

## Widget blocks

A widget block is a fence named after the widget, with its inputs in YAML and a `summary:`, one
sentence saying what the reader sees:

````markdown
```counter
start: 3
summary: A counter that starts at 3.
```
````

- **Quote text in YAML** when it could read as something else: `on: no` is the text "no", but
  `on: false` is a boolean, and `'\theta'` keeps its backslash where `"\theta"` would not.
- A block may carry an id after its name, `` ```counter #score ``, for a host to find it by.
- A label Markdown already knows (a language, `text`, `math`) never names a widget: the fence stays
  Markdown.

## Shared state

Two widgets can read the same value. A `state` block declares it once, with the control
that changes it, and each block reads it with `{ref: name}`:

````markdown
```state
celsius = slider -20..40 step=1 = 18 "temperature in °C"
```

```thermometer
t: {ref: celsius}
scale: c
summary: The temperature in Celsius.
```

```thermometer
t: {ref: celsius}
scale: f
summary: The same temperature in Fahrenheit.
```
````

Moving the one slider moves both. [See it in the examples](../examples/#e=ex:07-shared-state).

## Containers

What goes inside a widget (Markdown, other widget blocks, more containers) is written between
`:::name` and `:::`, never in YAML. The widget's other inputs go on the opening line:

````markdown
:::tabs
:::tab "Idea"
Split the list, sort each half, merge.
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

The content fills the widget's first slot; `:::fill name` … `:::` fills another. Putting content in
YAML instead is refused (`mkp.slot-in-yaml`), so the data and the content never mix.

## Widgets from a pack

A pack (`name.mkpack`, or a folder) is a library of widgets a host loads. Name it when you check
or build, and list what it gives:

```sh
mkp index --pack lib                    # every widget, one a line
mkp show walk --pack lib                # one widget's inputs and an example
mkp show walk --pack lib --source --as my-walk   # its source, renamed, to paste and edit
```

A copy belongs to your document: nothing links it back, so a later change to the pack never
reaches it.

## Front matter

A document may start with YAML front matter, as these pages do. MKP keeps it in the build for the
host (a title, tags, a description) and draws none of it.

## Checking

Run `mkp check` until it is clean. Every error names its rule, its line and column, what was
found, and the fix:

```txt
lesson.mkp.md:17:5 error mkp.input-type: xs[1] is a number; found "four"
```

`--format json` gives one error a line, for an editor or an agent to read.
