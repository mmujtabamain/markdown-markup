---
fails: "a built-in that doesn't exist: the error says so, with what was meant"
expect: {code: mkp.unknown-function, line: 10}
---
# Limit: a made-up built-in

```mkp
shout "A word in capitals."
  in word text = "hello"
  text "\val{uppercase(word)}"
  project md = word
```

```shout
summary: A shout.
```
