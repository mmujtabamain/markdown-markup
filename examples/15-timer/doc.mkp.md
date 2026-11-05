---
teaches: "a clock that counts seconds while the widget is on screen, with pause and start over"
gaps: [169]
---
# A boiled egg

```mkp
egg "A timer for a boiled egg: soft, medium or hard."
  in minutes num = 6 "how long to boil"
  t = clock "boiling"
  left = max(0, minutes 60 - t)
  done = left <= 0
  mins = floor(left / 60)
  secs = mod(floor(left), 60)
  pad = if(secs < 10, "0", "")
  column gap=s
    text "\val{mins}:\val{pad}\val{secs} left" font=heading if=(not done)
    text "Done: into cold water." tone=ok font=heading if=done
    meter value=(min(t, minutes 60)) max=(minutes 60) label="how far along" tone=(if(done, ok, accent))
    row gap=s
      press
        text "Pause"
        @click pause t
      press
        text "Go on"
        @click play t
      press emphasis=low
        text "Start over"
        @click reset t
  project md = "Boil for " + format(minutes, 0) + " minutes."
```

```egg
minutes: 6
summary: A six-minute egg timer.
```
