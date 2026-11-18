// The Solid target's check harness: <MkpDoc> rendered by Solid, driven by the checks.
import { createComponent } from "solid-js";
import { render } from "solid-js/web";
import { MkpDoc } from "../dist/index.js";
import { install } from "../../testing/view_harness.mjs";

install((root, props) => {
  let handle;
  const dispose = render(() => createComponent(MkpDoc, { ...props, ref: (h) => (handle = h) }), root);
  return { doc: () => handle.doc, unmount: dispose };
});
