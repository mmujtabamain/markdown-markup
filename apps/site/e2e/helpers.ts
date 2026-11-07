// What the specs share: the examples and limits as they are on disk, a page that records console
// errors, and moving between entries the way a reader does (the URL's hash, no reload).
import { expect, type Page } from '@playwright/test';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import YAML from 'yaml';

export const ROOT = join(dirname(fileURLToPath(import.meta.url)), '../../..');

function front(text: string): Record<string, unknown> {
  const m = /^---\n([\s\S]*?)\n---/.exec(text);
  return m ? (YAML.parse(m[1]) as Record<string, unknown>) : {};
}

/** The examples, in reading order (ex:<folder>), then the base and derived widget pages
 *  (base:<name>, derived:<name>). */
export function exampleIds(): string[] {
  const dir = join(ROOT, 'examples');
  const ex = readdirSync(dir)
    .filter((n) => /^\d\d-/.test(n) && existsSync(join(dir, n, 'doc.mkp.md')))
    .sort()
    .map((n) => `ex:${n}`);
  const pages = (kind: 'base' | 'derived'): string[] =>
    readdirSync(join(ROOT, 'widgets', kind)).filter((n) => /^\d\d-.*\.mkp\.md$/.test(n)).sort().map((n) => `${kind}:${n.replace(/\.mkp\.md$/, '')}`);
  return [...ex, ...pages('base'), ...pages('derived')];
}

/** The limits, each with the error its front matter expects. */
export function limits(): { id: string; code: string; line: number; text: string }[] {
  const dir = join(ROOT, 'examples', 'limits');
  return readdirSync(dir)
    .filter((n) => n.endsWith('.mkp.md'))
    .sort()
    .map((n) => {
      const text = readFileSync(join(dir, n), 'utf8');
      const e = front(text).expect as { code: string; line: number };
      return { id: `limit:${n.replace(/\.mkp\.md$/, '')}`, code: e.code, line: Number(e.line), text };
    });
}

/** Console errors and uncaught exceptions on the page, as they happen. */
export function watchErrors(page: Page): string[] {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(`pageerror: ${e.message}`));
  page.on('console', (m) => {
    if (m.type() === 'error') errors.push(`console: ${m.text()}`);
  });
  return errors;
}

export function hashOf(state: Record<string, string | undefined>): string {
  const q = new URLSearchParams();
  for (const [k, v] of Object.entries(state)) if (v) q.set(k, v);
  return q.toString();
}

/** Opens the playground at a state (first visit), and waits for the entry to be built. */
export async function open(page: Page, state: Record<string, string | undefined>): Promise<void> {
  await page.goto(`/examples/#${hashOf(state)}`);
  await built(page, state.e!);
}

/** Moves to a state without reloading, as a click in the sidebar or Back does. */
export async function go(page: Page, state: Record<string, string | undefined>): Promise<void> {
  await page.evaluate((h) => {
    location.hash = h;
  }, hashOf(state));
  await built(page, state.e!);
}

/** Waits until the preview shows the entry, drawn or failed to compile. */
export async function built(page: Page, id: string): Promise<string> {
  const sel = `[data-pg-preview][data-pg-entry="${id}"]:is([data-pg-status="drawn"], [data-pg-status="failed"])`;
  await page.waitForSelector(sel, { state: 'attached', timeout: 120_000 });
  return (await page.getAttribute(sel, 'data-pg-status'))!;
}

/** The page scrolls sideways (it must not; panes may scroll inside themselves). */
export async function horizontalOverflow(page: Page): Promise<number> {
  return page.evaluate(() => document.scrollingElement!.scrollWidth - document.scrollingElement!.clientWidth);
}

export async function cursorLine(page: Page): Promise<number> {
  return Number(await page.locator('[data-pg-editor]').getAttribute('data-cursor-line'));
}

export { expect };
