// The Svelte target's check harness: <MkpDoc> rendered by Svelte, driven by the checks.
import { mount, unmount, flushSync } from "svelte";
import MkpDoc from "../src/MkpDoc.svelte";
import { install } from "../../testing/view_harness.mjs";

install((root, props) => {
  const c = mount(MkpDoc, { target: root, props });
  flushSync();
  return { doc: () => c.document(), unmount: () => unmount(c) };
});
