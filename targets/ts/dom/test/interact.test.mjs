// A person using the page: clicks, typing, dragging and keys reach the runtime as events and
// checked writes; rows keep their elements, focus and caret; the theme switches; a failed widget
// is a notice; and what the page shows says what its Markdown says.

import { after, before, test } from "node:test";
import assert from "node:assert/strict";
import { launch, xtmd, num, open, text } from "./browser.mjs";

let browser;
before(async () => {
  browser = await launch();
});
after(async () => {
  await browser?.close();
});

test("press: a real click runs its handler, a disabled one does nothing, and act() clicks it", async () => {
  const page = await open(
    browser,
    '$state {\n    presses: int = 0;\n}\n\nwidget sample() {\n    view {\n        @press(label = "Pressed \\{$state.presses} times", click = fn() { $state.presses = $state.presses + 1; });\n        @press(label = "Bold", kind = press_kind.TOGGLE, selected = true);\n        @press(label = "Off", disabled = true, click = fn() { $state.presses = 100; });\n    }\n}\n@@@\n@sample;\n',
  );
  await page.getByRole("button", { name: "Pressed 0 times" }).click();
  assert.deepEqual((await xtmd(page, "state")).presses, num(1));
  assert.equal(await page.getByRole("button", { name: "Pressed 1 times" }).count(), 1);
  // the same element, redrawn in place
  assert.equal(await page.locator("[data-xtmd-site='s0/s0']").evaluate((el) => el === document.activeElement), true);
  await xtmd(page, "act", "s0/s2", { event: "click" });
  assert.deepEqual((await xtmd(page, "state")).presses, num(1));
  await xtmd(page, "act", "s0/s0", { event: "click" });
  assert.deepEqual((await xtmd(page, "state")).presses, num(2));
  await page.keyboard.press("Enter");
  assert.deepEqual((await xtmd(page, "state")).presses, num(3));
  await page.close();
});

test("field: typing writes the value as text, Enter submits, and act() types into the input", async () => {
  const page = await open(
    browser,
    '$state {\n    name: text = "Ada";\n    sent: int = 0;\n}\n\nwidget sample() {\n    view {\n        @field(value = $state.name, label = "Name", submit = fn() { $state.sent = $state.sent + 1; });\n        @label(value = "Hello, \\{$state.name}");\n    }\n}\n@@@\n@sample;\n',
  );
  const input = page.getByLabel("Name");
  await input.fill("");
  await input.pressSequentially("Grace");
  assert.deepEqual((await xtmd(page, "state")).name, text("Grace"));
  assert.equal(await page.locator(".xtmd-label").textContent(), "Hello, Grace");
  assert.equal(await input.evaluate((el) => [el === document.activeElement, el.selectionStart].join()), "true,5");
  await page.keyboard.press("Enter");
  assert.deepEqual((await xtmd(page, "state")).sent, num(1));
  await xtmd(page, "act", "s0/s0", { write: "value", value: text("Lin") });
  assert.equal(await input.inputValue(), "Lin");
  assert.deepEqual((await xtmd(page, "state")).name, text("Lin"));
  await xtmd(page, "act", "s0/s0", { event: "submit" });
  assert.deepEqual((await xtmd(page, "state")).sent, num(2));
  // a write from elsewhere shows in the input
  await xtmd(page, "set", { name: text("Mae") });
  assert.equal(await input.inputValue(), "Mae");
  await page.close();
});

test("slider: its ends and step come from range or the variable's contract, and its writes are exact numbers", async () => {
  const page = await open(
    browser,
    '$state {\n    n: int 0..10 = 3;\n    level: number = 3;\n}\n\nwidget sample() {\n    view {\n        @slider(value = $state.n, label = "N");\n        @slider(value = $state.level, label = "Level", range = 0..10);\n    }\n}\n@@@\n@sample;\n',
  );
  const n = page.getByRole("slider", { name: "N" });
  assert.deepEqual(await n.evaluate((el) => [el.min, el.max, el.step]), ["0", "10", "1"]);
  await n.focus();
  await page.keyboard.press("ArrowRight");
  assert.deepEqual((await xtmd(page, "state")).n, num(4));
  await xtmd(page, "act", "s0/s0", { write: "value", value: num(7) });
  assert.deepEqual((await xtmd(page, "state")).n, num(7));
  assert.equal(await n.inputValue(), "7");
  // outside its ends, or off its grid: no drag gets there, so the page checks it and refuses it
  await xtmd(page, "outcome");
  await xtmd(page, "act", "s0/s0", { write: "value", value: num(12) });
  await xtmd(page, "act", "s0/s0", { write: "value", value: num("2.5") });
  assert.deepEqual((await xtmd(page, "state")).n, num(7));
  assert.deepEqual((await xtmd(page, "outcome")).refused, [{ code: "contracts.outside", site: "s0/s0" }, { code: "contracts.outside", site: "s0/s0" }]);
  // a variable with no contract and a range: a hundredth of the way per step, exactly
  const level = page.getByRole("slider", { name: "Level" });
  await level.focus();
  await page.keyboard.press("ArrowRight");
  assert.deepEqual((await xtmd(page, "state")).level, num("3.1"));
  await xtmd(page, "act", "s0/s1", { write: "value", value: num(7) });
  assert.match(await xtmd(page, "markdown"), /Level: 7/);
  await page.close();
});

