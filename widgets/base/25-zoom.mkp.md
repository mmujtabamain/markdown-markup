---
teaches: "a view the reader unlocks to zoom and pan: as tall as its content, between a minimum and a maximum height"
---
# zoom

A view the reader can zoom and pan once they unlock it. It starts locked, so scrolling the page past it is never caught. It is as tall as what it holds, never shorter than `minheight` (by default, room for its own tools) and never taller than `maxheight` (by default `l`); what is taller is clipped, to pan once unlocked.

```mkp
zoomed "Three zooms: as tall as their content, held taller, and held shorter."
  column gap=l
    text "the default: as tall as its content" size=small tone=muted
    zoom
      row gap=s wrap=false
        each k in 1..8 key=k
          column pad=m stroke=line radius=card
            text "step \val{k}"
    text "minheight=s: never shorter than the s size" size=small tone=muted
    zoom minheight=s
      row gap=s wrap=false
        each k in 1..4 key=k
          column pad=m stroke=line radius=card
            text "step \val{k}"
    text "maxheight=s: a tall list held to the s size, to pan once unlocked" size=small tone=muted
    zoom maxheight=s
      column gap=s
        each k in 1..12 key=k
          column pad=s stroke=line radius=card
            text "row \val{k}"
  project md = "Eight steps, four steps, and twelve rows, each in a zoom."
```

```zoomed
summary: Three zooms, one as tall as its steps, one held taller, one held shorter.
```
