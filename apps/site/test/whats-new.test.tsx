// @vitest-environment jsdom
// What's new is the changelog: every changelog/<version>.mkp.md, read into sections and items, drawn
// with filters by kind and words, older versions folded, a Versions index, and demos where a widget
// shows a change. The parser's widget count agrees with MKP's own.
import { afterEach, describe, expect, it } from 'vitest';
import { act, cleanup, fireEvent, render } from '@testing-library/react';
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { compile } from '@mkp/core';
import { filtered, longDate, readChangelog } from '@/site/changelog';
import { releases, WhatsNew } from '@/site/WhatsNew';

const root = join(__dirname, '../../..');
afterEach(() => {
  cleanup();
  location.hash = '';
});

const settle = async () =>
  act(async () => {
    await new Promise((r) => setTimeout(r, 20));
  });

describe('reading a changelog', () => {
  const sample = `---\nversion: 9.1.0\ndate: 2026-11-08\nsummary: "A sample: one of each."\n---\n# 9.1.0\n\nAn intro.\n\n## Breaking\n- **Gone.** Use the other.\n## New\n- **A widget.** It counts.\n  On two lines.\n\n\`\`\`mkp\nw "x"\n  text "hi"\n  project md = "hi"\n\`\`\`\n\n\`\`\`w\nsummary: s\n\`\`\`\n\n- **Code.** Run it:\n\n\`\`\`sh\nmkp migrate\n\`\`\`\n## API\n### Added\n\n**CLI**\n\n- \`mkp migrate\`\n## Migration\n\nRun mkp migrate.\n`;
  it('reads its front matter, intro, sections, items, API groups and demos', () => {
    const r = readChangelog(sample, 'changelog/9.1.0.mkp.md');
    expect([r.version, r.date, r.summary, r.intro]).toEqual(['9.1.0', '2026-11-08', 'A sample: one of each.', 'An intro.']);
    expect(r.sections.map((s) => `${s.kind}:${s.items.length}`)).toEqual(['Breaking:1', 'New:2', 'API:1', 'Migration:1']);
    const [widget, code] = r.sections[1].items;
    expect(widget.md).toBe('**A widget.** It counts.\n  On two lines.');
    expect(widget.demos).toEqual([0]);
    expect(code.md).toContain('```sh\nmkp migrate\n```');
    expect(code.demos).toEqual([]);
    expect(r.sections[2].items[0].group).toBe('Added · CLI');
    expect(r.widgets).toBe(1);
  });
  it('agrees with MKP on how many widget blocks every real changelog holds', () => {
    for (const f of readdirSync(join(root, 'changelog'))) {
      const src = readFileSync(join(root, 'changelog', f), 'utf8');
      const b = compile({ packs: [] }).document(src, f)!;
      expect(readChangelog(src, f).widgets, f).toBe(b.doc.body.filter((n) => n.def && !n.def.startsWith('core:')).length);
    }
  });
  it('filters by kind and by words; a match in the summary keeps the version, not every note', () => {
    const r = readChangelog(sample, 'x');
    expect(filtered(r, { kind: 'Breaking', words: '' }).count).toBe(1);
    expect(filtered(r, { kind: 'All', words: 'two lines' }).count).toBe(1);
    const head = filtered(r, { kind: 'All', words: 'sample' });
    expect([head.head, head.count]).toEqual([true, 0]);
    expect(longDate('2026-11-08')).toBe('8 November 2026');
  });
});

describe("What's new", () => {
  const list = releases();
  it('has every release with a changelog, newest first, and every note has its changelog', () => {
    expect(list[0].version).toBe(readFileSync(join(root, 'VERSION'), 'utf8').trim());
    expect(list.map((r) => r.version)).toEqual([...list.map((r) => r.version)].sort((a, b) => b.localeCompare(a, undefined, { numeric: true })));
    for (const f of readdirSync(join(root, 'notes')).filter((x) => /^\d/.test(x))) expect(existsSync(join(root, 'changelog', f.replace(/\.md$/, '.mkp.md'))), f).toBe(true);
  });
  it('draws each version, the newest three open, the rest folded with their notes counted', async () => {
    const { container } = render(<WhatsNew />);
    await settle();
    const arts = [...container.querySelectorAll('[data-version]')];
    expect(arts.map((a) => a.getAttribute('data-version'))).toEqual(list.map((r) => r.version));
    expect(arts.slice(0, 3).every((a) => a.hasAttribute('data-open'))).toBe(true);
    const folded = arts[3];
    expect(folded.hasAttribute('data-open')).toBe(false);
    const show = folded.querySelector('button[aria-expanded]')!;
    expect(show.textContent).toMatch(/^Show \d+ notes?/);
    fireEvent.click(show);
    expect(container.querySelector(`[data-version="${list[3].version}"]`)!.hasAttribute('data-open')).toBe(true);
    expect(container.querySelector('[data-site-section="whats-new"]')?.getAttribute('aria-current')).toBe('page');
    expect(container.querySelector('nav[aria-label="Versions"]')).not.toBeNull();
  });
  it('draws the demos of the newest version where its items say', async () => {
    const { container } = render(<WhatsNew />);
    await settle();
    const newest = container.querySelector('[data-version]')!;
    expect(newest.querySelectorAll('[data-demo]').length).toBe(list[0].widgets);
    expect(newest.querySelector('[data-demo] [data-mkp]')).not.toBeNull();
  });
  it('filters by kind with counts, by words with marks, and says when nothing matches', async () => {
    const { container } = render(<WhatsNew />);
    await settle();
    fireEvent.click(container.querySelector('[data-chip="Breaking"]')!);
    expect(container.querySelector('[data-chip="Breaking"]')!.getAttribute('aria-pressed')).toBe('true');
    expect(container.querySelector('[data-status]')!.textContent).toMatch(/^\d+ breaking notes? in \d+ of \d+ versions\.$/);
    expect([...container.querySelectorAll('section[data-kind]')].every((s) => s.getAttribute('data-kind') === 'Breaking')).toBe(true);
    const field = container.querySelector('input[type=search]') as HTMLInputElement;
    fireEvent.click(container.querySelector('[data-chip="All"]')!);
    fireEvent.change(field, { target: { value: 'migrate' } });
    await settle();
    expect(container.querySelector('mark[data-found]')?.textContent?.toLowerCase()).toBe('migrate');
    fireEvent.change(field, { target: { value: 'zzzqqq' } });
    expect(container.querySelector('[data-nothing]')!.textContent).toContain('Nothing matches “zzzqqq”.');
    fireEvent.keyDown(field, { key: 'Escape' });
    expect(field.value).toBe('');
  });
  it('opens at an addressed version, unfolded, its heading focused', async () => {
    const oldest = list[list.length - 1].version;
    location.hash = `#${oldest}`;
    const { container } = render(<WhatsNew />);
    await settle();
    await act(async () => {
      await new Promise((r) => requestAnimationFrame(() => r(null)));
    });
    expect(container.querySelector(`[data-version="${oldest}"]`)!.hasAttribute('data-open')).toBe(true);
    expect(document.activeElement?.id).toBe(`v${oldest.replace(/\./g, '-')}-h`);
  });
});
