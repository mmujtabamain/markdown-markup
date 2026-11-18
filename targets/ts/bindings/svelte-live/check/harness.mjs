// The Svelte real-time target's check harness: <MkpLiveDoc> rendered by Svelte, driven by the checks.
import { mount, unmount, flushSync } from "svelte";
import MkpLiveDoc from "../src/MkpLiveDoc.svelte";
import { install } from "../../testing/view_harness.mjs";

/** The case's text for <MkpLiveDoc>, compiled in the tab by the mkp.wasm the adapter serves. */
const live = ({ source, ...props }) => ({ ...props, source: source.text, path: source.path, packs: source.packs, wasm: window.__WASM_URL });

install((root, props) => {
  const c = mount(MkpLiveDoc, { target: root, props: live(props) });
  flushSync();
  return { doc: () => c.document(), unmount: () => unmount(c) };
});
