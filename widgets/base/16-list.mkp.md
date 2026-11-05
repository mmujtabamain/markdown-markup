---
teaches: "bulleted, numbered and task lists"
---
# list

Markdown's lists: bulleted, numbered from any start, and task lists with their boxes.

- a bullet
- another, with a [link](https://example.org)

1. first
2. second

- [x] a task that is done
- [ ] one that isn't

```mkp
lists "A numbered list from 3, built by the widget."
  list ordered=true start=3
    item
      text "three"
    item
      text "four"
  project md = "3. three\n4. four"
```

```lists
summary: A numbered list starting at three.
```
