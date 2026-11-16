// How long one drag step takes in Chromium, from the pointer to the page drawn again: a canvas
// handle and a plane's pan, each with the page's reuse on and off, alternating in one browser so a
// busy machine weighs on both alike. Prints the median ms per step.
//
//   node test/drag-bench.mjs <page.mkp.md>      (e.g. ../android/compose/sample/pages/tour.mkp.md)
import { launch, open } from "./browser.mjs";
import { readFileSync } from "node:fs";
const browser = await launch();
const page = await open(browser, readFileSync(process.argv[2], "utf8"));
await page.waitForTimeout(500);
const out = await page.evaluate(async () => {
  const pg = window.mounted.page;
  const opts = (x, y) => ({ bubbles: true, pointerId: 1, pointerType: "mouse", button: 0, buttons: 1, clientX: x, clientY: y, isPrimary: true });
  const drag = (sel, dx, dy, steps) => {
    const el = document.querySelector(sel);
    const r = el.getBoundingClientRect();
    const x0 = r.left + r.width / 2, y0 = r.top + r.height / 2;
    el.dispatchEvent(new PointerEvent("pointerdown", opts(x0, y0)));
    const each = [];
    for (let k = 1; k <= steps; k++) { const t = performance.now(); el.dispatchEvent(new PointerEvent("pointermove", opts(x0 + dx * (k % 20), y0 + dy * (k % 20)))); each.push(performance.now() - t); }
    el.dispatchEvent(new PointerEvent("pointerup", opts(x0, y0)));
    return each;
  };
  const res = { on: { handle: [], plane: [] }, off: { handle: [], plane: [] } };
  for (let round = 0; round < 6; round++) {
    for (const mode of ["on", "off"]) {
      pg.memoOn = mode === "on";
      res[mode].handle.push(...drag("[data-part='handle.hit']", 1, -0.5, 20));
      res[mode].plane.push(...drag("[data-part='plane.view']", 2, 1, 20));
    }
  }
  const med = (a) => { a.sort((x, y) => x - y); return +a[a.length >> 1].toFixed(2); };
  return { on: { handle: med(res.on.handle), plane: med(res.on.plane) }, off: { handle: med(res.off.handle), plane: med(res.off.plane) } };
});
console.log(JSON.stringify(out));
await browser.close();