test("overlay: the anchor opens it and writes open, Escape closes it, its body is always on the page", async () => {
  const page = await open(
    browser,
    '$state {\n    open: bool = false;\n    asked: bool = false;\n    changes: int = 0;\n}\n\nwidget sample() {\n    view {\n        @overlay(label = "More", open = $state.open, open_changed = fn() { $state.changes = $state.changes + 1; }) {\n            anchor {\n                @label(value = "More");\n            }\n            body {\n                @label(value = "The rest");\n            }\n        }\n        @overlay(label = "Sure?", mode = overlay_mode.DIALOG, open = $state.asked) {\n            anchor {\n                @press(label = "Delete");\n            }\n            body {\n                @label(value = "Really delete it?");\n            }\n        }\n    }\n}\n@@@\n@sample;\n',
  );
  const anchor = page.getByRole("button", { name: "More" });
  const body = page.locator("[data-xtmd-site='s0/s0'] [data-part='overlay.body']");
  assert.equal(await body.isVisible(), false);
  await anchor.click();
  assert.equal((await xtmd(page, "state")).open.bool, true);
  assert.deepEqual((await xtmd(page, "state")).changes, num(1));
  assert.equal(await body.isVisible(), true);
  assert.equal(await anchor.getAttribute("aria-expanded"), "true");
  assert.equal(await page.getByRole("dialog", { name: "More" }).textContent(), "The rest");
  await page.keyboard.press("Escape");
  await page.waitForFunction(() => window.xtmd.state().open.bool === false);
  assert.equal(await body.isVisible(), false);
  // the anchor closes it too, as a second press
  await anchor.click();
  await anchor.click();
  assert.equal((await xtmd(page, "state")).open.bool, false);
  // act() opens it through its anchor
  await xtmd(page, "act", "s0/s0", { write: "open", value: { bool: true } });
  assert.equal(await body.isVisible(), true);
  await xtmd(page, "act", "s0/s0", { write: "open", value: { bool: false } });
  assert.equal(await body.isVisible(), false);
  // a dialog is modal, and Escape closes it
  await page.getByRole("button", { name: "Delete" }).click();
  assert.equal((await xtmd(page, "state")).asked.bool, true);
  assert.equal(await page.locator("dialog[open]").textContent(), "Really delete it?");
  await page.keyboard.press("Escape");
  await page.waitForFunction(() => window.xtmd.state().asked.bool === false);
  assert.equal(await page.locator("dialog[open]").count(), 0);
  // a body is in the DOM even while closed, with its site
  assert.equal(await page.locator("[data-xtmd-site='s0/s2']").count(), 1);
  await page.close();
});

test("overlay: one that is open when the page mounts shows at once, and a tooltip follows the pointer", async () => {
  const page = await open(
    browser,
    '$state {\n    open: bool = false;\n    tip: bool = false;\n}\n\nwidget sample() {\n    view {\n        @overlay(label = "More", open = $state.open) {\n            anchor {\n                @label(value = "More");\n            }\n            body {\n                @label(value = "The rest");\n            }\n        }\n        @overlay(label = "Hint", mode = overlay_mode.TOOLTIP, open = $state.tip) {\n            anchor {\n                @icon(name = glyph.HELP, label = "Help");\n            }\n            body {\n                @label(value = "A hint");\n            }\n        }\n    }\n}\n@@@\n@sample;\n',
    { state: { open: { bool: true } } },
  );
  await page.waitForFunction(() => document.querySelector("[data-xtmd-site='s0/s0'] [data-part='overlay.body']").matches(":popover-open"));
  assert.equal(await page.getByRole("button", { name: "More" }).getAttribute("aria-expanded"), "true");
  await page.keyboard.press("Escape");
  await page.waitForFunction(() => window.xtmd.state().open.bool === false);
  const tip = page.getByRole("tooltip");
  assert.equal(await tip.isVisible(), false);
  await page.getByRole("img", { name: "Help" }).hover();
  assert.equal((await xtmd(page, "state")).tip.bool, true);
  assert.equal(await tip.isVisible(), true);
  assert.equal(await page.locator("[data-xtmd-site='s0/s3'] [data-part='overlay.anchor']").getAttribute("aria-describedby"), await tip.getAttribute("id"));
  await page.mouse.move(700, 800);
  assert.equal((await xtmd(page, "state")).tip.bool, false);
  await page.close();
});

