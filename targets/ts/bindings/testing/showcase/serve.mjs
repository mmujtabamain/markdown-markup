// Serves the showcase: index.html, shell.js and dist/. `PORT` (8790 by default).
import { createServer } from "node:http";
import { existsSync, readFileSync } from "node:fs";
import { dirname, extname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const TYPES = { ".html": "text/html; charset=utf-8", ".js": "text/javascript", ".json": "application/json", ".wasm": "application/wasm", ".md": "text/plain; charset=utf-8" };
const port = Number(process.env.PORT ?? 8790);
createServer((req, res) => {
  const path = new URL(req.url, "http://x").pathname;
  const name = path === "/" ? "index.html" : path.slice(1);
  const file = [join(here, name), join(here, "dist", name)].find((f) => /^[\w.-]+$/.test(name) && existsSync(f));
  if (!file) {
    res.writeHead(404).end("not found");
    return;
  }
  res.writeHead(200, { "content-type": TYPES[extname(file)] ?? "application/octet-stream" });
  res.end(readFileSync(file));
}).listen(port, "127.0.0.1", () => process.stderr.write(`showcase on http://127.0.0.1:${port}/\n`));
