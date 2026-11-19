// The plane and core.gfx in a real browser: spots' boxes from the layout, panning and zooming
// that write center and zoom while the boxes stay, clicks in the plane's and the canvas's units,
// a handle dragged, and a shade's pixels painted from its shader.

import { after, before, test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { ir, launch, xtmd, num, open, repo } from "./browser.mjs";

let browser;
before(async () => {
  browser = await launch();
});
after(async () => {
  await browser?.close();
});

const MAP = `$state {
    center: point = point { x = 0, y = 0 };
    zoom: number 0.1..10 = 1;
    seen: opt<region> = opt.NONE;
    home: opt<region> = opt.NONE;
    away: opt<region> = opt.NONE;
    last: point = point { x = 0, y = 0 };
    clicks: int = 0;
}

widget map() {
    view {
        @plane(label = "Map", bounds = region { from = point { x = -1000, y = -600 }, to = point { x = 1000, y = 600 } }, center = $state.center, zoom = $state.zoom, zoom_range = 1..4, aspect = 2, drawn = $state.seen, click = fn(at: point) { $state.last = at; $state.clicks = $state.clicks + 1; }) {
            background {
                @layer {
                    @circle(at = point { x = 0, y = 0 }, r = 50, stroke = color.LINE, label = "Ring");
                }
            }
            items {
                @spot(at = point { x = 0, y = 0 }, box = $state.home) {
                    @label(value = "Home");
                }
                @spot(at = point { x = 100, y = 50 }, anchor = anchor.SW, box = $state.away) {
                    @press(label = "Go");
                }
            }
        }
    }
}
@@@
@map;
`;

const pt = (x, y) => ({ record: { type: "core/point", fields: { x: num(x), y: num(y) } } });
const region = (x0, y0, x1, y1) => ({ some: { record: { type: "core/region", fields: { from: pt(x0, y0), to: pt(x1, y1) } } } });
const n = (v) => Number(v.num);
const box = (r) => {
  const f = r.some.record.fields;
  return [f.from, f.to].flatMap((p) => [n(p.record.fields.x), n(p.record.fields.y)]);
};

test("spots' boxes come from the layout: with fixed sizes, exactly where the test target puts them", async () => {
  const page = await open(browser, MAP, { fixed: true });
  const s = await xtmd(page, "state");
  // "Home" is 4 characters: 32 by 20, centred on (0, 0); "Go" is 16 by 20, its bottom-left on (100, 50)
  assert.deepEqual(s.home, region(-16, -10, 16, 10));
  assert.deepEqual(s.away, region(100, 50, 116, 70));
  // 640 wide at zoom 1 and aspect 2: the drawn area is 640 by 320 around the centre
  assert.deepEqual(s.seen, region(-320, -160, 320, 160));
  await page.close();
});

test("plane: a drag pans and a wheel zooms, writing center and zoom, while every box stays as it was", async () => {
  const page = await open(browser, MAP);
  const view = page.locator("[data-part='plane.view']");
  const v = await view.boundingBox();
  const mid = { x: v.x + v.width / 2, y: v.y + v.height / 2 };
  // boxes are each spot's own size on the page, in the plane's units
  const sizes = await page.evaluate(() => [...document.querySelectorAll("[data-part=spot]")].map((el) => [el.offsetWidth, el.offsetHeight]));
  const before_ = await xtmd(page, "state");
  const [hw, hh] = sizes[0];
  assert.deepEqual(box(before_.home), [-hw / 2, -hh / 2, hw / 2, hh / 2]);
  assert.deepEqual(box(before_.away), [100, 50, 100 + sizes[1][0], 50 + sizes[1][1]]);
  const homeAt = async () => {
    const b = await page.locator("[data-part=spot]").first().boundingBox();
    return { x: b.x + b.width / 2 - mid.x, y: b.y + b.height / 2 - mid.y, w: b.width };
  };
  const ringAt = async () => {
    const b = await page.getByRole("img", { name: "Ring" }).boundingBox();
    return { x: b.x + b.width / 2 - mid.x, y: b.y + b.height / 2 - mid.y };
  };

  // drag from empty space: 60 right and 30 down moves the view 60 left and 30 up
  await page.mouse.move(mid.x - 200, mid.y + 100);
  await page.mouse.down();
  await page.mouse.move(mid.x - 170, mid.y + 115, { steps: 4 });
  await page.mouse.move(mid.x - 140, mid.y + 130, { steps: 4 });
  await page.mouse.up();
  let s = await xtmd(page, "state");
  assert.deepEqual(s.center, pt(-60, 30));
  assert.deepEqual(s.clicks, num(0));
  assert.deepEqual([s.home, s.away], [before_.home, before_.away]);
  // what is drawn moved with it: the spot and the background together
  let at = await homeAt();
  assert.ok(Math.abs(at.x - 60) < 1 && Math.abs(at.y - 30) < 1, JSON.stringify(at));
  const ring = await ringAt();
  assert.ok(Math.abs(ring.x - 60) < 1 && Math.abs(ring.y - 30) < 1, JSON.stringify(ring));
  assert.deepEqual(box(s.seen), [-60 - v.width / 2 + 0, 30 - v.height / 2, -60 + v.width / 2, 30 + v.height / 2].map((x) => Number(x.toFixed(10))));

  // the wheel zooms about the pointer, within zoom_range
  await page.mouse.move(mid.x, mid.y);
  await page.mouse.wheel(0, -300);
  await page.waitForFunction(() => Number(window.xtmd.state().zoom.num) > 1);
  s = await xtmd(page, "state");
  const z = n(s.zoom);
  assert.ok(z > 1.3 && z < 4, `zoom ${z}`);
  // the point under the pointer stays: the pointer is in the middle (a wheel event's position is
  // whole pixels, so up to half a pixel off it), and the centre is where it was
  const cf = s.center.record.fields;
  assert.ok(Math.abs(n(cf.x) + 60) < 0.5 && Math.abs(n(cf.y) - 30) < 0.5, JSON.stringify(cf));
  assert.deepEqual([s.home, s.away], [before_.home, before_.away]);
  at = await homeAt();
  assert.ok(Math.abs(at.w - hw * z) < 1.5, `drawn ${z} times as big: ${at.w}`);
  for (let k = 0; k < 6; k++) await page.mouse.wheel(0, -600);
  await page.waitForFunction(() => window.xtmd.state().zoom.num === "4");
  s = await xtmd(page, "state");
  assert.deepEqual([s.home, s.away], [before_.home, before_.away]);
  // and back out, never below 1
  for (let k = 0; k < 8; k++) await page.mouse.wheel(0, 900);
  await page.waitForFunction(() => window.xtmd.state().zoom.num === "1");
  assert.deepEqual([(await xtmd(page, "state")).home, (await xtmd(page, "state")).away], [before_.home, before_.away]);
  // the keyboard moves it too
  await view.focus();
  await page.keyboard.press("ArrowRight");
  assert.deepEqual((await xtmd(page, "state")).center, pt(-20, 30));
  assert.deepEqual(page.errors, []);
  await page.close();
});

test("plane: a click on empty space is click(at) in the plane's units; a click on a spot is not", async () => {
  const page = await open(browser, MAP);
  const v = await page.locator("[data-part='plane.view']").boundingBox();
  const mid = { x: v.x + v.width / 2, y: v.y + v.height / 2 };
  await page.mouse.click(mid.x + 200, mid.y - 120);
  const s = await xtmd(page, "state");
  assert.deepEqual(s.clicks, num(1));
  const f = s.last.record.fields;
  assert.ok(Math.abs(n(f.x) - 200) <= 0.5 && Math.abs(n(f.y) - 120) <= 0.5, JSON.stringify(f));
  await page.getByRole("button", { name: "Go" }).click();
  await page.locator("[data-part=spot]").first().click();
  assert.deepEqual((await xtmd(page, "state")).clicks, num(1));
  await page.close();
});

const PIC = `$state {
    p: point = point { x = 0.5, y = 0.5 };
    hits: int = 0;
    inside: bool = false;
    last: point = point { x = 9, y = 9 };
}

widget pic() {
    view {
        @canvas(label = "Pic", aspect = 1, click = fn(at: point) { $state.last = at; }) {
            @layer {
                @circle(at = point { x = -0.5, y = -0.5 }, r = 0.2, fill = color.ACCENT, label = "Dot", click = fn() { $state.hits = $state.hits + 1; }, enter = fn() { $state.inside = true; }, leave = fn() { $state.inside = false; });
                @handle(at = $state.p, label = "Drag me");
            }
        }
    }
}
@@@
@pic;
`;

test("canvas: a circle is clicked, entered and left; a handle is dragged and writes at; empty space is click(at)", async () => {
  const page = await open(browser, PIC);
  const c = await page.getByRole("group", { name: "Pic" }).boundingBox();
  // 320 by 320 for -1..1 on both axes, y up
  const screen = (x, y) => ({ x: c.x + ((x + 1) / 2) * c.width, y: c.y + ((1 - y) / 2) * c.height });
  const dot = screen(-0.5, -0.5);
  await page.mouse.move(dot.x, dot.y);
  assert.equal((await xtmd(page, "state")).inside.bool, true);
  await page.mouse.click(dot.x, dot.y);
  assert.deepEqual((await xtmd(page, "state")).hits, num(1));
  await page.mouse.move(dot.x + 100, dot.y);
  assert.equal((await xtmd(page, "state")).inside.bool, false);
  // the keyboard reaches it too
  await page.getByRole("button", { name: "Dot" }).focus();
  await page.keyboard.press("Enter");
  assert.deepEqual((await xtmd(page, "state")).hits, num(2));
  // drag the handle from (0.5, 0.5) by 32 pixels right and 32 down: 0.2 across and 0.2 down
  const h = screen(0.5, 0.5);
  await page.mouse.move(h.x, h.y);
  await page.mouse.down();
  await page.mouse.move(h.x + 16, h.y + 16, { steps: 3 });
  await page.mouse.move(h.x + 32, h.y + 32, { steps: 3 });
  await page.mouse.up();
  assert.deepEqual((await xtmd(page, "state")).p, pt("0.7", "0.3"));
  assert.equal(await page.getByRole("slider", { name: "Drag me" }).getAttribute("aria-valuetext"), "(0.7, 0.3)");
  const mid = screen(0, 0);
  await page.mouse.click(mid.x, mid.y);
  assert.deepEqual((await xtmd(page, "state")).last, pt(0, 0));
  assert.deepEqual((await xtmd(page, "state")).hits, num(2));
  await page.close();
});

const SHADE = `fn glow(at: point, px: number, args: number): pixel {
    return pixel { r = at.x.clamp(0, 1), g = 0, b = at.y.clamp(0, 1), a = 1 };
}

widget sample() {
    view {
        @canvas(label = "A gradient", x = 0..1, y = 0..1, aspect = 1) {
            @layer {
                @shade(area = region { from = point { x = 0, y = 0 }, to = point { x = 1, y = 1 } }, shader = glow, args = 1, label = "red across, blue up");
            }
        }
    }
}
@@@
@sample;
`;

test("shade: the shader's colour is painted for every sampled pixel, red across and blue up, within the limits", async () => {
  const page = await open(browser, SHADE);
  const shade = page.getByRole("img", { name: "red across, blue up" });
  await page.waitForFunction(() => document.querySelector("[data-part=shade]")?.getAttribute("data-state") === "done", null, { timeout: 30000 });
  const out = await shade.evaluate((el) => {
    const cv = el.querySelector("canvas");
    const g = cv.getContext("2d");
    const at = (x, y) => [...g.getImageData(x, y, 1, 1).data];
    return { w: cv.width, h: cv.height, samples: el.getAttribute("data-samples"), topLeft: at(0, 0), topRight: at(cv.width - 1, 0), bottomLeft: at(0, cv.height - 1), bottomRight: at(cv.width - 1, cv.height - 1), shown: [el.getAttribute("width"), el.getAttribute("height")] };
  });
  assert.ok(out.w * out.h <= 65536 && out.w >= 64 && out.h >= 64, JSON.stringify(out));
  assert.deepEqual(out.shown, ["320", "320"]);
  const near = (got, want) => got.every((v, k) => Math.abs(v - want[k]) <= 4);
  // top-left is x 0, y 1: blue; top-right: red and blue; bottom-left: black; bottom-right: red
  assert.ok(near(out.topLeft, [0, 0, 255, 255]), `top-left ${out.topLeft}`);
  assert.ok(near(out.topRight, [255, 0, 255, 255]), `top-right ${out.topRight}`);
  assert.ok(near(out.bottomLeft, [0, 0, 0, 255]), `bottom-left ${out.bottomLeft}`);
  assert.ok(near(out.bottomRight, [255, 0, 0, 255]), `bottom-right ${out.bottomRight}`);
  assert.deepEqual(await xtmd(page, "errors"), []);
  await page.close();
});

test("the graphs example: nodes on a plane, lines from box to box, laid out once and then still", async () => {
  const graphs = join(repo, "examples/graphs");
  const page = await open(browser, ir(readFileSync(join(graphs, "release-flow.xt.md"), "utf8"), { packs: [graphs] }));
  assert.deepEqual(await xtmd(page, "outcome"), { refused: [], failures: [] });
  assert.equal(await page.locator("[data-part=spot]").count(), 5);
  // each line starts where the line from one node's middle to the other's leaves its box
  const steps = (await xtmd(page, "state")).steps.list.map((s) => box(s.record.fields.box));
  const lines = await page.locator("[data-part='path.line']").evaluateAll((els) => els.map((el) => el.getAttribute("d")));
  assert.equal(lines.length, 2);
  assert.ok(lines[0].startsWith(`M${steps[0][2]} `), `${lines[0]} from ${steps[0]}`);
  assert.equal(await page.getByRole("img", { name: "build to test" }).count(), 1);
  await page.evaluate(() => {
    window.redraws = 0;
    window.mounted.page.onChange(() => window.redraws++);
  });
  await page.waitForTimeout(600);
  assert.equal(await page.evaluate(() => window.redraws), 0);
  await page.close();
});
