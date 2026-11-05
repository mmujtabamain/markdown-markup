---
teaches: "every kind of press, an answer row's letter, how much a press stands out, and a meter"
gaps: [59, 75, 76, 77, 84]
---
# Presses

```mkp
presses "Each kind of press, and a meter that counts the presses."
  var count int = 0
  var mode choice(day|night) = day
  var on bool = false
  var picked int = -1
  column gap=m
    row gap=s align=center
      press emphasis=high
        text "Press me"
        @click set count=(count + 1)
      press emphasis=low label="press quietly"
        icon name=plus
        @click set count=(count + 1)
      press kind=plain
        text "a plain press"
        @click set count=(count + 1)
    row gap=xs
      press kind=tab selected=(mode == day)
        text "Day"
        @click set mode=day
      press kind=tab selected=(mode == night)
        text "Night"
        @click set mode=night
    row gap=s align=center
      press kind=toggle selected=on
        text "Toggle"
        @click set on=(not on)
      press kind=switch selected=on label="the same, as a switch"
        @click set on=(not on)
    column gap=xs
      each k in 0..2 key=k
        press kind=radio mark=(at(["A", "B", "C"], k, "")) selected=(picked == k)
          text (at(["Red", "Green", "Blue"], k, ""))
          @click set picked=k
    meter value=(min(count, 10)) max=10 label="presses, out of 10"
  project md = "Pressed " + format(count, 0) + " times."
```

```presses
summary: Every kind of press, with a count of presses.
```
