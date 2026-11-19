<script>
  import { XtmdLiveDoc } from "@extended-mark/svelte-live";

  let { first, wasm, onError } = $props();
  // svelte-ignore state_referenced_locally
  let source = $state(first);
  let view = $state();

  export function setSource(text) {
    source = text;
  }
  export function doc() {
    return view.document();
  }
</script>

<XtmdLiveDoc bind:this={view} {source} {wasm} {onError} />
