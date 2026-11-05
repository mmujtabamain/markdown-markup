// pnpm examples:coverage | examples:sync [--write]
import { runTs } from './run-ts.mjs';
await runTs(new URL('./examples-entry.ts', import.meta.url).pathname, process.argv.slice(2));
