import { it } from 'vitest';
import { compile } from '../packages/core/src/build';
import { allPacks } from '../packages/core/test/helpers';
it('diag', () => {
  const c = compile({ packs: allPacks() });
  const d: any = c.diags;
  for (const k of Object.keys(d)) if (Array.isArray(d[k])) for (const x of d[k]) if (JSON.stringify(x).includes(process.env.F!)) if (x.code !== "mkp.each-unkeyed") console.log(k, x.severity ?? x.level, x.code, x.message, JSON.stringify(x.pos ?? x.p ?? x.where));
});
