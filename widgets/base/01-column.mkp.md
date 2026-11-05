---
teaches: "children one below another: gap, padding, alignment, a border and a wash"
---
# column

Children one below another. Its `gap`, `pad`, `align` and look (`fill`, `tint`, `stroke`, `radius`) are its own.

```mkp
columns "Three columns that differ only in how they sit and look."
  row gap=l align=start
    column gap=s
      text "gap=s" font=mono size=small tone=muted
      text "one"
      text "two"
      text "three"
    column gap=m pad=m stroke=line radius=card
      text "pad=m stroke=line" font=mono size=small tone=muted
      text "one"
      text "two"
    column gap=s pad=m tint=info radius=card align=center
      text "tint=info, centred" font=mono size=small tone=muted
      text "one"
      text "two"
  project md = "Three columns."
```

```columns
summary: Three columns, each laid out a little differently.
```
