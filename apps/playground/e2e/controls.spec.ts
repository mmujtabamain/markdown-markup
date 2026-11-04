// The shadcn controls that need a real browser (portals, hover), driving the runtime.
import { expect, test } from '@playwright/test';

const open = (page: import('@playwright/test').Page, id: string) => page.goto(`/#${new URLSearchParams({ e: id })}`);

test('a menu is a Select: picking an option changes the value and closes it', async ({ page }) => {
  await open(page, 'case:mkp-ui/select@1/menu');
  const trigger = page.locator('.pg-stage [data-slot=select-trigger]');
  await trigger.waitFor();
  const before = (await trigger.textContent())!;
  await trigger.click();
  const options = page.getByRole('option');
  const count = await options.count();
  expect(count).toBeGreaterThan(1);
  for (let i = 0; i < count; i++) {
    if ((await options.nth(i).textContent()) !== before) {
      await options.nth(i).click();
      break;
    }
  }
  await expect(page.getByRole('option')).toHaveCount(0);
  await expect(trigger).not.toHaveText(before);
});

test('a tooltip is a Tooltip: hovering shows it, and leaving hides it', async ({ page }) => {
  await open(page, 'case:mkp-ui/tooltip@1/term');
  const term = page.locator('.pg-stage [data-mkp=overlay]');
  await term.waitFor();
  await term.hover();
  await expect(page.getByRole('tooltip')).toBeVisible();
  // Radix keeps it open on the way to its content, until the pointer moves on past that
  await page.mouse.move(2, 2);
  await page.mouse.move(0, 0);
  await expect(page.getByRole('tooltip')).toHaveCount(0);
});

test('nothing moves on a click: the answer rows and the Check button stay put', async ({ page }) => {
  await open(page, 'case:mkp-learn/quiz.choice@1/multiple');
  const row = page.locator('.pg-stage [data-slot=option-row]').first();
  await row.waitFor();
  const check = page.locator('.pg-stage button', { hasText: 'Check' });
  const before = await check.boundingBox();
  await row.click();
  await expect(check).toHaveCount(1);
  expect(await check.boundingBox()).toEqual(before);
});
