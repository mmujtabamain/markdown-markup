// Every core widget drawn in a real Chromium, with the element, role, name and state a person and
// a screen reader get, and every node of the runtime's tree on the page with its site.

import { after, before, test } from "node:test";
import assert from "node:assert/strict";
import { ir, launch, xtmd, open, pack } from "./browser.mjs";

let browser;
before(async () => {
  browser = await launch();
});
after(async () => {
  await browser?.close();
});

const CORE = [
  "paragraph", "heading", "bullets", "item", "quote", "code", "math", "table", "footnote", "divider",
  "label", "image", "icon", "press", "field", "slider", "overlay",
  "canvas", "layer", "circle", "path", "place", "handle", "shade",
  "flex", "grid", "cell", "sizing", "plane", "spot",
];

export const ALL = `$state {
    n: number 0..10 = 3;
    name: text = "Ada";
    notes: text = "";
    open: bool = false;
    p: point = point { x = 0.5, y = 0.5 };
    hits: int = 0;
}

fn glow(at: point, px: number, args: number): pixel {
    return pixel { r = at.x.clamp(0, 1), g = 0, b = at.y.clamp(0, 1), a = 1 };
}

widget controls() {
    view {
        @column(gap = space.M) {
            @label(value = "A label", tone = color.MUTED, weight = weight.BOLD);
            @image(src = "data:image/gif;base64,R0lGODlhAQABAAAAACw=", alt = "A picture");
            @icon(name = glyph.STAR, label = "Star");
            @icon(name = glyph.CHECK);
            @row(gap = space.S) {
                @press(label = "Go", kind = press_kind.TOGGLE, selected = true);
                @press(label = "Off", disabled = true);
                @press(label = "Wifi", kind = press_kind.SWITCH, selected = true);
                @press(label = "Agree", kind = press_kind.CHECK);
                @press(label = "Plain", kind = press_kind.PLAIN);
                @press(label = "Reset") {
                    @icon(name = glyph.RESET);
                }
            }
            @row {
                @press(label = "One", kind = press_kind.TAB, selected = true);
                @press(label = "Two", kind = press_kind.TAB);
            }
            @row {
                @press(label = "Small", kind = press_kind.RADIO, selected = true);
                @press(label = "Large", kind = press_kind.RADIO);
            }
            @column {
                @press(label = "Apple", kind = press_kind.OPTION, selected = true);
                @press(label = "Pear", kind = press_kind.OPTION);
            }
            @field(value = $state.name, label = "Name", placeholder = "Your name");
            @field(value = $state.notes, label = "Notes", lines = 3);
            @slider(value = $state.n, label = "N", range = 0..10);
            @overlay(label = "More", open = $state.open) {
                anchor {
                    @press(label = "Open");
                }
                body {
                    @label(value = "Inside");
                }
            }
            @grid(cols = cols.EQUAL(2), gap = space.S) {
                @cell(span = 2) {
                    @label(value = "Wide");
                }
                @label(value = "Left");
                @label(value = "Right");
            }
            @grow {
                @label(value = "Grows");
            }
            @canvas(label = "A dot on a gradient", aspect = 1) {
                @layer {
                    @shade(area = region { from = point { x = -1, y = -1 }, to = point { x = 1, y = 1 } }, shader = glow, args = 1, label = "A gradient");
                    @circle(at = point { x = 0, y = 0 }, r = 0.3, fill = color.ACCENT, label = "Dot", click = fn() { $state.hits = $state.hits + 1; });
                    @path(points = [point { x = -1, y = -1 }, point { x = 1, y = 1 }], head = head.ARROW, label = "Line");
                    @place(at = point { x = 0, y = 0.8 }, anchor = anchor.S) {
                        @label(value = "Top");
                    }
                    @handle(at = $state.p, label = "Drag me");
                }
            }
            @plane(label = "Map", bounds = region { from = point { x = -200, y = -100 }, to = point { x = 200, y = 100 } }) {
                items {
                    @spot(at = point { x = 0, y = 0 }) {
                        @label(value = "Home");
                    }
                }
            }
        }
    }
    markdown {
        Controls
    }
}
@@@
# Title with **bold** and $x^2$

Some *italic*, ~~strike~~, \`code\`, a [link](https://example.com), a [bad one](javascript:alert(1)) and ![a dot](data:image/gif;base64,R0lGODlhAQABAAAAACw=).

- [x] done
- [ ] not done
- plain

3. three
4. four

> quoted

Press \\{@icon(name = glyph.STAR, label = "a star")} to keep it.

\`\`\`js
let x = 1;
\`\`\`

$$
\\frac{a}{b} + \\sqrt{x^2 + y^2}
$$

| A | B |
|:-:|--:|
| 1 | 2 |

A note[^1].

---

@controls;

[^1]: The note.
`;

