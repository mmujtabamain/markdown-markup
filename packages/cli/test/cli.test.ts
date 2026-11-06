// The mkp CLI end to end, through its bundled build, on the examples.
import { describe, expect, it, beforeAll } from 'vitest';
import { execFileSync, spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, existsSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../../../', import.meta.url));
const cli = join(root, 'packages/cli/dist/mkp.cjs');
const ex = (name: string) => join(root, 'examples', name);
const units = ['--pack', join(ex('29-a-pack'), 'pack')];
const run = (args: string[], cwd = root, input?: string) => spawnSync(process.execPath, [cli, ...args], { cwd, encoding: 'utf8', timeout: 120000, input });

beforeAll(() => {
  execFileSync(process.execPath, [join(root, 'packages/cli/scripts/build.mjs')], { stdio: 'ignore', timeout: 120000 });
});

describe('mkp CLI', () => {
  it('index prints one line per widget', () => {
    const r = run(['index', ...units]);
    expect(r.status).toBe(0);
    expect(r.stdout).toMatch(/^distance@1\(km: num, label: text = ""\) — A distance in kilometres/m);
  });
  it('show prints the signature, what is required, and a fixture as YAML', () => {
    const r = run(['show', 'distance', ...units]);
    expect(r.stdout).toContain('km: num (required)');
    expect(r.stdout).not.toContain('label: text = "" (required)');
    expect(r.stdout).toContain('example (fixture marathon)');
    expect(r.stdout).toContain('km: 42.195');
  });
  it('show --source --as prints a copy to edit, with the private fn it uses', () => {
    const r = run(['show', 'tally', '--pack', join(ex('28-copy-and-edit'), 'pack'), '--source', '--as', 'score']);
    expect(r.status, r.stderr).toBe(0);
    expect(r.stdout).toMatch(/^# from scores:tally@1 sha256:[0-9a-f]{64}\n\nscore "Marks out of a total/);
    expect(r.stdout).toContain('fn said(got: int, of: int): text');
    // the copy in example 28 came from this command: its first line is still true
    expect(readFileSync(join(ex('28-copy-and-edit'), 'doc.mkp.md'), 'utf8')).toContain(r.stdout.split('\n')[0]);
  });
  it('schema prints JSON Schema for a widget and for the IR', () => {
    const s = JSON.parse(run(['schema', 'distance', ...units]).stdout);
    expect(s.properties.km.type).toBe('number');
    expect(JSON.parse(run(['schema', 'ir/bundle']).stdout).title).toBe('MKP bundle');
  });
  it('build writes IR, expanded IR and Markdown for a document with its own definitions', () => {
    const out = mkdtempSync(join(tmpdir(), 'mkp-'));
    const doc = join(ex('25-roots-of-unity'), 'doc.mkp.md');
    for (const target of ['ir', 'ir-expanded', 'md']) {
      const r = run(['build', doc, '--target', target, '--md', 'gfm,math,images', '--out', out, '--no-speech']);
      expect(r.status, r.stderr).toBe(0);
    }
    const ir = JSON.parse(readFileSync(join(out, 'doc.ir.json'), 'utf8'));
    expect(ir.level).toBe('bundle');
    expect(Object.keys(ir.defs)).toContain('$doc:roots@1');
    expect(JSON.parse(readFileSync(join(out, 'doc.expanded.json'), 'utf8')).level).toBe('expanded');
    expect(readFileSync(join(out, 'doc.md'), 'utf8')).toContain('> [!TIP]');
    // no pack, no lock
    expect(existsSync(join(ex('25-roots-of-unity'), 'mkp.lock'))).toBe(false);
  });
  it('build --target html writes one offline page that draws the document, its Markdown inside it', () => {
    const out = mkdtempSync(join(tmpdir(), 'mkp-'));
    const r = run(['build', join(ex('18-frame-pane-zoom'), 'doc.mkp.md'), '--target', 'html,html-md', '--out', out, '--no-speech']);
    expect(r.status, r.stderr).toBe(0);
    const page = readFileSync(join(out, 'doc.html'), 'utf8');
    expect(page).toMatch(/^<!doctype html>/);
    expect(page).toContain('<title>A floor plan</title>');
    // the bundle, the page script and the Markdown for readers with scripts off
    const json = /<script type="application\/json" id="mkp-bundle">([\s\S]*?)<\/script>/.exec(page)![1];
    expect(JSON.parse(json).level).toBe('bundle');
    expect(page).toContain('<article class="mkp-md">');
    expect(page).toContain('createRoot');
    // the picture beside the document is inside the page: no file to carry along
    expect(json).toContain('data:image/svg+xml;base64,');
    expect(json).not.toContain('"plan.svg"');
    const md = readFileSync(join(out, 'doc.md.html'), 'utf8');
    expect(md).toContain('<h1>A floor plan</h1>');
    expect(md).not.toContain('mkp-bundle');
    expect(md.length).toBeLessThan(page.length / 50);
  });
  it('build refuses a target it does not know, naming the ones it does', () => {
    const r = run(['build', join(ex('05-counter'), 'doc.mkp.md'), '--target', 'pdf', '--no-maths']);
    expect(r.status).not.toBe(0);
    expect(r.stderr).toContain('--target takes ir, ir-expanded, md, html, html-md; found pdf');
  });
  it('build reads the document file beside a document', () => {
    const r = run(['build', join(ex('27-document-file'), 'doc.mkp.md'), '--target', 'md', '--no-maths']);
    expect(r.status, r.stderr).toBe(0);
    expect(r.stdout).toContain('- Flour: 250 g');
  });
  it('build writes the lock beside the document when it uses a pack (GAPS 14)', () => {
    const dir = mkdtempSync(join(tmpdir(), 'mkp-'));
    writeFileSync(join(dir, 'run.mkp.md'), '```distance\nkm: 5\nsummary: A run.\n```\n');
    const r = run(['build', join(dir, 'run.mkp.md'), ...units, '--target', 'md', '--no-maths'], tmpdir());
    expect(r.status, r.stderr).toBe(0);
    expect(JSON.parse(readFileSync(join(dir, 'mkp.lock'), 'utf8')).defs['units:distance@1']).toMatch(/^sha256:/);
  });
  it('build leaves answers out with --no-answers (GAPS 166)', () => {
    const doc = join(ex('31-markdown-output'), 'doc.mkp.md');
    expect(run(['build', doc, '--target', 'md', '--no-maths']).stdout).toContain('Cove to Harbour');
    const r = run(['build', doc, '--target', 'md', '--no-maths', '--no-answers']);
    expect(r.status, r.stderr).toBe(0);
    expect(r.stdout).toContain('Which leg is the longest?');
    expect(r.stdout).not.toContain('Cove to Harbour');
  });
  it('build reports errors with file:line:col, code and the element path', () => {
    const dir = mkdtempSync(join(tmpdir(), 'mkp-'));
    writeFileSync(join(dir, 'bad.mkp.md'), '```distance\nkm: far\nsummary: too far\n```\n');
    const r = run(['build', join(dir, 'bad.mkp.md'), ...units, '--no-maths', '--no-lock']);
    expect(r.status).toBe(1);
    expect(r.stderr).toMatch(/bad\.mkp\.md:2:1 error mkp\.input-type: km takes a number; found "far"\. Replace it, e\.g\. with km: 1/);
  });
  it('check --format json gives an agent one diagnostic a line, at the exact item', () => {
    const r = run(['check', join(root, 'examples/limits/01-yaml-item-type.mkp.md'), '--format', 'json', '--no-maths']);
    expect(r.status).toBe(1);
    const lines = r.stderr.trim().split('\n').map((l) => JSON.parse(l));
    expect(lines[0]).toMatchObject({ severity: 'error', code: 'mkp.input-type', line: 17, col: 5 });
    expect(run(['check', join(ex('04-hello'), 'doc.mkp.md'), '--no-maths']).status).toBe(0);
  });
  it('build reads stdin and writes several targets', () => {
    const out = mkdtempSync(join(tmpdir(), 'mkp-'));
    const src = readFileSync(join(ex('04-hello'), 'doc.mkp.md'), 'utf8');
    const ok = run(['build', '-', '--name', 'lesson.mkp.md', '--target', 'ir,md', '--out', out, '--no-speech', '--diagnostics', 'json'], root, src);
    expect(ok.status, ok.stderr).toBe(0);
    expect(JSON.parse(readFileSync(join(out, 'lesson.ir.json'), 'utf8')).doc.file).toBe('lesson.mkp.md');
    expect(run(['build', '-', '--target', 'ir,md'], root, '').status).not.toBe(0);
  });
  it('build without --out writes the whole bundle into a pipe, past 64 KiB', () => {
    const hello = readFileSync(join(ex('04-hello'), 'doc.mkp.md'), 'utf8');
    const many = hello + Array.from({ length: 400 }, (_, i) => `\n\`\`\`greeting\nname: reader ${i}\nsummary: Greeting ${i}.\n\`\`\`\n`).join('');
    const r = run(['build', '-', '--name', 'many.mkp.md', '--target', 'ir', '--no-maths'], root, many);
    expect(r.status, r.stderr).toBe(0);
    expect(r.stdout.length).toBeGreaterThan(65536);
    expect(JSON.parse(r.stdout).doc.body.length).toBeGreaterThan(400);
  });
  it('build refuses an anchor used twice, one of them inside a container', () => {
    const src = '```mkp\nbox "b"\n  in body slot\n  column\n    slot body\n  project md = "b"\n```\n\n:::box\nA tip.\n{#same}\n:::\n\nText.\n{#same}\n';
    const r = run(['build', '-', '--name', 'twice.mkp.md', '--no-maths', '--diagnostics', 'json'], root, src);
    expect(r.status).toBe(1);
    const errors = r.stderr.split('\n').filter((l) => l.startsWith('{')).map((l) => JSON.parse(l)).filter((d) => d.file === 'twice.mkp.md');
    expect(errors.map((d) => [d.code, d.line])).toEqual([['mkp.duplicate-anchor', 14]]);
  });
  it('fmt prints the canonical form, a document with its own definitions too', () => {
    const r = run(['fmt', join(ex('29-a-pack'), 'pack/distance.mkp'), ...units]);
    expect(r.status, r.stderr).toBe(0);
    expect(r.stdout).toContain('distance@1 "A distance in kilometres, with its miles beside it."');
    const d = run(['fmt', join(ex('05-counter'), 'doc.mkp.md')]);
    expect(d.status, d.stderr).toBe(0);
    expect(d.stdout).toContain('```mkp\ncounter "A number the reader steps up or down."');
  });
  it('pack writes a .mkpack that builds like the folder', () => {
    const dir = mkdtempSync(join(tmpdir(), 'mkp-'));
    const zip = join(dir, 'units.mkpack');
    expect(run(['pack', join(ex('29-a-pack'), 'pack'), '-o', zip]).status).toBe(0);
    expect(run(['index', '--pack', zip]).stdout).toContain('distance@1');
  });
});
