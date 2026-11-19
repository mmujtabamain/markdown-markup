#!/usr/bin/env node
// The web target's check adapter: `xtmd target check` drives it over JSON-RPC 2.0, one message per
// line on standard input and output (plan tab 16); logs go to standard error. It runs the page in
// a real Chromium through Playwright: @extended-mark/runtime and @extended-mark/dom, bundled from harness.mjs.
//
// Chromium is XTMD_CHROMIUM, or /usr/bin/chromium.
//
// Another target that draws with @extended-mark/dom's mount and widgets of its own runs this adapter
// with its own harness entry and name: `--harness <file> --name <target>` (ide/vscode/checks).

import { readFileSync } from "node:fs";
import { createInterface } from "node:readline";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { build } from "esbuild";
import { chromium } from "playwright-core";

const here = dirname(fileURLToPath(import.meta.url));
const arg = (name) => {
  const k = process.argv.indexOf(name);
  return k > 0 ? process.argv[k + 1] : undefined;
};
const entry = arg("--harness") ? resolve(arg("--harness")) : join(here, "harness.mjs");
const targetName = arg("--name") ?? "web";

const bundle = await build({ entryPoints: [entry], bundle: true, write: false, format: "iife", platform: "browser", target: "es2022", logLevel: "silent" });
const browser = await chromium.launch({ executablePath: process.env.XTMD_CHROMIUM ?? "/usr/bin/chromium", headless: true });
browser.on("disconnected", () => {
  process.stderr.write("web target: Chromium went away\n");
  process.exit(1);
});
const tab = await browser.newPage({ viewport: { width: 800, height: 600 } });
tab.on("console", (m) => process.stderr.write(`web target [page]: ${m.text()}\n`));
tab.on("pageerror", (e) => process.stderr.write(`web target [page error]: ${e.stack ?? e}\n`));
await tab.setContent("<!doctype html><html lang=en><head><meta charset=utf-8><title>Extended Mark check</title></head><body></body></html>");
await tab.addScriptTag({ content: bundle.outputFiles[0].text });

let loaded = false;

const methods = {
  advertise() {
    return { name: targetName, protocol: "1", levels: ["core.draw", "core.live", "core.gfx"], supplies: ["core/*", "core/can_draw_tex", "core/moment.local"] };
  },
  async load({ ir, page = {}, state, externs }) {
    await tab.evaluate(([text, p, s, x]) => window.xtmdCheck.load(text, p, s, x), [readFileSync(ir, "utf8"), page, state, externs]);
    loaded = true;
    return {};
  },
  async event({ site, name, args = [] }) {
    await tab.evaluate(([s, n, a]) => window.xtmdCheck.event(s, n, a), [site, name, args]);
    return {};
  },
  async write({ site, input, value }) {
    await tab.evaluate(([s, i, v]) => window.xtmdCheck.write(s, i, v), [site, input, value]);
    return {};
  },
  async set(params) {
    await tab.evaluate((s) => window.xtmdCheck.set(s), params["$state"] ?? {});
    return {};
  },
  async expose({ channel, name, args = [] }) {
    await tab.evaluate(([c, n, a]) => window.xtmdCheck.expose(c, n, a), [channel, name, args]);
    return {};
  },
  async extern({ channel, values }) {
    await tab.evaluate(([c, v]) => window.xtmdCheck.extern(c, v), [channel, values]);
    return {};
  },
  async page({ page }) {
    await tab.evaluate((p) => window.xtmdCheck.page(p), page);
    return {};
  },
  async observe() {
    return tab.evaluate(() => window.xtmdCheck.observe());
  },
  async quit() {
    setImmediate(async () => {
      await browser.close().catch(() => {});
      process.exit(0);
    });
    return {};
  },
};

function reply(msg) {
  process.stdout.write(JSON.stringify({ jsonrpc: "2.0", ...msg }) + "\n");
}

// requests are answered in order, one at a time
let queue = Promise.resolve();
const input = createInterface({ input: process.stdin });
input.on("close", () => {
  queue = queue.then(async () => {
    await browser.close().catch(() => {});
    process.exit(0);
  });
});
input.on("line", (line) => {
  if (!line.trim()) return;
  queue = queue.then(async () => {
    let req;
    try {
      req = JSON.parse(line);
    } catch {
      return reply({ id: null, error: { code: -32700, message: "parse error" } });
    }
    const run = methods[req.method];
    if (!run) return reply({ id: req.id, error: { code: -32601, message: `no method ${req.method}` } });
    if (!["advertise", "load", "quit"].includes(req.method) && !loaded) return reply({ id: req.id, error: { code: -32000, message: "no page is loaded" } });
    try {
      reply({ id: req.id, result: await run(req.params ?? {}) });
    } catch (e) {
      process.stderr.write(`web target: ${req.method}: ${e?.stack ?? e}\n`);
      reply({ id: req.id, error: { code: -32000, message: String(e?.message ?? e) } });
    }
  });
});
