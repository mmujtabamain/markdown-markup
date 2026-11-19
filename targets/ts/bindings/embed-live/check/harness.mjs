// The plain web's real-time check harness: each case's document is an XtmdLiveDoc, its own text
// compiled in the tab by the xtmd.wasm the adapter serves, then drawn by @extended-mark/dom
// (testing/dom_harness.mjs).

import { XtmdLiveDoc } from "../dist/index.js";
import { install } from "../../testing/dom_harness.mjs";

install((root, { source, ir: _, ...props }) => new XtmdLiveDoc(root, { ...props, source: source.text, path: source.path, packs: source.packs, wasm: window.__WASM_URL }));
