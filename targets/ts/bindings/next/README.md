# @mkp/next

MKP documents in Next.js's app router: `<MkpDoc>` (@mkp/react's, run time) as a client component,
which Next renders on the server and hydrates; `.mkp.md` imports compiled by mkp at build time, as
`withMkp` sets up; and a page's Markdown as HTML. An editor in a Next app uses
[@mkp/react-live](../react-live)'s `<MkpLiveDoc>` for real time.

```sh
npm install @mkp/next
```

```js
// next.config.mjs: one loader, for Turbopack (Next 16's default) and webpack (--webpack)
import { withMkp } from "@mkp/next/config";
export default withMkp({}, { packs: ["./packs/maps"] });
```

```tsx
// app/shop.tsx: "use client". Next renders the page on the server, then React hydrates it
import { MkpDoc } from "@mkp/next";
import shop from "./shop.mkp.md";

export function Shop() {
  return <MkpDoc ir={shop} onCalls={(calls) => handle(calls)} />;
}
```

Add `/// <reference types="@mkp/next/mkp-md" />` to a `.d.ts` in the app to type the imports. A
page outside the app's folder needs `turbopack.root` set to a folder that holds both.

## Exports

- `@mkp/next`: `MkpDoc`, as in [@mkp/react](../react/README.md), with `"use client"`.
- `@mkp/next/config`: `withMkp(config, { packs, config })`, and `loader`, the loader's path.
- `@mkp/next/server`: `pageHtml(ir, { state, page, externs })`, the page's Markdown as HTML, with no DOM.
