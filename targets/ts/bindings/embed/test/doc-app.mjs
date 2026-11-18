// The test app for the plain web's MkpDoc: drawn by @mkp/dom, `$state` controlled by the app, with
// the controls the shared doc steps use (testing/browser.mjs, docSteps).
import { MkpDoc } from "@mkp/embed";

const heard = { states: [], errors: [], calls: [] };
let props = {
  ir: window.__IR.v1,
  page: { theme: "LIGHT" },
  externs: { app: { unit: { text: "items" } } },
  onStateChange: (s) => {
    heard.states.push(s);
    change({ state: s });
  },
  onError: (e) => heard.errors.push(e),
  onCalls: (c) => heard.calls.push(c),
};
const doc = new MkpDoc(document.getElementById("app"), props);

function change(p) {
  props = { ...props, ...p };
  doc.update(props);
}

window.__test = {
  heard,
  handle: () => ({
    set: (c) => doc.set(c),
    state: () => doc.state(),
    markdown: () => doc.markdown(),
    expose: (c, n, ...a) => doc.expose(c, n, ...a),
    snapshot: () => doc.snapshot(),
    restore: (s) => doc.restore(s),
  }),
  setState: (s) => change({ state: s }),
  setTheme: (t) => change({ page: { theme: t } }),
  setUnit: (u) => change({ externs: { app: { unit: { text: u } } } }),
  setIr: (w) => change({ ir: window.__IR[w] }),
  unmount: () => doc.destroy(),
};
