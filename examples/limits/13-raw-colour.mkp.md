---
fails: "a raw colour: styles take token names, so dark mode and the host's theme hold"
expect: {code: mkp.style-token, line: 9}
---
# Limit: a raw colour

```mkp
alarm "A red box."
  column pad=m fill="#ff0000"
    text "Alarm"
  project md = "Alarm"
```

```alarm
summary: An alarm.
```
