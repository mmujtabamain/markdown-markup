#!/usr/bin/env node
// The web target's omnicui adapter: omnicui (targets/checks, the widget contracts) starts it once
// per check and sends JSON-RPC 2.0 requests, one per line, on standard input; every reply is one
// line on standard output, and logs go to standard error (omnicui's SPEC §4.4).
//
// For `mount {component: "core.slider", props, viewport, colorScheme}` it writes a small MKP page
// that calls that one extern widget (omnicui/source.mjs), builds it with the mkp binary (the IR is
// cached per source), and loads it into a real Chromium with @mkp/runtime and @mkp/dom
// (omnicui/harness.mjs), at the viewport and colour scheme asked for. Steps are real Playwright
// input on the part's element; reads come from Chromium's accessibility tree, as omnicui's
// reference web adapter reads them. Each reply waits for the page to settle.
//
// Part ids are `<component id>.<part>`; how a part finds its element is in mark() below and in
// README.md. Chromium is MKP_CHROMIUM, or /usr/bin/chromium; none is downloaded.
//
//   node omnicui_adapter.mjs [--contracts <file>]
//
// --contracts names the JSON that omnicui/stubs.mjs wrote (every contract, from omnicui's `stubs:`):
// a prop a test leaves out takes the contract's default from it.

import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, readdirSync, renameSync, rmSync, statSync, writeFileSync } from "node:fs";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { createInterface } from "node:readline";
import { fileURLToPath } from "node:url";
import { gunzipSync, gzipSync } from "node:zlib";
import { build } from "esbuild";
import { chromium } from "playwright-core";
import { declarations, pageSource, reporting, widgetOf } from "./omnicui/source.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const repo = resolve(here, "../../..");
const log = (...a) => process.stderr.write(`[web] ${a.join(" ")}\n`);

// protocol: error codes
const NO_COMPONENT = -32001;
const NO_PART = -32002;
const STEP_FAILED = -32003;
const NO_METHOD = -32601;
class RpcError extends Error {
  constructor(code, message) {
    super(message);
    this.code = code;
  }
}

// ---- the contracts' defaults, from omnicui's stub generator

function argValue(flag) {
  const k = process.argv.indexOf(flag);
  return k >= 0 ? process.argv[k + 1] : undefined;
}

/** Each contract's prop defaults, by contract id. */
const defaults = new Map();
const contractsFile = argValue("--contracts");
if (contractsFile && existsSync(contractsFile)) {
  for (const c of JSON.parse(readFileSync(contractsFile, "utf8"))) {
    defaults.set(c.id, Object.fromEntries((c.props ?? []).filter((p) => p.hasDefault).map((p) => [p.name, p.default])));
  }
} else {
  log(`no contracts file${contractsFile ? ` at ${contractsFile}` : ""} (omnicui writes it with the target's stubs:); props left out take the widget's own defaults`);
}

// ---- building pages with the mkp binary, cached per source

function mkpBinary() {
  if (process.env.MKP_BINARY) return process.env.MKP_BINARY;
  for (const kind of ["release", "debug"]) {
    const p = join(repo, "targets/rust/target", kind, "mkp");
    if (existsSync(p)) return p;
  }
  throw new Error("no mkp binary: run `cargo build --release` in targets/rust, or set MKP_BINARY");
}
const mkp = mkpBinary();

// The cache key holds the binary and core's sources, so a new compiler or a changed core builds again.
const stamp = createHash("sha256");
for (const f of [mkp, ...readdirSync(join(repo, "core")).map((f) => join(repo, "core", f))]) {
  const s = statSync(f);
  stamp.update(`${f}:${s.size}:${s.mtimeMs}\n`);
}
const salt = stamp.digest("hex").slice(0, 16);
// One folder per compiler and core, in the system's temporary folder; the others are stale and go.
// Each page's IR is kept gzipped (most of it is core's declarations: about 160 kB, not 4 MB) and
// served as it is, with Content-Encoding: gzip.
const caches = process.env.MKP_OMNICUI_CACHE ?? join(tmpdir(), "mkp-omnicui-ir");
const cache = join(caches, salt);
mkdirSync(cache, { recursive: true });
for (const d of readdirSync(caches)) if (d !== salt) rmSync(join(caches, d), { recursive: true, force: true });

