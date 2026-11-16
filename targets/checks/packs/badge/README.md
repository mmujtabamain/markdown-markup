# The badge pack (for the checks)

A tiny pack with externs, for the target checks (plan tab 15, "A pack with externs, for the
checks"): `badge/badge` is supplied by the pack on every target it supports, and `badge/seal` by
none, so every target shows its Markdown instead and reports it as missing (page 6).

- `badge.mkp`: the pack.
- `supplies.json`: what the pack supplies on each target. Headless targets (test, native) draw
  nothing, so for them the list is the implementation.
- `web.mjs`: the widget for @mkp/dom, which the web target's check harness registers.

Cases using it: targets/checks/cases/packs/.
