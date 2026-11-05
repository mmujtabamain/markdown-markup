// pnpm check:neutral — MKP is host-neutral (doc #1129 §7): no Study Pad name, path, token or
// interface outside the history kept in GAPS.md and SPEC-NOTES.md.
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';

const root = process.cwd();
const skip = new Set(['node_modules', 'dist', '.git', 'GAPS.md', 'SPEC-NOTES.md', 'neutral.mjs', '.shots', 'test-results', 'playwright-report']);
const hits = [];
const walk = (d) => {
  for (const n of readdirSync(d)) {
    if (skip.has(n) || n.startsWith('.')) continue;
    const p = join(d, n);
    const st = statSync(p);
    if (st.isDirectory()) walk(p);
    else if (st.size < 2_000_000 && /\.(ts|tsx|mjs|cjs|js|json|md|mkp|css|html|yaml|yml)$/.test(n)) {
      readFileSync(p, 'utf8').split('\n').forEach((l, i) => {
        if (/study.?pad/i.test(l)) hits.push(`${relative(root, p)}:${i + 1}: ${l.trim().slice(0, 100)}`);
      });
    }
  }
};
walk(root);
if (hits.length) {
  console.error(`MKP is host-neutral, but these name Study Pad:\n${hits.join('\n')}`);
  process.exit(1);
}
console.log('check:neutral: no host names outside GAPS.md and SPEC-NOTES.md');
