---
teaches: "a view the reader unlocks to zoom and pan: as tall as its content, between a minimum and a maximum height"
---
# zoom

A view the reader can zoom and pan once they unlock it. It starts locked, so scrolling the page past it is never caught. It is as tall as what it holds, never shorter than `minheight` (by default, room for its lock) and never taller than `maxheight` (by default `l`); what is taller is clipped, to pan once unlocked. Its lock shows only when there is something to zoom or pan: what it holds was shrunk to fit, is clipped, or is a drawing or a picture.

```mkp
zoomed "Four zooms: one that fits, one shrunk to fit, one held taller, and one held shorter."
  column gap=l
    text "the default: as tall as its content; it fits whole, so there is no lock" size=small tone=muted
    zoom
      row gap=s wrap=false
        each k in 1..3 key=k
          column pad=m stroke=line radius=card
            text "step \val{k}"
    text "wider than the view: shrunk to fit, with a lock to unlock and look closer" size=small tone=muted
    zoom
      row gap=s wrap=false
        each k in 1..10 key=k
          column pad=m stroke=line radius=card
            text "step \val{k}"
    text "minheight=s: never shorter than the s size; it fits, so no lock" size=small tone=muted
    zoom minheight=s
      row gap=s wrap=false
        each k in 1..4 key=k
          column pad=m stroke=line radius=card
            text "step \val{k}"
    text "maxheight=s: a tall list held to the s size and clipped, with a lock to pan" size=small tone=muted
    zoom maxheight=s
      column gap=s
        each k in 1..12 key=k
          column pad=s stroke=line radius=card
            text "row \val{k}"
  project md = "Three steps, ten steps, four steps, and twelve rows, each in a zoom."
```

```zoomed
summary: Four zooms, one that fits with no lock, one shrunk to fit, one held taller, one held shorter.
```
