---
teaches: "text and number entry, on one line or several, marked right or wrong"
---
# field

Text or number entry. Its `value` is a variable it writes; `tone` marks it right or wrong.

```mkp
fields "Entry fields of each kind."
  var name text = ""
  var age text = "31"
  var note text = ""
  column gap=m
    field value=name label="your name" placeholder="your name"
    row gap=s align=center
      field value=age kind=number label="age" width=s tone=(if(number(age) >= 18, ok, bad))
      text (if(number(age) >= 18, "old enough", "under 18")) size=small tone=muted
    field value=note label="a note" placeholder="a few lines" lines=3
  project md = "Three fields."
```

```fields
summary: A name, an age checked as it is typed, and a note of a few lines.
```
