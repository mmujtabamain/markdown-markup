# Remarks on building the def.ts diagnostics (defA)

## What was hard to trigger
- Lines 880/879/756/760/746/797/815: need a prop or input of an unusual type (range, duration, ref, path, expr, latex, slot, records). The base set offers almost none of these as view props, so I wrote my own `part` with such an input just to be able to pass it a wrong value. A reader of the dataset will see parts that exist only for that.
- 879 (fractional value for an int) is dead: the type check fails first with `mkp.type` "expected int, found num", and 2.0 is accepted as whole.
- 491 second wording ("a choice here", empty owner) is unreachable; the owner is always a member name.
- 243 is the shared throw helper, not a diagnostic.
- 372 (more than 300 elements) needs a generated 300+ line block; 897 needs 33 sibling lines.
- 387 (no fallback) cannot occur in a document: a header without the about string is a syntax error, so a pack is needed. 281 (extern) also needs a pack; a document may not declare an extern.
- 842 is reached only from the YAML block, not from a view line.
- 772 (slot given as argument) is reached only through a slot input with a default; passing `content=3` gives an unrelated unknown-prop message.

## Patterns in the messages
- Good: shadow (485 to 491), unknown-token/enum with did-you-mean, interface (lists exactly what is missing), no-fallback, requires-gfx, limit messages (give the cap), untyped (says the fix form).
- Many errors share the generic code `mkp.check` (about 20 sites in state controls, ref, range, duration, text, latex, slot, records). A tool cannot tell them apart and an author gets no rule name.
- Codes are inconsistent for the same idea: "a grid needs at least one column" is `mkp.input-type` at 820 and `mkp.input-range` at 829. `mkp.input-type` is used for view-line props (tracks) though it reads as a YAML data code.
- Misleading cascades: a failed `fn` is not registered, so each call adds "there is no function" and the widget also gets "has no project md" although one is written. A failed ref default makes "count is not defined" appear in the body.
- Self-referential suggestion: giving a slot input a value (`panel content=3`) prints `panel has no prop "content" (did you mean "content"?)`.
- Double parentheses: `"cty" isn't a field of the items (they have city) (did you mean "city"?)`.
- Wording oddities: "none is true or false, written" (620; "written" unexplained and a variable is refused); "unexpected value for toggle" does not show the value; "expected an expression in x" does not show what was found; "a state line raises change and end" is hard to read; the colour-token error has a stray comma before "by name"; `(15.1)` in the reserved-signal message is a spec section the author cannot look up.
- Several messages do not name the other half of a conflict: duplicate and duplicate-id do not say where the first one is.
- Position: `fields` unknown name and the gfx errors point at the widget header, not the line at fault; 842 points to the end of the document.

## Language things that got in my way
- Input names that are also token names (`body`, `line`) give `mkp.ambiguous-arg` and `mkp.shadow` when used as `text body`; I hit this with an input called `body` and again with `line`.
- `fields` is space separated; a comma gives a different syntax error.
- State events are indented under the state line; I found this only in the parser.
- A document's header always needs a quoted about line, and a one-word header gives `mkp.unknown-statement`.
