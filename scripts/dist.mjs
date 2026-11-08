#!/usr/bin/env node
// A release's files (spec note 138), built from the TypeScript source into dist/:
//
//   mkp-web-<version>.zip  the web files, which import each other, in one folder mkp-web-<version>/:
//                          mkp.js (the core, ESM), mkp-runtime.js (its runtime half alone, for a host
//                          that draws bundles compiled ahead of time; the two share mkp-shared.js),
//                          maths-engine.js (loaded when maths shows),
//                          mkp.d.ts (the core's types, one self-contained header), mkp-react.js (the
//                          React renderer, React left out), mkp-react.d.ts, mkp-dom.js (mount() for any
//                          framework or none, React inside), mkp-dom.d.ts, mkp-page.js (firstPaint()
//                          for a Node build: a document's first paint, React's server renderer
//                          inside), mkp-page.d.ts, mkp.css (MKP's stylesheet, for documents drawn
//                          with styles: 'external'), README.txt
//   mkp-react-native-<version>.zip  the React Native renderer as source, for Metro to build with
//                          the app (it imports @mkp/core: alias it to the web zip's mkp-runtime.js)
//   mkp-cli.mjs            the CLI in one file (core, maths engine, --target html's page script inside)
//   SHA256SUMS             checksums of the three
//   web/                   the web files unpacked, as GitHub Pages serves them under /v/<version>/
//
//   node scripts/dist.mjs [--version 0.3.0] [--out dist]     (the version is VERSION's by default)
//
// Every file starts with a /*! mkp <version> <commit> */ banner; mkp.js exports VERSION.
import { build } from 'esbuild';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { chmodSync, copyFileSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const args = process.argv.slice(2);
const opt = (f) => (args.includes(f) ? args[args.indexOf(f) + 1] : undefined);
const version = (opt('--version') ?? readFileSync(join(root, 'VERSION'), 'utf8')).trim().replace(/^v/, '');
if (!/^\d+(\.\d+)*$/.test(version)) throw new Error(`the version is whole numbers and dots, such as 0.3.0; found ${version}`);
const out = resolve(opt('--out') ?? join(root, 'dist'));
let commit = 'unknown';
try {
  commit = execFileSync('git', ['rev-parse', '--short=12', 'HEAD'], { cwd: root, encoding: 'utf8' }).trim();
} catch {
  // not a git checkout: the banner says so
}
const banner = `/*! mkp ${version} ${commit} */`;
const web = join(out, 'web');
rmSync(out, { recursive: true, force: true });
mkdirSync(web, { recursive: true });
const t0 = Date.now();
const define = { __MKP_VERSION__: JSON.stringify(version), 'process.env.NODE_ENV': '"production"' };

// the maths engine stays its own file beside mkp.js: loaded only when maths is drawn
const mathsBeside = {
  name: 'maths-beside',
  setup(b) {
    b.onResolve({ filter: /vendor\/maths-engine\.js$/ }, () => ({ path: './maths-engine.js', external: true }));
  },
};
// mkp-react.js and mkp-dom.js import only the core's runtime half, from the file beside them: a
// host that draws bundles compiled ahead of time never loads the compiler, checker or Markdown writer
const coreBeside = {
  name: 'core-beside',
  setup(b) {
    b.onResolve({ filter: /^@mkp\/core$/ }, () => ({ path: './mkp-runtime.js', external: true }));
  },
};

// mkp.js and mkp-runtime.js in one build, so every module the two share is in mkp-shared.js once:
// a page that loads both (compile, then mount) loads the runtime once, and Runtime is one class
const core = await build({
  entryPoints: { mkp: join(root, 'packages/core/src/index.ts'), 'mkp-runtime': join(root, 'packages/core/src/renderer.ts') },
  bundle: true,
  splitting: true,
  chunkNames: 'mkp-shared',
  format: 'esm',
  platform: 'neutral',
  mainFields: ['module', 'main'],
  target: 'es2022',
  minify: true,
  outdir: web,
  metafile: true,
  plugins: [mathsBeside],
  define,
  banner: { js: banner },
  legalComments: 'none',
  logLevel: 'warning',
});
// two entries share at most one chunk; a second would overwrite the first, so say so rather than ship it
const chunks = Object.keys(core.metafile.outputs).filter((f) => !/\/mkp(-runtime)?\.js$/.test(f));
if (chunks.length !== 1 || !chunks[0].endsWith('/mkp-shared.js')) throw new Error(`the core's build should make one shared file, mkp-shared.js; it made ${chunks.join(', ') || 'none'}`);
writeFileSync(join(web, 'maths-engine.js'), `${banner}\n${readFileSync(join(root, 'packages/core/vendor/maths-engine.js'), 'utf8')}`);
await build({
  entryPoints: [join(root, 'packages/react/src/index.tsx')],
  bundle: true,
  format: 'esm',
  platform: 'browser',
  target: 'es2022',
  jsx: 'automatic',
  minify: true,
  outfile: join(web, 'mkp-react.js'),
  external: ['react', 'react-dom', 'react/jsx-runtime', 'react-dom/client'],
  plugins: [coreBeside],
  define,
  banner: { js: banner },
  legalComments: 'none',
  logLevel: 'warning',
});
// mkp-dom.js: the same renderer behind mount(el, bundle), with its own React inside
await build({
  entryPoints: [join(root, 'packages/dom/src/index.tsx')],
  bundle: true,
  format: 'esm',
  platform: 'browser',
  target: 'es2022',
  jsx: 'automatic',
  minify: true,
  outfile: join(web, 'mkp-dom.js'),
  plugins: [coreBeside],
  define,
  banner: { js: banner },
  legalComments: 'none',
  logLevel: 'warning',
});

// mkp-page.js: firstPaint() for a build that runs on Node, drawing the HTML mount() takes over. The
// same renderer as mkp-dom.js with React's server renderer inside: its Node build (the browser one
// schedules with a MessageChannel, which keeps Node from exiting), whose built-ins it requires
// through a require made for the module, so the file stays plain ESM
await build({
  entryPoints: [join(root, 'packages/page/src/first-paint.tsx')],
  bundle: true,
  format: 'esm',
  platform: 'node',
  target: 'node20',
  jsx: 'automatic',
  minify: true,
  outfile: join(web, 'mkp-page.js'),
  plugins: [coreBeside],
  define,
  banner: { js: `${banner}\nimport { createRequire as __mkpRequire } from 'node:module';\nconst require = __mkpRequire(import.meta.url);` },
  legalComments: 'none',
  logLevel: 'warning',
});

// mkp-outline.js: a document's first paint from its source alone, before the rest of MKP loads:
// the widgets' boxes at their measured heights (outline(), places(), mergeSizes()). Tiny: the
// compiler's document splitter only, no compiler, no React
await build({
  entryPoints: [join(root, 'packages/dom/src/outline.ts')],
  bundle: true,
  format: 'esm',
  platform: 'browser',
  target: 'es2022',
  minify: true,
  outfile: join(web, 'mkp-outline.js'),
  define,
  banner: { js: banner },
  legalComments: 'none',
  logLevel: 'warning',
});

// mkp.css: MKP's stylesheet in MKP's own look, with no document's tokens, for a page that draws
// many fragments or documents with styles: 'external' to load once. Taken from the renderer itself
// (mkpCss()), so it is the stylesheet each document would otherwise write
{
  const cssOut = join(mkdtempSync(join(tmpdir(), 'mkp-css-')), 'css.mjs');
  await build({ stdin: { contents: "export { mkpCss } from './packages/react/src/index.tsx';", resolveDir: root, loader: 'ts' }, bundle: true, format: 'esm', platform: 'node', jsx: 'automatic', outfile: cssOut, define, logLevel: 'warning', banner: { js: "import { createRequire as __r } from 'node:module'; const require = __r(import.meta.url);" } });
  const { mkpCss } = await import(cssOut);
  writeFileSync(join(web, 'mkp.css'), `${banner}\n${mkpCss()}\n`);
}

// the headers: one self-contained .d.ts for the core, and one for React that imports it. The React
// one is generated against the core's header posing as a package, so its core types stay imports
const tmp = mkdtempSync(join(tmpdir(), 'mkp-dts-'));
const dts = (cfg, entry, outFile, extra = []) => {
  const cfgFile = join(tmp, 'tsconfig.json');
  writeFileSync(cfgFile, JSON.stringify({ extends: join(root, 'tsconfig.json'), compilerOptions: { noEmit: false, declaration: true, emitDeclarationOnly: true, typeRoots: [join(root, 'node_modules/@types')], ...cfg.compilerOptions }, include: cfg.include }));
  execFileSync(join(root, 'node_modules/.bin/dts-bundle-generator'), ['--project', cfgFile, '--no-check', '--no-banner', ...extra, '-o', outFile, entry], { cwd: root, stdio: 'pipe' });
};
dts({ include: [join(root, 'packages/core/src')] }, join(root, 'packages/core/src/index.ts'), join(web, 'mkp.d.ts'));
const fake = join(tmp, 'node_modules/@mkp/core');
mkdirSync(fake, { recursive: true });
copyFileSync(join(web, 'mkp.d.ts'), join(fake, 'index.d.ts'));
dts({ include: [join(root, 'packages/react/src')], compilerOptions: { baseUrl: root, paths: { '@mkp/core': [join(fake, 'index.d.ts')] } } }, join(root, 'packages/react/src/index.tsx'), join(web, 'mkp-react.d.ts'), ['--external-imports', '@mkp/core', 'react', 'react-dom']);
dts({ include: [join(root, 'packages/dom/src'), join(root, 'packages/react/src')], compilerOptions: { baseUrl: root, paths: { '@mkp/core': [join(fake, 'index.d.ts')], '@mkp/react': [join(root, 'packages/react/src/index.tsx')] } } }, join(root, 'packages/dom/src/index.tsx'), join(web, 'mkp-dom.d.ts'), ['--external-imports', '@mkp/core']);
dts({ include: [join(root, 'packages/dom/src')], compilerOptions: { baseUrl: root } }, join(root, 'packages/dom/src/outline.ts'), join(web, 'mkp-outline.d.ts'), []);
dts({ include: [join(root, 'packages/page/src'), join(root, 'packages/react/src')], compilerOptions: { baseUrl: root, paths: { '@mkp/core': [join(fake, 'index.d.ts')], '@mkp/react': [join(root, 'packages/react/src/index.tsx')] } } }, join(root, 'packages/page/src/first-paint.tsx'), join(web, 'mkp-page.d.ts'), ['--external-imports', '@mkp/core']);
rmSync(tmp, { recursive: true, force: true });
// mkp-runtime.d.ts names the runtime half's exports from mkp.d.ts, so a Runtime is one type whichever
// file it came from (its private fields make a second declaration of the class a different type)
{
  const ts = createRequire(join(root, 'package.json'))('typescript');
  const entry = join(root, 'packages/core/src/renderer.ts');
  const program = ts.createProgram([entry], { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext, moduleResolution: ts.ModuleResolutionKind.Bundler, noEmit: true });
  const checker = program.getTypeChecker();
  const names = checker.getExportsOfModule(checker.getSymbolAtLocation(program.getSourceFile(entry))).map((x) => x.name).sort();
  if (!names.includes('Runtime')) throw new Error(`mkp-runtime.d.ts: found no Runtime among the runtime half's exports (${names.length} names)`);
  writeFileSync(join(web, 'mkp-runtime.d.ts'), `// the runtime half of the core (mkp-runtime.js): its types are the core's, declared in mkp.d.ts\nexport {\n${names.map((n) => `  ${n},`).join('\n')}\n} from '@mkp/core';\n`);
}
for (const f of ['mkp.d.ts', 'mkp-runtime.d.ts', 'mkp-react.d.ts', 'mkp-dom.d.ts', 'mkp-page.d.ts', 'mkp-outline.d.ts']) {
  const p = join(web, f);
  const text = readFileSync(p, 'utf8').replace(/from ["']@mkp\/core["']/g, "from './mkp.js'");
  writeFileSync(p, `${banner}\n${text}`);
}

writeFileSync(
  join(web, 'README.txt'),
  `MKP ${version} (${commit}): the web files. They import each other: keep them in one folder.

  mkp.js          the core: compile, Runtime, writeMarkdown, the checker and printers. Types: mkp.d.ts
  mkp-runtime.js  the core's runtime half alone (Runtime, needsMaths, the maths engine's loader…):
                  enough to draw a bundle compiled ahead of time. mkp-react.js and mkp-dom.js
                  import it, so they load no compiler. Types: mkp-runtime.d.ts
  mkp-shared.js   the code mkp.js and mkp-runtime.js share, so a page loading both loads it once
  maths-engine.js loaded when a document shows maths the build has not already typeset
  mkp-react.js    draws documents in React 19: MKP's own look by default, or pass components=
                  for your design system. Types: mkp-react.d.ts
  mkp-dom.js      draws documents into an element, from Vue, Svelte, Angular or plain JS: MKP's
                  own look, its own React inside. Types: mkp-dom.d.ts
  mkp-outline.js  outline(source, sizes, { width, prose }): a document's first paint before the
                  rest of MKP loads, each widget's box at the height mount()'s onSizes measured;
                  mount(el, bundle, { places: true }) then draws the widgets into those boxes.
                  Tiny: no compiler, no React. Types: mkp-outline.d.ts
  mkp.css         MKP's stylesheet in its own look, for a page whose documents or first paints are
                  drawn with styles: 'external' (each then writes only its own tokens): load it once
  mkp-page.js     firstPaint(bundle, options): a document's first paint as HTML, for a build on
                  Node 20+ to put in the page; mount(el, bundle, { hydrate: true }) takes it over.
                  React's server renderer inside. Types: mkp-page.d.ts

  import { compile, Runtime } from './vendor/mkp/mkp.js';
  import { MkpDocument } from './vendor/mkp/mkp-react.js';     // React
  import { mount } from './vendor/mkp/mkp-dom.js';             // anything else
  import { firstPaint } from './vendor/mkp/mkp-page.js';       // a build on Node

Unlicensed: all rights reserved. https://github.com/mmujtabamain/markdown-markup
`,
);

// the CLI: its own build (core, maths engine and the page script inside), as ESM-run by node
const cliDist = mkdtempSync(join(tmpdir(), 'mkp-cli-'));
execFileSync(process.execPath, [join(root, 'packages/cli/scripts/build.mjs')], { stdio: 'ignore', env: { ...process.env, MKP_VERSION: version, MKP_CLI_DIST: cliDist } });
const cjs = readFileSync(join(cliDist, 'mkp.cjs'), 'utf8').replace(/^#!.*\n/, '');
// an .mjs file is a module to node: the bundle (CommonJS) runs inside a require() made for it
const cli = `#!/usr/bin/env node\n${banner}\nimport { createRequire as __mkpRequire } from 'node:module';\nconst require = __mkpRequire(import.meta.url);\nconst module = { exports: {} };\nconst exports = module.exports;\nconst __filename = new URL(import.meta.url).pathname;\nconst __dirname = __filename.slice(0, __filename.lastIndexOf('/'));\n${cjs}`;
writeFileSync(join(out, 'mkp-cli.mjs'), cli);
chmodSync(join(out, 'mkp-cli.mjs'), 0o755);

// the archive: the web files in one folder
const require = createRequire(join(root, 'packages/core/package.json'));
const { zipSync } = require('fflate');
const folder = `mkp-web-${version}`;
const entries = {};
for (const f of readdirSync(web).sort()) entries[`${folder}/${f}`] = [readFileSync(join(web, f)), { mtime: new Date(Date.UTC(1980, 0, 1)) }];
const zipName = `${folder}.zip`;
writeFileSync(join(out, zipName), zipSync(entries, { level: 9 }));

// the React Native renderer as source: React Native apps build their dependencies with Metro, from
// TypeScript, so it ships as its src/ with a package.json, and imports @mkp/core, which the app
// aliases to the web zip's mkp-runtime.js (it uses the runtime half only)
const rnPkg = JSON.parse(readFileSync(join(root, 'packages/react-native/package.json'), 'utf8'));
const rnFolder = `mkp-react-native-${version}`;
const rnEntries = {};
const at1980 = { mtime: new Date(Date.UTC(1980, 0, 1)) };
const addTree = (dir, into) => {
  for (const n of readdirSync(dir).sort()) {
    const p = join(dir, n);
    if (statSync(p).isDirectory()) addTree(p, `${into}/${n}`);
    else rnEntries[`${into}/${n}`] = [readFileSync(p), at1980];
  }
};
addTree(join(root, 'packages/react-native/src'), `${rnFolder}/src`);
const rnManifest = { name: '@mkp/react-native', version, description: rnPkg.description, main: 'src/index.tsx', types: 'src/index.tsx', 'react-native': 'src/index.tsx', peerDependencies: rnPkg.peerDependencies, peerDependenciesMeta: rnPkg.peerDependenciesMeta };
rnEntries[`${rnFolder}/package.json`] = [new TextEncoder().encode(JSON.stringify(rnManifest, null, 2) + '\n'), at1980];
rnEntries[`${rnFolder}/README.txt`] = [
  new TextEncoder().encode(`MKP ${version} (${commit}): the React Native renderer, as source for Metro to build with your app.

  1. Unzip it into your app, e.g. vendor/mkp-react-native, and the web zip beside it (vendor/mkp).
  2. It imports @mkp/core: alias that to the web zip's mkp-runtime.js (the runtime half: it draws
     bundles compiled ahead of time, with no compiler). In metro.config.js:
       resolver.extraNodeModules = { '@mkp/core': path.resolve(__dirname, 'vendor/mkp/mkp-runtime.js') };
     and in tsconfig.json, for types: "paths": { "@mkp/core": ["vendor/mkp/mkp-runtime.d.ts"] }
  3. Peer dependencies: ${Object.entries(rnPkg.peerDependencies).map(([k, v]) => `${k} ${v}`).join(', ')}; @shopify/react-native-skia only for gfx@1.

  import { MkpDocument } from './vendor/mkp-react-native/src';

Unlicensed: all rights reserved. https://github.com/mmujtabamain/markdown-markup
`),
  at1980,
];
const rnZip = `${rnFolder}.zip`;
writeFileSync(join(out, rnZip), zipSync(rnEntries, { level: 9 }));

const sha = (f) => createHash('sha256').update(readFileSync(join(out, f))).digest('hex');
writeFileSync(join(out, 'SHA256SUMS'), [zipName, rnZip, 'mkp-cli.mjs'].map((f) => `${sha(f)}  ${f}\n`).join(''));

const mb = (f) => `${(statSync(f).size / 1e6).toFixed(2)} MB`;
console.log(`mkp ${version} (${commit}) in ${Date.now() - t0} ms:`);
for (const f of readdirSync(web).sort()) console.log(`  web/${f.padEnd(18)} ${mb(join(web, f))}`);
console.log(`  ${zipName.padEnd(22)} ${mb(join(out, zipName))}\n  ${rnZip.padEnd(22)} ${mb(join(out, rnZip))}\n  mkp-cli.mjs            ${mb(join(out, 'mkp-cli.mjs'))}\n  SHA256SUMS`);

