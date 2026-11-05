---
teaches: "the smallest inline definition"
---
# Hello

```mkp
greeting "A line of welcome with a name in it."
  in name text = "world" "who to greet"
  text "Hello, **\val{name}**!"
  project md = "Hello, **" + name + "**!"
```

```greeting
name: reader
summary: A greeting for the reader.
```
