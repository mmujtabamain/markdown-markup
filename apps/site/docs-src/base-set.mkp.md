---
description: The base set every MKP widget is built from - 25 widgets for layout, text, controls, the host's shell and drawing - with a link to each in the examples.
---
# The base set

MKP ships no widgets of its own beyond these. Everything else, in a document or a pack, is
composed from them. Each opens in the examples, alone, in its states.

## Layout

| Widget | What it does |
| --- | --- |
| [`column`](../examples/#e=base:01-column) | Children one below another: gap, padding, alignment, a border and a wash. |
| [`row`](../examples/#e=base:02-row) | Children side by side: alignment, wrapping, or scrolling sideways. |
| [`grid`](../examples/#e=base:03-grid) | Children in columns: tracks such as `[auto, 1fr]`, a cell spanning two. |
| [`stack`](../examples/#e=base:04-stack) | Children drawn one over another, the last on top. |

## Text and pictures

| Widget | What it does |
| --- | --- |
| [`text`](../examples/#e=base:05-text) | A run of inline Markdown: font, tone, weight, size, lines kept or clipped. |
| [`image`](../examples/#e=base:06-image) | A picture from the document's folder, with its description. |
| [`icon`](../examples/#e=base:07-icon) | A symbol from a fixed set. |

## Controls

| Widget | What it does |
| --- | --- |
| [`press`](../examples/#e=base:08-press) | Anything clickable: a button, a tab, a toggle, a switch, an answer row. |
| [`range`](../examples/#e=base:09-range) | A value on a track. |
| [`meter`](../examples/#e=base:10-meter) | How far along something is. |
| [`field`](../examples/#e=base:11-field) | Text or number entry, marked right or wrong. |
| [`overlay`](../examples/#e=base:12-overlay) | A tooltip, popover, menu or dialog, anchored to what opens it. |

## Drawing

| Widget | What it does |
| --- | --- |
| [`canvas`](../examples/#e=base:13-canvas) | A coordinate space in layers: paths, circles, labels, and handles the reader drags. |

`arrow from=a to=b` joins two elements by id, and with `gfx@1` a canvas also draws `pixels` and
`mesh`.

## Markdown blocks

These are what Markdown itself becomes, so a document's prose is the base set too.

| Widget | What it does |
| --- | --- |
| [`paragraph`](../examples/#e=base:14-paragraph) | A paragraph of inline Markdown. |
| [`heading`](../examples/#e=base:15-heading) | Headings. |
| [`list`](../examples/#e=base:16-list) | Bulleted, numbered and task lists. |
| [`quote`](../examples/#e=base:17-quote) | A quotation, and the five alerts. |
| [`code`](../examples/#e=base:18-code) | A code block, with a current line and marked lines. |
| [`math`](../examples/#e=base:19-math) | A display formula, with parts marked and noted. |
| [`divider`](../examples/#e=base:20-divider) | A break between parts. |
| [`table`](../examples/#e=base:21-table) | A table of inline Markdown cells. |
| [`footnote`](../examples/#e=base:22-footnote) | A footnote and the mark that leads to it. |

## The host's shell

| Widget | What it does |
| --- | --- |
| [`frame`](../examples/#e=base:23-frame) | A widget's shell: title, actions, a status bar, drawers, full screen. |
| [`pane`](../examples/#e=base:24-pane) | Titled columns that scroll on their own, side by side. |
| [`zoom`](../examples/#e=base:25-zoom) | A view the reader unlocks to zoom and pan. |

## Composed from them

The examples also show everyday widgets built from the base set, each a few lines long: [card](../examples/#e=derived:01-card), [tabs](../examples/#e=derived:02-tabs), [accordion](../examples/#e=derived:03-accordion), [segmented](../examples/#e=derived:04-segmented), [stat](../examples/#e=derived:05-stat), [stepper](../examples/#e=derived:06-stepper), [badges](../examples/#e=derived:07-badges), [rating](../examples/#e=derived:08-rating), [checklist](../examples/#e=derived:09-checklist), [pagination](../examples/#e=derived:10-pagination).
Copy one as a start.
