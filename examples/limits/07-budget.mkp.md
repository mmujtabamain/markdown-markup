---
fails: "work that never finishes in time: stopped by the operation budget, shown in place of the block"
expect: {code: mkp.budget, line: 0}
---
# Limit: out of budget

```mkp
slow "A sum that takes far too long."
  r = sum(map(range(1, 9000), k => sum(map(range(1, 500), j => j k))))
  text "\val{r}"
  project md = "a sum"
```

```slow
summary: A slow sum.
```
