import { it } from 'vitest';
import { compile } from '../packages/core/src/build';
import { compileCase, fixtureCases } from '../packages/core/src/fixtures';
import { Runtime } from '../packages/core/src/runtime/runtime';
import { writeMarkdown } from '../packages/core/src/md';
import { allPacks } from '../packages/core/test/helpers';
it('dbg', () => {
  const c = compile({ packs: allPacks() });
  const want = process.env.CASE!;
  const fc = fixtureCases(c).find((f) => `${f.pack}/${f.widget}/${f.name}` === want)!;
  const r = compileCase(c, fc);
  console.log(r.diags.errors.map((d) => d.message), r.diags.warnings?.map((d: any) => d.code + ' ' + d.message));
  const rt = new Runtime(r.bundle!, { now: () => 0 });
  for (const s of fc.play ?? []) { if (s.press) rt.press(s.press); if (s.set) rt.set(s.set); if (s.wait) for (let t = 0; t < s.wait; t += 50) rt.tick(50); }
  if (process.env.VIEW) console.log(JSON.stringify(rt.view(), null, 0).slice(0, Number(process.env.VIEW)));
  console.log(rt.warnings);
  if (process.env.MD) console.log(writeMarkdown(r.bundle!, { toggles: process.env.MD === 'plain' ? [] : process.env.MD.split(',') as any }).md);
});
