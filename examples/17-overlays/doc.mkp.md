---
teaches: "the four overlays: a popover, a tooltip, a dialog and a menu"
---
# A recipe card

```mkp
recipe "A recipe's tools: a note, a hint, a confirmation and a menu of servings."
  var serves choice(two|four|six) = four
  var saved bool = false
  row gap=s align=center
    overlay mode=tooltip label="what a pinch is"
      text "a pinch?" tone=accent
      fill body
        text "As much as fits between finger and thumb."
    overlay mode=popover label="notes" id=notes
      icon name=info label="notes"
      fill body
        text "Use waxy potatoes: they keep their shape."
    overlay mode=menu label="serves"
      text "serves \val{serves}"
      fill body
        press kind=option selected=(serves == two)
          text "two"
          @click set serves=two
        press kind=option selected=(serves == four)
          text "four"
          @click set serves=four
        press kind=option selected=(serves == six)
          text "six"
          @click set serves=six
    # an overlay is its own press: what it holds is what the press shows
    overlay mode=dialog label="save the recipe" id=confirm
      text "Save…"
      fill body
        column gap=s
          text "Save this recipe to your book?"
          row gap=s
            press emphasis=high
              text "Save"
              @click set saved=true close confirm
            press
              text "Cancel"
              @click close confirm
    press kind=plain emphasis=low label="save, from elsewhere"
      text "or save it here" tone=muted size=small
      @click open confirm
    text "Saved." tone=ok if=saved
  project md = "Potato salad, serves " + serves + "."
```

```recipe
summary: Tools for a potato salad recipe.
```
