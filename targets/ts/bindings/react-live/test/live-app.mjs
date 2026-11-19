// The test app for <XtmdLiveDoc>: its text compiled in the tab, with the controls the shared live
// steps use (testing/browser.mjs, liveSteps).
import { createElement as h, useState, useRef, StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { XtmdLiveDoc } from "@extended-mark/react-live";

const heard = { states: [], errors: [], calls: [] };
let controls;
const externs = { app: { unit: { text: "items" } } };

function App() {
  const [source, setSource] = useState(window.__SRC.v1);
  const ref = useRef(null);
  controls = { setSource, ref };
  return h(XtmdLiveDoc, {
    ref,
    source,
    wasm: window.__WASM_URL,
    externs,
    onStateChange: (s) => heard.states.push(s),
    onError: (e) => heard.errors.push(e),
    onCalls: (c) => heard.calls.push(c),
  });
}

createRoot(document.getElementById("app")).render(h(StrictMode, null, h(App)));

window.__test = { heard, handle: () => controls.ref.current, setSource: (s) => controls.setSource(s) };