/** Builds a page's source into IR (or finds it built): its hash, which names its file in the cache. */
function buildPage(source) {
  const hash = createHash("sha256").update(source).digest("hex").slice(0, 24);
  const out = join(cache, `${hash}.ir.json.gz`);
  if (!existsSync(out)) {
    const src = join(cache, `${hash}.mkp.md`);
    const ir = join(cache, `${hash}.ir.json`);
    writeFileSync(src, source);
    try {
      execFileSync(mkp, ["build", src, "-o", ir], { stdio: ["ignore", "pipe", "pipe"], maxBuffer: 64 * 1024 * 1024 });
    } catch (e) {
      throw new RpcError(STEP_FAILED, `the page didn't build: ${String(e.stdout ?? "") + String(e.stderr ?? "")}`.replace(/\s+/g, " ").trim());
    }
    writeFileSync(`${out}.part`, gzipSync(readFileSync(ir)));
    renameSync(`${out}.part`, out);
    rmSync(ir);
  }
  return hash;
}

const decls = declarations(JSON.parse(gunzipSync(readFileSync(join(cache, `${buildPage("@@@\nThe core declarations.\n")}.ir.json.gz`))).toString("utf8")));

// ---- the harness, served with each page's IR

const bundle = await build({ entryPoints: [join(here, "omnicui/harness.mjs")], bundle: true, write: false, format: "iife", platform: "browser", target: "es2022", logLevel: "silent" });
const harness = bundle.outputFiles[0].text;
const HTML = `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>MKP widget</title>
<style>html, body { margin: 0; } body { padding: 8px; } #page { min-height: 1px; }</style></head><body><main id="page"></main><script src="/harness.js"></script></body></html>`;
const server = createServer((req, res) => {
  const path = new URL(req.url ?? "/", "http://x").pathname;
  const ir = /^\/ir\/([0-9a-f]+)\.json$/.exec(path);
  if (path === "/") res.writeHead(200, { "content-type": "text/html; charset=utf-8" }).end(HTML);
  else if (path === "/harness.js") res.writeHead(200, { "content-type": "text/javascript", "cache-control": "max-age=3600" }).end(harness);
  else if (ir && existsSync(join(cache, `${ir[1]}.ir.json.gz`))) {
    res.writeHead(200, { "content-type": "application/json", "content-encoding": "gzip", "cache-control": "max-age=3600, immutable" }).end(readFileSync(join(cache, `${ir[1]}.ir.json.gz`)));
  }
  else if (path === "/favicon.ico") res.writeHead(204).end();
  else res.writeHead(404).end();
});
await new Promise((ok) => server.listen(0, "127.0.0.1", ok));
const base = `http://127.0.0.1:${server.address().port}`;

// ---- Chromium

const browser = await chromium.launch({ executablePath: process.env.MKP_CHROMIUM || "/usr/bin/chromium", headless: true, args: ["--no-sandbox", "--disable-gpu"] });
// If Chromium dies, every later request would fail one by one as if the widgets were wrong. Exit
// instead: omnicui then reports this target broken, once, with these lines from standard error.
browser.on("disconnected", () => {
  log("Chromium has disconnected (it crashed or was closed); the adapter stops so that omnicui reports this target as broken");
  process.exit(3);
});
const context = await browser.newContext({ viewport: { width: 320, height: 240 }, deviceScaleFactor: 1, reducedMotion: "no-preference" });
const page = await context.newPage();
page.setDefaultTimeout(8000);
page.on("console", (m) => (m.type() === "error" || m.type() === "warning") && log(`[page ${m.type()}] ${m.text()}`));
page.on("pageerror", (e) => log(`[page error] ${e.stack ?? e}`));
const cdp = await context.newCDPSession(page);
let mounted; // { component, widget }

/**
 * Waits until fonts are loaded, the page is not busy (a shade still painting:
 * `window.omnicuiBusy`, up to 10 s), nothing is animating, and two more frames are painted, so
 * the DOM is drawn and every ResizeObserver callback (the plane's layout) has run.
 */
async function settle() {
  await page.evaluate(async () => {
    await document.fonts.ready;
    const busyUntil = performance.now() + 10000;
    while (window.omnicuiBusy?.()) {
      if (performance.now() > busyUntil) throw new Error("the page was still busy after 10 s (a shade still painting)");
      await new Promise((r) => setTimeout(r, 10));
    }
    const deadline = performance.now() + 5000;
    while (performance.now() < deadline) {
      const running = document.getAnimations().filter((a) => a.playState === "running");
      if (running.length === 0) break;
      await Promise.race([Promise.all(running.map((a) => a.finished.catch(() => null))), new Promise((r) => setTimeout(r, 100))]);
    }
    await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
  });
  const errors = await page.evaluate(() => window.omnicui?.errors() ?? []);
  for (const e of errors) log(`[page caught] ${e}`);
}

