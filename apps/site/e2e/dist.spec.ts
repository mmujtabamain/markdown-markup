// A release's web files, used as an app would: unzipped into vendor/mkp, imported by a small React
// app, bundled, and opened in Chromium. The document draws in MKP's default look, its play button's ▶
// shows, and nothing logs an error.
import { expect, test } from '@playwright/test';
import { build } from 'esbuild';
import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { ROOT } from './helpers';

const app = mkdtempSync(join(tmpdir(), 'mkp-dist-app-'));

test.beforeAll(async () => {
  const out = join(app, 'dist');
  execFileSync(process.execPath, [join(ROOT, 'scripts/dist.mjs'), '--version', '0.0.1', '--out', out], { stdio: 'ignore', timeout: 400000 });
  mkdirSync(join(app, 'vendor/mkp'), { recursive: true });
  execFileSync('unzip', ['-q', '-j', join(out, 'mkp-web-0.0.1.zip'), '-d', join(app, 'vendor/mkp')]);
  writeFileSync(join(app, 'doc.json'), JSON.stringify(readFileSync(join(ROOT, 'examples/13-controls/doc.mkp.md'), 'utf8')));
  writeFileSync(
    join(app, 'app.tsx'),
    `import { createRoot } from 'react-dom/client';
import { compile, MathsEngine, Runtime } from './vendor/mkp/mkp.js';
import { MkpDocument } from './vendor/mkp/mkp-react.js';
import source from './doc.json';
const c = compile({ packs: [] });
const bundle = c.document(source, 'doc.mkp.md');
if (!bundle) throw new Error(JSON.stringify(c.diags.errors));
MathsEngine.create().then((maths) => {
  const runtime = new Runtime(bundle, { capabilities: ['core@1'], maths });
  createRoot(document.getElementById('root')!).render(<MkpDocument bundle={bundle} runtime={runtime} />);
});`,
  );
  await build({
    entryPoints: [join(app, 'app.tsx')],
    bundle: true,
    format: 'iife',
    jsx: 'automatic',
    outfile: join(app, 'app.js'),
    nodePaths: [join(ROOT, 'packages/react/node_modules')],
    define: { 'process.env.NODE_ENV': '"production"' },
    logLevel: 'error',
  });
  writeFileSync(join(app, 'index.html'), '<!doctype html><meta charset="utf-8"><div id="root"></div><script src="app.js"></script>');
});

test("a React app draws a document with the release's files, in MKP's default look", async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('console', (m) => void (m.type() === 'error' && errors.push(m.text())));
  await page.goto(pathToFileURL(join(app, 'index.html')).href);
  await expect(page.locator('.mkp-root h1')).toHaveText('Brewing tea');
  const play = page.locator('.mkp-press[data-emphasis=high]').first();
  await expect(play).toBeVisible();
  const [ink, bg] = await play.evaluate((b) => [getComputedStyle(b.querySelector('[data-mkp=text]')!).color, getComputedStyle(b).backgroundColor]);
  expect(ink).not.toBe(bg);
  await page.getByRole('button', { name: /step/ }).filter({ hasText: '›' }).first().click();
  await expect(page.getByText('Warm the pot.')).toBeVisible();
  expect(errors).toEqual([]);
});
