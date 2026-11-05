---
fails: "a widget that says it implements scored@1 but has no scored signal"
expect: {code: mkp.interface, line: 9}
---
# Limit: an interface not met

```mkp
stars "Rate out of five."
  implements scored@1
  in of int = 5
  var got int = 0
  row gap=xs
    each k in 1..of key=k
      press kind=plain label=(format(k, 0))
        icon name=star
        @click set got=k
  project md = format(got, 0) + " stars"
```

```stars
summary: A rating.
```
