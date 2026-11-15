#!/usr/bin/env node
// `mkp` from npm: the native binary, with the same arguments.

import { spawnSync } from "node:child_process";
import { findBinary } from "../dist/binary.js";

const r = spawnSync(findBinary(), process.argv.slice(2), { stdio: "inherit" });
process.exit(r.status ?? 1);
