// The test app: <MkpPage> in Solid, with the controls the shared steps use (testing/browser.mjs).
import { createComponent, createSignal, Show } from "solid-js";
import { render } from "solid-js/web";
import { MkpPage } from "@mkp/solid";

const heard = { calls: [], states: [], outcomes: [], mounts: 0 };
const [which, setIr] = createSignal("v1");
const [theme, setTheme] = createSignal("LIGHT");
const [unit, setUnit] = createSignal("items");
const [shown, setShown] = createSignal(true);
let handle;

render(
  () =>
    createComponent(Show, {
      get when() {
        return shown();
      },
      get children() {
        return createComponent(MkpPage, {
          ref: (h) => (handle = h),
          get ir() {
            return window.__IR[which()];
          },
          get page() {
            return { theme: theme() };
          },
          get externs() {
            return { app: { unit: { text: unit() } } };
          },
          onCalls: (calls) => heard.calls.push(calls),
          onState: (state) => heard.states.push(state),
          onOutcome: (outcome) => heard.outcomes.push(outcome),
          onMount: () => heard.mounts++,
        });
      },
    }),
  document.getElementById("app"),
);

window.__test = {
  heard,
  handle: () => handle,
  setTheme,
  setIr,
  setUnit,
  unmount: () => setShown(false),
};
