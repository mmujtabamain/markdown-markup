---
teaches: "a value on a track, its step and its label"
---
# range

A value on a track: drag it, or use the arrow keys. Its `value` is a variable it writes.

```mkp
ranges "Two tracks, one stepped."
  var v num = 0.4
  var k num = 3
  grid cols=[auto, 1fr, 4ch] gap=m align=center
    text "volume"
    range value=v min=0 max=1 step=0.05 label="volume"
    text "\val{format(v, 2)}" font=mono
    text "stars"
    range value=k min=1 max=5 step=1 label="stars"
    text "\val{k}" font=mono
  project md = "Volume " + format(v, 2) + ", " + format(k, 0) + " stars."
```

```ranges
summary: A volume track and a stepped one for stars.
```
