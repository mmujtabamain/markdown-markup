// The Vue real-time target's check harness: <MkpLiveDoc> rendered by Vue, driven by the checks.
import { createApp, h, ref } from "vue";
import { MkpLiveDoc } from "../dist/index.js";
import { install } from "../../testing/view_harness.mjs";

/** The case's text for <MkpLiveDoc>, compiled in the tab by the mkp.wasm the adapter serves. */
const live = ({ source, ...props }) => ({ ...props, source: source.text, path: source.path, packs: source.packs, wasm: window.__WASM_URL });

install((root, props) => {
  const doc = ref(null);
  const app = createApp({ render: () => h(MkpLiveDoc, { ...live(props), ref: doc }) });
  app.mount(root);
  return { doc: () => doc.value?.doc, unmount: () => app.unmount() };
});