/** Each widget's element, role and name, read in the page. */
function describe(page, selector) {
  return page.evaluate((sel) => {
    const el = document.querySelector(sel);
    return el && { tag: el.tagName.toLowerCase(), role: el.getAttribute("role"), label: el.getAttribute("aria-label"), text: el.textContent, part: el.getAttribute("data-part") };
  }, selector);
}

test("every core widget is drawn, and every node of the tree has its element with its site", async () => {
  const page = await open(browser, ALL);
  const paths = await xtmd(page, "paths");
  const drawn = new Set(paths.map((p) => p.widget));
  for (const w of CORE) assert.ok(drawn.has(`core/${w}`), `the sample draws core/${w}`);
  for (const { path, widget } of paths) {
    const el = await page.evaluate(([p]) => {
      const el = document.querySelector(`[data-xtmd-site="${CSS.escape(p)}"]`);
      return el && { widget: el.getAttribute("data-xtmd-widget"), part: el.getAttribute("data-part") };
    }, [path]);
    assert.ok(el, `${path} (${widget}) is on the page`);
    assert.equal(el.widget, widget);
    assert.ok(el.part, `${path} has its data-part`);
  }
  // our registry has every core extern, and the runtime's notice
  assert.deepEqual((await xtmd(page, "widgets")).sort(), [...CORE.map((w) => `core/${w}`), "#notice"].sort());
  assert.deepEqual(page.errors, []);
  await page.close();
});

test("Markdown's blocks are their own elements: headings, lists with task boxes, quote, code, maths, table, footnote, rule", async () => {
  const page = await open(browser, ALL);
  const h1 = page.getByRole("heading", { level: 1 });
  assert.equal(await h1.count(), 1);
  assert.equal((await h1.textContent()).replace(/\s+/g, " ").includes("Title with bold and"), true);
  assert.equal(await page.locator("h1 strong").textContent(), "bold");
  const p = page.locator("p.xtmd-paragraph").first();
  assert.equal(await p.locator("em").textContent(), "italic");
  assert.equal(await p.locator("s").textContent(), "strike");
  assert.equal(await p.locator("code").textContent(), "code");
  assert.equal(await page.getByRole("link", { name: "link" }).getAttribute("href"), "https://example.com");
  // a javascript: link is shown as words, never followed
  assert.equal(await page.getByRole("link", { name: "bad one" }).count(), 0);
  assert.equal(await page.locator("[data-unsafe-link]").textContent(), "bad one");
  assert.equal(await page.getByRole("img", { name: "a dot" }).count(), 1);
  // task boxes show the item's state
  const boxes = page.locator("li.xtmd-task input[type=checkbox]");
  assert.equal(await boxes.count(), 2);
  assert.equal(await boxes.nth(0).isChecked(), true);
  assert.equal(await boxes.nth(1).isChecked(), false);
  assert.equal(await page.locator("ol").getAttribute("start"), "3");
  assert.equal(await page.locator("ol > li").count(), 2);
  assert.equal(await page.locator("blockquote").textContent(), "quoted");
  // a view in a sentence is drawn where it stands
  assert.equal(await page.locator("p .xtmd-inline").getByRole("img", { name: "a star" }).count(), 1);
  assert.equal(await page.locator("pre > code.language-js").textContent(), "let x = 1;\n");
  // maths: TeX is its accessible text, MathML is what is seen
  const math = await describe(page, "div.xtmd-math");
  assert.equal(math.role, "math");
  assert.equal(math.label, "\\frac{a}{b} + \\sqrt{x^2 + y^2}");
  assert.equal(await page.locator("div.xtmd-math math mfrac").count(), 1);
  assert.equal(await page.locator("div.xtmd-math math msqrt").count(), 1);
  assert.equal(await page.locator("h1 [role=math]").getAttribute("aria-label"), "x^2");
  const a = page.getByRole("columnheader", { name: "A" });
  assert.equal(await a.evaluate((el) => getComputedStyle(el).textAlign), "center");
  assert.equal(await page.getByRole("cell", { name: "2" }).evaluate((el) => getComputedStyle(el).textAlign), "end");
  // the footnote is a note, and its mark in the text leads to it
  const note = page.getByRole("note");
  assert.equal(await note.count(), 1);
  const href = await page.locator("sup.xtmd-note-ref a").getAttribute("href");
  assert.equal(await note.getAttribute("id"), href.slice(1));
  assert.equal(await page.getByRole("separator").count(), 1);
  await page.close();
});

