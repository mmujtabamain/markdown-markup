---
fails: "text where a number goes, in a YAML list item: the error is at that item"
expect: {code: mkp.input-type, line: 17}
---
# Limit: a wrong type in a list item

```mkp
total "The sum of some numbers."
  in xs list(num)
  text "\val{sum(xs)}"
  project md = format(sum(xs), 0)
```

```total
xs:
  - 4
  - four
  - 6
summary: A sum.
```
