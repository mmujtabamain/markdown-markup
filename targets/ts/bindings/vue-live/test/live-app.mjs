// The test app for <MkpLiveDoc>: its text compiled in the tab, with the controls the shared live
// steps use (testing/browser.mjs, liveSteps).
import { createApp, h, ref } from "vue";
import { MkpLiveDoc } from "@mkp/vue-live";

const heard = { states: [], errors: [], calls: [] };
const source = ref(window.__SRC.v1);
const view = ref(null);
const externs = { app: { unit: { text: "items" } } };

createApp({
  render: () =>
    h(MkpLiveDoc, {
      ref: view,
      source: source.value,
      wasm: window.__WASM_URL,
      externs,
      onStateChange: (s) => heard.states.push(s),
      onError: (e) => heard.errors.push(e),
      onCalls: (c) => heard.calls.push(c),
    }),
}).mount("#app");

window.__test = { heard, handle: () => view.value, setSource: (s) => (source.value = s) };
