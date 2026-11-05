---
teaches: "a row of stars to press, the chosen ones filled in a tone: each, press and icon"
---
# Rating

A rating: stars to press; those up to the choice are drawn in the warn tone.

```mkp
rating "Rate out of five."
  in of int = 5
  var got int = 0
  row gap=xs align=center
    each k in 1..of key=k
      press kind=plain label=(format(k, 0) + " of " + format(of, 0))
        icon name=star tone=(if(k <= got, warn, muted))
        @click set got=k
    text (if(got == 0, "not rated", format(got, 0) + " of " + format(of, 0))) size=small tone=muted
  project md = format(got, 0) + " of " + format(of, 0)
```

```rating
summary: Five stars to rate with.
```
