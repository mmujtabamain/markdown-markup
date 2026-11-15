// What the bindings' tests share: the test pages compiled, a test app bundled for the browser, a
// real Chromium (jsdom can't lay out @mkp/dom's pages), and the steps every binding must pass.
//
// Each package passes in its own esbuild, playwright-core and @mkp/cli, so this folder needs no
// node_modules of its own.
//
// A test app sets `window.__test` (see `steps` below for what it holds) and draws into #app.

import { existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import assert from "node:assert/strict";

const here = dirname(fileURLToPath(import.meta.url));

export const pages = {
  v1: join(here, "counter.mkp.md"),
  v2: join(here, "counter-v2.mkp.md"),
};

/** The two test pages' IR, compiled by the mkp binary through @mkp/cli. */
export async function compilePages(cli) {
  return { v1: await cli.build(pages.v1), v2: await cli.build(pages.v2) };
}

/** Chromium from the system: MKP_CHROMIUM, or /usr/bin/chromium. Never downloaded. */
export function chromiumPath() {
  const p = process.env.MKP_CHROMIUM || "/usr/bin/chromium";
  if (!existsSync(p)) throw new Error(`no Chromium at ${p}: set MKP_CHROMIUM`);
  return p;
}

export async function launch(chromium) {
  return chromium.launch({ executablePath: chromiumPath(), args: ["--no-sandbox"] });
}

/** A test app bundled into one script for the browser. */
export async function bundle(esbuild, entry, opts = {}) {
  const r = await esbuild.build({
    entryPoints: [entry],
    bundle: true,
    write: false,
    format: "iife",
    platform: "browser",
    target: "es2022",
    logLevel: "silent",
    ...opts,
    define: { "process.env.NODE_ENV": '"development"', ...(opts.define ?? {}) },
  });
  return r.outputFiles.map((f) => f.text).join("\n");
}

/** A browser tab with the IR as `window.__IR`, and the bundle run in it (@mkp/dom puts its own
 * stylesheet in when it mounts). */
export async function open(browser, { js, irs }) {
  const page = await browser.newPage();
  const errors = [];
  page.on("pageerror", (e) => errors.push(e));
  await page.setContent(`<!doctype html><html><head><meta charset="utf-8"></head><body><div id="app"></div></body></html>`);
  await page.evaluate((irs) => {
    window.__IR = irs;
  }, irs);
  await page.addScriptTag({ content: js });
  await page.waitForFunction(() => window.__test !== undefined, null, { timeout: 10000 });
  return { page, errors };
}

const text = (page) => page.evaluate(() => document.querySelector("#app")?.textContent ?? "");

async function until(page, fn, arg, what) {
  try {
    await page.waitForFunction(fn, arg, { timeout: 10000 });
  } catch (e) {
    throw new Error(`timed out waiting for ${what}; #app reads: ${JSON.stringify(await text(page))}`);
  }
}

/**
 * The steps every binding passes, through the test app's `window.__test`:
 * - `heard`: { calls: Call[][], states: $state[], outcomes: Outcome[], mounts: number }, filled
 *   from onCalls, onState, onOutcome and onMount;
 * - `handle()`: the binding's handle (its ref, or usePage's);
 * - `setTheme(theme)`: gives the component a new `page` prop;
 * - `setUnit(text)`: gives it a new `externs` prop, `{ app: { unit: { text } } }`, which starts
 *   as "items";
 * - `setIr("v1" | "v2")`: gives it a new `ir` prop;
 * - `unmount()`: takes the component away.
 */
export async function steps(page) {
  await until(page, () => document.querySelector("#app")?.textContent?.includes("Count: 0 items") && window.__test.heard.mounts >= 1, null, "the page to mount");
  // React's StrictMode mounts twice in development: count from wherever it starts
  const mounts = await page.evaluate(() => window.__test.heard.mounts);
  assert.equal(await page.evaluate(() => document.querySelectorAll("[data-mkp-root]").length), 1, "one page drawn");
  assert.ok(await page.evaluate(() => document.querySelector("#app [data-mkp-site]") !== null), "the page is drawn by @mkp/dom");

  // a reader's click, through the press's own DOM: onState and onCalls hear it
  await page.click('#app [data-mkp-widget="core/press"]');
  await until(page, () => document.querySelector("#app").textContent.includes("Count: 1 items"), null, "the click");
  await until(page, () => window.__test.heard.calls.length === 1, null, "onCalls");
  const heard = await page.evaluate(() => window.__test.heard);
  assert.deepEqual(heard.calls, [[{ call: { name: "doc/app.saved", args: [{ num: "1" }] } }]]);
  assert.deepEqual(heard.states.at(-1), { n: { num: "1" } });

  // the app's write: refused when it doesn't fit, and onOutcome hears it; done when it does
  await page.evaluate(() => window.__test.handle().set({ n: { num: "20" } }));
  await until(page, () => window.__test.heard.outcomes.length === 1, null, "onOutcome");
  assert.deepEqual((await page.evaluate(() => window.__test.heard.outcomes))[0].refused, [{ code: "contracts.outside", site: "$state.n" }]);
  await page.evaluate(() => window.__test.handle().set({ n: { num: "4" } }));
  await until(page, () => document.querySelector("#app").textContent.includes("Count: 4 items"), null, "the app's write");
  assert.deepEqual(await page.evaluate(() => window.__test.handle().state()), { n: { num: "4" } });

  // an exposed fn, then the page's Markdown
  await page.evaluate(() => window.__test.handle().expose("app", "reset"));
  await until(page, () => document.querySelector("#app").textContent.includes("Count: 0 items"), null, "expose");
  await page.evaluate(() => window.__test.handle().set({ n: { num: "3" } }));
  assert.equal(await page.evaluate(() => window.__test.handle().markdown()), "# Count: 3 items\n\nAdd one\n");

  // extern values: a new `externs` prop, then the handle's
  await page.evaluate(() => window.__test.setUnit("pts"));
  await until(page, () => document.querySelector("#app").textContent.includes("Count: 3 pts"), null, "the externs prop");
  await page.evaluate(() => window.__test.handle().extern("app", { unit: { text: "beans" } }));
  await until(page, () => document.querySelector("#app").textContent.includes("Count: 3 beans"), null, "handle.extern");

  // a new `page` prop: page.setPage
  await page.evaluate(() => window.__test.setTheme("DARK"));
  await until(page, () => window.__test.handle().page.externsNow().get("core/page.theme")?.name === "DARK", null, "the theme");

  // a new `ir` prop: remounted, $state kept where its fields still exist
  await page.evaluate(() => window.__test.setIr("v2"));
  await until(page, (m) => document.querySelector("#app").textContent.includes("Total: 3 beans, by 2") && window.__test.heard.mounts === m + 1, mounts, "the new IR");
  assert.deepEqual(await page.evaluate(() => window.__test.handle().state()), { n: { num: "3" }, stride: { num: "2" } });
  assert.equal(await page.evaluate(() => window.__test.handle().page.externsNow().get("core/page.theme")?.name), "DARK", "the page's values survive a remount");

  // gone: unmounted, and nothing left in the element
  await page.evaluate(() => window.__test.unmount());
  await until(page, () => document.querySelector("#app [data-mkp-site]") === null, null, "the unmount");
}
