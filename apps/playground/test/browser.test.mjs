// The playground in a real Chromium: it loads, draws a page, follows the editor, and the page's
// Markdown and $state follow the reader. Chromium is MKP_CHROMIUM, or /usr/bin/chromium; none is
// downloaded. Skipped when @mkp/dom isn't built yet, or there is no Chromium or mkp.wasm.

import { test, before, after, describe } from "node:test";
import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { startServer } from "../server.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const app = join(here, "..");
const chromiumPath = process.env.MKP_CHROMIUM ?? "/usr/bin/chromium";
const domBuilt = existsSync(join(app, "node_modules/@mkp/dom/dist/index.js"));

const skip = !domBuilt
  ? "@mkp/dom is not built: run npm run build in targets/ts/dom"
  : !existsSync(chromiumPath)
    ? `no Chromium at ${chromiumPath}: set MKP_CHROMIUM`
    : !existsSync(join(app, "node_modules/@mkp/wasm/mkp.wasm"))
      ? "no mkp.wasm: run targets/rust/wasm/build.sh"
      : false;

const quiet = { info() {}, warn() {}, error: (m, f) => process.stderr.write(`server: ${m} ${JSON.stringify(f ?? {})}\n`) };

describe("the playground in Chromium", { skip }, () => {
  let server;
  let browser;
  let tab;
  const pageErrors = [];

  before(async () => {
    // the bundle as it ships: minified, Monaco and its worker included
    const { buildBundle } = await import("../build.mjs");
    await buildBundle();
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

  /** Types at the end of the editor as a reader would, and as the video's take does: a real
   * click in the editor, Control+End, then the keys. */
  async function typeAtEnd(text) {
    const editor = tab.getByTestId("editor");
    await editor.click();
    await editor.press("Control+End");
    await tab.keyboard.type(text);
  }

  /** What the editor holds, read through the playground's read-only window.playground. */
  const source = () => tab.evaluate(() => window.playground.source());
  const caret = () => tab.evaluate(() => window.playground.caret());
  const markers = () => tab.evaluate(() => window.playground.markers());

  test("loads the first example and draws it", async () => {
    await tab.goto(server.url);
    await tab.waitForSelector('[data-testid=status][data-state=ok]');
    assert.equal(await tab.getByTestId("example-picker").inputValue(), "counter");
    await preview().getByRole("button", { name: "Add 1" }).waitFor();
    assert.match(await preview().textContent(), /Count/);
    assert.match(await markdown().textContent(), /Count: \*\*0\*\*/);
    assert.equal(await tab.locator("#preview-pane").getAttribute("data-stale"), "false");
  });

  test("the editor colours MKP: $state and a Markdown heading get their tokens and colours", async () => {
    assert.equal(await tab.evaluate(() => window.playground.language()), "mkp");
    const lines = (await source()).split("\n");
    const state = await tab.evaluate(() => window.playground.tokens(1));
    assert.deepEqual(state[0], { text: "$state", type: "state.mkp" });
    const headingLine = lines.indexOf("# A counter") + 1;
    assert.ok(headingLine > 0);
    assert.deepEqual(await tab.evaluate((n) => window.playground.tokens(n), headingLine), [{ text: "# A counter", type: "heading.mkp" }]);
    const divider = await tab.evaluate((n) => window.playground.tokens(n), lines.indexOf("@@@") + 1);
    assert.deepEqual(divider, [{ text: "@@@", type: "divider.mkp" }]);
    const call = await tab.evaluate((n) => window.playground.tokens(n), lines.indexOf("@counter;") + 1);
    assert.equal(call[0].type, "call.mkp");
    // and Monaco draws them with the playground's colours: a class of its own for each. It
    // draws only the lines in view, so the heading's line is brought into view first
    assert.equal(await tab.evaluate(() => window.playground.select("# A counter")), true);
    await tab.waitForSelector("[data-testid=editor] .view-lines >> text=# A counter");
    const drawn = await tab.evaluate(() => {
      const spans = [...document.querySelectorAll("[data-testid=editor] .view-lines span span")];
      const look = (text) => {
        // Monaco draws a space as a no-break space
        const s = spans.find((x) => x.textContent.replace(/\u00a0/g, " ") === text);
        if (!s) return null;
        const cs = getComputedStyle(s);
        return { cls: s.className, color: cs.color, weight: cs.fontWeight };
      };
      return { state: look("$state"), heading: look("# A counter"), number: look("0") };
    });
    assert.match(drawn.state.cls, /\bmtk\d+\b/);
    assert.equal(drawn.state.color, "rgb(11, 122, 135)", "$state in --tok-state");
    assert.equal(drawn.state.weight, "700");
    assert.match(drawn.heading.cls, /\bmtk\d+\b/);
    assert.notEqual(drawn.heading.cls, drawn.state.cls);
    assert.equal(drawn.heading.color, "rgb(26, 33, 48)", "a heading in the text colour, bold");
    assert.equal(drawn.heading.weight, "700");
    assert.equal(drawn.number.color, "rgb(180, 80, 26)", "a number in --tok-number");
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
    assert.equal((await source()).split("\n")[line - 1], "@nowhere;", "the diagnostic is on the line typed");
    assert.match(await first.textContent(), new RegExp(`${line}:\\d+`));
  });

  test("clicking a diagnostic moves Monaco's caret there and reveals it", async () => {
    const first = tab.getByTestId("diagnostic").first();
    const line = Number(await first.getAttribute("data-line"));
    const col = Number(await first.getAttribute("data-col"));
    // to the top first: the error's line is out of view
    const editor = tab.getByTestId("editor");
    await editor.click();
    await editor.press("Control+Home");
    await tab.waitForFunction((l) => window.playground.visibleLines().last < l, line);
    await first.click();
    assert.deepEqual(await caret(), { line, col });
    await tab.waitForFunction((l) => { const v = window.playground.visibleLines(); return v.first <= l && l <= v.last; }, line);
    assert.equal(await tab.evaluate(() => window.playground.hasFocus()), true, "the editor has the focus, to fix it there");

    // fix it there: the page is fresh again
    await tab.keyboard.press("Home");
    await tab.keyboard.press("Shift+End");
    await tab.keyboard.press("Backspace");
    await tab.waitForSelector("[data-testid=status][data-state=ok]");
    assert.equal(await tab.locator("#preview-pane").getAttribute("data-stale"), "false");
    assert.equal(await tab.getByTestId("diagnostic").count(), 0);
  });

  test("markers: a mistake is underlined where it is, and taking it out clears it", async () => {
    // as the video types it: auto-closed pairs are stepped over, so the text is exactly this
    const mistake = '@counter(by = "five");';
    await typeAtEnd(mistake);
    assert.ok((await source()).endsWith("\n" + mistake), JSON.stringify((await source()).slice(-40)));
    await tab.waitForSelector("[data-testid=status][data-state=errors]");
    const line = (await source()).split("\n").length;
    await tab.waitForFunction(() => window.playground.markers().length > 0);
    const found = await markers();
    assert.ok(found.length >= 1);
    for (const m of found) {
      assert.equal(m.line, line, `on the line typed: ${JSON.stringify(m)}`);
      assert.equal(m.severity, "error");
      assert.ok(m.code && m.message, "with the compiler's code and message");
      assert.ok(m.endLine > m.line || m.endCol >= m.col);
    }
    await tab.waitForSelector("[data-testid=editor] .squiggly-error");
    assert.equal(await tab.locator("[data-testid=editor] .line-numbers.has-error").count(), 1, "the line's number is marked too");

    const editor = tab.getByTestId("editor");
    await editor.click();
    await editor.press("Control+End");
    for (let k = 0; k < mistake.length; k++) await tab.keyboard.press("Backspace");
    await tab.waitForSelector("[data-testid=status][data-state=ok]");
    assert.deepEqual(await markers(), []);
    assert.equal(await tab.locator("[data-testid=editor] .squiggly-error").count(), 0);
    assert.equal(await tab.locator("[data-testid=editor] .line-numbers.has-error").count(), 0);
  });

  test("a widget that fails while drawn is marked on the call that placed it, until it draws", async () => {
    // a second counter whose step divides by the count, which starts at 0
    const call = "@counter(by = (100 / $state.count).round());";
    await typeAtEnd("\n" + call);
    await compiled("ok");
    // the count the tests before left is kept: back to its starting 0
    await tab.getByTestId("tab-state").click();
    await tab.getByTestId("state-reset").click();
    const line = (await source()).split("\n").length;
    await tab.waitForFunction(() => window.playground.failures().length > 0);
    const [m] = await tab.evaluate(() => window.playground.failures());
    assert.equal(m.line, line, `on the line it is written on: ${JSON.stringify(m)}`);
    assert.equal(m.col, 1);
    assert.equal(m.severity, "error");
    assert.match(m.message, /^counter failed: .*division by zero.*, when the page was drawn$/);
    assert.deepEqual(await markers(), [], "the compiler's markers are its own: this compiled");
    // a count of 1 draws it, and the mark goes
    await tab.locator("[data-part=press]").first().click();
    await tab.waitForFunction(() => window.playground.failures().length === 0);
    const editor = tab.getByTestId("editor");
    await editor.click();
    await editor.press("Control+End");
    for (let k = 0; k <= call.length; k++) await tab.keyboard.press("Backspace");
    await compiled("ok");
    await tab.getByTestId("tab-markdown").click();
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
    assert.equal(await tab.evaluate(() => window.playground.select("level: int 0..10 = 4;")), true);
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
    const editor = await tab.getByTestId("editor").boundingBox();
    const page = await tab.locator("#preview-pane").boundingBox();
    assert.ok(page.y >= editor.y + editor.height - 1, "the page is under the editor");
    assert.ok(page.width > 380, "and as wide as the screen");
    // Monaco lays itself out again to the editor's new size
    await tab.waitForFunction(() => {
      const host = document.querySelector("[data-testid=editor]");
      const inner = host?.querySelector(".monaco-editor");
      return inner && Math.abs(inner.getBoundingClientRect().width - host.getBoundingClientRect().width) < 2;
    });
    assert.ok(editor.width > 380 && editor.width < 420 && editor.height >= 300, JSON.stringify(editor));
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
    assert.doesNotMatch(await source(), /An edit to throw away/);
    assert.deepEqual(await caret(), { line: (await source()).split("\n").length, col: 1 }, "the caret starts at the end");
    await tab.waitForFunction(() => document.getElementById("markdown-output")?.textContent?.includes("Count: **0**"));
    assert.match(await tab.getByTestId("notice").textContent(), /Started again with A counter/);
    assert.equal(await tab.getByTestId("notice").isVisible(), true);
  });

  test("Tab inserts four spaces, and Ctrl+S compiles now", async () => {
    await typeAtEnd("\n");
    await tab.keyboard.press("Tab");
    assert.ok((await source()).endsWith("\n    "), JSON.stringify((await source()).slice(-10)));
    await tab.keyboard.press("Tab");
    assert.ok((await source()).endsWith("\n        "));
    await tab.keyboard.press("Shift+Home");
    await tab.keyboard.press("Backspace");
    await tab.keyboard.press("Backspace");
    await compiled("ok");
    // no edit now, so only Ctrl+S can start a compile
    const before = await tab.evaluate(() => window.playground.compiles());
    await tab.keyboard.press("Control+s");
    await tab.waitForTimeout(800);
    assert.equal(await tab.evaluate(() => window.playground.compiles()) - before, 1, "one compile, straight away");
    await compiled("ok");
  });

  test("a source with no @@@ is prose; one with only code is code", async () => {
    const editor = tab.getByTestId("editor");
    await editor.click();
    await editor.press("Control+a");
    await tab.keyboard.type("# Just prose\n\nSome *words* and `code`.\n");
    assert.equal(await tab.evaluate(() => window.playground.language()), "mkp-prose");
    assert.deepEqual(await tab.evaluate(() => window.playground.tokens(1)), [{ text: "# Just prose", type: "heading.mkp" }]);
    const types = (await tab.evaluate(() => window.playground.tokens(3))).map((t) => t.type);
    assert.ok(types.includes("emphasis.mkp") && types.includes("code.mkp"), types.join(" "));
    await compiled("ok");
    await tab.waitForFunction(() => document.getElementById("markdown-output")?.textContent?.includes("# Just prose"));

    await editor.press("Control+a");
    await tab.keyboard.type("$state {\n");
    assert.equal(await tab.evaluate(() => window.playground.language()), "mkp");
    assert.equal((await tab.evaluate(() => window.playground.tokens(1)))[0].type, "state.mkp");
    // back to an example, for the tests after this one
    await tab.getByTestId("example-picker").selectOption("counter");
    await compiled("ok");
  });

  test("a prose comment, @// to the end of the line, is coloured as a comment and draws nothing", async () => {
    await tab.getByTestId("brand").click();
    await compiled("ok");
    await typeAtEnd("\n@// a note nobody sees\n");
    await compiled("ok");
    const lines = (await tab.evaluate(() => window.playground.source())).split("\n");
    const at = lines.findIndex((l) => l.startsWith("@// a note")) + 1;
    assert.ok(at > 0);
    assert.deepEqual(await tab.evaluate((n) => window.playground.tokens(n), at), [{ text: "@// a note nobody sees", type: "comment.mkp" }]);
    assert.doesNotMatch(await markdown().textContent(), /a note nobody sees/);
    assert.doesNotMatch(await preview().textContent(), /a note nobody sees/);
  });

  test("compiles in the browser: no request to the server for a build", async () => {
    const asked = [];
    const seen = (r) => r.url().startsWith(server.url) && r.method() === "POST" && asked.push(r.url());
    tab.on("request", seen);
    await typeAtEnd("\nCompiled here.\n");
    await compiled("ok");
    tab.off("request", seen);
    assert.deepEqual(asked, []);
    assert.match(await preview().textContent(), /Compiled here\./);
  });

  test("a compiler that can't be loaded says so, and the server is told", async () => {
    const other = await browser.newPage({ viewport: { width: 1200, height: 800 } });
    try {
      await other.route("**/mkp.wasm", (r) => r.fulfill({ status: 404, body: "gone" }));
      const reported = other.waitForRequest((r) => r.url().endsWith("/api/report") && r.method() === "POST");
      await other.goto(server.url);
      const req = await reported;
      assert.equal(JSON.parse(req.postData()).kind, "compiler-load");
      await other.waitForSelector("[data-testid=status][data-state=error]");
      assert.match(await other.getByTestId("status").textContent(), /Compiler error/);
      assert.match(await other.getByTestId("preview").textContent(), /The compiler could not be loaded/);
    } finally {
      await other.close();
    }
  });

  test("the Targets page: one page from an IR built ahead, and the same compiled as it is typed, on the plain web and in React", async () => {
    const t = await browser.newPage({ viewport: { width: 1280, height: 900 } });
    const errors = [];
    t.on("pageerror", (e) => errors.push(String(e)));
    try {
      await t.goto(`${server.url}/targets`);
      const run = t.getByTestId("run-page");
      const live = t.getByTestId("live-page");
      // run time: the page from its IR, a press, and a snapshot that brings it back
      await run.getByRole("button", { name: "Add 1" }).click();
      await run.getByRole("button", { name: "Add 1" }).click();
      await t.waitForFunction(() => document.getElementById("run-state").textContent === "count = 2");
      await t.getByTestId("snapshot").click();
      await run.getByRole("button", { name: "Add 1" }).click();
      await t.waitForFunction(() => document.getElementById("run-state").textContent === "count = 3");
      await t.getByTestId("restore").click();
      await t.waitForFunction(() => document.getElementById("run-state").textContent === "count = 2");
      // real time: compiled in the tab, and an edit drawn
      await t.waitForFunction(() => document.getElementById("live-status").dataset.state === "ok");
      await live.getByRole("button", { name: "Add 1" }).click();
      const box = t.getByTestId("live-source");
      await box.fill((await box.inputValue()).replace("@counter;", "@counter(by = 5);"));
      await live.getByRole("button", { name: "Add 5" }).waitFor();
      // `$state` kept through the edit
      await t.waitForFunction(() => document.getElementById("live-state").textContent === "count = 1");
      // a broken draft: the last page stays, and why is said
      await box.fill((await box.inputValue()).replace("@counter(by = 5);", "@counter(by = );"));
      await t.waitForFunction(() => document.getElementById("live-status").dataset.state === "errors");
      assert.match(await t.getByTestId("live-status").textContent(), /^Doesn't compile \(\d+ errors?\): page\.mkp\.md:\d+:\d+: /);
      assert.ok(await live.getByRole("button", { name: "Add 5" }).isVisible(), "the last page that compiled stays");

      // React: <MkpDoc>, its $state in React's own state, and a snapshot that brings it back
      const rrun = t.getByTestId("react-run-page");
      await rrun.getByRole("button", { name: "Add 1" }).click();
      await t.waitForFunction(() => document.getElementById("react-run-state").textContent === "count = 1");
      await t.getByTestId("react-snapshot").click();
      await rrun.getByRole("button", { name: "Add 1" }).click();
      await t.waitForFunction(() => document.getElementById("react-run-state").textContent === "count = 2");
      await t.getByTestId("react-restore").click();
      await t.waitForFunction(() => document.getElementById("react-run-state").textContent === "count = 1");
      // React: <MkpLiveDoc>, compiled in the tab, an edit drawn, a broken draft kept back
      const rlive = t.getByTestId("react-live-page");
      await t.waitForFunction(() => document.querySelector("[data-testid=react-live-status]").dataset.state === "ok");
      const rbox = t.getByTestId("react-live-source");
      await rbox.fill((await rbox.inputValue()).replace("@counter;", "@counter(by = 5);"));
      await rlive.getByRole("button", { name: "Add 5" }).waitFor();
      await rbox.fill((await rbox.inputValue()).replace("@counter(by = 5);", "@counter(by = );"));
      await t.waitForFunction(() => document.querySelector("[data-testid=react-live-status]").dataset.state === "errors");
      assert.match(await t.getByTestId("react-live-status").textContent(), /^Doesn't compile \(\d+ errors?\): page\.mkp\.md:\d+:\d+: /);
      assert.ok(await rlive.getByRole("button", { name: "Add 5" }).isVisible(), "React keeps the last page that compiled");
      assert.deepEqual(errors, []);
    } finally {
      await t.close();
    }
  });

  test("no errors in the browser's console", () => {
    assert.deepEqual(
      pageErrors.map((e) => e.message),
      [],
    );
  });
});
