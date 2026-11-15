# @mkp/react

MKP pages in React 19. `<MkpPage>` renders one empty `div` and @mkp/dom draws the page into it in
an effect, so it renders on a server too and mounts on the client.

```sh
npm install @mkp/react
```

```tsx
import { MkpPage, usePage } from "@mkp/react";
import shop from "./shop.mkp.md"; // compiled by @mkp/cli/vite (or @mkp/next/config)

export function Shop() {
  const [page, ref] = usePage(); // the handle, once mounted
  return (
    <>
      <MkpPage ref={ref} ir={shop} onCalls={(calls) => console.log(calls)} />
      <button onClick={() => page?.set({ budget: { num: "80" } })}>Raise the budget</button>
    </>
  );
}
```

## Props

`ir` (required), `state`, `page`, `externs`, `fns`, `widgets`, `onCalls`, `onState`,
`onOutcome`, `onMount`: as in [@mkp/embed](../embed/README.md#props). Also:

| Prop | What it does |
|---|---|
| `ref` | The page's handle: `page`, `mounted`, `set`, `expose`, `extern`, `state`, `markdown`. |
| `html` | HTML shown until the page mounts, from `pageHtml` (@mkp/next/server). Read once. |
| `id`, `className`, `style` | On the element. |

Keep `widgets` stable (a module-level object or `useMemo`): a new set remounts the page.
