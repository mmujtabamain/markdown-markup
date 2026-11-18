<!--
  <MkpLiveDoc source={text} />: an MKP document compiled in the browser by @mkp/wasm as it is
  edited, and drawn by @mkp/svelte's <MkpDoc>. A text that compiles replaces the page, keeping
  $state where its fields still exist; one that doesn't leaves the last page that did, and its
  errors reach `onError` ({ kind: "compile", diagnostics }). `wasm` is where mkp.wasm is, or
  `compiler` a compiler in hand; given one already loaded, the first render has the page, on a
  server too. bind:this gives <MkpDoc>'s handle.
-->
<script lang="ts">
  import { onDestroy } from "svelte";
  import { MkpDoc } from "@mkp/svelte";
  import { Live, type LiveProps } from "@mkp/live";
  import type { Doc, DocProps, Restored, Snapshot, Value, ir as Ir } from "@mkp/view";

  let { source, path = undefined, packs = undefined, wasm = undefined, compiler = undefined, ...props }: Omit<DocProps, "ir" | "src"> & LiveProps & { class?: string; id?: string } = $props();

  let ir: DocProps["ir"] = $state.raw(undefined);
  const live = new Live(() => (ir = live.ir));
  // a compiler in hand compiles now, so a server renders the page
  // svelte-ignore state_referenced_locally
  if (compiler) live.update({ source, path, packs, wasm, compiler }, (e) => props.onError?.(e));
  ir = live.ir;
  $effect(() => {
    live.update({ source, path, packs, wasm, compiler }, (e) => props.onError?.(e));
  });
  onDestroy(() => live.destroy());

  let view: ReturnType<typeof MkpDoc> | undefined = $state.raw(undefined);

  /** The running document. */
  export function document(): Doc {
    return view!.document();
  }
  export function set(changes: Record<string, Ir.Expr | Value>): void {
    view?.set(changes);
  }
  export function getState(): Record<string, Ir.Expr> {
    return view?.getState() ?? {};
  }
  export function markdown(): string {
    return view?.markdown() ?? "";
  }
  export function expose(channel: string, name: string, ...args: (Ir.Expr | Value)[]): void {
    view?.expose(channel, name, ...args);
  }
  export function snapshot(): Snapshot {
    return view!.snapshot();
  }
  export function restore(snap: Snapshot): Restored {
    return view!.restore(snap);
  }
</script>

<MkpDoc bind:this={view} {...props} {ir} />
