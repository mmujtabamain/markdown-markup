---
teaches: "a code block, its current line and marked lines"
---
# code

A code block. `line` marks the current line; `marks` colour lines (or columns of them) with a note.

```python
def mean(xs):
    return sum(xs) / len(xs)
```

```mkp
listing "A short program with its current line and a marked one."
  code "total = 0\nfor x in [3, 4, 5]:\n    total = total + x\nprint(total)" lang="python" line=3 marks=[{line: 4, tone: ok, note: "prints 12", from: 0, to: 0}]
  project md = "A program that sums a list."
```

```listing
summary: A four-line program, its third line current and its last marked.
```
