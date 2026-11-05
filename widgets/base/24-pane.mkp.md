---
teaches: "titled columns of a stage that scroll on their own, side by side"
---
# pane

A titled column of a stage. Panes side by side are divided by a rule, and each scrolls on its own.

```mkp
panes "Two panes in a frame."
  frame kind="Inbox" title="Messages" height=s
    row align=stretch gap=none
      pane title="Folders" note="3" grow basis=s
        column gap=xs pad=m
          text "Inbox"
          text "Sent"
          text "Archive"
      pane title="Inbox" note="12" grow basis=m
        column gap=s pad=m
          each k in 1..12 key=k
            text "Message \val{k}"
        fill footer
          text "12 messages" size=small tone=muted
  project md = "Folders and the inbox, side by side."
```

```panes
summary: A folders pane beside an inbox pane that scrolls.
```
