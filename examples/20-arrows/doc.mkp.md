---
teaches: "arrows between boxes: their ends, a dashed line, a quiet one drawn behind, labels, and arrows inside a zoom"
gaps: [52, 93, 100, 113, 122, 126, 129, 140, 141, 143]
---
# Orders and customers

```mkp
part entity "A box with a name and its fields, which arrows join."
  in ref text
  in name text
  in fields list(text)
  column id=(ref) pad=s gap=xs stroke=ink radius=card width=fit
    text name weight=bold
    each f in fields key=f
      text f font=mono size=small

schema "Three tables and how they relate, as an ER diagram."
  in tables list({ref: text, name: text, fields: list(text)})
  in links list({a: text, b: text, label: text, many: bool})
  zoom max=3
    # the tables with a lane between each two, wide enough for a link's label, and a lane under
    # the middle one, so the quiet line from the first to the last goes round it
    grid cols=[auto, 9ch, auto, 9ch, auto] gap=none align=center width=fit
      each k in 0..(len(tables) - 1) key=k
        entity ref=(tables[k].ref) name=(tables[k].name) fields=(tables[k].fields)
        column if=(k < len(tables) - 1)
      column span=2
      column id=under pad=l
      each l in links key=(l.a + l.b)
        arrow from=(l.a) to=(l.b) label=(l.label) tail=one head=(if(l.many, many, ring))
      arrow from=customer to=product via=(["under"]) route=down line=dashed layer=behind opacity=0.5
  project md = join(map(links, l => "- " + l.a + " → " + l.b + ": " + l.label), "\n")
```

```schema
tables:
  - {ref: customer, name: Customer, fields: [id, name, email]}
  - {ref: order, name: Order, fields: [id, customer_id, placed]}
  - {ref: product, name: Product, fields: [id, title, price]}
links:
  - {a: customer, b: order, label: places, many: true}
  - {a: order, b: product, label: holds, many: false}
summary: Customers place orders, and orders hold products.
```
