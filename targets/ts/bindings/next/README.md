# @mkp/next

MKP pages in Next.js's app router: `<MkpPage>` as a client component, `.mkp.md` imports compiled by
mkp at build time, and the page's Markdown as HTML for the server to pre-render.

```sh
npm install @mkp/next
```

```js
// next.config.mjs: one loader, for Turbopack (Next 16's default) and webpack (--webpack)
import { withMkp } from "@mkp/next/config";
export default withMkp({}, { packs: ["./packs/maps"] });
```

```tsx
// app/page.tsx, a server component: the page's content in the HTML, for search engines
import { pageHtml } from "@mkp/next/server";
import shop from "./shop.mkp.md";
import { Shop } from "./shop"; // "use client": <MkpPage ir={shop} html={html} onCalls={…} />

export default function Home() {
  return <Shop html={pageHtml(shop)} />;
}
```

Add `/// <reference types="@mkp/next/mkp-md" />` to a `.d.ts` in the app to type the imports. A
page outside the app's folder needs `turbopack.root` set to a folder that holds both.

## Exports

- `@mkp/next`: `MkpPage` and `usePage`, as in [@mkp/react](../react/README.md), with `"use client"`.
- `@mkp/next/config`: `withMkp(config, { packs, config })`, and `loader`, the loader's path.
- `@mkp/next/server`: `pageHtml(ir, { state, page, externs })`, with no DOM.
