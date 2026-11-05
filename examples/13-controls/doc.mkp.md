---
teaches: "the controls a widget declares: slider, toggle, choice and steps (starting at none, with a track, playing a pace per step), a switch on state, and reveal"
gaps: [123, 124, 156]
---
# Brewing tea

```mkp
tea "Steps for a pot of tea, with the water and the strength chosen first."
  temp = slider 70..100 step=5 = 90 "water, in °C"
  strong = toggle "strong"
  kind = choice(green|black|herbal) "tea"
  step = steps 4 none=true track=true play=1s/step "step"
  minutes = if(kind == green, 2, if(kind == black, 4, 6)) + if(strong, 1, 0)
  column gap=m
    text "Water at \val{temp}°C, steep \val{minutes} minutes." tone=(if(kind == green and temp > 85, warn, ink))
    switch on=step
      case -1
        text "Press play, or step through."
      case 0
        text "Warm the pot."
      case 1
        text "Add a spoon of \val{kind} tea per cup."
      case 2
        text "Pour the water; wait \val{minutes} minutes."
      else
        text "Pour, and drink."
    press kind=plain
      text "Why not boiling?" tone=accent
      @click reveal why
    text "Boiling water scalds green tea and makes it bitter." id=why hidden
  project md = "1. Warm the pot.\n2. Add the tea.\n3. Pour the water at " + format(temp, 0) + "°C and wait " + format(minutes, 0) + " minutes.\n4. Pour, and drink."
```

```tea
summary: Four steps for a pot of tea.
```
