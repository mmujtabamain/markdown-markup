// What the plain web's check harnesses share (@extended-mark/embed's and @extended-mark/embed-live's): the page
// testing/view_adapter.mjs loads into Chromium, with `window.xtmdCheck` for it to call. Each case's
// document is drawn by @extended-mark/dom, as an app draws one: `install(make)` takes how the target makes
// it, `make(root, props)`, an XtmdDoc or an XtmdLiveDoc. Steps go through the drawn widgets' own DOM
// where they can (Mounted.act); the calls and refusals observed are the ones the document told the app.

import { regionOf, toIr } from "@extended-mark/runtime";
// the checks' fixed sizes, so boxes agree with every other target (README: "Boxes")
import { measure, targetFns } from "../../test/sizes.mjs";
// the check packs' externs for the web, registered as an app registers a pack's
import badge from "../../../checks/packs/badge/web.mjs";

/** Two frames: the DOM drawn and every ResizeObserver callback run. */
function settle() {
  return new Promise((done) => requestAnimationFrame(() => requestAnimationFrame(done)));
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

export function install(make) {
  let doc;
  let calls = [];
  let outcome = { refused: [], failures: [] };
  let loadError;
  const page = () => doc.running;
  const values = (xs = []) => xs.map((x) => page().value(x));
  const drawn = (path) => document.querySelector(`[data-xtmd-site="${CSS.escape(path)}"]`) !== null;

  window.xtmdCheck = {
    async load(irText, pageValues, state, externs, source) {
      doc?.destroy();
      document.body.innerHTML = "";
      const root = document.createElement("div");
      root.id = "page";
      root.style.width = "640px";
      document.body.append(root);
      calls = [];
      outcome = { refused: [], failures: [] };
      loadError = undefined;
      doc = make(root, {
        ir: JSON.parse(irText),
        source,
        page: pageValues,
        defaultState: state,
        externs,
        fns: targetFns(() => page()),
        widgets: { ...badge },
        measure: (p) => measure(p),
        onCalls: (c) => calls.push(...c),
        onError: ({ kind, ...broken }) => {
          if (kind === "refused") outcome.refused.push(broken);
          else if (kind === "failed") outcome.failures.push(broken);
          else loadError = broken.message;
        },
      });
      // a real-time target compiles first: the page runs once it has
      for (let k = 0; !doc.running; k++) {
        if (loadError) throw new Error(loadError);
        if (k > 600) throw new Error("the page didn't load in time");
        await settle();
      }
      await settle();
    },
    async event(site, name, args) {
      doc.mounted.act(site, { event: name, args: values(args) });
      await settle();
    },
    async write(site, input, value) {
      doc.mounted.act(site, { write: input, value: page().value(value) });
      await settle();
    },
    async set(state) {
      doc.set(state);
      await settle();
    },
    async expose(channel, name, args) {
      doc.expose(channel, name, ...args);
      await settle();
    },
    async extern(channel, given) {
      doc.extern(channel, given);
      await settle();
    },
    async page(values) {
      page().setPage(values);
      await settle();
    },
    async observe() {
      // what XtmdDoc tells the app after a change reaches it once the change is done
      await new Promise((r) => setTimeout(r, 0));
      const p = page();
      const tree = Object.fromEntries(Object.entries(p.observeTree()).filter(([path]) => drawn(path)));
      const o = { tree, state: p.observeState(), calls, outcome, markdown: p.markdown() };
      calls = [];
      outcome = { refused: [], failures: [] };
      const found = boxes(p.tree());
      if (Object.keys(found).length) o.boxes = found;
      const shaded = p.observeShaded();
      if (Object.keys(shaded).length) o.shaded = shaded;
      return o;
    },
  };
}
