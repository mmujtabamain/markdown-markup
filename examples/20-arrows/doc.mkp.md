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
    row gap=xl align=center justify=center
      each t in tables key=(t.ref)
        entity ref=(t.ref) name=(t.name) fields=(t.fields)
      each l in links key=(l.a + l.b)
        arrow from=(l.a) to=(l.b) label=(l.label) tail=one head=(if(l.many, many, ring))
      arrow from=customer to=product line=dashed layer=behind opacity=0.4
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
