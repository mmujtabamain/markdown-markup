# @mkp/embed-live

MKP documents on the plain web, the real-time target: `MkpLiveDoc` compiles a document's text in the
browser with [@mkp/wasm](../../wasm) as it is edited, and draws it with [@mkp/embed](../embed)'s
`MkpDoc` (@mkp/dom's widgets). A text that compiles replaces the page, keeping `$state` where its
fields still exist. One that doesn't leaves the last page that did, and its errors reach `onError` as
`{ kind: "compile", message, diagnostics }`. The run-time target ships no WebAssembly; this one does.

```ts
import { MkpLiveDoc } from "@mkp/embed-live";
import wasm from "@mkp/wasm/mkp.wasm?url";        // as the bundler gives the file's URL

const doc = new MkpLiveDoc(document.getElementById("preview")!, { source: editor.value, wasm, onError: show });
editor.addEventListener("input", () => doc.update({ ...props, source: editor.value }));   // when is the app's
```

`source`, `path`, `packs` and `wasm` or `compiler` are as in the frameworks' `MkpLiveDoc`; everything
else, and the handle, is `MkpDoc`'s. `diagnostics` is the latest text's. The playground's Targets page
(apps/playground/targets.html) draws one page with this and with @mkp/embed side by side.

`npm test` runs the shared live steps in Chromium; `mkp target check embed-live` runs every
conformance case with its own text compiled in the tab.
