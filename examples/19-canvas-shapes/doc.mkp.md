---
teaches: "a canvas: paths, circles with a pixel radius, labels with a size and a halo, each shape's own opacity, a fixed height, and a handle the reader drags"
gaps: [18, 66, 104, 106, 107, 108, 109]
---
# A parabola

```mkp
fn curve(a: num): list(point) = map(range(0, 60), k => (-3 + k/10, a (-3 + k/10)^2))

parabola "The parabola y = ax², with a point the reader drags along the x-axis."
  in a num = 0.5 "how steep it is"
  p = drag x=-3..3 y=0..0 "the point"
  y = a p.x^2
  canvas x=-3.2..3.2 y=-0.5..4.8 height=m label="y = ax² and a point on it"
    layer opacity=0.4
      path [(-3.2, 0), (3.2, 0)] stroke=muted
      path [(0, -0.5), (0, 4.8)] stroke=muted
    layer
      path (curve(a)) stroke=accent width=2
      path [(p.x, 0), (p.x, y)] stroke=c2 dash opacity=0.6
      circle ((p.x, y)) 0 px=5 fill=c2
      label ((p.x, y)) "($\val{format(p.x, 1)}$, $\val{format(y, 2)}$)" anchor=sw halo dx=6 dy=-4
      label ((3, 4.5)) "$y = \val{a}x^2$" size=large anchor=ne halo
      handle p tone=c2
  project md = "The parabola $y = " + format(a, 1) + "x^2$; the point at $x = " + format(p.x, 1) + "$ is at height " + format(y, 2) + "."
```

```parabola
a: 0.5
summary: The parabola $y = 0.5x^2$ with a point on it.
```
