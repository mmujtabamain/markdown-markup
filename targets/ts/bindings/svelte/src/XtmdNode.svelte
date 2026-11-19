<!--
  One of @extended-mark/view's elements, rendered by Svelte itself: its attributes, listeners and live
  properties spread on it, its children by key, its hook as an action.
-->
<script lang="ts">
  import type { Child } from "@extended-mark/view";
  import XtmdNode from "./XtmdNode.svelte";
  import { attrsOf, hook, keyOf } from "./node.js";

  let { v }: { v: Child } = $props();
</script>

{#if typeof v === "string"}{v}{:else if v.tag === "style"}<svelte:element this={"style"} {...v.attrs}>{v.children.join("")}</svelte:element>{:else if v.hook}<svelte:element this={v.tag} xmlns={v.svg ? "http://www.w3.org/2000/svg" : undefined} {...attrsOf(v)} use:hook={v}>{#if v.tag !== "textarea"}{#each v.children as c, i (keyOf(c, i))}<XtmdNode v={c} />{/each}{/if}</svelte:element>{:else}<svelte:element this={v.tag} xmlns={v.svg ? "http://www.w3.org/2000/svg" : undefined} {...attrsOf(v)}>{#if v.tag !== "textarea"}{#each v.children as c, i (keyOf(c, i))}<XtmdNode v={c} />{/each}{/if}</svelte:element>{/if}
