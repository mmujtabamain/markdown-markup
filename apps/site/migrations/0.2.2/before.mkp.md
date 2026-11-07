# A reading card

```mkp
card "A card with a look of its own, a strip of steps, and a badge."
  in theme choice(calm|loud) = calm "how much it stands out"
  in steps list(text)
  column gap=m pad=m stroke=line radius=card
    text "This card is **\val{theme}**." tone=(if(theme == loud, bad, ink))
    zoom
      row gap=s wrap=false
        each k in 0..(len(steps) - 1) key=k
          column pad=s stroke=line radius=card width=fit
            text (steps[k]) wrap=false
    stack width=fit
      column pad=xl tint=muted radius=card
        text "a picture"
      column pad=xs fill=bad radius=pill self=start
        text "3" size=small tone=surface weight=bold
  project md = "A " + theme + " card."
```

```card
theme: loud
steps: [Read the question, Find the numbers, Write the sum, Check the units, Say the answer, Check it again]
summary: A loud card with six steps.
```
