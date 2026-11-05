---
teaches: "a press that lights up while the pointer is on it, and a click on empty space that clears a choice"
gaps: [125, 146]
---
# Pick a seat

```mkp
seats "A row of seats: point at one to see its price, press one to choose it, press the floor to clear."
  in prices list(num)
  var hover int = -1
  var chosen int = -1
  column gap=s pad=m stroke=line radius=card
    @click set chosen=-1
    row gap=xs
      each k in 0..(len(prices) - 1) key=k
        press kind=option selected=(chosen == k) label=("seat " + format(k + 1, 0))
          text (format(k + 1, 0)) tone=(if(hover == k, accent, ink))
          @enter set hover=k
          @leave set hover=-1
          @click set chosen=k
    text "Seat \val{hover + 1}: \val{format(at(prices, hover, 0), 2)}" if=(hover >= 0)
    text "You chose seat \val{chosen + 1}." if=(chosen >= 0)
  project md = join(map(range(0, len(prices) - 1), k => "- Seat " + format(k + 1, 0) + ": " + format(prices[k], 2)), "\n")
```

```seats
prices: [12, 12, 15, 15, 12]
summary: Five seats and their prices.
```
