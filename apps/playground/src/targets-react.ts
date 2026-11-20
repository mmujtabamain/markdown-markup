// The Targets page's React row: the same page drawn by a framework's two targets. Run time is
// @extended-mark/react's <XtmdDoc>, from the IR built ahead, `$state` controlled by React's own state. Real
// time is @extended-mark/react-live's <XtmdLiveDoc>, from the text in a box, compiled by xtmd.wasm. Both draw
// core's widgets with React itself (@extended-mark/view's elements, through createElement).

import { createElement as h, useEffect, useRef, useState, type ReactElement } from "react";
import { createRoot } from "react-dom/client";
import { XtmdDoc, type DocError, type XtmdDocHandle, type Snapshot } from "@extended-mark/react";
import { XtmdLiveDoc } from "@extended-mark/react-live";
import type { ir } from "@extended-mark/runtime";

type State = Record<string, ir.Expr>;

/** `$state` as one line: `count = 2`. */
export function stateLine(s: State | undefined): string {
  return Object.entries(s ?? {})
    .map(([k, x]) => `${k} = ${"num" in x ? x.num : "text" in x ? JSON.stringify(x.text) : JSON.stringify(x)}`)
    .join(", ");
}

function RunTime({ ir: irFile }: { ir: unknown }): ReactElement {
  const [state, setState] = useState<State | undefined>(undefined);
  const [saved, setSaved] = useState<Snapshot | undefined>(undefined);
  const doc = useRef<XtmdDocHandle>(null);
  // React's state starts as the page's, once it has drawn
  useEffect(() => setState(doc.current?.state()), []);
  return h(
    "section",
    { "data-testid": "react-run-time", "aria-labelledby": "react-run-title" },
    h("h2", { id: "react-run-title" }, "Run time", h("span", { className: "kind" }, "@extended-mark/react")),
    h("p", { className: "sub" }, h("code", null, "<XtmdDoc ir={…} state={state} onStateChange={setState}>"), ": drawn by React itself, $state held in React's own state."),
    h(
      "div",
      { className: "page", "data-testid": "react-run-page" },
      // controlled: React holds $state, and every write the page makes is checked by xtmd first
      h(XtmdDoc, { ref: doc, ir: irFile as never, state, onStateChange: setState }),
    ),
    h(
      "div",
      { className: "row" },
      h("button", { type: "button", "data-testid": "react-snapshot", onClick: () => setSaved(doc.current?.snapshot()) }, "Take a snapshot"),
      h("button", { type: "button", "data-testid": "react-restore", disabled: !saved, onClick: () => saved && doc.current?.restore(saved) }, saved ? `Restore it (${stateLine(saved.state)})` : "Restore it"),
    ),
    h("div", { className: "state", "data-testid": "react-run-state" }, "React's state: ", h("span", { id: "react-run-state" }, stateLine(state))),
  );
}

function RealTime({ source: first }: { source: string }): ReactElement {
  const [text, setText] = useState(first);
  const [source, setSource] = useState(first);
  const [status, setStatus] = useState<{ state: string; text: string }>({ state: "loading", text: "Loading the compiler…" });
  const [state, setState] = useState<State | undefined>(undefined);
  const timer = useRef<ReturnType<typeof setTimeout>>(undefined);
  const live = useRef<XtmdDocHandle>(null);
  // a text that compiled is a new page: the status says so when the document has one
  useEffect(() => {
    const d = live.current?.doc;
    if (!d) return;
    let shown = d.running;
    if (shown) setStatus({ state: "ok", text: "Compiled in the browser" });
    return d.subscribe(() => {
      if (d.running && d.running !== shown) {
        shown = d.running;
        setStatus({ state: "ok", text: "Compiled in the browser" });
      }
    });
  }, []);
  return h(
    "section",
    { "data-testid": "react-real-time", "aria-labelledby": "react-live-title" },
    h("h2", { id: "react-live-title" }, "Real time", h("span", { className: "kind" }, "@extended-mark/react-live")),
    h("p", { className: "sub" }, h("code", null, "<XtmdLiveDoc source={text}>"), ": this text, compiled by xtmd.wasm as you type, drawn by React."),
    h("textarea", {
      "data-testid": "react-live-source",
      spellCheck: false,
      "aria-label": "The page's text, for React",
      value: text,
      onChange: (e: { target: { value: string } }) => {
        const v = e.target.value;
        setText(v);
        clearTimeout(timer.current);
        timer.current = setTimeout(() => {
          setStatus({ state: "pending", text: "Compiling…" });
          setSource(v);
        }, 150);
      },
    }),
    h("div", { className: "status", "data-testid": "react-live-status", "data-state": status.state, "aria-live": "polite" }, status.text),
    h(
      "div",
      { className: "page", "data-testid": "react-live-page" },
      h(XtmdLiveDoc, {
        ref: live,
        source,
        wasm: "/xtmd.wasm",
        onStateChange: setState,
        onError: (e: DocError) => {
          if (e.kind === "compile") setStatus({ state: "errors", text: e.message.replace(/^page\.xtmd doesn't compile/, "Doesn't compile") });
          else if (e.kind === "load") setStatus({ state: "errors", text: e.message });
        },
      }),
    ),
    h("div", { className: "state", "data-testid": "react-live-state" }, "$state: ", h("span", { id: "react-live-state" }, stateLine(state))),
  );
}

/** The React row, into its element. */
export function mountReact(root: HTMLElement, irFile: unknown, source: string): void {
  createRoot(root).render(h("div", { className: "grid" }, h(RunTime, { ir: irFile }), h(RealTime, { source })));
}
