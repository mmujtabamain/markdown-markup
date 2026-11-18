// The test app for <MkpDoc>: drawn by Vue itself, `$state` controlled by the app, with the controls
// the shared doc steps use (testing/browser.mjs, docSteps).
import { createApp, h, ref, shallowRef } from "vue";
import { MkpDoc } from "@mkp/vue";

const heard = { states: [], errors: [], calls: [] };
const which = ref("v1");
const theme = ref("LIGHT");
const unit = ref("items");
const state = shallowRef(undefined);
const shown = ref(true);
const docRef = ref(null);

const App = {
  setup() {
    return () =>
      shown.value
        ? h(MkpDoc, {
            ref: docRef,
            ir: window.__IR[which.value],
            state: state.value,
            page: { theme: theme.value },
            externs: { app: { unit: { text: unit.value } } },
            onStateChange: (s) => {
              heard.states.push(s);
              state.value = s;
            },
            onError: (e) => heard.errors.push(e),
            onCalls: (c) => heard.calls.push(c),
          })
        : null;
  },
};

createApp(App).mount("#app");

window.__test = {
  heard,
  handle: () => docRef.value,
  setState: (s) => (state.value = s),
  setTheme: (t) => (theme.value = t),
  setIr: (w) => (which.value = w),
  setUnit: (u) => (unit.value = u),
  unmount: () => (shown.value = false),
};
