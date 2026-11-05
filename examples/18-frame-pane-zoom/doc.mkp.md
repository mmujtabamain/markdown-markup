---
teaches: "a widget's shell from the host: a frame with its status, actions and drawers, panes side by side, and a zoom behind its lock"
gaps: [74, 92, 145, 147]
---
# A floor plan

```mkp
plan "A flat's floor plan beside the list of its rooms, in a frame."
  in rooms list({name: text, area: num})
  at = steps (len(rooms)) "room"
  var feet bool = false
  total = sum(map(rooms, r => r.area))
  fn area(m2: num): text = if(feet, format(m2 10.764, 0) + " ft²", format(m2, 0) + " m²")
  frame kind="Plan" title="Flat on Rua Augusta" status=("**\val{rooms[at].name}**, \val{area(rooms[at].area)} of \val{area(total)}")
    row align=stretch gap=none
      pane title="Rooms" note=("\val{len(rooms)}") grow basis=s
        column gap=xs pad=m
          each k in 0..(len(rooms) - 1) key=k
            row justify=between gap=m
              text (rooms[k].name) weight=(if(k == at, bold, regular))
              text (area(rooms[k].area)) font=mono tone=muted
        fill footer
          text "\val{area(total)} in all" tone=muted size=small
      pane title="From above" grow basis=m
        zoom max=3
          column gap=s pad=m
            image "plan.svg" "the flat from above" size=m
            grid cols=3 gap=xs
              each k in 0..(len(rooms) - 1) key=k
                column pad=s stroke=(if(k == at, accent, line)) radius=card
                  text (rooms[k].name) size=small
    fill actions
      press kind=toggle selected=feet label="areas in square feet"
        text "ft²"
        @click set feet=(not feet)
    fill about
      text "Areas are measured wall to wall."
    fill details
      table head=["Room", "m²"] rows=(map(rooms, r => [r.name, format(r.area, 0)]))
  project md = join(map(rooms, r => "- " + r.name + ": " + format(r.area, 0) + " m²"), "\n")
```

```plan
rooms:
  - {name: Living room, area: 24}
  - {name: Kitchen, area: 9}
  - {name: Bedroom, area: 14}
  - {name: Bathroom, area: 5}
  - {name: Hall, area: 6}
  - {name: Study, area: 8}
summary: A six-room flat and the area of each room.
```
