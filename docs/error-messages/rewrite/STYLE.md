# How an MKP error message reads

The goal: a reader who has never seen MKP can fix the block from the message alone. Three Haiku
readers with no docs and no tools tried exactly that on all 370 messages; their raw answers are in
`../feedback/` and per area in `brief-*.md`. Where they said "partly" or "no", or noted something
confusing, the message is what has to change.

## The shape

    <what is wrong, naming the thing and where it is>; found <what was written>. <The fix, as an instruction, with an example>.

- **Name the thing.** The input, prop, option, widget, file or fence it is about, in the author's
  own words: `align on text`, not `it`; `the "panel" block`, not `the block`.
- **Show what was found.** Quote what the author wrote (`found centre`, `found (level)`, `found 2.5`).
  A message that says "unexpected value" without the value is not done.
- **Say what is allowed.** The options, the token names (`takes()`), the range, the type, the
  shape of a line: whatever fits. Keep "did you mean" hints.
- **Give the fix.** An instruction that starts with a verb (`Write …`, `Remove …`, `Move …`,
  `Rename …`, `Add …`, `Quote …`), with a short example line in the author's terms when the
  shape is not obvious: `Write none=true or none=false`, `Add an about text after the
  name: hills "Rolling hills." …`. When there are two reasonable fixes, give both.
- **Explain MKP-only ideas in a few words, where they are used.** `answers` (true when the
  Markdown includes the answers), a fallback, a capability, `from(num)`, a type parameter `T`: say
  what it is or what to write, never assume the reader knows the term.
- **No internal words.** Not "held", "chosen", "owner", "slot kind", "the inputs that hold it",
  "known only where the definition is used". Say what the author should do.
- **One message, one problem.** If a message covers two cases ("repeated or chosen"), say which one
  happened.
- **Plain text, one line,** normally under ~250 characters. Code goes in backticks: `` `none=true` ``.
  No trailing colon. Library text (YAML, zip) is rephrased or cut to its useful part, with a
  position the author can use.
- **Position.** It must point at the line to change. A diagnostic at line 0 / column 0, or at the
  wrong line, is a bug to fix where it is raised.

## What stays

- The codes (`mkp.check`, `mkp.enum`, …): they are API. Do not rename or merge them.
- Severity, and what is an error at all: no change of behaviour, only of words and positions.
- Messages already clear to all three readers can stay, or get a fix added when they lack one.

## Examples

| before | after |
|---|---|
| `none is true or false, written` | ``none on field must be written as true or false, since it is fixed when the widget is built; found (maybe). Write `none=true` or `none=false` `` |
| `unexpected value for toggle` | ``toggle takes no value; found 3. Write it bare (`toggle`), or use `selected=` for its starting state`` |
| `picklist can't tell what T is here: give the inputs that hold it` | ``picklist can't tell what kind of items it holds, since no input of type T is given. Pass `items=…` (a list of items) so their type can be read from it`` |
| `items is empty, so its items' type can't be told; give at least one` | ``items is an empty list, so the type of its items can't be worked out. Give at least one item, e.g. `- name: First` `` |
