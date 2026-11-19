// The page the web target's check adapter loads into Chromium: @extended-mark/runtime and @extended-mark/dom, bundled
// by esbuild, with `window.xtmdCheck` for the adapter to call. Every step goes through the drawn
// widgets' own DOM where it can (Mounted.act), then waits for the page to settle: the DOM drawn,
// ResizeObserver's callbacks run and the plane's layout written.

import { Page } from "@extended-mark/runtime";
import { mount } from "@extended-mark/dom";
import { regionOf, toIr } from "@extended-mark/runtime";
// the checks' fixed sizes, so boxes agree with every other target (README: "Boxes")
import { measure, targetFns } from "../test/sizes.mjs";
// the check packs' externs for the web, registered as an app registers a pack's
import badge from "../../checks/packs/badge/web.mjs";

let mounted;

/** Two frames: the DOM drawn and every ResizeObserver callback run. */
function settle() {
  return new Promise((done) => requestAnimationFrame(() => requestAnimationFrame(done)));
}

function values(xs = []) {
  return xs.map((x) => mounted.page.value(x));
}

function record(o = {}) {
  return Object.fromEntries(Object.entries(o).map(([k, x]) => [k, mounted.page.value(x)]));
}

/** Where each spot landed, by its path. */
function boxes(nodes, out = {}) {
  for (const n of nodes) {
    if (n.widget === "core/spot") {
      const r = regionOf(n.props.get("box"));
      const num = (n) => toIr({ kind: "num", n });
      if (r) out[n.path] = { from: { x: num(r.from.x), y: num(r.from.y) }, to: { x: num(r.to.x), y: num(r.to.y) } };
    }
    for (const kids of n.slots.values()) boxes(kids, out);
  }
  return out;
}

/** Whether a widget the page drew is in the DOM: the observed tree is only what was drawn. */
function drawn(path) {
  return document.querySelector(`[data-xtmd-site="${CSS.escape(path)}"]`) !== null;
}

window.xtmdCheck = {
  async load(irText, page, state, externs) {
    mounted?.unmount();
    document.body.innerHTML = "";
    const root = document.createElement("div");
    root.id = "page";
    root.style.width = "640px";
    document.body.append(root);
    let p;
    p = new Page(JSON.parse(irText), { page, state, externs, fns: targetFns(() => p) });
    mounted = mount(p, root, { measure: measure(p), widgets: { ...badge } });
    await settle();
  },
  async event(site, name, args) {
    mounted.act(site, { event: name, args: values(args) });
    await settle();
  },
  async write(site, input, value) {
    mounted.act(site, { write: input, value: mounted.page.value(value) });
    await settle();
  },
  async set(state) {
    mounted.page.set(record(state));
    await settle();
  },
  async expose(channel, name, args) {
    mounted.page.expose(channel, name, values(args));
    await settle();
  },
  async extern(channel, given) {
    mounted.page.setExtern(channel, record(given));
    await settle();
  },
  async page(values) {
    mounted.page.setPage(values);
    await settle();
  },
  observe() {
    const p = mounted.page;
    const tree = Object.fromEntries(Object.entries(p.observeTree()).filter(([path]) => drawn(path)));
    const o = { tree, state: p.observeState(), calls: p.takeCalls(), outcome: p.takeOutcome(), markdown: p.markdown() };
    const found = boxes(p.tree());
    if (Object.keys(found).length) o.boxes = found;
    const shaded = p.observeShaded();
    if (Object.keys(shaded).length) o.shaded = shaded;
    return o;
  },
};
