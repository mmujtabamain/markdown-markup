---
description: Defining widgets in MKP - inputs, state, controls, expressions, events, the Markdown a widget writes, and where definitions live.
---
# Your own widgets

A widget is defined in MKP's own small language, in an `mkp` fence. The fence draws
nothing; any block in the document may use what it defines, before or after it.

````markdown
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

One statement a line, children indented two spaces. The first line names the widget and says what
it is for; then come its members, then what it draws, built from the [base set](base-set.mkp.md).

## Members

In this order:

| Member | What it declares |
| --- | --- |
| `in name type = default "about"` | An input, filled from the block's YAML. `answer` after the type marks one that holds the answer. |
| `var name type = value` | The widget's own state. |
| `name = slider 0..10 "label"` | State the reader changes with a control in the widget's bar: `slider`, `toggle`, `choice(…)`, `steps n`, `drag`, `clock`. |
| `name = expression` | A value worked out from what is above it. |
| `fn name(x: num): num = expression` | A function, with its types written out. |
| `out name {…}` | An event for the widget that uses this one (`emit`). |
| `signal name {…}` | A message to the host app (`send`). |
| `project md = expression` | The Markdown a reader without MKP gets instead. |

Every widget you define needs a `project md`, unless it only holds content in a slot.

Controls can play themselves: `steps 4 play=1s/step` steps through on its own, and
`slider 0..1 play=8s loop=bounce` sweeps back and forth.

## Expressions

Arithmetic, comparisons, `and`/`or`/`not`, `if(c, a, b)`, lambdas `x => …`, and a library of
built-ins for maths (`sin`, `sqrt`, `round`…), lists (`map`, `filter`, `sum`, `range`…), records
and text (`format`, `join`, `upper`…). Writing two things side by side multiplies them, tighter than
`*`: `2 pi k` is $2\pi k$, and `1/2x` is $\frac{1}{2x}$.

Inside a string, `\val{expr}` shows a live value, in maths too: `"$e^{\val{k}i}$"`.

## Events and actions

````markdown
```mkp
tally "Counts the reader's clicks and tells the host."
  signal clicked {count: int}
  var n int = 0
  press
    text "Click me"
    @click set n=(n + 1) send clicked count=(n + 1)
  project md = "A button that counts clicks."
```
````

An event line (`@click`, `@change`, `@submit`, `@enter`, `@leave`…) runs actions in order: `set`,
`reveal` and `hide`, `play` and `pause`, `emit` an event, `send` a signal. `if=(…)` on the line
runs it only while it holds.

## Style by name

Style props take **token names**, never written-out values, so a host's theme decides how they
look:

- colours: `surface ink muted line accent info ok warn bad`, and `c1`–`c6` for series
- spaces: `xs s m l xl`, sizes `s m l fill`, fonts `body heading mono`
- corners: `card pill`, shadow: `raised`

A colour such as `#ff0000` is refused (`mkp.style-token`).

## Types

Inputs and values are typed: `num`, `int`, `bool`, `text`, `color`, `list(T)`, records
(`{title: text, tone: color = muted}`), `choice(a|b|c)` and more. A widget may take a type
parameter, `picklist of T`, and read a field of each item through a `path(T, text)` input. The
compiler checks every YAML value against its input's type, at its own line.

## Where definitions live

- In the document, in an `mkp` fence: they belong to that document.
- In `name.mkp` beside `name.mkp.md`: the same definitions, moved out.
- In a pack: a folder with a `manifest.mkp`, its `.mkp` files, and fixtures that give every widget
  a valid case. A host loads it with `--pack`.

A name that a pack or the base set already gives is refused (`mkp.shadow`): copy the widget with a
new name instead.

## Answers stay hidden

An input marked `answer` holds the answer to a question. A widget's Markdown may show it only
inside `if(answers, …)`, so `mkp build --no-answers` gives readers nothing away before they try
(`mkp.answer-leak` otherwise). [See it in the examples](../examples/#e=ex:14-check-an-answer).
