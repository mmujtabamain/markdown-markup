# Release notes

One file per version, `<version>.md`, written in the merge request that raises `VERSION`. Each
release's notes on GitHub are this file, then how to use each asset. `pnpm check:notes` checks them
all (CI runs it on every merge request).

```markdown
---
version: 0.1.1
date: 2026-11-08
summary: One sentence on the biggest change, at most 140 characters.
---
## New
## Changed
## Fixed
```

- `version` is the file's name; `date` the day it ships; `summary` is the release's title.
- Sections in that order, each optional. Write for MKP's users, not about internals: what they can
  now do, what changed (a breaking change first, with what to do instead), what no longer goes wrong.
- A maintenance release (a build or dependency fix) still gets a note, its summary saying so.
