# @extended-mark/dom

Extended Mark's default web widgets, in plain DOM: every core extern widget drawn from a
[@extended-mark/runtime](../runtime) page. No framework. The React, Next, Vue, Svelte, Solid and Angular
bindings mount pages through it.

```ts
import { run } from "@extended-mark/dom";
import page from "./sprint.ir.json"; // xtmd build sprint.xtmd --out sprint.ir.json

const mounted = run(page, document.getElementById("app")!, { page: { theme: "DARK" } });
mounted.page.setPage({ theme: "LIGHT" }); // the page redraws itself; the DOM follows
```

- **`mount(page, root, opts?)`** draws a `Page` into an element and keeps it drawn. It returns a
  `Mounted`: `view(path)`, `act(path, action)`, `layout()` and `unmount()`.
- **`run(irFile, root, opts?)`** makes the `Page` from an IR file (an object or its JSON text),
  then mounts it. `opts` takes `PageOptions` and `MountOptions` together.
- **`widgets`** are ours, by full name (`core/press` …, and `#notice`). `MountOptions.widgets`
  replaces any of them by name, and adds a pack's (`acme/chart`). An extern nobody supplies is
  drawn as a notice naming it.
- **`MountOptions.measure`** replaces the DOM's measure for the plane's layout, as the checks do
  with fixed sizes.
- **The stylesheet** is put into the document (or the shadow root the page is in) once, on the
  first mount, so plain TypeScript needs no CSS loader. It is also `@extended-mark/dom/style.css`.

The API is in [src/api.ts](src/api.ts), and is fixed: the bindings, the browser check adapter,
the omnicui contracts and the playground are written against it.

## How a page is drawn

- **Keyed.** Each drawn extern widget is one `WidgetView`, kept by its `Drawn.key` and updated in
  place after every change, so a loop row's elements follow its item. Views whose key is gone are
  destroyed; the rest are put in the tree's order, moving only what is out of place. Focus, the
  caret, typing in progress and scroll survive a redraw.
- **On the page, always.** Every node of `page.tree()` has an element with its `data-xtmd-site`,
  a closed overlay's body included: it is hidden, never left out.
- **Tokens** are custom properties on the root (`--xtmd-color-ink`, `--xtmd-space-m`,
  `--xtmd-font-body-size`, …) for the page's `core/page.theme`; a theme change rewrites them.
- **Writes** go through the page as checked writes, with exact numbers: a slider snaps to its
  grid with decimal arithmetic, and a pan or zoom writes numbers rounded to a sub-pixel.
- **`act(path, action)`** does what a person would, through the widget's own DOM when it can: a
  real click, typing into the input, moving the slider, opening the overlay from its anchor. A
  value the DOM can't reach (off a slider's grid, past its ends, a line break in a one-line
  field, an exact point for a handle or a plane) goes through the page instead.
- **The plane** is a clipped view holding one inner element that a CSS transform moves and
  scales. Spots sit absolutely at their points, the background is SVG under the same transform,
  and boxes come from the runtime's layout on each spot's own size (`offsetWidth`), which the
  transform never changes. The layout runs after every change and whenever a ResizeObserver sees
  a spot or the view change size. Dragging pans, the wheel, a pinch or `+`/`-` zoom within
  `zoom_range`, and the arrow keys pan.
- **core.gfx** is SVG in the surface's own units, y up. `shade` is a 2D `<canvas>` painted from
  its shader: at most 65,536 sampled pixels, scaled up, fewer when the shader is Extended Mark code so the
  whole shade stays within the step limit, worked out in slices of a few milliseconds.
- **Maths** is MathML from a small TeX reader (scripts, fractions, roots, fences, Greek,
  operators, accents, `\text`), with the TeX as its accessible text (`role=math`,
  `aria-label`). TeX it doesn't know is shown as itself.

## Parts

Every widget's root has `data-xtmd-site` (its path), `data-xtmd-widget` (its full name) and
`data-part` (its short name). Its other elements have `data-part` names too, for omnicui
contracts. A class `xtmd-<part>` (dots as dashes) goes with each.

