---
teaches: "a widget with a type parameter, and typed paths into the caller's data"
---
# A list of anything

```mkp
picklist of T "Records the reader steps through, showing two of their fields."
  in items list(T) "the records"
  in title path(T, text) "the field shown in bold"
  in note path(T, text) "the field shown under it"
  at = steps (len(items)) "item"
  column gap=s
    each k in 0..(len(items) - 1) key=k
      column pad=m gap=xs radius=card stroke=(if(k == at, accent, line))
        text (items[k][title]) weight=bold
        text (items[k][note]) tone=muted
  project md = join(map(items, it => "- **" + it[title] + "**: " + it[note]), "\n")
```

```picklist
items:
  - {city: Lisbon, fact: Built on seven hills.}
  - {city: Oslo, fact: Has a ski jump inside the city.}
  - {city: Quito, fact: Sits almost on the equator.}
title: city
note: fact
summary: Three cities, one at a time.
```

The same widget takes records of another shape:

```picklist
items:
  - {word: brioche, meaning: a rich bread with eggs and butter}
  - {word: focaccia, meaning: a flat bread with olive oil}
title: word
note: meaning
summary: Two breads and what they are.
```
