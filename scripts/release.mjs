#!/usr/bin/env node
// Builds the packages a host installs, as ordinary npm packages: built JavaScript, type declarations
// and a package.json with real dependencies, under the GitHub owner's scope so they can be published
// to GitHub Packages (npm.pkg.github.com). The workspace's own @mkp/* names stay as they are; the
// built files import each other by their published names.
//   node scripts/release.mjs [--version 0.3.0] [--only core,react] [--pack] [--out dir]
// Writes release/<name>/ (or <dir>/<name>/) for each package, and its .tgz with --pack. Prints what
// it made.
import { build } from 'esbuild';
import { execFileSync } from 'node:child_process';
import { cpSync, existsSync, mkdirSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const args = process.argv.slice(2);
const opt = (f) => (args.includes(f) ? args[args.indexOf(f) + 1] : undefined);
const out = resolve(opt('--out') ?? join(root, 'release'));

const SCOPE = '@mmujtabamain';
const REPO = 'https://github.com/mmujtabamain/markdown-markup';
/** The published name of a workspace package: @mkp/core → @mmujtabamain/mkp-core. */
const published = (name) => name.replace(/^@mkp\//, `${SCOPE}/mkp-`);

// what each package is built from; cli is one bundled file with core inside it
const PACKAGES = {
  core: { entry: 'src/index.ts', jsx: false, extra: ['vendor'] },
  react: { entry: 'src/index.tsx', jsx: true },
  shadcn: { entry: 'src/index.tsx', jsx: true },
  'react-native': { entry: 'src/index.tsx', jsx: true },
  cli: { bundle: true },
};
const only = opt('--only')?.split(',') ?? Object.keys(PACKAGES);
for (const n of only) if (!PACKAGES[n]) throw new Error(`no package "${n}"; the packages are ${Object.keys(PACKAGES).join(', ')}`);
const manifest = (n) => JSON.parse(readFileSync(join(root, 'packages', n, 'package.json'), 'utf8'));
const version = opt('--version')?.replace(/^v/, '') ?? manifest('core').version;
if (!/^\d+\.\d+\.\d+(-[\w.]+)?$/.test(version)) throw new Error(`--version takes a semver version such as 0.3.0; found ${version}`);

rmSync(out, { recursive: true, force: true });
mkdirSync(out, { recursive: true });

// @mkp/x imports stay imports, of the published package
const workspaceExternal = {
  name: 'workspace-external',
  setup(b) {
    b.onResolve({ filter: /^@mkp\// }, (a) => ({ path: published(a.path), external: true }));
    // the maths engine stays its own file beside the package (2.7 MB, loaded only when maths is drawn)
    b.onResolve({ filter: /vendor\/maths-engine\.js$/ }, () => ({ path: '../vendor/maths-engine.js', external: true }));
  },
};

// declarations for every library package in one run, then copied out per package
const libs = only.filter((n) => !PACKAGES[n].bundle);
const typesDir = join(out, '.types');
if (libs.length) {
  const cfg = join(out, 'tsconfig.types.json');
  writeFileSync(
    cfg,
    JSON.stringify({
      extends: join(root, 'tsconfig.json'),
      compilerOptions: {
        declaration: true,
        emitDeclarationOnly: true,
        noEmit: false,
        noEmitOnError: false,
        rootDir: join(root, 'packages'),
        outDir: typesDir,
        baseUrl: root,
        types: ['node'],
        paths: Object.fromEntries(Object.entries(PACKAGES).filter(([, p]) => !p.bundle).map(([n, p]) => [`@mkp/${n}`, [`packages/${n}/${p.entry}`]])),
      },
      include: libs.map((n) => join(root, 'packages', n, 'src')),
    }),
  );
  try {
    execFileSync(join(root, 'node_modules/.bin/tsc'), ['-p', cfg], { cwd: root, stdio: 'pipe' });
  } catch (e) {
    // type errors (e.g. React Native's own types, checked by its own tsconfig) still emit
    const text = String(e.stdout ?? '');
    if (!readdirSync(typesDir).length) throw new Error(`tsc emitted no declarations:\n${text}`);
  }
}

/** Every file under a folder. */
const files = (d) => readdirSync(d).flatMap((f) => (statSync(join(d, f)).isDirectory() ? files(join(d, f)) : [join(d, f)]));

const made = [];
for (const n of only) {
  const p = PACKAGES[n];
  const src = manifest(n);
  const dir = join(out, n);
  mkdirSync(join(dir, 'dist'), { recursive: true });
  const deps = Object.fromEntries(
    Object.entries(src.dependencies ?? {})
      .filter(([d]) => !(p.bundle && d.startsWith('@mkp/')))
      .map(([d, v]) => (d.startsWith('@mkp/') ? [published(d), version] : [d, v])),
  );
  const pkg = {
    name: published(src.name),
    version,
    description: src.description,
    license: 'UNLICENSED',
    repository: { type: 'git', url: `git+${REPO}.git`, directory: `packages/${n}` },
    publishConfig: { registry: 'https://npm.pkg.github.com' },
    ...(p.bundle ? {} : { type: 'module' }),
  };
  if (p.bundle) {
    // the CLI: core bundled in, the maths engine with it
    await build({
      entryPoints: [join(root, 'packages/cli/src/bin.ts')],
      bundle: true,
      platform: 'node',
      format: 'cjs',
      target: 'node20',
      outfile: join(dir, 'dist/mkp.cjs'),
      alias: { '@mkp/core': join(root, 'packages/core/src/index.ts') },
      banner: { js: '#!/usr/bin/env node' },
      legalComments: 'none',
      logLevel: 'warning',
    });
    Object.assign(pkg, { bin: { mkp: 'dist/mkp.cjs' }, files: ['dist'], engines: { node: '>=20.19' } });
  } else {
    const external = [...Object.keys(src.dependencies ?? {}), ...Object.keys(src.peerDependencies ?? {}), ...Object.keys(src.peerDependenciesMeta ?? {})];
    await build({
      entryPoints: [join(root, 'packages', n, p.entry)],
      bundle: true,
      format: 'esm',
      platform: 'neutral',
      target: 'es2022',
      outfile: join(dir, 'dist/index.js'),
      jsx: 'automatic',
      external: external.filter((e) => !e.startsWith('@mkp/')).flatMap((e) => [e, `${e}/*`]),
      plugins: [workspaceExternal],
      mainFields: ['module', 'main'],
      legalComments: 'none',
      logLevel: 'warning',
    });
    // declarations, importing each other by their published names
    const from = join(typesDir, n, 'src');
    for (const f of files(from)) {
      const to = join(dir, 'dist', relative(from, f));
      mkdirSync(dirname(to), { recursive: true });
      writeFileSync(to, readFileSync(f, 'utf8').replace(/(['"])@mkp\/([\w-]+)\1/g, (_, q, x) => `${q}${published(`@mkp/${x}`)}${q}`));
    }
    for (const e of p.extra ?? []) cpSync(join(root, 'packages', n, e), join(dir, e), { recursive: true });
    Object.assign(pkg, {
      main: 'dist/index.js',
      module: 'dist/index.js',
      types: 'dist/index.d.ts',
      exports: { '.': { types: './dist/index.d.ts', import: './dist/index.js', default: './dist/index.js' }, ...(n === 'core' ? { './maths-engine': './vendor/maths-engine.js' } : {}), './package.json': './package.json' },
      ...(n === 'react-native' ? { 'react-native': 'dist/index.js' } : {}),
      files: ['dist', ...(p.extra ?? [])],
      sideEffects: false,
      ...(src.peerDependencies ? { peerDependencies: src.peerDependencies } : {}),
      ...(src.peerDependenciesMeta ? { peerDependenciesMeta: src.peerDependenciesMeta } : {}),
    });
  }
  if (!p.bundle) {
    // only what the built code imports: core's maths-engine sources (mathjax-full, speech-rule-engine…)
    // are inside vendor/ already
    const code = readFileSync(join(dir, 'dist/index.js'), 'utf8');
    for (const d of Object.keys(deps)) if (!code.includes(`from "${d}"`) && !code.includes(`from "${d}/`) && !code.includes(`import("${d}`)) delete deps[d];
  }
  if (Object.keys(deps).length) pkg.dependencies = deps;
  writeFileSync(join(dir, 'package.json'), JSON.stringify(pkg, null, 2) + '\n');
  writeFileSync(join(dir, 'README.md'), `# ${pkg.name}\n\n${pkg.description}\n\nPart of Markdown Markup (MKP). See ${REPO} and its docs/integration-guide.md.\n`);
  made.push(dir);
}
rmSync(typesDir, { recursive: true, force: true });
rmSync(join(out, 'tsconfig.types.json'), { force: true });

for (const d of made) {
  if (args.includes('--pack')) {
    const tgz = execFileSync('npm', ['pack', '--silent', '--pack-destination', out], { cwd: d, encoding: 'utf8' }).trim().split('\n').pop();
    console.log(join(out, tgz));
  } else console.log(d);
}
