---
teaches: "a type of your own with operators: + and * on it, a number promoted into it, a point made from it, and how \\val shows it"
---
# Two forces

```mkp
type vec2 = {x: num, y: num}

op +(a: vec2, b: vec2): vec2 = {x: a.x + b.x, y: a.y + b.y}
op *(k: num, v: vec2): vec2 = {x: k v.x, y: k v.y}
op point(v: vec2): point = (v.x, v.y)
fn show(v: vec2): text = "(" + format(v.x, 1) + ", " + format(v.y, 1) + ")"

forces "Two forces on a point and their sum, drawn from the origin."
  in a vec2 = {x: 2, y: 0.5} "the first force"
  in b vec2 = {x: 0.5, y: 2} "the second force"
  k = slider 0..2 step=0.1 = 1 "how much of the second"
  sum = a + k b
  column gap=s
    canvas x=-0.5..3.5 y=-0.5..4.5 size=s label="the forces and their sum"
      layer
        path [(0, 0), a] stroke=c1 width=2 head=arrow
        path [(0, 0), k b] stroke=c2 width=2 head=arrow
        path [(0, 0), sum] stroke=ink width=2.5 head=arrow
    text "The sum is \val{sum}." font=mono
  project md = "The forces " + show(a) + " and " + format(k, 1) + " × " + show(b) + " add up to " + show(sum) + "."
```

```forces
summary: Two forces and their sum.
```
