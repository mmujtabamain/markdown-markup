---
teaches: "a run of inline Markdown: font, tone, weight, size, alignment, lines kept and clipped, capitals"
---
# text

A run of inline Markdown with inline maths. It takes the colour around it unless `tone` says otherwise.

```mkp
texts "The same words in each of text's looks."
  column gap=s
    text "A **sentence** with *emphasis* and $x^2$."
    text "muted, small" tone=muted size=small
    text "bold, large" weight=bold size=large
    text "mono" font=mono
    text "IN CAPITALS" caps size=small tone=muted
    text "ok" tone=ok
    text "a long line that is cut at one line with an ellipsis, however much more it says after this" lines=1 clip
  project md = "Text in its looks."
```

```texts
summary: One sentence in each of text's looks.
```
