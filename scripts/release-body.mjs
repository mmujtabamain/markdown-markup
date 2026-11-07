#!/usr/bin/env node
// A release's notes on GitHub (spec note 138): its note (notes/<version>.md), then how to use each
// asset, with commands for this version. The dist tests run those commands.
//
//   node scripts/release-body.mjs [--version 0.1.0]     prints the title on the first line, then the body
import { readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { readNote } from './check-notes.mjs';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');

/** How to use each asset of `version`: one line on what it is, and a few commands. */
export function usage(version) {
  const fence = '```';
  return `### Using it

**\`mkp-cli.mjs\`** is the CLI, in one file (Node 20.19+).
${fence}bash
node mkp-cli.mjs check lesson.mkp.md
node mkp-cli.mjs build lesson.mkp.md --target html --out out
${fence}

**\`mkp-web-${version}.zip\`** holds the files for web apps. They import each other: keep them in one folder.
${fence}bash
mkdir -p vendor/mkp && unzip -j mkp-web-${version}.zip -d vendor/mkp
${fence}
${fence}ts
import { compile, Runtime } from './vendor/mkp/mkp.js';     // typed by mkp.d.ts
import { MkpDocument } from './vendor/mkp/mkp-react.js';   // React 19
import { mount } from './vendor/mkp/mkp-dom.js';           // anything else: mount(el, bundle)
${fence}
The same files are at \`https://mmujtabamain.github.io/markdown-markup/v/${version}/\`.

**\`SHA256SUMS\`**: \`sha256sum -c SHA256SUMS\`
`;
}

/** The release's title (its note's summary) and body. */
export function releaseBody(version) {
  const n = readNote(readFileSync(join(root, 'notes', `${version}.md`), 'utf8'));
  return { title: `MKP ${version}: ${n.front.summary ?? ''}`.trim(), body: `${n.body.trim()}\n\n${usage(version)}` };
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  const a = process.argv.slice(2);
  const version = (a.includes('--version') ? a[a.indexOf('--version') + 1] : readFileSync(join(root, 'VERSION'), 'utf8')).trim();
  const r = releaseBody(version);
  process.stdout.write(`${r.title}\n${r.body}`);
}
