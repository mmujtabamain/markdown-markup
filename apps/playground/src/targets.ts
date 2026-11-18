// The playground's Targets page: one page drawn by the plain web's two kinds of target. Run time is
// @mkp/embed's MkpDoc, from an IR built ahead (build.mjs writes it with mkp.wasm). Real time is
// @mkp/embed-live's MkpLiveDoc, from the text in the box, compiled by mkp.wasm as it changes.

import { MkpDoc, type Snapshot } from "@mkp/embed";
import { MkpLiveDoc, type LiveDocProps } from "@mkp/embed-live";
import type { ir } from "@mkp/runtime";
import { mountReact } from "./targets-react.js";

function el<T extends HTMLElement = HTMLElement>(id: string): T {
  const found = document.getElementById(id);
  if (!found) throw new Error(`the page has no #${id}`);
  return found as T;
}

/** `$state` as one line: `n = 2, label = "x"`. */
function stateLine(s: Record<string, ir.Expr>): string {
  return Object.entries(s)
    .map(([k, x]) => `${k} = ${"num" in x ? x.num : "text" in x ? JSON.stringify(x.text) : JSON.stringify(x)}`)
    .join(", ");
}

/** A failure here is the team's to hear about, as the playground's are. */
function report(kind: string, message: string): void {
  console.error(`[targets] ${kind}: ${message}`);
  void fetch("/api/report", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ kind, message, agent: navigator.userAgent }) }).catch(() => {});
}

// ---- run time

const runState = el("run-state");
const run = new MkpDoc(el("run-page"), {
  src: "/targets-counter.ir.json",
  onStateChange: (s) => (runState.textContent = stateLine(s)),
  onError: (e) => {
    if (e.kind === "load") report("targets-load", e.message);
  },
  onMount: () => (runState.textContent = stateLine(run.state())),
});
let saved: Snapshot | undefined;
const restore = el<HTMLButtonElement>("restore");
el("snapshot").addEventListener("click", () => {
  saved = run.snapshot();
  restore.disabled = false;
  restore.textContent = `Restore it (${stateLine(saved.state)})`;
});
restore.addEventListener("click", () => {
  if (saved) run.restore(saved);
});

// ---- real time

const source = el<HTMLTextAreaElement>("live-source");
const status = el("live-status");
const liveState = el("live-state");
let props: LiveDocProps = {
  source: "",
  wasm: "/mkp.wasm",
  onStateChange: (s) => (liveState.textContent = stateLine(s)),
  onError: (e) => {
    if (e.kind === "compile") {
      status.dataset.state = "errors";
      status.textContent = e.message.replace(/^page\.mkp\.md doesn't compile/, "Doesn't compile");
    } else if (e.kind === "load") {
      status.dataset.state = "errors";
      status.textContent = e.message;
      report("compiler-load", e.message);
    }
  },
  onMount: () => {
    status.dataset.state = "ok";
    status.textContent = "Compiled in the browser";
    liveState.textContent = stateLine(live.state());
  },
};
let live: MkpLiveDoc;

let timer: ReturnType<typeof setTimeout> | undefined;
source.addEventListener("input", () => {
  clearTimeout(timer);
  timer = setTimeout(() => {
    status.dataset.state = "pending";
    status.textContent = "Compiling…";
    props = { ...props, source: source.value };
    live.update(props);
  }, 150);
});

async function start(): Promise<void> {
  const res = await fetch("/api/examples");
  const { examples } = (await res.json()) as { examples: { id: string; source: string }[] };
  source.value = examples.find((e) => e.id === "counter")?.source ?? "";
  props = { ...props, source: source.value };
  live = new MkpLiveDoc(el("live-page"), props);
  // the same page and text, in React
  const irFile = await (await fetch("/targets-counter.ir.json")).json();
  mountReact(el("react"), irFile, source.value);
}

void start();
