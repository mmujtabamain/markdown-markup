// pnpm conformance [--generate]
import { runTs } from './run-ts.mjs';
await runTs(new URL('./conformance-entry.ts', import.meta.url).pathname, process.argv.slice(2));
