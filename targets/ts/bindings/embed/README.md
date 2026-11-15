# @mkp/embed

An MKP page in an element, the way every framework binding mounts it, and a page's Markdown as
HTML for a server. The bindings (`@mkp/react`, `@mkp/next`, `@mkp/vue`, `@mkp/svelte`,
`@mkp/solid`, `@mkp/angular`) are thin wrappers around it, so they all behave the same.

```sh
npm install @mkp/embed
```

```ts
import { Embed } from "@mkp/embed";
import page from "./shop.mkp.md"; // compiled by @mkp/cli/vite or @mkp/next/config

const shop = new Embed(document.getElementById("shop")!, {
  ir: page,
  onCalls: (calls) => console.log(calls), // the app's extern fns the page called
});
shop.update({ ir: page, page: { theme: "DARK" } }); // what a framework does when props change
shop.set({ budget: { num: "45" } });               // the handle: set, expose, extern, state, markdown
shop.destroy();
```

On a server, with no DOM: `import { pageHtml } from "@mkp/embed/html"` gives the page's Markdown
as HTML, with its starting values, to put in the element before the page mounts.

## Props

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
