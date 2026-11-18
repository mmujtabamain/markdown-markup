# @mkp/vue

MKP documents in Vue 3, the run-time target: `MkpDoc` draws a page from an IR built ahead
(`mkp build`, or @mkp/cli's bundler plugin), with no compiler and no WebAssembly in the app. Core's
widgets are drawn by Vue itself, with `h`: patched by key, server-rendered with `renderToString`. The real-time target, which compiles a document's text in the
browser, is [@mkp/vue-live](../vue-live).

```sh
npm install @mkp/vue
```

```vue
<script setup>
import { ref } from "vue";
import { MkpDoc } from "@mkp/vue";
const state = ref(saved);
const doc = ref(null);   // doc.value.snapshot(), .restore(…), .set(…)
</script>

<template>
  <MkpDoc ref="doc" src="/pages/shop.ir.json" :state="state" @state-change="(s) => (state = s)"
    :externs="{ shop: { currency: { text: 'EUR' } } }" @error="console.warn" @calls="handle" />
</template>
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

Listeners are callback props: `@state-change` is `onStateChange`. The handle is a template ref: `{ doc, set, state, markdown, expose, snapshot, restore }` (`MkpDocRef`). A snapshot is opaque JSON: with the same IR, `restore` puts all of
it back; with another, `$state` only.

## Real time

```vue
<MkpLiveDoc :source="text" :wasm="wasmUrl" @error="(e) => e.kind === 'compile' && show(e.diagnostics)" />
<!-- import { MkpLiveDoc } from "@mkp/vue-live" -->
```

## Tests

`npm test`: `MkpDoc` rendered on a server, then the shared steps in Chromium (`../testing/browser.mjs`,
`docSteps`): controlled `$state`, refusals, the handle, props, a new IR, widgets' own variables and
snapshots. `mkp target check vue` runs the conformance cases through `check/harness`.
