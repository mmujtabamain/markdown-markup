---
teaches: "an interface a host declares, two widgets that implement it, and what the host sees: the blocks that implement it, at any depth"
---
# Rate the walk

The host's pack in `host/` declares `scored@1`: an `of` input, a `scored` signal and a
`project md`. A host that adds up scores finds every block that implements it, by the interface and
never by a widget's name, inside other widgets too.

```mkp
stars "Rate out of five by pressing a star."
  implements scored@1
  in of int = 5 "how many stars"
  signal scored {got: int} "sent when the reader rates"
  var got int = 0
  row gap=xs
    each k in 1..of key=k
      press kind=plain label=(format(k, 0) + " of " + format(of, 0))
        icon name=star tone=(if(k <= got, accent, muted))
        @click set got=k send scored got=k
  project md = format(got, 0) + " of " + format(of, 0) + " stars"

thumbs "Up or down: worth one point."
  implements scored@1
  in of int = 1 "the most it scores"
  signal scored {got: int} "sent on a press"
  var up bool = false
  row gap=s
    press kind=toggle selected=up label="worth it"
      icon name=check
      @click set up=(not up) send scored got=(if(up, 0, 1))
  project md = if(up, "Worth it.", "Not rated.")

survey "Two ratings of a walk, in one block: the host finds both inside it."
  column gap=s
    row gap=s align=center
      text "The views"
      stars
    row gap=s align=center
      text "Worth the climb?"
      thumbs
  project md = "Two ratings of the walk."
```

```stars
summary: A five-star rating of the walk.
```

```survey
summary: Two ratings of the walk.
```
