// Version stamps: the release a bundle, a lock and a source file were made by (migrations start there).
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { compile } from '../src/build';
import { IR_VERSION } from '../src/ir';
import { bundleStamp, compareReleases, CURRENT, readStamp, UNSTAMPED, writeStamp } from '../src/stamp';
import { RELEASE } from '../src/version';
import { ROOT } from './helpers';

const doc = '```mkp\nw "a widget"\n  text "hi"\n  project md = "hi"\n```\n\n```w\nsummary: s\n```\n';

describe('stamps', () => {
  it('are this release: RELEASE is the VERSION file', () => {
    expect(RELEASE).toBe(readFileSync(join(ROOT, 'VERSION'), 'utf8').trim());
    expect(CURRENT).toEqual({ mkp: RELEASE, ir: IR_VERSION });
  });
  it('go in every bundle and its lock, and a bundle without one is 0.2.1', () => {
    const b = compile({ packs: [] }).document(doc, 'x.mkp.md')!;
    expect(b.mkp).toBe(RELEASE);
    expect(b.lock.mkp).toBe(RELEASE);
    expect(bundleStamp(b)).toEqual({ mkp: RELEASE, ir: 1, stamped: true });
    expect(bundleStamp({ ir: 1 })).toEqual({ mkp: UNSTAMPED, ir: 1, stamped: false });
  });
  it('are front matter keys in a document, added or replaced, the rest kept', () => {
    expect(readStamp(doc, 'x.mkp.md')).toBeNull();
    const s = writeStamp(doc, 'x.mkp.md', { mkp: '0.2.2', ir: 1 });
    expect(s.startsWith('---\nmkp: 0.2.2\nir: 1\n---\n```mkp')).toBe(true);
    expect(readStamp(s, 'x.mkp.md')).toEqual({ mkp: '0.2.2', ir: 1 });
    const fm = '---\ntitle: A\nmkp: 0.2.1\n---\n# A\n';
    expect(writeStamp(fm, 'a.mkp.md', { mkp: '0.2.3', ir: 1 })).toBe('---\nmkp: 0.2.3\nir: 1\ntitle: A\n---\n# A\n');
  });
  it('are the first line of a .mkp file, replaced rather than added twice', () => {
    const src = '# what this file holds\nw@1 "a widget"\n  text "hi"\n';
    const s = writeStamp(src, 'p/w.mkp');
    expect(s.split('\n')[0]).toBe(`# mkp ${RELEASE} ir 1`);
    expect(readStamp(s, 'p/w.mkp')).toEqual(CURRENT);
    expect(writeStamp(s, 'p/w.mkp', { mkp: '9.0.0', ir: 2 }).split('\n').slice(0, 2)).toEqual(['# mkp 9.0.0 ir 2', '# what this file holds']);
    expect(readStamp(src, 'p/w.mkp')).toBeNull();
  });
  it('change neither a definition (no comment of its own) nor its pack’s digest', () => {
    const files = (head: string) => ({ files: new Map([['manifest.mkp', new TextEncoder().encode(`${head}pack p@1 "p"\n  requires core@1\n  provides w\n`)], ['w.mkp', new TextEncoder().encode(`${head}# a comment\nw@1 "w"\n  text "hi"\n  project md = "hi"\n`)]]), label: 'p' });
    const a = compile({ packs: [files('')] });
    const b = compile({ packs: [files('# mkp 0.2.2 ir 1\n')] });
    expect(b.diags.errors).toEqual([]);
    expect(b.defs.get('p:w@1')!.digest).toBe(a.defs.get('p:w@1')!.digest);
    expect(b.prog.packs.get('p')!.digest).toBe(a.prog.packs.get('p')!.digest);
    expect(b.defs.get('p:w@1')!.comment).toEqual(['a comment']);
  });
  it('compare releases number by number', () => {
    expect(compareReleases('0.2.10', '0.2.9')).toBe(1);
    expect(compareReleases('0.2.1', '0.2.1')).toBe(0);
    expect(compareReleases('0.2', '0.2.1')).toBe(-1);
  });
});

describe('the migration steps', () => {
  it('end at this release: a release ships its step (an empty one is fine)', async () => {
    const { STEPS, stepsBetween } = await import('../src/migrate/index');
    expect(STEPS[STEPS.length - 1].to).toBe(RELEASE);
    expect(() => stepsBetween(UNSTAMPED)).not.toThrow();
  });
});
