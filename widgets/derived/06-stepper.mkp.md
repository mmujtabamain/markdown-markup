---
teaches: "a task in steps, with where you are, back and next: steps, meter and if="
---
# Stepper

A stepper: numbered steps, the current one marked, with back and next.

```mkp
stepper "A three-step checkout."
  in steps list(text)
  var at int = 0
  column gap=m
    row gap=s align=center
      each k in 0..(len(steps) - 1) key=k
        row gap=s align=center pad=s radius=pill tint=(if(k == at, info, none)) stroke=(if(k == at, none, line))
          icon name=(if(k < at, check, none)) size=small tone=ok
          text "\val{k + 1}. \val{steps[k]}" weight=(if(k == at, bold, regular)) tone=(if(k <= at, ink, muted))
    meter value=(at + 1) max=(len(steps)) label="how far along"
    row gap=s
      press disabled=(at == 0)
        text "Back"
        @click set at=(at - 1)
      press emphasis=high disabled=(at == len(steps) - 1)
        text "Next"
        @click set at=(at + 1)
  project md = join(map(range(0, len(steps) - 1), k => format(k + 1, 0) + ". " + steps[k]), "\n")
```

```stepper
steps: [Basket, Delivery, Payment]
summary: "A checkout in three steps: basket, delivery and payment."
```
