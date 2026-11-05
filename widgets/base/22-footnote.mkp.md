---
teaches: "a footnote and the mark that leads to it, numbered in order"
---
# footnote

A footnote. Its mark in the text is numbered by the order it is first used.

Markdown's own: a claim[^m] and another.[^n]

[^m]: The first note.
[^n]: The second.

```mkp
noted "A footnote built by the widget."
  column gap=s
    text "A sentence with a note.[^w]"
    footnote "w"
      text "The note, made by the footnote widget."
  project md = "A sentence with a note."
```

```noted
summary: A sentence and its footnote.
```
