# The MKP runtime: a written spec for ports

The TypeScript runtime in `packages/core/src/runtime` is the reference. A platform that can't run
TypeScript ports what this page describes and proves it with the conformance suite
(`conformance/`, run by `pnpm conformance`; see "Conformance" at the end).

## Input

A **bundle** (`ir/bundle`) or an **expanded bundle**: the document's nodes, the definitions it uses,
their functions and constants, types, token sets and macros. Nodes are base widgets, built-ins
(`each`, `switch`, `slot`, `controls`, `arrow`), records (`$record`) and uses of definitions (a node
with `def`; in expanded IR it also carries `inst: {def, inputs, view}`, the view already inlined).

## Values

| MKP | Representation |
|---|---|
| num, int | IEEE double |
| bool | boolean |
| text, latex, choice option | string (text is inline Markdown with `$…$` maths; latex is TeX) |
| point | `[x, y]` |
| list | array |
| record, dict | map with no inherited keys (`__proto__`, `constructor` are ordinary keys) |
| fn, lambda, expr input | a callable |

Equality (`==`) is structural. Ordering (`<`) compares numbers or strings.

## Evaluation

Each `ast` node evaluates as below; every node costs one operation, list builtins one per item.

- `var` with `from: local` reads the innermost binding (lambda parameters, `each` variables, event
  payloads, command fields); `from: inst` reads the instance (inputs, state, vars, hosts, derived);
  `from: const` reads a bundle constant (evaluated once).
- `call` runs a bundle (or definition-local) function: parameters bound, body evaluated; local
  functions see their instance. Depth is capped at 64.
- `builtin` runs the named builtin (`packages/core/src/eval.ts` lists them all, with their exact
  semantics: `round` is floor(x + 0.5), `mod` is the floored modulo, `sort` is stable, `iterate`
  stops early when the state stops changing, `rand` is the 32-bit mixing function in `eval.ts`).
- `tmpl` builds text: each hole is evaluated and formatted — numbers to four significant figures
  (`∞`, `—`, and `a×10^b` style in maths), pack types through their `show` function (`show` names it),
  latex values wrapped in `$…$` outside maths.
- `field`/`index` on a missing key or out of range is the runtime error `mkp.missing-key`/`mkp.index`.

An **evaluation** (one derived value, one condition, one prop) has a budget of 1,000,000 operations,
or the definition's `budget` (at most 20,000,000; a provider may cap it lower). Lists are capped at
10,000 items, `iterate`/`scan` at 10,000 steps, and `each` at 10,000 items, the list limit; the
rendered-node count (5,000 per widget instance) is usually reached first.

## Instances and state

A use of a definition creates an **instance**, identified by its path (parent path, child index, and
for `each` the item's key). The same path keeps the same instance across renders; an instance that
is not rendered is dropped, so its state starts over when it returns.

An instance holds:

- **inputs**: literals; expressions evaluated in the caller's scope; `ref` (the caller's state cell);
  slots (nodes plus the caller's scope); record lists (evaluated from the caller's record nodes,
  skipping records whose `if=` is false; each record value also carries its `slot`).
- **state**: controls (`slider`, `choice`, `toggle`, `steps`, `drag`) starting at their default or
  the range's low end (drag: the centre), `var`s, and `host` inputs (the host's value or the default).
- **derived values**: memoised; recomputed only when a state cell they read changed.

## Rendering

Walk the nodes with a scope:

- `if=` false: skip (the element leaves). `hidden`: render, marked hidden until `reveal id`.
- `each`: evaluate the list or range, bind the variable, key items by `key=` (or the value for a
  range, or the index), and render children per item.
