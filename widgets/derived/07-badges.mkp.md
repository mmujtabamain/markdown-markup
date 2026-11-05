---
teaches: "short words on pills, in tones, some with an icon: row, radius=pill and tint"
---
# Badges and tags

Badges and tags: a word on a pill, washed in a tone.

```mkp
part tag "A word on a pill."
  in text text
  in tone color = muted
  in icon iconname = none
  row gap=xs pad=s radius=pill tint=tone align=center width=fit
    icon name=icon size=small tone=tone
    text text size=small tone=tone weight=medium

tags "Tags in tones."
  row gap=s
    tag text="new" tone=info
    tag text="in stock" tone=ok icon=check
    tag text="low stock" tone=warn icon=alert
    tag text="sold out" tone=bad
    tag text="vegan"
  project md = "new, in stock, low stock, sold out, vegan"
```

```tags
summary: Five tags, from new to sold out.
```
