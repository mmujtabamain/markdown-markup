---
teaches: "text cut to a number of lines, and an element kept in view inside a scrolling list"
gaps: [150, 151]
---
# Reviews

```mkp
reviews "A list of reviews, each cut to two lines, with the chosen one kept in view."
  in items list({who: text, said: text})
  at = steps (len(items)) "review"
  column gap=s
    row wrap=false scroll=x gap=s
      each k in 0..(len(items) - 1) key=k
        column pad=s stroke=(if(k == at, accent, line)) radius=card minwidth=s keep=(k == at)
          text (items[k].who) weight=bold
          text (items[k].said) lines=2 clip
  project md = join(map(items, i => "> " + i.said + "\n> — " + i.who), "\n\n")
```

```reviews
items:
  - {who: Ana, said: "The bread was still warm when we got home, and the crust stayed crisp all evening. We'll be back on Saturday."}
  - {who: Ben, said: "Friendly, quick, and the coffee is better than the place across the street."}
  - {who: Chen, said: "A little pricey, but the pastries are worth it. Get there early: they sell out by ten."}
  - {who: Dara, said: "Lovely staff. The queue moves fast even on a Sunday."}
summary: Four short reviews of a bakery.
```
