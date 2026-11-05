---
fails: "a value named ok, which is a colour: if(ok, ok, bad) could not mean both"
expect: {code: mkp.shadow, line: 11}
---
# Limit: a name that hides a colour

```mkp
badge "A word on a coloured chip."
  in word text
  in good bool = true
  ok = good
  row pad=xs fill=(if(ok, ok, bad)) radius=pill
    text word
  project md = word
```

```badge
word: fine
summary: A chip.
```
