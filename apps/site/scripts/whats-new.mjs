// node scripts/whats-new.mjs: What's new's HTML for readers without script, and its feed (in .generated/)
import { runTs } from '../../../scripts/run-ts.mjs';
await runTs(new URL('./whats-new-entry.ts', import.meta.url).pathname, [new URL('..', import.meta.url).pathname]);
