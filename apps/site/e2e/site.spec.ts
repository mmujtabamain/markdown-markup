// The website: the landing page at /, the docs at docs/, and the links between them.
import { expect, test } from '@playwright/test';

// the site's version list comes from the Pages deploy; here it is given
test.beforeEach(async ({ page }) => {
  await page.route('**/v/index.json', (r) => r.fulfill({ json: { latest: '0.4.2', versions: ['0.4.2', '0.4.1'] } }));
});

test('the landing page draws its demo, names the latest release, and links to the docs', async ({ page }) => {
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
  await page.getByRole('link', { name: /Open the docs/ }).click();
  await expect(page).toHaveURL(/\/docs\/$/);
  await expect(page.locator('[data-pg-preview]')).toBeVisible();
  expect(errors).toEqual([]);
});

test('the docs link back home, and a link from before the move opens in the docs', async ({ page }) => {
  await page.goto('/#e=ex:05-counter');
  await expect(page).toHaveURL(/\/docs\/#e=ex%3A05-counter|\/docs\/#e=ex:05-counter/);
  await expect(page.locator('[data-pg-title]')).toContainText('A counter');
  await page.locator('[data-pg-home]').click();
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('Markdown that does things.');
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
