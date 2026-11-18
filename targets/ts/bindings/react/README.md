# @mkp/react

MKP documents in React 19, the run-time target: `MkpDoc` draws a page from an IR built ahead
(`mkp build`, or @mkp/cli's bundler plugin), with no compiler and no WebAssembly in the app. Core's
widgets are drawn by React itself, with `createElement`: the page is part of the app's tree, server-rendered with `renderToString` and hydrated like the rest. The real-time target, which compiles a document's text in the
browser, is [@mkp/react-live](../react-live).

```sh
npm install @mkp/react
```

```tsx
import { MkpDoc, type MkpDocHandle } from "@mkp/react";
import { useRef, useState } from "react";

export function Shop() {
  const [state, setState] = useState(saved);            // the app's $state, or leave it to the page
  const doc = useRef<MkpDocHandle>(null);
  return (
    <>
      <MkpDoc ref={doc} src="/pages/shop.ir.json" state={state} onStateChange={setState}
        externs={{ shop: { currency: { text: "EUR" } } }} onError={(e) => console.warn(e)} onCalls={handle} />
      <button onClick={() => save(doc.current!.snapshot())}>Save</button>
    </>
  );
}
```

## Props

The same in every framework (@mkp/view's `DocProps`):

| Prop | What it does |
|---|---|
| `src` or `ir` | Where to fetch the IR from, or the IR in hand. A new one keeps `$state` where its fields still exist. |
| `state` and `onStateChange`, or `defaultState` | `$state` controlled by the app, or started from. A new `state` is a write checked by mkp; one it refuses leaves the page as it was. |
| `defaultSnapshot` | A snapshot to start from: `$state` and every widget's own variables. |
| `onError` | `{ kind: "refused" }` (the rule, the code, the widget), `"failed"`, `"load"` (an IR that couldn't be had). |
| `onCalls` | The app's extern fns the page called. |
| `externs`, `fns` | Each channel's values, by its name in the document or in full; the app's value fns, by full name. |
| `page`, `widgets`, `measure` | The page's width and theme; a pack's own extern widgets, drawn the way core's are; how the plane's spots are measured. |

`id`, `className`, `style` go on the root. The handle is `ref`: `{ doc, set, state, markdown, expose, snapshot, restore }` (`MkpDocHandle`). A snapshot is opaque JSON: with the same IR, `restore` puts all of
it back; with another, `$state` only.

## Real time

```tsx
import { MkpLiveDoc } from "@mkp/react-live";
import wasm from "@mkp/wasm/mkp.wasm?url";            // as the bundler gives the file's URL

<MkpLiveDoc source={text} wasm={wasm} onError={(e) => e.kind === "compile" && show(e.diagnostics)} />
```

## Tests

`npm test`: `MkpDoc` rendered on a server, then the shared steps in Chromium (`../testing/browser.mjs`,
`docSteps`): controlled `$state`, refusals, the handle, props, a new IR, widgets' own variables and
snapshots. `mkp target check react` runs the conformance cases through `check/harness`.
