---
teaches: "a tooltip, a popover, a menu and a dialog, each anchored to what opens it"
---
# overlay

Something that opens over the page, anchored to what opens it: `tooltip`, `popover`, `menu` or `dialog`.

```mkp
overlays "One of each overlay."
  var size choice(small|medium|large) = medium
  var kept bool = false
  row gap=s align=center
    overlay mode=tooltip label="what this is"
      text "hover me" tone=accent
      fill body
        text "A tooltip: a few words."
    overlay mode=popover label="more"
      icon name=info label="more"
      fill body
        text "A popover holds a little more, and stays until it is closed."
    overlay mode=menu label="size"
      text "\val{size}"
      fill body
        press kind=option selected=(size == small)
          text "small"
          @click set size=small
        press kind=option selected=(size == medium)
          text "medium"
          @click set size=medium
        press kind=option selected=(size == large)
          text "large"
          @click set size=large
    overlay mode=dialog label="keep it" id=keep
      text "Keep…"
      fill body
        column gap=m
          text "Keep this one?"
          row gap=s
            press emphasis=high
              text "Keep"
              @click set kept=true close keep
            press
              text "Cancel"
              @click close keep
    text "Kept." tone=ok if=kept
  project md = "A tooltip, a popover, a menu and a dialog."
```

```overlays
summary: A tooltip, a popover, a menu of sizes and a confirming dialog.
```
