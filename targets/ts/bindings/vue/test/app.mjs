// The test app: <MkpPage> in Vue 3, with the controls the shared steps use (testing/browser.mjs).
import { createApp, h, ref } from "vue";
import { MkpPage } from "@mkp/vue";

const heard = { calls: [], states: [], outcomes: [], mounts: 0 };
const which = ref("v1");
const theme = ref("LIGHT");
const unit = ref("items");
const shown = ref(true);
const pageRef = ref(null);

const App = {
  setup() {
    return () =>
      shown.value
        ? h(MkpPage, {
            ref: pageRef,
            ir: window.__IR[which.value],
            page: { theme: theme.value },
            externs: { app: { unit: { text: unit.value } } },
            onCalls: (calls) => heard.calls.push(calls),
            onState: (state) => heard.states.push(state),
            onOutcome: (outcome) => heard.outcomes.push(outcome),
            onMount: () => heard.mounts++,
          })
        : null;
  },
};

createApp(App).mount("#app");

window.__test = {
  heard,
  handle: () => pageRef.value.handle(),
  setTheme: (t) => (theme.value = t),
  setIr: (w) => (which.value = w),
  setUnit: (u) => (unit.value = u),
  unmount: () => (shown.value = false),
};
