---
teaches: "children drawn one over another, the last on top, each placed by its own self="
---
# stack

Children drawn one over another in the order written; the last is on top. It is as big as its biggest child.

```mkp
badge "A picture with a badge in its corner, as a stack."
  stack width=fit
    column pad=xl tint=muted radius=card
      text "a picture"
    column pad=xs fill=bad radius=pill self=start
      text "3" size=small tone=surface weight=bold
  project md = "A picture with a badge."
```

```badge
summary: A badge drawn over the corner of a picture.
```
