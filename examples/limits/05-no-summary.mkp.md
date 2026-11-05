---
fails: "a block with no summary: every block says in a sentence what it shows"
expect: {code: mkp.missing-summary, line: 13}
---
# Limit: a block without a summary

```mkp
hello "A greeting."
  text "Hello!"
  project md = "Hello!"
```

```hello
```
