---
teaches: "a view the reader unlocks to zoom and pan, which never catches the page's scroll"
---
# zoom

A view the reader can zoom and pan once they unlock it. It starts locked, so scrolling the page past it is never caught.

```mkp
zoomed "A wide diagram behind a zoom."
  zoom max=3
    row gap=s wrap=false
      each k in 1..8 key=k
        column pad=m stroke=line radius=card
          text "step \val{k}"
  project md = "Eight steps in a row."
```

```zoomed
summary: Eight steps in a row, in a view to zoom and pan.
```