const ROWS = `record task {
    title: text;
}

$state {
    tasks: list<task> = [task { title = "write" }, task { title = "test" }, task { title = "ship" }];
}

widget board() {
    view {
        @column(gap = space.S) {
            mut for (t in $state.tasks) {
                if (mut x: task = t) {
                    @row(gap = space.S) {
                        @field(value = x.title, label = "Task");
                        @press(label = "Drop \\{x.title}", click = fn() { $state.tasks.remove(x); });
                    }
                }
            }
        }
    }
    markdown {
        @for (t in $state.tasks) {
        - \\{t.title}
        }
    }
}
@@@
@board;
`;

test("rows keep their elements by key: typing in a row keeps focus and caret when another row is removed", async () => {
  const page = await open(browser, ROWS);
  const fields = page.getByLabel("Task");
  assert.equal(await fields.count(), 3);
  const second = fields.nth(1);
  await second.click();
  await page.keyboard.press("End");
  await page.keyboard.type(" it");
  await page.keyboard.press("Home");
  await page.keyboard.press("ArrowRight");
  await page.keyboard.press("ArrowRight");
  await second.evaluate((el) => (el.dataset.mine = "yes"));
  assert.equal((await xtmd(page, "state")).tasks.list[1].record.fields.title.text, "test it");
  // the first row goes, while the reader is typing in the second
  const drop = (await xtmd(page, "paths")).find((p) => p.widget === "core/press");
  await xtmd(page, "act", drop.path, { event: "click" });
  assert.equal(await fields.count(), 2);
  const focused = await page.evaluate(() => {
    const a = document.activeElement;
    return { mine: a.dataset.mine, value: a.value, caret: a.selectionStart, site: a.closest("[data-xtmd-site]").getAttribute("data-xtmd-site") };
  });
  assert.deepEqual({ ...focused, site: /\[0\]/.test(focused.site) }, { mine: "yes", value: "test it", caret: 2, site: true });
  await page.keyboard.type("X");
  assert.equal((await xtmd(page, "state")).tasks.list[0].record.fields.title.text, "teXst it");
  assert.equal(await xtmd(page, "markdown"), "- teXst it\n- ship\n");
  // a row added at the start moves nothing the reader is in
  await xtmd(page, "set", { tasks: { list: [{ record: { type: "doc/task", fields: { title: { text: "plan" } } } }, ...(await xtmd(page, "state")).tasks.list] } });
  assert.equal(await page.evaluate(() => document.activeElement.dataset.mine), "yes");
  assert.equal(await page.evaluate(() => document.activeElement.selectionStart), 3);
  await page.close();
});

test("the theme: core's tokens are custom properties on the root, and colours follow page.theme", async () => {
  const page = await open(browser, '\nwidget sample() {\n    view {\n        @label(value = "Toned", tone = color.OK);\n    }\n}\n@@@\n# Themes\n\n@sample;\n', { page: { theme: "LIGHT" } });
  const root = page.locator("#app");
  const look = () => root.evaluate((el) => ({ bg: getComputedStyle(el).backgroundColor, ink: getComputedStyle(el).color, theme: el.dataset.xtmdTheme, ok: getComputedStyle(el.querySelector(".xtmd-label")).color, space: el.style.getPropertyValue("--xtmd-space-m") }));
  assert.deepEqual(await look(), { bg: "rgb(255, 255, 255)", ink: "rgb(26, 28, 31)", theme: "light", ok: "rgb(21, 128, 61)", space: "8px" });
  await xtmd(page, "setPage", { theme: "DARK" });
  assert.deepEqual(await look(), { bg: "rgb(21, 23, 26)", ink: "rgb(236, 238, 241)", theme: "dark", ok: "rgb(74, 222, 128)", space: "8px" });
  assert.equal(await root.evaluate((el) => getComputedStyle(el).colorScheme), "dark");
  await page.close();
});

