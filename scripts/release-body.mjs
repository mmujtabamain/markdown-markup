#!/usr/bin/env node
// A release's notes on GitHub (spec note 138): its note (notes/<version>.md), then how to use each
// asset, with commands for this version. The dist tests run those commands.
//
//   node scripts/release-body.mjs [--version 0.1.0]     prints the title on the first line, then the body
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { compareVersions, readNote } from './check-notes.mjs';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');

/** The first release with mkp-page.js in the web zip and the React Native renderer beside it. */
export const PAGE_AND_NATIVE_SINCE = '0.2.4';
const shipsPageAndNative = (version) => compareVersions(version, PAGE_AND_NATIVE_SINCE) >= 0;

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
import { MkpDocument } from './vendor/mkp/mkp-react.js';   // React 19${compareVersions(version, '0.2.0') >= 0 ? "\nimport { mount } from './vendor/mkp/mkp-dom.js';           // anything else: mount(el, bundle)" : ''}${shipsPageAndNative(version) ? "\nimport { firstPaint } from './vendor/mkp/mkp-page.js';     // a build on Node: the first paint mount() takes over" : ''}
${fence}
The same files are at \`https://mmujtabamain.github.io/markdown-markup/v/${version}/\`.
${
  shipsPageAndNative(version)
    ? `
**\`mkp-react-native-${version}.zip\`** is the React Native renderer, as source for Metro to build with your app. It imports \`@mkp/core\`: alias that to the web zip's \`mkp-runtime.js\` (its README says how).
${fence}bash
mkdir -p vendor/mkp-react-native && unzip -q mkp-react-native-${version}.zip -d vendor && mv vendor/mkp-react-native-${version}/* vendor/mkp-react-native/
${fence}
`
    : ''
}
**\`SHA256SUMS\`**: \`sha256sum -c SHA256SUMS\`
`;
}

/** Where a release's full changelog is read: What's new on the site, at the version. */
export const changelogUrl = (version) => `https://mmujtabamain.github.io/markdown-markup/whats-new/#${version}`;

/** The release's title (its note's summary) and body: the short note, a link to its full changelog, then how to use each asset. */
export function releaseBody(version) {
  const n = readNote(readFileSync(join(root, 'notes', `${version}.md`), 'utf8'));
  const full = existsSync(join(root, 'changelog', `${version}.mkp.md`)) ? `**The full changelog** (what changed and why, the API, how to migrate): [What's new in ${version}](${changelogUrl(version)})\n\n` : '';
  return { title: `MKP ${version}: ${n.front.summary ?? ''}`.trim(), body: `${n.body.trim()}\n\n${full}${usage(version)}` };
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href && process.argv.includes('--write-dir')) {
  // every note's release text, one file each (<version>.md, its first line the title), for the
  // release job to compare with what each published release says
  const { readdirSync, writeFileSync, mkdirSync } = await import('node:fs');
  const dir = process.argv[process.argv.indexOf('--write-dir') + 1];
  mkdirSync(dir, { recursive: true });
  for (const f of readdirSync(join(root, 'notes')).filter((x) => /^\d+(\.\d+)*\.md$/.test(x))) {
    const v = f.slice(0, -3);
    const r = releaseBody(v);
    writeFileSync(join(dir, f), `${r.title}\n${r.body}`);
  }
} else if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  const a = process.argv.slice(2);
  const version = (a.includes('--version') ? a[a.indexOf('--version') + 1] : readFileSync(join(root, 'VERSION'), 'utf8')).trim();
  const r = releaseBody(version);
  process.stdout.write(`${r.title}\n${r.body}`);
}
