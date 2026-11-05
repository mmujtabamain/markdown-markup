import { describe, expect, it } from 'vitest';
import { compile } from '../src/build';
import { formatDiagnostic } from '../src/diag';
import { examples } from './examples.test';
import { testPacks } from './helpers';

describe('compile', () => {
  it('checks the test packs and the examples’ packs without errors', () => {
    const c = compile({ packs: [...testPacks(), ...examples().flatMap((e) => e.packs)] });
    expect(c.diags.errors.map(formatDiagnostic)).toEqual([]);
  });
  it('ships no packs: without any, there is only core’s base set of 25', () => {
    const c = compile({ packs: [] });
    expect([...c.prog.packs.keys()]).toEqual(['core']);
    expect([...c.defs.values()].filter((d) => d.kind === 'extern').length).toBe(25);
  });
});