// ---- parts

/**
 * Finds a part's element and marks it `data-omnicui-part` (one element at a time), so Playwright
 * and Chromium's accessibility tree can be pointed at it. A part id is `<component id>.<part>`,
 * and the part is looked up in this order:
 *
 * 1. a few aliases, for what a data-part alone doesn't say: `heading`'s `level1`…`level6` (the
 *    heading, only when it is that level), `bullets`' `ordered` and `unordered` (the list, only
 *    as an `ol` or a `ul`), `press`'s `switch` and `checkbox` (the press itself, read as a switch
 *    or a checkbox);
 * 2. the widget's own short name (`slider`): the widget under test's root, by its site;
 * 3. `<short>.<part>` inside it: `input` in core.slider is `[data-part="slider.input"]`;
 * 4. `<part>` anywhere on the page: another widget drawn around it or in its slots, by its own
 *    short name (`item` in core.bullets, `label` in core.flex, `canvas` around core.circle);
 * 5. a name ending in a number is the nth such element, from 1: `cell3`, `header1`, `item2`.
 */
async function mark(partId) {
  const m = mounted;
  if (!m) throw new RpcError(NO_PART, `no part ${partId}: nothing is mounted`);
  const prefix = `${m.component}.`;
  if (!partId.startsWith(prefix)) throw new RpcError(NO_PART, `no part ${partId}: ${m.component} is mounted`);
  const part = partId.slice(prefix.length);
  const found = await page.evaluate(
    ([short, part]) => {
      for (const el of document.querySelectorAll("[data-omnicui-part]")) el.removeAttribute("data-omnicui-part");
      const site = window.omnicui.site();
      const scope = document.getElementById("page");
      const root = site ? scope.querySelector(`[data-mkp-site="${CSS.escape(site)}"]`) : null;
      const aliases = {
        heading: Object.fromEntries([1, 2, 3, 4, 5, 6].map((n) => [`level${n}`, () => (root?.tagName === `H${n}` ? [root] : [])])),
        bullets: { ordered: () => (root?.tagName === "OL" ? [root] : []), unordered: () => (root?.tagName === "UL" ? [root] : []) },
        press: { switch: () => (root ? [root] : []), checkbox: () => (root ? [root] : []) },
      };
      const all = (name) => {
        if (name === short) return root ? [root] : [];
        const inside = root ? [...root.querySelectorAll(`[data-part="${short}.${name}"]`)] : [];
        return inside.length ? inside : [...scope.querySelectorAll(`[data-part="${name}"]`)];
      };
      let els = aliases[short]?.[part]?.();
      if (!els) {
        const nth = /^(.*?)(\d+)$/.exec(part);
        els = all(part);
        if (els.length === 0 && nth) els = [all(nth[1])[Number(nth[2]) - 1]].filter(Boolean);
      }
      const el = els[0];
      if (!el) return false;
      el.setAttribute("data-omnicui-part", "");
      return true;
    },
    [m.widget.slice("core/".length), part],
  );
  if (!found) throw new RpcError(NO_PART, `no part ${partId}`);
  return page.locator("[data-omnicui-part]");
}

/** The accessibility node Chromium computes for the marked part: its role, name, states and value. */
async function axNode() {
  const { root } = await cdp.send("DOM.getDocument", { depth: 0 });
  const { nodeId } = await cdp.send("DOM.querySelector", { nodeId: root.nodeId, selector: "[data-omnicui-part]" });
  const { nodes } = await cdp.send("Accessibility.getPartialAXTree", { nodeId, fetchRelatives: false });
  return nodes[0];
}

const prop = (node, name) => node?.properties?.find((p) => p.name === name)?.value?.value;

/** Chromium keeps a range's value as a 32-bit float (3.1 is 3.0999999046325684): the shortest
 * decimal that is the same float32, which is the number the page set. */
function float32(n) {
  if (Math.fround(n) !== n) return n;
  for (let p = 1; p <= 9; p++) {
    const d = Number(n.toPrecision(p));
    if (Math.fround(d) === n) return d;
  }
  return n;
}

