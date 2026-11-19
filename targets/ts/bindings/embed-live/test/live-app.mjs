// The test app for the plain web's XtmdLiveDoc: its text compiled in the tab, with the controls the
// shared live steps use (testing/browser.mjs, liveSteps).
import { XtmdLiveDoc } from "@extended-mark/embed-live";

const heard = { states: [], errors: [], calls: [] };
let props = {
  source: window.__SRC.v1,
  wasm: window.__WASM_URL,
  externs: { app: { unit: { text: "items" } } },
  onStateChange: (s) => heard.states.push(s),
  onError: (e) => heard.errors.push(e),
  onCalls: (c) => heard.calls.push(c),
};
const doc = new XtmdLiveDoc(document.getElementById("app"), props);

window.__test = {
  heard,
  handle: () => ({ set: (c) => doc.set(c), state: () => doc.state(), markdown: () => doc.markdown() }),
  setSource: (s) => {
    props = { ...props, source: s };
    doc.update(props);
  },
};
