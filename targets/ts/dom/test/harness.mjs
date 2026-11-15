// The page the browser tests drive: @mkp/dom bundled with @mkp/runtime, and a few helpers on
// window.mkp that take and give values in the IR's form, as the checks do.

import { mount, run, widgets } from "../dist/index.js";
import { Num, toIr } from "@mkp/runtime";

let mounted;

/** A measure with the test target's fixed sizes: text 8 wide per character and 20 high. */
function fixedMeasure(page) {
  const text = (d) => {
    for (const k of ["value", "label"]) {
      const v = d.props.get(k);
      if (v && v.kind === "text") return v.s;
    }
    return undefined;
  };
  return {
    spot(s) {
      const kid = [...s.slots.values()].flat()[0];
      const t = kid ? text(kid) : undefined;
      return { width: Num.int(t === undefined ? 80 : 8 * [...t].length), height: Num.int(20) };
    },
    planeWidth: () => Num.int(640),
  };
}

window.mkp = {
  start(irText, opts = {}) {
    if (mounted) mounted.unmount();
    const root = document.getElementById("app");
    const file = JSON.parse(irText);
    const extra = {};
    if (opts.fixed) extra.measure = fixedMeasure();
    if (opts.labels) {
      // an app's own label, in place of ours
      extra.widgets = {
        "core/label": (d) => {
          const el = document.createElement("mark");
          el.className = "app-label";
          const show = (d) => (el.textContent = `[${d.props.get("value").s}]`);
          show(d);
          return { el, update: show };
        },
      };
    }
    if (opts.without) extra.widgets = Object.fromEntries(opts.without.map((w) => [w, undefined]));
    mounted = run(file, root, { page: opts.page ?? {}, state: opts.state, ...extra });
    window.mounted = mounted;
    return true;
  },
  page: () => mounted.page,
  state: () => mounted.page.observeState(),
  markdown: () => mounted.page.markdown(),
  outcome: () => mounted.page.takeOutcome(),
  errors: () => mounted.page.errors.map((e) => String(e?.stack ?? e)),
  tree: () => mounted.page.observeTree(),
  paths() {
    const out = [];
    const walk = (nodes) => {
      for (const n of nodes) {
        out.push({ path: n.path, widget: n.widget });
        for (const kids of n.slots.values()) walk(kids);
      }
    };
    walk(mounted.page.tree());
    return out;
  },
  act(path, action) {
    const p = mounted.page;
    if ("event" in action) mounted.act(path, { event: action.event, args: (action.args ?? []).map((a) => p.value(a)) });
    else mounted.act(path, { write: action.write, value: p.value(action.value) });
  },
  event: (path, name, args = []) => mounted.page.event(path, name, args.map((a) => mounted.page.value(a))),
  write: (path, input, value) => mounted.page.write(path, input, mounted.page.value(value)),
  set: (changes) => mounted.page.set(Object.fromEntries(Object.entries(changes).map(([k, v]) => [k, mounted.page.value(v)]))),
  setPage: (values) => mounted.page.setPage(values),
  unmount: () => mounted.unmount(),
  widgets: () => Object.keys(widgets),
  mount,
  toIr,
};
