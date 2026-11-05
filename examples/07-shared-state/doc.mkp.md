---
teaches: "a state block read by two blocks, so they move together"
---
# One temperature, two scales

```state
celsius = slider -20..40 step=1 = 18 "temperature in °C"
```

```mkp
thermometer "A bar filled to a temperature, in one scale."
  in t ref num "the temperature in °C"
  in scale choice(c|f) = c "which scale to show"
  shown = if(scale == c, t, t 9/5 + 32)
  row gap=m align=center wrap=false
    meter value=(t + 20) max=60 label="how warm" tone=(if(t > 25, warn, if(t < 0, info, accent))) grow
    text "\val{format(shown, 0)}°\val{upper(scale)}" font=mono lines=1
  project md = format(shown, 0) + "°" + upper(scale)
```

```thermometer
t: {ref: celsius}
scale: c
summary: The temperature in Celsius.
```

```thermometer
t: {ref: celsius}
scale: f
summary: The same temperature in Fahrenheit.
```