// protocol: Space is sent to Playwright as " "; every other key name is the same.
const playwrightKey = (key) => key.split("+").map((k) => (k === "Space" ? " " : k)).join("+");

/** A part a pointer acts on must be on screen. */
async function onScreen(loc, partId) {
  const box = await loc.boundingBox();
  if (!box || box.width <= 0 || box.height <= 0) throw new RpcError(STEP_FAILED, `${partId} is not on screen`);
  return box;
}

async function step(method, p) {
  const loc = await mark(p.part);
  switch (method) {
    // A real click where the part is, as a person's: a disabled control takes it and does nothing.
    case "press":
      await onScreen(loc, p.part);
      await loc.click({ force: true });
      break;
    case "hover":
      await onScreen(loc, p.part);
      await loc.hover({ force: true });
      break;
    case "focus":
      await loc.focus();
      break;
    // The key goes wherever focus really is, so a part that can't be focused fails honestly.
    case "key":
      await page.keyboard.press(playwrightKey(p.key));
      break;
    case "type":
      await loc.pressSequentially(p.text);
      break;
    case "drag": {
      const box = await onScreen(loc, p.part);
      const x = box.x + box.width / 2;
      const y = box.y + box.height / 2;
      await page.mouse.move(x, y);
      await page.mouse.down();
      await page.mouse.move(x + p.dx, y + p.dy, { steps: 10 });
      await page.mouse.up();
      break;
    }
    default:
      throw new RpcError(NO_METHOD, `unknown step ${method}`);
  }
  await settle();
  return null;
}

// Chromium's role names are WAI-ARIA's, except a few of its own.
const ROLES = { StaticText: "text", none: "generic", LabelText: "label", image: "img", RootWebArea: "document" };

