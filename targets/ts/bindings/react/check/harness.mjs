// The React target's check harness: <MkpDoc> rendered by React, driven by the checks.
import { createElement as h, createRef } from "react";
import { createRoot } from "react-dom/client";
import { flushSync } from "react-dom";
import { MkpDoc } from "../dist/index.js";
import { install } from "../../testing/view_harness.mjs";

install((root, props) => {
  const ref = createRef();
  const r = createRoot(root);
  flushSync(() => r.render(h(MkpDoc, { ...props, ref })));
  return { doc: () => ref.current.doc, unmount: () => r.unmount() };
});
