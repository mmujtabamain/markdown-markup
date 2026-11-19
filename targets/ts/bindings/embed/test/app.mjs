// The test app: an Embed on its own, given new props as a framework would, with the controls the
// shared steps use (testing/browser.mjs).
import { Embed } from "@extended-mark/embed";

const heard = { calls: [], states: [], outcomes: [], mounts: 0 };
let props = {
  ir: window.__IR.v1,
  page: { theme: "LIGHT" },
  externs: { app: { unit: { text: "items" } } },
  onCalls: (calls) => heard.calls.push(calls),
  onState: (state) => heard.states.push(state),
  onOutcome: (outcome) => heard.outcomes.push(outcome),
  onMount: () => heard.mounts++,
};
const embed = new Embed(document.getElementById("app"), props);
const give = (change) => embed.update((props = { ...props, ...change }));

window.__test = {
  heard,
  handle: () => embed,
  setTheme: (theme) => give({ page: { theme } }),
  setIr: (w) => give({ ir: window.__IR[w] }),
  setUnit: (text) => give({ externs: { app: { unit: { text } } } }),
  unmount: () => embed.destroy(),
};
