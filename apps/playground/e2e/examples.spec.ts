// Every example draws (no error node, no renderer error, no console error) at phone and desktop
// width, in light and dark; at the phone's width the page never scrolls sideways.
import { test } from '@playwright/test';
import { built, exampleIds, expect, go, horizontalOverflow, open, watchErrors } from './helpers';

const ids = exampleIds();

test('the sidebar lists every example in order, then the limits, then the cases', async ({ page }) => {
  await open(page, { e: ids[0] });
  const listed = await page.$$eval('aside a[data-pg-entry]', (as) => as.map((a) => a.getAttribute('data-pg-entry')!));
  expect(listed.filter((x) => x.startsWith('ex:'))).toEqual(ids);
  const kinds = listed.map((x) => x.split(':')[0]);
  expect(kinds.lastIndexOf('ex')).toBeLessThan(kinds.indexOf('limit'));
  // the cases are folded away until asked for
  await page.getByRole('button', { name: /^Cases/ }).click();
  const cases = await page.$$eval('aside a[data-pg-entry^="case:"]', (as) => as.length);
  expect(cases).toBeGreaterThan(30);
  // each example says what it teaches
  await expect(page.locator(`aside a[data-pg-entry="${ids[3]}"]`)).toContainText('the smallest inline definition');
});

for (const width of [390, 1280]) {
  for (const theme of ['light', 'dark']) {
    test(`every example draws at ${width} wide, ${theme}`, async ({ page }) => {
      await page.setViewportSize({ width, height: 860 });
      const errors = watchErrors(page);
      const failures: string[] = [];
      await open(page, { e: ids[0], theme, pane: 'preview' });
      for (const id of ids) {
        errors.length = 0;
        await go(page, { e: id, theme, pane: 'preview' });
        const status = await built(page, id);
        if (status !== 'drawn') {
          failures.push(`${id}: did not compile: ${await page.locator('[data-pg-preview]').innerText()}`);
          continue;
        }
        await page.waitForTimeout(120);
        const stage = page.locator('[data-pg-stage]');
        if (!(await stage.locator('.mkp-root > *').count())) failures.push(`${id}: drew nothing`);
        const nodes = await stage.locator('.mkp-error').allInnerTexts();
        if (nodes.length) failures.push(`${id}: error nodes: ${nodes.join(' | ')}`);
        if (await page.locator('[data-pg-render-error]').count()) failures.push(`${id}: the renderer stopped`);
        if ((await page.getAttribute('[data-pg-preview]', 'data-pg-theme')) !== theme) failures.push(`${id}: not ${theme}`);
        const dark = await page.evaluate(() => document.documentElement.classList.contains('dark'));
        if (dark !== (theme === 'dark')) failures.push(`${id}: the page is not ${theme}`);
        if (width === 390) {
          const over = await horizontalOverflow(page);
          if (over > 0) failures.push(`${id}: the page scrolls sideways by ${over}px`);
        }
        if (errors.length) failures.push(`${id}: ${errors.join(' | ')}`);
      }
      expect(failures).toEqual([]);
    });
  }
}

test('the width presets set the preview’s width, and the runtime reads it', async ({ page }) => {
  await open(page, { e: 'ex:09-on-a-phone' });
  for (const [preset, px, cls] of [
    ['phone', 390, 'narrow'],
    ['tablet', 768, 'medium'],
  ] as const) {
    await page.locator(`[data-pg-width="${preset}"]`).click();
    await expect(page.locator('[data-pg-measured]')).toHaveText(`${px} px · ${cls}`);
  }
  await page.locator('[data-pg-width="desktop"]').click();
  await expect(page.locator('[data-pg-measured]')).not.toHaveText(/^(390|768) px/);
});

test('gfx@1 off: the gfx example shows its Markdown instead, and still draws without error', async ({ page }) => {
  const errors = watchErrors(page);
  await open(page, { e: 'ex:21-gfx', gfx: '0' });
  await expect(page.locator('[data-pg-stage] .mkp-root > *').first()).toBeVisible();
  expect(await page.locator('[data-pg-stage] .mkp-error[role=alert]').count()).toBe(0);
  expect(errors).toEqual([]);
});

test('a conformance case draws its bundle, and plays its steps', async ({ page }) => {
  const errors = watchErrors(page);
  await open(page, { e: 'case:base.actions.1.bumped' });
  await expect(page.locator('[data-pg-stage] .mkp-root > *').first()).toBeVisible();
  await page.getByRole('button', { name: /Play the case/ }).click();
  await expect(page.locator('[data-pg-stage]')).toContainText('big big', { timeout: 10_000 });
  expect(errors).toEqual([]);
});
