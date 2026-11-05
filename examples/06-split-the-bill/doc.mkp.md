---
teaches: "a field and a range, values computed from them, text built-ins, a literal dollar sign and a decimal comma"
gaps: [82, 103]
---
# Split the bill

```mkp
split "A bill shared between friends, with a tip."
  in currency text = "\$" "the sign shown before amounts"
  var total text = "48,60"
  var people num = 3
  var tip num = 10
  amount = number(total)
  share = amount (1 + tip/100) / people
  column gap=m
    row gap=s align=center
      text "Bill"
      field value=total label="the bill" kind=text width=s
    row gap=s align=center
      text "People"
      range value=people min=1 max=12 step=1 label="how many share it"
      text "\val{people}"
    row gap=s align=center
      text "Tip"
      range value=tip min=0 max=25 step=5 label="tip, in percent"
      text "\val{tip}%"
    text "Each pays **\val{currency}\val{format(share, 2)}**." if=(amount == amount)
    text "Type the bill as a number, such as 48,60." tone=warn if=(not (amount == amount))
  project md = "A bill of " + currency + trim(total) + " split " + format(people, 0) + " ways with a " + format(tip, 0) + "% tip: " + currency + format(share, 2) + " each."
```

```split
summary: A bill split three ways with a tip.
```
