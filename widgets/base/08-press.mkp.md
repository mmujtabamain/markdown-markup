---
teaches: "anything clickable: a button at three emphases, a tab, a toggle, a switch, an answer row, a plain press"
---
# press

Anything clickable and focusable. Its `kind` says what it is; `emphasis` how much it stands out.

```mkp
presses "Every kind of press, wired to one count."
  var n int = 0
  var on bool = false
  var tab int = 0
  var pick int = -1
  column gap=m
    row gap=s align=center
      press emphasis=high
        text "High"
        @click set n=(n + 1)
      press
        text "Normal"
        @click set n=(n + 1)
      press emphasis=low
        text "Low"
        @click set n=(n + 1)
      press label="add one"
        icon name=plus
        @click set n=(n + 1)
      press disabled=true
        text "Disabled"
      text "pressed \val{n} times" size=small tone=muted
    row gap=xs
      each k in 0..2 key=k
        press kind=tab selected=(tab == k)
          text (at(["Day", "Week", "Month"], k, ""))
          @click set tab=k
    row gap=m align=center
      press kind=toggle selected=on
        text "Toggle"
        @click set on=(not on)
      press kind=switch selected=on label="the same, as a switch"
        @click set on=(not on)
      press kind=check selected=on
        text "a check row"
        @click set on=(not on)
    column gap=xs
      each k in 0..1 key=k
        press kind=radio mark=(at(["A", "B"], k, "")) selected=(pick == k)
          text (at(["An answer", "Another answer"], k, ""))
          @click set pick=k
  project md = "Pressed " + format(n, 0) + " times."
```

```presses
summary: Buttons, tabs, a toggle, a switch, a check row and answer rows.
```
