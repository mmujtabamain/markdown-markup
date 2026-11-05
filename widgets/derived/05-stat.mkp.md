---
teaches: "a number with its label and its change: text styles, an icon and a tone"
---
# Stat

A stat: a label, a large number, and how it changed, coloured by which way.

```mkp
part stat "A labelled number and its change."
  in label text
  in value text
  in change num "per cent, up or down"
  column gap=xs pad=m stroke=line radius=card
    text label caps size=small tone=muted
    text value size=large weight=bold font=mono
    row gap=xs align=center
      icon name=(if(change >= 0, up, down)) tone=(if(change >= 0, ok, bad)) size=small
      text "\val{format(abs(change), 1)}% on last week" size=small tone=(if(change >= 0, ok, bad))

stats "Three stats side by side."
  grid cols=3 gap=m
    stat label="Visitors" value="2,410" change=12.5
    stat label="Orders" value="186" change=-3.2
    stat label="Revenue" value="4,920" change=8
  project md = "Visitors 2,410 (+12.5%), orders 186 (−3.2%), revenue 4,920 (+8%)."
```

```stats
summary: Visitors, orders and revenue for a week, with their changes.
```
