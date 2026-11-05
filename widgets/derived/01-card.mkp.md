---
teaches: "a surface with a title, its content and actions along the bottom: column, text and press"
---
# Card

A card: a padded, outlined column with a title, what it holds, and a row of actions.

```mkp
card "A card with a title, a body and actions."
  in title text
  in blurb text
  in action text = "Open"
  var opened bool = false
  column gap=m pad=l stroke=line radius=card shadow=raised width=fit
    text title weight=bold size=large
    text blurb tone=muted
    row gap=s
      press emphasis=high
        text action
        @click set opened=true
      press emphasis=low
        text "Later"
    text "Opened." tone=ok size=small if=opened
  project md = "**" + title + "**\n\n" + blurb
```

```card
title: Weekend in Lisbon
blurb: "Two nights, the tram to the castle and a pastel de nata in Belém."
action: Book
summary: A card for a weekend trip, with a booking button.
```
