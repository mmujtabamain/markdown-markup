---
teaches: "a widget's shell: kind and title, actions, a status bar, drawers and full screen"
---
# frame

A widget's shell: what it is and its title, its own switches, a bar along the bottom, and drawers.

```mkp
framed "A frame with every part filled."
  var on bool = false
  frame kind="Report" title="Build times" status=("Median: **4m 01s**" + if(on, " (with tests)", ""))
    column pad=m
      text "The stage: anything at all." tone=muted
    fill actions
      press kind=toggle selected=on label="with tests"
        text "tests"
        @click set on=(not on)
    fill about
      text "Times are wall-clock, from push to green."
    fill details
      table head=["Day", "Median"] rows=[["Mon", "4m 10s"], ["Tue", "3m 52s"]]
  project md = "Build times: a median of 4m 01s."
```

```framed
summary: A report's frame with a switch, a status, and about and details drawers.
```
