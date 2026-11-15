# @mkp/svelte

MKP pages in Svelte 5, as a component or as an action on any element. @mkp/dom draws the page
once the element is in the document, so it renders on a server too.

```sh
npm install @mkp/svelte
```

```svelte
<script lang="ts">
  import { MkpPage, mkp } from "@mkp/svelte";
  import shop from "./shop.mkp.md"; // compiled by @mkp/cli/vite

  let page: MkpPage;
</script>

<MkpPage bind:this={page} ir={shop} onCalls={(calls) => console.log(calls)} />
<button onclick={() => page.handle().set({ budget: { num: "80" } })}>Raise the budget</button>

<!-- or on an element of your own -->
<section use:mkp={{ ir: shop }}></section>
```

## Props

`ir` (required), `state`, `page`, `externs`, `fns`, `widgets`, `onCalls`, `onState`,
`onOutcome`, `onMount`: as in [@mkp/embed](../embed/README.md#props); `class` and `id` on the
element. `bind:this` gives `handle()`: `page`, `mounted`, `set`, `expose`, `extern`, `state`,
`markdown`.
