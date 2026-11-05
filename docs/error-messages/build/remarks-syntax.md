# Remarks: syntax slice

- Nearly every site was easy to trigger from a one-line mistake inside an `mkp` fence in a document. Pack-only sites (manifest lines, `name@N` heads, `interface`, `tokens`, `pack`) need a pack folder, and manifest lines only parse in manifest.mkp; the same line in another file gives the unrelated unknown-statement message.
- expr.ts:53 and mkp.ts:182 are shared helpers, not distinct messages; recorded as not-triggered.
- Same code, different wording: the bare-keyword head error reads "expected a name" in a document and "expected name@N" in a pack (two lines recorded for mkp.ts:244).
- Almost all definition and expression errors share the code `mkp.syntax`, so the code tells a reader nothing; only the message does.
- Good messages: those that quote the expected shape (front, attr, rule, project, interface) or give the fix (abs(x), indent under the line it handles, break inside a bracket).
- Weaker messages: "unexpected "*"", "the expression ends too early", "a bracket is never closed" (points at the line start, not the bracket, and a second "expected )" follows), and "expected a quoted description, found X".
- Odd indentation gives either "indented N spaces; children ... (want)" or "multiple of two" depending on direction, so 3 spaces under a 2-space line gets the first message.
- Language friction: the same `=`-separated syntax is used for derived values, state controls and arguments, so mistakes land in generic messages; documents use bare names while packs require name@N.
