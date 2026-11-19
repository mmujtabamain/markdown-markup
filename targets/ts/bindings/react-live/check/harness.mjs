// The React real-time target's check harness: <XtmdLiveDoc> rendered by React, driven by the checks.
import { createElement as h, createRef } from "react";
import { createRoot } from "react-dom/client";
import { flushSync } from "react-dom";
import { XtmdLiveDoc } from "../dist/index.js";
import { install } from "../../testing/view_harness.mjs";

/** The case's text for <XtmdLiveDoc>, compiled in the tab by the xtmd.wasm the adapter serves. */
const live = ({ source, ...props }) => ({ ...props, source: source.text, path: source.path, packs: source.packs, wasm: window.__WASM_URL });

install((root, props) => {
  const ref = createRef();
  const r = createRoot(root);
  flushSync(() => r.render(h(XtmdLiveDoc, { ...live(props), ref })));
  return { doc: () => ref.current?.doc, unmount: () => r.unmount() };
});
