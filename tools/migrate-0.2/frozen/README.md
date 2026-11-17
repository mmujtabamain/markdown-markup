# The frozen 0.2 → 0.3 step

`migrate-0.2.cjs` is what `mkp migrate` runs on a document written for MKP 0.2: MKP 0.2.10's own
compiler reads it into its IR, and the migrator (`../src`) writes it as 0.3, with a stand-in for each
0.2 pack it uses that has no 0.3 release in the build. It is one file for Node 20 or later, built once
from 0.2.10 and never again; `migrate-0.2.lock` records what went in and its SHA-256, and `mkp` is
built with that hash and runs no other file.

- **Where mkp finds it:** `MKP_MIGRATE_02`, else beside the `mkp` binary (each platform package of
  `@mkp/cli` 0.3.0 carries it there), else here, for a build from this repository.
- **Node:** `MKP_NODE`, else `node`; `npx mkp` passes the Node it runs with.
- **Only MKP 0.3.0 carries it.** Once 0.3.0 is released, this folder's `migrate-0.2.cjs` and
  `migrate-0.2.lock` are deleted; a later `mkp` meets a 0.2 document with "run `npx mkp@0.3.0 migrate`
  on it first".

Built with:

```sh
git archive e896e6b2f73ba99ffb86261ad795d1489fbeee72 | tar -x -C /tmp/mkp02   # 0.2.10, from main
cd /tmp/mkp02 && npx -y pnpm@10.34.9 install --frozen-lockfile
node tools/migrate-0.2/frozen/build.mjs --root02 /tmp/mkp02 --commit e896e6b2f73ba99ffb86261ad795d1489fbeee72
```

Over 0.2's examples and widget documents, its output is the same as the corpus run's (0.2.10's CLI,
then `bin/migrate.mjs`), document for document.
