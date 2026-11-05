---
teaches: "how far along something is: a bar filled to a value, in a tone"
---
# meter

A bar filled to `value` out of `max`, in a tone.

```mkp
meters "Meters in tones, beside their values."
  grid cols=[1fr, 5ch] gap=m align=center
    meter value=0.2 label="a fifth"
    text "20%" font=mono size=small
    meter value=0.5 label="a half" tone=info
    text "50%" font=mono size=small
    meter value=0.8 label="four fifths" tone=warn
    text "80%" font=mono size=small
    meter value=1 label="done" tone=ok
    text "100%" font=mono size=small
  project md = "Four meters."
```

```meters
summary: Four meters at a fifth, a half, four fifths and full.
```