test("a widget that fails is a notice with its message, and is drawn again once it can be", async () => {
  const page = await open(browser, '$state {\n    parts: int 0... = 0;\n}\n\nwidget share() {\n    view {\n        @label(value = "Each: \\{100 / $state.parts}");\n    }\n}\n@@@\n@share;\n\nAfter.\n');
  const alert = page.getByRole("alert");
  assert.equal(await alert.count(), 1);
  assert.match(await alert.textContent(), /share failed/);
  assert.equal(await alert.getAttribute("data-xtmd-widget"), "#notice");
  assert.equal(await page.locator("p", { hasText: "After." }).count(), 1);
  await xtmd(page, "set", { parts: num(4) });
  assert.equal(await page.getByRole("alert").count(), 0);
  assert.equal(await page.locator(".xtmd-label").textContent(), "Each: 25");
  await page.close();
});

const DOC = `$state {
    count: int = 3;
}

widget counter() {
    view {
        @row(gap = space.S) {
            @label(value = "Count");
            @label(value = "is \\{$state.count}");
        }
    }
}
@@@
# Release notes

The **web** target draws *every* block, and ~~nothing~~ more. Read [the plan](https://example.com) and the \`code\`.

## What shipped

- [x] Widgets
- [ ] Bindings
- Docs

1. First
2. Second

> A quote, with a [link](https://example.com).

\`\`\`ts
const page = run(ir, root);
\`\`\`

| Part | State |
|---|:-:|
| dom | done |
| react | next |

The formula $e = mc^2$ holds.

@counter;

---

Thanks[^1].

[^1]: To everyone.
`;

test("what the page shows says what page.markdown() says, word for word", async () => {
  const page = await open(browser, DOC);
  const shown = await page.evaluate(() => {
    const words = [];
    const walk = (n) => {
      if (n.nodeType === Node.TEXT_NODE) {
        words.push(n.textContent);
        return;
      }
      if (n.nodeType !== Node.ELEMENT_NODE) return;
      // maths says its TeX
      if (n.getAttribute("role") === "math") return words.push(` ${n.getAttribute("aria-label")} `);
      const block = getComputedStyle(n).display !== "inline";
      if (block) words.push(" ");
      for (const c of n.childNodes) walk(c);
      if (block) words.push(" ");
    };
    walk(document.getElementById("app"));
    return words.join("").split(/\s+/).filter(Boolean);
  });
  const md = await xtmd(page, "markdown");
  const said = md
    .split("\n")
    .filter((l) => !/^```/.test(l) && !/^\|( *:?-+:? *\|)+$/.test(l) && l !== "---")
    .join("\n")
    .replace(/^\[\^(\w+)\]:/gm, "$1 ")
    .replace(/\[\^(\w+)\]/g, "$1")
    .replace(/\[([^\]]*)\]\(<[^>]*>\)/g, "$1")
    .replace(/^(#+|>|-|\d+\.)\s(\[[ x]\]\s)?/gm, "")
    .replace(/\*\*|\*|~~|`|\$/g, "")
    .replace(/\|/g, " ")
    .replace(/\\(.)/g, "$1")
    .split(/\s+/)
    .filter(Boolean);
  assert.deepEqual(shown, said);
  assert.ok(said.includes("is") && said.includes("mc^2") && said.includes("everyone."));
  await page.close();
});

test("unmount takes the page away and leaves the element as it was", async () => {
  const page = await open(browser, "# Gone soon\n");
  await xtmd(page, "unmount");
  const left = await page.locator("#app").evaluate((el) => ({ html: el.innerHTML, cls: el.className, style: el.getAttribute("style") ?? "" }));
  assert.deepEqual(left, { html: "", cls: "", style: "" });
  await page.close();
});

test("run() supplies moment.local from the browser's own time zone, summer time included", async () => {
  const source = 'let summer: moment = "2026-07-01T12:00+00:00";\nlet winter: moment = "2026-01-01T12:00+00:00";\n\nwidget clock() {\n    view {\n        @label(value = "\\{summer.local().time()} \\{winter.local().time()} \\{summer.local()}");\n    }\n}\n@@@\n@clock;\n';
  const page = await open(browser, source, { context: { timezoneId: "Europe/Berlin" } });
  assert.equal(await page.locator(".xtmd-label").textContent(), "14:00 13:00 2026-07-01T14:00+02:00");
  await page.close();
  const west = await open(browser, source, { context: { timezoneId: "America/New_York" } });
  assert.equal(await west.locator(".xtmd-label").textContent(), "08:00 07:00 2026-07-01T08:00-04:00");
  await west.close();
});
