# The badge pack (for the checks)

A tiny pack with externs, for the target checks (plan tab 15, "A pack with externs, for the
checks"): `badge/badge` is supplied by the pack on every target it supports, and `badge/seal` by
none, so every target shows its Markdown instead and reports it as missing (page 6).

- `badge.xtpack`: the pack.
- `supplies.json`: what the pack supplies on each target. Headless targets (test, native) draw
  nothing, so for them the list is the implementation.
- `web.mjs`: the widget for @extended-mark/dom, which the web target's check harness registers.
- `view.mjs`: the widget as an element, for the targets drawn from @extended-mark/view (React, Vue, Svelte,
  Solid and Angular, and their live targets), whose check harnesses register it.

Cases using it: targets/checks/cases/packs/.
