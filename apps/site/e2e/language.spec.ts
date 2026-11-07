// Where the language stops, and the output panes: each limit shows the error it expects at its
// line; a click on a diagnostic puts the cursor there; the Markdown preview, the IR, the
// interfaces; editing compiles as you type and the link carries the edit; a file opened from disk.
import { test } from '@playwright/test';
import { join } from 'node:path';
import { built, cursorLine, expect, go, horizontalOverflow, limits, open, ROOT, watchErrors } from './helpers';

test('each limit shows its expected error code at its line', async ({ page }) => {
  const errors = watchErrors(page);
  const all = limits();
  expect(all.length).toBeGreaterThanOrEqual(14);
  await open(page, { e: all[0].id, pane: 'source' });
  const failures: string[] = [];
  for (const l of all) {
    await go(page, { e: l.id });
    await built(page, l.id);
    // a runtime limit (line 0) is drawn in the block's place, and listed as such
    const sel = l.line ? `[data-pg-diag][data-code="${l.code}"][data-line="${l.line}"]` : `[data-pg-diag][data-code="${l.code}"][data-stage="draw"]`;
    try {
      await page.locator(`[data-pg-pane="source"] ${sel}`).first().waitFor({ state: 'attached', timeout: 10_000 });
    } catch {
      const got = await page.$$eval('[data-pg-pane="source"] [data-pg-diag]', (bs) => bs.map((b) => `${b.getAttribute('data-code')}@${b.getAttribute('data-line')}`));
      failures.push(`${l.id}: expected ${l.code} at ${l.line || 'drawing'}, got ${got.join(', ') || 'nothing'}`);
      continue;
    }
    if ((await page.getAttribute('[data-pg-limit]', 'data-pg-limit')) !== 'met') failures.push(`${l.id}: the banner does not say it fails as expected`);
    if (!l.line) {
      // and the drawing shows it
      const drawn = await page.locator('[data-pg-stage] .mkp-error').allInnerTexts();
      if (!drawn.length) failures.push(`${l.id}: no error drawn in the block's place`);
    }
  }
  expect(failures).toEqual([]);
  expect(errors).toEqual([]);
});

test('a limit’s error is underlined in the editor at its line', async ({ page }) => {
  await open(page, { e: 'limit:02-misspelt-prop' });
  const line = page.locator('.cm-line', { has: page.locator('.cm-lintRange-error') });
  await expect(line).toHaveCount(1);
  await expect(line).toContainText('wieght=bold');
  await expect(page.locator('.cm-lintRange-error')).toHaveText('wieght=bold');
});

test('clicking a diagnostic puts the editor’s cursor on its line', async ({ page }) => {
  await open(page, { e: 'limit:02-misspelt-prop' });
  expect(await cursorLine(page)).toBe(1);
  await page.locator('[data-pg-pane="source"] [data-pg-diag][data-code="mkp.unknown-prop"]').click();
  await expect.poll(() => cursorLine(page)).toBe(9);
  await expect(page.locator('.cm-editor')).toHaveClass(/cm-focused/);
  // from the Output pane's list too
  await go(page, { e: 'limit:11-continuation', out: 'diagnostics' });
  await page.locator('[data-pg-out="diagnostics"] [data-pg-diag][data-code="mkp.continuation"]').click();
  await expect.poll(() => cursorLine(page)).toBe(10);
});

test('a diagnostic in a pack’s file opens that file at its line', async ({ page }) => {
  await open(page, { e: 'limit:14-no-depends' });
  await page.locator('[data-pg-pane="source"] [data-pg-diag][data-code="mkp.unknown-widget"]').click();
  await expect(page.locator('[data-pg-file="examples/limits/14-no-depends/badges/badge.mkp"]')).toHaveAttribute('aria-selected', 'true');
  await expect(page.locator('[data-pg-editor]')).toHaveAttribute('data-pg-editor', 'examples/limits/14-no-depends/badges/badge.mkp');
  await expect.poll(() => cursorLine(page)).toBe(2);
});

test('on a phone, a click on a diagnostic in Output goes to the source at its line', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await open(page, { e: 'limit:13-raw-colour', pane: 'output', out: 'diagnostics' });
  await page.locator('[data-pg-out="diagnostics"] [data-pg-diag][data-code="mkp.style-token"]').click();
  await expect(page.locator('[data-pg-pane-tab="source"]')).toHaveAttribute('aria-selected', 'true');
  await expect(page.locator('[data-pg-pane="source"]')).toBeVisible();
  await expect.poll(() => cursorLine(page)).toBe(9);
});

