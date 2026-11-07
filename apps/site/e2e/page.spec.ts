// mkp build --target html: every example built to its standalone page, opened from disk (file://)
// in Chromium, at desktop width in light and dark and on a phone. Each one draws with no error, its
// page takes the document's own colours, nothing scrolls sideways, and every button's label stands
// out from the button. With scripts off, the page shows the document's Markdown.
import { expect, test, type Page } from '@playwright/test';
import { execFileSync } from 'node:child_process';
import { existsSync, mkdtempSync, readdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { ROOT } from './helpers';

const out = mkdtempSync(join(tmpdir(), 'mkp-pages-'));
const examples = readdirSync(join(ROOT, 'examples')).filter((n) => /^\d\d-/.test(n) && existsSync(join(ROOT, 'examples', n, 'doc.mkp.md'))).sort();
const cli = join(ROOT, 'packages/cli/dist/mkp.cjs');

test.beforeAll(() => {
  execFileSync(process.execPath, [join(ROOT, 'packages/cli/scripts/build.mjs')], { stdio: 'ignore' });
  for (const n of examples) {
    const dir = join(ROOT, 'examples', n);
    const pack = existsSync(join(dir, 'pack')) ? ['--pack', join(dir, 'pack')] : existsSync(join(dir, 'host')) ? ['--pack', join(dir, 'host')] : [];
    execFileSync(process.execPath, [cli, 'build', join(dir, 'doc.mkp.md'), ...pack, '--target', 'html,html-md', '--out', join(out, n), '--no-speech', '--no-lock'], { stdio: 'ignore' });
  }
});

/** What a drawn page shows that would be wrong. */
async function faults(page: Page): Promise<string[]> {
  return page.evaluate(() => {
    const rgb = (c: string): number[] => {
      const m = c.match(/[\d.]+/g)?.map(Number) ?? [0, 0, 0];
      return c.startsWith('color(') ? m.slice(0, 3).map((x) => x * 255) : m.slice(0, 3);
    };
    const lum = (c: string): number => {
      const [r, g, b] = rgb(c).map((x) => (x / 255 <= 0.03928 ? x / 255 / 12.92 : ((x / 255 + 0.055) / 1.055) ** 2.4));
      return 0.2126 * r + 0.7152 * g + 0.0722 * b;
    };
    const contrast = (a: string, b: string): number => {
      const [x, y] = [lum(a), lum(b)].sort((p, q) => q - p);
      return (x + 0.05) / (y + 0.05);
    };
    const opaque = (c: string): boolean => !/^rgba\(.*,\s*0\)$|^transparent$/.test(c) && !/\/\s*0\)$/.test(c);
    const behind = (el: Element | null): string => {
      for (let e = el; e; e = e.parentElement) {
        const c = getComputedStyle(e).backgroundColor;
        if (opaque(c)) return c;
      }
      return getComputedStyle(document.body).backgroundColor;
    };
    const out: string[] = [];
    for (const b of document.querySelectorAll<HTMLElement>('.mkp-page-doc button')) {
      if (!b.offsetParent) continue;
      for (const t of b.querySelectorAll<HTMLElement>('[data-mkp=text]')) {
        const label = (t.textContent ?? '').trim();
        if (label && contrast(getComputedStyle(t).color, behind(b)) < 3) out.push(`the label "${label}" hardly shows on its button`);
      }
    }
    const root = document.querySelector('.mkp-page-doc .mkp-root');
    if (!root) out.push('the document is not drawn');
    else if (getComputedStyle(document.body).backgroundColor !== getComputedStyle(root).backgroundColor) out.push("the page's colour is not the document's");
    if (document.documentElement.scrollWidth > innerWidth + 1) out.push('the page scrolls sideways');
    if (getComputedStyle(document.querySelector('#mkp-page > .mkp-md')!).display !== 'none') out.push('the Markdown fallback shows beside the drawing');
    return out;
  });
}

for (const n of examples) {
  test(`${n} as a page`, async ({ browser }) => {
    const url = pathToFileURL(join(out, n, 'doc.html')).href;
    for (const [width, scheme] of [[1100, 'light'], [1100, 'dark'], [390, 'light']] as const) {
      const ctx = await browser.newContext({ viewport: { width, height: 800 }, colorScheme: scheme });
      const page = await ctx.newPage();
      const errors: string[] = [];
      page.on('pageerror', (e) => errors.push(e.message));
      page.on('console', (m) => void (m.type() === 'error' && errors.push(m.text())));
      await page.goto(url);
      await page.locator('.mkp-page-doc .mkp-root').waitFor({ timeout: 30000 });
      await page.waitForTimeout(300);
      expect(errors, `${n} ${width} ${scheme}`).toEqual([]);
      expect(await faults(page), `${n} ${width} ${scheme}`).toEqual([]);
      await ctx.close();
    }
  });
}

test('a page takes #theme=dark from its URL, and shows its Markdown with scripts off', async ({ browser }) => {
  const url = pathToFileURL(join(out, '25-roots-of-unity', 'doc.html')).href;
  const dark = await browser.newPage({ colorScheme: 'light' });
  await dark.goto(url + '#theme=dark');
  await dark.locator('.mkp-page-doc .mkp-root').waitFor();
  expect(await dark.evaluate(() => getComputedStyle(document.body).backgroundColor)).toBe('rgb(21, 23, 26)');
  await dark.close();
  const ctx = await browser.newContext({ javaScriptEnabled: false });
  const off = await ctx.newPage();
  await off.goto(url);
  await expect(off.locator('#mkp-page > .mkp-md')).toBeVisible();
  await expect(off.locator('#mkp-page > .mkp-md h1')).toHaveText('Roots of unity');
  await expect(off.locator('#mkp-page > .mkp-md .mkp-math svg').first()).toBeVisible();
  await ctx.close();
});

test('the Markdown page draws the fallback with no script', async ({ page }) => {
  await page.goto(pathToFileURL(join(out, '31-markdown-output', 'doc.md.html')).href);
  await expect(page.locator('.mkp-md h1')).toHaveText('The coast walk');
  await expect(page.locator('.mkp-md table')).toBeVisible();
  expect(await page.locator('script:not([type])').count()).toBe(1);
});
