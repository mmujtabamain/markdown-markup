// The Vue real-time target's check harness: <XtmdLiveDoc> rendered by Vue, driven by the checks.
import { createApp, h, ref } from "vue";
import { XtmdLiveDoc } from "../dist/index.js";
import { install } from "../../testing/view_harness.mjs";

/** The case's text for <XtmdLiveDoc>, compiled in the tab by the xtmd.wasm the adapter serves. */
const live = ({ source, ...props }) => ({ ...props, source: source.text, path: source.path, packs: source.packs, wasm: window.__WASM_URL });

install((root, props) => {
  const doc = ref(null);
  const app = createApp({ render: () => h(XtmdLiveDoc, { ...live(props), ref: doc }) });
  app.mount(root);
  return { doc: () => doc.value?.doc, unmount: () => app.unmount() };
});
