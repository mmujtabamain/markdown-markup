# Extended Mark's web target

@extended-mark/runtime with @extended-mark/dom's widgets in a real Chromium (`XTMD_CHROMIUM`, or `/usr/bin/chromium`;
none is downloaded), driven two ways:

- **Extended Mark's checks**: `xtmd target check web` runs every case in `targets/checks/cases/` through
  `check_adapter.mjs` (`target.yaml`'s `check_adapter:`), which loads each page with `harness.mjs`.
- **The widget contracts**: omnicui checks each core extern widget's behaviour, keyboard and roles
  against its contract in `targets/checks/contracts/` (`core.press`, `core.slider` …), through
  `omnicui_adapter.mjs`. Run them from the repository's root with
  `"$(external/omnicui/fetch.sh)" --project targets/checks check web` (or `npm test` here, which does the same in
  `test/omnicui.test.mjs`, with the binary `external/omnicui/fetch.sh` gives it).

## The omnicui adapter

omnicui's target is `targets/checks/targets/web/target.yaml`: its `stubs:` writes every contract to
`targets/checks/.omnicui/web-contracts.json`, where the adapter reads each one's prop defaults, and
its `adapter:` runs `omnicui_adapter.mjs`. For each `mount` the adapter:

- writes a page that calls the one widget (`omnicui/source.mjs`), its inputs, slots and events read
  from the IR's declarations: props become literals by each input's type (`"TOGGLE"` →
  `press_kind.TOGGLE`, `null` or `"NONE"` → `opt.NONE`, JSON for lists and records, `"0..10 step
  0.5"` for a range), each `mut` input is bound to a `$state` field, each event to a handler, and a
  prop named after a slot fills it with a label (a paragraph in a block's body). A widget that has
  to sit in another is mounted in it: an item in a bullets, a layer in a canvas, a shape in a
  canvas's layer, a spot in a plane, a cell in a grid, a sizing in a flex row;
- builds it with the `xtmd` binary (the IR is cached per page, gzipped, in the system's temporary
  folder, one folder per compiler and core) and loads it with `omnicui/harness.mjs`, at the
  viewport and colour scheme asked for (`dark` is the page theme `DARK`);
- reports the widget's events (`page.event`), with its arguments as fields, and each write to one of
  its `mut` inputs (`page.write`, and the layout's own) as `write<Input>` with `value`. Names are
  camelCase, as omnicui's must be: `open_changed` is `openChanged`, a prop `zoomRange` is the input
  `zoom_range`, and a record is spread into fields (`at` → `atX`, `atY`).

`press`, `focus`, `key`, `type`, `drag` and `hover` are real Playwright input on the part's element;
`read` takes role, name, checked, expanded, disabled and value from Chromium's accessibility tree.
It advertises no screenshots, traces or clips: with one target there is nothing to compare them
with.

**Parts.** omnicui names a part `<component id>.<part>`; the adapter finds its element in this order:

| The part | Its element | For example |
|---|---|---|
| an alias | `heading`'s `level1`…`level6`: the heading while it is that level; `bullets`' `ordered` and `unordered`: the list while it is an `ol` or a `ul`; `press`'s `switch` and `checkbox`: the press itself | `core.heading.level3` |
| the widget's short name | the widget under test (its `data-xtmd-site`) | `core.slider.slider` |
| `<part>` | `[data-part="<short>.<part>"]` inside it | `core.slider.input` → `slider.input` |
| `<part>` | `[data-part="<part>"]` anywhere on the page: a widget around it or in its slots | `core.flex.label` → a `label` |
| `<part><n>` | the nth (from 1) of the above | `core.table.cell3`, `core.bullets.item2` |

A part that isn't on the page is "no part" for a step or a read, and 0×0 for `bounds`, so a
contract can say `visible: false` of it.
