// The website: the landing page at /, the docs at docs/, the examples at examples/, and the links
// between them.
import { expect, test } from '@playwright/test';

// the site's version list comes from the Pages deploy; here it is given
test.beforeEach(async ({ page }) => {
  await page.route('**/v/index.json', (r) => r.fulfill({ json: { latest: '0.4.2', versions: ['0.4.2', '0.4.1'] } }));
});

test('the landing page draws its demo, names the latest release, and links to the docs and examples', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('console', (m) => void (m.type() === 'error' && errors.push(m.text())));
  await page.goto('/');
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('Markdown that does things.');
  // the demo is example 25, drawn here
  await expect(page.locator('[data-site-drawn] .mkp-root')).toContainText('Roots of unity');
  await page.getByRole('tab', { name: 'Markdown' }).click();
  await expect(page.locator('[data-site-demo] .pg-md h1')).toHaveText('Roots of unity');
  await page.getByRole('tab', { name: 'Source' }).click();
  await expect(page.locator('[data-site-demo] pre')).toContainText('roots "The n-th roots of unity');
  // the release the page offers is the site's latest
  await expect(page.locator('[data-site-version]')).toContainText('v0.4.2');
  await expect(page.locator('#get')).toContainText('releases/download/v0.4.2/mkp-web-0.4.2.zip');
  await page.getByRole('link', { name: 'Try the examples' }).click();
  await expect(page).toHaveURL(/\/examples\/$/);
  await expect(page.locator('[data-pg-preview]')).toBeVisible();
  await page.goBack();
  await page.getByRole('link', { name: /Read the docs/ }).click();
  await expect(page).toHaveURL(/\/docs\/$/);
  await expect(page.locator('article.doc h1')).toHaveText('Getting started');
  expect(errors).toEqual([]);
});

test('the examples link home and to the docs, and links from before each move open in the examples', async ({ page }) => {
  for (const old of ['/#e=ex:05-counter', '/docs/#e=ex:05-counter']) {
    await page.goto(old);
    await expect(page).toHaveURL(/\/examples\/#e=ex(%3A|:)05-counter/);
    await expect(page.locator('[data-pg-title]')).toContainText('A counter');
  }
  await page.locator('[data-site-section=docs]').click();
  await expect(page).toHaveURL(/\/docs\/$/);
  await page.goBack();
  await page.locator('[data-pg-home]').click();
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('Markdown that does things.');
});

test('the docs are static pages: no MKP, no script but the theme, every page linked in order', async ({ page }) => {
  const errors: string[] = [];
  const scripts: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('console', (m) => void (m.type() === 'error' && errors.push(m.text())));
  page.on('request', (r) => void (['script', 'fetch', 'xhr'].includes(r.resourceType()) && scripts.push(r.url())));
  await page.goto('/docs/');
  await expect(page.locator('article.doc h1')).toHaveText('Getting started');
  // the formula on Writing documents is an SVG written when the page was compiled
  await page.locator('.pages-list').getByRole('link', { name: 'Writing documents' }).click();
  await expect(page).toHaveURL(/\/docs\/writing\.html$/);
  await expect(page.locator('article.doc .mkp-math-display svg')).toBeVisible();
  // every page, in order, through next
  const titles = ['Writing documents', 'Your own widgets', 'The base set', 'In your app', 'Recipes', 'The CLI'];
  for (const t of titles.slice(1)) {
    await page.locator('.prev-next .next').click();
    await expect(page.locator('.pages-list [aria-current=page]')).toHaveText(t);
  }
  // the outline goes to a heading
  await page.goto('/docs/recipes.html');
  await page.locator('.outline').getByRole('link', { name: 'Angular' }).click();
  await expect(page.locator('h2#angular')).toBeInViewport();
  await expect(page.locator('article.doc')).toContainText("import { mount, type IRBundle, type MountedDocument, type SignalEvent } from './vendor/mkp/mkp-dom.js';");
  // a link to the examples opens them
  await page.goto('/docs/base-set.html');
  expect(scripts).toEqual([]);
  await page.locator('article.doc').getByRole('link', { name: 'press', exact: true }).click();
  await expect(page.locator('[data-pg-title]')).toContainText('press');
  expect(errors).toEqual([]);
});

test('the docs keep the site theme, and fit a phone with the pages in a menu', async ({ browser }) => {
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, colorScheme: 'light' });
  const page = await ctx.newPage();
  await page.goto('/docs/in-your-app.html');
  await expect(page.locator('article.doc h1')).toHaveText('In your app');
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(true);
  await page.locator('[data-theme-toggle]').click();
  await page.locator('.pages-menu summary').click();
  await page.locator('.pages-menu').getByRole('link', { name: 'The CLI' }).click();
  await expect(page.locator('article.doc h1')).toHaveText('The CLI');
  expect(await page.evaluate(() => document.documentElement.classList.contains('dark'))).toBe(true);
  await ctx.close();
});

test('the landing page fits a phone, in light and dark', async ({ browser }) => {
  for (const scheme of ['light', 'dark'] as const) {
    const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, colorScheme: scheme });
    const page = await ctx.newPage();
    await page.route('**/v/index.json', (r) => r.fulfill({ json: { latest: '0.4.2', versions: ['0.4.2'] } }));
    await page.goto('/');
    await expect(page.locator('[data-site-drawn] .mkp-root')).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(true);
    expect(await page.evaluate(() => document.documentElement.classList.contains('dark'))).toBe(scheme === 'dark');
    await ctx.close();
  }
});

test('the examples: one result at a time, switched in place, with the entry named above', async ({ page }) => {
  await page.goto('/examples/#e=ex:13-controls');
  await expect(page.locator('[data-pg-entry-head]')).toContainText('Brewing tea');
  // the preview is what shows first; the output is one switch away
  await expect(page.locator('[data-pg-stage]')).toBeVisible();
  await expect(page.locator('[data-pg-pane="output"]')).toBeHidden();
  await page.locator('[data-pg-result="md"]').click();
  await expect(page.locator('[data-pg-out="md"]')).toBeVisible();
  await expect(page.locator('[data-pg-stage]')).toBeHidden();
  await expect(page).toHaveURL(/out=md/);
  await page.locator('[data-pg-result="problems"]').click();
  await expect(page.locator('[data-pg-out="diagnostics"]')).toBeVisible();
  await page.locator('[data-pg-result="preview"]').click();
  await expect(page.locator('[data-pg-stage]')).toBeVisible();
  // next and previous follow the list
  await page.locator('[data-pg-next]').click();
  await expect(page).toHaveURL(/e=ex%3A14|e=ex:14/);
  await page.locator('[data-pg-prev]').click();
  await expect(page.locator('[data-pg-title]')).toHaveText('Brewing tea');
});
