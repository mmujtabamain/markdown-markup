// The Vue target's check harness: <MkpDoc> rendered by Vue, driven by the checks.
import { createApp, h, ref } from "vue";
import { MkpDoc } from "../dist/index.js";
import { install } from "../../testing/view_harness.mjs";

install((root, props) => {
  const doc = ref(null);
  const app = createApp({ render: () => h(MkpDoc, { ...props, ref: doc }) });
  app.mount(root);
  return { doc: () => doc.value.doc, unmount: () => app.unmount() };
});