- `switch`: the first case whose value equals the subject, else `else`.
- `slot`: render the slot's nodes in the slot's own scope.
- `arrow`: collect; after the instance renders, resolve `from`/`to` ids in the instance, then in the
  instances nested inside it (two matches is an error; none draws nothing and warns). `via` (a
  list of ids) is resolved the same way, in order; a via id with no element is left out, with the
  same warning. The renderer measures the ends and the via elements after layout and draws the path
  (`arrowPath` in `runtime/arrow.ts` is the reference): from `from`'s outline through each via
  element in turn to `to`'s outline. A via element is passed along its longer centre line — top to
  bottom through one taller than wide, side to side through one wider than tall, whichever way
  round is shorter from the point before to the element after — and through the centre of a square
  or empty one. The runs between are straight, with each corner rounded (radius 12 px, at most half
  of either run), the head is on the last run, and a label sits halfway along the path. `curve`
  bends only an arrow without via elements. A via element that is hidden or not laid out is passed
  by. With `route` (`arrowPaths` is the reference) every run is level or upright: `down` leaves and
  arrives by top and bottom edges and turns in the gaps between rows, `right` does the same by left
  and right edges between columns, and a pair with no gap that way runs the other way. Arrows of a
  scope that leave one element by one side start at one point, and those that reach one by one side
  end at one point. In a gap, arrows that leave one element share a track, or else those that reach
  one do, and no other two do, unless their level runs don't touch. A side that arrows both leave
  and reach by has two points, side by side. An arrow back up through via elements leaves or arrives
  by the side of a box its lane stands clear of. An arrow whose `from` and `to` are one element
  is a loop on its right side, or its left if the scope has no room, and its label sits beyond it.
- a use: create or reuse the instance, render its view, then its **bar** (inside its frame's bar
  when its view is one `frame`, with the frame's status after a steps control's buttons): a row of base widgets for
  each control not placed by `controls` (drag is never in the bar).
- a base widget: evaluate props; text props become inline runs (text, strong, emphasis, code, links,
  maths); maths runs carry their SVG and speech.

The result is a tree of base widgets with resolved props (the TypeScript `VNode`).

## Events and actions

A base widget reports `click`, `change {value}`, `submit {value}`, `open`, `close`, or a handle's
`drag [x, y]`. Its handlers run in the scope where they were written, with the payload bound under
the event's name. Actions run in order:

- `set name=expr` writes a state cell (through a `ref`, the caller's cell). A change runs the state
  line's `@change`, and `@end` when a slider or steps reaches its last value.
- `play`/`pause` start and stop a slider or steps; time advances through `tick(ms)`: a slider moves
  `(max − min)·ms/duration`, snapped to its step, and at the end stops (`once`), wraps (`repeat`) or
  turns back (`bounce`); steps advance one per `duration/n`. Under reduced motion a slider moves in
  jumps of a tenth of its range.
- `reset` restores defaults; `reveal`/`hide` and `open`/`close` set an id's flag.
- `emit name` runs the caller's handlers for that event, in the caller's scope.
- `send name` delivers a signal to the host: `{document, block, widget, name, payload, time}`.

## The host interface

- **Signals**: typed, at most 30 a second, payloads at most 16 KB. The reserved `error` signal
  `{code, message, path}` is sent once when an instance's error boundary trips.
- **Host inputs**: validated against their type and at most 64 KB; set at mount or later.
- **Commands**: only declared ones, arguments validated; their actions run with the fields bound.

## The error boundary

Any runtime error while rendering an instance (budget, missing key, depth, duplicate key or id)
replaces the instance with an error node showing the block's summary and the message, and sends the
`error` signal. The rest of the document keeps working.

## Conformance

`conformance/cases/*.json` holds one case per fixture case and document: the bundle, the play steps,
and the expected results before and after them — every instance's state and derived values, the
visible nodes in order, and the Markdown output (plain, and with every toggle). A port passes when,
for every case, values agree within a relative 1e-9 (absolute 1e-12 near zero), the visible nodes
are the same, and the Markdown agrees. `pnpm hermes` runs the same suite under the Hermes CLI.
