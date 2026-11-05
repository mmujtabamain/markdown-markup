---
teaches: "a thematic break between parts"
---
# divider

Markdown's `---`, between two parts of a page.

```mkp
parts "Two parts with a divider between them."
  column gap=s
    text "The first part."
    divider
    text "The second part."
  project md = "The first part.\n\n---\n\nThe second part."
```

```parts
summary: Two parts divided by a rule.
```
