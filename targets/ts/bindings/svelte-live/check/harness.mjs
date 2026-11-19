// The Svelte real-time target's check harness: <XtmdLiveDoc> rendered by Svelte, driven by the checks.
import { mount, unmount, flushSync } from "svelte";
import XtmdLiveDoc from "../src/XtmdLiveDoc.svelte";
import { install } from "../../testing/view_harness.mjs";

/** The case's text for <XtmdLiveDoc>, compiled in the tab by the xtmd.wasm the adapter serves. */
const live = ({ source, ...props }) => ({ ...props, source: source.text, path: source.path, packs: source.packs, wasm: window.__WASM_URL });

install((root, props) => {
  const c = mount(XtmdLiveDoc, { target: root, props: live(props) });
  flushSync();
  return { doc: () => c.document(), unmount: () => unmount(c) };
});
