---
teaches: "a table of inline Markdown cells, aligned by column"
---
# table

Markdown's table. The widget takes its head, its rows and each column's alignment.

| Quantity | Symbol | Value |
| :-- | :-: | --: |
| Euler's number | $e$ | 2.71828 |
| Golden ratio | $\varphi$ | 1.61803 |

```mkp
prices "A price list built by the widget."
  table head=["Item", "Price"] rows=[["Bread", "3.20"], ["Cheese", "6.75"]] align=[left, right]
  project md = "| Item | Price |\n|---|---:|\n| Bread | 3.20 |\n| Cheese | 6.75 |"
```

```prices
summary: Two items and their prices.
```
