// The test app for <MkpLiveDoc>: its text compiled in the tab, with the controls the shared live
// steps use (testing/browser.mjs, liveSteps).
import { createComponent, createSignal } from "solid-js";
import { render } from "solid-js/web";
import { MkpLiveDoc } from "@mkp/solid-live";

const heard = { states: [], errors: [], calls: [] };
const [source, setSource] = createSignal(window.__SRC.v1);
const externs = { app: { unit: { text: "items" } } };
let handle;

render(
  () =>
    createComponent(MkpLiveDoc, {
      ref: (h) => (handle = h),
      get source() {
        return source();
      },
      wasm: window.__WASM_URL,
      externs,
      onStateChange: (s) => heard.states.push(s),
      onError: (e) => heard.errors.push(e),
      onCalls: (c) => heard.calls.push(c),
    }),
  document.getElementById("app"),
);

window.__test = { heard, handle: () => handle, setSource };
