---
teaches: "children side by side: gap, alignment, justify between, wrapping and sideways scrolling"
---
# row

Children side by side. It wraps onto more lines when they don't fit, or, with `wrap=false scroll=x`, scrolls sideways.

```mkp
rows "Rows that place the same chips differently."
  column gap=m
    row gap=s
      each k in 1..4 key=k
        text "chip \val{k}" size=small
    row gap=s justify=between pad=s stroke=line radius=card
      text "start"
      text "between"
      text "end"
    row gap=s wrap=false scroll=x
      each k in 1..12 key=k
        column pad=s stroke=line radius=card
          text "card \val{k}" size=small
  project md = "Rows: a plain one, one justified between, one that scrolls."
```

```rows
summary: A plain row, a row justified between, and a row that scrolls sideways.
```
