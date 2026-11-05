---
teaches: "headings from level 2 down, as Markdown and as the widget"
---
# heading

Markdown's headings. The widget takes a `level` and its text.

```mkp
heads "Headings at three levels."
  column gap=xs
    heading 2 "Level two"
    heading 3 "Level three"
    heading 4 "Level four"
  project md = "Headings."
```

```heads
summary: Headings at levels two, three and four.
```
