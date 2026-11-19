#!/usr/bin/env node
// `xtmd` from the extended-mark package: the xtmd package's own command, run as it is. Its bin isn't
// in its exports, so it is found beside its main file.

import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { pathToFileURL } from "node:url";

const main = createRequire(import.meta.url).resolve("xtmd");
await import(pathToFileURL(join(dirname(main), "..", "bin", "xtmd.js")).href);
