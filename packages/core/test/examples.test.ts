// The examples (examples/, doc #1129 §9): each compiles, draws without an error, and writes the
// Markdown committed beside it as doc.md; each limit fails with the error its front matter
// expects. MKP_UPDATE=1 rewrites the doc.md files.
import { describe, expect, it } from 'vitest';
import { existsSync, readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import YAML from 'yaml';
import { compile, type PackSource } from '../src/build';
import { formatDiagnostic } from '../src/diag';
import { writeMarkdown } from '../src/md';
import { Runtime } from '../src/runtime/runtime';
import { walk, type VNode } from '../src/runtime/view';
import { folder, ROOT } from './helpers';

const DIR = join(ROOT, 'examples');
const update = !!process.env.MKP_UPDATE;

export interface Example {
  name: string;
  dir: string;
  text: string;
  docFile?: { text: string; file: string };
  packs: PackSource[];
  front: Record<string, unknown>;
}

export function examples(): Example[] {
  return readdirSync(DIR)
    .filter((n) => /^\d\d-/.test(n) && existsSync(join(DIR, n, 'doc.mkp.md')))
    .sort()
    .map((name) => {
      const dir = join(DIR, name);
      const text = readFileSync(join(dir, 'doc.mkp.md'), 'utf8');
      const own = join(dir, 'doc.mkp');
      const packs = ['pack', 'host'].filter((p) => existsSync(join(dir, p))).map((p) => folder(join(dir, p)));
      const fm = /^---\n([\s\S]*?)\n---/.exec(text);
      return { name, dir, text, packs, front: (fm ? YAML.parse(fm[1]) : {}) as Record<string, unknown>, ...(existsSync(own) ? { docFile: { text: readFileSync(own, 'utf8'), file: `examples/${name}/doc.mkp` } } : {}) };
    });
}

function build(ex: Example) {
  const c = compile({ packs: ex.packs });
  const b = c.document(ex.text, `examples/${ex.name}/doc.mkp.md`, undefined, { docFile: ex.docFile });
  return { c, b, all: c.diags.errors.map(formatDiagnostic) };
}

describe('examples', () => {
  for (const ex of examples()) {
    describe(ex.name, () => {
      it('compiles, with no warnings', () => {
        const r = build(ex);
        expect(r.all).toEqual([]);
        expect(r.c.diags.items.filter((d) => d.severity !== 'error').map(formatDiagnostic)).toEqual([]);
      });
      it('draws without an error, at phone and desktop width', () => {
        const { b } = build(ex);
        if (!b) return;
        for (const width of ['narrow', 'wide'] as const) {
          const rt = new Runtime(b, { width, now: () => 0, capabilities: ex.front.needs ? ['core@1', 'gfx@1'] : ['core@1'] });
          const errors: string[] = [];
          walk(rt.view(), (n: VNode) => n.t === 'error' && errors.push(`${n.p.code}: ${n.p.message}`));
          expect(errors).toEqual([]);
          // nothing goes missing quietly: an arrow to no element, an action to no id
          expect(rt.warnings.map((w) => `${w.code}: ${w.message}`)).toEqual([]);
        }
      });
      it('writes the Markdown beside it (doc.md)', () => {
        const { b } = build(ex);
        if (!b) return;
        const md = writeMarkdown(b, { toggles: ['gfm', 'math'] }).md.replace(/^<!-- generated[^\n]*\n\n/, '');
        const golden = join(ex.dir, 'doc.md');
        if (update || !existsSync(golden)) writeFileSync(golden, md);
        expect(md).toBe(readFileSync(golden, 'utf8'));
      });
    });
  }
});

describe('limits: each fails as it says', () => {
  const dir = join(DIR, 'limits');
  const files = existsSync(dir) ? readdirSync(dir).filter((n) => n.endsWith('.mkp.md')).sort() : [];
  for (const f of files) {
    it(f, () => {
      const text = readFileSync(join(dir, f), 'utf8');
      const fm = YAML.parse(/^---\n([\s\S]*?)\n---/.exec(text)![1]) as { expect: { code: string; line: number } };
      const packDir = join(dir, f.replace(/\.mkp\.md$/, ''));
      const packs = existsSync(packDir) ? readdirSync(packDir).map((p) => folder(join(packDir, p))) : [];
      const c = compile({ packs });
      const b = c.document(text, `limits/${f}`);
      const hits = c.diags.errors.filter((d) => d.code === fm.expect.code);
      if (!hits.length && b) {
        // a runtime limit: the block draws its error
        const errs: string[] = [];
        walk(new Runtime(b, { now: () => 0 }).view(), (n) => n.t === 'error' && errs.push(String(n.p.code)));
        expect(errs).toContain(fm.expect.code);
        return;
      }
      expect(c.diags.errors.map(formatDiagnostic).join('\n')).toContain(fm.expect.code);
      expect(hits.map((d) => d.pos?.line)).toContain(fm.expect.line);
      // that is the first thing it says: what an agent fixes first
      expect(c.diags.errors[0].code).toBe(fm.expect.code);
    });
  }
});
