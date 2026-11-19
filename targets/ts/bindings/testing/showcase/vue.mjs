import { createApp, h, markRaw, onMounted, ref } from "vue";
import { XtmdDoc } from "@extended-mark/vue";
import { XtmdLiveDoc } from "@extended-mark/vue-live";
import { S, compiled, failed, onEdit, showState } from "./common.mjs";

const id = "vue";
const ir = markRaw(S.ir);

createApp({
  setup() {
    const state = ref(undefined);
    const run = ref(null);
    onMounted(() => showState(id, run.value.state()));
    return () => h(XtmdDoc, { ref: run, ir, state: state.value, onStateChange: (s) => ((state.value = s), showState(id, s)) });
  },
}).mount(`#${id}-run`);

createApp({
  setup() {
    const source = ref(S.source);
    const live = ref(null);
    onMounted(() => {
      onEdit(id, (t) => (source.value = t));
      compiled(id, live.value.doc);
    });
    return () => h(XtmdLiveDoc, { ref: live, source: source.value, wasm: S.wasm, onError: failed(id) });
  },
}).mount(`#${id}-live`);
