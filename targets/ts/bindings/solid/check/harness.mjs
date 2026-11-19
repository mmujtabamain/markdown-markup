// The Solid target's check harness: <XtmdDoc> rendered by Solid, driven by the checks.
import { createComponent } from "solid-js";
import { render } from "solid-js/web";
import { XtmdDoc } from "../dist/index.js";
import { install } from "../../testing/view_harness.mjs";

install((root, props) => {
  let handle;
  const dispose = render(() => createComponent(XtmdDoc, { ...props, ref: (h) => (handle = h) }), root);
  return { doc: () => handle.doc, unmount: dispose };
});
