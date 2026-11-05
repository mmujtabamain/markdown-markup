---
teaches: "a part used for every item, a typed fn, a named type, and each with a key"
---
# Pancakes

```mkp
type ingredient = {name: text, amount: num, unit: text}

fn scaled(i: ingredient, k: num): text = trim(format(i.amount k, if(i.amount k < 10 and i.amount k != round(i.amount k), 1, 0)) + " " + i.unit)

part entry "One ingredient at the chosen size."
  in item ingredient
  in factor num
  row justify=between gap=l edge=bottom stroke=line pad=xs
    text item.name
    text (scaled(item, factor)) font=mono

recipe "A recipe that scales with the number of people."
  in serves int = 4 "the people it is written for"
  in items list(ingredient)
  people = slider 1..12 step=1 = 4 "people"
  column gap=xs width=fit
    text "For \val{people}:" weight=bold
    each i in items key=i.name
      entry item=i factor=(people / serves)
  project md = "For " + format(people, 0) + " people:\n\n" + join(map(items, i => "- " + i.name + ": " + scaled(i, people / serves)), "\n")
```

```recipe
serves: 4
items:
  - {name: Flour, amount: 250, unit: g}
  - {name: Milk, amount: 500, unit: ml}
  - {name: Eggs, amount: 2, unit: ""}
  - {name: Butter, amount: 30, unit: g}
summary: Pancakes for four, scaled to any number of people.
```
