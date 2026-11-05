---
teaches: "one of several panels at a time, chosen by tab presses: press kind=tab and if="
---
# Tabs

Tabs: a row of tab presses over the panel they choose.

```mkp
tabbed "Three panels, one shown at a time."
  in names list(text)
  in texts list(text)
  var shown int = 0
  column gap=m
    row gap=xs
      each k in 0..(len(names) - 1) key=k
        press kind=tab selected=(shown == k)
          text (names[k])
          @click set shown=k
    text (at(texts, shown, ""))
  project md = join(map(range(0, len(names) - 1), k => "**" + names[k] + "**: " + texts[k]), "\n\n")
```

```tabbed
names: [Overview, Prices, Reviews]
texts:
  - "A small bakery near the river, open from seven."
  - "Bread from 2.40, pastries from 1.80."
  - "Four and a half stars, from three hundred reviews."
summary: Three tabs about a bakery.
```