| Widget | Part | Element | What it is |
|---|---|---|---|
| paragraph | `paragraph` | `p` | Its rich text: `strong`, `em`, `s`, `code`, `a`, `img`, `sup.xtmd-note-ref`, `[role=math]` |
| heading | `heading` | `h1`–`h6` | Its rich text |
| bullets | `bullets` | `ul`, or `ol` with `start` | Its items |
| item | `item` | `li` | `.xtmd-task` when it has a task box |
| | `item.check` | `input[type=checkbox]` | The task box: checked for done, disabled (a press changes it) |
| | `item.body` | `div` | Its blocks |
| quote | `quote` | `blockquote` | Its blocks |
| code | `code` | `pre` | Focusable, scrolls; `data-lang` |
| | `code.text` | `code.language-<lang>` | The source |
| math | `math` | `div[role=math]` | `aria-label` and `data-tex` are the TeX; MathML inside |
| table | `table` | `div` | Scrolls a wide table |
| | `table.grid` | `table` | |
| | `table.header` | `th[scope=col]` | A header cell, `text-align` from `align` |
| | `table.cell` | `td` | A cell |
| footnote | `footnote` | `div[role=note]` | Its `id` is where its marks link |
| | `footnote.mark` | `a` | The mark, linking back to where it is used |
| | `footnote.body` | `div` | Its blocks |
| divider | `divider` | `hr` | |
| label | `label` | `span` | `data-size`, `data-weight`, `data-font` |
| image | `image` | `img` | `alt`; an unsafe `src` is left out (`data-unsafe-src`) |
| icon | `icon` | `svg` | `role=img` and `aria-label` with a label, else `aria-hidden`; `data-glyph` |
| press | `press` | `button` | Role and state by kind: TOGGLE `aria-pressed`; TAB `role=tab` `aria-selected`; OPTION `role=option` `aria-selected`; SWITCH `role=switch`, CHECK `role=checkbox`, RADIO `role=radio`, each `aria-checked`; `disabled`; `data-kind`. With content, `aria-label` is its label |
| | `press.label` | `span` | Its label, when it has no content |
| | `press.content` | `span` | Its content slot |
| | `press.indicator` | `span` | The box, dot or track of CHECK, RADIO and SWITCH (`aria-hidden`) |
| field | `field` | `label` | |
| | `field.label` | `span` | Its label text |
| | `field.input` | `input[type=text]`, or `textarea` for `lines` > 1 | `placeholder`; Enter submits (Ctrl or Cmd with it in a textarea) |
| slider | `slider` | `div` | |
| | `slider.label` | `label` | For the input |
| | `slider.input` | `input[type=range]` | `min`, `max`, `step`, `aria-valuenow`, `aria-valuetext` |
| | `slider.value` | `output` | The value shown (`aria-hidden`: the input says it) |
| overlay | `overlay` | `div` | |
| | `overlay.anchor` | `span` | Its anchor slot. Its first control is the trigger (`aria-expanded`, `aria-haspopup`, `aria-controls`); with none, the anchor is (`role=button`, focusable) |
| | `overlay.body` | `div[popover]` (POPOVER, MENU, TOOLTIP) or `dialog` (DIALOG) | `role=dialog` or `role=tooltip`, `aria-label`; `data-mode`; hidden while closed |
| canvas | `canvas` | `figure[role=group]` | `aria-label` is its label |
| | `canvas.surface` | `svg` | Its layers |
| layer | `layer` | `g` | `opacity` |
| | `layer.shapes` | `g` | Its shapes, clipped by `clip` |
| circle | `circle` | `circle` | With an event: `role=button`, focusable; else `role=img` with a label |
| path | `path` | `g` | As circle |
| | `path.line` | `path` | |
| | `path.head` | `path` | The arrow or dot at the last point |
| place | `place` | `foreignObject` | At its point |
| | `place.box` | `div` | Its child, moved by its anchor and nudge |
| handle | `handle` | `g[role=slider]` | Focusable, `aria-label`, `aria-valuetext` `(x, y)`; arrows move it |
| | `handle.dot` | `circle` | What is seen |
| | `handle.hit` | `circle` | The larger area that takes the pointer |
| shade | `shade` | `foreignObject[role=img]` | `aria-label`; `data-state` (`painting`, `done`, `failed`, `empty`, `no-shader`), `data-samples` |
| | `shade.pixels` | `canvas` | The sampled pixels |
| flex | `flex` | `div` | `data-axis`; `role=group` with a label; `tablist`, `radiogroup` or `listbox` around tabs, radios or options; focusable with `.xtmd-clickable` when its click does something |
| grid | `grid` | `div` | As flex, for clicks |
| cell | `cell` | `div` | A grid item |
| sizing | `sizing` | `div` | The flex item its sizes are set on |
| plane | `plane` | `div[role=group]` | `aria-label` is its label; `.xtmd-zoomable` |
| | `plane.view` | `div` | The clipped, focusable view: pointer, wheel and keys |
| | `plane.inner` | `div` | Moved and scaled by the transform |
| | `plane.background` | `svg` | Its background layers, in the plane's units |
| | `plane.items` | `div` | Its spots |
| spot | `spot` | `div` | At its point, by its anchor and nudge; its size is its box |
| #notice | `notice` | `div[role=alert]` | A widget that failed, one nobody supplies, or one whose drawing threw |

## Tests

```sh
npm install        # .npmrc keeps @extended-mark/runtime a symlink to ../runtime
npm test           # builds, then runs test/*.test.mjs in Chromium
```

The tests drive a real Chromium through `playwright-core`, at `XTMD_CHROMIUM` or
`/usr/bin/chromium` (none is downloaded). Each page is built by the `xtmd` binary in
`targets/rust/target`, and the harness (`test/harness.mjs`) is bundled with esbuild.
