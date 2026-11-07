// pnpm site:docs [--check]
//   The site's docs: docs-src/*.mkp.md, written in MKP, compiled once to static pages in
//   public/docs/ (committed). --check fails when a page is not what its source compiles to.
import { runTs } from '../../../scripts/run-ts.mjs';
// the entry runs from a bundle in a temporary folder: it is told where the site is
await runTs(new URL('./docs-entry.ts', import.meta.url).pathname, [new URL('..', import.meta.url).pathname, ...process.argv.slice(2)]);
