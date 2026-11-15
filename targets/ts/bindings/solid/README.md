# @mkp/solid

MKP pages in Solid. `<MkpPage>` renders one empty `div` and @mkp/dom draws the page into it in
`onMount`, so it renders on a server too. Written without JSX: it needs no Solid compiler.

```sh
npm install @mkp/solid
```

```tsx
import { MkpPage, type Handle } from "@mkp/solid";
import shop from "./shop.mkp.md"; // compiled by @mkp/cli/vite

export function Shop() {
  let page: Handle | undefined;
  return (
    <>
      <MkpPage ref={(h) => (page = h)} ir={shop} onCalls={(calls) => console.log(calls)} />
      <button onClick={() => page?.set({ budget: { num: "80" } })}>Raise the budget</button>
    </>
  );
}
```

## Props

`ir` (required), `state`, `page`, `externs`, `fns`, `widgets`, `onCalls`, `onState`,
`onOutcome`, `onMount`: as in [@mkp/embed](../embed/README.md#props). `ref` is called with the
page's handle once mounted; `id` and `class` go on the element.
