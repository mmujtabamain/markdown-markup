// Time per conformance case on Node (what the Hermes run spends its time on).
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { checkCase, type ConfCase } from '../packages/core/src/conformance';
const root = process.cwd();
const index = JSON.parse(readFileSync(join(root, 'conformance/index.json'), 'utf8')) as { cases: string[] };
const times: [string, number][] = [];
for (const id of index.cases) {
  const c = JSON.parse(readFileSync(join(root, 'conformance/cases', `${id}.json`), 'utf8')) as ConfCase;
  const t = performance.now();
  checkCase(c, { mdAll: false });
  times.push([id, performance.now() - t]);
}
times.sort((a, b) => b[1] - a[1]);
const total = times.reduce((s, x) => s + x[1], 0);
console.log(`total ${total.toFixed(0)} ms; slowest:`);
for (const [id, t] of times.slice(0, 12)) console.log(`  ${t.toFixed(0)} ms ${id}`);
