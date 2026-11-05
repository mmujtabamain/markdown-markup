---
teaches: "column, row, grid and stack, and how each places the same boxes"
gaps: [19, 41, 79, 98, 99, 148, 159]
---
# Four containers

```mkp
part box "A labelled tile."
  fields label
  in label text
  in tone color = surface
  column pad=m fill=tone stroke=line radius=card width=fit
    text label

containers "The same three boxes in each of MKP's four containers."
  grid cols=[auto, 1fr] gap=l align=center
    text "column" font=mono
    column gap=s
      box "one"
      box "two"
      box "three"
    text "row" font=mono
    row gap=s justify=between
      box "one"
      box "two" self=end
      box "three"
    text "grid" font=mono
    grid cols=[1fr, 1fr] gap=s
      box "one"
      box "two"
      box "three" span=2
    text "stack" font=mono
    stack
      box "one" tone=muted
      box "two" self=center
      box "three" self=end tone=accent
  project md = "The same three boxes, in a column, a row, a grid and a stack."
```

```containers
summary: The four containers side by side.
```
