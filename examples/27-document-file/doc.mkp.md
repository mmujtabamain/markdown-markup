---
teaches: "a document's own definitions moved out of it into doc.mkp beside it: the same scope and rules, and the same output as example 22"
---
# Pancakes, with the recipe's widget in its own file

The widget is defined in `doc.mkp` beside this document; the document only uses it.

```recipe
serves: 4
items:
  - {name: Flour, amount: 250, unit: g}
  - {name: Milk, amount: 500, unit: ml}
  - {name: Eggs, amount: 2, unit: ""}
  - {name: Butter, amount: 30, unit: g}
summary: Pancakes for four, scaled to any number of people.
```
