// Layout timings: the first render (compute included) and a re-render, per case.
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { compile, compileCase, fixtureCases, Runtime, type PackSource } from '../packages/core/src/index';

const root = process.cwd();
const folder = (d: string): PackSource => {
  const files = new Map<string, Uint8Array>();
  const walk = (x: string): void => {
    for (const n of readdirSync(x)) {
      const p = join(x, n);
      if (statSync(p).isDirectory()) walk(p);
      else files.set(relative(d, p), new Uint8Array(readFileSync(p)));
    }
  };
  walk(d);
  return { files, label: relative(root, d) };
};
const packs = [...readdirSync(join(root, 'packs')).map((n) => folder(join(root, 'packs', n))), ...readdirSync(join(root, 'examples')).map((n) => folder(join(root, 'examples', n)))];
const t0 = performance.now();
const c = compile({ packs });
console.log(`compile ${c.defs.size} definitions: ${(performance.now() - t0).toFixed(0)} ms`);
const want = process.argv.slice(2);
for (const fc of fixtureCases(c)) {
  const id = `${fc.pack}/${fc.widget}/${fc.name}`;
  if (want.length && !want.some((w) => id.includes(w))) continue;
  if (fc.expect?.errors?.length) continue;
  const b = compileCase(c, fc).bundle;
  if (!b) continue;
  const rt = new Runtime(b);
  const a = performance.now();
  rt.view();
  const first = performance.now() - a;
  rt.set({});
  const b2 = performance.now();
  rt.tick(16);
  (rt as unknown as { dirty: boolean }).dirty = true;
  rt.view();
  const again = performance.now() - b2;
  console.log(`${id}: first render ${first.toFixed(1)} ms, re-render ${again.toFixed(2)} ms`);
}
