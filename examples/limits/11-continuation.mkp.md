---
fails: "a line that continues the one above outside brackets: say it on the line above, or break inside (…)"
expect: {code: mkp.continuation, line: 10}
---
# Limit: a continuation outside brackets

```mkp
caption "A caption."
  text "A quiet caption."
    tone=muted
  project md = "A quiet caption."
```

```caption
summary: A caption.
```
