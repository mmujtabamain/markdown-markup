---
teaches: "dashed outlines, rules on one side, border widths, the line colour and the categorical colours"
gaps: [4, 62, 78, 154, 158]
---
# A receipt

```mkp
receipt "A shop receipt: items, a rule above the total, and a dashed tear-off."
  in items list({name: text, price: num})
  in palette list(color) = [c1, c2, c3, c4, c5, c6] "the categorical colours, for a strip under the receipt"
  total = sum(map(items, i => i.price))
  column gap=s pad=m stroke=line radius=card width=fit
    each i in items key=i.name
      row justify=between gap=l
        text i.name
        text format(i.price, 2) font=mono
    row justify=between gap=l edge=top stroke=ink weight=normal
      text "Total" weight=bold
      text format(total, 2) font=mono weight=bold
    column pad=s stroke=muted line=dashed edge=top
      text "Keep this part for returns." size=small tone=muted
    row gap=xs
      each c in palette key=c
        column pad=s fill=c radius=card
  project md = join(map(items, i => "- " + i.name + ": " + format(i.price, 2)), "\n") + "\n\n**Total: " + format(total, 2) + "**"
```

```receipt
items:
  - {name: Bread, price: 3.2}
  - {name: Cheese, price: 6.75}
  - {name: Apples, price: 2.4}
summary: A three-item receipt with its total.
```
