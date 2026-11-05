# Remarks: expression, type and token sites

64 of 67 sites triggered; 3 did not (types.ts:240 parseTypeString is never called; tokens.ts:66 token-missing cannot be reached because core always defines the required tokens; expr.ts:530 recursive-untyped is shadowed by mkp.untyped).

## Hard to trigger
- Anything that is a type error is easy: put a derived value (`r = ...`) in a widget and run check. Derived values are checked even when unused.
- Needing setup: record paths (213, 214), field errors (200), unknown-field, \val of a record (651), ambiguity (478, 316, 621). These need a type, a const or fn, two packs. Note that 316 needs two packs and a document, and a pack's `provides` must name a thing, not a file (the first mkp.pack-provides error was a trap).
- filter's boolean check (747) only fires for a named fn; a lambda with the wrong result gives "expected bool, found int" from the coercion instead.
- 121 (nesting 200) needs a machine-made expression. 621/622 only occur beside mkp.untyped.
- Dead or shadowed: 530 (checker for top-level fns is fresh, so the in-progress guard never sees the recursion; widget-local untyped fns abort earlier), 66, 240.

## Patterns in the messages
- Good: unknown-function and unknown-field with did-you-mean; no-overload lists the candidate signatures; \val of a record says how to fix it; fold/iterate/if branch messages show both types.
- Most expression errors share the generic code mkp.type, so the code carries little information; only a handful have own codes (arity, ambiguous, no-operator, unknown-*).
- Inconsistent "found" reporting: put/get/sort show what was found, keys/has/flatten/mean/min do not.
- Plural hedges "argument(s)", "parameter(s)", "variable(s)"; "is a int".
- Positions often point at the whole call or the start of the line (var at col 3, list at its bracket) rather than the offending argument or item.
- Ambiguity message (478) prints internal ids like `$doc:blend#0`, meaningless to the author; 316 says "qualify it" without the syntax.
- Type-syntax messages ("expected a type", "expected a field name") say what was expected but not where in which constructor, and each failed input also leaves a cascading mkp.unknown-name for the input.
- An unclosed bracket in a type reports at the next line (types.ts:65 case) with an extra mkp.unclosed-bracket.
- mkp.maths is positioned at the start of the paragraph, not the formula.

## Language things in the way
- Top-level declarations (type, const, fn) must start at column 0, and a widget's members are indented; mixing them gave confusing "unknown-statement" output.
- Untyped fns are registered anyway and error twice (mkp.untyped plus follow-ups).
- Text cannot be indexed, though slice/len work on it; `xs.len` is refused with no pointer to len(xs).
- The tokens file syntax is not in the authoring guide; I found it in a test.
- check prints diagnostics on stderr, not stdout (the helper must capture both).
