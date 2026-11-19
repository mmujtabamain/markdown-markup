// The Svelte target's check harness: <XtmdDoc> rendered by Svelte, driven by the checks.
import { mount, unmount, flushSync } from "svelte";
import XtmdDoc from "../src/XtmdDoc.svelte";
import { install } from "../../testing/view_harness.mjs";

install((root, props) => {
  const c = mount(XtmdDoc, { target: root, props });
  flushSync();
  return { doc: () => c.document(), unmount: () => unmount(c) };
});