test("controls have their roles, names and states", async () => {
  const page = await open(browser, ALL);
  assert.equal(await page.locator(".xtmd-label", { hasText: "A label" }).evaluate((el) => getComputedStyle(el).fontWeight), "650");
  assert.equal(await page.getByRole("img", { name: "A picture" }).count(), 1);
  assert.equal(await page.getByRole("img", { name: "Star", exact: true }).count(), 1);
  // an icon with no label is decoration
  assert.equal(await page.locator("svg[data-glyph=CHECK]").getAttribute("aria-hidden"), "true");
  assert.equal(await page.getByRole("button", { name: "Go" }).getAttribute("aria-pressed"), "true");
  assert.equal(await page.getByRole("button", { name: "Off" }).isDisabled(), true);
  assert.equal(await page.getByRole("switch", { name: "Wifi" }).getAttribute("aria-checked"), "true");
  assert.equal(await page.getByRole("checkbox", { name: "Agree" }).getAttribute("aria-checked"), "false");
  assert.equal(await page.getByRole("button", { name: "Plain" }).count(), 1);
  // a press with content of its own is named by its label
  assert.equal(await page.getByRole("button", { name: "Reset" }).locator("svg[data-glyph=RESET]").count(), 1);
  assert.equal(await page.getByRole("tablist").count(), 1);
  assert.equal(await page.getByRole("tab", { name: "One" }).getAttribute("aria-selected"), "true");
  assert.equal(await page.getByRole("tab", { name: "Two" }).getAttribute("aria-selected"), "false");
  assert.equal(await page.getByRole("radiogroup").count(), 1);
  assert.equal(await page.getByRole("radio", { name: "Small" }).getAttribute("aria-checked"), "true");
  assert.equal(await page.getByRole("listbox").count(), 1);
  assert.equal(await page.getByRole("option", { name: "Apple" }).getAttribute("aria-selected"), "true");
  const name = page.getByLabel("Name");
  assert.equal(await name.inputValue(), "Ada");
  assert.equal(await name.getAttribute("placeholder"), "Your name");
  assert.deepEqual(await page.getByLabel("Notes").evaluate((el) => [el.tagName, el.rows]), ["TEXTAREA", 3]);
  const slider = page.getByRole("slider", { name: "N" });
  assert.deepEqual(await slider.evaluate((el) => [el.type, el.min, el.max, el.value, el.getAttribute("aria-valuenow")]), ["range", "0", "10", "3", "3"]);
  // the overlay: a button that says it opens a dialog, and its body on the page but hidden
  const open_ = page.getByRole("button", { name: "Open" });
  assert.equal(await open_.getAttribute("aria-expanded"), "false");
  assert.equal(await open_.getAttribute("aria-haspopup"), "dialog");
  const body = page.locator("[data-part='overlay.body']");
  assert.equal(await body.count(), 1);
  assert.equal(await body.isVisible(), false);
  assert.equal(await body.textContent(), "Inside");
  assert.equal(await page.locator(".xtmd-grid").evaluate((el) => getComputedStyle(el).gridTemplateColumns.split(" ").length), 2);
  assert.equal(await page.locator(".xtmd-cell").evaluate((el) => getComputedStyle(el).gridColumnStart), "span 2");
  assert.equal(await page.locator(".xtmd-sizing").evaluate((el) => getComputedStyle(el).flexGrow), "1");
  await page.close();
});

