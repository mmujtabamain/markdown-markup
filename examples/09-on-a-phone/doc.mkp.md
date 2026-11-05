---
teaches: "a layout that changes with the reader's width: wrapping with a basis, width, a least width with sideways scroll, and centring that keeps its start"
gaps: [29, 30, 120, 142, 149, 160]
---
# Plans for the week

```mkp
type plan = {day: text, what: text}

part card "A day and its plan."
  in item plan
  column pad=m gap=xs stroke=line radius=card
    text item.day weight=bold
    text item.what tone=muted

week "A week of plans: a grid on a wide screen, a list on a phone."
  in plans list(plan)
  column gap=m
    text "Seen at \val{width} width." tone=muted size=small
    row gap=s wrap if=(width != narrow)
      each p in plans key=p.day
        column grow basis=s
          card item=p
    column gap=s if=(width == narrow)
      each p in plans key=p.day
        card item=p
    row gap=s wrap=false scroll=x minwidth=l justify=center
      each p in plans key=p.day
        text p.day font=mono
  project md = join(map(plans, p => "- **" + p.day + ":** " + p.what), "\n")
```

```week
plans:
  - {day: Mon, what: Swim before work}
  - {day: Tue, what: Market for vegetables}
  - {day: Wed, what: Call the plumber}
  - {day: Thu, what: Cinema with Ana}
  - {day: Fri, what: Bake bread}
summary: Five days of plans, laid out for the screen they are read on.
```
