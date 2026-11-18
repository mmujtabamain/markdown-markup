// The plain web's real-time check harness: each case's document is an MkpLiveDoc, its own text
// compiled in the tab by the mkp.wasm the adapter serves, then drawn by @mkp/dom
// (testing/dom_harness.mjs).

import { MkpLiveDoc } from "../dist/index.js";
import { install } from "../../testing/dom_harness.mjs";

install((root, { source, ir: _, ...props }) => new MkpLiveDoc(root, { ...props, source: source.text, path: source.path, packs: source.packs, wasm: window.__WASM_URL }));
