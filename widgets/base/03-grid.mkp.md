---
teaches: "children in columns: tracks such as [auto, 1fr], equal columns, a cell spanning two"
---
# grid

Children in columns, cell by cell. `cols` is a number of equal columns or a list of tracks: `auto`, `Nfr`, `Nch` or a size.

```mkp
grids "A form-like grid and a grid of equal tiles."
  column gap=l
    grid cols=[auto, 1fr] gap=s align=baseline
      text "Name" tone=muted
      text "Ana Sousa"
      text "City" tone=muted
      text "Lisbon"
    grid cols=3 gap=s
      each k in 1..5 key=k
        column pad=s stroke=line radius=card
          text "tile \val{k}"
      column pad=s tint=info radius=card span=1
        text "the last one"
  project md = "A two-column grid and a grid of tiles."
```

```grids
summary: A label and value grid, and a three-column grid of tiles.
```
