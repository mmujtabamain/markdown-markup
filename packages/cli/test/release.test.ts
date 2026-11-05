// scripts/release.mjs: the packages a host installs, built as ordinary npm packages.
import { describe, expect, it, beforeAll } from 'vitest';
import { execFileSync, spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../../../', import.meta.url));
const out = mkdtempSync(join(tmpdir(), 'mkp-release-'));
const pkg = (n: string) => JSON.parse(readFileSync(join(out, n, 'package.json'), 'utf8'));
const files = (d: string): string[] => readdirSync(d).flatMap((f) => (statSync(join(d, f)).isDirectory() ? files(join(d, f)) : [join(d, f)]));

beforeAll(() => {
  execFileSync(process.execPath, [join(root, 'scripts/release.mjs'), '--version', '9.8.7', '--only', 'core,react,cli', '--out', out], { stdio: 'pipe', timeout: 240000 });
}, 240000);

describe('the release build', () => {
  it('names each package under the owner’s scope, at the version given, for GitHub Packages', () => {
    for (const n of ['core', 'react', 'cli']) {
      expect(pkg(n).name).toBe(`@mmujtabamain/mkp-${n}`);
      expect(pkg(n).version).toBe('9.8.7');
      expect(pkg(n).publishConfig.registry).toBe('https://npm.pkg.github.com');
      expect(pkg(n).private).toBeUndefined();
    }
  });
  it('depends on its siblings by their published names and versions, and only on what it imports', () => {
    expect(pkg('react').dependencies).toEqual({ '@mmujtabamain/mkp-core': '9.8.7' });
    expect(pkg('react').peerDependencies).toMatchObject({ react: expect.any(String), 'react-dom': expect.any(String) });
    // the maths engine's sources are bundled in vendor/, so they are not dependencies
    expect(Object.keys(pkg('core').dependencies)).not.toContain('mathjax-full');
    expect(Object.keys(pkg('core').dependencies)).toContain('yaml');
    // the CLI is one file with core inside it
    expect(pkg('cli').dependencies).toBeUndefined();
    expect(pkg('cli').bin).toEqual({ mkp: 'dist/mkp.cjs' });
  });
  it('ships built JavaScript and declarations that never name a workspace package', () => {
    for (const n of ['core', 'react']) {
      const built = files(join(out, n, 'dist'));
      expect(built.some((f) => f.endsWith('index.js'))).toBe(true);
      expect(built.some((f) => f.endsWith('index.d.ts'))).toBe(true);
      for (const f of built) expect(readFileSync(f, 'utf8'), f).not.toMatch(/['"]@mkp\//);
    }
    expect(existsSync(join(out, 'core', 'vendor', 'maths-engine.js'))).toBe(true);
    expect(pkg('core').exports['./maths-engine']).toBe('./vendor/maths-engine.js');
  });
  it('builds a CLI that runs on its own', () => {
    const run = (doc: string) => spawnSync(process.execPath, [join(out, 'cli', 'dist', 'mkp.cjs'), 'check', join(root, doc), '--format', 'json'], { encoding: 'utf8' });
    expect(run('examples/05-counter/doc.mkp.md').status).toBe(0);
    const bad = run('examples/limits/02-misspelt-prop.mkp.md');
    expect(bad.status).toBe(1);
    expect(JSON.parse((bad.stdout + bad.stderr).trim().split('\n')[0]).code).toMatch(/^mkp\./);
  });
});
