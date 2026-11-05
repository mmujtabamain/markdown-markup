---
teaches: "a widget's shell from the host: a frame with its status, actions and drawers, panes side by side, and a zoom behind its lock"
gaps: [74, 92, 145, 147]
---
# A floor plan

```mkp
plan "A flat's floor plan beside the list of its rooms, in a frame."
  in rooms list({name: text, area: num})
  at = steps (len(rooms)) "room"
  total = sum(map(rooms, r => r.area))
  frame kind="Plan" title="Flat on Rua Augusta" status=("**\val{rooms[at].name}**, \val{format(rooms[at].area, 0)} m² of \val{format(total, 0)} m²") height=m
    row align=stretch gap=none
      pane title="Rooms" note=("\val{len(rooms)}") grow basis=s
        column gap=xs
          each k in 0..(len(rooms) - 1) key=k
            text (rooms[k].name) weight=(if(k == at, bold, regular)) tone=(if(k == at, accent, ink))
        fill footer
          text "\val{format(total, 0)} m² in all" tone=muted size=small
      pane title="Plan" grow basis=m
        zoom max=3
          grid cols=3 gap=xs
            each k in 0..(len(rooms) - 1) key=k
              column pad=m stroke=(if(k == at, accent, line)) radius=card
                text (rooms[k].name) size=small
    fill actions
      icon name=expand label="the plan, full screen"
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
