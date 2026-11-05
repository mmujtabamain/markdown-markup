---
teaches: "a listing with its current line marked, inline and display maths, and a formula's marked parts"
gaps: [33, 68, 96, 163]
---
# Averages

The mean of $n$ numbers is their sum over $n$:

$$\bar x = \frac{1}{n}\sum_{i=1}^{n} x_i$$

```mkp
listing "A short program with its current line marked, and a formula whose parts are named."
  in current int 1..4 = 3 "the line being run"
  column gap=m
    code "total = 0\nfor x in xs:\n    total = total + x\nmean = total / len(xs)" lang="python" line=current pickable
    math $\mark{sum}{\sum_{i=1}^{n} x_i} \div \mark{count}{n}$ marks=[{id: "sum", tone: accent, note: "what the loop adds up"}, {id: "count", tone: c2, note: "how many there are"}]
  project md = "The loop adds each $x_i$ to `total`; the mean is $\sum x_i / n$."
```

```listing
current: 3
summary: A four-line program for the mean, at the line that adds.
```
