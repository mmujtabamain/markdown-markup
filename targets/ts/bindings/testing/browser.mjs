// What the bindings' tests share: the test pages compiled, a test app bundled for the browser, a
// real Chromium (jsdom can't lay out @mkp/dom's pages), and the steps every binding must pass.
//
// Each package passes in its own esbuild, playwright-core and @mkp/cli, so this folder needs no
// node_modules of its own.
//
// A test app sets `window.__test` (see `steps` below for what it holds) and draws into #app.

import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import assert from "node:assert/strict";

const here = dirname(fileURLToPath(import.meta.url));

export const pages = {
  v1: join(here, "counter.mkp.md"),
  v2: join(here, "counter-v2.mkp.md"),
  notes: join(here, "notes.mkp.md"),
};

/** The test pages' IR, compiled by the mkp binary through @mkp/cli. */
export async function compilePages(cli) {
  return { v1: await cli.build(pages.v1), v2: await cli.build(pages.v2), notes: await cli.build(pages.notes) };
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

/**
 * The steps every binding's <MkpDoc> passes, through the test app's `window.__test`:
 * - `heard`: { states: $state[], errors: DocError[], calls: Call[][] }, from onStateChange,
 *   onError and onCalls;
 * - `handle()`: the component's handle (snapshot, restore, set, state, markdown, expose);
 * - `setState(state)`: gives it a new controlled `state` prop (the app also follows onStateChange);
 * - `setTheme(theme)`, `setUnit(text)` (`externs.app.unit`, starting as "items"), `setIr("v1" |
 *   "v2" | "notes")` and `unmount()`, as in `steps`.
 *
 * `stylesheet` is where the page's stylesheet is: in the page (@mkp/view's) or in the document (@mkp/dom's).
 */
export async function docSteps(page, { stylesheet = "page" } = {}) {
  const app = () => page.evaluate(() => document.querySelector("#app")?.textContent ?? "");
  await until(page, () => document.querySelector("#app")?.textContent?.includes("Count: 0 items"), null, "the page to render");
  assert.equal(await page.evaluate(() => document.querySelectorAll("[data-mkp-root]").length), 1, "one page drawn");
  assert.ok(await page.evaluate(() => document.querySelector('#app [data-mkp-widget="core/press"] [data-part="press.label"]') !== null), "core's press, drawn with its parts");
  // in the page itself (@mkp/view's), or once in the document (@mkp/dom's)
  assert.ok(await page.evaluate((where) => document.querySelector(where === "page" ? "#app style[data-mkp-dom]" : "style[data-mkp-dom]") !== null, stylesheet), "the stylesheet");

  // a reader's click: onStateChange and onCalls hear it
  await page.click('#app [data-mkp-widget="core/press"]');
  await until(page, () => document.querySelector("#app").textContent.includes("Count: 1 items"), null, "the click");
  await until(page, () => window.__test.heard.calls.length === 1, null, "onCalls");
  let heard = await page.evaluate(() => window.__test.heard);
  assert.deepEqual(heard.calls, [[{ call: { name: "doc/app.saved", args: [{ num: "1" }] } }]]);
  assert.deepEqual(heard.states.at(-1), { n: { num: "1" } });

  // controlled: the app's `state` prop is a checked write, refused when it doesn't fit
  await page.evaluate(() => window.__test.setState({ n: { num: "20" } }));
  await until(page, () => window.__test.heard.errors.some((e) => e.kind === "refused"), null, "the refused state prop");
  assert.ok((await app()).includes("Count: 1 items"), "a refused state leaves the page as it was");
  await page.evaluate(() => window.__test.setState({ n: { num: "4" } }));
  await until(page, () => document.querySelector("#app").textContent.includes("Count: 4 items"), null, "the state prop");

  // the handle: a write refused and done, an exposed fn, the Markdown
  const errors = await page.evaluate(() => window.__test.heard.errors.length);
  await page.evaluate(() => window.__test.handle().set({ n: { num: "20" } }));
  await until(page, (k) => window.__test.heard.errors.length > k, errors, "onError for the handle's write");
  assert.deepEqual((await page.evaluate(() => window.__test.heard.errors)).at(-1), { kind: "refused", code: "contracts.outside", site: "$state.n" });
  await page.evaluate(() => window.__test.handle().expose("app", "reset"));
  await until(page, () => document.querySelector("#app").textContent.includes("Count: 0 items"), null, "expose");
  await page.evaluate(() => window.__test.handle().set({ n: { num: "3" } }));
  await until(page, () => document.querySelector("#app").textContent.includes("Count: 3 items"), null, "the handle's write");
  assert.equal(await page.evaluate(() => window.__test.handle().markdown()), "# Count: 3 items\n\nAdd one\n");

  // props: externs, the theme, a new IR with $state kept where its fields still exist
  await page.evaluate(() => window.__test.setUnit("pts"));
  await until(page, () => document.querySelector("#app").textContent.includes("Count: 3 pts"), null, "the externs prop");
  await page.evaluate(() => window.__test.setTheme("DARK"));
  // the root is a child of #app (@mkp/view's), or #app itself (@mkp/dom's)
  await until(page, () => (document.querySelector("#app [data-mkp-root]") ?? document.querySelector("#app[data-mkp-root]"))?.getAttribute("data-mkp-theme") === "dark", null, "the theme");
  await page.evaluate(() => window.__test.setIr("v2"));
  await until(page, () => document.querySelector("#app").textContent.includes("Total: 3 pts, by 2"), null, "the new IR");
  assert.deepEqual(await page.evaluate(() => window.__test.handle().state()), { n: { num: "3" }, stride: { num: "2" } });

  // widgets' own variables, kept by the page across redraws, and a snapshot that brings them back
  await page.evaluate(() => window.__test.setIr("notes"));
  await until(page, () => document.querySelector("#app").textContent.includes("Apples: 0"), null, "the notes page");
  const field = '#app [data-part="field.input"]';
  await page.fill(field, "call at 5");
  await page.click('#app [data-mkp-widget="core/press"]');
  await page.click('#app [data-mkp-widget="core/press"]');
  await until(page, () => document.querySelector("#app").textContent.includes("Apples: 2"), null, "the tally's own count");
  assert.equal(await page.inputValue(field), "call at 5", "a redraw keeps what was typed");
  await page.click('#app [data-part="overlay.anchor"]');
  await until(page, () => document.querySelector('#app [data-part="overlay.body"]')?.matches(":popover-open"), null, "the overlay to open");
  const snap = await page.evaluate(() => window.__test.handle().snapshot());
  assert.equal(snap.mkp, "0.3.0");
  assert.deepEqual(Object.values(snap.own).flatMap((o) => Object.entries(o)).sort(), [["k", { num: "2" }], ["note", { text: "call at 5" }], ["open", { bool: true }]].sort());
  await page.fill(field, "never mind");
  await page.click('#app [data-mkp-widget="core/press"]');
  await until(page, () => document.querySelector("#app").textContent.includes("Apples: 3"), null, "the third click");
  const all = await page.evaluate((s) => window.__test.handle().restore(s), snap);
  assert.deepEqual(all, { restored: "all", dropped: [] });
  await until(page, () => document.querySelector("#app").textContent.includes("Apples: 2"), null, "the restored count");
  assert.equal(await page.inputValue(field), "call at 5", "the restored note");
  // from another IR, only $state can go back: its places may be other widgets now
  const other = await page.evaluate((s) => window.__test.handle().restore({ ...s, ir: "another", state: { n: { num: "7" } } }), snap);
  assert.deepEqual(other, { restored: "state", dropped: ["own"] });
  await until(page, () => document.querySelector("#app").textContent.includes("Notes: 7"), null, "the restored $state");
  // one this mkp can't read: nothing restored
  assert.equal((await page.evaluate(() => window.__test.handle().restore({ mkp: "9.9.9" }))).restored, "none");

  // gone: unmounted, and nothing left in the element
  await page.evaluate(() => window.__test.unmount());
  await until(page, () => document.querySelector("#app [data-mkp-site]") === null, null, "the unmount");
}

/** The test pages' text, a broken draft of the first among them, for the real-time targets. */
export function pageSources() {
  const v1 = readFileSync(pages.v1, "utf8");
  return { v1, v2: readFileSync(pages.v2, "utf8"), broken: v1.replace("# Count: \\{$state.n}", "# Count: \\{$state.nope}") };
}

/** Where a live test app finds mkp.wasm: `window.__WASM_URL`, answered by the tab itself. */
export const WASM_URL = "http://mkp.test/mkp.wasm";
const wasmFile = join(here, "../../wasm/mkp.wasm");

/** A tab for a real-time target's test app: the sources as `window.__SRC`, mkp.wasm served at
 * `window.__WASM_URL`, and the bundle run in it. */
export async function openLive(browser, { js }) {
  const page = await browser.newPage();
  const errors = [];
  page.on("pageerror", (e) => errors.push(e));
  const wasm = readFileSync(wasmFile);
  await page.route(WASM_URL, (r) => r.fulfill({ status: 200, contentType: "application/wasm", headers: { "access-control-allow-origin": "*" }, body: wasm }));
  await page.setContent(`<!doctype html><html><head><meta charset="utf-8"></head><body><div id="app"></div></body></html>`);
  await page.evaluate(([src, url]) => {
    window.__SRC = src;
    window.__WASM_URL = url;
  }, [pageSources(), WASM_URL]);
  await page.addScriptTag({ content: js });
  await page.waitForFunction(() => window.__test !== undefined, null, { timeout: 10000 });
  return { page, errors };
}

/**
 * The steps every real-time target's <MkpLiveDoc> passes, through the test app's `window.__test`:
 * - `heard`: { states, errors, calls }, from onStateChange, onError and onCalls;
 * - `handle()`: the component's handle;
 * - `setSource(text)`: gives it a new `source`, starting from `window.__SRC.v1`, with
 *   `externs.app.unit` "items" and `wasm` `window.__WASM_URL`.
 */
export async function liveSteps(page) {
  const app = () => page.evaluate(() => document.querySelector("#app")?.textContent ?? "");
  // compiled in the tab, then drawn
  await until(page, () => document.querySelector("#app")?.textContent?.includes("Count: 0 items"), null, "the text to compile and render");
  assert.equal(await page.evaluate(() => document.querySelectorAll("[data-mkp-root]").length), 1, "one page drawn");
  await page.click('#app [data-mkp-widget="core/press"]');
  await until(page, () => document.querySelector("#app").textContent.includes("Count: 1 items"), null, "the click");
  assert.deepEqual((await page.evaluate(() => window.__test.heard.states)).at(-1), { n: { num: "1" } });

  // an edit that compiles: the new page, with $state kept where its fields still exist
  await page.evaluate(() => window.__test.setSource(window.__SRC.v2));
  await until(page, () => document.querySelector("#app").textContent.includes("Total: 1 items, by 2"), null, "the edited text");

  // a draft that doesn't compile: the last page stays, and its errors reach onError
  await page.evaluate(() => window.__test.setSource(window.__SRC.broken));
  await until(page, () => window.__test.heard.errors.some((e) => e.kind === "compile"), null, "the compile error");
  const e = (await page.evaluate(() => window.__test.heard.errors)).find((x) => x.kind === "compile");
  assert.match(e.message, /^page\.mkp\.md doesn't compile \(\d+ errors?\): page\.mkp\.md:\d+:\d+: /);
  assert.ok(e.diagnostics.some((d) => d.severity === "error" && d.file === "page.mkp.md"), JSON.stringify(e.diagnostics));
  assert.ok((await app()).includes("Total: 1 items, by 2"), "a broken draft leaves the last page");
  assert.ok(await page.evaluate(() => document.querySelector('#app [data-mkp-widget="core/press"]') !== null), "and it still works");

  // fixed: the page follows again, and the handle reaches it
  await page.evaluate(() => window.__test.setSource(window.__SRC.v1));
  await until(page, () => document.querySelector("#app").textContent.includes("Count: 1 items"), null, "the fixed text");
  await page.evaluate(() => window.__test.handle().set({ n: { num: "3" } }));
  await until(page, () => document.querySelector("#app").textContent.includes("Count: 3 items"), null, "the handle's write");
  assert.equal(await page.evaluate(() => window.__test.handle().markdown()), "# Count: 3 items\n\nAdd one\n");
}
