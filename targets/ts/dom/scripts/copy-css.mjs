// After tsc: dist/style.css for bundlers that import CSS, and the same text in dist/style.js,
// which mount puts in the page itself.

import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const css = readFileSync(join(root, "src/style.css"), "utf8");
writeFileSync(join(root, "dist/style.css"), css);
const js = join(root, "dist/style.js");
const text = readFileSync(js, "utf8");
if (!text.includes('"__XTMD_DOM_STYLE_CSS__"')) throw new Error("dist/style.js has no place for the stylesheet");
writeFileSync(js, text.replace('"__XTMD_DOM_STYLE_CSS__"', () => JSON.stringify(css)));
