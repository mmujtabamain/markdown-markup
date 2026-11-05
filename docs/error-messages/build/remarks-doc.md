# Remarks on the document-checker slice (check/doc.ts)

All 46 sites were triggered from documents; none needed a pack. 51 lines were written, with several branches per site.

## What was hard to trigger
- mkp.missing-field at line 23 (a record default that YAML cannot supply): defaults that are expressions are almost always constant. It only failed when the default called a user fn.
- mkp.doc-size: needs more than 800 lines of definitions, so the block is long (generated).
- mkp.doc-item: an interface in a document is refused earlier by the parser with mkp.syntax, so only the macro and tokens branches are reachable here.
- mkp.shadow for a type: text and color are not core types; iconname was needed.
- mkp.input-type at lines 397/400/403 need a widget with a type parameter (`picklist of T`) and a specific shape of data each.
- Attribute syntax ({#id}, {key=value} on a line below a block) and the record `slot` convention are not obvious from the guide.

## Patterns in the messages
- Good: mkp.input-type for YAML 1.2 yes/no (gives the fix), mkp.yaml-control-char (explains the backslash), mkp.duplicate-anchor (names the first line), did-you-mean on unknown widgets and fields.
- Inconsistent: mkp.doc-item grammar ("a macro belongs", "tokens belongs"); type names vs words ("level is num" vs "a number").
- Weak: YAML library text is cut at its first line and ends with a dangling colon (mkp.yaml, mkp.front-matter); front matter with a bad control character is reported as mkp.front-matter with a stuttering message, so mkp.yaml-control-char is unreachable there.
- Positions are sometimes the block's first line or the line of a key, not the exact value; list-entry errors do not say which entry beyond the position.
- Quoting: a container argument like label=New is read as an expression and gives an unrelated "New is not defined here".
- Inline HTML in a paragraph gives no warning; only block HTML does.
- "profile's block attributes" in mkp.attrs is jargon for authors without a profile.
