---
teaches: "a quotation and the five alerts"
---
# quote

Markdown's quote, and the alerts GitHub draws: note, tip, important, warning and caution.

> A plain quotation.

> [!NOTE]
> A note.

> [!TIP]
> A tip.

> [!IMPORTANT]
> Something important.

> [!WARNING]
> A warning.

> [!CAUTION]
> A caution.

```mkp
quotes "A warning built by the widget."
  quote alert=warning
    text "Built by the quote widget, as an alert."
  project md = "> [!WARNING]\n> Built by the quote widget."
```

```quotes
summary: A warning alert made by the quote widget.
```
