import { it } from 'vitest';
import { compile } from '../packages/core/src/build';
import { allPacks } from '../packages/core/test/helpers';
it('ir', () => {
  const c = compile({ packs: allPacks() });
  const defs = (c as any).defs; const d = [...(defs instanceof Map ? defs.entries() : Object.entries(defs))].find(([k]) => String(k).includes(process.env.DEF!)); const x = d && d[1];
  console.log(Object.keys(c as any));
  console.log(JSON.stringify(x, null, 0).slice(0, Number(process.env.N ?? 3000)));
});
