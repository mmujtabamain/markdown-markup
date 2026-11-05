---
fails: "a misspelt prop: the error names it and says what was meant"
expect: {code: mkp.unknown-prop, line: 9}
---
# Limit: a misspelt prop

```mkp
note "A note."
  text "Remember the milk." tone=muted wieght=bold
  project md = "Remember the milk."
```

```note
summary: A note.
```
