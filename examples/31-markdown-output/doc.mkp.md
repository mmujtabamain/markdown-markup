---
teaches: "what a reader without MKP gets: project md with a table and a details block, project mermaid for a diagram, and an answer left out when the Markdown is built without answers"
gaps: [166]
---
# The coast walk

```mkp
trip "A walk's legs as a table, its route as a diagram, and a question on it."
  in legs list({from: text, to: text, km: num})
  in question text
  in answer text answer "the right answer, kept out of Markdown built without answers"
  total = sum(map(legs, l => l.km))
  column gap=m
    table head=["From", "To", "km"] rows=(map(legs, l => [l.from, l.to, format(l.km, 1)])) align=[left, left, right]
    text "\val{format(total, 1)} km in all." tone=muted
    text question weight=bold
  project md = "| From | To | km |\n|---|---|---:|\n" + join(map(legs, l => "| " + l.from + " | " + l.to + " | " + format(l.km, 1) + " |"), "\n") + "\n\n" + question + if(answers, "\n\n:::details \"Answer\"\n" + answer + "\n:::", "")
  project mermaid = "graph LR\n" + join(map(legs, l => "  " + replace(l.from, " ", "_") + " -->|" + format(l.km, 1) + " km| " + replace(l.to, " ", "_")), "\n")
```

```trip
legs:
  - {from: Harbour, to: Lighthouse, km: 3.5}
  - {from: Lighthouse, to: Cove, km: 2.2}
  - {from: Cove, to: Harbour, km: 4.1}
question: Which leg is the longest?
answer: Cove to Harbour, 4.1 km.
summary: A three-leg coast walk and a question about it.
```
