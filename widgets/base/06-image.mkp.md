---
teaches: "a picture from the document's folder, with its description and a size"
---
# image

An asset beside the document (or in the pack), with the words that say what it shows.

```mkp
pictures "A picture at two sizes."
  row gap=m align=end
    image "plan.svg" "a flat's plan, small" size=s
    image "plan.svg" "a flat's plan, medium" size=m
  project md = "A plan at two sizes."
```

```pictures
summary: The same plan at a small and a medium size.
```