const methods = {
  // protocol: the first request; what this target can do on this run.
  advertise() {
    const why = "MKP's widget contracts have one target (web), so there is nothing to compare it with; not implemented";
    return {
      protocol: "1",
      can: ["mount", "press", "focus", "key", "type", "drag", "hover", "read", "events", "bounds", "role", "focused", "selected"],
      cannot: {
        screenshot: `${why} (behaviour, keyboard and roles are checked instead)`,
        probe: `${why} (no screenshots, so no render check)`,
        trace: `${why} (no motion is compared)`,
        "trace.opacity": `${why} (no motion is compared)`,
        "trace.scale": `${why} (no motion is compared)`,
        record: `${why} (no clips are compared)`,
      },
      ...(process.platform === "linux" ? { platform: { os: "linux" } } : {}),
    };
  },
  // contract: tests[].props over the contract's defaults, viewports, colorSchemes. A fresh
  // document for every mount.
  async mount(p) {
    const widget = widgetOf(p.component ?? "");
    if (!widget || !decls.widgets.has(widget)) throw new RpcError(NO_COMPONENT, `no component ${p.component}: this target mounts core's extern widgets, core.<widget>`);
    const props = { ...(defaults.get(p.component) ?? {}), ...(p.props ?? {}) };
    let source;
    try {
      source = pageSource(widget, props, decls);
    } catch (e) {
      throw new RpcError(STEP_FAILED, `mount ${p.component}: ${e.message}`);
    }
    const hash = buildPage(source);
    mounted = undefined;
    await page.mouse.move(0, 0);
    await page.setViewportSize(p.viewport ?? { width: 320, height: 240 });
    await page.emulateMedia({ colorScheme: p.colorScheme === "dark" ? "dark" : "light" });
    await page.goto(`${base}/`);
    const err = await page.evaluate((m) => window.omnicui.mount(m), { ir: `/ir/${hash}.json`, report: reporting(widget, decls), theme: p.colorScheme === "dark" ? "DARK" : "LIGHT" });
    if (err) throw new RpcError(NO_COMPONENT, err);
    mounted = { component: p.component, widget };
    await settle();
    return null;
  },
  press: (p) => step("press", p),
  hover: (p) => step("hover", p),
  focus: (p) => step("focus", p),
  key: (p) => step("key", p),
  type: (p) => step("type", p),
  drag: (p) => step("drag", p),
  // contract: expect[] with part:. text is what is shown; the rest is what assistive tech sees.
  async read(p) {
    const loc = await mark(p.part);
    switch (p.field) {
      // A text box's text is what is typed in it. Otherwise what the part shows: its innerText,
      // without text only a screen reader gets (a 1×1 box that clips), and an SVG's text content.
      case "text":
        return loc.evaluate((el) => {
          if (el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement) return el.value;
          if (!(el instanceof HTMLElement)) return (el.textContent ?? "").trim();
          const hidden = [...el.querySelectorAll("*")].filter((d) => {
            const r = d.getBoundingClientRect();
            const s = getComputedStyle(d);
            return r.width <= 1 && r.height <= 1 && (s.overflow === "hidden" || s.clip !== "auto" || s.clipPath !== "none");
          });
          const saved = hidden.map((d) => d.style.display);
          hidden.forEach((d) => (d.style.display = "none"));
          const text = el.innerText.trim();
          hidden.forEach((d, i) => (d.style.display = saved[i]));
          return text;
        });
      case "focused":
        return loc.evaluate((el) => el === document.activeElement);
      // A chosen chip, tab or segment: aria-pressed, aria-selected or aria-checked.
      case "selected":
        return loc.evaluate((el) => ["aria-pressed", "aria-selected", "aria-checked"].some((a) => el.getAttribute(a) === "true"));
    }
    const node = await axNode();
    switch (p.field) {
      case "name":
        return node?.name?.value ?? null;
      case "checked": {
        const v = prop(node, "checked");
        return v === undefined ? null : v === "true" || v === true;
      }
      case "expanded": {
        const v = prop(node, "expanded");
        return v === undefined ? null : v === true || v === "true";
      }
      case "disabled":
        return prop(node, "disabled") === true;
      case "value": {
        const v = node?.value?.value ?? prop(node, "valuenow");
        if (v === undefined || v === null || v === "") return null;
        const n = Number(v);
        return Number.isFinite(n) ? (typeof v === "number" ? float32(n) : n) : null;
      }
      case "role": {
        const r = String(node?.role?.value ?? "");
        return ROLES[r] ?? r.toLowerCase();
      }
    }
    throw new RpcError(STEP_FAILED, `unknown field ${p.field}`);
  },
  // protocol: where a part is on screen, in CSS pixels. A part that is not rendered, or not on
  // the page now (an item's task box when it has none), is 0×0.
  async bounds(p) {
    let loc;
    try {
      loc = await mark(p.part);
    } catch (e) {
      if (e instanceof RpcError && e.code === NO_PART && mounted) return { x: 0, y: 0, width: 0, height: 0 };
      throw e;
    }
    const box = await loc.boundingBox();
    return box ? { x: box.x, y: box.y, width: box.width, height: box.height } : { x: 0, y: 0, width: 0, height: 0 };
  },
  // contract: expect[] with event:. Since the last call; a mount starts afresh, and its own
  // writes (a spot's box, a plane's drawn region, from the first layout) are reported.
  async events() {
    if (!mounted) return [];
    return page.evaluate(() => window.omnicui.events());
  },
};

// ---- the conversation

const send = (msg) => process.stdout.write(JSON.stringify({ jsonrpc: "2.0", ...msg }) + "\n");
let queue = Promise.resolve();
createInterface({ input: process.stdin })
  .on("line", (line) => {
    if (!line.trim()) return;
    queue = queue.then(async () => {
      let req;
      try {
        req = JSON.parse(line);
      } catch {
        return send({ id: null, error: { code: -32700, message: "parse error" } });
      }
      const fn = req.method ? methods[req.method] : undefined;
      if (!fn) return send({ id: req.id, error: { code: NO_METHOD, message: `unknown method ${req.method}` } });
      try {
        send({ id: req.id, result: (await fn(req.params ?? {})) ?? null });
      } catch (e) {
        const code = e instanceof RpcError ? e.code : STEP_FAILED;
        log(req.method, "failed:", e?.message ?? e);
        send({ id: req.id, error: { code, message: String(e?.message ?? e).split("\n")[0] } });
      }
    });
  })
  .on("close", async () => {
    // omnicui waits 3 s for the adapter to go, then kills it: go before that, whatever Chromium does
    setTimeout(() => process.exit(0), 2000).unref();
    await queue;
    browser.removeAllListeners("disconnected");
    await browser.close().catch(() => {});
    server.close();
    process.exit(0);
  });
log("ready:", base, "· mkp:", mkp, "· contract defaults from:", contractsFile ?? "(none)");
