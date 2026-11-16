// The playground in a real Chromium: it loads, draws a page, follows the editor, and the page's
// Markdown and $state follow the reader. Chromium is MKP_CHROMIUM, or /usr/bin/chromium; none is
// downloaded. Skipped when @mkp/dom isn't built yet, or there is no Chromium or mkp binary.

import { test, before, after, describe } from "node:test";
import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { findBinary, startServer } from "../server.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const app = join(here, "..");
const chromiumPath = process.env.MKP_CHROMIUM ?? "/usr/bin/chromium";
const domBuilt = existsSync(join(app, "node_modules/@mkp/dom/dist/index.js"));

const skip = !domBuilt
  ? "@mkp/dom is not built: run npm run build in targets/ts/dom"
  : !existsSync(chromiumPath)
    ? `no Chromium at ${chromiumPath}: set MKP_CHROMIUM`
    : !findBinary()
      ? "no mkp binary: build targets/rust"
      : false;

const quiet = { info() {}, warn() {}, error: (m, f) => process.stderr.write(`server: ${m} ${JSON.stringify(f ?? {})}\n`) };

describe("the playground in Chromium", { skip }, () => {
  let server;
  let browser;
  let tab;
  const pageErrors = [];

  before(async () => {
    const { buildBundle } = await import("../build.mjs");
    await buildBundle({ minify: false });
    server = await startServer({ port: 0, host: "127.0.0.1", buildBundle: false, log: quiet, notifyUrl: "", notifyToken: "" });
    const { chromium } = await import("playwright-core");
    browser = await chromium.launch({ executablePath: chromiumPath, headless: true });
    tab = await browser.newPage({ viewport: { width: 1440, height: 900 } });
    tab.setDefaultTimeout(20_000);
    tab.on("pageerror", (e) => pageErrors.push(e));
    tab.on("console", (m) => {
      if (m.type() === "error") pageErrors.push(new Error(m.text()));
    });
  });

  after(async () => {
    await browser?.close();
    await server?.close();
  });

  const status = () => tab.getByTestId("status");
  const preview = () => tab.getByTestId("preview");
  const markdown = () => tab.getByTestId("markdown-output");

  /** Waits for the compile the last edit started to finish with the given state. */
  async function compiled(state = "ok") {
    await tab.waitForFunction(() => !["pending", "compiling", "loading"].includes(document.getElementById("status")?.dataset.state ?? ""));
    assert.equal(await status().getAttribute("data-state"), state, `status: ${await status().textContent()}`);
  }

  /** Types at the end of the editor, as a reader would. */
  async function typeAtEnd(text) {
    await tab.getByTestId("editor").click();
    await tab.keyboard.press("Control+End");
    await tab.keyboard.type(text);
  }

  test("loads the first example and draws it", async () => {
    await tab.goto(server.url);
    await tab.waitForSelector('[data-testid=status][data-state=ok]');
    assert.equal(await tab.getByTestId("example-picker").inputValue(), "counter");
    await preview().getByRole("button", { name: "Add 1" }).waitFor();
    assert.match(await preview().textContent(), /Count/);
    assert.match(await markdown().textContent(), /Count: \*\*0\*\*/);
    assert.equal(await tab.locator("#preview-pane").getAttribute("data-stale"), "false");
  });

  test("typing into the editor redraws the page", async () => {
    await typeAtEnd("\n@counter(by = 5);\n");
    await preview().getByRole("button", { name: "Add 5" }).waitFor();
    await compiled("ok");
    assert.equal(await preview().getByRole("button", { name: "Add 1" }).count(), 1, "the first counter is still there");
  });

  test("pressing a button in the page updates its Markdown and $state", async () => {
    await preview().getByRole("button", { name: "Add 5" }).click();
    await tab.waitForFunction(() => document.getElementById("markdown-output")?.textContent?.includes("Count: **5**"));
    await tab.getByTestId("tab-state").click();
    assert.equal(await tab.locator("#state-count").inputValue(), "5");
    await preview().getByRole("button", { name: "Add 1" }).click();
    await tab.waitForFunction(() => document.getElementById("state-count")?.value === "6");
    assert.match(await markdown().textContent(), /Count: \*\*6\*\*/);
  });

  test("a recompile keeps $state", async () => {
    await typeAtEnd("\nMore prose.\n");
    await tab.waitForFunction(() => document.getElementById("markdown-output")?.textContent?.includes("More prose."));
    await compiled("ok");
    assert.equal(await tab.locator("#state-count").inputValue(), "6");
  });

  test("an error lists its diagnostics and keeps the last page, stale", async () => {
    await typeAtEnd("@nowhere;");
    await tab.waitForSelector("[data-testid=status][data-state=errors]");
    assert.equal(await tab.locator("#preview-pane").getAttribute("data-stale"), "true");
    assert.equal(await tab.getByTestId("stale-banner").isVisible(), true);
    assert.equal(await preview().getByRole("button", { name: "Add 5" }).count(), 1, "the last page is still drawn");
    assert.ok(Number(await tab.locator("#diagnostics-count").textContent()) >= 1);

    await tab.getByTestId("tab-diagnostics").click();
    const first = tab.getByTestId("diagnostic").first();
    const line = Number(await first.getAttribute("data-line"));
    const source = await tab.getByTestId("editor").inputValue();
    assert.equal(source.split("\n")[line - 1], "@nowhere;", "the diagnostic is on the line typed");
    assert.match(await first.textContent(), new RegExp(`${line}:\\d+`));

    // clicking it puts the caret on its line
    await tab.getByTestId("editor").evaluate((t) => t.setSelectionRange(0, 0));
    await first.click();
    const caretLine = await tab.getByTestId("editor").evaluate((t) => t.value.slice(0, t.selectionStart).split("\n").length);
    assert.equal(caretLine, line);
    assert.equal(await tab.evaluate(() => document.activeElement?.id), "editor");

    // fix it: the page is fresh again
    await tab.keyboard.press("Home");
    await tab.keyboard.press("Shift+End");
    await tab.keyboard.press("Backspace");
    await tab.waitForSelector("[data-testid=status][data-state=ok]");
    assert.equal(await tab.locator("#preview-pane").getAttribute("data-stale"), "false");
    assert.equal(await tab.getByTestId("diagnostic").count(), 0);
  });

  test("an example from the picker, and a $state write refused by its rule", async () => {
    await tab.getByTestId("example-picker").selectOption("slider");
    await tab.waitForSelector("[data-testid=status][data-state=ok]");
    await tab.waitForFunction(() => document.getElementById("markdown-output")?.textContent?.includes("Level **4**, limit **7**"));
    await tab.getByTestId("tab-state").click();

    const level = tab.locator("#state-level");
    await level.fill("9");
    await level.press("Enter");
    const msg = tab.getByTestId("state-level").locator(".state-msg");
    await msg.waitFor({ state: "visible" });
    assert.match(await msg.textContent(), /the level stays at or below the limit/);
    assert.match(await tab.getByTestId("notice").textContent(), /Refused/);
    assert.equal(await level.inputValue(), "4", "the refused value is not kept");
    assert.match(await markdown().textContent(), /Level \*\*4\*\*/);

    await level.fill("2");
    await level.press("Enter");
    await tab.waitForFunction(() => document.getElementById("markdown-output")?.textContent?.includes("Level **2**"));
    assert.equal(await msg.isVisible(), false);
    assert.match(await tab.getByTestId("state-level").getAttribute("class"), /\bchanged\b/, "the row flashes");
    assert.doesNotMatch(await tab.getByTestId("state-level").getAttribute("class"), /\brefused\b/);
  });

  test("a kept $state value that no longer fits its field starts again from its default", async () => {
    const level = tab.locator("#state-level");
    await level.fill("6");
    await level.press("Enter");
    await tab.waitForFunction(() => document.getElementById("markdown-output")?.textContent?.includes("Level **6**"));
    // the field now allows 0..5: 6 doesn't fit, so level is 4 again; limit keeps its 7
    await tab.getByTestId("editor").evaluate((t) => {
      const at = t.value.indexOf("level: int 0..10 = 4;");
      t.focus();
      t.setSelectionRange(at, at + "level: int 0..10 = 4;".length);
    });
    await tab.keyboard.insertText("level: int 0..5 = 4;");
    await tab.waitForFunction(() => document.getElementById("markdown-output")?.textContent?.includes("Level **4**, limit **7**"));
    await compiled("ok");
    assert.equal(await tab.locator("#state-level").inputValue(), "4");
    assert.match(await tab.getByTestId("state-level").textContent(), /int 0\.\.5/);
  });

  test("a list page: rows follow their items", async () => {
    await tab.getByTestId("example-picker").selectOption("list");
    await tab.waitForSelector("[data-testid=status][data-state=ok]");
    await tab.getByTestId("tab-markdown").click();
    await tab.waitForFunction(() => document.getElementById("markdown-output")?.textContent?.includes("Write the page"));
    await preview().getByRole("button", { name: "Drop" }).first().click();
    await tab.waitForFunction(() => !document.getElementById("markdown-output")?.textContent?.includes("Write the page"));
    assert.match(await markdown().textContent(), /- \[x\] Try it in the playground/);
  });

  test("a $state list edited as JSON, and a value of the wrong shape refused", async () => {
    await tab.getByTestId("tab-state").click();
    const row = tab.getByTestId("state-tasks");
    // written as MKP writes it, each record's fields in the order task declares them
    assert.match(await row.locator("pre.value").textContent(), /task \{ title = "Ship it", done = false \}/);
    await row.getByRole("button", { name: "Edit" }).click();
    const area = row.locator("textarea");
    const value = JSON.parse(await area.inputValue());
    value.list.push({ record: { type: "doc/task", fields: { title: { text: "Added as JSON" }, done: { bool: false } } } });
    await area.fill(JSON.stringify(value));
    await row.getByRole("button", { name: "Apply" }).click();
    await tab.waitForFunction(() => document.getElementById("markdown-output")?.textContent?.includes("- [ ] Added as JSON"));
    assert.equal(await area.isVisible(), false, "the JSON editor closes once applied");
    await preview().getByText("Added as JSON").waitFor();

    await row.getByRole("button", { name: "Edit" }).click();
    await area.fill('{"num": "3"}');
    await row.getByRole("button", { name: "Apply" }).click();
    assert.match(await row.locator(".state-msg").textContent(), /Refused: the value is a number, not a list<task>/);
    assert.match(await markdown().textContent(), /Added as JSON/, "the page is as it was");
    await row.getByRole("button", { name: "Cancel" }).click();
  });

  test("the graphs pack's release flow draws", async () => {
    await tab.getByTestId("example-picker").selectOption("release-flow");
    await tab.waitForSelector("[data-testid=status][data-state=ok]");
    await tab.waitForFunction(() => document.getElementById("markdown-output")?.textContent?.includes("Release flow"));
    for (const step of ["Build", "Test", "Ship"]) assert.match(await preview().textContent(), new RegExp(step));
  });

  test("on a narrow screen the panes stack", async () => {
    await tab.setViewportSize({ width: 420, height: 860 });
    const editor = await tab.locator("#editor-frame").boundingBox();
    const page = await tab.locator("#preview-pane").boundingBox();
    assert.ok(page.y >= editor.y + editor.height - 1, "the page is under the editor");
    assert.ok(page.width > 380, "and as wide as the screen");
    await tab.setViewportSize({ width: 1440, height: 900 });
  });

  test("the name in the bar starts again: the first example, its starting $state, and a note", async () => {
    await tab.getByTestId("example-picker").selectOption("slider");
    await compiled("ok");
    await typeAtEnd("\nAn edit to throw away.\n");
    await tab.waitForFunction(() => document.getElementById("markdown-output")?.textContent?.includes("An edit to throw away."));
    await tab.getByTestId("brand").click();
    await compiled("ok");
    assert.equal(await tab.getByTestId("example-picker").inputValue(), "counter");
    assert.doesNotMatch(await tab.getByTestId("editor").inputValue(), /An edit to throw away/);
    await tab.waitForFunction(() => document.getElementById("markdown-output")?.textContent?.includes("Count: **0**"));
    assert.match(await tab.getByTestId("notice").textContent(), /Started again with A counter/);
    assert.equal(await tab.getByTestId("notice").isVisible(), true);
  });

  test("no errors in the browser's console", () => {
    assert.deepEqual(
      pageErrors.map((e) => e.message),
      [],
    );
  });
});
