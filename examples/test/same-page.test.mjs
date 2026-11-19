// The same page from plain TypeScript, React and Next.js: each example is built and served, opened
// in Chromium, and driven through the same steps. After each step the three must agree on the
// page's Markdown, its `$state`, the text and widgets in the page's element, the extern fn calls
// the app heard and what the app showed for them.
//
// Run it with `npm test` in this folder (see run.mjs). Chromium is XTMD_CHROMIUM or
// /usr/bin/chromium; it is never downloaded.

import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { spawn, execFileSync } from "node:child_process";
import { createServer } from "node:http";
import { existsSync, readFileSync, statSync } from "node:fs";
import { extname, join, normalize, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright-core";

const examples = resolve(fileURLToPath(new URL("..", import.meta.url)));
const chromiumPath = process.env.XTMD_CHROMIUM || "/usr/bin/chromium";
const skipBuild = process.env.XTMD_SKIP_BUILD === "1";

const TYPES = { ".html": "text/html", ".js": "text/javascript", ".css": "text/css", ".svg": "image/svg+xml", ".json": "application/json" };

/** A folder served over HTTP on a free port: a built Vite app. */
function serve(dir) {
  const server = createServer((req, res) => {
    const path = normalize(decodeURIComponent(new URL(req.url, "http://x").pathname));
    let file = join(dir, path);
    if (!file.startsWith(dir) || !existsSync(file) || statSync(file).isDirectory()) file = join(dir, "index.html");
    res.writeHead(200, { "content-type": TYPES[extname(file)] ?? "application/octet-stream" });
    res.end(readFileSync(file));
  });
  return new Promise((done) => server.listen(0, "127.0.0.1", () => done({ url: `http://127.0.0.1:${server.address().port}/`, close: () => server.close() })));
}

function npm(args, cwd) {
  execFileSync("npm", args, { cwd, stdio: ["ignore", "inherit", "inherit"] });
}

/** `next start` on a free port, once it answers. */
async function nextStart(dir) {
  const port = await new Promise((done) => {
    const s = createServer().listen(0, "127.0.0.1", () => {
      const p = s.address().port;
      s.close(() => done(p));
    });
  });
  const child = spawn(join(dir, "node_modules/.bin/next"), ["start", "-p", String(port), "-H", "127.0.0.1"], { cwd: dir, stdio: ["ignore", "pipe", "pipe"] });
  let log = "";
  child.stdout.on("data", (d) => (log += d));
  child.stderr.on("data", (d) => (log += d));
  const url = `http://127.0.0.1:${port}/`;
  for (let i = 0; i < 300; i++) {
    try {
      const r = await fetch(url);
      if (r.ok) return { url, html: await r.text(), close: () => child.kill() };
    } catch {
      // not listening yet
    }
    if (child.exitCode !== null) throw new Error(`next start exited:\n${log}`);
    await new Promise((r) => setTimeout(r, 100));
  }
  child.kill();
  throw new Error(`next start didn't answer:\n${log}`);
}

const apps = {};
let browser;

before(async () => {
  if (!skipBuild) {
    npm(["run", "build"], join(examples, "web-plain"));
    npm(["run", "build"], join(examples, "web-react"));
    npm(["run", process.env.XTMD_NEXT_BUNDLER === "webpack" ? "build:webpack" : "build"], join(examples, "web-next"));
  }
  apps.plain = await serve(join(examples, "web-plain/dist"));
  apps.react = await serve(join(examples, "web-react/dist"));
  apps.next = await nextStart(join(examples, "web-next"));
  browser = await chromium.launch({ executablePath: chromiumPath, args: ["--no-sandbox"] });
});

after(async () => {
  await browser?.close();
  for (const a of Object.values(apps)) a.close();
});

/** Two frames: the DOM drawn and the plane's layout written. */
const settle = (page) => page.evaluate(() => new Promise((done) => requestAnimationFrame(() => requestAnimationFrame(done))));

/** What the three must agree on, read from one app. */
function observe(page) {
  return page.evaluate(() => {
    const shop = document.getElementById("shop");
    const slider = shop.querySelector('[data-xtmd-widget="core/slider"] input[type="range"]');
    // reading the Markdown leaves the page as it was, so the steps after it still work
    const markdown = window.__xtmd.page.markdown();
    return {
      markdown,
      state: window.__xtmd.page.observeState(),
      // what the page shows: a stylesheet in it (XtmdDoc's) isn't text the reader sees
      text: [...shop.childNodes].filter((n) => n.nodeName !== "STYLE").map((n) => n.textContent).join("").replace(/\s+/g, " ").trim(),
      widgets: [...shop.querySelectorAll("[data-xtmd-site]")].map((e) => `${e.getAttribute("data-xtmd-site")} ${e.getAttribute("data-xtmd-widget")}`),
      slider: slider?.value ?? null,
      calls: window.__calls,
      orders: [...document.querySelectorAll("#orders li")].map((li) => li.textContent),
    };
  });
}

/** Waits until the page's $state passes a test, then for the DOM and the app to catch up. */
async function until(page, what, fn, arg) {
  try {
    await page.waitForFunction(fn, arg, { timeout: 15000 });
  } catch {
    const inside = await page.evaluate(() => ({ outcome: window.__xtmd?.page.takeOutcome(), errors: window.__xtmd?.page.errors.map(String), active: document.activeElement?.getAttribute("data-xtmd-site") ?? document.activeElement?.tagName })).catch((e) => String(e));
    throw new Error(`timed out waiting for ${what}: ${JSON.stringify(inside)} ${JSON.stringify(await observe(page).catch((e) => String(e)))}`);
  }
  await settle(page);
}

const press = (page, label) => page.locator('#shop [data-xtmd-widget="core/press"]', { hasText: label }).first().click();

/** The slider moved through its own input, as a reader's drag ends: input, then change. */
const slide = (page, value) =>
  page.locator('#shop [data-xtmd-widget="core/slider"] input[type="range"]').evaluate((el, v) => {
    el.value = v;
    el.dispatchEvent(new Event("input", { bubbles: true }));
    el.dispatchEvent(new Event("change", { bubbles: true }));
  }, String(value));

/** Whether a `$state` field holds a number now. */
const holds = ([field, n]) => window.__xtmd?.page.observeState()[field]?.num === n;

/** The steps, the same in each app; what each step should leave, to check they agree on it. */
const STEPS = [
  {
    name: "loaded",
    act: async () => {},
    wait: (page) => until(page, "the page to mount", () => window.__xtmd !== undefined && document.querySelector("#shop [data-xtmd-site]") !== null),
    check: (o) => {
      assert.match(o.markdown, /^# Shop\n\nThe basket holds 3 items for 36 € of a 60 € budget\./);
      assert.deepEqual(o.state.budget, { num: "60" });
    },
  },
  {
    name: "pressed Check out",
    act: (page) => press(page, "Check out"),
    wait: async (page) => {
      await until(page, "the order", holds, ["orders", "1"]);
      await until(page, "the app to list it", () => document.querySelectorAll("#orders li").length === 1);
    },
    check: (o) => {
      assert.deepEqual(o.calls, [{ call: { name: "doc/shop.checkout", args: [{ num: "36" }, { num: "3" }] } }]);
      assert.deepEqual(o.orders, ["Order 1: 36 € for 3 items"]);
      assert.match(o.markdown, /Orders placed: 1\./);
    },
  },
  {
    name: "slid the budget to 45",
    act: (page) => slide(page, 45),
    wait: (page) => until(page, "the budget", holds, ["budget", "45"]),
    check: (o) => {
      assert.match(o.markdown, /for 36 € of a 45 € budget\./);
      assert.equal(o.slider, "45");
    },
  },
  {
    name: "slid it under the basket: refused by the rule",
    act: async (page) => {
      await page.evaluate(() => window.__xtmd.page.takeOutcome());
      await slide(page, 20);
    },
    wait: (page) => until(page, "the refusal", () => window.__xtmd.page.observeState().budget.num === "45" && document.querySelector('#shop [data-xtmd-widget="core/slider"] input[type="range"]')?.value === "45"),
    check: (o) => {
      assert.deepEqual(o.state.budget, { num: "45" });
      assert.match(o.markdown, /of a 45 € budget\./);
    },
  },
  {
    name: "removed Honey",
    act: (page) => press(page, "Remove Honey"),
    wait: (page) => until(page, "the row to go", () => window.__xtmd.page.observeState().items.list.length === 2),
    check: (o) => {
      assert.match(o.markdown, /The basket holds 2 items for 18 € of a 45 € budget\.\n\n- Tea: 12 €\n- Bread: 6 €\n/);
      assert.ok(!o.text.includes("Honey"));
    },
  },
  {
    name: "pressed Check out again",
    act: (page) => press(page, "Check out"),
    wait: async (page) => {
      await until(page, "the second order", holds, ["orders", "2"]);
      await until(page, "the app to list it", () => document.querySelectorAll("#orders li").length === 2);
    },
    check: (o) => {
      assert.deepEqual(o.calls.at(-1), { call: { name: "doc/shop.checkout", args: [{ num: "18" }, { num: "2" }] } });
      assert.deepEqual(o.orders, ["Order 1: 36 € for 3 items", "Order 2: 18 € for 2 items"]);
    },
  },
];

test("Next.js renders the page itself on the server: XtmdDoc's widgets, in the HTML", () => {
  const html = apps.next.html.replace(/<!--[^>]*-->/g, "");
  assert.match(html, /<div[^>]* id="shop"[^>]*class="xtmd-root[^"]*"|<div[^>]* class="xtmd-root[^"]*"[^>]* id="shop"/);
  assert.match(html, /The basket holds 3 items for 36 € of a 60 € budget\./);
  assert.match(html, /data-xtmd-widget="core\/slider"/);
});

test("the same page from plain TypeScript, React and Next.js agrees after every step", async () => {
  const tabs = {};
  const errors = {};
  for (const [name, app] of Object.entries(apps)) {
    const page = await browser.newPage({ viewport: { width: 800, height: 900 } });
    errors[name] = [];
    page.on("pageerror", (e) => errors[name].push(String(e)));
    // a failed request is reported by its address below; the console's line for it has none
    page.on("console", (m) => m.type() === "error" && !m.text().startsWith("Failed to load resource") && errors[name].push(m.text()));
    page.on("response", (r) => r.status() >= 400 && !r.url().endsWith("/favicon.ico") && errors[name].push(`${r.status()} ${r.url()}`));
    await page.goto(app.url);
    tabs[name] = page;
  }
  for (const step of STEPS) {
    const seen = {};
    for (const [name, page] of Object.entries(tabs)) {
      try {
        await step.act(page);
        await step.wait(page);
      } catch (e) {
        throw new Error(`${name}, at "${step.name}": ${e.message}`);
      }
      seen[name] = await observe(page);
    }
    step.check(seen.plain);
    assert.deepEqual(seen.react, seen.plain, `React disagrees with plain TypeScript after: ${step.name}`);
    assert.deepEqual(seen.next, seen.plain, `Next.js disagrees with plain TypeScript after: ${step.name}`);
  }
  assert.deepEqual(errors, { plain: [], react: [], next: [] });
});
