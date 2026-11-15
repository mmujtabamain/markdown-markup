// The test app: <MkpPage> in React 19, with the controls the shared steps use (testing/browser.mjs).
import { createElement as h, useState, StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { MkpPage, usePage } from "@mkp/react";

const heard = { calls: [], states: [], outcomes: [], mounts: 0 };
let controls;

function App() {
  const [which, setIr] = useState("v1");
  const [theme, setTheme] = useState("LIGHT");
  const [unit, setUnit] = useState("items");
  const [shown, setShown] = useState(true);
  const [handle, ref] = usePage();
  controls = { setIr, setTheme, setUnit, unmount: () => setShown(false), handle };
  if (!shown) return null;
  return h(MkpPage, {
    ref,
    ir: window.__IR[which],
    page: { theme },
    externs: { app: { unit: { text: unit } } },
    onCalls: (calls) => heard.calls.push(calls),
    onState: (state) => heard.states.push(state),
    onOutcome: (outcome) => heard.outcomes.push(outcome),
    onMount: () => heard.mounts++,
  });
}

createRoot(document.getElementById("app")).render(h(StrictMode, null, h(App)));

window.__test = {
  heard,
  handle: () => controls.handle,
  setTheme: (t) => controls.setTheme(t),
  setIr: (w) => controls.setIr(w),
  setUnit: (u) => controls.setUnit(u),
  unmount: () => controls.unmount(),
};
