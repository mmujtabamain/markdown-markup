import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { compile } from '../src/build';
import { formatDiagnostic } from '../src/diag';
import { allPacks, ROOT } from './helpers';

describe('compile', () => {
  it('checks every pack without errors', () => {
    const c = compile({ packs: allPacks() });
    expect(c.diags.errors.map(formatDiagnostic)).toEqual([]);
    expect(c.defs.size).toBeGreaterThan(10);
  });
  it('compiles the section 18 document', () => {
    const c = compile({ packs: allPacks() });
    const b = c.document(readFileSync(join(ROOT, 'examples/spec18/roots.mkp.md'), 'utf8'), 'roots.mkp.md');
    expect(c.diags.errors.map(formatDiagnostic)).toEqual([]);
    expect(b).not.toBeNull();
    expect(Object.keys(b!.defs)).toContain('spec18:roots@1');
  });
});
