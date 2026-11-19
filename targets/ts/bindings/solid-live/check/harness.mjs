// The Solid real-time target's check harness: <XtmdLiveDoc> rendered by Solid, driven by the checks.
import { createComponent } from "solid-js";
import { render } from "solid-js/web";
import { XtmdLiveDoc } from "../dist/index.js";
import { install } from "../../testing/view_harness.mjs";

/** The case's text for <XtmdLiveDoc>, compiled in the tab by the xtmd.wasm the adapter serves. */
const live = ({ source, ...props }) => ({ ...props, source: source.text, path: source.path, packs: source.packs, wasm: window.__WASM_URL });

install((root, props) => {
  let handle;
  const dispose = render(() => createComponent(XtmdLiveDoc, { ...live(props), ref: (h) => (handle = h) }), root);
  return { doc: () => handle?.doc, unmount: dispose };
});
