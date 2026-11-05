---
teaches: "tasks to tick, with how many are done: press kind=check and a meter"
---
# Checklist

A checklist: tasks to tick off, and a meter of how many are done.

```mkp
checklist "Tasks to tick, and how far along they are."
  in tasks list(text)
  var done list(int) = []
  column gap=s
    each k in 0..(len(tasks) - 1) key=k
      press kind=check selected=(indexof(done, k) >= 0)
        text (tasks[k])
        @click set done=(if(indexof(done, k) >= 0, filter(done, d => d != k), done + [k]))
    row gap=m align=center
      meter value=(len(done)) max=(len(tasks)) label="done" tone=ok grow
      text "\val{len(done)} of \val{len(tasks)}" size=small font=mono
  project md = join(map(tasks, t => "- [ ] " + t), "\n")
```

```checklist
tasks: [Buy paint, Tape the edges, First coat, Second coat]
summary: Four jobs for painting a room, to tick off.
```
