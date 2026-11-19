#!/usr/bin/env node
// `xtmd` from npm: the native binary, with the same arguments.

import { spawnSync } from "node:child_process";
import { findBinary } from "../dist/binary.js";

// the 0.2 → 0.3 step of `xtmd migrate` runs with the Node that runs this
const r = spawnSync(findBinary(), process.argv.slice(2), { stdio: "inherit", env: { XTMD_NODE: process.execPath, ...process.env } });
process.exit(r.status ?? 1);
