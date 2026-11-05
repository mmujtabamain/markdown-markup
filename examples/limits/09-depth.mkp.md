---
fails: "a fn that calls itself 100 deep: calls nest at most 64"
expect: {code: mkp.depth, line: 0}
---
# Limit: too deep

```mkp
fn down(n: int): int = if(n <= 0, 0, 1 + down(n - 1))

deep "A count made by a fn calling itself."
  text "\val{down(100)}"
  project md = "deep"
```

```deep
summary: A deep count.
```
