# Release notes

One file per version, `<version>.md`, written in the merge request that raises `VERSION`. A
release's notes on GitHub are this file. `node tools/release/check-notes.mjs` checks them all, and
the **Release notes** check runs it on every merge request into main (`.github/workflows/notes.yml`),
which main's ruleset requires.

```markdown
---
version: 0.3.0
date: 2026-11-18
summary: One sentence on the biggest change, at most 140 characters.
---
## New
## Changed
## Fixed
```

- `version` is the file's name; `date` the day it ships; `summary` is the release's title.
- Sections are New, Changed and Fixed, each optional. Write for Extended Mark's users, not about internals:
  what they can now do, what changed (a breaking change first, with what to do instead), what no
  longer goes wrong.
- A merge into main whose `VERSION` has no release yet publishes it (`.github/workflows/release.yml`).