test("gfx: the canvas, its shapes and the plane are named, and the canvas draws in its own units, y up", async () => {
  const page = await open(browser, ALL);
  assert.equal(await page.getByRole("group", { name: "A dot on a gradient" }).count(), 1);
  const dot = page.getByRole("button", { name: "Dot" });
  assert.equal(await dot.count(), 1);
  // the canvas is 320 by 320 for -1..1: its middle is (160, 160), and r = 0.3 is 48 pixels
  assert.deepEqual(await dot.evaluate((el) => [el.getAttribute("cx"), el.getAttribute("cy"), el.getAttribute("r")]), ["160", "160", "48"]);
  // y up: the handle at (0.5, 0.5) is right of the middle and above it
  const handle = page.getByRole("slider", { name: "Drag me" });
  assert.deepEqual(await handle.evaluate((el) => [el.querySelector("circle").getAttribute("cx"), el.querySelector("circle").getAttribute("cy")]), ["240", "80"]);
  assert.equal(await page.locator("[data-part='path.head']").evaluate((el) => !!el.getAttribute("d")), true);
  assert.equal(await page.getByRole("img", { name: "A gradient" }).count(), 1);
  assert.equal(await page.locator(".xtmd-place-box").textContent(), "Top");
  assert.equal(await page.getByRole("group", { name: "Map" }).count(), 1);
  await page.close();
});

test("a widget nobody supplies shows its Markdown and is reported, and an app's widget replaces ours by name", async () => {
  const acme = pack(
    "acme",
    'package acme;\n\npack acme@1 {\n    uses core@1;\n    provides chart;\n}\n\n//@about A chart only acme draws.\nextern widget chart(title: text) {\n    markdown {\n        \\{title}\n    }\n}\n',
  );
  const page = await open(browser, ir("import acme;\n@@@\nBefore.\n\n@chart(title = \"Sales\");\n", { packs: [acme] }));
  // its Markdown, drawn as the blocks it is made of: a paragraph saying "Sales"
  assert.equal(await page.getByRole("alert").count(), 0);
  assert.equal(await page.locator("p").nth(1).textContent(), "Sales");
  assert.deepEqual(await page.evaluate(() => window.mounted.page.missing()), ["acme/chart"]);
  await page.close();

  const mine = await open(browser, '$state {\n    who: text = "Ada";\n}\n\nwidget hi() {\n    view {\n        @label(value = "Hi \\{$state.who}");\n    }\n}\n@@@\n@hi;\n', { labels: true });
  assert.equal(await mine.locator("mark.app-label").textContent(), "[Hi Ada]");
  assert.equal(await mine.locator("mark.app-label").getAttribute("data-xtmd-site"), "s0/s0");
  await xtmd(mine, "set", { who: { text: "Grace" } });
  assert.equal(await mine.locator("mark.app-label").textContent(), "[Hi Grace]");
  await mine.close();
});
