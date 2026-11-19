# @extended-mark/embed-live

Extended Mark documents on the plain web, the real-time target: `XtmdLiveDoc` compiles a document's text in the
browser with [@extended-mark/wasm](../../wasm) as it is edited, and draws it with [@extended-mark/embed](../embed)'s
`XtmdDoc` (@extended-mark/dom's widgets). A text that compiles replaces the page, keeping `$state` where its
fields still exist. One that doesn't leaves the last page that did, and its errors reach `onError` as
`{ kind: "compile", message, diagnostics }`. The run-time target ships no WebAssembly; this one does.

```ts
import { XtmdLiveDoc } from "@extended-mark/embed-live";
import wasm from "@extended-mark/wasm/xtmd.wasm?url";        // as the bundler gives the file's URL

const doc = new XtmdLiveDoc(document.getElementById("preview")!, { source: editor.value, wasm, onError: show });
editor.addEventListener("input", () => doc.update({ ...props, source: editor.value }));   // when is the app's
```

`source`, `path`, `packs` and `wasm` or `compiler` are as in the frameworks' `XtmdLiveDoc`; everything
else, and the handle, is `XtmdDoc`'s. `diagnostics` is the latest text's. The playground's Targets page
(apps/playground/targets.html) draws one page with this and with @extended-mark/embed side by side.

`npm test` runs the shared live steps in Chromium; `xtmd target check embed-live` runs every
conformance case with its own text compiled in the tab.
