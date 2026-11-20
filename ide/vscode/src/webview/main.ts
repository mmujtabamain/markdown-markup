// The preview's page: the vscode target, a real-time target in VS Code's webview. The extension
// gives it the document's text and its packs as they are edited; it compiles them here with
// xtmd.wasm (@extended-mark/embed-live) and draws the page with the vscode target's widgets, in the
// editor's theme. A text that doesn't compile leaves the last page that did, and says why. A widget
// that fails while drawn is told to the extension, which marks its call in the editor.

import { XtmdLiveDoc, Compiler, type PackFile } from "@extended-mark/embed-live";
import type { ir } from "@extended-mark/runtime";
import type { Built } from "@extended-mark/wasm";
import { failedCalls } from "../../../../apps/playground/src/failures.js";
import { widgets } from "./widgets.js";

declare function acquireVsCodeApi(): { postMessage(m: unknown): void; getState(): unknown; setState(s: unknown): void };
const vscode = acquireVsCodeApi();

interface Source {
  type: "source";
  path: string;
  text: string;
  packs: PackFile[];
}

const root = document.getElementById("page")!;
const status = document.getElementById("status")!;
let doc: XtmdLiveDoc | undefined;
let compiler: Compiler | undefined;
let theme: "LIGHT" | "DARK" = document.body.classList.contains("vscode-light") ? "LIGHT" : "DARK";
/** The last build that compiled: its IR and where each call is written, for the failed widgets. */
let shown: { ir: ir.File; sites: Built["sites"] } | undefined;
let unfollow: (() => void) | undefined;

function say(text: string, kind: "ok" | "errors" | "loading"): void {
  status.textContent = text;
  status.dataset.kind = kind;
}

/** The compiler the page builds with, keeping each build that compiled and where its calls are. */
const builds = {
  build(path: string, text: string, packs: PackFile[] = []): Built {
    const b = compiler!.build(path, text, packs);
    if (b.ir) shown = { ir: b.ir as unknown as ir.File, sites: b.sites };
    const errors = b.diagnostics.filter((d) => d.severity === "error");
    if (errors.length) say(`${errors.length} error${errors.length === 1 ? "" : "s"}: showing the last page that compiled. ${errors[0].line}:${errors[0].column} ${errors[0].message}`, "errors");
    else say("", "ok");
    return b;
  },
};

/** The widgets that failed, told to the extension each time the page changes. */
function tellFailures(): void {
  const page = doc?.running;
  if (!page || !shown) return;
  vscode.postMessage({ type: "failures", items: failedCalls(page, shown.ir, shown.sites) });
}

/** The last text the extension gave, drawn again when the theme changes or $state is reset. */
let lastSource: Source | undefined;

function draw(src: Source): void {
  lastSource = src;
  if (!compiler) return;
  const props = {
    source: src.text,
    path: src.path,
    packs: src.packs,
    compiler: builds,
    widgets,
    page: { theme },
    onError: (e: { kind: string; message?: string }) => {
      if (e.kind !== "compile") vscode.postMessage({ type: "log", text: `${e.kind}: ${e.message ?? ""}` });
    },
    onMount: (m: { page: { onChange(f: () => void): () => void } }) => {
      unfollow?.();
      unfollow = m.page.onChange(() => queueMicrotask(tellFailures));
      queueMicrotask(tellFailures);
    },
  };
  if (doc) doc.update(props as never);
  else doc = new XtmdLiveDoc(root, props as never);
}

window.addEventListener("message", async (e: MessageEvent) => {
  const m = e.data;
  if (m.type === "wasm") {
    say("Loading the compiler…", "loading");
    compiler = await Compiler.load(m.bytes as ArrayBuffer);
    say("", "ok");
    if (lastSource) draw(lastSource);
  } else if (m.type === "source") {
    draw(m as Source);
  } else if (m.type === "theme") {
    theme = m.theme;
    document.body.dataset.follow = String(m.follow);
    if (lastSource) draw(lastSource);
  } else if (m.type === "reset") {
    // a new page from the same text: $state and every widget's own variables at their start
    doc?.destroy();
    doc = undefined;
    shown = undefined;
    if (lastSource) draw(lastSource);
  }
});

// the editor's theme changed: VS Code swaps the body's class
new MutationObserver(() => {
  const next = document.body.classList.contains("vscode-light") ? "LIGHT" : "DARK";
  if (next !== theme && document.body.dataset.follow !== "false") {
    theme = next;
    if (lastSource) draw(lastSource);
  }
}).observe(document.body, { attributes: true, attributeFilter: ["class"] });

vscode.postMessage({ type: "ready" });
