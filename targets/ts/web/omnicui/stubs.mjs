#!/usr/bin/env node
// omnicui's stub generator for the web target (`stubs:` in targets/checks/targets/web/target.yaml).
// omnicui runs it before the adapter, with every contract on standard input as JSON; it writes
// them, as they are, to the file named by its one argument, where omnicui_adapter.mjs reads each
// contract's prop defaults: a prop a test leaves out takes its contract's default.
//
//   node stubs.mjs <out.json>

import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";

const out = process.argv[2];
if (!out) {
  process.stderr.write("usage: node stubs.mjs <out.json>\n");
  process.exit(2);
}
const contracts = JSON.parse(readFileSync(0, "utf8"));
mkdirSync(dirname(out), { recursive: true });
writeFileSync(out, JSON.stringify(contracts, null, 1) + "\n");
