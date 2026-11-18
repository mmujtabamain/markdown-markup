# @mkp/solid

MKP documents in Solid, the run-time target: `MkpDoc` draws a page from an IR built ahead
(`mkp build`, or @mkp/cli's bundler plugin), with no compiler and no WebAssembly in the app. Core's
widgets are drawn by Solid itself, with fine-grained updates (`Dynamic`, keyed by `mapArray`), server-rendered with `renderToString`; written without JSX, so it needs no Solid compiler. The real-time target, which compiles a document's text in the
browser, is [@mkp/solid-live](../solid-live).

```sh
npm install @mkp/solid
```

```tsx
import { MkpDoc, type MkpDocHandle } from "@mkp/solid";
import { createSignal } from "solid-js";

const [state, setState] = createSignal(saved);
let doc: MkpDocHandle;
<MkpDoc ref={(h) => (doc = h)} src="/pages/shop.ir.json" state={state()} onStateChange={setState}
  externs={{ shop: { currency: { text: "EUR" } } }} onError={console.warn} onCalls={handle} />
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

`id` and `class` go on the root. The handle is `ref`: `{ doc, set, state, markdown, expose, snapshot, restore }` (`MkpDocHandle`). A snapshot is opaque JSON: with the same IR, `restore` puts all of
it back; with another, `$state` only.

## Real time

```tsx
import { MkpLiveDoc } from "@mkp/solid-live";
<MkpLiveDoc source={text()} wasm={wasmUrl} onError={(e) => e.kind === "compile" && show(e.diagnostics)} />
```

## Tests

`npm test`: `MkpDoc` rendered on a server, then the shared steps in Chromium (`../testing/browser.mjs`,
`docSteps`): controlled `$state`, refusals, the handle, props, a new IR, widgets' own variables and
snapshots. `mkp target check solid` runs the conformance cases through `check/harness`.
