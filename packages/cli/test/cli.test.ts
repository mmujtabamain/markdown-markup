// The mkp CLI end to end, through its bundled build.
import { describe, expect, it, beforeAll } from 'vitest';
import { execFileSync, spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, existsSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../../../', import.meta.url));
const cli = join(root, 'packages/cli/dist/mkp.cjs');
const packs = ['mkp-ui', 'mkp-math', 'mkp-learn', 'mkp-diagrams'].flatMap((p) => ['--pack', join(root, 'packs', p)]);
const ex = ['--pack', join(root, 'examples/spec18')];
const run = (args: string[], cwd = root) => spawnSync(process.execPath, [cli, ...args], { cwd, encoding: 'utf8', timeout: 120000 });

beforeAll(() => {
  execFileSync(process.execPath, [join(root, 'packages/cli/scripts/build.mjs')], { stdio: 'ignore', timeout: 120000 });
});

describe('mkp CLI', () => {
  it('index prints one line per widget', () => {
    const r = run(['index', ...packs, ...ex]);
    expect(r.status).toBe(0);
    expect(r.stdout).toMatch(/^roots@1\(n: int 2\.\.12 = 5, level: choice\(intro\|exam\) = intro, labels: bool = true\) — The n-th roots of unity/m);
  });
  it('show prints the signature and the first fixture', () => {
    const r = run(['show', 'roots', ...packs, ...ex]);
    expect(r.stdout).toContain('inputs:');
    expect(r.stdout).toContain('example (fixture fifth)');
  });
  it('schema prints JSON Schema for a widget and for the IR', () => {
    const r = run(['schema', 'roots', ...packs, ...ex]);
    const s = JSON.parse(r.stdout);
    expect(s.properties.n).toEqual({ type: 'integer', minimum: 2, maximum: 12, description: 'how many roots', default: 5 });
    expect(JSON.parse(run(['schema', 'ir/bundle']).stdout).title).toBe('MKP bundle');
  });
  it('build writes IR, expanded IR and Markdown, and a lock', () => {
    const out = mkdtempSync(join(tmpdir(), 'mkp-'));
    const doc = join(root, 'examples/spec18/roots.mkp.md');
    for (const target of ['ir', 'ir-expanded', 'md']) {
      const r = run(['build', doc, ...packs, ...ex, '--target', target, '--md', 'gfm,math,images', '--out', out, '--lock', join(out, 'mkp.lock'), '--no-speech']);
      expect(r.status, r.stderr).toBe(0);
    }
    expect(JSON.parse(readFileSync(join(out, 'roots.ir.json'), 'utf8')).level).toBe('bundle');
    expect(JSON.parse(readFileSync(join(out, 'roots.expanded.json'), 'utf8')).level).toBe('expanded');
    const md = readFileSync(join(out, 'roots.md'), 'utf8');
    expect(md).toContain('> [!TIP]');
    expect(existsSync(join(out, 'roots-1.svg'))).toBe(true);
    expect(JSON.parse(readFileSync(join(out, 'mkp.lock'), 'utf8')).packs.length).toBeGreaterThan(3);
  });
  it('build reports errors with file:line:col, code and the element path', () => {
    const dir = mkdtempSync(join(tmpdir(), 'mkp-'));
    writeFileSync(join(dir, 'bad.mkp.md'), '```roots\nn: 40\nsummary: too many\n```\n');
    const r = run(['build', join(dir, 'bad.mkp.md'), ...packs, ...ex, '--no-maths', '--no-lock']);
    expect(r.status).toBe(1);
    expect(r.stderr).toMatch(/bad\.mkp\.md:2:1 error mkp\.input-range: n is 40, outside 2\.\.12/);
  });
  it('build reads stdin, writes several targets and reports diagnostics as JSON lines', () => {
    const out = mkdtempSync(join(tmpdir(), 'mkp-'));
    const src = readFileSync(join(root, 'examples/spec18/roots.mkp.md'), 'utf8');
    const ok = spawnSync(process.execPath, [cli, 'build', '-', '--name', 'lesson.mkp.md', ...packs, ...ex, '--target', 'ir,md', '--out', out, '--no-lock', '--no-speech', '--diagnostics', 'json'], { cwd: root, input: src, encoding: 'utf8', timeout: 120000 });
    expect(ok.status).toBe(0);
    expect(JSON.parse(readFileSync(join(out, 'lesson.ir.json'), 'utf8')).doc.file).toBe('lesson.mkp.md');
    expect(readFileSync(join(out, 'lesson.md'), 'utf8').length).toBeGreaterThan(0);
    const bad = spawnSync(process.execPath, [cli, 'build', '-', '--name', 'bad.mkp.md', ...packs, ...ex, '--no-lock', '--no-maths', '--diagnostics', 'json'], { cwd: root, input: '```roots\nn: 40\nsummary: s\n```\n', encoding: 'utf8', timeout: 120000 });
    expect(bad.status).toBe(1);
    const lines = bad.stderr.trim().split('\n').map((l) => JSON.parse(l));
    expect(lines.some((l) => l.severity === 'error' && l.file === 'bad.mkp.md' && l.line >= 1 && typeof l.code === 'string')).toBe(true);
    expect(run(['build', '-', '--target', 'ir,md']).status).not.toBe(0);
  });
  it('fmt prints the canonical form', () => {
    const r = run(['fmt', join(root, 'packs/mkp-ui/card.mkp'), ...packs]);
    expect(r.status, r.stderr).toBe(0);
    expect(r.stdout).toContain('card@1 "A surface with an optional title, holding anything."');
  });
  it('pack writes a .mkpack that builds like the folder', () => {
    const dir = mkdtempSync(join(tmpdir(), 'mkp-'));
    const zip = join(dir, 'mkp-ui.mkpack');
    expect(run(['pack', join(root, 'packs/mkp-ui'), '-o', zip]).status).toBe(0);
    const r = run(['index', '--pack', zip]);
    expect(r.stdout).toContain('tabs@1');
  });
});
