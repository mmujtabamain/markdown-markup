// Each recipe, built, opened in Chromium and used the same way: the document draws, a check sends a
// signal the host shows, a theme change keeps what the reader typed, and hiding the document
// unmounts it (showing it again starts afresh). Nothing logs an error.
import { expect, test } from '@playwright/test';
import { existsSync } from 'node:fs';
import { dirname, extname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = resolve(dirname(fileURLToPath(import.meta.url)), '..');
// where each recipe's site is, once built
const SITES: Record<string, string> = {
  Vue: 'vue/dist',
  Svelte: 'svelte/dist',
  Solid: 'solid/dist',
  Angular: 'angular/dist/browser',
  Astro: 'astro/dist',
  'plain JS': 'plain',
};
const TYPES: Record<string, string> = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.md': 'text/markdown', '.json': 'application/json' };

for (const [name, dir] of Object.entries(SITES)) {
  test(`MKP in ${name}`, async ({ page }) => {
    const root = join(here, dir);
    expect(existsSync(join(root, 'index.html')), `${dir}: run npm run setup && npm run build`).toBe(true);
    const errors: string[] = [];
    page.on('pageerror', (e) => errors.push(e.message));
    page.on('console', (m) => void (m.type() === 'error' && errors.push(m.text())));
    // the site, served as a static host would
    await page.route('http://recipe.test/**', (r) => {
      const path = new URL(r.request().url()).pathname;
      const file = join(root, path.endsWith('/') ? `${path}index.html` : path);
      return existsSync(file) ? r.fulfill({ path: file, contentType: TYPES[extname(file)] }) : r.fulfill({ status: 404 });
    });
    await page.goto('http://recipe.test/');
    await expect(page.getByRole('heading', { level: 2 })).toHaveText(`MKP in ${name}`);
    await expect(page.locator('.mkp-root h1')).toHaveText('Check an answer');

    const field = page.getByLabel('your answer');
    await field.fill('Bergen');
    await field.press('Enter');
    await expect(page.locator('[data-said]')).toHaveText('answered: Bergen (wrong)');
    await field.fill('oslo');
    await page.getByRole('button', { name: 'Check' }).click();
    await expect(page.locator('[data-said]')).toHaveText('answered: oslo (right)');
    await expect(page.getByText('Right.')).toBeVisible();

    await page.getByRole('button', { name: 'Dark' }).click();
    await expect(page.locator('.mkp-root')).toHaveAttribute('data-mkp-theme', 'dark');
    await expect(field).toHaveValue('oslo');
    await expect(page.getByText('Right.')).toBeVisible();

    await page.getByRole('button', { name: 'Hide' }).click();
    await expect(page.locator('.mkp-root')).toHaveCount(0);
    await page.getByRole('button', { name: 'Show' }).click();
    await expect(page.locator('.mkp-root h1')).toHaveText('Check an answer');
    await expect(page.getByLabel('your answer')).toHaveValue('');
    expect(errors).toEqual([]);
  });
}