test('the diagnostics are also JSON lines, as mkp check --format json prints them', async ({ page }) => {
  await open(page, { e: 'limit:01-yaml-item-type', out: 'diagnostics' });
  const lines = (await page.locator('[data-pg-out="diagnostics-json"]').innerText()).trim().split('\n');
  const first = JSON.parse(lines[0]) as Record<string, unknown>;
  expect(first).toMatchObject({ severity: 'error', code: 'mkp.input-type', file: 'examples/limits/01-yaml-item-type.mkp.md', line: 17 });
  expect(Object.keys(first).slice(0, 6)).toEqual(['severity', 'code', 'message', 'file', 'line', 'col']);
});

test('the Markdown preview draws the exported Markdown: alerts, a table, a picture, maths, footnotes', async ({ page }) => {
  const errors = watchErrors(page);
  await open(page, { e: 'ex:02-markdown-blocks', out: 'preview' });
  const md = page.locator('[data-pg-out="md-preview"]');
  await expect(md.locator('.markdown-alert-tip')).toContainText('Walk the sand');
  await expect(md.locator('.markdown-alert-warning .markdown-alert-title')).toHaveText('Warning');
  await expect(md.locator('table td').first()).toHaveText('Mon');
  await expect(md.locator('img')).toHaveJSProperty('complete', true);
  expect(await md.locator('img').evaluate((i: HTMLImageElement) => i.naturalWidth)).toBeGreaterThan(0);
  await go(page, { e: 'ex:03-code-and-maths', out: 'preview' });
  await expect(md.locator('.mkp-math svg').first()).toBeVisible();
  await expect(md.locator('.mkp-math-display svg').first()).toBeVisible();
  await go(page, { e: 'ex:01-markdown-text', out: 'preview' });
  await expect(md.locator('section.footnotes li')).toHaveCount(2);
  await expect(md.locator('input[type=checkbox]')).toHaveCount(3);
  expect(errors).toEqual([]);
});

test('the Markdown tab: toggles, answers, and a copy button', async ({ page }) => {
  // what Copy writes, kept where the test can read it (a headless clipboard may never answer)
  await page.addInitScript(() => {
    Object.defineProperty(navigator, 'clipboard', { value: { writeText: (t: string) => ((window as unknown as { copied: string }).copied = t, Promise.resolve()) } });
  });
  await open(page, { e: 'ex:14-check-an-answer', out: 'md' });
  const out = page.locator('[data-pg-out="md"]');
  await expect(out).toContainText('generated by mkp');
  const withAnswers = await out.innerText();
  // the Markdown's options are in a menu
  await page.locator('[data-pg-md-options]').click();
  await page.locator('[data-pg-toggle="answers"]').click();
  await expect(out).not.toHaveText(withAnswers);
  await page.locator('[data-pg-toggle="math"]').click();
  await expect(page.locator('[data-pg-toggle="math"]')).toHaveAttribute('data-state', 'unchecked');
  await page.keyboard.press('Escape');
  await page.locator('[data-pg-pane="output"] [data-pg-copy]').click();
  await expect(page.locator('[data-pg-pane="output"] [data-pg-copy]')).toHaveText(/Copied/);
  expect(await page.evaluate(() => (window as unknown as { copied: string }).copied)).toBe(await out.textContent());
});

test('the IR tab has the bundle, and the expanded IR its instances', async ({ page }) => {
  await open(page, { e: 'ex:05-counter', out: 'ir' });
  const ir = JSON.parse(await page.locator('[data-pg-out="ir"]').innerText()) as Record<string, unknown>;
  expect(ir).toMatchObject({ ir: 1, level: 'bundle' });
  expect(Object.keys(ir.defs as object)).toContain('$doc:counter@1');
  await go(page, { e: 'ex:05-counter', out: 'expanded' });
  await expect(page.locator('[data-pg-out="expanded"]')).toContainText('"inst"');
});

