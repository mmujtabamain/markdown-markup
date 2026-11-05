---
teaches: "the optional gfx@1 capability: a heat map and a surface; where a provider lacks it, the widget's Markdown shows"
gaps: [114]
needs: [gfx@1]
---
# Hills

```mkp
hills "A hilly landscape as a heat map and as a surface turned with a slider."
  requires gfx@1
  in f expr(x, y) = (sin(x) cos(y)) "the height, in x and y"
  turn = slider 0..360 step=5 play=12s loop=repeat = 35 "turn"
  row gap=m wrap
    canvas x=-3..3 y=-3..3 size=m label="heights from above: dark is low, light is high" grow basis=s
      layer
        pixels (hsl(0.6 - 0.3 f(x, y), 0.7, 0.5 + 0.3 f(x, y))) res=128
    canvas dims=3 x=-3..3 y=-3..3 z=-1.5..1.5 view=((turn, 25)) size=m label="the same heights as a surface" grow basis=s
      layer
        mesh f=(f(x, y)) n=30 fill=info
  project md = "Heights of $z = \\sin x \\cos y$ over $[-3, 3]^2$: four hills and four hollows."
```

```hills
summary: Four hills and four hollows, from above and from the side.
```
