# @mkp/react-live

MKP documents in React 19, the real-time target: `MkpLiveDoc` compiles a document's text in the
browser with [@mkp/wasm](../../wasm) as it is edited, and draws it with [@mkp/react](../react)'s
`MkpDoc`. A text that compiles replaces the page, keeping `$state` where its fields still exist.
One that doesn't leaves the last page that did, and its errors reach `onError` as
`{ kind: "compile", message, diagnostics }`. When to change `source` (each key, a pause, a save) is
the app's. The run-time target ships no WebAssembly; this one does.

```tsx
import { MkpLiveDoc } from "@mkp/react-live";
import wasm from "@mkp/wasm/mkp.wasm?url";            // as the bundler gives the file's URL

<MkpLiveDoc source={text} wasm={wasm} onError={(e) => e.kind === "compile" && show(e.diagnostics)} />
```

| Prop | What it does |
|---|---|
| `source` | The document's text. |
| `path` | Its path, for diagnostics: `page.mkp.md` when left out. |
| `packs` | The files of the packs it uses, `{ path, text }`. |
| `wasm` or `compiler` | Where mkp.wasm is (its URL, its bytes or the module), or a compiler in hand (one in a worker, which answers with a promise). Given a compiler already loaded, the first render has the page, on a server too. |

Everything else is `MkpDoc`'s ([@mkp/react](../react/README.md#props)), the handle included.

`npm test`: a server render with a compiler in hand, then the shared live steps in Chromium
(`../testing/browser.mjs`, `liveSteps`). `mkp target check react-live` runs every conformance case
with its own text compiled in the tab.
