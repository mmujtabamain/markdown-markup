---
fails: "a fn with no types: every fn says what it takes and gives"
expect: {code: mkp.untyped, line: 8}
---
# Limit: an untyped fn

```mkp
fn twice(x) = 2 x

doubled "A number and its double."
  in n num = 4
  text "\val{n} and \val{twice(n)}"
  project md = format(n, 0)
```
