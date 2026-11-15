<!--
  <MkpPage ir={page} />: an MKP page, drawn by @mkp/dom once the element is in the document, so it
  renders on a server too (as its empty element). bind:this gives handle(), the page's handle.
-->
<script lang="ts">
  import type { Handle, Mounted, PageProps } from "@mkp/embed";
  import { mkp } from "./action.js";

  let { class: className = undefined, id = undefined, onMount = undefined, ...rest }: PageProps & { class?: string; id?: string } = $props();
  let current: Handle | undefined;

  /** The page's handle, once it is mounted. */
  export function handle(): Handle {
    if (!current) throw new Error("@mkp/svelte: the page isn't mounted yet");
    return current;
  }

  function mounted(m: Mounted, h: Handle) {
    current = h;
    onMount?.(m, h);
  }
</script>

<div class={className} {id} data-mkp-page use:mkp={{ ...rest, onMount: mounted }}></div>
