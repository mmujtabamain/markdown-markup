# Remarks on building the defB slice (check/def.ts, lines 911-1454)

69 sites: 65 triggered (66 lines, one site has two branches), 4 not triggered.

## Hard or impossible to trigger

- `def.ts:1130` (unknown-version): a use like `chip@2` never reaches the checker; the syntax pass rejects it as `mkp.syntax: "chip@2" is not a valid element name`. The version branch of `resolveDef` appears dead.
- `def.ts:1312` (case out of range warning): `this.value()` rejects the literal first with `mkp.input-range`; slider and steps subjects carry no integer range, so no warning. Looks dead.
- `def.ts:1402` (play with no name): the `args.length !== 1` check just above always fires first. Dead.
- `def.ts:1448` (unknown action): the parser reports `mkp.unknown-action` first. Dead.
- Several "takes a boolean expression", "an id is a name or (an expression)", "set takes an expression" and "each needs a list or a range" guards only fire for values that are ranges (`1..3`) or durations (`2s`). No author would write those; the realistic mistakes get other diagnostics. I used them anyway, so those blocks look artificial.
- `def.ts:1292` (prop line inside each) needs a widget use that holds a record child and a prop line inside the same `each`; it also reports line 0, column 0.
- `def.ts:1126` (ambiguous across packs) needs three files and two `--pack` flags.

## Patterns in the messages

- Good: messages that name the fix (`write size=small`, `write pack:chip`, `expected "each x in list [key=expr]"`, `... it raises closed`). The ambiguity family (`mkp.ambiguous-arg`) is the best written group.
- Generic code: about a third of the errors in this range use `mkp.check`, which says nothing about the kind of mistake (slot, fill, case, set, emit, arrow, each, if). The code cannot be searched or grouped.
- Inconsistent wording for the same mistake: `"x" is not state here` (reset, mkp.not-state) vs `"x" is not state, a var or a ref input of W` (set, mkp.not-state); `self=middle` gives `it takes one of start, center, end, stretch; found middle` (mkp.enum) but a computed self gives `self takes start, center, end or stretch` (mkp.enum) with no found value; `if` type errors say `if needs a boolean; found int` in mkp.check while other type errors use mkp.input-type.
- Misleading: putting a child under a widget with no slot gives `mkp.unknown-prop: W has no input, record or slot named "text"`, though the author meant to add content. `reveal a hide` reports `hide takes one id` because actions chain on one line, so the second word starts a new action.
- Missing information: arrow and unknown-field/unknown-out/unknown-event messages do not list what exists (unknown-event does when there are outs); `arrow takes from=id ...` lists every legal prop without saying which of mine was wrong; `arrow needs from=id and to=id` does not say which one is missing; `is set twice` points at the widget use, not the second setting.
- Follow-on noise: a failing prop line also reports `needs title` for the same input, since the failed line leaves it unset.
- `mkp.each-unkeyed` is a warning that every plain `each` over a list triggers; it is long but actionable.

## Language points that got in my way

- Part inputs only take positional values when the part declares `fields`; otherwise `entry "One"` fails with `it takes no positional values`.
- A bare word as an argument can mean flag, option, token or name in scope; the rules are only in the guide. Easy to write ambiguity by accident, and the diagnostics are good.
- A bare input name as a child (`title "x"`) is a "prop line", only visible in SPEC-NOTES, never named in the guide.
- Slots are declared `in body slot`; records `in marks list(record mark {...})`; both are discoverable only from the base widgets or tests.
- `check.sh` prints diagnostics on stderr, and JSON lines have a leading space in some paths.
