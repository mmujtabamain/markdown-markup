---
teaches: "pages of a list, with numbered page presses: slice, each and press kind=toggle"
---
# Pagination

Pagination: a long list shown a page at a time, with the page numbers to press.

```mkp
paged "A list of cities, five at a time."
  in items list(text)
  in per int = 5
  var page int = 0
  pages = ceil(len(items) / per)
  column gap=m
    column gap=xs
      each c in slice(items, page per, page per + per) key=c
        text c
    row gap=xs align=center
      press emphasis=low disabled=(page == 0) label="previous page"
        icon name=prev
        @click set page=(page - 1)
      each k in 0..(pages - 1) key=k
        press kind=toggle selected=(page == k) label=("page " + format(k + 1, 0))
          text "\val{k + 1}"
          @click set page=k
      press emphasis=low disabled=(page == pages - 1) label="next page"
        icon name=next
        @click set page=(page + 1)
  project md = join(items, ", ")
```

```paged
items: [Lisbon, Porto, Madrid, Seville, Paris, Lyon, Rome, Milan, Oslo, Bergen, Quito, Lima]
summary: Twelve cities, five to a page.
```
