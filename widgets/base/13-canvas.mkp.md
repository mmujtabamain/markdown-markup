---
teaches: "a coordinate space in layers: paths, circles, labels and a handle the reader drags"
---
# canvas

A 2D coordinate space; layers are drawn in the order written. Lines, rectangles and curves are paths.

```mkp
plane "Axes, a circle, a triangle and a point the reader drags."
  p = drag x=-2..2 y=-2..2 "the point"
  canvas x=-2.2..2.2 y=-2.2..2.2 size=m label="a circle, a triangle and a point"
    layer opacity=0.5
      path [(-2.2, 0), (2.2, 0)] stroke=muted
      path [(0, -2.2), (0, 2.2)] stroke=muted
    layer
      circle ((0, 0)) 1.5 stroke=c1 width=2
      path [(-1, -1), (1, -1), (0, 1.2)] closed fill=c2 opacity=0.3 stroke=c2
      label ((p.x, p.y)) "P" anchor=sw dx=6 dy=-4 halo
      handle p tone=c3
  project md = "A circle of radius 1.5 and a point at (" + format(p.x, 1) + ", " + format(p.y, 1) + ")."
```

```plane
summary: A circle, a triangle and a point to drag.
```
