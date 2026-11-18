// The Solid real-time target's check harness: <MkpLiveDoc> rendered by Solid, driven by the checks.
import { createComponent } from "solid-js";
import { render } from "solid-js/web";
import { MkpLiveDoc } from "../dist/index.js";
import { install } from "../../testing/view_harness.mjs";

/** The case's text for <MkpLiveDoc>, compiled in the tab by the mkp.wasm the adapter serves. */
const live = ({ source, ...props }) => ({ ...props, source: source.text, path: source.path, packs: source.packs, wasm: window.__WASM_URL });

install((root, props) => {
  let handle;
  const dispose = render(() => createComponent(MkpLiveDoc, { ...live(props), ref: (h) => (handle = h) }), root);
  return { doc: () => handle?.doc, unmount: dispose };
});
