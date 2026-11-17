// Test helpers: pages built by the mkp binary, the harness bundled by esbuild, and a real
// Chromium driven by playwright-core. No browser is downloaded: MKP_CHROMIUM or /usr/bin/chromium.

import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { build } from "esbuild";
import { chromium } from "playwright-core";

const here = dirname(fileURLToPath(import.meta.url));
export const repo = join(here, "../../../..");

function mkpBinary() {
  for (const kind of ["release", "debug"]) {
    const p = join(repo, "targets/rust/target", kind, "mkp");
    if (existsSync(p)) return p;
  }
  throw new Error("no mkp binary: run `cargo build --release` in targets/rust");
}

const dir = mkdtempSync(join(tmpdir(), "mkp-dom-test-"));
let n = 0;

/** A pack written into the work directory, for `ir(source, { packs })`: its directory. */
export function pack(name, source) {
  const p = join(dir, name);
  mkdirSync(p, { recursive: true });
  writeFileSync(join(p, `${name}.mkp`), source);
  return p;
}

/** A document's IR, as text, built by the mkp binary. */
export function ir(source, { packs = [] } = {}) {
  const file = join(dir, `page${n++}.mkp.md`);
  writeFileSync(file, source);
  const out = file.replace(/\.mkp\.md$/, ".ir.json");
  try {
    execFileSync(mkpBinary(), ["build", file, ...packs.flatMap((p) => ["--pack", p]), "--out", out], { stdio: ["ignore", "pipe", "pipe"], maxBuffer: 64 * 1024 * 1024 });
  } catch (e) {
    throw new Error(`mkp build failed:\n${e.stdout ?? ""}${e.stderr ?? ""}`);
  }
  return readFileSync(out, "utf8");
}

let bundled;

async function harness() {
  bundled ??= build({ entryPoints: [join(here, "harness.mjs")], bundle: true, format: "iife", platform: "browser", write: false, target: "es2022" }).then((r) => r.outputFiles[0].text);
  return bundled;
}

export async function launch() {
  return chromium.launch({ executablePath: process.env.MKP_CHROMIUM || "/usr/bin/chromium", headless: true, args: ["--no-sandbox", "--disable-gpu"] });
}

const HTML = `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>mkp dom test</title>
<style>body { margin: 0; padding: 16px; width: 720px; }</style></head><body><main id="app"></main></body></html>`;

/** A browser page with a document mounted. Errors in the page fail the test that reads them. */
export async function open(browser, source, opts = {}) {
  const page = await browser.newPage({ viewport: { width: 800, height: 900 }, ...(opts.context ?? {}) });
  const errors = [];
  page.on("pageerror", (e) => errors.push(String(e)));
  await page.setContent(HTML);
  await page.addScriptTag({ content: await harness() });
  const text = typeof source === "string" && source.trimStart().startsWith("{") ? source : ir(source);
  const { context, ...start } = opts;
  await page.evaluate(([t, o]) => window.mkp.start(t, o), [text, start]);
  page.errors = errors;
  return page;
}

/** Calls window.mkp[name](...args) in the page. */
export function mkp(page, name, ...args) {
  return page.evaluate(([n, a]) => window.mkp[n](...a), [name, args]);
}

export const num = (s) => ({ num: String(s) });
export const text = (s) => ({ text: s });
