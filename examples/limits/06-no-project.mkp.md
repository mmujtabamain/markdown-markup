---
fails: "a document's widget with no project md: a reader without MKP would get nothing"
expect: {code: mkp.no-project, line: 8}
---
# Limit: no Markdown of its own

```mkp
dial "A dial."
  v = slider 0..10 "value"
  meter value=v max=10
```

```dial
summary: A dial.
```
