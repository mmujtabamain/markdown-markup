---
teaches: "a symbol from the fixed set: tones, sizes, and none, which draws nothing"
---
# icon

A symbol from a fixed set, drawn in the provider's own icon style.

```mkp
icons "A handful of icons, in tones and sizes."
  column gap=s
    row gap=m align=center
      icon name=check tone=ok
      icon name=alert tone=warn
      icon name=cross tone=bad
      icon name=info tone=info
      icon name=star
    row gap=m align=center
      icon name=star size=small
      icon name=star
      icon name=star size=large
      icon name=none
      text "(none draws nothing)" size=small tone=muted
  project md = "Icons."
```

```icons
summary: Icons in four tones and three sizes.
```
