---
fails: "a list of 20,000 items: lists hold at most 10,000"
expect: {code: mkp.list-size, line: 0}
---
# Limit: a list too long

```mkp
many "Twenty thousand numbers."
  xs = range(1, 20000)
  text "\val{len(xs)}"
  project md = "many"
```

```many
summary: Many numbers.
```
