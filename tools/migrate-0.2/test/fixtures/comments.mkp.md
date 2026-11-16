---
# a comment in the front matter
title: Comments everywhere
---
# Release notes

<!-- An HTML comment at the top: for whoever edits the file. -->

See the [plan][p] and the [board][].

[p]: https://example.com/plan
[board]: https://example.com/board "The board"

```mkp
# what the tile is for, above the definition
tile "One number in a box."
  # the number, as text
  in value text
  in tone color = none "its tint"
  # how many times it was pressed
  var n int = 0

  # the box itself
  column pad=m stroke=line radius=card
    # the number, large
    text value size=large weight=bold

    press label="more"
      @click set n=(n + 1)
  project md = value
```

```stats
# the week in numbers
items:
  # deploys first
  - {label: Deploys, value: "42", change: "+12%"} # up from 37
  - {label: Rollbacks, value: "1", tone: bad}
summary: Two numbers from this week. # the alt text
```

```rows
items:
  - title: First
    # a note on one field
    note: Written one field a line
    state: done
summary: One row.
```

:::callout title="Watch out" tone=warn
Inside the callout.

<!--
A comment inside the callout,
over two lines.
-->
:::

```tile
value: "7"
summary: A tile.
```

<!-- a last comment -->
