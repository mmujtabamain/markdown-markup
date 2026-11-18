#!/usr/bin/env node
// The check adapter of the targets drawn from @mkp/view (React, Vue, Svelte, Solid, Angular, and
// their live targets): `mkp target check` drives it over JSON-RPC 2.0, one message per line on
// standard input and output (plan tab 16); logs go to standard error. It runs the framework's
// <MkpDoc> in a real Chromium through Playwright, bundled from the target's harness, which calls
// view_harness.mjs's `install`.
//
//     node view_adapter.mjs <target name> <harness> [svelte] [decorators] [live]
//
// `live` is a real-time target: it is given each case's own text and its packs' files (`load`'s
// `source` and `packs`), and compiles them in the tab with the target's @mkp/wasm, which the tab
// fetches from WASM_URL. Chromium is MKP_CHROMIUM, or /usr/bin/chromium.

import { readFileSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { createInterface } from "node:readline";
import { join } from "node:path";
import { pathToFileURL } from "node:url";

// esbuild, Playwright and the framework are the target's own: it runs in the target's folder
const own = createRequire(join(process.cwd(), "package.json"));
// (CommonJS packages: what they export may only be on the default)
const load = async (pkg) => {
  const m = await import(pathToFileURL(own.resolve(pkg)).href);
  return { ...m.default, ...m };
};
const { build } = await load("esbuild");
const { chromium } = await load("playwright-core");

const [name, harness, ...options] = process.argv.slice(2);
const target = name ?? "view";

/** .svelte files compiled by Svelte's own compiler, from the target's own node_modules. */
async function sveltePlugin() {
  const { compile } = await load("svelte/compiler");
  return {
    name: "svelte",
    setup(b) {
      b.onLoad({ filter: /\.svelte$/ }, async (args) => ({ contents: compile(await readFile(args.path, "utf8"), { filename: args.path, generate: "client" }).js.code, loader: "js" }));
    },
  };
}

const bundle = await build({
  entryPoints: [join(process.cwd(), harness)],
  bundle: true,
  write: false,
  format: "iife",
  platform: "browser",
  target: "es2022",
  logLevel: "silent",
  // the harness and the checks' shared files import @mkp/view and @mkp/runtime: the target's
  nodePaths: [join(process.cwd(), "node_modules"), join(process.cwd(), "node_modules/@mkp/view/node_modules")],
  conditions: options.includes("svelte") ? ["svelte", "browser"] : ["browser"],
  plugins: options.includes("svelte") ? [await sveltePlugin()] : [],
  define: { "process.env.NODE_ENV": '"production"', __VUE_OPTIONS_API__: "true", __VUE_PROD_DEVTOOLS__: "false", __VUE_PROD_HYDRATION_MISMATCH_DETAILS__: "false" },
  ...(options.includes("decorators") ? { tsconfigRaw: { compilerOptions: { experimentalDecorators: true, useDefineForClassFields: false } } } : {}),
});
const browser = await chromium.launch({ executablePath: process.env.MKP_CHROMIUM ?? "/usr/bin/chromium", headless: true });
browser.on("disconnected", () => {
  process.stderr.write(`${target} target: Chromium went away\n`);
  process.exit(1);
});
const tab = await browser.newPage({ viewport: { width: 800, height: 600 } });
tab.on("console", (m) => process.stderr.write(`${target} target [page]: ${m.text()}\n`));
tab.on("pageerror", (e) => process.stderr.write(`${target} target [page error]: ${e.stack ?? e}\n`));
const live = options.includes("live");
const WASM_URL = "http://mkp.test/mkp.wasm";
if (live) {
  // the target's own @mkp/wasm, or the one its @mkp/live compiles with
  const where = (() => {
    try {
      return own.resolve("@mkp/wasm/mkp.wasm");
    } catch {
      return join(process.cwd(), "node_modules/@mkp/live/node_modules/@mkp/wasm/mkp.wasm");
    }
  })();
  const wasm = readFileSync(where);
  await tab.route(WASM_URL, (r) => r.fulfill({ status: 200, contentType: "application/wasm", headers: { "access-control-allow-origin": "*" }, body: wasm }));
}
await tab.setContent("<!doctype html><html lang=en><head><meta charset=utf-8><title>MKP check</title></head><body></body></html>");
await tab.evaluate((url) => (window.__WASM_URL = url), WASM_URL);
await tab.addScriptTag({ content: bundle.outputFiles[0].text });

let loaded = false;

const methods = {
  advertise() {
    return { name: target, protocol: "1", levels: ["core.draw", "core.live", "core.gfx"], supplies: ["core/*", "core/can_draw_tex", "core/moment.local"] };
  },
  async load({ ir, source, packs = [], page = {}, state, externs }) {
    // a real-time target compiles the case's own text; the IR is for the rest
    const text = live && source ? { path: source, text: readFileSync(source, "utf8"), packs: packs.map((f) => ({ path: f, text: readFileSync(f, "utf8") })) } : undefined;
    await tab.evaluate(([ir, p, s, x, t]) => window.mkpCheck.load(ir, p, s, x, t), [readFileSync(ir, "utf8"), page, state, externs, text]);
    loaded = true;
    return {};
  },
  async event({ site, name, args = [] }) {
    await tab.evaluate(([s, n, a]) => window.mkpCheck.event(s, n, a), [site, name, args]);
    return {};
  },
  async write({ site, input, value }) {
    await tab.evaluate(([s, i, v]) => window.mkpCheck.write(s, i, v), [site, input, value]);
    return {};
  },
  async set(params) {
    await tab.evaluate((s) => window.mkpCheck.set(s), params["$state"] ?? {});
    return {};
  },
  async expose({ channel, name, args = [] }) {
    await tab.evaluate(([c, n, a]) => window.mkpCheck.expose(c, n, a), [channel, name, args]);
    return {};
  },
  async extern({ channel, values }) {
    await tab.evaluate(([c, v]) => window.mkpCheck.extern(c, v), [channel, values]);
    return {};
  },
  async page({ page }) {
    await tab.evaluate((p) => window.mkpCheck.page(p), page);
    return {};
  },
  async observe() {
    return tab.evaluate(() => window.mkpCheck.observe());
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
      process.stderr.write(`${target} target: ${req.method}: ${e?.stack ?? e}\n`);
      reply({ id: req.id, error: { code: -32000, message: String(e?.message ?? e) } });
    }
  });
});
