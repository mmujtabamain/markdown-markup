# @extended-mark/solid-live

Extended Mark documents in Solid, the real-time target: `XtmdLiveDoc` compiles a document's text in the
browser with [@extended-mark/wasm](../../wasm) as it is edited, and draws it with [@extended-mark/solid](../solid)'s
`XtmdDoc`. A text that compiles replaces the page, keeping `$state` where its fields still exist.
One that doesn't leaves the last page that did, and its errors reach `onError` as
`{ kind: "compile", message, diagnostics }`. When to change `source` (each key, a pause, a save) is
the app's. The run-time target ships no WebAssembly; this one does.

```tsx
import { XtmdLiveDoc } from "@extended-mark/solid-live";
<XtmdLiveDoc source={text()} wasm={wasmUrl} onError={(e) => e.kind === "compile" && show(e.diagnostics)} />
```

| Prop | What it does |
|---|---|
| `source` | The document's text. |
| `path` | Its path, for diagnostics: `page.xt.md` when left out. |
| `packs` | The files of the packs it uses, `{ path, text }`. |
| `wasm` or `compiler` | Where xtmd.wasm is (its URL, its bytes or the module), or a compiler in hand (one in a worker, which answers with a promise). Given a compiler already loaded, the first render has the page, on a server too. |

Everything else is `XtmdDoc`'s ([@extended-mark/solid](../solid/README.md#props)), the handle included.

`npm test`: a server render with a compiler in hand, then the shared live steps in Chromium
(`../testing/browser.mjs`, `liveSteps`). `xtmd target check solid-live` runs every conformance case
with its own text compiled in the tab.
