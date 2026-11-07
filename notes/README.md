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
- **Every release also has a changelog**, `changelog/<version>.mkp.md`: the long, descriptive one,
  which the website's What's new tab reads. The same front matter, then `# <version>`, a paragraph,
  and the sections `## Breaking`, `## New`, `## Changed`, `## Fixed`, `## API` and `## Migration`,
  in that order, each optional. An item is a list item with what follows it: its paragraphs, code
  and the widget blocks that show it working (drawn live under it on the site). `## API` is made by
  `node scripts/api-diff.mjs --from <last release>`: edit its words, keep its names;
  `pnpm check:api` warns about any change it doesn't name. The short note here links to it.
- **Every release ships a migration step**, `packages/core/src/migrate/steps/<version>.ts`, listed
  in `steps/index.ts`, even when it changes nothing (`ir() {}` with no changes): a test fails while
  the last step doesn't end at `VERSION`. A step says what it renamed, removed and now draws
  differently, and whether the old look can be kept. When it changes something a reader sees, add
  `apps/site/migrations/<version>/before.mkp.md`, and the `after.mkp.md` and `said.txt` that
  `mkp migrate before.mkp.md --take all` writes and says (a test holds them to it).
