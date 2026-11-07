// @vitest-environment jsdom
// What's new: one page per release, each change a line with its demonstration under it, all of it
// compiling, and every page a release that has its note.
import { describe, expect, it } from 'vitest';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { act, render } from '@testing-library/react';
import { compileRelease, releases, WhatsNew } from '@/site/WhatsNew';

const root = join(__dirname, '../../..');

describe("What's new", () => {
  const list = releases();

  it('has pages newest first, each naming a release with its note, none ahead of VERSION', () => {
    const version = readFileSync(join(root, 'VERSION'), 'utf8').trim();
    expect(list.length).toBeGreaterThan(0);
    expect(list[0].version.localeCompare(version, undefined, { numeric: true })).toBeLessThanOrEqual(0);
    for (const r of list) expect(existsSync(join(root, 'notes', `${r.version}.md`))).toBe(true);
    expect(list.map((r) => r.version)).toEqual([...list.map((r) => r.version)].sort((a, b) => b.localeCompare(a, undefined, { numeric: true })));
  });

  it('compiles every page with no errors', () => {
    for (const r of list) expect(compileRelease(r).errors).toEqual([]);
  });

  it('puts a demonstration under every line: a widget or code before the next line', () => {
    for (const r of list) {
      const parts = r.text.split(/^### /m).slice(1);
      expect(parts.length).toBeGreaterThan(0);
      for (const p of parts) {
        const [line, ...rest] = p.split('\n');
        expect(line.trim().length, `${r.version}: an empty line`).toBeGreaterThan(0);
        expect(line, `${r.version}: "${line}" is one line, not a paragraph`).not.toMatch(/\. [A-Z]/);
        expect(rest.join('\n'), `${r.version}: "${line}" has nothing under it`).toMatch(/^```/m);
      }
    }
  });

  it('draws the pages live, under the site header with What’s new marked', async () => {
    const { container } = render(<WhatsNew />);
    await act(async () => {
      await new Promise((r) => setTimeout(r, 50));
    });
    expect(container.querySelector('[data-site-section="whats-new"]')?.getAttribute('aria-current')).toBe('page');
    expect(container.querySelectorAll('[data-release]').length).toBe(list.length);
    expect(container.querySelector('[data-release] .mkp-root')).not.toBeNull();
    expect(container.querySelector('.mkp-error')).toBeNull();
  });
});
