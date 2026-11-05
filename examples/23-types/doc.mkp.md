---
teaches: "named records with defaults, record literals typed by what they must be (a colour, an icon), none, and a recursive tree"
gaps: [44, 67, 101, 117, 127, 132, 138, 155]
---
# Repainting the hall

```mkp
type task = {title: text, tone: color = muted, icon: iconname = dot, done: bool = false}
type step = {name: text, kids: list(step) = []}

fn shown(t: task): task = if(t.done, {title: t.title, tone: ok, icon: check, done: true}, t)
fn count(s: step): int = 1 + sum(map(s.kids, k => count(k)))

part branch "A step and the steps under it, indented."
  in at step
  column gap=xs
    text at.name
    column gap=xs pad=s edge=left stroke=line if=(len(at.kids) > 0)
      each k in at.kids key=k.name
        branch at=k

jobs "A to-do list whose items take their colours and icons from a named type, and the plan as a tree."
  in items list(task)
  in plan step
  in highlight color = none "a wash behind the list, or none"
  column gap=m
    column gap=xs pad=s tint=highlight radius=card
      each t in items key=t.title
        row gap=s align=center
          icon name=(shown(t).icon) tone=(shown(t).tone)
          text t.title tone=(shown(t).tone)
    branch at=plan
    text "\val{count(plan)} steps in all." tone=muted size=small
  project md = join(map(items, t => "- [" + if(t.done, "x", " ") + "] " + t.title), "\n")
```

```jobs
items:
  - {title: Buy paint, done: true}
  - {title: Sand the door, tone: warn, icon: alert}
  - {title: Paint two coats}
plan:
  name: Repaint the hall
  kids:
    - name: Prepare
      kids:
        - {name: Move the furniture}
        - {name: Tape the edges}
    - {name: Paint}
    - {name: Clean up}
summary: Three jobs and the plan for repainting a hall.
```
