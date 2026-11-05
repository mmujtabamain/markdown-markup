# MKP error messages: raw reader feedback

Every diagnostic the compiler can raise, each with a small block that triggers it, read by three
Haiku sessions that had never seen MKP and had no tools at all. Collected 5 Nov 2026, then acted on:
every message was rewritten to the style in `rewrite/STYLE.md` (see `rewrite/`).

- `ERRORS.md`: the 370 distinct messages (code, severity, message, the compiler site), then the 23
  sites not triggered from a document or pack (runtime-only, dead or shadowed), with why.
- `dataset.jsonl`: each message with its site, block and the builder's `remark` on building it.
- `untriggered.jsonl`: the 23 sites not triggered.
- `parts/part-{1,2,3}.json`: what the readers were given (id, message, block; every third item).
- `feedback/`: raw readers' replies (`reader-<k>-turn-<n>-part-<p>.txt`) and the parsed answers
  (`reader-<k>-part-<p>.jsonl`: understood yes/partly/no, meaning, fix or "cannot infer",
  confusing). Reader 1 read parts 1, 2, 3; reader 2 read 2, 3, 1; reader 3 read 3, 1, 2, each as
  turns of one conversation. Reader 3 declined its third batch and asked how to treat items it
  couldn't fix (turn 3); it was told to answer all, marking those "cannot infer" (turn 4).
- `build/`: the error sites per slice (`sites-*.txt`), the builders' trials as JSON lines
  (`out-*.jsonl`) and their overall remarks (`remarks-*.md`), and the scripts: `check.sh`
  (compile a trial), `merge.py` (dataset and parts), `read.py` (one reader: `claude -p --model
  haiku --effort medium --tools ""`, no MCP, no settings, an empty working folder).

Builders were Sonnet at low effort, one per slice of the 390 sites. The trial folders themselves
(`build/trials/`, 104 MB with the budget and size limits) are not kept in git.

## The rewrite

- `rewrite/STYLE.md`: how a message reads: what is wrong, what was found, the fix with an example.
- `rewrite/brief-*.md`: per compiler area, each message with its block, builder remark and the
  three readers' answers, as given to the rewrite.
- `rewrite/changes-*.md`: per area, every message before and after, position fixes, what was left.
- `rewrite/before-after.md`: the 331 dataset messages that replay from their block, before and after.
- `build/replay.py`: replays dataset blocks against the compiler as it is now.
