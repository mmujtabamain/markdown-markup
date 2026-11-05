---
teaches: "one choice of a few, as a joined row of presses: press kind=option and a choice variable"
---
# Segmented control

A segmented control: a few options side by side, one chosen.

```mkp
segmented "A day, week or month switch, and what it changes."
  var span choice(day|week|month) = week
  column gap=m
    row gap=none
      press kind=option selected=(span == day)
        text "Day"
        @click set span=day
      press kind=option selected=(span == week)
        text "Week"
        @click set span=week
      press kind=option selected=(span == month)
        text "Month"
        @click set span=month
    text "Showing a \val{span}." tone=muted
  project md = "Showing a " + span + "."
```

```segmented
summary: A day, week or month switch.
```
