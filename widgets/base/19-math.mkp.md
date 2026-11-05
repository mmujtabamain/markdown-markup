---
teaches: "a display formula, with parts marked and noted"
---
# math

A display formula. `\mark{id}{…}` marks a part, coloured by its entry in `marks`, with a note under the formula.

$$
\int_0^1 x^2 \, dx = \frac{1}{3}
$$

```mkp
formula "Pythagoras with its parts marked."
  math $\mark{a}{a^2} + \mark{b}{b^2} = \mark{c}{c^2}$ marks=[{id: "a", tone: c1, note: "one side"}, {id: "b", tone: c2, note: "the other"}, {id: "c", tone: c3, note: "the long side"}]
  project md = "$$a^2 + b^2 = c^2$$"
```

```formula
summary: a squared plus b squared equals c squared, each term marked.
```
