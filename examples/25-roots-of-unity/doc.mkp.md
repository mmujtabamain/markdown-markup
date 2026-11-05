---
teaches: "a whole widget in one document: controls, a canvas and live maths, with no pack"
gaps: [157]
---
# Roots of unity

> [!TIP]
> Every root lies on the unit circle.

```mkp
fn root(n: int, j: int, r: num): point = (r cos(2 pi j/n), r sin(2 pi j/n))

roots "The n-th roots of unity on the unit circle, and what multiplying by one does."
  in n int 2..12 = 5 "how many roots"
  in labels bool = true "label the points"
  k = slider 0..(n-1) step=1 play=1s/step loop=repeat "which root"
  spin = toggle "multiply a point by it"
  t = 2 pi k/n
  moved = (cos(t) - 0.5 sin(t), sin(t) + 0.5 cos(t))
  row gap=l wrap
    canvas x=-1.6..1.6 y=-1.6..1.6 size=m label="the roots on the unit circle" grow basis=m
      layer opacity=0.5
        circle (0, 0) 1 stroke=muted
      layer
        each j in 0..(n-1) key=j
          circle (root(n, j, 1)) 0.04 fill=ink
          label (root(n, j, 1.18)) $\omega^{\val{j}}$ if=labels halo
        path [(0, 0), root(n, k, 1)] stroke=accent
        circle moved 0.05 if=spin fill=accent
    column gap=s grow basis=m
      math $\arg \omega^{\val{k}} = \val{360 k/n}^\circ$
      text "Multiplying by $\omega^{\val{k}}$ turns the plane by $\val{k}/\val{n}$ of a turn."
  project md = "The \val{n} roots are $e^{2\pi i j/\val{n}}$ for $j = 0, \dots, \val{n - 1}$."
```

```roots
n: 5
summary: The five fifth roots of unity.
```
