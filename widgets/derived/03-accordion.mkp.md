---
teaches: "sections that open and close on a press, one at a time: press, icon and a list variable"
---
# Accordion

An accordion: each section's title is a press that opens it; opening one closes the others.

```mkp
accordion "Questions and answers, one open at a time."
  in items list({q: text, a: text})
  var open int = -1
  column gap=none stroke=line radius=card
    each k in 0..(len(items) - 1) key=k
      column gap=s pad=m edge=top stroke=(if(k == 0, none, line))
        press kind=plain label=(items[k].q)
          row gap=s align=center justify=between width=fill
            text (items[k].q) weight=medium
            icon name=(if(open == k, up, down)) tone=muted size=small
          @click set open=(if(open == k, -1, k))
        text (items[k].a) tone=muted if=(open == k)
  project md = join(map(items, i => "**" + i.q + "** " + i.a), "\n\n")
```

```accordion
items:
  - {q: "When do you open?", a: "Every day from seven, Sundays from eight."}
  - {q: "Do you deliver?", a: "Within two kilometres, for orders over 15."}
  - {q: "Can I order a cake?", a: "Yes, two days ahead."}
summary: Three questions about a bakery, each opening its answer.
```
