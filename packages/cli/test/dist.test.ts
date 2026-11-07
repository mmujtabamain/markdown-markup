// scripts/dist.mjs: a release's files, used the way the release notes say, from folders that hold
// nothing else.
import { beforeAll, describe, expect, it } from 'vitest';
import { execFileSync, spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { cpSync, existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
// @ts-expect-error a plain .mjs script with no declarations
import { usage } from '../../../scripts/release-body.mjs';

const root = fileURLToPath(new URL('../../../', import.meta.url));
const out = mkdtempSync(join(tmpdir(), 'mkp-dist-'));
const version = '9.8.7';
const zip = `mkp-web-${version}.zip`;
const node = (args: string[], cwd: string) => spawnSync(process.execPath, args, { cwd, encoding: 'utf8', timeout: 120000 });
const ex = (name: string) => join(root, 'examples', name, 'doc.mkp.md');

/** A fresh folder holding only the web files, unzipped as the release notes say. */
function vendored(): string {
  const dir = mkdtempSync(join(tmpdir(), 'mkp-app-'));
  mkdirSync(join(dir, 'vendor/mkp'), { recursive: true });
  execFileSync('unzip', ['-q', '-j', join(out, zip), '-d', join(dir, 'vendor/mkp')]);
  return dir;
}

beforeAll(() => {
  execFileSync(process.execPath, [join(root, 'scripts/dist.mjs'), '--version', version, '--out', out], { stdio: 'pipe', timeout: 400000 });
}, 400000);

describe('the release files', () => {
  it('are the web archive, the CLI and the checksums; the archive holds the web files in one folder', () => {
    expect(readdirSync(out).sort()).toEqual(['SHA256SUMS', 'mkp-cli.mjs', zip, 'web']);
    const list = execFileSync('unzip', ['-Z1', join(out, zip)], { encoding: 'utf8' }).trim().split('\n').sort();
    expect(list).toEqual(['README.txt', 'maths-engine.js', 'mkp-dom.d.ts', 'mkp-dom.js', 'mkp-react.d.ts', 'mkp-react.js', 'mkp.d.ts', 'mkp.js'].map((f) => `mkp-web-${version}/${f}`));
    const sums = readFileSync(join(out, 'SHA256SUMS'), 'utf8');
    for (const f of [zip, 'mkp-cli.mjs']) expect(sums).toContain(`${createHash('sha256').update(readFileSync(join(out, f))).digest('hex')}  ${f}`);
  });
  it('say which version they are', () => {
    for (const f of ['mkp.js', 'maths-engine.js', 'mkp.d.ts', 'mkp-react.js', 'mkp-react.d.ts', 'mkp-dom.js', 'mkp-dom.d.ts']) expect(readFileSync(join(out, 'web', f), 'utf8')).toMatch(new RegExp(`^/\\*! mkp ${version.replace(/\./g, '\\.')} \\w+ \\*/`));
    expect(node([join(out, 'mkp-cli.mjs'), '--version'], out).stdout.trim()).toBe(version);
  });
});

describe('mkp.js, vendored', () => {
  it('compiles, runs and writes Markdown under Node, and exports its version', () => {
    const dir = vendored();
    writeFileSync(
      join(dir, 'run.mjs'),
      `import { compile, Runtime, writeMarkdown, MathsEngine, VERSION } from './vendor/mkp/mkp.js';
import { readFileSync } from 'node:fs';
const c = compile({ packs: [] });
const b = c.document(readFileSync(process.argv[2], 'utf8'), 'doc.mkp.md');
if (!b || !c.diags.ok) throw new Error(JSON.stringify(c.diags.errors));
new Runtime(b, { capabilities: ['core@1'] }).view();
const maths = await MathsEngine.create({ speech: false });
console.log(JSON.stringify({ VERSION, md: writeMarkdown(b, { toggles: ['gfm', 'math'], maths }).md }));`,
    );
    const r = node(['run.mjs', ex('25-roots-of-unity')], dir);
    expect(r.status, r.stderr).toBe(0);
    const o = JSON.parse(r.stdout);
    expect(o.VERSION).toBe(version);
    expect(o.md).toContain('# Roots of unity');
  });
  it('loads the maths engine only when it is asked for', () => {
    const dir = vendored();
    rmSync(join(dir, 'vendor/mkp/maths-engine.js'));
    writeFileSync(join(dir, 'run.mjs'), `import { compile, MathsEngine } from './vendor/mkp/mkp.js';\nconst c = compile({ packs: [] });\nconsole.log(c.document('# Hi\\n\\nNo maths here.\\n', 'a.mkp.md') ? 'compiled' : 'failed');\nawait MathsEngine.create().then(() => console.log('maths'), () => console.log('no maths'));`);
    const r = node(['run.mjs'], dir);
    expect(r.stdout.trim().split('\n')).toEqual(['compiled', 'no maths']);
  });
});

describe('the headers', () => {
  const tsc = join(root, 'node_modules/.bin/tsc');
  /** Type-checks `files` in an app beside the vendored web files; React's types come from this repo. */
  function typecheck(files: Record<string, string>): { status: number | null; out: string } {
    const dir = vendored();
    for (const [k, v] of Object.entries(files)) writeFileSync(join(dir, k), v);
    mkdirSync(join(dir, 'node_modules/@types'), { recursive: true });
    for (const t of ['react', 'react-dom']) symlinkSync(join(root, 'packages/react/node_modules/@types', t), join(dir, 'node_modules/@types', t));
    writeFileSync(join(dir, 'tsconfig.json'), JSON.stringify({ compilerOptions: { strict: true, noEmit: true, target: 'es2022', module: 'esnext', moduleResolution: 'bundler', jsx: 'react-jsx', lib: ['es2022', 'dom'], skipLibCheck: false }, files: Object.keys(files) }));
    const r = spawnSync(tsc, ['-p', dir], { encoding: 'utf8', timeout: 120000 });
    return { status: r.status, out: r.stdout + r.stderr };
  }
  it('type-check an app that uses the core, and catch a misspelt option', () => {
    const good = "import { compile, Runtime, type IRBundle } from './vendor/mkp/mkp.js';\nconst c = compile({ packs: [] });\nconst b: IRBundle | null = c.document('# Hi', 'a.mkp.md');\nif (b) new Runtime(b, { capabilities: ['core@1'] }).view();\n";
    expect(typecheck({ 'app.ts': good })).toEqual({ status: 0, out: '' });
    const bad = typecheck({ 'app.ts': "import { compile } from './vendor/mkp/mkp.js';\ncompile({ packz: [] });\n" });
    expect(bad.status).not.toBe(0);
    expect(bad.out).toContain("TS2561: Object literal may only specify known properties, but 'packz' does not exist in type 'CompileOptions'. Did you mean to write 'packs'?");
  });
  it('type-check a React app: the renderer takes the core header’s Runtime', () => {
    const app = "import { compile, Runtime } from './vendor/mkp/mkp.js';\nimport { MkpDocument } from './vendor/mkp/mkp-react.js';\nconst c = compile({ packs: [] });\nconst bundle = c.document('# Hi', 'a.mkp.md')!;\nconst runtime = new Runtime(bundle, {});\nexport const view = <MkpDocument bundle={bundle} runtime={runtime} theme=\"auto\" />;\n";
    expect(typecheck({ 'app.tsx': app })).toEqual({ status: 0, out: '' });
  });
  it('type-check a page that mounts a document, and catch a wrong theme', () => {
    const good = "import { compile } from './vendor/mkp/mkp.js';\nimport { mount, type MountedDocument } from './vendor/mkp/mkp-dom.js';\nconst b = compile({ packs: [] }).document('# Hi', 'a.mkp.md')!;\nconst v: MountedDocument = mount(document.body, b, { theme: 'dark', onSignal: (e) => console.log(e.name) });\nv.update({ theme: 'auto' });\nv.ready.then(() => v.runtime?.view());\n";
    expect(typecheck({ 'app.ts': good })).toEqual({ status: 0, out: '' });
    const bad = typecheck({ 'app.ts': "import { mount } from './vendor/mkp/mkp-dom.js';\ndeclare const b: Parameters<typeof mount>[1];\nmount(document.body, b, { theme: 'blue' });\n" });
    expect(bad.status).not.toBe(0);
    expect(bad.out).toContain('TS2322');
  });
});

describe('mkp-react.js, vendored', () => {
  it("draws a document with the app's own React, in MKP's default look", () => {
    const dir = vendored();
    mkdirSync(join(dir, 'node_modules'));
    for (const p of ['react', 'react-dom']) symlinkSync(join(root, 'packages/react/node_modules', p), join(dir, 'node_modules', p));
    writeFileSync(
      join(dir, 'run.mjs'),
      `import { createElement } from 'react';
import { renderToString } from 'react-dom/server';
import { compile, Runtime } from './vendor/mkp/mkp.js';
import { MkpDocument } from './vendor/mkp/mkp-react.js';
import { readFileSync } from 'node:fs';
const c = compile({ packs: [] });
const bundle = c.document(readFileSync(process.argv[2], 'utf8'), 'doc.mkp.md');
const runtime = new Runtime(bundle, { capabilities: ['core@1'] });
console.log(renderToString(createElement(MkpDocument, { bundle, runtime })));`,
    );
    const r = node(['run.mjs', ex('05-counter')], dir);
    expect(r.status, r.stderr).toBe(0);
    expect(r.stdout).toContain('class="mkp-root"');
    expect(r.stdout).toContain('A counter');
    expect(r.stdout).toContain('.mkp-press');
  });
});

describe('mkp-cli.mjs, alone in a folder', () => {
  it('checks and builds the examples to IR, Markdown and a page', () => {
    const dir = mkdtempSync(join(tmpdir(), 'mkp-cli-'));
    cpSync(join(out, 'mkp-cli.mjs'), join(dir, 'mkp-cli.mjs'));
    for (const name of ['05-counter', '18-frame-pane-zoom', '25-roots-of-unity']) {
      const c = node(['mkp-cli.mjs', 'check', ex(name)], dir);
      expect(c.status, c.stderr).toBe(0);
      const b = node(['mkp-cli.mjs', 'build', ex(name), '--target', 'ir,md,html', '--out', join(dir, name), '--no-speech'], dir);
      expect(b.status, b.stderr).toBe(0);
      expect(readdirSync(join(dir, name)).sort()).toEqual(['doc.html', 'doc.ir.json', 'doc.md']);
    }
  });
});

describe("the release notes' usage block", () => {
  it('works as written', () => {
    const text = usage(version) as string;
    const dir = mkdtempSync(join(tmpdir(), 'mkp-notes-'));
    cpSync(join(out, zip), join(dir, zip));
    cpSync(join(out, 'mkp-cli.mjs'), join(dir, 'mkp-cli.mjs'));
    cpSync(join(out, 'SHA256SUMS'), join(dir, 'SHA256SUMS'));
    cpSync(ex('25-roots-of-unity'), join(dir, 'lesson.mkp.md'));
    // every shell line in its bash blocks, run as written
    const lines = [...text.matchAll(/```bash\n([\s\S]*?)```/g)].flatMap((m) => m[1].trim().split('\n'));
    lines.push(text.match(/`(sha256sum -c SHA256SUMS)`/)![1]);
    expect(lines.length).toBe(4);
    for (const l of lines) {
      const r = spawnSync('bash', ['-c', l.replace(/^node /, `"${process.execPath}" `)], { cwd: dir, encoding: 'utf8', timeout: 120000 });
      expect(r.status, `${l}\n${r.stderr}`).toBe(0);
    }
    expect(existsSync(join(dir, 'out/lesson.html'))).toBe(true);
    // and its imports, from where the unzip put the files
    const imports = [...text.matchAll(/^import .*$/gm)].map((m) => m[0].replace(/\s*\/\/.*$/, '')).join('\n');
    mkdirSync(join(dir, 'node_modules'));
    for (const p of ['react', 'react-dom']) symlinkSync(join(root, 'packages/react/node_modules', p), join(dir, 'node_modules', p));
    writeFileSync(join(dir, 'app.mjs'), `${imports}\nconsole.log(typeof compile, typeof Runtime, typeof MkpDocument, typeof mount);`);
    const r = node(['app.mjs'], dir);
    expect(r.status, r.stderr).toBe(0);
    expect(r.stdout.trim()).toBe('function function function function');

  });
});
