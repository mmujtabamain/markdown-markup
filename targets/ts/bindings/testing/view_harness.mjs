// The page a view target's check adapter loads into Chromium: the framework's <XtmdDoc> (its
// harness gives `mountDoc`), with `window.xtmdCheck` for the adapter to call. Every step goes
// through the drawn widgets' own DOM where it can (@extended-mark/view's `act`), then waits for the page to
// settle: the framework's render committed, ResizeObserver's callbacks run, the plane laid out.

import { act } from "@extended-mark/view";
import { regionOf, toIr } from "@extended-mark/runtime";
// the checks' fixed sizes, so boxes agree with every other target (README: "Boxes")
import { measure, targetFns } from "../../test/sizes.mjs";
// the check packs' externs for the view targets, registered as an app registers a pack's
import badge from "../../../checks/packs/badge/view.mjs";

/** Two frames: the render committed and every ResizeObserver callback run. */
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

/** `mountDoc(root, props)` renders the framework's <XtmdDoc> into root and returns, or resolves to,
 * `{ doc(), unmount() }`, where `doc()` is the running @extended-mark/view Doc. A real-time target's props
 * also have `source`: the case's `{ path, text, packs }`, which it compiles instead of `ir`. */
export function install(mountDoc) {
  let current;
  let root;
  let calls = [];
  let outcome = { refused: [], failures: [] };
  const page = () => current.doc().running;
  const values = (xs = []) => xs.map((x) => page().value(x));
  const record = (o = {}) => Object.fromEntries(Object.entries(o).map(([k, x]) => [k, page().value(x)]));
  const drawn = (path) => root.querySelector(`[data-xtmd-site="${CSS.escape(path)}"]`) !== null;

  window.xtmdCheck = {
    async load(irText, pageValues, state, externs, source) {
      current?.unmount();
      document.body.innerHTML = "";
      root = document.createElement("div");
      root.id = "page";
      root.style.width = "640px";
      document.body.append(root);
      calls = [];
      outcome = { refused: [], failures: [] };
      let compileError;
      current = await mountDoc(root, {
        ...(source ? { source } : { ir: JSON.parse(irText) }),
        page: pageValues,
        defaultState: state,
        externs,
        fns: targetFns(() => page()),
        widgets: badge,
        measure: (p) => measure(p),
        onCalls: (c) => calls.push(...c),
        onError: ({ kind, ...broken }) => {
          if (kind === "refused") outcome.refused.push(broken);
          else if (kind === "failed") outcome.failures.push(broken);
          else if (kind === "compile" || kind === "load") compileError = broken.message;
        },
      });
      // a real-time target compiles first: the page runs once it has
      for (let k = 0; !current.doc()?.running; k++) {
        if (compileError) throw new Error(compileError);
        if (k > 600) throw new Error("the page didn't compile in time");
        await settle();
      }
      await settle();
      await settle();
    },
    async event(site, name, args) {
      act(root, page(), site, { event: name, args: values(args) });
      current.doc().changed();
      await settle();
    },
    async write(site, input, value) {
      act(root, page(), site, { write: input, value: page().value(value) });
      current.doc().changed();
      await settle();
    },
    async set(state) {
      current.doc().set(record(state));
      await settle();
    },
    async expose(channel, name, args) {
      current.doc().expose(channel, name, ...values(args));
      await settle();
    },
    async extern(channel, given) {
      page().setExtern(channel, record(given));
      await settle();
    },
    async page(v) {
      page().setPage(v);
      await settle();
    },
    async observe() {
      // what the page did reaches the app once the change is done
      await Promise.resolve();
      const p = page();
      const tree = Object.fromEntries(Object.entries(p.observeTree()).filter(([path]) => drawn(path)));
      const o = { tree, state: p.observeState(), calls: [...calls, ...p.takeCalls()], outcome: (() => {
        const t = p.takeOutcome();
        return { refused: [...outcome.refused, ...t.refused], failures: [...outcome.failures, ...t.failures] };
      })(), markdown: p.markdown() };
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
