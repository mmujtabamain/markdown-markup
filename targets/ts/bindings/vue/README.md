# @mkp/vue

MKP pages in Vue 3. `<MkpPage>` renders one empty `div` and @mkp/dom draws the page into it in
`onMounted`, so it renders on a server too.

```sh
npm install @mkp/vue
```

```vue
<script setup lang="ts">
import { ref } from "vue";
import { MkpPage, type MkpPageRef } from "@mkp/vue";
import shop from "./shop.mkp.md"; // compiled by @mkp/cli/vite

const page = ref<MkpPageRef>();
</script>

<template>
  <MkpPage ref="page" :ir="shop" @calls="(calls) => console.log(calls)" />
  <button @click="page?.set({ budget: { num: '80' } })">Raise the budget</button>
</template>
```

## Props

`ir` (required), `state`, `page`, `externs`, `fns`, `widgets`, and the listeners `@calls`,
`@state`, `@outcome`, `@mount`: as in [@mkp/embed](../embed/README.md#props). `html` shows
pre-rendered HTML until the page mounts. A template ref has `set`, `expose`, `extern`, `state`,
`markdown` and `handle()`. Don't pass the IR through `ref()` or `reactive()`: keep it plain.