test('the Interfaces tab shows what a host finds: the blocks and the bundle’s interface', async ({ page }) => {
  await open(page, { e: 'ex:30-interface', out: 'interfaces' });
  const tab = page.locator('[data-pg-out="interfaces"]');
  await expect(tab.locator('[data-pg-block="0"]')).toContainText('scoreboard:scored@1');
  await expect(tab.locator('[data-pg-block="1"]')).toContainText('scoreboard:scored@1');
  await expect(tab).toContainText('$doc:thumbs@1');
  await expect(tab).toContainText('{got: int}');
});

test('the phone width has no horizontal scroll, in any pane or output tab', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await open(page, { e: 'ex:25-roots-of-unity', pane: 'source' });
  const failures: string[] = [];
  for (const id of ['ex:25-roots-of-unity', 'ex:18-frame-pane-zoom', 'limit:14-no-depends']) {
    for (const pane of ['source', 'preview']) {
      await go(page, { e: id, pane });
      if ((await horizontalOverflow(page)) > 0) failures.push(`${id} ${pane}`);
    }
    for (const out of ['md', 'preview', 'ir', 'expanded', 'interfaces', 'diagnostics']) {
      await go(page, { e: id, pane: 'output', out });
      await page.waitForTimeout(50);
      if ((await horizontalOverflow(page)) > 0) failures.push(`${id} output ${out}`);
    }
  }
  // the examples list opens as a sheet
  await page.locator('[data-pg-menu]').click();
  await expect(page.getByRole('dialog')).toBeVisible();
  if ((await horizontalOverflow(page)) > 0) failures.push('the sheet');
  await page.getByRole('dialog').locator('a[data-pg-entry="ex:05-counter"]').click();
  await built(page, 'ex:05-counter');
  await expect(page.getByRole('dialog')).toHaveCount(0);
  expect(failures).toEqual([]);
});

test('editing compiles as you type, and the link carries the edit', async ({ page, browser }) => {
  await open(page, { e: 'ex:04-hello' });
  await page.locator('.cm-content').click();
  await page.keyboard.press('ControlOrMeta+End');
  await page.keyboard.type('\nA line typed in the playground.\n');
  await expect(page.locator('[data-pg-out="md"]')).toContainText('A line typed in the playground.');
  await expect(page.locator('[data-pg-stage]')).toContainText('A line typed in the playground.');
  await expect.poll(() => page.evaluate(() => new URLSearchParams(location.hash.slice(1)).get('src'))).toBeTruthy();
  const url = page.url();
  // a typo is an error at once, underlined; fixing it draws again
  await page.keyboard.type('```hello\nsummary: s\nwat: 1\n```\n');
  await expect(page.locator('[data-pg-preview]')).toHaveAttribute('data-pg-status', 'failed');
  // a new reader with the link sees the edit
  const other = await browser.newPage();
  await other.goto(url);
  await built(other, 'ex:04-hello');
  await expect(other.locator('[data-pg-out="md"]')).toContainText('A line typed in the playground.');
  await expect(other.locator('aside a[data-pg-entry="ex:04-hello"] [aria-label="edited"]')).toHaveCount(1);
  // Reset puts the example back, and the link drops the edit
  await other.getByRole('button', { name: 'Reset' }).click();
  await expect(other.locator('[data-pg-out="md"]')).not.toContainText('A line typed in the playground.');
  await expect.poll(() => other.evaluate(() => new URLSearchParams(location.hash.slice(1)).get('src'))).toBeNull();
  await other.close();
});

test('a .mkp.md opened from disk, with its .mkp, compiles and draws', async ({ page }) => {
  const errors = watchErrors(page);
  await open(page, { e: 'ex:01-markdown-text' });
  const dir = join(ROOT, 'examples', '27-document-file');
  await page.locator('[data-pg-open]').setInputFiles([join(dir, 'doc.mkp.md'), join(dir, 'doc.mkp')]);
  await built(page, 'open:doc.mkp.md');
  await expect(page.locator('aside [data-pg-group="Opened"] a[data-pg-entry="open:doc.mkp.md"]')).toBeVisible();
  await expect(page.locator('[data-pg-file="opened/doc.mkp"]')).toBeVisible();
  await expect(page.locator('[data-pg-preview]')).toHaveAttribute('data-pg-status', 'drawn');
  // and its link carries the whole document
  await expect.poll(() => page.evaluate(() => new URLSearchParams(location.hash.slice(1)).get('src'))).toBeTruthy();
  expect(errors).toEqual([]);
});
