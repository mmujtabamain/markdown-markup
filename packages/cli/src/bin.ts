import { main } from './main';

// Exit once stdout and stderr have drained: process.exit() drops whatever a pipe has not taken yet,
// which cut a bundle written to a pipe at 64 KiB (and would cut a long run of JSON diagnostics).
const drained = (s: NodeJS.WriteStream) => new Promise<void>((done) => (s.writableLength === 0 ? done() : s.once('drain', () => done())));

main(process.argv.slice(2)).then(async (code) => {
  await Promise.all([drained(process.stdout), drained(process.stderr)]);
  process.exit(code);
});
