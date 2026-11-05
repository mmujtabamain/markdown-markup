---
teaches: "column, row, grid and stack, and how each places the same boxes"
gaps: [19, 41, 79, 98, 99, 148, 159]
---
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
