# @mkp/embed

MKP documents on the plain web, the run-time target: `MkpDoc` draws a page from an IR built ahead,
with @mkp/dom's widgets, into an element, and needs no framework, no compiler and no WebAssembly. It
takes the same props as the frameworks' `<MkpDoc>`. The real-time target, which compiles a document's
text in the browser, is [@mkp/embed-live](../embed-live). Under `MkpDoc` is `Embed`, a page in an
element following the props it is given; and `@mkp/embed/html` writes a page's Markdown as HTML,
with no DOM, for a server.

```sh
npm install @mkp/embed
```

```ts
import { MkpDoc } from "@mkp/embed";

const doc = new MkpDoc(document.getElementById("shop")!, {
  src: "/pages/shop.ir.json",                   // or ir: the IR in hand
  defaultState: saved,                          // or state + onStateChange, controlled
  externs: { shop: { currency: { text: "EUR" } } },
  onError: (e) => console.warn(e),              // refused, failed, load
  onCalls: (calls) => handle(calls),
});
doc.update({ ...props, page: { theme: "DARK" } }); // the props changed
const snap = doc.snapshot();                       // $state and every widget's own variables
doc.restore(snap);                                 // all of it with the same IR, $state only with another
doc.destroy();
```

**On a server**, with no DOM, @mkp/view writes the same page as HTML, its widgets drawn as `MkpDoc`
draws them: `toHtml(new Doc({ ir }).render())`. Put it in the element, and `MkpDoc` takes the element
over in the browser.

`MkpDoc`'s props are the frameworks' (`src` or `ir`, `state` and `onStateChange` or `defaultState`,
`defaultSnapshot`, `onError`, `onCalls`, `externs`, `fns`, `page`, `widgets`, `measure`, and
`onMount`); its handle is `set`, `state`, `markdown`, `expose`, `extern`, `snapshot`, `restore`,
`running` and `mounted`. `mkp target check embed` runs the conformance cases through it
(`check/harness.mjs`), and `npm test` puts it through the frameworks' shared steps in Chromium.

## Embed's props

| Prop | What it does |
|---|---|
| `ir` | The page's IR. A new one remounts the page, keeping `$state` where its fields still exist. |
| `state` | `$state` to start from, in the IR's form. Read at mount, checked as an app's write is. |
| `page` | `{ width, theme }`. A change calls `page.setPage`. |
| `externs` | Each channel's values, in the IR's form. A changed channel calls `page.setExtern`. |
| `fns` | Value fns the app supplies, by full name. |
| `widgets` | The app's widgets by full name, in place of @mkp/dom's. A change remounts. |
| `onCalls` | The app's extern fn calls, after each change that made any. |
| `onState` | `$state`, after each change to it. |
| `onOutcome` | Refused writes and failures, after each change that had any. |
| `onMount` | The `Mounted` page, on mount and after each remount. |
